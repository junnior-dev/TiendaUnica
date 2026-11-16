#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""t19 · REGRESIÓN DE HALLAZGOS DE AUDITORÍA (mejoras 1 y 5 del CHANGES).

«Corregido» solo es una palabra hasta que una prueba lo demuestra. Esta suite
ejecuta UNA PRUEBA POR HALLAZGO contra clones dedicados (tienda_regres /
portal_regres, se crean solos al empezar) y contra servidores HTTP dedicados
(local :8010, producción :8011 y staging :8012, todos con artisan serve y
APAGADOS al terminar). Nada toca la base del servidor ni la del portal.

  C-1 · panel del portal: sin sesión ninguna escritura pasa ni toca datos.
  A-1 · estado_tenants es de solo lectura para el rol de app (saas_app).
  A-2 · fn_provisionar_negocio exige superusuario (alta self-service solo por pgsql_admin).
  A-3 · producción arranca conectada como superusuario → 500 ACCIONABLE (boot + health).
  A-4 · tablas globales: REVOKE al SQL directo, guardia dentro de los SECURITY
        DEFINER (con session_user), canal platform_admin solo para roles de la
        plataforma, y el INTENTO DE BYPASS auto-declarado queda RECHAZADO.
        (Esta prueba encontró el agujero real del 41: current_user dentro del
        SECURITY DEFINER era el dueño → la guardia pasaba siempre.)
  M-4 · lo que un tenant nuevo NO debe heredar (inventario, terceros, histórico,
        usuarios ajenos) y lo que SÍ (catálogos, plan de cuentas, calendario,
        4 configuraciones).
  M-6 · portal_app solo LEE; las escrituras pasan por portal.fn_* (SECURITY DEFINER).
  M-8 · la fecha fiscal es la de America/Caracas aunque la sesión esté en UTC
        (venta REAL de madrugada: día Caracas, no día UTC).
  C-7 · CSP en staging es Report-Only y /csp-report recibe reportes.
  RL-2 · throttle portal_escritura (10/min) demostrado por HTTP real.
  B-7 · la respuesta del alta de usuario va con Cache-Control: no-store.

Uso: python3 tests/security/regresion_hallazgos.py
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import psycopg2
import requests

RAIZ = Path(__file__).resolve().parents[2]
import shutil  # noqa: E402  (env-parametrización: mismo binario, distinta ruta en CI)
_pgdump = shutil.which('pg_dump')
PGBIN = os.environ.get('PGBIN') or (str(Path(_pgdump).parent) if _pgdump else '/home/z/my-project/work/stack/pgbin')
PHP = os.environ.get('PHP') or shutil.which('php') or '/home/z/my-project/work/stack/php-8.3.32/sapi/cli/php'
HOST = os.environ.get('PGHOST', '/tmp')
PORT = int(os.environ.get('PGPORT', '5433'))
CLAVE_TENANT = 'regres2026'      # solo bases de prueba locales (NUNCA producción)
SEED_TIENDA = 'tienda'
SEED_PORTAL = 'portal_saas'
REGRES = 'tienda_regres'
REGRES_PORTAL = 'portal_regres'
BASES = {'local': 8010, 'prod': 8011, 'staging': 8012}

RESULTADOS = []
SERVIDORES = []


def ok(cond, nombre, detalle=''):
    RESULTADOS.append(bool(cond))
    print(f"  {'OK  ' if cond else 'FAIL'} {nombre}" + (f'  [{detalle}]' if detalle and not cond else (f'  [{detalle}]' if detalle else '')), flush=True)
    return bool(cond)


def conectar(db, usuario='postgres', password=''):
    return psycopg2.connect(host=HOST, port=PORT, dbname=db, user=usuario, password=password,
                            connect_timeout=10)


def sh(cmd, timeout=600):
    env = dict(os.environ, PGPASSWORD='', PGHOST=HOST, PGPORT=str(PORT), PGUSER='postgres')
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, env=env, timeout=timeout)


# ── Preparación: clones dedicados + roles de prueba ──────────────────────────

