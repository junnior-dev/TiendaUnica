# -*- coding: utf-8 -*-
"""p01 · PORTAL: alta de tenants, cobros, vencimientos, mora y suspensión —
el ciclo de vida comercial completo en la base central portal_saas."""
from datetime import date, timedelta

import e2e_lib as L

L.DSN['dbname'] = 'portal_saas'


def main():
    L.empezar('p01 · PORTAL: planes y alta de tenant')
    # El 34 (portal pagos) amplió el catálogo: BASE/PRACTICA/PRO + SISTEMA/ESPECIAL/DEMO.
    # Este test solo pasaba cuando la recreación del portal omitía el 34.
    L.ok(L.q1("SELECT count(*) FROM portal.planes") == 6 and
         L.q1("SELECT count(*) FROM portal.planes WHERE nombre IN "
              "('BASE','PRACTICA','PRO','SISTEMA','ESPECIAL','DEMO')") == 6,
         '6 planes sembrados (BASE, PRACTICA, PRO + SISTEMA, ESPECIAL, DEMO del 34)')
    tid = L.q1("SELECT portal.fn_alta_tenant(%s, %s, %s, %s, %s, %s)",
               ('bodega-esquina', 2, 'PRACTICA', 'tienda', '10.0.0.8', 'bodega@esquina.com'))
    L.commit()
    L.ok(tid == 1, f'alta del tenant «bodega-esquina» → registro {tid} en PRUEBA')
    fila = L.fila("SELECT estado, vence_el, (vence_el - current_date) AS dias "
                  "FROM portal.negocios_portal WHERE id = %s", (tid,))
    L.ok(fila['estado'] == 'PRUEBA' and fila['dias'] == 15,
         f"prueba gratis de 15 días (vence {fila['vence_el']})")
    L.espera_error('subdominio duplicado → UNIQUE del registro central lo rechaza',
                   lambda: L.q1("SELECT portal.fn_alta_tenant(%s, %s, %s)", ('bodega-esquina', 3, 'PRACTICA')))
    L.espera_error('plan inexistente → rechazado',
                   lambda: L.q1("SELECT portal.fn_alta_tenant(%s, %s, %s)", ('otra-tienda', 3, 'GOLD')))
    L.commit()

    L.empezar('p01 · PORTAL: cobros y vencimientos')
    # La demo (15 días) no se pierde: el primer mes pagado empieza cuando termina la prueba.
    fin_demo = L.q1("SELECT vence_el FROM portal.negocios_portal WHERE id = %s", (tid,))
    vence = L.q1("SELECT portal.fn_registrar_cobro(%s, %s)", (tid, date.today()))
    L.commit()
    L.ok(vence == L.q1("SELECT (%s::date + 1 + interval '1 month')::date - 1", (fin_demo,)),
         f'cobro del mes registrado → paga hasta {vence} (un mes completo tras la demo, sin perder días)')
    L.ok(L.q1("SELECT estado FROM portal.negocios_portal WHERE id = %s", (tid,)) == 'ACTIVO',
         'el pago activa el tenant (PRUEBA → ACTIVO)')
    vence2 = L.q1("SELECT portal.fn_registrar_cobro(%s, %s)", (tid, date.today()))
    L.commit()
    L.ok(vence2 > vence, f'pagar otra vez por adelantado suma otro mes (hasta {vence2}), sin choque de periodo')
    L.ejecutar("UPDATE portal.negocios_portal SET vence_el = current_date - 3 WHERE id = %s", (tid,))
    L.commit()
    morosos = L.q1("SELECT portal.fn_verificar_vencimientos()")
    L.commit()
    L.ok(morosos == 1, 'barrido de vencimientos: 1 tenant entra en MORA')
    L.ok(L.q1("SELECT estado FROM portal.negocios_portal WHERE id = %s", (tid,)) == 'MORA',
         'estado del vencido: MORA')

    L.empezar('p01 · PORTAL: suspensión, reactivación y métricas')
    L.ejecutar("SELECT portal.fn_suspender(%s, %s)", (tid, 'mora prolongada'))
    L.commit()
    L.ok(L.q1("SELECT estado FROM portal.negocios_portal WHERE id = %s", (tid,)) == 'SUSPENDIDO',
         'suspensión comercial ordenada (el propagador la aplica en la BD del tenant)')
    cartera = L.fila("SELECT requiere_accion, plan, precio_usd FROM portal.v_cartera WHERE id = %s", (tid,))
    L.ok(cartera['requiere_accion'] is True and cartera['plan'] == 'PRACTICA',
         'v_cartera marca el tenant en mora con su plan')
    L.ejecutar("SELECT portal.fn_reactivar(%s)", (tid,))
    L.commit()
    L.ok(L.q1("SELECT estado FROM portal.negocios_portal WHERE id = %s", (tid,)) == 'MORA',
         'reactivado sin pagar → vuelve a MORA (no se regala el servicio)')
    mrr = L.fila("SELECT mrr_usd, activos, en_mora, suspendidos FROM portal.v_mrr")
    L.ok(mrr['activos'] == 0 and mrr['en_mora'] == 1 and mrr['suspendidos'] == 0,
         f'v_mrr: 0 activos, 1 en mora (MRR $ {mrr["mrr_usd"]})')
    proximo = (date.today().replace(day=1) + timedelta(days=32)).replace(day=1)
    L.ejecutar("SELECT portal.fn_registrar_cobro(%s, %s, %s, %s, %s)",
               (tid, proximo, 15.00, 'pago movil', 'regularizado'))
    L.commit()
    mrr = L.fila("SELECT mrr_usd, activos FROM portal.v_mrr")
    L.ok(mrr['activos'] == 1 and mrr['mrr_usd'] == 15.00,
         f'pagó el mes siguiente → ACTIVO y el MRR sube a $ {mrr["mrr_usd"]}')
    L.ok(L.q1("SELECT vence_el FROM portal.negocios_portal WHERE id = %s", (tid,)) ==
         L.q1("SELECT (current_date + interval '1 month')::date - 1"),
         'estaba vencido → el mes pagado empieza hoy y cubre un mes completo')
    L.ok(L.q1("SELECT count(*) FROM portal.eventos_portal WHERE negocio_portal_id = %s", (tid,)) >= 6,
         'bitácora del ciclo de vida: alta, cobro, mora, suspensión, reactivación, cobro')
    L.commit()
