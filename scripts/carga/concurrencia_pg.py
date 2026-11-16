#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pruebas de carga y concurrencia a nivel PostgreSQL para TIENDA ÚNICA.

Se corren sobre un CLON dedicado (tienda_carga) creado desde PGTEMPLATE
(por defecto «tiendaunica»).

  escenario A · 50 CONEXIONES CONCURRENTES REALES (2 cajas vendiendo a la vez):
                 hilos con conexiones propias y barrera de arranque; mezcla
                 cotizaciones, consultas de catálogo y ventas reales. Mide
                 latencia (p50/p95/p99), throughput y verifica correlativo sin
                 huecos, stock exacto y cero negativos.
  escenario B · 1,000 PETICIONES MIXTAS VÍA POOL (16 conexiones): simula un pool
                 de aplicación (PHP-FPM / Octane) ejecutando búsquedas en
                 v_productos_precios, compatibilidad y cotizaciones.
"""
import json
import os
import queue
import statistics
import sys
import threading
import time

import psycopg2

PGHOST = os.environ.get('PGHOST_PRUEBAS', os.environ.get('PGHOST', '/tmp'))
PGPORT = int(os.environ.get('PGPORT_PRUEBAS', os.environ.get('PGPORT', '5433')))
PGUSER = os.environ.get('PGUSER_PRUEBAS', os.environ.get('PGUSER', 'postgres'))
PGTEMPLATE = os.environ.get('PGTEMPLATE', 'tiendaunica')
CLON = 'tienda_carga'
PRODUCTO_ID = None
CAJA_USERS = []


def nueva_conexion(db=CLON):
    con = psycopg2.connect(host=PGHOST, port=PGPORT, dbname=db, user=PGUSER,
                           options='-c search_path=tienda,public -c TimeZone=America/Caracas')
    con.autocommit = False
    return con


def pct(lista, q):
    lista = sorted(lista)
    if not lista:
        return 0.0
    return lista[min(int(len(lista) * q / 100), len(lista) - 1)]


def preparar():
    """Clon dedicado desde PGTEMPLATE con stock suficiente y dos cajas abiertas."""
    global PRODUCTO_ID, CAJA_USERS
    con = psycopg2.connect(host=PGHOST, port=PGPORT, dbname='postgres', user=PGUSER)
    con.autocommit = True
    cur = con.cursor()
    for _ in range(6):
        try:
            cur.execute('SELECT 1 FROM pg_database WHERE datname = %s', (CLON,))
            if cur.fetchone():
                cur.execute(f'DROP DATABASE {CLON}')
            cur.execute(f'CREATE DATABASE {CLON} TEMPLATE {PGTEMPLATE}')
            break
        except psycopg2.Error:
            time.sleep(2)
    cur.close()
    con.close()

    con = nueva_conexion()
    cur = con.cursor()
    cur.execute("SELECT id FROM tienda.productos WHERE negocio_id = 1 AND activo ORDER BY id LIMIT 1")
    PRODUCTO_ID = int(cur.fetchone()[0])

    cur.execute("SELECT id FROM tienda.usuarios WHERE rol = 'ADMINISTRADOR' AND activo ORDER BY id LIMIT 1")
    uid1 = int(cur.fetchone()[0])
    cur.execute("SELECT id FROM tienda.usuarios WHERE rol = 'CAJERO' AND activo ORDER BY id LIMIT 1")
    fila_caj = cur.fetchone()
    if fila_caj:
        uid2 = int(fila_caj[0])
    else:
        cur.execute("INSERT INTO tienda.usuarios (negocio_id, username, password_hash, nombre_completo, rol, activo) "
                    "VALUES (1, 'carga_cajero', 'PENDIENTE', 'Carga Cajero', 'CAJERO', true) RETURNING id")
        uid2 = int(cur.fetchone()[0])
    CAJA_USERS = [uid1, uid2]

    for uid in CAJA_USERS:
        cur.execute('SELECT tienda.fn_apertura_activa(%s)', (uid,))
        if cur.fetchone()[0] is None:
            cur.execute('SELECT tienda.fn_abrir_caja(%s, 100, 3650)', (uid,))

    cur.execute('CALL tienda.sp_ajustar_stock(%s, 500, %s, %s)', (PRODUCTO_ID, 'Stock para prueba de carga', uid1))
    con.commit()
    con.close()


def escenario_a(n_conexiones=50, ops_por_conexion=6):
    print(f'\n== Escenario A · {n_conexiones} conexiones concurrentes reales '
          f'({ops_por_conexion} ops cada una, 2 cajas) ==', flush=True)
    con_check = nueva_conexion()
    cur_check = con_check.cursor()
    cur_check.execute('SELECT stock_actual FROM tienda.productos WHERE id = %s', (PRODUCTO_ID,))
    stock_antes = float(cur_check.fetchone()[0])
    cur_check.execute('SELECT COALESCE(max(numero), 0) FROM tienda.ventas')
    max_antes = int(cur_check.fetchone()[0])
    cur_check.execute('SELECT count(*) FROM tienda.v_ventas_huecos')
    huecos_antes = int(cur_check.fetchone()[0])
    cur_check.close()
    con_check.close()

    resultados, errores = [], []
    lock = threading.Lock()
    barrera = threading.Barrier(n_conexiones)

    def trabajador(idx):
        con = None
        try:
            con = nueva_conexion()
            cur = con.cursor()
            uid = CAJA_USERS[idx % len(CAJA_USERS)]
            barrera.wait()
            for op in range(ops_por_conexion):
                t0 = time.perf_counter()
                items = json.dumps([{'producto_id': PRODUCTO_ID, 'cantidad': 1, 'descuento_pct': 0}])
                cur.execute('SELECT * FROM tienda.fn_cotizar_venta(%s)', (items,))
                cot = cur.fetchone()
                total, tasa = float(cot[6]), float(cot[0])
                es_venta = (op % 3 == 2)
                if es_venta:
                    pagos = json.dumps([{'metodo_pago_id': 4, 'monto': round(total * tasa, 2),
                                         'referencia': f'CARGA-{idx}-{op}'}])
                    cur.execute('SELECT tienda.fn_registrar_venta(%s, %s, %s, NULL, %s, %s, FALSE, 0)',
                                (uid, items, pagos, f'Carga {idx}/{op}', 'PRESENCIAL'))
                    cur.fetchone()
                else:
                    cur.execute('SELECT count(*) FROM tienda.v_productos_precios WHERE activo')
                    cur.fetchone()
                con.commit()
                with lock:
                    resultados.append(((time.perf_counter() - t0) * 1000, es_venta))
        except Exception as e:  # noqa: BLE001
            with lock:
                errores.append(str(e)[:120])
            if con:
                try:
                    con.rollback()
                except Exception:  # noqa: BLE001
                    pass
            try:
                barrera.abort()
            except threading.BrokenBarrierError:
                pass
        finally:
            if con:
                con.close()

    inicio = time.perf_counter()
    hilos = [threading.Thread(target=trabajador, args=(i,)) for i in range(n_conexiones)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    total_s = time.perf_counter() - inicio

    lat = [r[0] for r in resultados]
    ventas_ok = sum(1 for r in resultados if r[1])
    print(f'  operaciones OK: {len(lat)} (ventas={ventas_ok}) · errores: {len(errores)} · duración: {total_s:.2f}s')
    if lat:
        print(f'  throughput: {len(lat) / total_s:.1f} ops/s')
        print(f'  latencia ms · p50={pct(lat, 50):.1f} · p95={pct(lat, 95):.1f} · p99={pct(lat, 99):.1f} '
              f'· media={statistics.mean(lat):.1f} · máx={max(lat):.1f}')
    for e in errores[:3]:
        print(f'  ERROR: {e}')

    con_v = nueva_conexion()
    cur_v = con_v.cursor()
    cur_v.execute("SELECT count(*), COALESCE(min(numero),0), COALESCE(max(numero),0) "
                  "FROM tienda.ventas WHERE observaciones LIKE 'Carga %'")
    n_ventas, min_num, max_num = cur_v.fetchone()
    cur_v.execute('SELECT stock_actual FROM tienda.productos WHERE id = %s', (PRODUCTO_ID,))
    stock_despues = float(cur_v.fetchone()[0])
    cur_v.execute('SELECT count(*) FROM tienda.v_ventas_huecos')
    huecos_despues = int(cur_v.fetchone()[0])
    cur_v.execute('SELECT COALESCE(bool_and(stock_actual >= 0), true) FROM tienda.productos')
    sin_negativos = bool(cur_v.fetchone()[0])
    cur_v.close()
    con_v.close()

    stock_ok = (stock_despues == stock_antes - n_ventas) and sin_negativos
    corr_ok = (int(n_ventas) == ventas_ok) and (int(max_num) - max_antes == int(n_ventas)) and (huecos_despues == huecos_antes)
    print(f'  integridad: ventas={n_ventas} · correlativo={min_num}..{max_num} (huecos={huecos_despues}) · '
          f'stock {stock_antes}->{stock_despues} · ok={stock_ok and corr_ok}')
    return len(errores) == 0 and stock_ok and corr_ok


def escenario_b(n_peticiones=1000, tam_pool=16):
    print(f'\n== Escenario B · {n_peticiones} peticiones mixtas vía pool de {tam_pool} conexiones ==', flush=True)
    pool = queue.Queue()
    for _ in range(tam_pool):
        pool.put(nueva_conexion())

    latencias, errores = [], []
    lock = threading.Lock()
    items = json.dumps([{'producto_id': PRODUCTO_ID, 'cantidad': 2, 'descuento_pct': 0}])

    def peticion(i):
        con = pool.get()
        t0 = time.perf_counter()
        try:
            cur = con.cursor()
            modo = i % 3
            if modo == 0:
                cur.execute("SELECT id, sku, nombre, precio_venta_usd, stock_actual FROM tienda.v_productos_precios "
                            "WHERE activo AND nombre ILIKE '%aceite%' LIMIT 20")
                cur.fetchall()
            elif modo == 1:
                cur.execute('SELECT * FROM tienda.fn_cotizar_venta(%s)', (items,))
                cur.fetchone()
            else:
                cur.execute('SELECT p.id, p.nombre, m.marca, m.modelo FROM tienda.productos p '
                            'LEFT JOIN tienda.producto_compatibilidad pc ON pc.producto_id = p.id '
                            'LEFT JOIN tienda.motos_modelos m ON m.id = pc.moto_modelo_id '
                            'WHERE p.activo LIMIT 25')
                cur.fetchall()
            con.commit()
            with lock:
                latencias.append((time.perf_counter() - t0) * 1000)
        except Exception as e:  # noqa: BLE001
            try:
                con.rollback()
            except Exception:  # noqa: BLE001
                pass
            with lock:
                errores.append(str(e)[:120])
        finally:
            pool.put(con)

    inicio = time.perf_counter()
    hilos = [threading.Thread(target=peticion, args=(i,)) for i in range(n_peticiones)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    total_s = time.perf_counter() - inicio

    while not pool.empty():
        pool.get().close()

    print(f'  peticiones OK: {len(latencias)} · errores: {len(errores)} · duración: {total_s:.2f}s')
    if latencias:
        print(f'  throughput: {len(latencias) / total_s:.1f} req/s')
        print(f'  latencia ms · p50={pct(latencias, 50):.1f} · p95={pct(latencias, 95):.1f} · '
              f'p99={pct(latencias, 99):.1f} · máx={max(latencias):.1f}')
    for e in errores[:3]:
        print(f'  ERROR: {e}')
    return len(errores) == 0


def main():
    preparar()
    ok_a = escenario_a()
    ok_b = escenario_b()
    ok = ok_a and ok_b
    print(f"\nRESULTADO CARGA: {'OK' if ok else 'FALLO'}")
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