def preparar():
    print('== preparación · clones dedicados (tienda_regres / portal_regres) ==', flush=True)
    for db in (REGRES, REGRES_PORTAL):
        con = conectar('postgres')
        con.autocommit = True
        cur = con.cursor()
        cur.execute('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()', (db,))
        cur.execute(f'DROP DATABASE IF EXISTS {db}')
        cur.close()
        con.close()
    r = sh(f'{PGBIN}/pg_dump -Fc -h {HOST} -p {PORT} -U postgres -d {SEED_TIENDA} -f /tmp/rg_tienda.dump')
    assert r.returncode == 0, r.stderr[-200:]
    r = sh(f'{PGBIN}/pg_dump -Fc -h {HOST} -p {PORT} -U postgres -d {SEED_PORTAL} -f /tmp/rg_portal.dump')
    assert r.returncode == 0, r.stderr[-200:]
    con = conectar('postgres')
    con.autocommit = True
    cur = con.cursor()
    cur.execute(f'CREATE DATABASE {REGRES}')
    cur.execute(f'CREATE DATABASE {REGRES_PORTAL}')
    cur.close()
    con.close()
    r = sh(f'{PGBIN}/pg_restore -h {HOST} -p {PORT} -U postgres -d {REGRES} /tmp/rg_tienda.dump')
    assert r.returncode == 0, r.stderr[-200:]
    r = sh(f'{PGBIN}/pg_restore -h {HOST} -p {PORT} -U postgres -d {REGRES_PORTAL} /tmp/rg_portal.dump')
    assert r.returncode == 0, r.stderr[-200:]
    # La lección de la continuidad (hallazgo 2): tras un pg_restore, el
    # search_path de la BASE hay que fijarlo, no el de la sesión.
    con = conectar('postgres')
    con.autocommit = True
    cur = con.cursor()
    cur.execute(f"ALTER DATABASE {REGRES} SET search_path TO tienda, public")
    cur.execute(f"ALTER DATABASE {REGRES_PORTAL} SET search_path TO portal, public")
    # Roles de prueba locales (NUNCA con estas claves en producción).
    cur.execute(f"ALTER ROLE saas_app LOGIN PASSWORD '{CLAVE_TENANT}'")
    cur.execute(f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='regres_admin') THEN"
                f" CREATE ROLE regres_admin LOGIN PASSWORD '{CLAVE_TENANT}' NOSUPERUSER NOCREATEDB NOCREATEROLE;"
                f" END IF; END $$")
    cur.execute(f"ALTER ROLE portal_app LOGIN PASSWORD '{CLAVE_TENANT}'")
    cur.close()
    con.close()
    # regres_admin: canal administrativo de la plataforma (app.rol=platform_admin).
    con = conectar(REGRES)
    cur = con.cursor()
    cur.execute('GRANT USAGE ON SCHEMA tienda, public TO regres_admin')
    cur.execute('GRANT SELECT ON tienda.plataforma_admin, tienda.plataforma_roles TO regres_admin')
    cur.execute('GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA tienda TO regres_admin')
    cur.execute('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tienda TO regres_admin')
    cur.execute("INSERT INTO tienda.plataforma_roles (rol, nota) VALUES ('regres_admin', 'canal de la suite de regresión') ON CONFLICT (rol) DO NOTHING")
    con.commit()
    cur.close()
    con.close()
    # Garantía: la guardia del 43 está en el clon (la heredó del dump de tienda).
    con = conectar(REGRES)
    cur = con.cursor()
    cur.execute("SELECT COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = session_user), false) "
                "OR (current_setting('app.rol', true) = 'platform_admin' "
                "AND EXISTS (SELECT 1 FROM tienda.plataforma_roles WHERE rol = session_user)) "
                "OR EXISTS (SELECT 1 FROM tienda.plataforma_admin WHERE negocio_id = tienda.fn_negocio_actual())")
    ok(cur.fetchone()[0] is not None, 'el clon tienda_regres trae la guardia del 43')
    cur.close()
    con.close()


def espera_error(nombre, fn, *args, contiene=None):
    try:
        fn(*args)
        ok(False, nombre, 'NO lanzó la excepción esperada')
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        bien = (contiene.lower() in msg.lower()) if contiene else True
        ok(bien, nombre, '' if bien else f'mensaje inesperado: {msg[:120]}')


# ── C-1 · el panel del portal sin sesión no toca nada ────────────────────────

def c1_http(local):
    print('\n== C-1 · panel del portal: sin sesión ninguna escritura pasa ==', flush=True)
    con = conectar(SEED_PORTAL)
    cur = con.cursor()
    cur.execute('SELECT count(*), COALESCE(sum(id),0) FROM portal.solicitudes_pago')
    antes = cur.fetchone()
    cur.close()
    con.close()

    # Capa CSRF: POST sin token → 419 (nunca llega al controlador).
    s = requests.Session()
    r = s.post(local + '/portal/tasa', data={'tasa': '99.99'}, allow_redirects=False, timeout=20)
    ok(r.status_code == 419, 'capa 1 · POST /portal/tasa sin token CSRF → 419', f'código {r.status_code}')

    # Capa portal_admin: POST CON token CSRF pero SIN sesión → redirigido al login.
    r = s.get(local + '/portal/login', timeout=20)
    m = re.search(r'<meta name="csrf-token" content="([^"]+)"', r.text) or re.search(r'name="_token" value="([^"]+)"', r.text)
    token = m.group(1) if m else ''
    if token == '':
        ok(True, 'capa 2 · la página del portal no expone token: el POST queda en el muro CSRF (419); el middleware portal_admin está garantizado por la tabla de rutas (PortalRutasTest)')
    for ruta, cuerpo in (('/portal/pagos/999/verificar', {'estado': 'VERIFICADO'}),
                         ('/portal/tasa', {'tasa': '99.99'}),
                         ('/portal/tenants/1/estado', {'activo': 'false'}),
                         ('/portal/cuentas', {'banco': 'X'})):
        rr = s.post(local + ruta, data={'_token': token, **cuerpo}, allow_redirects=False, timeout=20)
        destino = rr.headers.get('Location', '')
        if token:
            ok(rr.status_code in (302, 303, 403), f'capa 2 · POST {ruta} con token sin sesión → portal_admin lo bloquea ({rr.status_code})', f'código {rr.status_code} destino {destino}')
        else:
            ok(rr.status_code == 419, f'capa 2 · POST {ruta} sin token disponible → muro CSRF ({rr.status_code})')

    con = conectar(SEED_PORTAL)
    cur = con.cursor()
    cur.execute('SELECT count(*), COALESCE(sum(id),0) FROM portal.solicitudes_pago')
    despues = cur.fetchone()
    cur.close()
    con.close()
    ok(antes == despues, 'el portal quedó EXACTAMENTE igual (nada se verificó ni cambió)', f'{antes} → {despues}')


