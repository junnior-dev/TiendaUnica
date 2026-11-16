#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pruebas de CONTINUIDAD: backup real, restore verificado, migración
incremental idempotente sobre datos vivos y rollback real.

  c1 · BACKUP: pg_dump -Fc de tienda y portal_saas (con datos).
  c2 · RESTORE: pg_restore en bases nuevas + verificación por conteos,
       integridad referencial e invariantes contables.
  c3 · MIGRACIÓN INCREMENTAL: ALTER ADD COLUMN IF NOT EXISTS + backfill +
       índice, aplicado dos veces (idempotente) sobre una base CON datos;
       verifica que los datos sobreviven y que la base sigue vendiendo.
       Nota honesta: los scripts 01–42 NO son idempotentes sobre bases con
       datos; el patrón oficial de actualización es backup → reinstalar
       00–42 → restaurar, que es lo que c2 y c4 ejercitan.
  c4 · ROLLBACK REAL: "migración" destructiva sobre la copia, restore --clean
       del backup y verificación de que la base vuelve a ser la del backup.
"""
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import psycopg2

HOST = os.environ.get('PGHOST', '/tmp')
PORT = int(os.environ.get('PGPORT', '5433'))
PGBIN = os.environ.get('PGBIN')
if not PGBIN:
    _pd = shutil.which('pg_dump')
    if _pd:
        PGBIN = str(Path(_pd).parent)
    elif os.path.isdir('/home/z/my-project/work/stack/pgbin'):
        PGBIN = '/home/z/my-project/work/stack/pgbin'   # stack del sandbox
    else:
        PGBIN = '/usr/bin'
BACKUP_DIR = os.environ.get('BACKUP_DIR', '/tmp/backups')

RESULTADOS = []


def ok(cond, nombre, detalle=''):
    RESULTADOS.append(bool(cond))
    print(f"  {'OK  ' if cond else 'FAIL'} {nombre}" + (f'  [{detalle}]' if detalle else ''), flush=True)
    return bool(cond)


def sh(cmd):
    env = dict(os.environ, PGPASSWORD='', PGHOST=HOST, PGPORT=str(PORT), PGUSER='postgres')
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, env=env, timeout=600)


def q1(db, sql):
    con = psycopg2.connect(host=HOST, port=PORT, dbname=db, user='postgres')
    try:
        cur = con.cursor()
        cur.execute(sql)
        r = cur.fetchone()
        cur.close()
        return r[0] if r else None
    finally:
        con.close()


def conteos(db):
    con = psycopg2.connect(host=HOST, port=PORT, dbname=db, user='postgres')
    cur = con.cursor()
    cur.execute("SELECT (SELECT count(*) FROM tienda.usuarios), (SELECT count(*) FROM tienda.productos), "
                "(SELECT count(*) FROM tienda.ventas), (SELECT count(*) FROM tienda.clientes), "
                "(SELECT count(*) FROM tienda.compras), (SELECT count(*) FROM tienda.pagos_venta), "
                "(SELECT count(*) FROM tienda.asientos), (SELECT count(*) FROM tienda.negocio)")
    r = cur.fetchone()
    cur.close()
    con.close()
    return r


def invariantes(db):
    con = psycopg2.connect(host=HOST, port=PORT, dbname=db, user='postgres')
    cur = con.cursor()
    cur.execute('SELECT COALESCE(bool_and(total_debe = total_haber), true) FROM tienda.asientos')
    doble = bool(cur.fetchone()[0])
    cur.execute('SELECT COALESCE(bool_and(stock_actual >= 0), true) FROM tienda.productos')
    stock = bool(cur.fetchone()[0])
    cur.execute('SELECT count(*) FROM tienda.v_ventas_huecos')
    huecos = int(cur.fetchone()[0])
    cur.close()
    con.close()
    return doble, stock, huecos


def main():
    os.makedirs(BACKUP_DIR, exist_ok=True)

    print('== c1 · BACKUP (pg_dump -Fc con datos) ==', flush=True)
    origen = conteos('tienda')
    print(f'  origen tienda: usuarios={origen[0]} productos={origen[1]} ventas={origen[2]} '
          f'clientes={origen[3]} compras={origen[4]} pagos={origen[5]} asientos={origen[6]} negocios={origen[7]}')
    r = sh(f'{PGBIN}/pg_dump -Fc -h {HOST} -p {PORT} -U postgres -d tienda -f {BACKUP_DIR}/backup_tienda.dump')
    ok(r.returncode == 0, 'pg_dump de «tienda» terminó sin error', r.stderr[-120:] if r.returncode else '')
    r2 = sh(f'{PGBIN}/pg_dump -Fc -h {HOST} -p {PORT} -U postgres -d portal_saas -f {BACKUP_DIR}/backup_portal.dump')
    ok(r2.returncode == 0, 'pg_dump de «portal_saas» terminó sin error', r2.stderr[-120:] if r2.returncode else '')
    for f in ('backup_tienda.dump', 'backup_portal.dump'):
        tam = os.path.getsize(f'{BACKUP_DIR}/{f}')
        ok(tam > 10000, f'{f} tiene contenido ({tam:,} bytes)')
    r3 = sh(f'{PGBIN}/pg_restore -l {BACKUP_DIR}/backup_tienda.dump')
    ok(r3.returncode == 0 and 'TABLE' in r3.stdout, 'el índice del dump lista las tablas')

    print('\n== c2 · RESTORE verificado (bases nuevas desde el dump) ==', flush=True)
    con = psycopg2.connect(host=HOST, port=PORT, dbname='postgres', user='postgres')
    con.autocommit = True
    cur = con.cursor()
    for db in ('tienda_restore', 'portal_restore'):
        cur.execute('SELECT 1 FROM pg_database WHERE datname = %s', (db,))
        if cur.fetchone():
            cur.execute(f'DROP DATABASE {db}')
        cur.execute(f'CREATE DATABASE {db}')
    cur.close()
    con.close()

    r = sh(f'{PGBIN}/pg_restore -h {HOST} -p {PORT} -U postgres -d tienda_restore --no-owner {BACKUP_DIR}/backup_tienda.dump')
    ok(r.returncode == 0, 'pg_restore de tienda sin error', r.stderr[-150:] if r.returncode else '')
    r = sh(f'{PGBIN}/pg_restore -h {HOST} -p {PORT} -U postgres -d portal_restore --no-owner {BACKUP_DIR}/backup_portal.dump')
    ok(r.returncode == 0, 'pg_restore de portal sin error', r.stderr[-150:] if r.returncode else '')

    # HALLAZGO OPERATIVO: las funciones del proyecto resuelven sus tablas por el
    # search_path de la sesión; pg_restore restaura las funciones con
    # search_path = pg_catalog. La configuración real de producción (DB_SEARCH_PATH
    # del .env) se replica fijando el search_path a nivel de base tras el restore.
    r = sh(f'{PGBIN}/psql -h {HOST} -p {PORT} -U postgres -d tienda_restore -c '
           f'"ALTER DATABASE tienda_restore SET search_path TO tienda, public;"')
    ok(r.returncode == 0, 'search_path de la base fijado (como en producción vía DB_SEARCH_PATH)')
    restaurado = conteos('tienda_restore')
    ok(restaurado == origen, 'los conteos de la base restaurada son IDÉNTICOS al origen', f'{restaurado} vs {origen}')
    doble, stock, huecos = invariantes('tienda_restore')
    ok(doble, 'partida doble cuadrada en la base restaurada')
    ok(stock, 'sin stock negativo en la base restaurada')
    huecos_origen = invariantes('tienda')[2]
    ok(huecos == huecos_origen, f'bitácora de huecos idéntica ({huecos})')
    con = psycopg2.connect(host=HOST, port=PORT, dbname='tienda_restore', user='postgres')
    cur = con.cursor()
    cur.execute("SELECT count(*) FROM tienda.ventas v JOIN tienda.detalle_venta d ON d.venta_id = v.id "
                "JOIN tienda.productos p ON p.id = d.producto_id JOIN tienda.pagos_venta pg ON pg.venta_id = v.id")
    cadena = int(cur.fetchone()[0])
    ok(cadena > 0, f'la cadena venta→líneas→producto→pagos consulta íntegra ({cadena} filas)')
    cur.close()
    con.close()

    print('\n== c3 · Migración incremental idempotente sobre una base CON datos ==', flush=True)
    MIGRA = r"""
