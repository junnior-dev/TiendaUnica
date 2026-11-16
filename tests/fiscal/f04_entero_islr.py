# -*- coding: utf-8 -*-
"""f04 · CRÍTICA: ISLR entero — período completo, contra-asiento y estados bloqueados."""
import e2e_lib as L
import f_lib as F


def main():
    L.empezar('f04 · ISLR entero: período completo y contra-asiento')
    uid = L.admin()
    hoy = L.hoy()
    import datetime
    # el mes fiscal del entero: el mes pasado (ya terminado)
    fin_mes_pasado = hoy.replace(day=1) - datetime.timedelta(days=1)
    d_mes_pasado = fin_mes_pasado.replace(day=1)
    dia_medio = d_mes_pasado.replace(day=15)

    L.ejecutar("UPDATE tienda.contab_config SET automatica = true WHERE id = 1")
    L.commit()

    # 1) Retención del mes pasado (fecha pasada permitida: se retuvo entonces)
    prov = L.q1("SELECT id FROM tienda.proveedores WHERE activo ORDER BY id LIMIT 1")
    rif = L.q1("SELECT rif FROM tienda.proveedores WHERE id = %s", (prov,))
    r1 = L.fn('fn_registrar_retencion_islr', dia_medio, 'Cliente retenido A', rif, 'J', 'HONORARIOS', 'AP-4001', 8000, 'VES', 'BANCOS', prov, None, uid)
    r2 = L.fn('fn_registrar_retencion_islr', fin_mes_pasado - datetime.timedelta(days=3), 'Cliente retenido B', rif, 'J', 'COMISIONES', 'AP-4002', 5000, 'VES', 'BANCOS', prov, None, uid)
    L.commit()
    esperado = float(L.q1("SELECT COALESCE(sum(retenido_ves), 0) FROM tienda.retenciones_islr WHERE estado = 'ACTIVA' AND entero_id IS NULL AND fecha BETWEEN %s AND %s", (d_mes_pasado, fin_mes_pasado)))
    L.ok(esperado > 0, f'retenciones del mes pasado por enterar: {esperado} Bs')

    # 2) Período INCOMPLETO se rechaza: fecha de pago < fin del período
    L.espera_error('enterar con fecha de pago ANTERIOR al fin del período rechazado', L.fn, 'fn_enterar_islr',
                   d_mes_pasado, fin_mes_pasado, dia_medio, 'PM-TEMP', uid)
    L.espera_error('fecha de pago futura rechazada', L.fn, 'fn_enterar_islr',
                   d_mes_pasado, fin_mes_pasado, hoy + datetime.timedelta(days=10), 'PM-FUT', uid)
    L.espera_error('rango inválido (desde > hasta) rechazado', L.fn, 'fn_enterar_islr',
                   fin_mes_pasado, d_mes_pasado, hoy, 'PM-INV', uid)

    # 3) Entero correcto del mes pasado, pagado HOY (≥ fin del período y ≤ fn_hoy)
    n_asientos0 = L.q1("SELECT count(*) FROM tienda.asientos WHERE origen_tipo = 'ENTERO_ISLR'")
    ent = L.fn('fn_enterar_islr', d_mes_pasado, fin_mes_pasado, hoy, f'PM-{L.fake.random_number(digits=8)}', uid)
    L.commit()
    L.ok(ent is not None, f'entero #{ent} del período {d_mes_pasado}…{fin_mes_pasado} pagado hoy')
    L.ok(abs(float(L.q1("SELECT monto_ves FROM tienda.enteros_islr WHERE id = %s", (ent,))) - esperado) < 0.05,
         f'el entero suma exactamente las retenciones: {esperado} Bs')
    L.ok(L.q1("SELECT count(*) FROM tienda.retenciones_islr WHERE entero_id = %s", (ent,)) >= 2, 'las retenciones quedaron enlazadas al entero')
    L.ok(L.q1("SELECT count(*) FROM tienda.asientos WHERE origen_tipo = 'ENTERO_ISLR'") >= n_asientos0 + 1, 'se generó el asiento ENTERO_ISLR')
    a = L.fila("SELECT (SELECT sum(d.debe) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) debe, "
               "(SELECT sum(d.haber) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) haber "
               "FROM tienda.asientos a WHERE a.origen_tipo = 'ENTERO_ISLR' ORDER BY a.id DESC LIMIT 1")
    L.ok(a and abs(float(a['debe']) - float(a['haber'])) < 0.01, f'asiento del entero cuadrado ({a["debe"]} = {a["haber"]})')

    # 4) Doble entero del mismo período rechazado
    L.espera_error('enterar dos veces el mismo período rechazado', L.fn, 'fn_enterar_islr',
                   d_mes_pasado, fin_mes_pasado, hoy, 'PM-DOBLE', uid)

    # 5) Retención ya enterada NO se puede anular
    L.espera_error('anular retención ENTERADA rechazado', L.fn, 'fn_anular_retencion_islr', r1, 'Intento directo', uid)

    # 6) Desmarcar: contra-asiento + retenciones liberadas + ahora sí se puede anular
    n_contra0 = L.q1("SELECT count(*) FROM tienda.asientos WHERE origen_tipo = 'ANULACION_ENTERO_ISLR'")
    L.fn('fn_desmarcar_entero_islr', ent, 'Fue del período anterior E2E', uid)
    L.commit()
    L.ok(L.q1("SELECT estado FROM tienda.enteros_islr WHERE id = %s", (ent,)) == 'ANULADO', 'entero desmarcado (ANULADO)')
    L.ok(L.q1("SELECT entero_id FROM tienda.retenciones_islr WHERE id = %s", (r1,)) is None, 'retenciones liberadas (entero_id = NULL)')
    L.ok(L.q1("SELECT count(*) FROM tienda.asientos WHERE origen_tipo = 'ANULACION_ENTERO_ISLR'") == n_contra0 + 1, 'contra-asiento generado')
    L.fn('fn_anular_retencion_islr', r1, 'Retención duplicada E2E', uid)
    L.commit()
    L.ok(L.q1("SELECT estado FROM tienda.retenciones_islr WHERE id = %s", (r1,)) == 'ANULADA', 'tras desmarcar, la retención SÍ se puede anular')
    L.fn('fn_anular_retencion_islr', r2, 'Limpieza del período fiscal', uid)
    L.commit()
    L.ejecutar("UPDATE tienda.contab_config SET automatica = false WHERE id = 1")
    L.commit()
