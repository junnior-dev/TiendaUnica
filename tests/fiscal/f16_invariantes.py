# -*- coding: utf-8 -*-
"""f16 · INVARIANTES GLOBALES (capa 2): lo que SIEMPRE debe cumplirse."""
import e2e_lib as L


def main():
    L.empezar('f16 · Invariantes globales (capa 2)')

    # 1) Partida doble: debe = haber en TODOS los asientos, en cualquier momento
    d = L.q1("SELECT count(*) FROM (SELECT a.id, (SELECT COALESCE(sum(debe), 0) FROM tienda.asiento_detalle WHERE asiento_id = a.id) debe, "
             "(SELECT COALESCE(sum(haber), 0) FROM tienda.asiento_detalle WHERE asiento_id = a.id) haber FROM tienda.asientos a) x "
             "WHERE abs(debe - haber) > 0.01")
    L.ok(d == 0, f'INVARIANTE partida doble: {d} asientos descuadrados (debe ser 0)')

    # 2) Ventas completadas: total = base + exento + IVA (+ IGTF)
    mal = L.qs("SELECT id FROM tienda.ventas WHERE estado = 'COMPLETADA' AND igtf_usd = 0 AND "
               "abs(total_ves - (base_ves + exento_ves + iva_ves)) > 0.05")
    L.ok(len(mal) == 0, f'INVARIANTE aritmética de ventas: {len(mal)} ventas con total ≠ base+exento+IVA')

    # 3) Con IGTF: total_cobrar = total + IGTF
    mal_ig = L.qs("SELECT id FROM tienda.ventas WHERE estado = 'COMPLETADA' AND igtf_usd > 0 AND "
                  "abs(total_cobrar_ves - total_ves - igtf_ves) > 0.05")
    L.ok(len(mal_ig) == 0, f'INVARIANTE con IGTF: {len(mal_ig)} ventas donde cobrar ≠ total+IGTF')

    # 4) Detalle de venta: cantidades siempre positivas
    c = L.q1("SELECT count(*) FROM tienda.detalle_venta WHERE cantidad <= 0")
    L.ok(c == 0, f'INVARIANTE cantidades: {c} líneas con cantidad ≤ 0')

    # 5) Montos nunca NaN ni negativos en documentos fiscales
    nn = L.q1("SELECT count(*) FROM tienda.ventas WHERE total_ves::text LIKE '%NaN%' OR base_ves::text LIKE '%NaN%' OR total_ves < 0")
    L.ok(nn == 0, f'INVARIANTE montos: {nn} ventas con NaN o negativos')

    # 6) Stock físico nunca negativo (la base no permite vender de más)
    sn = L.q1("SELECT count(*) FROM tienda.productos WHERE stock_actual < 0")
    L.ok(sn == 0, f'INVARIANTE inventario: {sn} productos con stock negativo')

    # 7) El IVA congelado de cada venta coincide con su tasa vigente en la fecha
    mal_t = L.qs("SELECT DISTINCT v.id FROM tienda.ventas v WHERE v.estado <> 'ANULADA' AND "
                 "abs(v.iva_pct - COALESCE((SELECT porcentaje FROM tienda.parametros_fiscales WHERE codigo = 'IVA_GENERAL' "
                 "AND v.fecha_valor BETWEEN vigente_desde AND COALESCE(vigente_hasta, '2999-12-31') LIMIT 1), v.iva_pct)) > 0.01")
    L.ok(len(mal_t) == 0, f'INVARIANTE alícuota congelada: {len(mal_t)} ventas con IVA ≠ alícuota vigente de su fecha')

    # 8) Los pagos de toda venta de contado cuadran con su total
    mal_p = L.qs("SELECT v.id FROM tienda.ventas v LEFT JOIN tienda.pagos_venta p ON p.venta_id = v.id "
                 "WHERE v.estado = 'COMPLETADA' AND NOT v.es_credito GROUP BY v.id "
                 "HAVING abs(v.total_usd - COALESCE(sum(p.monto_usd), 0)) > 0.02")
    L.ok(len(mal_p) == 0, f'INVARIANTE cobros: {len(mal_p)} ventas de contado mal cobradas')

    # 9) Sin saldos de CxC mayores al monto original
    mal_c = L.q1("SELECT count(*) FROM tienda.cuentas_por_cobrar WHERE saldo_usd > monto_original_usd + 0.01")
    L.ok(mal_c == 0, f'INVARIANTE CxC: {mal_c} cuentas con saldo mayor al original')
