#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pruebas de concurrencia a nivel PostgreSQL para el informe de rendimiento.

Se corren sobre un CLON dedicado (tienda_carga) con DOS negocios reales
provisionados, y como el rol de la app (saas_app) donde importa el aislamiento
(postgres es superusuario y by-pasa RLS: con él el aislamiento no se puede medir).

  escenario A · 100 CONEXIONES CONCURRENTES REALES: hilos con conexiones propias
                 y barrera de arranque; cada operación fija SU GUC de transacción
                 (el de sesión moriría tras el primer commit). Mide latencia y
                 throughput, y verifica que cada venta caiga en SU negocio.
  escenario B · 1,000 SESIONES DE TENANT VÍA POOL (16 conexiones): como saas_app,
                 cada sesión fija su GUC y la guarda RLS decide qué ve; mide
                 latencia y verifica que NINGUNA sesión vea filas ajenas.
  escenario C · COSTO DE RLS: misma consulta con y sin identidad como saas_app.
"""
import json
import os
import queue
import statistics
import threading
import time

import psycopg2

PGHOST = os.environ.get('PGHOST', '/tmp')
PGPORT = int(os.environ.get('PGPORT', '5433'))
CLON = 'tienda_carga'
PRODUCTO = {1: None, 2: None}     # producto de venta por negocio (se llena en preparar())


def nueva_conexion(db=CLON):
    con = psycopg2.connect(host=PGHOST, port=PGPORT, dbname=db, user='postgres',
                           options='-c search_path=tienda,public')
    con.autocommit = False
    return con


def pct(lista, q):
    lista = sorted(lista)
    if not lista:
        return 0.0
    return lista[min(int(len(lista) * q / 100), len(lista) - 1)]


def rif_valido(tipo='J'):
    cuerpo = str(30000000 + (time.time_ns() % 69999999))
    v = {'V': 1, 'E': 2, 'J': 3, 'P': 4, 'G': 5, 'C': 3}[tipo]
    pesos = [3, 2, 7, 6, 5, 4, 3, 2]
    suma = v * 4 + sum(int(c) * p for c, p in zip(cuerpo, pesos))
    dv = 11 - (suma % 11)
    return f"{tipo}-{cuerpo}-{0 if dv >= 10 else dv}"


def preparar():
    """Clon dedicado + negocio 2 con su producto, usuario y turno (como t17)."""
    con = psycopg2.connect(host=PGHOST, port=PGPORT, dbname='postgres', user='postgres')
    con.autocommit = True
    cur = con.cursor()
    for _ in range(6):
        try:
            cur.execute('SELECT 1 FROM pg_database WHERE datname = %s', (CLON,))
            if cur.fetchone():
                cur.execute(f'DROP DATABASE {CLON}')
            cur.execute(f'CREATE DATABASE {CLON} TEMPLATE tienda')
            break
        except psycopg2.Error:
            time.sleep(2)
    cur.close()
    con.close()

    con = nueva_conexion()
    cur = con.cursor()
    cur.execute("INSERT INTO tienda.negocio (id, razon_social, nombre_comercial, rif, direccion_fiscal, "
                "telefono, correo, es_contribuyente_especial, cobra_igtf, recupera_credito_fiscal, "
                "precios_incluyen_iva, configurado_en, configurado_por) "
                "VALUES (2, 'Bodega Carga C.A.', 'Bodega Carga', %s, 'Calle Carga', '04140000000', "
                "'carga@bodega.com', false, false, true, false, now(), 1)", (rif_valido('J'),))
    cur.execute("INSERT INTO tienda.estado_tenants (negocio_id, subdominio, activo, plan, modulos) "
                "VALUES (2, 'bodega-carga', true, 'BASE', '{\"repuestos\": true}')")
    cur.execute("INSERT INTO tienda.usuarios (negocio_id, username, password_hash, nombre_completo, rol, activo) "
                "VALUES (2, 'carga_admin2', 'PENDIENTE', 'Carga Negocio Dos', 'ADMINISTRADOR', true)")
    cur.execute("INSERT INTO tienda.productos (negocio_id, sku, nombre, unidad, costo_usd, margen_pct, "
                "exento_iva, exonerado_iva, stock_minimo, activo) "
                "VALUES (2, 'CARGA2-1', 'Aceite Carga 2', 'UND', 3.0, 30, false, false, 1, true)")
    con.commit()
    cur.execute('SELECT min(id) FROM tienda.productos WHERE negocio_id = 1')
    PRODUCTO[1] = int(cur.fetchone()[0])
    cur.execute('SELECT min(id) FROM tienda.productos WHERE negocio_id = 2')
    PRODUCTO[2] = int(cur.fetchone()[0])
    cur.execute("SELECT id FROM tienda.usuarios WHERE username = 'carga_admin2'")
    uid2 = int(cur.fetchone()[0])
    # Turnos abiertos para los vendedores de ambos negocios + stock inicial
    # (si el clon hereda el turno de la plantilla, se usa ese).
    cur.execute('SELECT tienda.fn_apertura_activa(1)')
    if cur.fetchone()[0] is None:
        cur.execute('SELECT tienda.fn_abrir_caja(1, 100, 3650)')
    cur.execute("SELECT set_config('app.negocio_id', '2', true)")
    cur.execute('SELECT tienda.fn_apertura_activa(%s)', (uid2,))
    if cur.fetchone()[0] is None:
        cur.execute('SELECT tienda.fn_abrir_caja(%s, 100, 3650)', (uid2,))
    cur.execute("SELECT set_config('app.negocio_id', '', true)")
    cur.execute('CALL tienda.sp_ajustar_stock(%s, 300, %s, 1)', (PRODUCTO[1], 'Stock para la prueba de carga'))
    cur.execute("SELECT set_config('app.negocio_id', '2', true)")
    cur.execute('CALL tienda.sp_ajustar_stock(%s, 300, %s, %s)', (PRODUCTO[2], 'Stock para la prueba de carga', uid2))
    con.commit()
    con.close()
    return uid2


def escenario_a(n_conexiones=100, ops_por_conexion=6, uid2=2):
    print(f'\n== Escenario A · {n_conexiones} conexiones concurrentes reales '
          f'({ops_por_conexion} ops cada una, 2 negocios) ==', flush=True)
    resultados, errores = [], []
    lock = threading.Lock()
    barrera = threading.Barrier(n_conexiones)

    def trabajador(idx):
        con = None
        try:
            con = nueva_conexion()
            cur = con.cursor()
            barrera.wait()
            for op in range(ops_por_conexion):
                negocio = (idx + op) % 2 + 1        # la operación alterna de negocio
                producto = PRODUCTO[negocio]
                uid = 1 if negocio == 1 else uid2
                t0 = time.perf_counter()
                items = json.dumps([{'producto_id': producto, 'cantidad': 1, 'descuento_pct': 0}])
                cur.execute("SELECT set_config('app.negocio_id', %s, true)", (str(negocio),))
                cur.execute('SELECT * FROM tienda.fn_cotizar_venta(%s)', (items,))
                cot = cur.fetchone()
                total, tasa = float(cot[6]), float(cot[0])
                if op % 3 == 2:
                    pagos = json.dumps([{'metodo_pago_id': 4, 'monto': round(total * tasa, 2),
                                         'referencia': f'CONC-{negocio}-{idx}-{op}'}])
                    cur.execute('SELECT tienda.fn_registrar_venta(%s, %s, %s, NULL, %s, %s, FALSE, 0)',
                                (uid, items, pagos, f'Carga {negocio}/{idx}/{op}', 'PRESENCIAL'))
                    cur.fetchone()
                else:
                    cur.execute('SELECT count(*) FROM tienda.productos WHERE activo')
                    cur.fetchone()
                con.commit()
                with lock:
                    resultados.append(((time.perf_counter() - t0) * 1000, negocio))
        except Exception as e:  # noqa: BLE001
            with lock:
                errores.append(str(e)[:110])
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
    print(f'  operaciones OK: {len(lat)} · errores: {len(errores)} · duración total: {total_s:.1f}s')
    print(f'  throughput: {len(lat) / total_s:.1f} ops/s')
    print(f'  latencia ms · p50={pct(lat, 50):.1f} · p95={pct(lat, 95):.1f} · p99={pct(lat, 99):.1f} '
          f'· media={statistics.mean(lat):.1f} · máx={max(lat):.1f}')
    for e in errores[:3]:
        print(f'  ERROR: {e}')
    return {'ops_ok': len(lat), 'errores': len(errores), 'total_s': round(total_s, 1),
            'throughput': round(len(lat) / total_s, 1) if lat else 0,
            'p50': round(pct(lat, 50), 1), 'p95': round(pct(lat, 95), 1), 'p99': round(pct(lat, 99), 1)}


def verificar_a():
    """Cada venta de la carrera vendió un producto de SU negocio; stock cuadrado."""
    con = nueva_conexion()
    cur = con.cursor()
    cur.execute("SELECT negocio_id, count(*) FROM tienda.ventas WHERE observaciones LIKE 'Carga %' "
                "GROUP BY negocio_id ORDER BY negocio_id")
    por_negocio = cur.fetchall()
    cur.execute("SELECT count(*) FROM tienda.ventas v "
                "JOIN tienda.detalle_venta d ON d.venta_id = v.id "
                "JOIN tienda.productos p ON p.id = d.producto_id "
                "WHERE v.observaciones LIKE 'Carga %' AND p.negocio_id <> v.negocio_id")
    cruzadas = int(cur.fetchone()[0])
    cur.execute('SELECT bool_and(stock_actual >= 0) FROM tienda.productos')
    sin_negativos = bool(cur.fetchone()[0])
    con.close()
    print(f'  ventas por negocio: {por_negocio} · ventas cruzadas: {cruzadas} · stock sin negativos: {sin_negativos}')
    return {'por_negocio': {str(n): c for n, c in por_negocio}, 'cruzadas': cruzadas,
            'stock_negativo': not sin_negativos}


def escenario_b(n_sesiones=1000, tam_pool=16):
    print(f'\n== Escenario B · {n_sesiones} sesiones de tenant vía pool de {tam_pool} conexiones '
          f'(como saas_app) ==', flush=True)
    pool = queue.Queue()
    for _ in range(tam_pool):
        con = nueva_conexion()
        cur = con.cursor()
        cur.execute('SET ROLE saas_app')   # el rol de la app: RLS le aplica de verdad
        con.commit()
        pool.put(con)
    resultados, fugas, errores = [], [], []
    lock = threading.Lock()

    def sesion(idx):
        con = None
        try:
            con = pool.get()   # conexión EN EXCLUSIVA para esta sesión
            negocio = (idx % 2) + 1
            cur = con.cursor()
            t0 = time.perf_counter()
            cur.execute("SELECT set_config('app.negocio_id', %s, true)", (str(negocio),))
            cur.execute('SELECT count(*) AS n, COALESCE(bool_and(negocio_id = %s::integer), true) AS solo '
                        'FROM tienda.ventas', (negocio,))
            fila = cur.fetchone()
            cur.execute("SELECT set_config('app.negocio_id', '', true)")
            con.commit()
            ms = (time.perf_counter() - t0) * 1000
            with lock:
                resultados.append(ms)
                if not fila[1]:
                    fugas.append({'idx': idx, 'negocio': negocio, 'n': int(fila[0])})
        except Exception as e:  # noqa: BLE001
            with lock:
                errores.append(str(e)[:110])
        finally:
            if con is not None:
                pool.put(con)

    inicio = time.perf_counter()
    hilos = [threading.Thread(target=sesion, args=(i,)) for i in range(n_sesiones)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    total_s = time.perf_counter() - inicio
    while not pool.empty():
        con = pool.get()
        cur = con.cursor()
        cur.execute('RESET ROLE')
        con.close()

    print(f'  sesiones OK: {len(resultados) - len(errores)}/{n_sesiones} · errores: {len(errores)} '
          f'· duración: {total_s:.1f}s')
    print(f'  latencia por sesión ms · p50={pct(resultados, 50):.2f} · p95={pct(resultados, 95):.2f} · '
          f'p99={pct(resultados, 99):.2f} · máx={max(resultados) if resultados else 0:.2f}')
    print(f'  FUGAS DE AISLAMIENTO: {len(fugas)} (cero = ningún tenant vio filas ajenas)')
    for f in fugas[:3]:
        print(f'  FUGA: {f}')
    for e in errores[:3]:
        print(f'  ERROR: {e}')
    return {'sesiones': n_sesiones, 'pool': tam_pool, 'errores': len(errores),
            'fugas': len(fugas), 'total_s': round(total_s, 1),
            'p50': round(pct(resultados, 50), 2), 'p95': round(pct(resultados, 95), 2),
            'p99': round(pct(resultados, 99), 2)}


def escenario_c():
    print('\n== Escenario C · costo de RLS (misma consulta como saas_app) ==', flush=True)
    con = nueva_conexion()
    con.autocommit = True
    cur = con.cursor()
    cur.execute('SET ROLE saas_app')
    cur.execute("SELECT set_config('app.negocio_id', '1', false)")
    inicio = time.perf_counter()
    for _ in range(200):
        cur.execute('SELECT count(*) FROM tienda.productos')
        cur.fetchone()
    con_guc = (time.perf_counter() - inicio) / 200 * 1000
    cur.execute("SELECT set_config('app.negocio_id', '', false)")
    inicio = time.perf_counter()
    for _ in range(200):
        cur.execute('SELECT count(*) FROM tienda.productos')
        cur.fetchone()
    sin_guc = (time.perf_counter() - inicio) / 200 * 1000
    cur.execute('RESET ROLE')
    con.close()
    print(f'  SELECT productos con identidad:  {con_guc:.3f} ms/op')
    print(f'  SELECT productos sin GUC:        {sin_guc:.3f} ms/op (0 filas por la guarda)')
    print(f'  Costo de la guarda + políticas:  {max(0.0, con_guc - sin_guc):.3f} ms/op')
    return {'con_guc_ms': round(con_guc, 3), 'sin_guc_ms': round(sin_guc, 3),
            'costo_rls_ms': round(max(0.0, con_guc - sin_guc), 3)}


def main():
    uid2 = preparar()
    res_a = escenario_a(uid2=uid2)
    ver_a = verificar_a()
    res_b = escenario_b()
    res_c = escenario_c()

    print('\n== RESUMEN DE CARGA ==')
    print('escenario_a =', json.dumps(res_a))
    print('verificacion_a =', json.dumps(ver_a))
    print('escenario_b =', json.dumps(res_b))
    print('escenario_c =', json.dumps(res_c))


if __name__ == '__main__':
    main()
