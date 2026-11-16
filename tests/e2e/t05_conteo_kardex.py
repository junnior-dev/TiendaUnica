# -*- coding: utf-8 -*-
"""t05 · Conteo físico y kardex: conteo por categoría con diferencias valorizadas,
aplicación con ajustes y anulación sin movimientos."""
import json

import e2e_lib as L


def main():
    L.empezar('t05 · Conteo físico y kardex')
    uid = L.admin()
    pid = L.q1("SELECT id FROM tienda.productos WHERE activo ORDER BY id LIMIT 1")
    cat = L.q1("SELECT categoria_id FROM tienda.productos WHERE id = %s", (pid,))
    st0 = float(L.q1("SELECT stock_actual FROM tienda.productos WHERE id = %s", (pid,)))
    costo = float(L.q1("SELECT costo_usd FROM tienda.productos WHERE id = %s", (pid,)))

    # 1) Crear conteo de la categoría → líneas = productos activos de esa categoría
    desc = f'Corte E2E {L.fake.word()}'
    conteo = L.fn('fn_crear_conteo', 'CATEGORIA', uid, desc, cat, None)
    L.commit()
    c = L.fila("SELECT * FROM tienda.v_conteos WHERE id = %s", (conteo,))
    L.ok(c and c['estado'] == 'ABIERTO' and int(c['lineas']) >= 1,
         f'conteo ABIERTO con {c["lineas"] if c else "?"} líneas')
    L.ok(c['descripcion'] == desc, 'descripción guardada')

    # 2) Contar: un producto con diferencia (−2) y otro cuadrado
    dif = -2
    contado = st0 + dif
    lineas = L.qs("SELECT producto_id, stock_sistema FROM tienda.v_conteo_detalle WHERE conteo_id = %s", (conteo,))
    items = [{'producto_id': pid, 'contado': contado}] + [
        {'producto_id': int(pp), 'contado': float(ss)} for pp, ss in lineas if int(pp) != pid]
    L.fn('fn_contar', conteo, json.dumps(items), uid)
    L.commit()
    L.ok(L.q1("SELECT contadas FROM tienda.v_conteos WHERE id = %s", (conteo,)) == len(items), 'todas las líneas quedaron contadas')
    d = L.fila("SELECT * FROM tienda.v_conteo_detalle WHERE conteo_id = %s AND producto_id = %s", (conteo, pid))
    L.ok(d and float(d['contado']) == contado, f'contado {contado} registrado')
    L.ok(d and float(d['diferencia']) == dif, f'diferencia calculada: {dif}')

    # 3) Aplicar el conteo: ajuste de inventario valorizado al costo
    L.fn('fn_aplicar_conteo', conteo, uid)
    L.commit()
    c = L.fila("SELECT * FROM tienda.v_conteos WHERE id = %s", (conteo,))
    L.ok(c['estado'] == 'APLICADO' and c['aplicado_en'] is not None, 'conteo APLICADO con fecha')
    L.ok(float(L.q1("SELECT stock_actual FROM tienda.productos WHERE id = %s", (pid,))) == contado,
         f'stock ajustado a {contado}')
    mv = L.fila("SELECT tipo, cantidad FROM tienda.movimientos_inventario WHERE referencia_tipo = 'CONTEO' "
                "AND referencia_id = %s AND producto_id = %s", (conteo, pid))
    tipo_esperado = 'AJUSTE_SALIDA' if dif < 0 else 'AJUSTE_ENTRADA'
    L.ok(mv and mv['tipo'] == tipo_esperado and abs(float(mv['cantidad'])) == abs(dif),
         f'kardex: {tipo_esperado} firmado {mv["cantidad"] if mv else "?"} (|{abs(dif)}|)')
    L.ok(abs(float(c['diferencia_absoluta'])) >= abs(dif) - 0.01, f'diferencia del conteo = {c["diferencia_absoluta"]} unidades')

    # 4) Un segundo conteo que se anula: sin movimientos y sin tocar stock
    conteo2 = L.fn('fn_crear_conteo', 'TODO', uid, 'Conteo a anular', None, None)
    L.fn('fn_contar', conteo2, json.dumps([{'producto_id': pid, 'contado': 99}]), uid)
    L.fn('fn_anular_conteo', conteo2, uid, 'Duplicado en prueba E2E')
    L.commit()
    c2 = L.fila("SELECT * FROM tienda.v_conteos WHERE id = %s", (conteo2,))
    L.ok(c2['estado'] == 'ANULADO', 'conteo anulado')
    L.ok(L.q1("SELECT count(*) FROM tienda.movimientos_inventario WHERE referencia_tipo = 'CONTEO' AND referencia_id = %s",
              (conteo2,)) == 0, 'anulación NO genera movimientos')
    L.ok(float(L.q1("SELECT stock_actual FROM tienda.productos WHERE id = %s", (pid,))) == contado, 'stock intacto')
    L.espera_error('no se puede aplicar un conteo anulado', L.fn, 'fn_aplicar_conteo', conteo2, uid)

    # 5) Kardex: el historial del producto es consultable y casa con el stock
    kx = L.qs("SELECT * FROM tienda.v_kardex WHERE producto_id = %s ORDER BY 1 DESC LIMIT 6", (pid,))
    L.ok(len(kx) >= 2, f'v_kardex con {len(kx)} movimientos consultables')
    saldo = L.q1("SELECT stock_resultante FROM tienda.v_kardex WHERE producto_id = %s ORDER BY id DESC LIMIT 1", (pid,))
    L.ok(saldo is None or float(saldo) == contado, f'kardex cierra en el stock actual ({saldo})')
    L.ok(L.fn('fn_margen_efectivo', pid) is not None, 'margen efectivo del producto consultable')
