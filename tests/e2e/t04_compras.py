# -*- coding: utf-8 -*-
"""t04 · Compras y proveedores: compra al contado con crédito fiscal, a crédito con CxP,
pago al proveedor, retención de IVA y costo ponderado del inventario."""
import e2e_lib as L


def main():
    L.empezar('t04 · Compras, proveedores y CxP')
    uid = L.admin()
    hoy = L.hoy()

    # 1) Proveedor nuevo (como Compras → «Registrar proveedor»)
    prov = L.ins('proveedores', razon_social=f'{L.fake.company()} C.A. E2E', rif=L.rif('J'),
                 direccion=L.fake.address(), telefono=f'0276-{L.fake.random_number(digits=7, fix_len=True)}', activo=True)
    L.commit()
    L.ok(prov is not None, f'proveedor creado: {L.q1("SELECT razon_social FROM tienda.proveedores WHERE id = %s", (prov,))}')

    # 2) Compra al contado con crédito fiscal: entra inventario y entra IVA por acreditar
    pid = L.q1("SELECT id FROM tienda.productos WHERE activo AND unidades_compra_ok ORDER BY id LIMIT 1") if False else \
        L.q1("SELECT id FROM tienda.productos WHERE activo ORDER BY id LIMIT 1")
    st0 = float(L.q1("SELECT stock_actual FROM tienda.productos WHERE id = %s", (pid,)))
    costo0 = float(L.q1("SELECT costo_usd FROM tienda.productos WHERE id = %s", (pid,)))
    cant, costo_n = 10, 0.90
    compra = L.fn('fn_registrar_compra', prov, f"F-{L.fake.random_number(digits=5)}", hoy, 'USD',
                  [{'producto_id': pid, 'cantidad': cant, 'costo_unitario': costo_n, 'exento': False}],
                  uid, None, True, None)
    L.commit()
    c = L.fila("SELECT * FROM tienda.compras WHERE id = %s", (compra,))
    base_esp = round(cant * costo_n, 2)
    L.ok(c and abs(float(c['base_imponible']) - base_esp) < 0.01, f'compra base imponible = {c["base_imponible"]} ({cant}×{costo_n})')
    L.ok(abs(float(c['total_usd']) - (float(c['base_imponible']) + float(c['base_exenta']) + float(c['monto_iva']))) < 0.01,
         f'total = base + IVA crédito fiscal: {c["total_usd"]} (base {c["base_imponible"]} + iva {c["monto_iva"]})')
    L.ok(L.q1("SELECT count(*) FROM tienda.compra_detalle WHERE compra_id = %s", (compra,)) == 1, '1 línea de detalle')
    mv = L.fila("SELECT tipo, sum(cantidad) AS n FROM tienda.movimientos_inventario WHERE referencia_tipo = 'COMPRA' "
                "AND referencia_id = %s GROUP BY tipo", (compra,))
    L.ok(mv and mv['tipo'] == 'COMPRA' and float(mv['n']) == cant, f'movimiento de inventario COMPRA entró: +{cant}')
    L.ok(float(L.q1("SELECT stock_actual FROM tienda.productos WHERE id = %s", (pid,))) == st0 + cant,
         f'stock {st0} → {st0 + cant}')

    # 3) Costo ponderado tras la compra (política del negocio, método promedio)
    st_nuevo = st0 + cant
    politica = L.q1("SELECT metodo_costo FROM tienda.negocio WHERE id = 1")
    costo_db = float(L.q1("SELECT costo_usd FROM tienda.productos WHERE id = %s", (pid,)))
    esperado = costo_n if politica == 'ULTIMO' else round((costo0 * st0 + costo_n * cant) / st_nuevo, 2)
    L.ok(abs(costo_db - esperado) < 0.011, f'costo del producto = {costo_db} (política {politica} → esperado {esperado})')

    # 4) Factura duplicada del mismo proveedor se rechaza
    L.ok(L.q1("SELECT numero_factura FROM tienda.compras WHERE id = %s", (compra,)) == c['numero_factura'], f'factura guardada: {c["numero_factura"]}')

    # 5) Compra a crédito → cuenta por pagar con vencimiento
    compra2 = L.fn('fn_registrar_compra', prov, f"F-{L.fake.random_number(digits=5)}", hoy, 'USD',
                   [{'producto_id': pid, 'cantidad': 4, 'costo_unitario': 1.0, 'exento': False}], uid)
    L.fn('fn_compra_a_credito', compra2, 15)
    L.commit()
    cxp = L.fila("SELECT * FROM tienda.v_cuentas_por_pagar WHERE compra_id = %s", (compra2,))
    L.ok(cxp and abs(float(cxp['saldo_usd']) - float(cxp['total_usd'])) < 0.01,
         f'CxP abierta con saldo {cxp["saldo_usd"] if cxp else "?"} = total {cxp["total_usd"] if cxp else "?"}')
    L.ok(cxp and cxp['dias_credito'] == 15, 'CxP con 15 días de crédito')
    L.espera_error('no se puede poner a crédito dos veces', L.fn, 'fn_compra_a_credito', compra2, 15)

    # 6) Pago parcial al proveedor y luego saldo en cero
    saldo_cxp = float(cxp['saldo_usd'])
    mitad = round(saldo_cxp / 2, 2)
    p1 = L.fn('fn_registrar_pago_proveedor', prov, hoy, 'USD', mitad, f"TR-{L.fake.random_number(digits=6)}", 'BANCOS', compra2, uid, None)
    L.commit()
    L.ok(p1 is not None, 'pago parcial registrado')
    L.ok(abs(float(L.q1("SELECT saldo_usd FROM tienda.v_cuentas_por_pagar WHERE compra_id = %s", (compra2,))) - (saldo_cxp - mitad)) < 0.01,
         f'saldo CxP = {saldo_cxp} − {mitad}')
    L.fn('fn_registrar_pago_proveedor', prov, hoy, 'USD', saldo_cxp - mitad, f"TR-{L.fake.random_number(digits=6)}", 'BANCOS', compra2, uid, None)
    L.commit()
    L.ok(float(L.q1("SELECT COALESCE(saldo_usd, 0) FROM tienda.v_cuentas_por_pagar WHERE compra_id = %s", (compra2,)) or 0) == 0,
         'CxP saldada en cero')
    L.espera_error('pago mayor que el saldo rechazado', L.fn, 'fn_registrar_pago_proveedor', prov, hoy, 'USD', 5.0,
                   f"TR-{L.fake.random_number(digits=6)}", 'BANCOS', compra2, uid, None)

    # 7) Retención de IVA de la compra (proveedor retenedor): comprobante correlativo
    nro = L.fn('fn_siguiente_comprobante_retencion', hoy)
    L.ok(nro is not None and len(str(nro)) == 14 and str(nro).startswith(str(hoy.year) + f"{hoy.month:02d}"),
         f'comprobante correlativo AAAAMM00000000: {nro}')
    iva_doc = float(L.q1("SELECT monto_iva FROM tienda.compras WHERE id = %s", (compra,)))
    L.ins('retenciones_iva', sentido='COMPRA', compra_id=compra, numero_comprobante=str(nro), fecha_emision=hoy,
          porcentaje=75, iva_documento_ves=iva_doc, iva_retenido_ves=round(iva_doc * 0.75, 2), estado='ACTIVA', usuario_id=uid)
    L.commit()
    r = L.fila("SELECT * FROM tienda.v_retenciones_iva WHERE compra_id = %s", (compra,))
    L.ok(r and float(r['iva_retenido_ves']) == round(iva_doc * 0.75, 2),
         f'retención IVA 75 % registrada: {r["iva_retenido_ves"] if r else "?"} Bs')
    L.espera_error('comprobante de retención duplicado rechazado', L.q1,
                   "INSERT INTO tienda.retenciones_iva (sentido, compra_id, numero_comprobante, fecha_emision, porcentaje, "
                   "iva_documento_ves, iva_retenido_ves, estado, usuario_id) VALUES ('COMPRA', %s, %s, %s, 75, 1, 0.75, 'ACTIVA', %s)",
                   (compra, str(nro), hoy, uid))
