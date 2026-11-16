# -*- coding: utf-8 -*-
"""t07 · Cuentas por cobrar: pago parcial, saldo en cero, comprobante, anulación y vistas."""
import e2e_lib as L


def main():
    L.empezar('t07 · Cuentas por cobrar (CxC)')
    uid = L.admin()
    hoy = L.hoy()

    # 1) Cuenta pendiente de la venta a crédito (o la más vieja si la de t06 se anuló)
    cta = L.fila("SELECT * FROM tienda.v_cuentas_por_cobrar WHERE estado = 'PENDIENTE' AND saldo_usd > 0 ORDER BY id DESC LIMIT 1")
    L.ok(cta is not None, f'cuenta pendiente: venta #{cta["venta_id"]} saldo {cta["saldo_usd"]}' if cta else 'no hay cuenta pendiente')
    if not cta:
        return
    saldo0 = float(cta['saldo_usd'])
    m_ef = L.q1("SELECT id FROM tienda.metodos_pago WHERE nombre = 'Efectivo USD' AND activo")

    # 2) Pago parcial en USD, con la fecha de la venta (el cobro no puede ser anterior)
    fecha_pago = cta['fecha_venta'] or hoy
    p1 = L.fn('fn_registrar_pago_cobrar', cta['id'], fecha_pago, 'USD', round(saldo0 / 2, 2),
              f"PM-{L.fake.random_number(digits=8)}", uid, m_ef)
    L.commit()
    pg = L.fila("SELECT * FROM tienda.pagos_cobrar WHERE id = %s", (p1,))
    L.ok(pg and float(pg['monto_usd']) == round(saldo0 / 2, 2), f'pago parcial {pg["monto_usd"] if pg else "?"} USD')
    saldo1 = float(L.q1("SELECT saldo_usd FROM tienda.cuentas_por_cobrar WHERE id = %s", (cta['id'],)))
    L.ok(abs(saldo1 - (saldo0 - saldo0 / 2)) < 0.01, f'saldo {saldo0} → {saldo1}')
    L.ok(L.q1("SELECT estado FROM tienda.cuentas_por_cobrar WHERE id = %s", (cta['id'],)) == 'PENDIENTE', 'sigue PENDIENTE')

    # 3) Pago que excede el saldo se rechaza
    L.espera_error('cobro mayor que el saldo rechazado', L.fn, 'fn_registrar_pago_cobrar', cta['id'], fecha_pago, 'USD', saldo1 + 5,
                   'PM-XXX', uid, m_ef)

    # 4) Segundo pago completa → PAGADA
    p2 = L.fn('fn_registrar_pago_cobrar', cta['id'], fecha_pago, 'USD', saldo1, f"PM-{L.fake.random_number(digits=8)}", uid, m_ef)
    L.commit()
    L.ok(float(L.q1("SELECT saldo_usd FROM tienda.cuentas_por_cobrar WHERE id = %s", (cta['id'],)) or 0) == 0, 'saldo en cero')
    L.ok(L.q1("SELECT estado FROM tienda.cuentas_por_cobrar WHERE id = %s", (cta['id'],)) == 'PAGADA', 'cuenta PAGADA')

    # 5) Comprobante del cobro (mismo que imprime CxC → comprobante)
    comp = L.fn('fn_comprobante_cobro', p2)
    L.ok(comp is not None, f'comprobante JSON generado ({str(comp)[:60]}…)')

    # 6) Anulación del pago restaura el saldo
    L.fn('fn_anular_pago_cobrar', p2, 'Cobro mal ingresado E2E', uid)
    L.commit()
    L.ok(abs(float(L.q1("SELECT saldo_usd FROM tienda.cuentas_por_cobrar WHERE id = %s", (cta['id'],))) - saldo1) < 0.01,
         f'anulado el pago: saldo vuelve a {saldo1}')
    L.ok(L.q1("SELECT estado FROM tienda.pagos_cobrar WHERE id = %s", (p2,)) == 'ANULADO', 'pago marcado ANULADO')
    L.espera_error('no se puede anular dos veces el mismo pago', L.fn, 'fn_anular_pago_cobrar', p2, 'reanular', uid)

    # 7) Cliente con más de una cuenta: la vista del módulo los lista
    L.ok(L.q1("SELECT count(*) FROM tienda.v_cuentas_por_cobrar") >= 1, 'v_cuentas_por_cobrar lista las cuentas')
    mov = L.q1("SELECT count(*) FROM tienda.movimientos_caja WHERE origen = 'COBRO_CXC' AND estado = 'ACTIVO'")
    L.ok(mov >= 1, f'los cobros entraron a caja como movimientos ({mov})')
