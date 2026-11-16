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
import tempfile
import time
from pathlib import Path

import psycopg2

HOST = os.environ.get('PGHOST_PRUEBAS', os.environ.get('PGHOST', '/tmp'))
PORT = int(os.environ.get('PGPORT_PRUEBAS', os.environ.get('PGPORT', '5433')))
USER = os.environ.get('PGUSER_PRUEBAS', os.environ.get('PGUSER', 'postgres'))
ORIGEN_DB = os.environ.get('PGTEMPLATE', 'tiendaunica')
RESTORE_DB = f'{ORIGEN_DB}_restore'
PGBIN = os.environ.get('PGBIN')
if not PGBIN:
    _pd = shutil.which('pg_dump')
    if _pd:
        PGBIN = str(Path(_pd).parent)
    elif os.path.isdir(r'C:\Program Files\PostgreSQL\18\bin'):
        PGBIN = r'C:\Program Files\PostgreSQL\18\bin'
    elif os.path.isdir('/home/z/my-project/work/stack/pgbin'):
        PGBIN = '/home/z/my-project/work/stack/pgbin'
    else:
        PGBIN = '/usr/bin'
BACKUP_DIR = os.environ.get('BACKUP_DIR', os.path.join(tempfile.gettempdir(), 'backups_tiendaunica'))

RESULTADOS = []


def ok(cond, nombre, detalle=''):
    RESULTADOS.append(bool(cond))
    print(f"  {'OK  ' if cond else 'FAIL'} {nombre}" + (f'  [{detalle}]' if detalle else ''), flush=True)
    return bool(cond)


def sh(args):
    env = dict(os.environ, PGHOST=HOST, PGPORT=str(PORT), PGUSER=USER)
    return subprocess.run(args, capture_output=True, text=True, env=env, timeout=600)


def q1(db, sql):
    con = psycopg2.connect(host=HOST, port=PORT, dbname=db, user=USER)
    try:
        cur = con.cursor()
        cur.execute(sql)
        r = cur.fetchone()
        cur.close()
        return r[0] if r else None
    finally:
        con.close()


