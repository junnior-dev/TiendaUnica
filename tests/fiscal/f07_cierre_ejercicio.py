# -*- coding: utf-8 -*-
"""f07 · CRÍTICA: Cierre de ejercicio — ingresos y gastos a cero, resultados acumulados."""
import json as J

import e2e_lib as L


def main():
    L.empezar('f07 · Cierre de ejercicio (resultados acumulados)')
    uid = L.admin()
    hoy = L.hoy()
    anio = hoy.year - 2          # el ejercicio ya terminado
    anio_act = hoy.year - 1      # también terminado (se cierra tras completar el anterior)

    c_ingreso = L.q1("SELECT id FROM tienda.plan_cuentas WHERE tipo = 'INGRESO' AND permite_movimiento AND activa ORDER BY id LIMIT 1")
    c_gasto = L.q1("SELECT id FROM tienda.plan_cuentas WHERE tipo = 'GASTO' AND permite_movimiento AND activa ORDER BY id LIMIT 1")
    c_result = L.q1("SELECT id FROM tienda.plan_cuentas WHERE codigo = '3.1.02'")
    L.ok(c_ingreso and c_gasto and c_result, 'plan de cuentas con INGRESO, GASTO y 3.1.02 resultados acumulados')

    # 1) Saldos del ejercicio pasado: ingreso +1000 (haber), gasto 400 (debe) → utilidad 600
    c_caja = L.q1("SELECT id FROM tienda.plan_cuentas WHERE codigo = '1.1.01'")
    L.fn('fn_crear_asiento', f'{anio}-06-30', 'Ventas del ejercicio pasado E2E', 'MANUAL', None,
         J.dumps([{'cuenta_id': c_caja, 'debe': 1000, 'haber': 0, 'glosa': 'cobros'},
                  {'cuenta_id': c_ingreso, 'debe': 0, 'haber': 1000, 'glosa': 'ingreso'}]), uid)
    L.fn('fn_crear_asiento', f'{anio}-07-15', 'Gastos del ejercicio pasado E2E', 'MANUAL', None,
         J.dumps([{'cuenta_id': c_gasto, 'debe': 400, 'haber': 0, 'glosa': 'gasto'},
                  {'cuenta_id': c_caja, 'debe': 0, 'haber': 400, 'glosa': 'pago'}]), uid)
    L.commit()
    L.ok(True, f'saldos sembrados en el ejercicio {anio} (utilidad 600)')
    vista = L.fn('fn_cierre_ejercicio_vista', anio)
    L.ok(vista is not None, f'fn_cierre_ejercicio_vista({anio}) muestra lo que se va a cerrar')

    # 2) No se puede cerrar el ejercicio ACTUAL sin cerrar el anterior primero
    c_caja = L.q1("SELECT id FROM tienda.plan_cuentas WHERE codigo = '1.1.01'")
    L.fn('fn_crear_asiento', f'{anio_act}-09-30', 'Ingresos del año en curso E2E', 'MANUAL', None,
         J.dumps([{'cuenta_id': c_caja, 'debe': 250, 'haber': 0, 'glosa': 'cobros'},
                  {'cuenta_id': c_ingreso, 'debe': 0, 'haber': 250, 'glosa': 'ingreso'}]), uid)
    L.commit()
    L.espera_error('cerrar el ejercicio en curso SIN cerrar el anterior rechazado', L.fn, 'fn_cierre_ejercicio', anio_act, uid)

    # 3) Ejercicio futuro: ni hablar
    L.espera_error('cerrar un ejercicio que no ha terminado rechazado', L.fn, 'fn_cierre_ejercicio', anio_act + 1, uid)

    # 4) Cierre del ejercicio pasado: asiento CIERRE fechado 31/12, cuadrado
    asc = L.fn('fn_cierre_ejercicio', anio, uid)
    L.commit()
    ac = L.fila("SELECT a.fecha, a.origen_tipo, a.origen_id, "
                "(SELECT sum(d.debe) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) debe, "
                "(SELECT sum(d.haber) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) haber, "
                "(SELECT count(*) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) n "
                "FROM tienda.asientos a WHERE a.id = %s", (asc,))
    L.ok(str(ac['fecha']) == f'{anio}-12-31' and ac['origen_tipo'] == 'CIERRE' and str(ac['origen_id']) == str(anio),
         f'asiento CIERRE {anio} fechado {anio}-12-31')
    L.ok(abs(float(ac['debe']) - float(ac['haber'])) < 0.01, f'asiento de cierre cuadrado ({ac["debe"]} = {ac["haber"]}) en {ac["n"]} líneas')

    # 5) Después del cierre: INGRESO y GASTO quedan en CERO en el ejercicio cerrado
    cero = L.q1("SELECT COALESCE(sum(d.haber - d.debe), 0) FROM tienda.asiento_detalle d "
                "JOIN tienda.asientos a ON a.id = d.asiento_id JOIN tienda.plan_cuentas p ON p.id = d.cuenta_id "
                "WHERE p.tipo = 'INGRESO' AND a.fecha BETWEEN %s AND %s", (f'{anio}-01-01', f'{anio}-12-31'))
    L.ok(abs(float(cero)) < 0.01, f'saldo de INGRESO tras el cierre = {cero} (cero)')
    cero_g = L.q1("SELECT COALESCE(sum(d.debe - d.haber), 0) FROM tienda.asiento_detalle d "
                  "JOIN tienda.asientos a ON a.id = d.asiento_id JOIN tienda.plan_cuentas p ON p.id = d.cuenta_id "
                  "WHERE p.tipo = 'GASTO' AND a.fecha BETWEEN %s AND %s", (f'{anio}-01-01', f'{anio}-12-31'))
    L.ok(abs(float(cero_g)) < 0.01, f'saldo de GASTO tras el cierre = {cero_g} (cero)')
    res = L.q1("SELECT COALESCE(sum(d.haber - d.debe), 0) FROM tienda.asiento_detalle d "
               "JOIN tienda.asientos a ON a.id = d.asiento_id WHERE d.cuenta_id = %s AND a.origen_tipo = 'CIERRE' AND a.origen_id = %s",
               (c_result, anio))
    L.ok(abs(float(res) - 600) < 0.05, f'la utilidad (600) aterrizó en 3.1.02 resultados acumulados ({res})')

    # 6) Doble cierre rechazado
    L.espera_error('cerrar dos veces el mismo ejercicio rechazado', L.fn, 'fn_cierre_ejercicio', anio, uid)

    # 7) Ahora sí: cerrar el ejercicio en curso
    L.fn('fn_cierre_ejercicio', anio_act, uid)
    L.commit()
    L.ok(True, f'ejercicio {anio_act} cerrado tras completar el anterior')
    L.espera_error('y no se puede cerrar dos veces', L.fn, 'fn_cierre_ejercicio', anio_act, uid)

    # 8) Asiento en un período cerrado del ejercicio ya cerrado: rechazado
    periodo = L.fila("SELECT periodo, estado FROM tienda.periodos_contables WHERE periodo = %s", (f'{anio}-06-01',))
    if not periodo or periodo['estado'] != 'CERRADO':
        L.fn('fn_cerrar_periodo', f'{anio}-06-01', uid, 'Cierre E2E fiscal')
        L.commit()
    L.espera_error('asiento manual en período cerrado rechazado', L.fn, 'fn_crear_asiento', f'{anio}-06-15', 'Fuera de tiempo', 'MANUAL', None,
                   J.dumps([{'cuenta_id': c_gasto, 'debe': 1, 'haber': 0, 'glosa': 'x'},
                            {'cuenta_id': c_ingreso, 'debe': 0, 'haber': 1, 'glosa': 'y'}]), uid)
    L.fn('fn_reabrir_periodo', f'{anio}-06-01', uid, 'Reapertura de prueba')
    L.commit()
    L.ok(True, 'período reabierto')