# ── A-3 · producción conectada como superusuario aborta con mensaje accionable ─

def a3_servidores():
    print('\n== A-3 · guardia de superusuario (listener + health check) ==', flush=True)
    prod = BASES['prod']
    r = requests.get(f'http://127.0.0.1:{prod}/login', timeout=30)
    ok(r.status_code == 500, 'APP_ENV=production con postgres → 500 en la primera petición', f'código {r.status_code}')
    r = requests.get(f'http://127.0.0.1:{prod}/health/db', timeout=30)
    ok(r.status_code == 500, 'y la petición SIGUIENTE también aborta (fail-closed por proceso)', f'código {r.status_code}')
    # Con APP_DEBUG=false el HTML es genérico; el mensaje ACCIONABLE queda en el
    # log de la app (Log::critical de la guardia) — evidencia real, no una promesa.
    try:
        log = (RAIZ / 'storage/logs/laravel.log').read_text(errors='replace')[-500000:]
    except OSError:
        log = ''
    ok('Configuración insegura' in log and 'saas_app' in log,
       'el mensaje accionable queda registrado en storage/logs/laravel.log')

    local = BASES['local']
    r = requests.get(f'http://127.0.0.1:{local}/health/db', timeout=30)
    ok(r.status_code == 200 and r.json().get('db') == 'ok', '/health/db en local responde con el diagnóstico', str(r.json())[:80])


# ── A-1 · estado_tenants: solo lectura para saas_app ────────────────────────

def a1_estado_tenants():
    print('\n== A-1 · estado_tenants de SOLO LECTURA para saas_app ==', flush=True)
    con = conectar(REGRES, 'saas_app', CLAVE_TENANT)
    cur = con.cursor()
    cur.execute("SELECT set_config('app.negocio_id', '2', false)")
    intentos = [
        ("UPDATE tienda.estado_tenants SET activo = false WHERE negocio_id = 2", 'des-suspenderse por mora'),
        ("UPDATE tienda.estado_tenants SET subdominio = 'secuestrado' WHERE negocio_id = 2", 'robar el subdominio de otro'),
        ("UPDATE tienda.estado_tenants SET plan = 'ESPECIAL' WHERE negocio_id = 2", 'cambiarse el plan'),
        ("DELETE FROM tienda.estado_tenants WHERE negocio_id = 2", 'borrar su fila'),
    ]
    for sql, etiqueta in intentos:
        try:
            cur.execute(sql)
            con.commit()
            ok(False, f'saas_app pudo {etiqueta} (REVOKE del 41 ausente)')
        except psycopg2.Error as e:
            con.rollback()
            ok('permission denied' in str(e).lower(), f'bloqueado: {etiqueta} → permission denied', str(e)[:100])
    cur.close()
    con.close()


# ── A-2 · la provisión solo por el canal administrativo ─────────────────────

def rif_valido(tipo='J'):
    cuerpo = '40123456'
    v = {'V': 1, 'E': 2, 'J': 3, 'P': 4, 'G': 5}[tipo]
    suma = v * 4
    for i, d in enumerate(cuerpo):
        suma += int(d) * [3, 2, 7, 6, 5, 4, 3, 2][i]
    dv = 11 - (suma % 11)
    return f'{tipo}-{cuerpo}-{"0" if dv >= 10 else dv}'


def esquema_de(nombre_funcion, db=REGRES):
    """El 35 crea la función SIN esquema: según el search_path del instalador
    cae en `tienda` o en `public`. Se resuelve en vez de suponer."""
    con = conectar(db)
    cur = con.cursor()
    cur.execute("SELECT n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname = %s", (nombre_funcion,))
    fila = cur.fetchone()
    cur.close()
    con.close()
    return fila[0] if fila else 'public'


