# -*- coding: utf-8 -*-
"""p03 · CICLO DE COBRO: el cliente no pierde días, y mora/suspensión son automáticas.
Se ejecuta con 33 + 34 + 40 instalados (run_portal.py instala 33 y 40; p02 instala 34)."""
import os
import subprocess

import e2e_lib as L

L.DSN['dbname'] = 'portal_saas'
AQUI = os.path.dirname(os.path.abspath(__file__))


def tienda(sub, dias_vence, estado, plan='SISTEMA'):
    pid = L.q1("SELECT portal.fn_alta_tenant(%s, %s, %s)", (sub, abs(hash(sub)) % 100000, plan))
    L.ejecutar("UPDATE portal.negocios_portal SET vence_el = current_date + %s, estado = %s WHERE id = %s",
               (dias_vence, estado, pid))
    L.commit()
    return pid


def vence(pid):
    return L.q1("SELECT vence_el FROM portal.negocios_portal WHERE id = %s", (pid,))


def estado(pid):
    return L.q1("SELECT estado FROM portal.negocios_portal WHERE id = %s", (pid,))


def main():
    L.empezar('p03 · COBRO: la demo y los días pagados no se pierden')
    r = subprocess.run([os.environ.get('PSQL', 'psql'), '-h', '/tmp', '-p', os.environ.get('PGPORT_PRUEBAS', '5433'),
                        '-U', 'postgres', '-d', 'portal_saas', '-v', 'ON_ERROR_STOP=1', '-q', '-f',
                        os.path.join(AQUI, '..', '..', 'database', 'sql', '40_ciclo_cobro.sql')], capture_output=True, text=True)
    L.ok(r.returncode == 0, '40_ciclo_cobro.sql se reinstala sin error (repetible)')
    L.ejecutar("DELETE FROM portal.negocios_portal")
    L.commit()

    # 1) Paga el día 14 de la demo (le quedaba 1 día): conserva ese día.
    a = tienda('p3-demo', 1, 'PRUEBA')
    esperado = L.q1("SELECT (current_date + 2 + interval '1 month')::date - 1")
    L.ejecutar("SELECT portal.fn_registrar_cobro(%s, current_date)", (a,))
    L.commit()
    L.ok(vence(a) == esperado and estado(a) == 'ACTIVO',
         f'paga con 1 día de demo por delante → cubre desde mañana+1 un mes completo (hasta {vence(a)})')

    # 2) Pagar con anticipación suma, no pisa.
    L.ejecutar("SELECT portal.fn_registrar_cobro(%s, current_date)", (a,))
    L.commit()
    L.ok(vence(a) > esperado and L.q1("SELECT count(*) FROM portal.cobros WHERE negocio_portal_id = %s", (a,)) == 2,
         'dos pagos seguidos suman dos meses y quedan dos cobros distintos')

    # 3) Vencido: el mes empieza hoy.
    b = tienda('p3-vencida', -10, 'MORA')
    L.ejecutar("SELECT portal.fn_registrar_cobro(%s, current_date)", (b,))
    L.commit()
    L.ok(vence(b) == L.q1("SELECT (current_date + interval '1 month')::date - 1") and estado(b) == 'ACTIVO',
         'pago de una tienda en mora → empieza hoy (no regala los días de mora) y vuelve a ACTIVO')

    L.empezar('p03 · BARRIDO DIARIO: mora y suspensión por gracia')
    c = tienda('p3-vence-hoy', 0, 'ACTIVO')       # vence hoy: todavía paga
    d = tienda('p3-ayer', -1, 'ACTIVO')           # venció ayer → MORA
    e = tienda('p3-demo-vencida', -2, 'PRUEBA')   # demo terminada → MORA
    f = tienda('p3-gracia-ok', -3, 'MORA')        # 3 días: aún dentro de la gracia
    g = tienda('p3-gracia-fin', -4, 'MORA')       # 4 días: gracia agotada → SUSPENDIDO
    h = tienda('p3-cancelada', -40, 'CANCELADO')  # no se toca
    nuevos = L.q1("SELECT portal.fn_verificar_vencimientos()")
    L.commit()
    L.ok(nuevos == 2, f'entran en mora 2 tiendas (ayer y demo terminada), no la que vence hoy (fueron {nuevos})')
    L.ok(estado(c) == 'ACTIVO' and estado(d) == 'MORA' and estado(e) == 'MORA',
         'vence hoy sigue ACTIVO; vencidas de ayer y demo terminada pasan a MORA')
    L.ok(estado(f) == 'MORA', 'a 3 días de vencida sigue en MORA (días de gracia)')
    L.ok(estado(g) == 'SUSPENDIDO', 'a 4 días de vencida (gracia agotada) pasa a SUSPENDIDO')
    L.ok(estado(h) == 'CANCELADO', 'una tienda cancelada no cambia')
    L.q1("SELECT portal.fn_verificar_vencimientos()")
    L.commit()
    L.ok(L.q1("SELECT count(*) FROM portal.eventos_portal WHERE negocio_portal_id = %s AND tipo = 'MORA'", (d,)) == 1,
         'correr el barrido otra vez NO repite el evento de mora (una sola línea en la bitácora)')
    L.ok(L.q1("SELECT count(*) FROM portal.eventos_portal WHERE negocio_portal_id = %s AND tipo = 'SUSPENSION'", (g,)) == 1,
         'la suspensión automática queda registrada una vez, con el motivo')
    L.ok(L.q1("SELECT count(*) FROM portal.eventos_portal WHERE negocio_portal_id = %s AND tipo = 'SUSPENSION'", (f,)) == 0,
         'quien sigue en gracia no tiene suspensión')
    # Un día más: la tienda en gracia pasa a suspendida.
    L.ejecutar("UPDATE portal.negocios_portal SET vence_el = current_date - 4 WHERE id = %s", (f,))
    L.commit()
    L.q1("SELECT portal.fn_verificar_vencimientos()")
    L.commit()
    L.ok(estado(f) == 'SUSPENDIDO', 'al agotarse la gracia, la que estaba en MORA se suspende en el siguiente barrido')

    L.empezar('p03 · PROPAGACIÓN: lo que se escribe en estado_tenants')
    fila = {x['subdominio']: x for x in L.qd("SELECT * FROM portal.v_propagacion")}
    L.ok(fila['p3-gracia-fin']['activo'] is False and fila['p3-cancelada']['activo'] is False,
         'suspendida y cancelada → activo = false (la tienda se corta)')
    L.ok(fila['p3-ayer']['activo'] is True, 'en MORA dentro de la gracia → sigue activa')
    L.ok(fila['p3-demo']['fiscal'] is False, 'plan SISTEMA → fiscal = false')
    L.ejecutar("SELECT portal.fn_cambiar_plan(%s, 'ESPECIAL')", (a,))
    L.commit()
    L.ok(L.q1("SELECT fiscal FROM portal.v_propagacion WHERE negocio_portal_id = %s", (a,)) is True,
         'plan ESPECIAL → fiscal = true')
