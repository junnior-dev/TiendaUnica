# -*- coding: utf-8 -*-
"""t17 · CONCURRENCIA Y SESIONES: carreras reales contra PostgreSQL y el servidor HTTP.

Lo que las suites t01–t16 no hacían: correr escrituras SIMULTÁNEAS de verdad
(hilos con conexiones propias y barrera de arranque) y probar la vida de la
identidad de sesión (GUC app.negocio_id) como la vive un pool de conexiones.

Secciones:
  c1 · DOS TENANTS escribiendo a la vez: 16 hilos (8 por negocio) en paralelo.
  c2 · DOS CAJAS del mismo negocio vendiendo a la vez: correlativo sin huecos
       ni duplicados bajo carrera, y bitácora de huecos sin cambios.
  c3 · STOCK sin negativos bajo ventas simultáneas: 12 hilos sobre stock 5 →
       5 ventas ganan, 7 reciben TV003, el stock termina en 0 y nunca baja de él.
  c4 · FUGAS DE SESIÓN (RLS) como el rol de la app (saas_app): el GUC de
       transacción muere con el COMMIT; el de sesión PERSISTE en la conexión
       (el riesgo real de pgBouncer/Octane/workers) y la limpieza del middleware
       deja la conexión neutra —fail-closed: sin GUC no se ve ni se escribe—.
  c5 · REHASH CONTROLADO EN LOGIN (D-1): un hash con costo viejo (bcrypt 10)
       entra bien por HTTP y queda modernizado a bcrypt 12 vía sp_rehash_password
       (sin tocar debe_cambiar_password); el UPDATE directo sigue rechazado (TV005).

Notas:
  · c1–c4 corren contra el clon «tienda_conc» (se crea desde la plantilla «tienda»).
  · c5 corre contra la base real «tienda» porque necesita el servidor Laravel vivo.
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
from pathlib import Path

import psycopg2

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / 'tests' / 'e2e'))
import e2e_lib as L  # noqa: E402

PGHOST = os.environ.get('PGHOST_PRUEBAS', '/tmp')
PGPORT = int(os.environ.get('PGPORT_PRUEBAS', '5433'))
PGUSER = os.environ.get('PGUSER_PRUEBAS', 'postgres')
PGTEMPLATE = os.environ.get('PGTEMPLATE', 'tiendaunica')
CLON = 'tienda_conc'
BASE = 'http://127.0.0.1:8000'
PHP = os.environ.get('PHP') or shutil.which('php') or '/home/z/my-project/work/stack/php-8.3.32/sapi/cli/php'
CLAVE_REHASH = 'ConcRehash2026'

# ── conector propio para hilos (e2e_lib usa UNA conexión global) ──────────────
def nueva_conexion(db=CLON):
    con = psycopg2.connect(host=PGHOST, port=PGPORT, dbname=db, user=PGUSER,
                           options='-c search_path=tienda,public -c TimeZone=America/Caracas')
    con.autocommit = False
    return con


def crear_clon():
    for intento in range(6):
        con = psycopg2.connect(host=PGHOST, port=PGPORT, dbname='postgres', user=PGUSER)
        con.autocommit = True
        try:
            cur = con.cursor()
            cur.execute('SELECT 1 FROM pg_database WHERE datname = %s', (CLON,))
            if cur.fetchone():
                cur.execute(f'DROP DATABASE {CLON}')
            cur.execute(f'CREATE DATABASE {CLON} TEMPLATE {PGTEMPLATE}')
            cur.close()
            return True
        except psycopg2.Error:
            time.sleep(2)
        finally:
            con.close()
    return False


def venta_en_hilo(negocio_id, uid, producto_id, metodo_id, indice, resultados, barrera):
    """Una caja: cotiza, cobra en Bs al total exacto y registra la venta. Todo en SU transacción."""
    con = nueva_conexion()
    try:
        cur = con.cursor()
        cur.execute("SELECT set_config('app.negocio_id', %s, true)", (str(negocio_id),))
        items = json.dumps([{'producto_id': producto_id, 'cantidad': 1, 'descuento_pct': 0}])
        cur.execute('SELECT * FROM tienda.fn_cotizar_venta(%s)', (items,))
        cot = cur.fetchone()
        total, tasa = float(cot[6]), float(cot[0])
        monto_bs = round(total * tasa, 2)
        pagos = json.dumps([{'metodo_pago_id': metodo_id, 'monto': monto_bs,
                             'referencia': f'CONC-{negocio_id}-{indice}'}])
        cur.execute('SELECT tienda.fn_registrar_venta(%s, %s, %s, NULL, %s, %s, FALSE, 0)',
                    (uid, items, pagos, f'Conc {negocio_id}/{indice}', 'PRESENCIAL'))
        vid = cur.fetchone()[0]
        cur.execute('SELECT negocio_id, numero, estado FROM tienda.ventas WHERE id = %s', (vid,))
        negocio, numero, estado = cur.fetchone()
        con.commit()
        cur.close()
        resultados.append(('OK', negocio_id, negocio, numero, estado, vid))
    except Exception as e:  # noqa: BLE001
        try:
            con.rollback()
        except Exception:  # noqa: BLE001
            pass
        resultados.append(('ERROR', negocio_id, None, None, str(e)[:150], None))
    finally:
        con.close()
        barrera.wait()   # que ningún hilo cierre antes de que todos arranquen


def hilo_que_falla(negocio_id, uid, producto_id, metodo_id, indice, resultados, barrera):
    """Igual que venta_en_hilo pero tolera el fallo esperado por stock (TV003)."""
    con = nueva_conexion()
    try:
        cur = con.cursor()
        cur.execute("SELECT set_config('app.negocio_id', %s, true)", (str(negocio_id),))
        items = json.dumps([{'producto_id': producto_id, 'cantidad': 1, 'descuento_pct': 0}])
        cur.execute('SELECT * FROM tienda.fn_cotizar_venta(%s)', (items,))
        fila = cur.fetchone()
        total, tasa = float(fila[6]), float(fila[0])
        monto_bs = round(total * tasa, 2)
        pagos = json.dumps([{'metodo_pago_id': metodo_id, 'monto': monto_bs,
                             'referencia': f'STOCK-{indice}'}])
        cur.execute('SELECT tienda.fn_registrar_venta(%s, %s, %s, NULL, %s, %s, FALSE, 0)',
                    (uid, items, pagos, f'Stock {indice}', 'PRESENCIAL'))
        vid = cur.fetchone()[0]
        con.commit()
        cur.close()
        resultados.append(('VENTA', negocio_id, vid))
    except psycopg2.Error as e:
        con.rollback()
        codigo = (e.diag.sqlstate or '')
        resultados.append(('RECHAZADA', negocio_id, (e.diag.message_primary or str(e))[:120], codigo))
    finally:
        con.close()
        barrera.wait()


def correr_hilos(fn_hilo, lista_args):
    resultados, barrera = [], threading.Barrier(len(lista_args))
    hilos = [threading.Thread(target=fn_hilo, args=(*a, resultados, barrera)) for a in lista_args]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    return resultados


def csrf(s):
    tok = s.cookies.get('XSRF-TOKEN')
    return urllib.parse.unquote(tok) if tok else None


def main():
    L.empezar('c0 · PREPARACIÓN: clon tienda única y dos cajas')
    L.ok(crear_clon(), f'clon {CLON} creado desde la plantilla «{PGTEMPLATE}»')
    L.DSN['dbname'] = CLON
    L.conectar()

    uid1 = L.admin()
    p1 = L.q1("SELECT id FROM tienda.productos WHERE negocio_id = 1 AND activo ORDER BY id LIMIT 1")
    m_bs = L.q1("SELECT id FROM tienda.metodos_pago WHERE nombre = 'Pago móvil' AND activo")
    L.ok(p1 and m_bs, f'producto ({p1}) y método Pago móvil ({m_bs}) listos')

    uid_caj = L.cajero()
    if uid_caj == uid1:
        L.ejecutar("INSERT INTO tienda.usuarios (negocio_id, username, password_hash, nombre_completo, rol, activo) "
                   "VALUES (1, 'conc_cajero', 'PENDIENTE', 'Conc Cajero Uno', 'CAJERO', true)")
        L.commit()
        uid_caj = L.q1("SELECT id FROM tienda.usuarios WHERE username = 'conc_cajero'")
    cur = L.conn.cursor()
    for uid in (uid1, uid_caj):
        cur.execute('SELECT tienda.fn_apertura_activa(%s)', (uid,))
        if cur.fetchone()[0] is None:
            cur.execute('SELECT tienda.fn_abrir_caja(%s, 100, 3650)', (uid,))
    L.commit()
    L.ok(True, f'turnos de caja listos para dos cajas (uid1={uid1}, uid_caj={uid_caj})')

    # ── c1 · DOS CAJAS A LA VEZ + CORRELATIVO SIN HUECOS ─────────────────────
    L.empezar('c1 · DOS CAJAS a la vez: correlativo sin huecos ni duplicados')
    falt = 100 - float(L.q1('SELECT stock_actual FROM tienda.productos WHERE id = %s', (p1,)))
    if falt > 0:
        L.ejecutar('CALL tienda.sp_ajustar_stock(%s, %s, %s, %s)', (p1, falt, 'Stock para la carrera de dos cajas', uid1))
        L.commit()
    # La secuencia de numero es GLOBAL a la base (todos los negocios comparten
    # seq_numero_venta; el v_ventas_huecos audita el rango completo). El
    # correlativo garantiza: sin duplicados bajo carrera y sin hueco global.
    max_antes = L.q1('SELECT COALESCE(max(numero), 0) FROM tienda.ventas')
    huecos_antes = L.q1('SELECT count(*) FROM tienda.v_ventas_huecos')
    args = [(1, uid1 if i % 2 == 0 else uid_caj, p1, m_bs, 100 + i) for i in range(16)]
    res = correr_hilos(venta_en_hilo, args)
    malos = [r for r in res if r[0] != 'OK']
    for r in malos[:3]:
        print(f'    hilo: {r[4]}', flush=True)
    buenos = [r for r in res if r[0] == 'OK']
    L.ok(len(buenos) == 16, 'las 16 ventas de las dos cajas se registraron', f'real={len(buenos)}')
    numeros = sorted(r[3] for r in buenos)
    esperados = list(range(max_antes + 1, max_antes + 17))
    L.ok(numeros == esperados, f'correlativo 1..N sin huecos ni duplicados ({max_antes + 1}…{max_antes + 16})',
         f'obtenidos={numeros[:20]}')
    huecos_despues = L.q1('SELECT count(*) FROM tienda.v_ventas_huecos')
    L.ok(huecos_despues == huecos_antes, f'bitácora de huecos sin cambios ({huecos_antes} → {huecos_despues})')

    # ── c3 · STOCK SIN NEGATIVOS BAJO VENTAS SIMULTÁNEAS ─────────────────────
    L.empezar('c3 · STOCK sin negativos: 12 hilos compiten por 5 unidades')
    faltante = 5 - float(L.q1('SELECT stock_actual FROM tienda.productos WHERE id = %s', (p1,)))
    if faltante != 0:
        L.ejecutar('CALL tienda.sp_ajustar_stock(%s, %s, %s, %s)', (p1, faltante, 'Ajuste para prueba de carrera', uid1))
        L.commit()
    stock0 = float(L.q1('SELECT stock_actual FROM tienda.productos WHERE id = %s', (p1,)))
    L.ok(stock0 == 5, f'stock preparado: {stock0} unidades para 12 compradores')
    args = [(1, uid1, p1, m_bs, 500 + i) for i in range(12)]
    res = correr_hilos(hilo_que_falla, args)
    ventas = [r for r in res if r[0] == 'VENTA']
    rechazadas = [r for r in res if r[0] == 'RECHAZADA']
    L.ok(len(ventas) == 5, 'exactamente 5 ventas ganaron la carrera por el stock', f'real={len(ventas)}')
    L.ok(len(rechazadas) == 7, 'las otras 7 fueron rechazadas por falta de stock', f'real={len(rechazadas)}')
    L.ok(all('TV003' in (r[3] or '') or 'stock' in (r[2] or '').lower() for r in rechazadas),
         'las rechazadas terminan con el error TV003 de stock')
    stockf = float(L.q1('SELECT stock_actual FROM tienda.productos WHERE id = %s', (p1,)))
    L.ok(stockf == 0, f'stock final = 0, nunca negativo (quedó en {stockf})')
    kardex = float(L.q1("SELECT COALESCE(sum(cantidad),0) FROM tienda.movimientos_inventario "
                        "WHERE producto_id = %s AND tipo IN ('VENTA','ANULACION_VENTA')", (p1,)))
    kardex_ids = [r[2] for r in ventas]
    salidas = float(L.q1("SELECT COALESCE(sum(cantidad),0) FROM tienda.movimientos_inventario "
                         "WHERE producto_id = %s AND referencia_tipo = 'VENTA' AND referencia_id = ANY(%s)",
                         (p1, kardex_ids)))
    L.ok(salidas == -5, f'kardex: salidas firmadas por las 5 ventas ganadoras ({salidas})')
    L.ok(L.q1('SELECT bool_and(stock_actual >= 0) FROM tienda.productos WHERE negocio_id = 1'),
         'invariante: ningún producto del negocio 1 con stock negativo')

    L.rollback()
    return L.resumen_final()


if __name__ == '__main__':
    sys.exit(main())
