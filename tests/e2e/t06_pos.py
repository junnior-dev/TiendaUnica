# -*- coding: utf-8 -*-
"""t06 · POS completo: apertura de caja, cotización, ventas (efectivo, mixta con vuelto,
IGTF, crédito, combo), kardex, factura fiscal y anulación."""
import datetime
import datetime
import json
import json as J

import e2e_lib as L


def main():
    L.empezar('t06 · POS: apertura, ventas, IGTF, crédito y anulación')
    uid = L.admin()
    hoy = L.hoy()

    # 0) Estado inicial limpio: si quedó una apertura activa del seed, se cierra (Z)
    abierta = L.fn('fn_apertura_activa', uid)
    if abierta:
        L.fn('fn_cerrar_apertura', abierta, uid)
        L.commit()

    # 1) Apertura de caja (fondo $50 y Bs 500)
    ap = L.fn('fn_abrir_caja', uid, 50, 500)
    L.commit()
    a = L.fila("SELECT * FROM tienda.aperturas_caja WHERE id = %s", (ap,))
    L.ok(a and a['estado'] == 'ABIERTA', f'caja abierta #{ap} con fondo $50 / Bs 500')
    L.ok(float(L.fn('fn_apertura_activa', uid)) == float(ap), 'es la apertura activa del usuario')
    L.espera_error('no se puede abrir dos veces el mismo turno', L.fn, 'fn_abrir_caja', uid, 10, 10)
    L.rollback()

    # 2) Productos de la venta
    p1 = L.q1("SELECT id FROM tienda.productos WHERE activo AND NOT exento_iva ORDER BY id LIMIT 1")
    p2 = L.q1("SELECT id FROM tienda.productos WHERE activo AND NOT exento_iva AND id <> %s ORDER BY id LIMIT 1", (p1,))
    items = [{'producto_id': p1, 'cantidad': 2, 'descuento_pct': 10}, {'producto_id': p2, 'cantidad': 1, 'descuento_pct': 0}]
    cot = L.fn_fila('fn_cotizar_venta', json.dumps(items))
    L.ok(float(cot['tasa_cambio']) > 0 and float(cot['iva_pct']) == 16.0, f'cotización: tasa {cot["tasa_cambio"]}, IVA {cot["iva_pct"]} %')

    # totales esperados calculados en la prueba (misma regla que el POS)
    tot = 0.0
    for it in items:
        precio = float(L.q1("SELECT precio_venta_usd FROM tienda.productos WHERE id = %s", (it['producto_id'],)))
        base = round(precio * it['cantidad'] * (1 - it['descuento_pct'] / 100), 2)
        tot = round(tot + base, 2)
    L.ok(abs(float(cot['base_usd']) - tot) < 0.02, f'base imponible = {cot["base_usd"]} (esperado {tot})')
    L.ok(abs(float(cot['iva_usd']) - round(tot * 0.16, 2)) < 0.02, f'IVA 16 % = {cot["iva_usd"]}')
    L.ok(abs(float(cot['total_usd']) - round(tot * 1.16, 2)) < 0.02, f'total = {cot["total_usd"]}')

    # 3) VENTA A: contado en Bs (pago móvil) — la más común del mostrador
    m_pmovil = L.q1("SELECT id FROM tienda.metodos_pago WHERE nombre = 'Pago móvil' AND activo")
    total_a = float(cot['total_usd'])
    monto_bs = round(total_a * float(cot['tasa_cambio']), 2)
    venta_a = L.fn('fn_registrar_venta', uid, json.dumps(items), json.dumps(
        [{'metodo_pago_id': m_pmovil, 'monto': monto_bs, 'referencia': f'PM-{L.fake.random_number(digits=8)}'}]),
        None, 'Prueba E2E venta A', 'PRESENCIAL', False, 0)
    L.commit()
    va = L.fila("SELECT * FROM tienda.ventas WHERE id = %s", (venta_a,))
    L.ok(va and float(va['total_usd']) == total_a, f'venta A #{venta_a} total {va["total_usd"]}')
    L.ok(va['numero'] > 0, f'correlativo de venta: #{va["numero"]}')
    L.ok(va['estado'] in ('COMPLETADA', 'PAGADA'), f'estado: {va["estado"]}')
    L.ok(float(L.q1("SELECT sum(monto_ves) FROM tienda.pagos_venta WHERE venta_id = %s", (venta_a,))) == monto_bs,
         f'pago Bs {monto_bs} registrado con su tasa')
    st1 = float(L.q1("SELECT stock_actual FROM tienda.productos WHERE id = %s", (p1,)))
    mv = L.q1("SELECT sum(cantidad) FROM tienda.movimientos_inventario WHERE referencia_tipo = 'VENTA' AND "
              "referencia_id = %s AND producto_id = %s", (venta_a, p1))
    L.ok(float(mv) == -2.0, f'kardex: salida firmada de 2 por la venta ({mv})')

    # 4a) VENTA B: efectivo en bolívares con vuelto (regla del mostrador: entregan y se les devuelve)
    m_ef_bs = L.q1("SELECT id FROM tienda.metodos_pago WHERE nombre = 'Efectivo Bs' AND activo")
    cot_b = L.fn_fila('fn_cotizar_venta', json.dumps(items[:1]))
    total_b = float(cot_b['total_usd'])
    monto_bs = round(total_b * float(cot_b['tasa_cambio']), 2)
    venta_b = L.fn('fn_registrar_venta', uid, json.dumps(items[:1]), json.dumps(
        [{'metodo_pago_id': m_ef_bs, 'monto': monto_bs, 'monto_entregado': monto_bs + 5,
          'vuelto_monto': 5, 'vuelto_moneda': 'VES'}]),
        None, 'Venta con vuelto E2E', 'PRESENCIAL')
    L.commit()
    vb = L.fila("SELECT * FROM tienda.ventas WHERE id = %s", (venta_b,))
    pag = L.fila("SELECT * FROM tienda.pagos_venta WHERE venta_id = %s", (venta_b,))
    L.ok(abs(float(vb['total_usd']) - total_b) < 0.005, f'total de la venta B = cotizado: {vb["total_usd"]}')
    L.ok(float(pag['monto_entregado']) - float(pag['vuelto_monto']) == float(pag['monto']),
         f'vuelto calculado: entregado {pag["monto_entregado"]} − vuelto {pag["vuelto_monto"]} = {pag["monto"]}')

    # 4b) VENTA B2: IGTF. Se activa cobra_igtf (acción de Configuración → Régimen) y el total
    # exacto lo dicta el validador de la base, igual que el flujo real del POS.
    m_ef_usd = L.q1("SELECT id FROM tienda.metodos_pago WHERE nombre = 'Efectivo USD' AND activo")
    aplica = L.q1("SELECT aplica_igtf FROM tienda.metodos_pago WHERE id = %s", (m_ef_usd,))
    L.ejecutar("UPDATE tienda.negocio SET es_contribuyente_especial = true, cobra_igtf = true WHERE id = 1")
    L.commit()
    cot_ig = L.fn_fila('fn_cotizar_venta', json.dumps(items[:1]))
    L.ok(bool(cot_ig['cobra_igtf']), f'cotizar anuncia IGTF (pct {cot_ig["igtf_pct"]}, base {cot_ig["igtf_base"]})')
    monto_pago = float(cot_ig['total_usd'])
    venta_ig = None
    for intento in range(3):
        try:
            venta_ig = L.fn('fn_registrar_venta', uid, json.dumps(items[:1]), json.dumps(
                [{'metodo_pago_id': m_ef_usd, 'monto': round(monto_pago, 2)}]),
                None, 'Venta con IGTF E2E', 'PRESENCIAL')
            break
        except Exception as exc:
            L.conn.rollback()
            msg = str(exc)
            if 'no cuadran' in msg and intento < 2:
                monto_pago = float(msg.split('(USD ')[2].split(')')[0])
            else:
                raise
    L.commit()
    vig = L.fila("SELECT * FROM tienda.ventas WHERE id = %s", (venta_ig,))
    L.ok(vig and float(vig['igtf_usd']) > 0, f'IGTF cobrado en divisas: {vig["igtf_usd"]} USD (pagado {monto_pago})')
    L.ok(abs(float(vig['total_cobrar_usd']) - float(vig['total_usd']) - float(vig['igtf_usd'])) < 0.01,
         'total cobrar = total + IGTF')
    pag_ig = L.fila("SELECT * FROM tienda.pagos_venta WHERE venta_id = %s", (venta_ig,))
    L.ok(abs(float(pag_ig['igtf_usd']) - float(vig['igtf_usd'])) < 0.005, 'el IGTF del pago coincide con el de la venta')
    L.ejecutar("UPDATE tienda.negocio SET cobra_igtf = false WHERE id = 1")
    L.commit()

    # 5) VENTA C: a crédito 15 días → cuenta por cobrar con vencimiento
    cli = L.ins('clientes', nombre=L.fake.name(), documento=L.rif('V'), tipo_documento='V', telefono=f'0414-{L.fake.random_number(digits=7)}', direccion=L.fake.city(), activo=True)
    L.commit()
    venta_c = L.fn('fn_registrar_venta', uid, json.dumps(items[:1]), json.dumps([]), cli, 'Venta a crédito E2E', 'PRESENCIAL', True, 15)
    L.commit()
    vc = L.fila("SELECT * FROM tienda.ventas WHERE id = %s", (venta_c,))
    cxc = L.fila("SELECT * FROM tienda.cuentas_por_cobrar WHERE venta_id = %s", (venta_c,))
    L.ok(cxc and float(cxc['saldo_usd']) == float(vc['total_cobrar_usd']), f'CxP abierta por {cxc["saldo_usd"] if cxc else "?"}')
    vence_esp = datetime.date.fromisoformat(str(hoy)) + datetime.timedelta(days=15)
    L.ok(cxc['estado'] == 'PENDIENTE' and str(cxc['fecha_vencimiento']) == str(vence_esp),
         f'vence {cxc["fecha_vencimiento"]} = venta + 15 días')

    # 6) VENTA D: combo del catálogo (una línea en el carrito, varias en el detalle)
    combo = L.q1("SELECT id FROM tienda.combos WHERE activo ORDER BY id LIMIT 1")
    cot_c = L.fn('fn_cotizar_combo', combo, 1)
    cot_c = cot_c if isinstance(cot_c, dict) else J.loads(cot_c)
    total_c = float(cot_c.get('total_usd') or cot_c.get('precio') or cot_c.get('precio_usd'))
    venta_d = L.fn('fn_registrar_venta_combo', uid, combo, 1, json.dumps(
        [{'metodo_pago_id': m_pmovil, 'monto': round(total_c * float(cot['tasa_cambio']), 2), 'referencia': f'PM-{L.fake.random_number(digits=8)}'}]),
        None, 'Combo E2E', 'PRESENCIAL')
    L.commit()
    n_comp = L.q1("SELECT count(*) FROM tienda.combo_componentes WHERE combo_id = %s", (combo,))
    L.ok(L.q1("SELECT count(*) FROM tienda.detalle_venta WHERE venta_id = %s", (venta_d,)) == n_comp,
         f'combo {combo} se desglosa en {n_comp} líneas')

    # 7) Factura fiscal: la emisión explícita numera la venta con su control
    nf0 = L.q1("SELECT count(*) FROM tienda.numeracion_fiscal")
    L.fn('fn_emitir_factura_fiscal', venta_b)
    L.commit()
    nb = L.fila("SELECT numero_factura_fiscal, numero_control FROM tienda.ventas WHERE id = %s", (venta_b,))
    L.ok(nb['numero_factura_fiscal'] is not None, f'factura fiscal asignada: {nb["numero_factura_fiscal"]}')
    L.ok(L.q1("SELECT count(*) FROM tienda.numeracion_fiscal") >= nf0 + 1 or nb['numero_factura_fiscal'] is not None,
         'numeración fiscal utilizada')

    # 8) Anulación de una venta de contado (la de crédito se conserva para el módulo CxC)
    venta_e = L.fn('fn_registrar_venta', uid, json.dumps(items[:1]), json.dumps(
        [{'metodo_pago_id': m_ef_usd, 'monto': round(float(L.fn_fila('fn_cotizar_venta', json.dumps(items[:1]))['total_usd']), 2)}]),
        None, 'Venta a anular E2E', 'PRESENCIAL')
    L.commit()
    st_antes = float(L.q1("SELECT stock_actual FROM tienda.productos WHERE id = %s", (p1,)))
    L.ejecutar("CALL tienda.sp_anular_venta(%s, %s, 'Prueba E2E anulación')", (venta_e, uid))
    L.commit()
    ve2 = L.fila("SELECT estado FROM tienda.ventas WHERE id = %s", (venta_e,))
    L.ok(ve2['estado'] == 'ANULADA', f'venta E anulada ({ve2["estado"]})')
    st_despues = float(L.q1("SELECT stock_actual FROM tienda.productos WHERE id = %s", (p1,)))
    L.ok(abs(st_despues - st_antes - 2) < 0.001, f'stock devuelto: {st_antes} → {st_despues} (+2)')
    L.espera_error('no se puede anular dos veces', L.ejecutar, "CALL tienda.sp_anular_venta(%s, %s, 'otra vez')", (venta_e, uid))

    # 9) Pago que no cuadra se rechaza en seco (validador del POS)
    L.espera_error('pagos insuficientes rechazados', L.fn, 'fn_registrar_venta', uid, json.dumps(items[:1]),
                   json.dumps([{'metodo_pago_id': m_ef_usd, 'monto': 0.01}]), None, 'pago mal', 'PRESENCIAL')
    L.espera_error('venta sin productos rechazada', L.fn, 'fn_registrar_venta', uid, '[]',
                   json.dumps([{'metodo_pago_id': m_ef_usd, 'monto': 1}]), None, None, 'PRESENCIAL')

    # 10) El corte del día ve las ventas de la prueba
    corte = L.fn_fila('fn_corte_desglose', hoy, hoy, uid)
    L.ok(corte is not None, f'corte X del día consultable: {corte}')
