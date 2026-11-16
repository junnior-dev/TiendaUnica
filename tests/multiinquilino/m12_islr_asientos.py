# -*- coding: utf-8 -*-
"""m12 · ASIENTOS DEL ISLR ANUAL (39_islr_asientos.sql): anticipo, retención sufrida, liquidación y pago
cuadran en el libro diario, se revierten con contra-asiento y quedan aislados por negocio."""
import json

import e2e_lib as L  # noqa: E402
import m_lib as M  # noqa: E402

PLANO10 = json.dumps([{'desde_ut': 0, 'hasta_ut': None, 'pct': 10, 'sustraendo_ut': 0}])


def lineas(tipo, origen_id=None, id_=None):
    """[(cuenta, debe, haber)] del asiento de un origen."""
    filtro = "a.origen_id = %s" if origen_id is not None else "a.id = %s"
    return L.qd(f"SELECT p.codigo, d.debe::float AS debe, d.haber::float AS haber FROM tienda.asientos a JOIN tienda.asiento_detalle d ON d.asiento_id = a.id "
                   f"JOIN tienda.plan_cuentas p ON p.id = d.cuenta_id WHERE a.origen_tipo = %s AND {filtro} ORDER BY d.id", (tipo, origen_id if origen_id is not None else id_))


def main():
    L.empezar('m12 · ISLR ASIENTOS: cuentas nuevas en cada negocio')
    M.volver()
    for n in (1, 2, 3):
        L.ok(L.q1("SELECT count(*) FROM tienda.contab_parametros WHERE negocio_id = %s AND clave IN ('ISLR_ANTICIPOS','ISLR_A_FAVOR','ISLR_EJERCICIO_POR_PAGAR','GASTO_ISLR')", (n,)) == 4,
             f'negocio {n}: 4 parámetros contables de ISLR configurados')
    L.ejecutar("UPDATE tienda.contab_config SET automatica = true WHERE id IN (1, 2)")
    L.ejecutar("INSERT INTO tienda.islr_ut (desde, valor_ves, nota) VALUES ('2024-01-01', 6, 'UT prueba m12'), ('2025-01-01', 9, 'UT prueba m12') ON CONFLICT DO NOTHING")
    L.commit()

    L.empezar('m12 · ISLR ASIENTOS: anticipo y retención sufrida generan su asiento')
    M.como(2)
    uid = M.uid_de('admin_bodega')
    L.fn('fn_islr_tramos_guardar', 2025, PLANO10)
    L.fn('fn_islr_declaracion_guardar', 2025, '2025-01-01', '2025-12-31', None, 0, 0, 500000, 0, 'm12', uid)
    ant = L.fn('fn_islr_anticipo_registrar', '2025-06-30', None, 20000, 'ANT-25-1', None, uid)
    suf = L.fn('fn_islr_sufrida_registrar', '2025-09-15', 'Cliente Agente M12', L.rif('J'), 'CMP-M12', None, 100000, 5000, None, uid)
    L.commit()
    L.ok(lineas('ISLR_ANTICIPO', ant) == [{'codigo': '1.1.08', 'debe': 20000.0, 'haber': 0.0}, {'codigo': '1.1.02', 'debe': 0.0, 'haber': 20000.0}],
         'anticipo de 20.000: Debe 1.1.08 Anticipos de ISLR / Haber 1.1.02 Bancos')
    L.ok(lineas('ISLR_SUFRIDA', suf) == [{'codigo': '1.1.09', 'debe': 5000.0, 'haber': 0.0}, {'codigo': '1.1.06', 'debe': 0.0, 'haber': 5000.0}],
         'retención sufrida de 5.000: Debe 1.1.09 ISLR a favor / Haber 1.1.06 Cuentas por cobrar')

    L.empezar('m12 · ISLR ASIENTOS: liquidación del ejercicio y pago del saldo')
    b = L.q1("SELECT tienda.fn_islr_borrador(2025)")
    L.ok(float(b['impuesto_neto']) == 50000.0 and float(b['anticipos']) == 20000.0 and float(b['retenciones_sufridas']) == 5000.0 and float(b['saldo']) == 25000.0,
         f"borrador 2025: impuesto 50.000 − anticipos 20.000 − retenciones 5.000 = saldo {b['saldo']}")
    liq = L.fn('fn_islr_contabilizar', 2025, uid); L.commit()
    ls = L.qd("SELECT p.codigo, d.debe::float AS debe, d.haber::float AS haber FROM tienda.asiento_detalle d JOIN tienda.plan_cuentas p ON p.id = d.cuenta_id WHERE d.asiento_id = %s ORDER BY d.id", (liq,))
    L.ok(ls == [{'codigo': '5.3.01', 'debe': 50000.0, 'haber': 0.0}, {'codigo': '1.1.09', 'debe': 0.0, 'haber': 5000.0},
                {'codigo': '1.1.08', 'debe': 0.0, 'haber': 20000.0}, {'codigo': '2.1.06', 'debe': 0.0, 'haber': 25000.0}],
         'liquidación: Debe Gasto ISLR 50.000 / Haber ISLR a favor 5.000, Anticipos 20.000 y ISLR por pagar 25.000 (cuadra)')
    L.espera_error('no se liquida dos veces el mismo ejercicio', L.fn, 'fn_islr_contabilizar', 2025, uid, contiene='ya está liquidado'); L.rollback()
    M.como(2)
    L.espera_error('ejercicio liquidado: no admite anticipos nuevos en sus fechas', L.fn, 'fn_islr_anticipo_registrar', '2025-12-01', None, 10, None, None, uid, contiene='ya está liquidado'); L.rollback()
    M.como(2)
    L.espera_error('ejercicio liquidado: no se anula un anticipo suyo', L.fn, 'fn_islr_anticipo_anular', ant, 'intento', contiene='ya está liquidado'); L.rollback()
    M.como(2)
    pago = L.fn('fn_islr_pagar', 2025, L.hoy(), uid); L.commit()
    L.ok([(r['codigo'], r['debe'], r['haber']) for r in L.qd(
        "SELECT p.codigo, d.debe::float AS debe, d.haber::float AS haber FROM tienda.asiento_detalle d JOIN tienda.plan_cuentas p ON p.id = d.cuenta_id WHERE d.asiento_id = %s ORDER BY d.id", (pago,))]
         == [('2.1.06', 25000.0, 0.0), ('1.1.02', 0.0, 25000.0)], 'pago al SENIAT: Debe 2.1.06 por 25.000 / Haber 1.1.02 Bancos')
    L.espera_error('el saldo no se paga dos veces', L.fn, 'fn_islr_pagar', 2025, L.hoy(), uid, contiene='ya está pagado'); L.rollback()
    M.como(2)
    L.espera_error('pagado el saldo ya no se descontabiliza', L.fn, 'fn_islr_descontabilizar', 2025, uid, contiene='ya se pagó'); L.rollback()

    L.empezar('m12 · ISLR ASIENTOS: descontabilizar y corregir (ejercicio 2024)')
    M.como(2)
    L.fn('fn_islr_tramos_guardar', 2024, PLANO10)
    L.fn('fn_islr_declaracion_guardar', 2024, '2024-01-01', '2024-12-31', None, 0, 0, 100000, 0, 'm12-24', uid)
    a24 = L.fn('fn_islr_anticipo_registrar', '2024-06-30', None, 3000, 'ANT-24', None, uid)
    L.commit()
    l1 = L.fn('fn_islr_contabilizar', 2024, uid); L.commit()
    L.fn('fn_islr_descontabilizar', 2024, uid); L.commit()
    rev = L.qd("SELECT d.debe::float AS debe, d.haber::float AS haber FROM tienda.asientos a JOIN tienda.asiento_detalle d ON d.asiento_id = a.id WHERE a.origen_tipo = 'ANULACION_ISLR_EJERCICIO' AND a.fecha = CURRENT_DATE ORDER BY d.id")
    L.ok(rev == [{'debe': 0.0, 'haber': 10000.0}, {'debe': 3000.0, 'haber': 0.0}, {'debe': 7000.0, 'haber': 0.0}],
         'descontabilizar genera el contra-asiento: mismas líneas con los lados invertidos')
    L.ok(L.q1("SELECT contabilizada FROM tienda.islr_declaracion WHERE ejercicio = 2024") is False, 'el ejercicio queda otra vez abierto')
    L.fn('fn_islr_anticipo_anular', a24, 'error de captura'); L.commit()
    L.ok(L.q1("SELECT count(*) FROM tienda.asientos WHERE origen_tipo = 'ANULACION_ISLR_ANTICIPO' AND origen_id = %s", (a24,)) == 1, 'anular un anticipo genera su contra-asiento')
    L.fn('fn_islr_anticipo_registrar', '2024-06-30', None, 2000, 'ANT-24B', None, uid); L.commit()
    l2 = L.fn('fn_islr_contabilizar', 2024, uid); L.commit()
    L.ok(l2 != l1 and L.q1("SELECT count(*) FROM tienda.asientos WHERE origen_tipo = 'ISLR_EJERCICIO' AND fecha = '2024-12-31'") == 2,
         'se puede liquidar de nuevo con las cifras corregidas (nueva versión del asiento)')
    L.ok(float(L.q1("SELECT total_debe FROM tienda.asientos WHERE id = %s", (l2,))) == 10000.0, 'segunda liquidación: gasto 10.000 (renta 100.000 × 10 %)')

    L.empezar('m12 · ISLR ASIENTOS: aislamiento entre negocios')
    M.como(1)
    L.ok(L.q1("SELECT count(*) FROM tienda.asientos WHERE origen_tipo LIKE '%ISLR%' AND fecha BETWEEN '2024-01-01' AND '2025-12-31'") == 0,
         'el negocio 1 no ve ningún asiento de ISLR del negocio 2')
    L.espera_error('el negocio 1 no puede liquidar un ejercicio que no cargó', L.fn, 'fn_islr_contabilizar', 2025, None, contiene='Primero guarda'); L.rollback()
    M.como(1)
    L.espera_error('el negocio 1 no puede pagar el saldo del negocio 2', L.fn, 'fn_islr_pagar', 2025, L.hoy(), None, contiene='Primero liquida'); L.rollback()
    M.volver()
