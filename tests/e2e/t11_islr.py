# -*- coding: utf-8 -*-
"""t11 · ISLR: tabla de UT, cálculo Decreto 1808 (natural con sustraendo, jurídica),
registro de retenciones, entero mensual y anulación."""
import json as J

import e2e_lib as L


def main():
    L.empezar('t11 · Retenciones ISLR (Decreto 1808)')
    uid = L.admin()
    hoy = L.hoy()

    # 1) UT vigente: se carga y se consulta
    L.fn('fn_islr_guardar_ut', hoy, 190.28, 'E2E: Gaceta Oficial simulada', uid)
    L.commit()
    L.ok(float(L.fn('fn_islr_ut', hoy)) == 190.28, f'UT vigente = {L.fn("fn_islr_ut", hoy)}')

    # 2) Cálculo jurídico: base × pct_juridica del concepto (Decreto 1808)
    con = L.fila("SELECT codigo, nombre, pct_natural, pct_juridica, sustraendo_nat FROM tienda.islr_conceptos WHERE activo ORDER BY orden LIMIT 1")
    base = 10000
    rj = L.fn('fn_islr_calcular', hoy, 'J', con['codigo'], base, 'J-40555111-8')
    rj = rj if isinstance(rj, dict) else J.loads(rj)
    esperado_j = round(base * float(con['pct_juridica']) / 100, 2)
    L.ok(abs(float(rj['retenido']) - esperado_j) < 0.02,
         f'{con["codigo"]} jurídica {con["pct_juridica"]} %: retención {rj["retenido"]} (esperado {esperado_j})')
    L.ok(float(rj['porcentaje']) == float(con['pct_juridica']), 'porcentaje aplicado correcto')

    # 3) Natural con sustraendo: base × pct_natural − (UT × pct × factor_sustraendo)
    rn = L.fn('fn_islr_calcular', hoy, 'N', con['codigo'], base, 'V-9887123')
    rn = rn if isinstance(rn, dict) else J.loads(rn)
    ut = float(L.fn('fn_islr_ut', hoy) or 0)
    factor = float(L.q1("SELECT factor_sustraendo FROM tienda.islr_config WHERE id = 1") or 1)
    sus = round(ut * float(con['pct_natural']) / 100 * factor, 2) if con['sustraendo_nat'] else 0
    esperado_n = round(max(0, round(base * float(con['pct_natural']) / 100, 2) - sus), 2)
    L.ok(abs(float(rn['retenido']) - esperado_n) < 0.02,
         f'{con["codigo"]} natural {con["pct_natural"]} % − sustraendo {sus}: {rn["retenido"]} (esperado {esperado_n})')

    # 4) Registrar una retención real de un pago de mantenimiento en USD
    prov = L.q1("SELECT id FROM proveedores WHERE activo ORDER BY id LIMIT 1")
    rif_prov = L.q1("SELECT rif FROM proveedores WHERE id = %s", (prov,))
    fecha_ret = hoy
    ret = L.fn('fn_registrar_retencion_islr', fecha_ret, f'{L.fake.company()} C.A.', rif_prov, 'J', con['codigo'],
               f'AP-{L.fake.random_number(digits=4)}', 480, 'USD', 'BANCOS', prov, None, uid)
    L.commit()
    r = L.fila("SELECT * FROM tienda.retenciones_islr WHERE id = %s", (ret,))
    tasa = float(L.fn_fila('fn_tasa_aplicable', hoy, 'USD', 'VES')['tasa'])
    L.ok(r and r['estado'] == 'ACTIVA', f'retención #{ret} ACTIVA')
    L.ok(abs(float(r['base_ves']) - 480 * tasa) < 1.0, f'base en Bs por la tasa del día: {r["base_ves"]} (480 × {tasa:.4f})')
    L.ok(abs(float(r['retenido_ves']) - 480 * tasa * 0.05) < 1.0, f'retenido 5 %: {r["retenido_ves"]}')
    L.ok(r['numero'] and len(str(r['numero'])) == 14 and str(r['numero']).startswith(str(fecha_ret.year) + f"{fecha_ret.month:02d}"),
         f'comprobante correlativo AAAAMM00000000: {r["numero"]}')

    # 5) Entero mensual: junta las activas sin entero del período
    n_enteros0 = L.q1("SELECT count(*) FROM tienda.enteros_islr")
    # El entero exige fecha de pago ≥ fin del período y no futura: se cubre del día 1 hasta HOY
    L.fn('fn_enterar_islr', f'{hoy.year}-11-01', hoy, hoy, f'PM-{L.fake.random_number(digits=8)}', uid)
    L.commit()
    L.ok(L.q1("SELECT count(*) FROM tienda.enteros_islr") >= n_enteros0 + 1, 'entero ISLR del mes anterior creado')
    ent = L.q1("SELECT entero_id FROM tienda.retenciones_islr WHERE id = %s", (ret,))
    L.ok(ent is not None, f'retención #{ret} enlazada al entero #{ent}')
    L.espera_error('enterar de nuevo el período ya cubierto rechazado', L.fn, 'fn_enterar_islr',
                   f'{hoy.year}-11-01', hoy, hoy, 'PM-OTRO', uid, contiene='enterar')

    # 6) Desmarcar el entero (error humano) y anular la retención
    L.fn('fn_desmarcar_entero_islr', ent, 'Fue del período anterior', uid)
    L.commit()
    L.ok(L.q1("SELECT entero_id FROM tienda.retenciones_islr WHERE id = %s", (ret,)) is None, 'entero desmarcado')
    L.fn('fn_anular_retencion_islr', ret, 'Retención duplicada E2E', uid)
    L.commit()
    L.ok(L.q1("SELECT estado FROM tienda.retenciones_islr WHERE id = %s", (ret,)) == 'ANULADA', 'retención ANULADA')
    L.ok(L.q1("SELECT motivo_anulacion FROM tienda.retenciones_islr WHERE id = %s", (ret,)) is not None, 'motivo de anulación guardado')