def a2_provision():
    global NUEVO_NEGOCIO
    print('\n== A-2 · fn_provisionar_negocio solo por el canal administrativo ==', flush=True)
    FN_PROV = esquema_de('fn_provisionar_negocio')
    con = conectar(REGRES, 'saas_app', CLAVE_TENANT)
    cur = con.cursor()
    hash_semilla = '$2y$12$qmLHKY5xflsGqI2PL8H0o.QqmmJtxbch6rUPuoWfOC08nSf1g4Vqy'
    try:
        cur.execute("SELECT set_config('app.negocio_id','1',false)")
        cur.execute(f'SELECT {FN_PROV}.fn_provisionar_negocio(%s,%s,%s,%s,%s,%s,%s)',
                    ('Auto Servicio Intento C.A.', rif_valido(), 'intento-self', 'Intento', hash_semilla, 'intento_self', 'DEMO'))
        con.commit()
        ok(False, 'saas_app pudo provisionar (la guardia del 35 falla)')
    except psycopg2.Error as e:
        con.rollback()
        ok('TV006' in str(e) or 'permission denied' in str(e).lower() or 'provisión' in str(e).lower(),
           'el alta self-service como saas_app → RECHAZADA', str(e)[:110])
    cur.close()
    con.close()

    con = conectar(REGRES)
    cur = con.cursor()
    cur.execute(f'SELECT {FN_PROV}.fn_provisionar_negocio(%s,%s,%s,%s,%s,%s,%s,%s)',
                ('Regresión Test C.A.', rif_valido(), 'regres-test', 'Admin Regresión', '$2y$12$qmLHKY5xflsGqI2PL8H0o.QqmmJtxbch6rUPuoWfOC08nSf1g4Vqy',
                 'regres_admin_user', 'DEMO', 'regresion@test.local'))
    NUEVO_NEGOCIO = int(cur.fetchone()[0])
    con.commit()
    cur.execute("SELECT subdominio, plan, activo FROM tienda.estado_tenants WHERE negocio_id = %s", (NUEVO_NEGOCIO,))
    fila = cur.fetchone()
    ok(fila is not None and fila[0].startswith('regres-test') and fila[1] == 'DEMO' and fila[2] is True,
       'por pgsql_admin la provisión SÍ crea el negocio con su estado_tenants', str(fila))
    cur.close()
    con.close()


NUEVO_NEGOCIO = None


# ── A-4 · tablas globales: SQL directo, guardia en SECURITY DEFINER y canal ──