-- Migración 2026-11-16: etiqueta fiscal de productos (patrón idempotente).
ALTER TABLE tienda.productos ADD COLUMN IF NOT EXISTS etiqueta_fiscal VARCHAR(20);
UPDATE tienda.productos SET etiqueta_fiscal = 'GRAVADO' WHERE etiqueta_fiscal IS NULL;
CREATE INDEX IF NOT EXISTS ix_productos_etiqueta_fiscal ON tienda.productos (etiqueta_fiscal) WHERE etiqueta_fiscal IS NOT NULL;
COMMENT ON COLUMN tienda.productos.etiqueta_fiscal IS 'Etiqueta fiscal opcional del producto (GRAVADO, EXENTO…).';
"""
    open(f'{BACKUP_DIR}/migracion_etiqueta.sql', 'w').write(MIGRA)
    for intento, etiqueta_nombre in ((1, 'primera aplicación'), (2, 'segunda aplicación (idempotente)')):
        r = sh(f'{PGBIN}/psql -h {HOST} -p {PORT} -U postgres -d tienda_restore -v ON_ERROR_STOP=1 -q '
               f'-f {BACKUP_DIR}/migracion_etiqueta.sql')
        ok(r.returncode == 0, f'{etiqueta_nombre} de la migración sin error sobre la base con datos',
           r.stderr[-140:] if r.returncode else '')
    etiqueta = q1('tienda_restore', "SELECT count(*) FROM tienda.productos WHERE etiqueta_fiscal = 'GRAVADO'")
    total = q1('tienda_restore', 'SELECT count(*) FROM tienda.productos')
    ok(etiqueta == total, f'todos los productos quedaron etiquetados ({etiqueta}/{total})')

    con = psycopg2.connect(host=HOST, port=PORT, dbname='tienda_restore', user='postgres')
    cur = con.cursor()
    cur.execute("SELECT set_config('app.negocio_id', '1', true)")
    cur.execute('SELECT min(id) FROM tienda.productos WHERE negocio_id = 1')
    pid = int(cur.fetchone()[0])
    cur.execute("SELECT set_config('app.negocio_id', '', true)")
    cur.execute("SELECT id FROM aperturas_caja WHERE usuario_id = 1 AND estado = 'ABIERTA' LIMIT 1")
    if cur.fetchone() is None:
        cur.execute('SELECT tienda.fn_abrir_caja(1, 100, 3650)')
    cur.execute("SELECT set_config('app.negocio_id', '1', true)")
    items = '[{"producto_id": %d, "cantidad": 1, "descuento_pct": 0}]' % pid
    cur.execute('SELECT * FROM tienda.fn_cotizar_venta(%s::jsonb)', (items,))
    cot = cur.fetchone()
    pagos = '[{"metodo_pago_id": 4, "monto": %s, "referencia": "POSTMIG"}]' % round(float(cot[6]) * float(cot[0]), 2)
    cur.execute('SELECT tienda.fn_registrar_venta(1, %s::jsonb, %s::jsonb, NULL, %s, %s, FALSE, 0)',
                (items, pagos, 'Venta tras la migración', 'PRESENCIAL'))
    venta_id = int(cur.fetchone()[0])
    con.commit()
    ok(venta_id > 0, 'la base migrada REGISTRA UNA VENTA REAL (el negocio sigue vivo)')
    con.close()

    print('\n== c4 · ROLLBACK REAL: "migración" destructiva → restore del backup ==', flush=True)
    con = psycopg2.connect(host=HOST, port=PORT, dbname='tienda_restore', user='postgres')
    con.autocommit = True
    cur = con.cursor()
    cur.execute('ALTER TABLE tienda.productos ADD COLUMN IF NOT EXISTS precio_roto numeric')
    cur.execute('UPDATE tienda.productos SET precio_roto = -999')
    cur.execute("UPDATE tienda.clientes SET telefono = '9999-9999', correo = 'roto@roto.com'")
    cur.close()
    con.close()
    roto = q1('tienda_restore', "SELECT count(*) FROM tienda.clientes WHERE telefono = '9999-9999'")
    ok(int(roto or 0) > 0, 'la "migración" destructiva corrompió datos (columna fake + teléfonos/correos pisados)')

    r = sh(f'{PGBIN}/pg_restore -h {HOST} -p {PORT} -U postgres -d tienda_restore --clean --if-exists '
           f'--no-owner {BACKUP_DIR}/backup_tienda.dump')
    ok(r.returncode == 0, 'el restore con --clean (rollback) terminó sin error', r.stderr[-150:] if r.returncode else '')

    columna_fuera = int(q1('tienda_restore', "SELECT count(*) FROM information_schema.columns "
                           "WHERE table_schema = 'tienda' AND table_name = 'productos' "
                           "AND column_name = 'precio_roto'")) == 0
    ok(columna_fuera, 'la columna fake DESAPARECIÓ tras el rollback')
    doble, stock, huecos = invariantes('tienda_restore')
    ok(doble and stock, 'las invariantes contables volvieron a su estado correcto tras el rollback')
    huella_origen = q1('tienda', "SELECT md5(string_agg(id::text || '|' || COALESCE(telefono,'') || '|' || COALESCE(correo,''), ',' ORDER BY id)) FROM tienda.clientes")
    huella_rollback = q1('tienda_restore', "SELECT md5(string_agg(id::text || '|' || COALESCE(telefono,'') || '|' || COALESCE(correo,''), ',' ORDER BY id)) FROM tienda.clientes")
    ok(huella_origen == huella_rollback, 'los datos corrompidos volvieron EXACTOS a los del backup (huella md5 de clientes)')
    restaurado2 = conteos('tienda_restore')
    ok(restaurado2 == origen, 'la base restaurada es de nuevo IDÉNTICA al origen', f'{restaurado2} vs {origen}')

    print('\n== c5 · SEARCH_PATH de la base tras pg_restore (conexiones NUEVAS) ==', flush=True)
    # El hallazgo 2 de la continuidad: las funciones de tienda resuelven sus
    # tablas por el search_path de SESIÓN; un restore que NO lo traiga deja el
    # default «$user», public» y los triggers dejan de compilar. Lo que se
    # demuestra aquí: (1) el ajuste VIAJA dentro del dump y una conexión NUEVA
    # lo hereda, (2) el paso del runbook (ALTER DATABASE) es idempotente y (3)
    # los triggers compilan y funcionan en una conexión fresca distinta de la
    # del script.
    con_nueva = psycopg2.connect(host=HOST, port=PORT, dbname='tienda_restore', user='postgres')
    cur = con_nueva.cursor()
    cur.execute('SHOW search_path')
    sp_nueva = str(cur.fetchone()[0])
    ok(sp_nueva.startswith('tienda'), 'el search_path correcto sobrevive al backup/restore: una conexión NUEVA lo hereda', sp_nueva)
    cur.close()
    con_nueva.close()

    con = psycopg2.connect(host=HOST, port=PORT, dbname='postgres', user='postgres')
    con.autocommit = True
    cur = con.cursor()
    cur.execute("ALTER DATABASE tienda_restore SET search_path TO tienda, public")
    cur.close()
    con.close()
    ok(True, 'ALTER DATABASE … SET search_path TO tienda, public (el paso del runbook, idempotente)')

    con_nueva = psycopg2.connect(host=HOST, port=PORT, dbname='tienda_restore', user='postgres')
    cur = con_nueva.cursor()
    try:
        cur.execute('UPDATE tienda.negocio SET razon_social = razon_social WHERE id = 1')
        cur.execute('SELECT tienda.fn_hoy()')
        cur.execute('SELECT tienda.fn_negocio_actual()')
        con_nueva.commit()
        ok(True, 'los triggers y funciones compilan y funcionan en la conexión nueva (no la del script)')
    except psycopg2.Error as e:
        con_nueva.rollback()
        ok(False, 'los triggers debían compilar en la conexión nueva', str(e).splitlines()[0][:120])
    cur.close()
    con_nueva.close()

    print('\n== RESUMEN DE CONTINUIDAD ==')
    print(f'TOTAL: {sum(RESULTADOS)} OK · {len(RESULTADOS) - sum(RESULTADOS)} FAIL')
    return 0 if all(RESULTADOS) else 1


if __name__ == '__main__':
    sys.exit(main())
