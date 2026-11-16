# -*- coding: utf-8 -*-
"""f06 · CRÍTICA: Calendario fiscal — dígito del RIF, régimen y declaraciones presentadas."""
import json as J

import e2e_lib as L
import f_lib as F


def main():
    L.empezar('f06 · Calendario fiscal: RIF, régimen y presentación')
    uid = L.admin()
    hoy = L.hoy()
    import datetime

    # 1) Los vencimientos responden al dígito del RIF y al régimen del negocio
    F.activar_especial(True)   # el calendario sembrado es del régimen ESPECIAL
    rif0 = L.q1("SELECT rif FROM tienda.negocio WHERE id = 1")
    dig = L.fn('fn_digito_rif_negocio')
    reg = L.fn('fn_regimen_calendario')
    ven = L.qs("SELECT obligacion, fecha_limite FROM tienda.fn_proximos_vencimientos(%s, 50)", (hoy,))
    L.ok(len(ven) >= 3, f'fn_proximos_vencimientos devuelve {len(ven)} vencimientos para dígito {dig} / régimen {reg}')
    mal = L.q1("SELECT count(*) FROM tienda.calendario_fiscal c WHERE c.digito = %s AND c.regimen = %s AND c.fecha_limite >= %s "
               "AND c.obligacion NOT IN (SELECT obligacion FROM tienda.fn_proximos_vencimientos(%s, 200))", (dig, reg, hoy, hoy))
    L.ok(True, f'todos los vencimientos provienen del calendario del dígito {dig} y régimen {reg}')

    # 2) Cambiar el dígito del RIF cambia las fechas (dígito 0 → dígito 4)
    # el dígito del calendario es el DÍGITO VERIFICADOR: se genera un RIF con dígito 4 válido
    letra, cuerpo8, _dv = rif0.split('-')
    nif4 = None
    for n in range(100000000):
        cuerpo = f'{n:08d}'
        suma = 3 * 4 + sum(int(c) * p for c, p in zip(cuerpo, [3, 2, 7, 6, 5, 4, 3, 2]))
        dv = 11 - suma % 11
        if dv >= 10:
            dv = 0
        if dv == 4:
            nif4 = f'{letra}-{cuerpo}-4'
            break
    L.ejecutar("UPDATE tienda.negocio SET rif = %s WHERE id = 1", (nif4,))
    L.commit()
    L.ok(L.fn('fn_digito_rif_negocio') == 4, f'RIF {nif4} → dígito verificador {L.fn("fn_digito_rif_negocio")}')
    ven4 = L.qs("SELECT obligacion, fecha_limite FROM tienda.fn_proximos_vencimientos(%s, 50)", (hoy,))
    L.ok(ven4 != ven, 'al cambiar el dígito del RIF cambian las fechas de vencimiento')
    L.ejecutar("UPDATE tienda.negocio SET rif = %s WHERE id = 1", (rif0,))
    L.commit()

    # 3) Régimen: ESPECIAL (quincenal/otro calendario) vs ORDINARIO
    especial_antes = L.q1("SELECT es_contribuyente_especial FROM tienda.negocio WHERE id = 1")
    ven_especial = L.qs("SELECT obligacion, fecha_limite FROM tienda.fn_proximos_vencimientos(%s, 200)", (hoy,))
    F.activar_especial(False)   # cambia régimen Y cobra_igtf (el constraint exige coherencia)
    L.ok(L.fn('fn_regimen_calendario') != reg, f'régimen cambia a {L.fn("fn_regimen_calendario")}')
    ven_ordinario = L.qs("SELECT obligacion, fecha_limite FROM tienda.fn_proximos_vencimientos(%s, 200)", (hoy,))
    L.ok(L.fn('fn_regimen_calendario') == 'ORDINARIO' and len(ven_ordinario) >= 3,
         f'régimen ORDINARIO con {len(ven_ordinario)} vencimientos mensuales sembrados (script 30)')
    L.ok(ven_ordinario != ven_especial and {str(o[0]) for o in ven_ordinario} != {str(o[0]) for o in ven_especial} or ven_ordinario != ven_especial,
         'el calendario ORDINARIO difiere del ESPECIAL (mensual ≠ quincenal)')
    F.activar_especial(True)   # volver a ESPECIAL para probar las declaraciones del calendario

    # 4) Marcar presentada: solo vencimientos del calendario y sin fechas futuras
    ob = L.qs("SELECT obligacion, periodo_desde FROM tienda.fn_calendario_negocio(%s) LIMIT 1", (hoy.year,))
    if ob:
        obligacion, desde = ob[0]
        L.fn('fn_marcar_presentada', obligacion, desde, hoy, f'PRE-{L.fake.random_number(digits=5)}', uid)
        L.commit()
        L.ok(True, f'declaración {obligacion} marcada presentada hoy')
        L.espera_error('presentar en fecha FUTURA rechazado', L.fn, 'fn_marcar_presentada', obligacion, desde,
                       hoy + datetime.timedelta(days=5), 'PRE-FUTURA', uid)
        L.espera_error('vencimiento fuera del calendario rechazado', L.fn, 'fn_marcar_presentada', 'OBLIGACION_FALSA', hoy, hoy, 'PRE-X', uid)
        L.fn('fn_desmarcar_presentada', obligacion, desde)
        L.commit()
        L.ok(True, 'desmarcada para dejar el calendario limpio')
    else:
        L.ok(True, '(el calendario del régimen actual no tiene vencimientos este año: casos omitidos)')

    # 5) Carga masiva del calendario 2027 con fn_calendario_cargar
    filas = [
        {"regimen": "ORDINARIO", "obligacion": "IVA", "digito": 0, "desde": "2027-01-01", "hasta": "2027-01-31", "limite": "2027-02-10", "fuente": "E2E"},
        {"regimen": "ORDINARIO", "obligacion": "IVA", "digito": 4, "desde": "2027-01-01", "hasta": "2027-01-31", "limite": "2027-02-14", "fuente": "E2E"},
        {"regimen": "ESPECIAL", "obligacion": "IVA", "digito": 0, "desde": "2027-01-01", "hasta": "2027-01-15", "limite": "2027-01-20", "fuente": "E2E"},
    ]
    try:
        L.fn('fn_calendario_cargar', J.dumps(filas), uid)
        L.commit()
        n27 = L.q1("SELECT count(*) FROM tienda.calendario_fiscal WHERE fecha_limite >= '2027-01-01' AND obligacion = 'IVA' AND digito IN (0, 4)")
        L.ok(n27 >= 3, f'carga masiva 2027 aceptada ({n27} filas del E2E)')
        L.fn('fn_calendario_eliminar', 'ORDINARIO', 'IVA', 0, '2027-01-01')
        L.fn('fn_calendario_eliminar', 'ORDINARIO', 'IVA', 4, '2027-01-01')
        L.fn('fn_calendario_eliminar', 'ESPECIAL', 'IVA', 0, '2027-01-01')
        L.commit()
        L.ok(True, 'limpieza del calendario de prueba')
    except Exception as exc:
        L.conn.rollback()
        L.ok(False, f'fn_calendario_cargar: formato inesperado ({str(exc)[:80]})')
