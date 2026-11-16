# -*- coding: utf-8 -*-
"""f03 · CRÍTICA: IGTF — casuística de cobro, reversión al anular y lo que se declara."""
import json as J

import e2e_lib as L
import f_lib as F


def main():
    L.empezar('f03 · IGTF: cobro, reversión y declaración')
    uid = L.admin()
    hoy = L.hoy()
    p = L.q1("SELECT id FROM tienda.productos WHERE activo AND NOT exento_iva ORDER BY id LIMIT 1")
    items = J.dumps([{'producto_id': p, 'cantidad': 1, 'descuento_pct': 0}])
    m_usd = F.m_efectivo('Effectivo USD' if False else 'Efectivo USD')
    m_pm = F.m_efectivo('Pago móvil')

    # 1) Matriz: (cobra_igtf ∧ método aplica_igtf) → cobra; cualquier otra combinación → 0
    F.activar_especial(True)
    cot = L.fn_fila('fn_cotizar_venta', items)
    L.ok(bool(cot['cobra_igtf']), f'cotizar anuncia IGTF con contribuyente especial (pct {cot["igtf_pct"]}, base {cot["igtf_base"]})')
    total = float(cot['total_usd'])
    # pago móvil (Bs, sin IGTF) → venta sin IGTF
    vpm = L.fn('fn_registrar_venta', uid, items, J.dumps([{'metodo_pago_id': m_pm, 'monto': round(total * 36.5, 2), 'referencia': 'PM-IGTF1'}]), None, None, 'PRESENCIAL')
    L.commit()
    L.ok(float(L.q1("SELECT COALESCE(igtf_usd, 0) FROM tienda.ventas WHERE id = %s", (vpm,))) == 0, 'Pago móvil (aplica_igtf = false) → IGTF 0')

    # efectivo USD (aplica_igtf = true) → IGTF: el total exigido lo dicta el validador
    monto = total
    vusd = None
    for _ in range(4):
        try:
            vusd = L.fn('fn_registrar_venta', uid, items, J.dumps([{'metodo_pago_id': m_usd, 'monto': round(monto, 2)}]), None, None, 'PRESENCIAL')
            break
        except Exception as exc:
            L.conn.rollback()
            s = str(exc)
            if 'no cuadran' in s:
                monto = float(s.split('(USD ')[2].split(')')[0])
            else:
                raise
    L.commit()
    ig = float(L.q1("SELECT COALESCE(igtf_usd, 0) FROM tienda.ventas WHERE id = %s", (vusd,)))
    L.ok(ig > 0, f'Efectivo USD (aplica_igtf = true) → IGTF {ig} = 3 % del total cobrado')
    L.ok(abs(float(L.q1("SELECT total_cobrar_usd - total_usd FROM tienda.ventas WHERE id = %s", (vusd,))) - ig) < 0.01,
         'total cobrar = total + IGTF')

    # 2) Negocio sin IGTF: aunque el método lo tenga, no se cobra
    F.activar_especial(False)
    vno = L.fn('fn_registrar_venta', uid, items, J.dumps([{'metodo_pago_id': m_usd, 'monto': total}]), None, None, 'PRESENCIAL')
    L.commit()
    L.ok(float(L.q1("SELECT COALESCE(igtf_usd, 0) FROM tienda.ventas WHERE id = %s", (vno,))) == 0,
         'cobra_igtf = false → IGTF 0 aunque el método aplique')

    # 3) Crédito facturado sin IGTF, cobrado DESPUÉS en divisa → IGTF se causa al COBRAR
    F.activar_especial(True)
    cli = L.ins('clientes', nombre=L.fake.name(), documento=L.rif('V'), tipo_documento='V', activo=True)
    L.commit()
    vc = L.fn('fn_registrar_venta', uid, items, J.dumps([]), cli, None, 'PRESENCIAL', True, 15)
    L.commit()
    L.ok(float(L.q1("SELECT COALESCE(igtf_usd, 0) FROM tienda.ventas WHERE id = %s", (vc,))) == 0, 'factura a crédito: IGTF aún no causado')
    cta = L.q1("SELECT id FROM tienda.cuentas_por_cobrar WHERE venta_id = %s", (vc,))
    vta = L.fila("SELECT total_usd FROM tienda.ventas WHERE id = %s", (vc,))
    m_zelle = F.m_efectivo('Zelle')
    pg = L.fn('fn_registrar_pago_cobrar', cta, hoy, 'USD', round(float(vta['total_usd']) / 2, 2), 'ZL-FISCAL', uid, m_zelle)
    L.commit()
    ig_cobro = float(L.q1("SELECT COALESCE(igtf_usd, 0) FROM tienda.pagos_cobrar WHERE id = %s", (pg,)) or 0)
    L.ok(abs(ig_cobro - round(float(vta['total_usd']) / 2 * 0.03, 2)) < 0.02,
         f'cobro parcial en Zelle → IGTF del COBRO {ig_cobro} (3 % de lo cobrado, no del saldo)')
    L.ok(float(L.q1("SELECT COALESCE(sum(igtf_usd), 0) FROM tienda.pagos_cobrar WHERE cuenta_por_cobrar_id = %s AND estado = 'ACTIVO'", (cta,))) == ig_cobro,
         'el IGTF del cobro queda en la cuenta declarable')

    # 4) Cobro parcial en Efectivo USD → IGTF también sobre la parte cobrada
    pg2 = L.fn('fn_registrar_pago_cobrar', cta, hoy, 'USD', round(float(L.q1("SELECT saldo_usd FROM tienda.cuentas_por_cobrar WHERE id = %s", (cta,))) / 2, 2), 'ZL-FISCAL2', uid, m_usd)
    L.commit()
    ig2 = float(L.q1("SELECT COALESCE(igtf_usd, 0) FROM tienda.pagos_cobrar WHERE id = %s", (pg2,)) or 0)
    L.ok(ig2 > 0, 'segundo cobro parcial (efectivo USD) también causa IGTF sobre lo cobrado')

    # 5) Anulación de la venta con IGTF: se registra la reversión, el neto baja,
    #    pero lo DECLARADO (a_declarar) no lo resta: el reintegro se reclama aparte (regla SENIAT)
    antes_declarar = float(L.q1("SELECT COALESCE(sum(igtf_usd), 0) FROM tienda.v_igtf_a_declarar WHERE fecha = %s", (hoy,)) or 0)
    n_rev0 = L.q1("SELECT count(*) FROM tienda.reversiones_igtf")
    L.ejecutar("CALL tienda.sp_anular_venta(%s, %s, 'Anulación con IGTF E2E')", (vusd, uid))
    L.commit()
    L.ok(L.q1("SELECT count(*) FROM tienda.reversiones_igtf") == n_rev0 + 1, 'la anulación registró una fila en reversiones_igtf')
    nd = L.fila("SELECT igtf_cobrado_usd, igtf_revertido_usd, igtf_neto_usd FROM tienda.v_igtf_neto_diario WHERE fecha = %s", (hoy,))
    despues_declarar = float(L.q1("SELECT COALESCE(sum(igtf_usd), 0) FROM tienda.v_igtf_a_declarar WHERE fecha = %s", (hoy,)) or 0)
    L.ok(nd and abs(float(nd['igtf_revertido_usd']) - ig) < 0.02, 'v_igtf_neto_diario registra la reversión: ' + str(nd['igtf_revertido_usd']))
    L.ok(nd and abs(float(nd['igtf_neto_usd']) - (float(nd['igtf_cobrado_usd']) - float(nd['igtf_revertido_usd']))) < 0.02, 'neto = cobrado − revertido')
    L.ok(abs(despues_declarar - antes_declarar) < 0.02,
         f'v_igtf_a_declarar NO resta el IGTF anulado ({despues_declarar} vs {antes_declarar}): se declara y el reintegro se reclama aparte')
    F.activar_especial(False)