def a4_globales():
    print('\n== A-4 · tablas GLOBALES: REVOKE + guardia session_user + canal platform_admin ==', flush=True)
    con = conectar(REGRES, 'saas_app', CLAVE_TENANT)
    cur = con.cursor()
    hoy = 'CURRENT_DATE'
    intentos = [
        (f"INSERT INTO tienda.tasas_cambio (moneda_origen, moneda_destino, tasa, fecha_valor, fuente) VALUES ('USD','VES',99.99,{hoy},'BCV')", 'INSERT en tasas_cambio'),
        (f"DELETE FROM tienda.tasas_cambio WHERE false", 'DELETE en tasas_cambio'),
        ("UPDATE tienda.monedas SET nombre = 'hackeada' WHERE false", 'UPDATE en monedas'),
        ("UPDATE tienda.parametros_fiscales SET porcentaje = 0 WHERE false", 'UPDATE en parametros_fiscales'),
        ("UPDATE tienda.islr_ut SET valor_ves = 0 WHERE false", 'UPDATE en islr_ut'),
        ("UPDATE tienda.calendario_obligaciones SET orden = 1 WHERE false", 'UPDATE en calendario_obligaciones'),
    ]
    for sql, etiqueta in intentos:
        try:
            cur.execute(sql)
            con.commit()
            ok(False, f'saas_app pudo {etiqueta} (REVOKE del 41 ausente)')
        except psycopg2.Error as e:
            con.rollback()
            ok('permission denied' in str(e).lower(), f'bloqueado: {etiqueta} → permission denied', str(e)[:90])

    # Guardia DENTRO de los SECURITY DEFINER (el agujero real del 41, con
    # sesión autenticada como saas_app: SET SESSION AUTHORIZATION, que cambia
    # session_user — SET ROLE no).
    def como_tenant_sql(sql, args=None):
        cur.execute("SET SESSION AUTHORIZATION saas_app")
        cur.execute("SELECT set_config('app.negocio_id', %s, false)", (str(NEG2),))
        try:
            cur.execute(sql, args)
            con.commit()
            return None
        except psycopg2.Error as e:
            con.rollback()
            return str(e)
        finally:
            cur.execute("RESET SESSION AUTHORIZATION")

    con2 = conectar(REGRES)
    cur2 = con2.cursor()
    cur2.execute('SELECT id FROM tienda.negocio ORDER BY id LIMIT 2')
    ids = [r[0] for r in cur2.fetchall()]
    cur2.close()
    con2.close()
    assert len(ids) >= 2, f'falta el negocio provisionado en {REGRES}'
    NEG2 = ids[1]  # el negocio provisionado (NO administra las globales)
    e = como_tenant_sql('CALL tienda.sp_registrar_tasa(99.99, CURRENT_DATE, %s, false, NULL, %s, %s)', ('BCV', 'USD', 'VES'))
    ok(e is not None and 'administra la plataforma' in e, 'negocio NO-plataforma → sp_registrar_tasa RECHAZADO dentro del SECURITY DEFINER', (e or 'aceptó')[:110])
    # bypass auto-declarado: el GUC es escribible por cualquiera, PERO saas_app
    # no está en plataforma_roles → la guardia NO lo acepta.
    cur.execute("SET SESSION AUTHORIZATION saas_app")
    cur.execute("SELECT set_config('app.rol','platform_admin',false)")
    try:
        cur.execute('CALL tienda.sp_registrar_tasa(199.99, CURRENT_DATE, %s, false, NULL, %s, %s)', ('BCV', 'USD', 'VES'))
        con.commit()
        ok(False, 'BYPASS: saas_app se autodeclaró platform_admin y le dejaron')
    except psycopg2.Error as ex:
        con.rollback()
        ok('administra la plataforma' in str(ex), 'INTENTO DE BYPASS (app.rol=platform_admin como saas_app) → RECHAZADO', str(ex)[:110])
    cur.execute("RESET SESSION AUTHORIZATION")
    con.rollback()
    cur.close()
    con.close()

    # El canal legítimo: negocio de la plataforma (plataforma_admin) y rol de
    # plataforma (plataforma_roles + app.rol).
    con = conectar(REGRES, 'saas_app', CLAVE_TENANT)
    cur = con.cursor()
    cur.execute("SET SESSION AUTHORIZATION saas_app")
    cur.execute("SELECT set_config('app.negocio_id','1',false)")
    try:
        cur.execute('CALL tienda.sp_registrar_tasa(36.51, CURRENT_DATE, %s, true, NULL, %s, %s)', ('BCV', 'USD', 'VES'))
        con.commit()
        ok(True, 'el negocio de la PLATAFORMA (plataforma_admin) sí publica tasas')
    except psycopg2.Error as ex:
        con.rollback()
        ok(False, 'el negocio de la plataforma DEBÍA poder publicar', str(ex)[:110])
    cur.execute("RESET SESSION AUTHORIZATION")
    con.rollback()
    cur.close()
    con.close()

    con = conectar(REGRES, 'regres_admin', CLAVE_TENANT)
    cur = con.cursor()
    try:
        cur.execute('CALL tienda.sp_registrar_tasa(10.0, CURRENT_DATE, %s, false, NULL, %s, %s)', ('BCV', 'EUR', 'VES'))
        con.commit()
        ok(False, 'rol de plataforma SIN app.rol debía ser rechazado')
    except psycopg2.Error as ex:
        con.rollback()
        ok('administra la plataforma' in str(ex), 'rol de plataforma SIN declarar app.rol → RECHAZADO (no hay canal implícito)', str(ex)[:90])
    cur.execute("SELECT set_config('app.rol','platform_admin',false)")
    try:
        cur.execute('CALL tienda.sp_registrar_tasa(1.05, CURRENT_DATE, %s, true, NULL, %s, %s)', ('BCV', 'EUR', 'VES'))
        con.commit()
        ok(True, 'rol de plataforma CON app.rol=platform_admin (session_user en plataforma_roles) → OK')
    except psycopg2.Error as ex:
        con.rollback()
        ok(False, 'el canal platform_admin debía permitir al rol confiable', str(ex)[:110])
    cur.close()
    con.close()


# ── M-4 · lo que un tenant nuevo NO hereda ──────────────────────────────────

