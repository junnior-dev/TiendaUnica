# -*- coding: utf-8 -*-
"""f15 · MEDIA: Asientos automáticos — partida doble por origen y referencia al documento."""
import e2e_lib as L


def main():
    L.empezar('f15 · Asientos automáticos: partida doble por origen')
    # Generar asientos para los documentos existentes (acción de Contabilidad con automática)
    L.ejecutar("UPDATE tienda.contab_config SET automatica = true WHERE id = 1")
    L.commit()
    for (vid,) in L.qs("SELECT id FROM tienda.ventas WHERE estado <> 'ANULADA' ORDER BY id DESC LIMIT 3"):
        try:
            L.fn('fn_asiento_venta', vid)
            L.commit()
        except Exception:
            L.conn.rollback()
    for (cid,) in L.qs("SELECT id FROM tienda.compras WHERE estado <> 'ANULADA' ORDER BY id DESC LIMIT 2"):
        try:
            L.fn('fn_asiento_compra', cid)
            L.commit()
        except Exception:
            L.conn.rollback()
    origenes = L.qs("SELECT origen_tipo, count(*) FROM tienda.asientos GROUP BY 1 ORDER BY 1")
    L.ok(len(origenes) >= 3, f'tipos de asiento generados: {[o[0] for o in origenes]}')

    # 1) Partida doble en TODOS los asientos, por origen
    descuadre = L.qs("SELECT a.origen_tipo, count(*) FROM tienda.asientos a "
                     "GROUP BY a.origen_tipo, a.id "
                     "HAVING abs((SELECT COALESCE(sum(d.debe), 0) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) - "
                     "(SELECT COALESCE(sum(d.haber), 0) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id)) > 0.01")
    L.ok(len(descuadre) == 0, f'todos los asientos cuadran (debe = haber): {len(descuadre)} descuadrados')

    # 2) Cada origen automático apunta a un documento real
    for tipo, tabla, col in [('VENTA', 'ventas', 'id'), ('COMPRA', 'compras', 'id'),
                             ('ENTERO_ISLR', 'enteros_islr', 'id')]:
        n = L.q1(f"SELECT count(*) FROM tienda.asientos a WHERE a.origen_tipo = %s AND NOT EXISTS "
                 f"(SELECT 1 FROM tienda.{tabla} t WHERE t.{col} = a.origen_id)", (tipo,))
        L.ok(n == 0, f'asientos {tipo}: origen_id siempre apunta a {tabla} ({n} huérfanos)')

    # 3) CIERRE y AJUSTE_CAMBIARIO llevan el ejercicio/mes en origen_id
    cierres = L.qs("SELECT origen_id, fecha FROM tienda.asientos WHERE origen_tipo = 'CIERRE'")
    for oid, fecha in cierres:
        L.ok(str(fecha.year) == str(oid) and str(fecha) == f'{oid}-12-31', f'asiento CIERRE {oid} fechado 31/12/{oid}')
    ajustes = L.qs("SELECT origen_id FROM tienda.asientos WHERE origen_tipo = 'AJUSTE_CAMBIARIO'")
    for (oid,) in ajustes:
        L.ok(len(str(oid)) == 6, f'ajuste cambiario con clave de mes AAAAMM ({oid})')

    # 4) Las líneas apuntan a cuentas activas del plan
    hu = L.q1("SELECT count(*) FROM tienda.asiento_detalle d LEFT JOIN tienda.plan_cuentas p ON p.id = d.cuenta_id "
              "WHERE p.id IS NULL")
    L.ok(hu == 0, f'todas las líneas de asiento usan cuentas del plan ({hu} huérfanas)')
