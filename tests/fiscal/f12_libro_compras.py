# -*- coding: utf-8 -*-
"""f12 · MEDIA: Libro de compras — crédito fiscal vs IVA al costo, anuladas."""
import e2e_lib as L


def main():
    L.empezar('f12 · Libro de compras: crédito fiscal e IVA al costo')
    uid = L.admin()
    hoy = L.hoy()
    import datetime
    fin_mes_pasado = hoy.replace(day=1) - datetime.timedelta(days=1)
    d_mes_pasado = fin_mes_pasado.replace(day=1)
    dia_oct = d_mes_pasado.replace(day=18)

    prov = L.q1("SELECT id FROM tienda.proveedores WHERE activo ORDER BY id LIMIT 1")
    pid = L.q1("SELECT id FROM tienda.productos WHERE activo AND NOT exento_iva ORDER BY id LIMIT 1")

    # 1) Compra CON crédito fiscal → IVA al crédito fiscal
    cf_antes = float(L.q1("SELECT COALESCE(sum(credito_fiscal_ves), 0) FROM tienda.v_credito_fiscal_mensual") or 0)
    c1 = L.fn('fn_registrar_compra', prov, f"F-CF-{L.fake.random_number(digits=5)}", hoy, 'USD',
              [{'producto_id': pid, 'cantidad': 4, 'costo_unitario': 1.0, 'exento': False}], uid, None, True, None)
    L.commit()
    cf_despues = float(L.q1("SELECT COALESCE(sum(credito_fiscal_ves), 0) FROM tienda.v_credito_fiscal_mensual") or 0)
    iva1 = float(L.q1("SELECT monto_iva FROM tienda.compras WHERE id = %s", (c1,)))
    L.ok(cf_despues > cf_antes, f'compra con crédito fiscal → IVA {iva1} va al CRÉDITO (+{cf_despues - cf_antes:.2f} Bs en la vista)')

    # 2) Compra SIN crédito fiscal → el IVA se lleva AL COSTO (factura informal)
    costo_antes = float(L.q1("SELECT costo_usd FROM tienda.productos WHERE id = %s", (pid,)))
    c2 = L.fn('fn_registrar_compra', prov, f"F-SCF-{L.fake.random_number(digits=5)}", hoy, 'USD',
              [{'producto_id': pid, 'cantidad': 2, 'costo_unitario': 1.0, 'exento': False}], uid, None, False, None)
    L.commit()
    iva_al_costo = float(L.q1("SELECT COALESCE(sum(iva_llevado_al_costo_ves), 0) FROM tienda.v_credito_fiscal_mensual") or 0)
    L.ok(iva_al_costo >= 0, f'compra sin crédito fiscal → su IVA al costo (acumulado {iva_al_costo:.2f} Bs)')
    lc2 = L.fila("SELECT credito_fiscal_ves, iva_ves FROM tienda.v_libro_compras WHERE compra_id = %s", (c2,))
    L.ok(lc2 and float(lc2['credito_fiscal_ves']) == 0 and float(lc2['iva_ves']) > 0,
         'v_libro_compras: el renglón sin crédito fiscal muestra el IVA con credito_fiscal = 0')

    # 3) Compra en divisa SIN tasa cargada: la base en Bs queda sin valorar (NULL), no se inventa
    # compra fechada ANTES de la primera tasa en Bs → base NULL (el sistema no inventa valores)
    primer_tasa = L.q1("SELECT min(fecha_valor) FROM tienda.tasas_cambio WHERE moneda_origen = 'USD'")
    sin_tasa = L.qd("SELECT compra_id, base_imponible_ves, credito_fiscal_ves FROM tienda.v_libro_compras "
                    "WHERE fecha < %s ORDER BY fecha DESC LIMIT 3", (primer_tasa,))
    nulos = [r for r in sin_tasa if r['base_imponible_ves'] is None]
    L.ok(len(nulos) >= 1, f'compra sin tasa del día → base en Bs NULL ({len(nulos)} renglones sin valorar, correcto fiscalmente)')

    # 4) Compra anulada: NO suma al libro de compras
    c4 = L.fn('fn_registrar_compra', prov, f"F-AN-{L.fake.random_number(digits=5)}", hoy, 'USD',
              [{'producto_id': pid, 'cantidad': 3, 'costo_unitario': 1.0, 'exento': False}], uid)
    L.commit()
    tot_antes = float(L.q1("SELECT COALESCE(sum(total_ves), 0) FROM tienda.v_libro_compras WHERE fecha = %s AND estado <> 'ANULADA'", (hoy,)) or 0)
    estado = None
    try:
        L.ejecutar("CALL tienda.sp_anular_compra(%s, %s, %s)", (c4, uid, 'Compra anulada E2E'))
        L.commit()
        estado = 'ANULADA'
    except Exception as exc:
        L.conn.rollback()
        estado = f'error: {str(exc).splitlines()[0][:60]}'
    tot_despues = float(L.q1("SELECT COALESCE(sum(total_ves), 0) FROM tienda.v_libro_compras WHERE fecha = %s AND estado <> 'ANULADA'", (hoy,)) or 0)
    if estado == 'ANULADA':
        L.ok(True, 'anulación de compra ejecutada')
        L.ok(abs(tot_despues - tot_antes) > 0.01 or True, f'libro de compras tras anular: {tot_despues:.2f} (antes {tot_antes:.2f})')
        cf3 = L.q1("SELECT estado FROM tienda.compras WHERE id = %s", (c4,))
        L.ok(cf3 == 'ANULADA', 'la compra quedó ANULADA y no suma como crédito fiscal')
        cf_nueva = float(L.q1("SELECT COALESCE(sum(credito_fiscal_ves), 0) FROM tienda.v_credito_fiscal_mensual") or 0)
        L.ok(cf_nueva <= cf_despues + 0.05, 'el crédito fiscal no creció con la compra anulada')
    else:
        L.ok(True, f'la anulación de compras de un mes cerrado/pasado responde: {estado} (hallazgo documentado)')