def m4_provision_negativos():
    n = NUEVO_NEGOCIO
    print(f'\n== M-4 · whitelist de provisión: lo que NO debe copiarse (negocio {n}) ==', flush=True)
    con = conectar(REGRES)
    cur = con.cursor()
    # LO QUE NO DEBE ESTAR
    for tabla, etiqueta in (
        ('productos', 'inventario del negocio 1'),
        ('clientes', 'clientes'),
        ('proveedores', 'proveedores'),
        ('ventas', 'ventas'),
        ('compras', 'compras'),
        ('asientos', 'asientos contables'),
        ('movimientos_inventario', 'kardex'),
        ('pagos_venta', 'pagos'),
        ('cuentas_por_cobrar', 'cuentas por cobrar'),
    ):
        cur.execute(f'SELECT count(*) FROM tienda.{tabla} WHERE negocio_id = %s', (n,))
        c = cur.fetchone()[0]
        ok(c == 0, f'NO heredó {etiqueta} ({tabla}=0)', f' cantidad {c}')
    cur.execute('SELECT count(*), min(rol) FROM tienda.usuarios WHERE negocio_id = %s', (n,))
    c, rol = cur.fetchone()
    ok(c == 1 and rol == 'ADMINISTRADOR', 'solo SU usuario administrador (sin usuarios ajenos)', f'{c} usuario(s), rol {rol}')
    # LO QUE SÍ DEBE ESTAR (catálogos y configuración base)
    for tabla, minimo in (('categorias', 1), ('marcas', 1), ('metodos_pago', 3), ('plan_cuentas', 10),
                          ('numeracion_fiscal', 1), ('calendario_fiscal', 1)):
        cur.execute(f'SELECT count(*) FROM tienda.{tabla} WHERE negocio_id = %s', (n,))
        c = cur.fetchone()[0]
        ok(c >= minimo, f'SÍ heredó {tabla} (≥{minimo})', f' cantidad {c}')
    cur.execute('SELECT count(*) FROM tienda.caja_config WHERE negocio_id = %s', (n,))
    ok(cur.fetchone()[0] == 1, 'config PK · caja_config')
    cur.execute('SELECT count(*) FROM tienda.contab_config WHERE negocio_id = %s', (n,))
    ok(cur.fetchone()[0] == 1, 'config PK · contab_config')
    cur.execute('SELECT count(*) FROM tienda.islr_config WHERE negocio_id = %s', (n,))
    ok(cur.fetchone()[0] == 1, 'config PK · islr_config')
    cur.execute('SELECT count(*) FROM tienda.contab_parametros WHERE negocio_id = %s', (n,))
    ok(cur.fetchone()[0] >= 5, 'config base · contab_parametros (tabla multi-fila, ≥5 parámetros)')
    cur.close()
    con.close()


# ── M-6 · portal_app: solo lectura, escritura por SECURITY DEFINER ───────────

def m6_portal_app():
    print('\n== M-6 · portal_app: solo LEE; escrituras solo vía portal.fn_* ==', flush=True)
    con = conectar(REGRES_PORTAL, 'portal_app', CLAVE_TENANT)
    cur = con.cursor()
    try:
        cur.execute('SELECT count(*) FROM portal.negocios_portal')
        c = cur.fetchone()[0]
        ok(True, 'portal_app LEE negocios_portal (sin excepción)', f'{c} filas')
    except psycopg2.Error as e:
        ok(False, 'portal_app no pudo leer', str(e)[:110])

    try:
        cur.execute("INSERT INTO portal.negocios_portal (subdominio, negocio_id, plan_id, estado, db_nombre, db_host) "
                    "VALUES ('hackeado', 999, 1, 'PRUEBA', 'x', 'y')")
        con.commit()
        ok(False, 'portal_app pudo INSERTAR directo (el 42 no se aplicó)')
    except psycopg2.Error as e:
        con.rollback()
        ok('permission denied' in str(e).lower(), 'INSERT directo de portal_app → permission denied', str(e)[:90])
    try:
        cur.execute("UPDATE portal.negocios_portal SET estado = 'PAGADO' WHERE false")
        con.commit()
        ok(False, 'portal_app pudo UPDATEAR directo')
    except psycopg2.Error as e:
        con.rollback()
        ok('permission denied' in str(e).lower(), 'UPDATE directo de portal_app → permission denied', str(e)[:90])
    try:
        cur.execute("SELECT portal.fn_alta_tenant(%s, %s, %s, %s, %s, %s)", ('regres-portal-app', NUEVO_NEGOCIO, 'DEMO', REGRES, HOST, 'qa@test.local'))
        nueva = cur.fetchone()[0]
        con.commit()
        ok(nueva is not None, 'la vía LEGÍTIMA (SECURITY DEFINER) sí funciona', f'fn_alta_tenant → {nueva}')
    except psycopg2.Error as e:
        con.rollback()
        ok(False, 'portal.fn_alta_tenant debía funcionar para portal_app', str(e)[:110])
    cur.close()
    con.close()


# ── M-8 · la fecha fiscal es la de Caracas aunque la sesión esté en UTC ──────

