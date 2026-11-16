#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""t19 · REGRESIÓN DE HALLAZGOS DE SEGURIDAD PARA TIENDA ÚNICA.

Verifica sobre un clon dedicado (tienda_regres, desde PGTEMPLATE=tiendaunica):
  · M-8  · Fecha fiscal = America/Caracas aunque la sesión esté en UTC.
  · C-7  · CSP Report-Only en staging + POST /csp-report → 204 (sin CSP en local).
  · B-7  · Cache-Control: no-store en la respuesta del alta de usuario.
  · H-1  · /health/db responde 200 con diagnóstico db=ok.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import psycopg2
import requests

RAIZ = Path(__file__).resolve().parents[2]
PGHOST = os.environ.get('PGHOST_PRUEBAS', os.environ.get('PGHOST', '127.0.0.1'))
PGPORT = int(os.environ.get('PGPORT_PRUEBAS', os.environ.get('PGPORT', '5433')))
PGUSER = os.environ.get('PGUSER_PRUEBAS', os.environ.get('PGUSER', 'postgres'))
PGTEMPLATE = os.environ.get('PGTEMPLATE', 'tiendaunica')
REGRES = 'tienda_regres'
PHP = os.environ.get('PHP') or shutil.which('php') or 'php'

BASES = {'local': 8010, 'staging': 8012}
SERVIDORES = []
RESULTADOS = []


def ok(cond, nombre, detalle=''):
    RESULTADOS.append(bool(cond))
    print(f"  {'OK  ' if cond else 'FAIL'} {nombre}" + (f'  [{detalle}]' if detalle else ''), flush=True)
    return bool(cond)


def conectar(db=REGRES):
    return psycopg2.connect(host=PGHOST, port=PGPORT, dbname=db, user=PGUSER,
                            options='-c search_path=tienda,public')


def preparar():
    print(f'== preparación · clon dedicado ({REGRES} desde {PGTEMPLATE}) ==', flush=True)
    con = conectar('postgres')
    con.autocommit = True
    cur = con.cursor()
    cur.execute('SELECT 1 FROM pg_database WHERE datname = %s', (REGRES,))
    if cur.fetchone():
        cur.execute(f'DROP DATABASE {REGRES}')
    cur.execute(f'CREATE DATABASE {REGRES} TEMPLATE {PGTEMPLATE}')
    cur.close()
    con.close()
    ok(True, f'clon {REGRES} creado desde {PGTEMPLATE}')


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

    cur.execute("SET TIME ZONE 'UTC'")
    cur.execute("SELECT id FROM tienda.usuarios WHERE negocio_id = 1 AND rol = 'ADMINISTRADOR' AND activo ORDER BY id LIMIT 1")
    uid = cur.fetchone()[0]
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
                (uid, json.dumps(items), json.dumps([{'metodo_pago_id': mp, 'monto': monto, 'referencia': 'RG-M8'}]),
                 'venta de la regresión M-8', 'PRESENCIAL'))
    venta = cur.fetchone()[0]
    con.commit()
    cur.execute("SELECT (fecha_hora AT TIME ZONE 'America/Caracas')::date, tienda.fn_hoy() FROM tienda.ventas WHERE id = %s", (venta,))
    fecha_venta, hoy2 = cur.fetchone()
    ok(fecha_venta == hoy2, 'la venta REAL quedó en el día fiscal de Caracas', f'venta={venta} fecha={fecha_venta} fn_hoy={hoy2}')
    cur.close()
    con.close()


def token_de(html):
    m = re.search(r'<meta name="csrf-token" content="([^"]+)"', html) or re.search(r'name="_token" value="([^"]+)"', html)
    return m.group(1) if m else ''


def health_check(local):
    print('\n== H-1 · /health/db responde diagnóstico ==', flush=True)
    r = requests.get(f'{local}/health/db', timeout=20)
    ok(r.status_code == 200 and r.json().get('db') == 'ok', '/health/db responde 200 con db=ok', str(r.json())[:80])


