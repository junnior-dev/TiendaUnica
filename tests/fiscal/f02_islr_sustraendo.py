# -*- coding: utf-8 -*-
"""f02 · CRÍTICA: ISLR — sustraendo Decreto 1.808, natural/jurídica, UT vigente."""
import json as J

import e2e_lib as L


def main():
    L.empezar('f02 · ISLR: sustraendo, natural/jurídica, UT')
    uid = L.admin()
    hoy = L.hoy()
    import datetime
    hace_20 = datetime.date.fromisoformat(str(hoy)) - datetime.timedelta(days=20)

    # 1) UT vigente Bs 43 desde hoy; la fila del período anterior conserva SU valor (no se mezclan)
    L.ejecutar("DELETE FROM tienda.islr_ut WHERE desde = %s", (hoy,))
    L.fn('fn_islr_guardar_ut', hoy, 43, 'E2E fiscal: UT de prueba', uid)
    L.commit()
    prev = L.fila("SELECT desde, valor_ves FROM tienda.islr_ut WHERE desde < %s ORDER BY desde DESC LIMIT 1", (hoy,))
    L.ok(prev is not None, 'hay fila de UT del período anterior')
    L.ok(float(L.fn('fn_islr_ut', prev['desde'])) == float(prev['valor_ves']),
         'cada fecha usa SU fila de UT (' + str(prev['desde']) + ' → ' + str(prev['valor_ves']) + ')')
    L.ok(float(L.fn('fn_islr_ut', hoy)) == 43.0, f'UT vigente = {L.fn("fn_islr_ut", hoy)}')
    factor = float(L.q1("SELECT factor_sustraendo FROM tienda.islr_config WHERE id = 1"))
    L.ok(abs(factor - 83.3334) < 0.001, f'factor de sustraendo = {factor} (Decreto 1.808)')

    # 2) Persona NATURAL, honorarios 3 %, base 10.000 → 300 − (43 × 3 % × 83,3334) = 192,50
    r = L.fn('fn_islr_calcular', hoy, 'N', 'HONORARIOS', 10000, L.rif('V'))
    r = r if isinstance(r, dict) else J.loads(r)
    sus = float(r['sustraendo'])
    L.ok(abs(sus - 107.50) < 0.02, f'sustraendo = {sus} (43 × 3 % × 83,3334 = 107,50)')
    L.ok(abs(float(r['retenido']) - 192.50) < 0.02, f'natural 3 %: retenido {r["retenido"]} (esperado 192,50)')
    L.ok(float(r['porcentaje']) == 3.0 and r['corresponde'] is True, '3 % aplicado y corresponde retener')

    # 3) Persona JURÍDICA honorarios 5 % → 10.000 × 5 % = 500, sin sustraendo
    rj = L.fn('fn_islr_calcular', hoy, 'J', 'HONORARIOS', 10000, 'J-40555111-8')
    rj = rj if isinstance(rj, dict) else J.loads(rj)
    L.ok(abs(float(rj['retenido']) - 500.0) < 0.02, f'jurídica 5 %: retenido {rj["retenido"]} (esperado 500,00)')
    L.ok(float(rj['sustraendo']) == 0, 'el sustraendo SOLO aplica a personas naturales')

    # 4) Monto bajo el mínimo: base 3.000 natural → 90 − 107,50 < 0 → NO corresponde
    rb = L.fn('fn_islr_calcular', hoy, 'N', 'HONORARIOS', 3000, L.rif('V'))
    rb = rb if isinstance(rb, dict) else J.loads(rb)
    L.ok(float(rb['retenido']) == 0 and rb['corresponde'] is False, f'base 3.000: retenido {rb["retenido"]}, corresponde={rb["corresponde"]}')

    # 5) El sustraendo depende de la UT de la FECHA del pago (nunca se mezclan UT)
    rprev = L.fn('fn_islr_calcular', prev['desde'], 'N', 'HONORARIOS', 10000, L.rif('V'))
    rprev = rprev if isinstance(rprev, dict) else J.loads(rprev)
    sus_prev = float(rprev['sustraendo'])
    L.ok(sus_prev != sus or prev['valor_ves'] == 43, 'sustraendo con la UT del período anterior: ' + str(sus_prev) + ' vs ' + str(sus))

    # 6) sustraendo_una_vez_mes: el segundo pago al mismo beneficiario en el mes NO aplica sustraendo
    L.ejecutar("UPDATE tienda.islr_config SET sustraendo_una_vez_mes = true WHERE id = 1")
    L.commit()
    prov = L.q1("SELECT id FROM tienda.proveedores WHERE activo ORDER BY id LIMIT 1")
    rif_natural = L.rif('V')   # el MISMO beneficiario en los dos pagos del mes
    ret1 = L.fn('fn_registrar_retencion_islr', hoy, 'Prof. Primero', rif_natural, 'N', 'HONORARIOS', 'AP-2001', 10000, 'VES', 'BANCOS', prov, None, uid)
    L.commit()
    r2 = L.fn('fn_islr_calcular', hoy, 'N', 'HONORARIOS', 10000, rif_natural)
    r2 = r2 if isinstance(r2, dict) else J.loads(r2)
    L.ok(r2['sustraendo_ya_aplicado_en_el_mes'] is True and float(r2['sustraendo']) == 0,
         'segunda retención del mes: sustraendo ya aplicado (sus = 0)')
    L.ok(abs(float(r2['retenido']) - 300.0) < 0.02, f'segunda retención: {r2["retenido"]} = base × 3 % sin sustraendo')
    L.ejecutar("UPDATE tienda.islr_config SET sustraendo_una_vez_mes = false WHERE id = 1")
    L.commit()

    # 7) Concepto SIN sustraendo: retenido = base × pct directo
    L.ejecutar("UPDATE tienda.islr_conceptos SET sustraendo_nat = false WHERE codigo = 'CONTRATISTAS'")
    L.commit()
    rc = L.fn('fn_islr_calcular', hoy, 'N', 'CONTRATISTAS', 10000, L.rif('V'))
    rc = rc if isinstance(rc, dict) else J.loads(rc)
    L.ok(abs(float(rc['retenido']) - 100.0) < 0.02 and float(rc['sustraendo']) == 0,
         f'CONTRATISTAS sin sustraendo: {rc["retenido"]} = 10.000 × 1 %')
    L.ejecutar("UPDATE tienda.islr_conceptos SET sustraendo_nat = true WHERE codigo = 'CONTRATISTAS'")
    L.commit()

    # 8) La retención registrada congela la UT y la tasa del día
    r1 = L.fila("SELECT base_ves, retenido_ves, tasa_ves, sustraendo_ves FROM tienda.retenciones_islr WHERE id = %s", (ret1,))
    L.ok(abs(float(r1['retenido_ves']) - 192.50) < 0.05, f'retención congelada: retenido_ves {r1["retenido_ves"]}')
    L.ok(float(r1['base_ves']) == 10000 and float(r1['sustraendo_ves']) == 107.5, 'base y sustraendo congelados en la fila')
    L.ok(float(r1['tasa_ves']) == 1.0, 'moneda VES → tasa 1')
    L.espera_error('concepto inválido rechazado', L.fn, 'fn_islr_calcular', hoy, 'J', 'NO_EXISTE', 1000, L.rif('J'))
    L.espera_error('tipo inválido rechazado', L.fn, 'fn_islr_calcular', hoy, 'X', 'HONORARIOS', 1000, L.rif('J'))