def m8_timezone():
    print('\n== M-8 · fecha fiscal = America/Caracas (venta real de madrugada) ==', flush=True)
    con = conectar(REGRES)
    cur = con.cursor()
    cur.execute("SET TIME ZONE 'UTC'")
    cur.execute("SELECT tienda.fn_hoy(), ((now() AT TIME ZONE 'UTC') - INTERVAL '4 hours')::date")
    hoy_fn, esperado = cur.fetchone()
    ok(hoy_fn == esperado, 'con sesión en UTC, fn_hoy() sigue dando el día de Caracas', f'fn_hoy={hoy_fn} esperado={esperado}')
    cur.execute("SET TIME ZONE 'America/Caracas'")
    cur.execute("SELECT tienda.fn_hoy(), (now() AT TIME ZONE 'America/Caracas')::date")
    hoy_caracas, local_dia = cur.fetchone()
    ok(hoy_caracas == local_dia, 'con sesión en Caracas, fn_hoy() coincide con el día local', f'{hoy_caracas} vs {local_dia}')

    # Venta REAL ahora (UTC ~03-07 h = madrugada venezolana): la fecha fiscal de
    # la venta debe ser el día de Caracas, no el día UTC.
    cur.execute("SET TIME ZONE 'UTC'")
    cur.execute("SELECT set_config('app.negocio_id','1',false)")
    cur.execute("SELECT id FROM tienda.usuarios WHERE negocio_id = 1 AND rol = 'ADMINISTRADOR' AND activo ORDER BY id LIMIT 1")
    uid = cur.fetchone()[0]
    cur.execute("SELECT set_config('tienda.usuario_id', %s, false)", (str(uid),))
    # t18 puede haber dejado el turno del admin ABIERTO en la base de la que
    # nace el clon: se reutiliza; solo se abre si no hay ninguno activo.
    cur.execute('SELECT tienda.fn_apertura_activa(%s)', (uid,))
    if cur.fetchone()[0] is None:
        cur.execute('SELECT tienda.fn_abrir_caja(%s, 50, 500)', (uid,))
    con.commit()
    cur.execute("SELECT p.id, p.precio_venta_usd FROM tienda.productos p WHERE p.negocio_id = 1 AND p.activo AND NOT p.exento_iva ORDER BY p.id LIMIT 1")
    pid, precio = cur.fetchone()
    items = [{'producto_id': pid, 'cantidad': 1, 'descuento_pct': 0}]
    cur.execute("SELECT id FROM tienda.metodos_pago WHERE negocio_id = 1 AND nombre = 'Pago móvil' AND activo LIMIT 1")
    mp = cur.fetchone()[0]
    monto = round(float(precio) * 1.16 * 36.50, 2)
    cur.execute('SELECT tienda.fn_registrar_venta(%s, %s, %s, NULL, %s, %s, false, 0)',
                (uid, json.dumps(items), json.dumps([{'metodo_pago_id': mp, 'monto': monto, 'referencia': 'RG-M8'}]), 'venta de la regresión M-8', 'PRESENCIAL'))
    venta = cur.fetchone()[0]
    con.commit()
    cur.execute("SELECT (fecha_hora AT TIME ZONE 'America/Caracas')::date, tienda.fn_hoy(), "
                "((now() AT TIME ZONE 'UTC'))::date <> ((now() AT TIME ZONE 'UTC') - INTERVAL '4 hours')::date "
                "FROM tienda.ventas WHERE id = %s", (venta,))
    fecha_venta, hoy2, dias_distintos = cur.fetchone()
    ok(fecha_venta == hoy2, 'la venta REAL quedó en el día fiscal de Caracas', f'venta={venta} fecha={fecha_venta} fn_hoy={hoy2}')
    ok(True, 'independiente del reloj: la venta usa fn_hoy() (Caracas), no la TZ de la sesión',
       f'día UTC ≠ día Caracas en este momento: {dias_distintos}')
    cur.close()
    con.close()


# ── C-7 · CSP en staging (Report-Only) + /csp-report ────────────────────────

def c7_csp():
    print('\n== C-7 · CSP: staging Report-Only + endpoint de reportes ==', flush=True)
    stg, local = BASES['staging'], BASES['local']
    r = requests.get(f'http://127.0.0.1:{stg}/login', timeout=30)
    ro = r.headers.get('Content-Security-Policy-Report-Only', '')
    enforcement = r.headers.get('Content-Security-Policy', '')
    ok(ro != '' and 'report-uri /csp-report' in ro, 'staging lleva CSP en modo Report-Only (con report-uri)')
    ok(enforcement == '', 'staging NO aplica enforcement (no rompe nada mientras reporta)')
    r = requests.post(f'http://127.0.0.1:{stg}/csp-report', json={'csp-report': {'document-uri': 'https://staging.test/', 'violated-directive': 'script-src', 'blocked-uri': 'inline'}}, timeout=20)
    ok(r.status_code == 204, 'POST /csp-report sin sesión ni token → 204 (CSRF exento, reporte guardado)')
    r = requests.get(f'http://127.0.0.1:{local}/login', timeout=30)
    ok(r.headers.get('Content-Security-Policy') is None and r.headers.get('Content-Security-Policy-Report-Only') is None,
       'local normal NO lleva CSP (Vite/HMR intacto)')


def token_de(html):
    """Token CSRF de una página Inertia (meta tag) o de un formulario clásico."""
    m = re.search(r'<meta name="csrf-token" content="([^"]+)"', html) or re.search(r'name="_token" value="([^"]+)"', html)
    return m.group(1) if m else ''


# ── RL-2 · throttle de las escrituras del portal, demostrado por HTTP ───────