def c7_csp():
    print('\n== C-7 · CSP: staging Report-Only + endpoint de reportes ==', flush=True)
    stg, local = BASES['staging'], BASES['local']
    r = requests.get(f'http://127.0.0.1:{stg}/login', timeout=30)
    ro = r.headers.get('Content-Security-Policy-Report-Only', '')
    enforcement = r.headers.get('Content-Security-Policy', '')
    ok(ro != '' and 'report-uri /csp-report' in ro, 'staging lleva CSP en modo Report-Only (con report-uri)')
    ok(enforcement == '', 'staging NO aplica enforcement (no rompe nada mientras reporta)')
    r = requests.post(f'http://127.0.0.1:{stg}/csp-report',
                      json={'csp-report': {'document-uri': 'https://staging.test/', 'violated-directive': 'script-src', 'blocked-uri': 'inline'}},
                      timeout=20)
    ok(r.status_code == 204, 'POST /csp-report sin sesión ni token → 204 (CSRF exento, reporte guardado)')
    r = requests.get(f'http://127.0.0.1:{local}/login', timeout=30)
    ok(r.headers.get('Content-Security-Policy') is None and r.headers.get('Content-Security-Policy-Report-Only') is None,
       'local normal NO lleva CSP (Vite/HMR intacto)')


def b7_nostore(local):
    print('\n== B-7 · Cache-Control: no-store en el alta con clave temporal ==', flush=True)
    s = requests.Session()
    logueado = False
    for _ in range(15):
        r = s.get(local + '/login', timeout=20)
        token = token_de(r.text)
        s.post(local + '/login', data={'_token': token, 'username': 'admin', 'password': 'PaginasTest2026'}, timeout=20)
        if s.get(local + '/usuarios', timeout=20).status_code == 200:
            logueado = True
            break
        time.sleep(8)
    ok(logueado, 'sesión del admin iniciada para el alta')
    token = token_de(s.get(local + '/usuarios', timeout=20).text)
    ok(token != '', 'hay token CSRF fresco para el alta')
    r = s.post(local + '/usuarios',
               json={'username': f'regres{int(time.time()) % 100000}', 'nombre': 'Regresion B7', 'rol': 'CAJERO', 'password': 'TemporalB72026!'},
               headers={'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': token},
               timeout=20)
    ok(r.status_code == 200, 'alta de usuario OK por HTTP', f'código {r.status_code} {r.text[:120]}')
    ok('no-store' in (r.headers.get('Cache-Control') or ''), 'la respuesta del ALTA va con Cache-Control: no-store', str(r.headers.get('Cache-Control')))


def arrancar_servidores():
    tmp = tempfile.gettempdir()
    env_base = dict(os.environ, DB_DATABASE=REGRES)
    for nombre, puerto in BASES.items():
        env = dict(env_base)
        if nombre == 'staging':
            env['APP_ENV'] = 'staging'
        logf = open(os.path.join(tmp, f'rg_serve_{nombre}.log'), 'w', encoding='utf-8')
        p = subprocess.Popen([PHP, 'artisan', 'serve', '--host=127.0.0.1', f'--port={puerto}'],
                             cwd=RAIZ, env=env, stdout=logf, stderr=logf)
        SERVIDORES.append(p)
    for _ in range(60):
        time.sleep(0.5)
        try:
            r = requests.get(f'http://127.0.0.1:{BASES["local"]}/up', timeout=3)
            r2 = requests.get(f'http://127.0.0.1:{BASES["staging"]}/up', timeout=3)
            if r.status_code < 500 and r2.status_code < 500:
                break
        except Exception:  # noqa: BLE001
            pass
    print('  servidores listos: local :8010 · staging :8012', flush=True)


def apagar_servidores():
    for p in SERVIDORES:
        p.terminate()
    time.sleep(1)
    for p in SERVIDORES:
        if p.poll() is None:
            p.kill()


def main():
    print('== t19 · REGRESIÓN DE HALLAZGOS (TIENDA ÚNICA) ==', flush=True)
    try:
        preparar()
        arrancar_servidores()
        local = f'http://127.0.0.1:{BASES["local"]}'
        health_check(local)
        m8_timezone()
        c7_csp()
        b7_nostore(local)
    finally:
        apagar_servidores()
    print(f"\nREGRESIÓN: {sum(RESULTADOS)} OK · {len(RESULTADOS) - sum(RESULTADOS)} FAIL", flush=True)
    return 0 if all(RESULTADOS) else 1


if __name__ == '__main__':
    sys.exit(main())
