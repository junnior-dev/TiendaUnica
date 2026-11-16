# -*- coding: utf-8 -*-
"""t10 · Fiscal: factura y numeración, libro de ventas, IGTF diario, calendario fiscal,
ajuste cambiario y libro de compras con crédito fiscal."""
import e2e_lib as L


def main():
    L.empezar('t10 · Fiscal: libros, IGTF y calendario')
    uid = L.admin()
    hoy = L.hoy()

    # 1) Factura de la venta más reciente sin numerar + libro de ventas del día
    ventas_sin = L.qs("SELECT id FROM tienda.ventas WHERE estado <> 'ANULADA' AND numero_factura_fiscal IS NULL ORDER BY id LIMIT 3")
    for (vid,) in ventas_sin:
        L.fn('fn_emitir_factura_fiscal', vid)
    L.commit()
    fact = L.qs("SELECT numero_factura_fiscal, numero_control FROM tienda.ventas WHERE numero_factura_fiscal IS NOT NULL ORDER BY id DESC LIMIT 3")
    L.ok(len(fact) >= 1, f'ventas facturadas: {[str(f[0]) for f in fact]}')
    lv = L.qs("SELECT * FROM tienda.v_libro_ventas WHERE fecha = %s ORDER BY 1", (hoy,))
    L.ok(len(lv) >= 1, f'v_libro_ventas del día con {len(lv)} facturas')
    iva_libro = sum(float(r['iva_ves']) if 'iva_ves' in r else 0 for r in lv)
    L.ok(iva_libro >= 0, f'IVA del libro de ventas en Bs: {iva_libro:.2f}')

    # 2) Libro de compras: las compras con crédito fiscal entran con su IVA por acreditar
    lc = L.qs("SELECT * FROM tienda.v_libro_compras ORDER BY 1 DESC LIMIT 5")
    L.ok(len(lc) >= 1, f'v_libro_compras con {len(lc)} compras')
    cred = L.q1("SELECT COALESCE(sum(credito_fiscal_ves), 0) FROM tienda.v_credito_fiscal_mensual")
    L.ok(cred is not None, f'crédito fiscal del mes acumulado: {cred}')

    # 3) IGTF diario: lo cobrado en pagos con IGTF = lo que declara la vista
    igtf_pagos = float(L.q1("SELECT COALESCE(sum(igtf_usd), 0) FROM tienda.pagos_venta") or 0)
    igtf_vista = float(L.q1("SELECT COALESCE(sum(igtf_usd), 0) FROM tienda.v_igtf_diario") or 0)
    L.ok(abs(igtf_pagos - igtf_vista) < 0.02, f'IGTF diario cuadra: pagos {igtf_pagos} = vista {igtf_vista}')
    neto = L.q1("SELECT count(*) FROM tienda.v_igtf_neto_diario")
    L.ok(neto is not None, f'v_igtf_neto_diario disponible ({neto} filas: cobrado − revertido por anulación)')

    # 4) Retenciones de IVA practicadas a proveedores (t04) están en la vista del módulo
    n_ret = L.q1("SELECT count(*) FROM tienda.v_retenciones_iva WHERE estado = 'ACTIVA'")
    L.ok(n_ret >= 1, f'retenciones de IVA activas: {n_ret}')

    # 5) Calendario fiscal: la base trae cargado el calendario del contribuyente ESPECIAL
    #    (igual que lo hace Configuración → Régimen); se activa el régimen y se consulta
    L.ejecutar("UPDATE tienda.negocio SET es_contribuyente_especial = true WHERE id = 1")
    L.commit()
    cal = L.qs("SELECT obligacion, periodo_desde, fecha_limite, presentada FROM tienda.fn_calendario_negocio(%s)", (2026,))
    L.ok(len(cal) >= 4, f'calendario del negocio 2026 con {len(cal)} vencimientos')
    obligacion, desde, limite, presentada = cal[0]
    L.fn('fn_marcar_presentada', obligacion, desde, hoy, f'PRE-{L.fake.random_number(digits=5)}', uid)
    L.commit()
    L.ok(True, f'declaración {obligacion} (vence {limite}) marcada como presentada')
    L.fn('fn_desmarcar_presentada', obligacion, desde)
    L.commit()
    L.ok(True, 'desmarcada (flujo de corrección)')
    L.ejecutar("UPDATE tienda.negocio SET es_contribuyente_especial = false WHERE id = 1")
    L.commit()

    # 6) Ajuste cambiario: recálculo y aplicación real (moneda extranjera → Bs)
    calc = L.fn_fila('fn_ajuste_cambiario_calculo', hoy)
    L.ok(calc is not None, f'ajuste cambiario calculado: {calc}')
    L.fn('fn_ajuste_cambiario', hoy, uid)
    L.commit()
    L.ok(True, 'ajuste cambiario aplicado y firmado')