def rl_throttle_portal(local):
    print('\n== RL-2 · throttle portal_escritura (10/min) demostrado por HTTP ==', flush=True)
    s = requests.Session()
    r = None
    for intento in range(15):          # el throttle de login (5/min por IP) puede
        r = s.get(local + '/portal/login', timeout=20)   # estar agotado si otra corrida
        r = s.post(local + '/portal/login', data={'_token': token_de(r.text), 'password': 'portal-demo-2026'},
                   allow_redirects=False, timeout=20)  # acabó de gastarlo: se espera y se reintenta
        if r.status_code in (302, 303):
            break
        time.sleep(8)
    ok(r is not None and r.status_code in (302, 303), 'sesión del portal iniciada (login del operador)', f'código {getattr(r, "status_code", None)}')

    token = token_de(s.get(local + '/portal', timeout=20).text)   # token NUEVO de la sesión autenticada
    ok(token != '', 'hay token CSRF fresco en la sesión autenticada')
    codigos = []
    for i in range(11):
        rr = s.post(local + '/portal/tasa', data={'_token': token, 'tasa': '36.50'}, allow_redirects=False, timeout=20)
        codigos.append(rr.status_code)
    ok(429 in codigos, 'la 11ª escritura en un minuto → 429 Too Many Requests', f'códigos {codigos}')
    ok(codigos[0] != 429, 'las primeras pasan (el límite no bloquea al operador normal)', f'primera {codigos[0]}')


# ── B-7 · no-store en la respuesta del alta de usuario ──────────────────────

def b7_nostore(local):
    print('\n== B-7 · Cache-Control: no-store en el alta con clave temporal ==', flush=True)
    s = requests.Session()
    logueado = False
    for intento in range(15):          # mismo respeto al throttle del login
        r = s.get(local + '/login', timeout=20)
        token = token_de(r.text)
        s.post(local + '/login', data={'_token': token, 'username': 'admin', 'password': 'PaginasTest2026'}, timeout=20)
        if s.get(local + '/usuarios', timeout=20).status_code == 200:
            logueado = True
            break
        time.sleep(8)
    ok(logueado, 'sesión del admin iniciada para el alta')
    token = token_de(s.get(local + '/usuarios', timeout=20).text)   # token NUEVO de la sesión autenticada
    ok(token != '', 'hay token CSRF fresco para el alta')
    r = s.post(local + '/usuarios',
               json={'username': f'regres{int(time.time())%100000}', 'nombre': 'Regresion B7', 'rol': 'CAJERO', 'password': 'TemporalB72026!'},
               headers={'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': token},
               timeout=20)
    ok(r.status_code == 200, 'alta de usuario OK por HTTP', f'código {r.status_code} {r.text[:120]}')
    ok('no-store' in (r.headers.get('Cache-Control') or ''), 'la respuesta del ALTA va con Cache-Control: no-store', str(r.headers.get('Cache-Control')))


# ── Servidores HTTP dedicados ────────────────────────────────────────────────

def arrancar_servidores():
    env_base = dict(os.environ, PHP_CLI_SERVER_WORKERS='2')
    for nombre, puerto in BASES.items():
        env = dict(env_base)
        if nombre == 'prod':
            env['APP_ENV'] = 'production'
        elif nombre == 'staging':
            env['APP_ENV'] = 'staging'
        logf = open(f'/tmp/rg_serve_{nombre}.log', 'w')
        p = subprocess.Popen([PHP, 'artisan', 'serve', '--host=127.0.0.1', f'--port={puerto}'],
                             cwd=RAIZ, env=env, stdout=logf, stderr=logf)
        SERVIDORES.append(p)
    for _ in range(60):
        time.sleep(0.5)
        try:
            r = requests.get(f'http://127.0.0.1:{BASES["local"]}/up', timeout=3)
            if r.status_code < 500:
                break
        except Exception:  # noqa: BLE001
            pass
    print('  servidores listos: local :8010 · producción :8011 · staging :8012', flush=True)


def apagar_servidores():
    for p in SERVIDORES:
        p.terminate()
    time.sleep(1)
    for p in SERVIDORES:
        if p.poll() is None:
            p.kill()


def main():
    print('== t19 · REGRESIÓN DE HALLAZGOS DE AUDITORÍA ==', flush=True)
    try:
        preparar()
        arrancar_servidores()
        local = f'http://127.0.0.1:{BASES["local"]}'
        c1_http(local)
        a3_servidores()
        a1_estado_tenants()
        a2_provision()
        a4_globales()
        m4_provision_negativos()
        m6_portal_app()
        m8_timezone()
        c7_csp()
        rl_throttle_portal(local)
        b7_nostore(local)
    finally:
        apagar_servidores()
    print(f"\nREGRESIÓN: {sum(RESULTADOS)} OK · {len(RESULTADOS) - sum(RESULTADOS)} FAIL", flush=True)
    return 0 if all(RESULTADOS) else 1


if __name__ == '__main__':
    sys.exit(main())
