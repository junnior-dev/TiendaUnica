# -*- coding: utf-8 -*-
"""m13 · PLAN BÁSICO (SISTEMA) vs COMPLETO (ESPECIAL): el plan solo decide qué se MUESTRA.
Una tienda del plan Sistema vende, y por debajo se guardan igual el IVA, la factura y los asientos; al subir de plan
todo aparece al día, sin regenerar nada. Usa la función real de provisión (35_provisionar.sql)."""
import json

import e2e_lib as L  # noqa: E402
import m_lib as M  # noqa: E402


def pagar(total_usd, tasa):
    m = L.q1("SELECT id FROM tienda.metodos_pago WHERE nombre = 'Pago móvil' AND activo")
    return json.dumps([{'metodo_pago_id': m, 'monto': round(float(total_usd) * float(tasa), 2), 'referencia': 'PM-M13'}])


def main():
    L.empezar('m13 · PLAN BÁSICO: alta real con el plan SISTEMA')
    M.volver()
    L.ejecutar("SET search_path = tienda, public")      # igual que la conexión de la app (config/database.php)
    n = L.q1("SELECT fn_provisionar_negocio(%s, %s, %s, %s, %s, %s, %s)",
             ('Ferretería El Tornillo C.A.', L.rif('J'), 'el-tornillo', 'Admin Tornillo', 'PENDIENTE', 'admin_tornillo', 'SISTEMA'))
    L.commit()
    mods = L.q1("SELECT modulos FROM tienda.estado_tenants WHERE negocio_id = %s", (n,))
    plan = L.q1("SELECT plan FROM tienda.estado_tenants WHERE negocio_id = %s", (n,))
    L.ok(plan == 'SISTEMA' and not (mods or {}).get('fiscal'), f'plan SISTEMA sin el módulo fiscal (modulos = {mods})')
    M.como(n)
    L.ok(L.q1("SELECT tienda.fn_negocio_modulo('fiscal')") is False, 'fn_negocio_modulo(fiscal) = false para esa tienda')
    L.ok(L.q1("SELECT automatica FROM tienda.contab_config WHERE id = %s", (n,)) is True,
         'la contabilidad automática queda ENCENDIDA por debajo (se muestra solo con el plan completo)')

    L.empezar('m13 · PLAN BÁSICO: vende y por debajo se guarda todo')
    uid = M.uid_de('admin_tornillo')
    if L.q1("SELECT tienda.fn_apertura_activa(%s)", (uid,)) is None:
        L.fn('fn_abrir_caja', uid, 50, 500)
    p = M.producto_base('M13-TORN', 'Tornillo 1/4 caja', precio=10.0, costo=6.0)
    M.carga_stock(p, uid, 100)
    items = [{'producto_id': p, 'cantidad': 3}]
    cot = L.fn_fila('fn_cotizar_venta', json.dumps(items))
    v = L.fn('fn_registrar_venta', uid, json.dumps(items), pagar(cot['total_usd'], cot['tasa_cambio']), None, None, 'PRESENCIAL', False, 0)
    L.commit()
    L.ok(float(cot['base_usd']) == 30.0 and float(cot['total_usd']) == 34.8, f'venta con IVA 16%: base {cot["base_usd"]} → total {cot["total_usd"]}')
    d = L.fila("SELECT iva_pct, base_usd, iva_usd FROM tienda.detalle_venta WHERE venta_id = %s", (v,))
    L.ok(float(d['iva_pct']) == 16 and float(d['base_usd']) == 30.0 and float(d['iva_usd']) == 4.8, 'el IVA se guarda en la línea aunque el plan no lo muestre')
    lib = L.fila("SELECT iva_ves, base_imponible_ves, id_negocio FROM tienda.v_libro_ventas WHERE id_negocio = %s", (n,))   # su única venta
    L.ok(lib is not None and lib['id_negocio'] == n and float(lib['iva_ves']) > 0, 'la venta ya está en el libro de ventas con su IVA (oculto, pero al día)')
    asi = L.q1("SELECT id FROM tienda.asientos WHERE origen_tipo = 'VENTA' AND origen_id = %s", (v,))
    L.ok(asi is not None, 'la venta generó su asiento contable por debajo')
    if asi:
        t = L.fila("SELECT sum(debe)::numeric AS d, sum(haber)::numeric AS h FROM tienda.asiento_detalle WHERE asiento_id = %s", (asi,))
        L.ok(t['d'] == t['h'] and t['d'] > 0, f'el asiento cuadra: Debe {t["d"]} = Haber {t["h"]}')
    libro_antes = L.q1("SELECT count(*) FROM tienda.v_libro_ventas")
    asientos_antes = L.q1("SELECT count(*) FROM tienda.asientos")

    L.empezar('m13 · PLAN COMPLETO: al subir de plan aparece todo, sin regenerar nada')
    M.volver()
    L.ejecutar("UPDATE tienda.estado_tenants SET plan = 'ESPECIAL', modulos = '{\"repuestos\": true, \"ropa\": true, \"fiscal\": true}'::jsonb WHERE negocio_id = %s", (n,))
    L.commit()
    M.como(n)
    L.ok(L.q1("SELECT tienda.fn_negocio_modulo('fiscal')") is True, 'tras el cambio de plan, fn_negocio_modulo(fiscal) = true')
    L.ok(L.q1("SELECT count(*) FROM tienda.v_libro_ventas") == libro_antes and L.q1("SELECT count(*) FROM tienda.asientos") == asientos_antes,
         'el libro de ventas y los asientos son exactamente los mismos: nada se perdió ni se duplicó')
    L.ok(L.q1("SELECT count(*) FROM tienda.v_libro_ventas WHERE id_negocio = %s", (n,)) == 1, 'la venta hecha en el plan básico ya figura en el libro fiscal')

    L.empezar('m13 · AISLAMIENTO: la tienda del plan básico no ve datos de otras')
    L.ok(L.q1("SELECT count(*) FROM tienda.ventas WHERE negocio_id <> %s", (n,)) == 0, 'solo ve sus propias ventas')
    L.ok(L.q1("SELECT count(*) FROM tienda.asientos WHERE negocio_id <> %s", (n,)) == 0, 'solo ve sus propios asientos')
    M.volver()
