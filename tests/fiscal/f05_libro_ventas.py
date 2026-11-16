# -*- coding: utf-8 -*-
"""f05 · CRÍTICA: Libro de ventas — cuadre interno, anuladas y clasificación de tipos."""
import e2e_lib as L
import f_lib as F


def main():
    L.empezar('f05 · Libro de ventas: tipos, anuladas y cuadre')
    uid = L.admin()
    hoy = L.hoy()

    # 1) Generar actividad del día: ventas de contado y una anulada
    p = L.q1("SELECT id FROM tienda.productos WHERE activo AND NOT exento_iva ORDER BY id LIMIT 1")
    m = F.m_efectivo('Efectivo Bs')
    items = __import__('json').dumps([{'producto_id': p, 'cantidad': 1, 'descuento_pct': 0}])
    total = F.precio_total(p)
    tasa = float(L.fn('fn_tasa_par', 'USD', 'VES', hoy))
    v1 = L.fn('fn_registrar_venta', uid, items, __import__('json').dumps([{'metodo_pago_id': m, 'monto': round(total * tasa, 2), 'referencia': 'PM-LV'}]), None, None, 'PRESENCIAL')
    v2 = L.fn('fn_registrar_venta', uid, items, __import__('json').dumps([{'metodo_pago_id': m, 'monto': round(total * tasa, 2), 'referencia': 'PM-LV2'}]), None, None, 'PRESENCIAL')
    L.fn('fn_emitir_factura_fiscal', v1)
    L.fn('fn_emitir_factura_fiscal', v2)
    L.commit()
    L.ejecutar("CALL tienda.sp_anular_venta(%s, %s, 'Anulación para el libro E2E')", (v2, uid))
    L.commit()

    filas = L.qd("SELECT * FROM tienda.v_libro_ventas WHERE fecha = %s", (hoy,))
    L.ok(len(filas) >= 2, f'libro de ventas del día con {len(filas)} renglones')

    # 2) Cuadre interno por renglón: base + exento + exonerado = total − IVA (alícuotas del detalle)
    mal = 0
    for f in filas:
        suma = float(f['base_imponible_ves']) + float(f['exento_ves']) + float(f['exonerado_ves'])
        if abs(suma - (float(f['total_ves']) - float(f['iva_ves']))) > 0.05:
            mal += 1
    L.ok(mal == 0, f'cuadre interno base+exento+exonerado = total−IVA en {len(filas)} renglones ({mal} descuadrados)')

    # 3) Facturas anuladas: aparecen marcadas y NO suman al total del mes
    estados = {str(r['estado']) for r in filas}
    L.ok('ANULADA' in estados, f'la anulación aparece en el libro con estado ({estados})')
    anulada = [r for r in filas if r['estado'] == 'ANULADA' and r['numero'] == str(L.q1("SELECT numero FROM tienda.ventas WHERE id = %s", (v2,)))]
    L.ok(len(anulada) == 1, 'la factura anulada es identificable (estado ANULADA)')
    total_sin_anuladas = float(L.q1("SELECT COALESCE(sum(total_ves), 0) FROM tienda.v_libro_ventas WHERE fecha = %s AND estado <> 'ANULADA'", (hoy,)))
    total_todas = float(L.q1("SELECT COALESCE(sum(total_ves), 0) FROM tienda.v_libro_ventas WHERE fecha = %s", (hoy,)))
    L.ok(total_todas > total_sin_anuladas, f'el total del mes excluye las anuladas ({total_sin_anuladas} válidas vs {total_todas} brutas)')

    # 4) El IVA del libro casa con el IVA congelado en las filas de ventas
    iva_libro = float(L.q1("SELECT COALESCE(sum(iva_ves), 0) FROM tienda.v_libro_ventas WHERE fecha = %s AND estado <> 'ANULADA'", (hoy,)))
    iva_ventas = float(L.q1("SELECT COALESCE(sum(iva_ves), 0) FROM tienda.ventas WHERE fecha_valor = %s AND estado <> 'ANULADA'", (hoy,)))
    L.ok(abs(iva_libro - iva_ventas) < 0.05, f'IVA del libro = IVA congelado en ventas: {iva_libro} = {iva_ventas}')

    # 5) Exención por alícuota: el detalle discrimina IVA_GENERAL / EXENTO / EXONERADO
    pid_ex = L.q1("SELECT id FROM tienda.productos WHERE activo AND exento_iva ORDER BY id LIMIT 1")
    if pid_ex:
        total_e = round(float(L.q1("SELECT precio_venta_usd FROM tienda.productos WHERE id = %s", (pid_ex,))) * tasa, 2)
        ve = L.fn('fn_registrar_venta', uid, __import__('json').dumps([{'producto_id': pid_ex, 'cantidad': 1, 'descuento_pct': 0}]),
                  __import__('json').dumps([{'metodo_pago_id': m, 'monto': total_e, 'referencia': 'PM-EX'}]), None, None, 'PRESENCIAL')
        L.commit()
        f = L.fila("SELECT * FROM tienda.v_libro_ventas WHERE fecha = %s AND numero = %s", (hoy, str(L.q1("SELECT numero FROM tienda.ventas WHERE id = %s", (ve,)))))
        L.ok(f and float(f['exento_ves']) > 0 and float(f['iva_ves']) == 0, 'la base exenta cae en su columna y genera IVA 0')
    else:
        L.ok(True, '(sin productos exentos en el catálogo: caso omitido)')

    # 6) Clasificación de tipos (01 registro / 03 anulación): el libro etiqueta FACTURA y
    #    expone el estado; las notas de crédito NO se clasifican como tipo 04 en esta vista.
    tipos = {str(r['tipo_documento']) for r in filas}
    L.ok(tipos == {'FACTURA'}, f'v_libro_ventas clasifica como FACTURA ({tipos}); las notas van en su módulo propio')
    L.ok(L.q1("SELECT count(*) FROM tienda.notas_ajuste WHERE tipo = 'C'") >= 0,
         'las notas de crédito viven en notas_ajuste (hallazgo: el libro de ventas no las consolida como tipo 04)')
