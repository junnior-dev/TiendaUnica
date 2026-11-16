# -*- coding: utf-8 -*-
"""m10 · ISLR ANUAL (36_islr_declaracion.sql): anticipos, retenciones que te practicaron,
tramos y borrador de la declaración quedan aislados por negocio y respetan RLS."""
import json

import e2e_lib as L  # noqa: E402
import m_lib as M  # noqa: E402

TABLAS = ['islr_anticipos', 'islr_retenciones_sufridas', 'islr_declaracion', 'islr_tarifa_tramos']
TRAMOS = json.dumps([{'desde_ut': 0, 'hasta_ut': 1000, 'pct': 15, 'sustraendo_ut': 0},
                     {'desde_ut': 1000, 'hasta_ut': 2000, 'pct': 22, 'sustraendo_ut': 70},
                     {'desde_ut': 2000, 'hasta_ut': None, 'pct': 34, 'sustraendo_ut': 310}])


def main():
    L.empezar('m10 · ISLR ANUAL: estructura multiinquilino')
    M.volver()
    for t in TABLAS:
        r = L.fila("SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS f, "
                   "(SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'p_tenant') AS pol, "
                   "(SELECT count(*) FROM pg_trigger g WHERE g.tgrelid = c.oid AND g.tgname = 'trg_sello_negocio') AS sello, "
                   "(SELECT count(*) FROM information_schema.columns k WHERE k.table_schema='tienda' AND k.table_name = c.relname "
                   "  AND k.column_name = 'negocio_id' AND k.is_nullable = 'NO') AS col "
                   "FROM pg_class c WHERE c.oid = ('tienda.' || %s)::regclass", (t,))
        L.ok(r and r['rls'] and r['f'] and r['pol'] == 1 and r['sello'] == 1 and r['col'] == 1,
             f'{t}: negocio_id NOT NULL + RLS FORCE + política p_tenant + sello')

    L.ok(L.q1("SELECT count(*) FROM information_schema.columns WHERE table_schema='tienda' AND table_name='v_libro_ventas' AND column_name='id_negocio'") == 1,
         'v_libro_ventas expone id_negocio (37): se puede filtrar por tienda además del RLS')
    L.ok(L.q1("SELECT (modulos ->> 'fiscal')::boolean FROM tienda.estado_tenants WHERE negocio_id = 1") is True,
         'el negocio 1 (la tienda única de origen) conserva el módulo fiscal')

    L.empezar('m10 · ISLR ANUAL: cada negocio escribe y ve lo suyo')
    M.como(1)
    uid1 = M.uid_de('admin') or L.q1("SELECT min(id) FROM tienda.usuarios WHERE negocio_id = 1")
    a1 = L.fn('fn_islr_anticipo_registrar', L.hoy(), None, 1500.50, 'ANT-N1', 'anticipo del negocio 1', uid1)
    s1 = L.fn('fn_islr_sufrida_registrar', L.hoy(), 'Cliente Agente N1', L.rif('J'), 'CMP-001', None, 10000, 200, None, uid1)
    L.fn('fn_islr_declaracion_guardar', 2026, '2026-01-01', '2026-12-31', None, 1000, 0, 0, 0, 'N1', uid1)
    L.fn('fn_islr_tramos_guardar', 2026, TRAMOS)
    L.commit()
    M.como(2)
    uid2 = M.uid_de('admin_bodega')
    a2 = L.fn('fn_islr_anticipo_registrar', L.hoy(), None, 99.00, 'ANT-N2', None, uid2)
    L.fn('fn_islr_tramos_guardar', 2026, json.dumps([{'desde_ut': 0, 'hasta_ut': None, 'pct': 10, 'sustraendo_ut': 0}]))
    L.commit()
    L.ok(L.q1("SELECT count(*) FROM tienda.islr_anticipos") == 1 and L.q1("SELECT negocio_id FROM tienda.islr_anticipos") == 2,
         'el negocio 2 ve UN anticipo y es suyo (no ve el del negocio 1)')
    L.ok(L.q1("SELECT count(*) FROM tienda.islr_retenciones_sufridas") == 0, 'el negocio 2 no ve las retenciones sufridas del negocio 1')
    L.ok(L.q1("SELECT count(*) FROM tienda.islr_declaracion") == 0, 'el negocio 2 no ve la declaración del negocio 1')
    L.ok(L.q1("SELECT count(*) FROM tienda.islr_tarifa_tramos") == 1, 'el negocio 2 tiene su tarifa de 1 tramo; los 3 tramos del negocio 1 no se tocaron ni se ven')
    L.espera_error('el negocio 2 no puede anular el anticipo del negocio 1', L.fn, 'fn_islr_anticipo_anular', a1, 'intento cruzado', contiene='no existe')
    L.rollback()
    L.espera_error('el negocio 2 no puede anular la retención sufrida del negocio 1', L.fn, 'fn_islr_sufrida_anular', s1, 'intento cruzado', contiene='no existe')
    L.rollback()
    M.como(1)
    L.ok(L.q1("SELECT count(*) FROM tienda.islr_tarifa_tramos") == 3, 'el negocio 1 conserva sus 3 tramos (guardar los del negocio 2 no los borró)')
    L.ok(L.q1("SELECT count(*) FROM tienda.islr_anticipos WHERE estado = 'ACTIVO'") == 1, 'el negocio 1 sigue con su anticipo activo')
    # mismo comprobante y mismo RIF en dos negocios: permitido; dos veces en el mismo: rechazado
    rif = L.q1("SELECT agente_rif FROM tienda.islr_retenciones_sufridas LIMIT 1")
    L.espera_error('mismo comprobante del mismo cliente en el mismo negocio: rechazado', L.fn, 'fn_islr_sufrida_registrar',
                   L.hoy(), 'Cliente Agente N1', rif, 'CMP-001', None, 500, 10, None, uid1, contiene='Ya registraste')
    L.rollback()
    M.como(2)
    L.fn('fn_islr_sufrida_registrar', L.hoy(), 'Cliente Agente N1', rif, 'CMP-001', None, 500, 10, None, uid2)
    L.commit()
    L.ok(True, 'el mismo comprobante y RIF sí se puede registrar en OTRO negocio (unicidad por negocio)')

    L.empezar('m10 · ISLR ANUAL: sello, WITH CHECK y sesión sin negocio')
    M.como(2)
    n = L.ejecutar("INSERT INTO tienda.islr_anticipos (fecha_pago, monto_ves) VALUES (CURRENT_DATE, 5)")
    L.commit()
    L.ok(L.q1("SELECT count(*) FROM tienda.islr_anticipos WHERE monto_ves = 5 AND negocio_id = 2") == 1,
         'INSERT sin negocio_id queda sellado con el negocio de la sesión (2)')
    L.espera_error('insertar un anticipo con negocio_id = 1 desde la sesión del negocio 2 es rechazado por RLS',
                   L.ejecutar, "INSERT INTO tienda.islr_anticipos (negocio_id, fecha_pago, monto_ves) VALUES (1, CURRENT_DATE, 7)")
    L.rollback()
    L.espera_error('un registro de ISLR no se borra', L.ejecutar, "DELETE FROM tienda.islr_anticipos WHERE monto_ves = 5")
    L.rollback()
    L.rollback(); L.ejecutar("SET ROLE saas_app"); L.ejecutar("RESET app.negocio_id")
    L.ok(L.q1("SELECT count(*) FROM tienda.islr_anticipos") == 0 and L.q1("SELECT count(*) FROM tienda.islr_declaracion") == 0,
         'rol de app SIN negocio fijado: no ve ninguna fila (no cae al negocio 1)')
    M.volver()

    L.empezar('m10 · ISLR ANUAL: borrador de cada negocio')
    M.como(1)
    b1 = L.q1("SELECT tienda.fn_islr_borrador(2026)")
    L.ok(b1['configurado'] is True and float(b1['gastos']) == 1000 and b1['tramo'] is None and float(b1['retenciones_sufridas']) == 200
         and float(b1['anticipos']) == 1500.50, 'borrador del negocio 1: sus gastos 1000, sus retenciones sufridas 200 y su anticipo 1500,50')
    M.como(2)
    b2 = L.q1("SELECT tienda.fn_islr_borrador(2026)")
    L.ok(b2['configurado'] is False and float(b2['retenciones_sufridas']) == 10 and float(b2['anticipos']) == 104.00,
         'borrador del negocio 2: sin declaración propia; retenciones 10 y anticipos 104 (99 + 5), nada del negocio 1')
    L.ok(not any('Aún no hay gastos' in a for a in b1['avisos']) and any('Aún no hay gastos' in a for a in b2['avisos']),
         'los avisos son por negocio: el 2 (sin declaración) los recibe y el 1 (que ya cargó sus cifras) no')
    # cálculo del impuesto con la tarifa propia del negocio 2 (10 % plano): renta 500.000 → impuesto 50.000
    L.fn('fn_islr_declaracion_guardar', 2026, '2026-01-01', '2026-12-31', None, 0, 0, 500000, 1000, 'N2', uid2)
    L.commit()
    c2 = L.q1("SELECT tienda.fn_islr_borrador(2026)")
    renta = float(c2['ingresos']) - float(c2['costo']) + 500000          # sus ventas reales (m05) + el ajuste que escribió el contador
    imp = round(renta * 0.10, 2)
    L.ok(float(c2['ingresos']) > 0 and abs(float(c2['renta_neta']) - renta) < 0.01 and abs(float(c2['impuesto']) - imp) < 0.01
         and abs(float(c2['impuesto_neto']) - (imp - 1000)) < 0.01 and abs(float(c2['saldo']) - (imp - 1000 - 10 - 104)) < 0.01,
         f"negocio 2: renta {renta:,.2f} (sus ventas {float(c2['ingresos']):,.2f} − costo + ajuste 500.000) × 10 % = {imp:,.2f}; − rebajas 1.000 − retenciones 10 − anticipos 104 = saldo {c2['saldo']}")
    M.volver(); L.ejecutar("SET app.negocio_id = '2'")           # superusuario con negocio fijado: el filtro explícito basta
    L.ok(L.q1("SELECT count(DISTINCT id_negocio) FROM tienda.v_libro_ventas") >= 1
         and float(L.q1("SELECT (tienda.fn_islr_borrador(2026))->>'ingresos'")) == float(c2['ingresos']),
         'como superusuario el borrador del negocio 2 da lo mismo: ya no depende solo del RLS')
    L.ejecutar("RESET app.negocio_id"); M.como(2)
    L.ok(float(c2['documentos']) == L.q1("SELECT count(*) FROM tienda.ventas WHERE negocio_id = 2 AND estado <> 'ANULADA'"),
         'los ingresos salen SOLO de las ventas del negocio 2 (cuenta sus documentos, no los del 1)')
    M.como(1)
    c1 = L.q1("SELECT tienda.fn_islr_borrador(2026)")
    L.ok(float(c1['impuesto']) == 0 and float(c1['renta_neta']) < 0, 'el negocio 1 (gastos y sin ventas) sigue en pérdida: la tarifa y la declaración del 2 no le afectan')
    M.volver()

    L.empezar('m10 · ISLR ANUAL: portabilidad (exportar el negocio incluye sus tablas de ISLR)')
    paq = L.q1("SELECT tienda.fn_exportar_negocio(2)")
    L.ok(all(t in paq for t in TABLAS), 'el paquete de exportación trae las 4 tablas nuevas')
    L.ok(len(paq['islr_anticipos']) == 2 and len(paq['islr_tarifa_tramos']) == 1 and all(r['negocio_id'] == 2 for r in paq['islr_anticipos']),
         'solo salen las filas del negocio 2 (sus 2 anticipos; el del negocio 1 no sale)')


if __name__ == '__main__':
    L.conectar(); main(); L.resumen_final()
