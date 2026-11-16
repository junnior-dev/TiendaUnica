# -*- coding: utf-8 -*-
"""f08 · CRÍTICA: Ajuste cambiario del inventario (31/12 → diferencia a resultados)."""
import e2e_lib as L


def main():
    L.empezar('f08 · Ajuste cambiario del inventario')
    uid = L.admin()
    hoy = L.hoy()
    import datetime
    mes_clave = int(str(hoy).replace('-', '')[:6])

    # 1) Cálculo: valor físico = Σ stock × costo × tasa; diferencia = físico − contable
    calc = L.fn_fila('fn_ajuste_cambiario_calculo', hoy)
    L.ok(calc is not None, f'fn_ajuste_cambiario_calculo responde ({calc})')
    tasa = float(L.fn('fn_tasa_par', 'USD', 'VES', hoy))
    fisico = L.q1("SELECT COALESCE(sum(stock_actual * costo_usd), 0) * %s FROM tienda.productos WHERE activo", (tasa,))
    L.ok(abs(float(calc['valor_fisico_ves']) - float(fisico)) < 1.0,
         f'valor físico en Bs = Σ stock × costo × tasa: {calc["valor_fisico_ves"]} ≈ {float(fisico):.2f}')
    dif = float(calc['diferencia_ves'])
    L.ok(abs(float(calc['diferencia_ves']) - (float(calc['valor_fisico_ves']) - float(calc['saldo_contable_ves']))) < 0.05,
         f'diferencia = físico − contable ({dif})')

    # 2) Sin diferencia no hay asiento: si el inventario ya cuadra, la base lo dice
    if dif == 0:
        L.espera_error('sin diferencia rechazado', L.fn, 'fn_ajuste_cambiario', hoy, uid)
    else:
        # 3) Ajuste real: asiento AJUSTE_CAMBIARIO cuadrado, con la dirección correcta
        n0 = L.q1("SELECT count(*) FROM tienda.asientos WHERE origen_tipo = 'AJUSTE_CAMBIARIO'")
        L.fn('fn_ajuste_cambiario', hoy, uid)
        L.commit()
        a = L.fila("SELECT a.id, a.fecha, (SELECT sum(d.debe) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) debe, "
                   "(SELECT sum(d.haber) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) haber "
                   "FROM tienda.asientos a WHERE a.origen_tipo = 'AJUSTE_CAMBIARIO' ORDER BY a.id DESC LIMIT 1")
        L.ok(a and abs(float(a['debe']) - float(a['haber'])) < 0.01, f'asiento de ajuste cuadrado ({a["debe"]} = {a["haber"]})')
        # dirección: si la diferencia era positiva (físico > contable) entra al inventario (Debe)
        d2 = L.fn_fila('fn_ajuste_cambiario_calculo', hoy)
        L.ok(abs(float(d2['diferencia_ves'])) < 0.05, 'tras el ajuste el contable coincide con el físico')
        L.espera_error('ajustar dos veces el mismo mes rechazado', L.fn, 'fn_ajuste_cambiario', hoy, uid)
    L.ok(L.q1("SELECT count(*) FROM tienda.asientos WHERE origen_tipo = 'AJUSTE_CAMBIARIO' AND origen_id = %s", (mes_clave,)) <= 1,
         'un solo ajuste por mes (clave AAAAMM)')

    # 4) Fecha futura rechazada
    L.espera_error('ajuste a fecha futura rechazado', L.fn, 'fn_ajuste_cambiario', hoy + datetime.timedelta(days=5), uid)

    # 5) Mes CERRADO: el ajuste no puede tocar un período contable cerrado
    fin_mes_pasado = hoy.replace(day=1) - datetime.timedelta(days=1)
    L.fn('fn_cerrar_periodo', fin_mes_pasado.replace(day=1), uid, 'Cierre para prueba de ajuste')
    L.commit()
    permitido, msg = None, ''
    try:
        permitido = L.fn('fn_ajuste_cambiario', fin_mes_pasado, uid)
        L.conn.commit()
        L.ok(False, 'FINDING: el ajuste permitió un mes contable CERRADO')
        L.ejecutar("DELETE FROM tienda.asientos WHERE origen_tipo = 'AJUSTE_CAMBIARIO' AND origen_id = %s AND id = (SELECT max(id) FROM tienda.asientos WHERE origen_tipo='AJUSTE_CAMBIARIO')", (int(str(fin_mes_pasado).replace('-', '')[:6]),))
        L.conn.commit()
    except Exception as exc:
        L.conn.rollback()
        msg = str(exc).splitlines()[0][:90]
        L.ok(True, f'ajuste en mes cerrado rechazado: {msg}')
    L.fn('fn_reabrir_periodo', fin_mes_pasado.replace(day=1), uid, 'Reapertura de prueba')
    L.commit()
    L.ok(True, 'período del mes pasado reabierto')