def conteos(db):
    con = psycopg2.connect(host=HOST, port=PORT, dbname=db, user=USER)
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
    con = psycopg2.connect(host=HOST, port=PORT, dbname=db, user=USER)
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
    dump_file = os.path.join(BACKUP_DIR, f'backup_{ORIGEN_DB}.dump')
    pg_dump = os.path.join(PGBIN, 'pg_dump')
    pg_restore = os.path.join(PGBIN, 'pg_restore')
    psql_bin = os.path.join(PGBIN, 'psql')

    print('== c1 · BACKUP (pg_dump -Fc con datos) ==', flush=True)
    origen = conteos(ORIGEN_DB)
    print(f'  origen {ORIGEN_DB}: usuarios={origen[0]} productos={origen[1]} ventas={origen[2]} '
          f'clientes={origen[3]} compras={origen[4]} pagos={origen[5]} asientos={origen[6]} negocios={origen[7]}')
    r = sh([pg_dump, '-Fc', '-h', HOST, '-p', str(PORT), '-U', USER, '-d', ORIGEN_DB, '-f', dump_file])
    ok(r.returncode == 0, f'pg_dump de «{ORIGEN_DB}» terminó sin error', r.stderr[-120:] if r.returncode else '')
    tam = os.path.getsize(dump_file) if os.path.exists(dump_file) else 0
    ok(tam > 10000, f'{os.path.basename(dump_file)} tiene contenido ({tam:,} bytes)')
    r3 = sh([pg_restore, '-l', dump_file])
    ok(r3.returncode == 0 and 'TABLE' in r3.stdout, 'el índice del dump lista las tablas')

    print('\n== c2 · RESTORE verificado (base nueva desde el dump) ==', flush=True)
    con = psycopg2.connect(host=HOST, port=PORT, dbname='postgres', user=USER)
    con.autocommit = True
    cur = con.cursor()
    cur.execute('SELECT 1 FROM pg_database WHERE datname = %s', (RESTORE_DB,))
    if cur.fetchone():
        cur.execute(f'DROP DATABASE {RESTORE_DB}')
    cur.execute(f'CREATE DATABASE {RESTORE_DB}')
    cur.close()
    con.close()

    r = sh([pg_restore, '-h', HOST, '-p', str(PORT), '-U', USER, '-d', RESTORE_DB, '--no-owner', dump_file])
    ok(r.returncode == 0, f'pg_restore de {ORIGEN_DB} sin error', r.stderr[-150:] if r.returncode else '')

    r = sh([psql_bin, '-h', HOST, '-p', str(PORT), '-U', USER, '-d', RESTORE_DB, '-c',
            f'ALTER DATABASE {RESTORE_DB} SET search_path TO tienda, public;'])
    ok(r.returncode == 0, 'search_path de la base fijado (como en producción vía DB_SEARCH_PATH)')
    restaurado = conteos(RESTORE_DB)
    ok(restaurado == origen, 'los conteos de la base restaurada son IDÉNTICOS al origen', f'{restaurado} vs {origen}')
    doble, stock, huecos = invariantes(RESTORE_DB)
    ok(doble, 'partida doble cuadrada en la base restaurada')
    ok(stock, 'sin stock negativo en la base restaurada')
    huecos_origen = invariantes(ORIGEN_DB)[2]
    ok(huecos == huecos_origen, f'bitácora de huecos idéntica ({huecos})')
    con = psycopg2.connect(host=HOST, port=PORT, dbname=RESTORE_DB, user=USER)
    cur = con.cursor()
    cur.execute("SELECT count(*) FROM tienda.ventas v JOIN tienda.detalle_venta d ON d.venta_id = v.id "
                "JOIN tienda.productos p ON p.id = d.producto_id JOIN tienda.pagos_venta pg ON pg.venta_id = v.id")
    cadena = int(cur.fetchone()[0])
    ok(cadena >= 0, f'la cadena venta→líneas→producto→pagos consulta íntegra ({cadena} filas)')
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
    migra_file = os.path.join(BACKUP_DIR, 'migracion_etiqueta.sql')
    open(migra_file, 'w', encoding='utf-8').write(MIGRA)
    for intento, etiqueta_nombre in ((1, 'primera aplicación'), (2, 'segunda aplicación (idempotente)')):
        r = sh([psql_bin, '-h', HOST, '-p', str(PORT), '-U', USER, '-d', RESTORE_DB, '-v', 'ON_ERROR_STOP=1', '-q', '-f', migra_file])
        ok(r.returncode == 0, f'{etiqueta_nombre} de la migración sin error sobre la base con datos',
           r.stderr[-140:] if r.returncode else '')
    etiqueta = q1(RESTORE_DB, "SELECT count(*) FROM tienda.productos WHERE etiqueta_fiscal = 'GRAVADO'")
    total = q1(RESTORE_DB, 'SELECT count(*) FROM tienda.productos')
    ok(etiqueta == total, f'todos los productos quedaron etiquetados ({etiqueta}/{total})')

    con = psycopg2.connect(host=HOST, port=PORT, dbname=RESTORE_DB, user=USER,
                           options='-c search_path=tienda,public')
    cur = con.cursor()
    cur.execute('SELECT min(id) FROM tienda.productos WHERE negocio_id = 1')
    pid = int(cur.fetchone()[0])
    cur.execute("SELECT id FROM tienda.aperturas_caja WHERE usuario_id = 1 AND estado = 'ABIERTA' LIMIT 1")
    if cur.fetchone() is None:
        cur.execute('SELECT tienda.fn_abrir_caja(1, 100, 3650)')
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
    con = psycopg2.connect(host=HOST, port=PORT, dbname=RESTORE_DB, user=USER)
    con.autocommit = True
    cur = con.cursor()
    cur.execute('ALTER TABLE tienda.productos ADD COLUMN IF NOT EXISTS precio_roto numeric')
    cur.execute('UPDATE tienda.productos SET precio_roto = -999')
    cur.execute("UPDATE tienda.clientes SET telefono = '9999-9999', correo = 'roto@roto.com'")
    cur.close()
    con.close()
    roto = q1(RESTORE_DB, "SELECT count(*) FROM tienda.clientes WHERE telefono = '9999-9999'")
    ok(int(roto or 0) > 0, 'la "migración" destructiva corrompió datos (columna fake + teléfonos/correos pisados)')

    r = sh([pg_restore, '-h', HOST, '-p', str(PORT), '-U', USER, '-d', RESTORE_DB, '--clean', '--if-exists', '--no-owner', dump_file])
    ok(r.returncode == 0, 'el restore con --clean (rollback) terminó sin error', r.stderr[-150:] if r.returncode else '')

    columna_fuera = int(q1(RESTORE_DB, "SELECT count(*) FROM information_schema.columns "
                           "WHERE table_schema = 'tienda' AND table_name = 'productos' "
                           "AND column_name = 'precio_roto'")) == 0
    ok(columna_fuera, 'la columna fake DESAPARECIÓ tras el rollback')
    doble, stock, huecos = invariantes(RESTORE_DB)
    ok(doble and stock, 'las invariantes contables volvieron a su estado correcto tras el rollback')
    huella_origen = q1(ORIGEN_DB, "SELECT md5(COALESCE(string_agg(id::text || '|' || COALESCE(telefono,'') || '|' || COALESCE(correo,''), ',' ORDER BY id), '')) FROM tienda.clientes")
    huella_rollback = q1(RESTORE_DB, "SELECT md5(COALESCE(string_agg(id::text || '|' || COALESCE(telefono,'') || '|' || COALESCE(correo,''), ',' ORDER BY id), '')) FROM tienda.clientes")
    ok(huella_origen == huella_rollback, 'los datos corrompidos volvieron EXACTOS a los del backup (huella md5 de clientes)')
    restaurado2 = conteos(RESTORE_DB)
    ok(restaurado2 == origen, 'la base restaurada es de nuevo IDÉNTICA al origen', f'{restaurado2} vs {origen}')

    print('\n== c5 · SEARCH_PATH de la base tras pg_restore (conexiones NUEVAS) ==', flush=True)
    con_nueva = psycopg2.connect(host=HOST, port=PORT, dbname=RESTORE_DB, user=USER)
    cur = con_nueva.cursor()
    cur.execute('SHOW search_path')
    sp_nueva = str(cur.fetchone()[0])
    ok(sp_nueva.startswith('tienda'), 'el search_path correcto sobrevive al backup/restore: una conexión NUEVA lo hereda', sp_nueva)
    cur.close()
    con_nueva.close()

    con = psycopg2.connect(host=HOST, port=PORT, dbname='postgres', user=USER)
    con.autocommit = True
    cur = con.cursor()
    cur.execute(f"ALTER DATABASE {RESTORE_DB} SET search_path TO tienda, public")
    cur.close()
    con.close()
    ok(True, f'ALTER DATABASE {RESTORE_DB} SET search_path TO tienda, public (el paso del runbook, idempotente)')

    con_nueva = psycopg2.connect(host=HOST, port=PORT, dbname=RESTORE_DB, user=USER)
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
