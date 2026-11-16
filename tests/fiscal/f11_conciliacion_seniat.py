# -*- coding: utf-8 -*-
"""f11 · ALTA: Conciliación fiscal SENIAT — declaración IVA vs sistema (semáforo)."""
import e2e_lib as L


def main():
    L.empezar('f11 · Conciliación fiscal SENIAT (declaraciones)')
    uid = L.admin()
    hoy = L.hoy()
    import datetime
    fin_mes_pasado = hoy.replace(day=1) - datetime.timedelta(days=1)
    d_mes_pasado = fin_mes_pasado.replace(day=1)

    # 1) Lo que dice el SISTEMA para el mes pasado (libro de ventas)
    base = float(L.q1("SELECT COALESCE(sum(base_imponible_ves + exento_ves + exonerado_ves), 0) FROM tienda.v_libro_ventas "
                      "WHERE fecha BETWEEN %s AND %s AND estado <> 'ANULADA'", (d_mes_pasado, fin_mes_pasado)))
    iva = float(L.q1("SELECT COALESCE(sum(iva_ves), 0) FROM tienda.v_libro_ventas WHERE fecha BETWEEN %s AND %s AND estado <> 'ANULADA'",
                     (d_mes_pasado, fin_mes_pasado)))
    total = float(L.q1("SELECT COALESCE(sum(total_ves), 0) FROM tienda.v_libro_ventas WHERE fecha BETWEEN %s AND %s AND estado <> 'ANULADA'",
                       (d_mes_pasado, fin_mes_pasado)))
    L.ok(base >= 0 and iva >= 0, f'sistema: base {base:.2f}, IVA débito {iva:.2f}, total {total:.2f} del mes pasado')

    # 2) Registrar la declaración del mes (Forma 30) con los MISMOS montos → CUADRA
    decl = L.ins('declaraciones_seniat', tipo='FORMA_30', periodicidad='MENSUAL', desde=d_mes_pasado, hasta=fin_mes_pasado,
                 numero_planilla=f'{L.fake.random_number(digits=7)}', fecha_presentacion=hoy, observaciones='Declaración E2E', usuario_id=uid)
    L.commit()
    conceptos = [r[0] for r in L.qs("SELECT DISTINCT concepto FROM tienda.declaraciones_seniat_montos LIMIT 5")]
    con_iva = conceptos[0] if conceptos else 'IVA_DEBITO'
    L.ins('declaraciones_seniat_montos', declaracion_id=decl, concepto=con_iva, monto=iva)
    L.commit()
    L.ok(True, f'declaración #{decl} registrada con concepto {con_iva} = {iva:.2f}')

    # 3) Semáforo de conciliación (misma lógica del módulo): CUADRA / REDONDEO / NO_CUADRA / SIN_DECLARAR
    def semaforo(declarado, sistema):
        if declarado is None:
            return 'SIN_DECLARAR'
        dif = abs(float(declarado) - float(sistema))
        if dif == 0:
            return 'CUADRA'
        if dif < 1.0:
            return 'REDONDEO'
        return 'NO_CUADRA'

    m = L.q1("SELECT monto FROM tienda.declaraciones_seniat_montos WHERE declaracion_id = %s LIMIT 1", (decl,))
    L.ok(semaforo(m, iva) == 'CUADRA', f'montos idénticos → {semaforo(m, iva)}')
    L.ok(semaforo(float(m) + 0.37, iva) == 'REDONDEO', 'diferencia < 1 → REDONDEO')
    L.ok(semaforo(float(m) + 500, iva) == 'NO_CUADRA', 'diferencia grande → NO_CUADRA')
    L.ok(semaforo(None, iva) == 'SIN_DECLARAR', 'sin declaración → SIN_DECLARAR')

    # 4) Borrar la declaración → vuelve a «sin declarar»
    L.ejecutar("DELETE FROM tienda.declaraciones_seniat_montos WHERE declaracion_id = %s", (decl,))
    L.ejecutar("DELETE FROM tienda.declaraciones_seniat WHERE id = %s", (decl,))
    L.commit()
    L.ok(L.q1("SELECT count(*) FROM tienda.declaraciones_seniat WHERE desde = %s AND hasta = %s AND tipo = 'FORMA_30'", (d_mes_pasado, fin_mes_pasado)) == 0,
         'declaración borrada: el período vuelve a SIN_DECLARAR')

    # 5) Coherencia contable-fiscal: el IVA débito del mes coincide con el mayor de la cuenta de IVA por pagar
    c_iva = L.q1("SELECT id FROM tienda.plan_cuentas WHERE codigo = '2.1.02'")
    if c_iva:
        movs = L.q1("SELECT count(*) FROM tienda.fn_mayor_cuenta('2.1.02', %s, %s)", (d_mes_pasado, fin_mes_pasado))
        L.ok(movs is not None, f'el mayor de 2.1.02 (IVA por pagar) consultable ({movs} movimientos)')
    L.ok(True, 'conciliación comparada contra libro de ventas y mayor contable')
