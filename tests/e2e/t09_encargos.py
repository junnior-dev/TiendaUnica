# -*- coding: utf-8 -*-
"""t09 · Encargos de piezas: ciclo completo solicitar→ordenar→recibir→avisar→anticipo→entregar."""
import json

import e2e_lib as L


def main():
    L.empezar('t09 · Encargos de piezas (ciclo completo)')
    uid = L.admin()
    cli = L.q1("SELECT id FROM tienda.clientes WHERE activo ORDER BY id DESC LIMIT 1")
    if not cli:
        cli = L.ins('clientes', nombre=L.fake.name(), documento=L.rif('V'), tipo_documento='V',
                    telefono=f'0414-{L.fake.random_number(digits=7)}', direccion=L.fake.city(), activo=True)
        L.commit()
    m_pmovil = L.q1("SELECT id FROM tienda.metodos_pago WHERE nombre = 'Pago móvil' AND activo")
    m_ef = L.q1("SELECT id FROM tienda.metodos_pago WHERE nombre = 'Efectivo USD' AND activo")

    # 1) Solicitar (sin producto del catálogo: pieza pedida al proveedor)
    desc = f'Pieza encargada {L.fake.word()} para moto del cliente E2E'
    precio = 48.5
    prod_enc = L.ins('productos', sku=f"E2E-ENC{L.fake.random_int(100, 999)}", nombre='Pieza encargada E2E',
                     unidad='UND', costo_usd=30, margen_pct=35, precio_venta_usd=48.5, stock_actual=0,
                     stock_minimo=0, activo=True)
    L.commit()
    enc = L.fn('fn_crear_encargo', cli, desc, 1, prod_enc, precio, None, uid)
    L.commit()
    e = L.fila("SELECT * FROM tienda.v_encargos WHERE id = %s", (enc,))
    L.ok(e and e['estado'] == 'SOLICITADO', f'encargo #{enc} SOLICITADO')
    L.ok(e['cliente'] is not None, 'el encargo queda ligado al cliente')

    # 2) Estados con nota: ORDENADO → RECIBIDO → AVISADO (fechas se van llenando)
    L.fn('fn_cambiar_estado_encargo', enc, 'ORDENADO', uid, f'Pedida a {L.fake.company()}')
    L.commit()
    L.ok(L.q1("SELECT fecha_orden FROM tienda.encargos WHERE id = %s", (enc,)) is not None, 'ORDENADO con fecha de orden')
    L.fn('fn_cambiar_estado_encargo', enc, 'RECIBIDO', uid, 'Llegó al almacén')
    L.commit()
    L.ok(L.q1("SELECT fecha_llegada FROM tienda.encargos WHERE id = %s", (enc,)) is not None, 'RECIBIDO con fecha de llegada')
    # La pieza recibida entra al inventario (entrada de 1 al costo del encargo)
    prov = L.q1("SELECT id FROM tienda.proveedores WHERE activo ORDER BY id LIMIT 1") or \
        L.ins('proveedores', razon_social=f'{L.fake.company()} C.A.', rif=L.rif('J'), activo=True)
    L.fn('fn_registrar_compra', prov, f"F-ENC-{L.fake.random_number(digits=5)}", L.hoy(), 'USD',
         [{'producto_id': prod_enc, 'cantidad': 1, 'costo_unitario': 30, 'exento': False}], uid)
    L.commit()
    L.ok(float(L.q1("SELECT stock_actual FROM tienda.productos WHERE id = %s", (prod_enc,))) == 1, 'pieza recibida entra al inventario (+1)')
    L.fn('fn_cambiar_estado_encargo', enc, 'AVISADO', uid, 'Cliente avisado por WhatsApp')
    L.commit()
    L.ok(L.q1("SELECT fecha_aviso FROM tienda.encargos WHERE id = %s", (enc,)) is not None, 'AVISADO con fecha de aviso')
    L.espera_error('no se puede saltar a ENTREGAR desde un estado inválido', L.fn, 'fn_cambiar_estado_encargo', enc, 'SOLICITADO', uid, 'regreso inválido')

    # 3) Anticipo: entra a caja como movimiento de origen ENCARGO
    n_mov0 = L.q1("SELECT count(*) FROM tienda.movimientos_caja WHERE origen = 'ENCARGO'")
    L.fn('fn_cobrar_anticipo_encargo', enc, m_pmovil, 365, uid, f'PM-{L.fake.random_number(digits=8)}')
    L.commit()
    L.ok(L.q1("SELECT count(*) FROM tienda.movimientos_caja WHERE origen = 'ENCARGO'") == n_mov0 + 1, 'anticipo entró a caja')
    pg = L.fila("SELECT * FROM tienda.encargos_pagos WHERE encargo_id = %s", (enc,))
    tasa_vusd = float(L.fn('fn_tasa_par', 'VES', 'USD', L.hoy()))
    esperado_usd = round(365 * tasa_vusd, 2)
    L.ok(pg and abs(float(pg['monto_usd']) - esperado_usd) < 0.01, f'anticipo Bs 365 = {pg["monto_usd"] if pg else "?"} USD')
    e = L.fila("SELECT anticipado_usd, n_anticipos FROM tienda.v_encargos WHERE id = %s", (enc,))
    L.ok(abs(float(e['anticipado_usd']) - esperado_usd) < 0.01 and int(e['n_anticipos']) == 1, 'resumen del encargo refleja el anticipo')

    # 4) Entrega: saldo = precio pactado − anticipos (los datos del encargo no se editan después)
    venta = L.fn('fn_entregar_encargo', enc, json.dumps([{'metodo_pago_id': m_ef, 'monto': round(precio * 1.16 - 10, 2), 'referencia': None}]),
                 uid, 0, 'PRESENCIAL', None)
    L.commit()
    ev = L.fila("SELECT * FROM tienda.v_encargos WHERE id = %s", (enc,))
    L.ok(ev['estado'] == 'ENTREGADO' and ev['venta_id'] == venta, f'entregado → venta #{venta}')
    L.ok(abs(float(ev['anticipado_usd']) - 10) < 0.01, 'anticipos quedan en el historial de la entrega')
    L.ok(L.q1("SELECT count(*) FROM tienda.ventas WHERE id = %s", (venta,)) == 1, 'venta de la entrega existe')
    L.espera_error('no se puede entregar el mismo encargo dos veces', L.fn, 'fn_entregar_encargo', enc,
                   json.dumps([{'metodo_pago_id': m_ef, 'monto': 1}]), uid, 0, 'PRESENCIAL', None)

    # 5) Cancelación con motivo obligatorio y KPI del módulo
    enc2 = L.fn('fn_crear_encargo', cli, f'Encargo a cancelar {L.fake.word()}', 1, None, None, None, uid)
    L.commit()
    L.espera_error('cancelar sin motivo rechazado', L.fn, 'fn_cambiar_estado_encargo', enc2, 'CANCELADO', uid, '')
    L.fn('fn_cambiar_estado_encargo', enc2, 'CANCELADO', uid, 'El cliente la consiguió por otro lado')
    L.commit()
    L.ok(L.q1("SELECT estado FROM tienda.encargos WHERE id = %s", (enc2,)) == 'CANCELADO', 'encargo CANCELADO con motivo')
    kpi = L.q1("SELECT count(*) FROM tienda.v_encargos WHERE estado = 'SOLICITADO'")
    L.ok(kpi >= 0, f'v_encargos por estado consultable (SOLICITADO hoy: {kpi})')
