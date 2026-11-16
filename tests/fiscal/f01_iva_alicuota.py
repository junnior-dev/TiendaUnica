# -*- coding: utf-8 -*-
"""f01 · CRÍTICA: IVA — cambio de alícuota a mitad de período (congelación vigencial)."""
import json

import e2e_lib as L
import f_lib as F


def main():
    L.empezar('f01 · IVA: cambio de alícuota (sp_cambiar_alicuota)')
    uid = L.admin()
    hoy = L.hoy()
    import datetime
    manana = datetime.date.fromisoformat(str(hoy)) + datetime.timedelta(days=1)

    # 1) Estado vigente: hay una fila abierta IVA_GENERAL con 16 %
    abierta = L.fila("SELECT * FROM tienda.parametros_fiscales WHERE codigo = 'IVA_GENERAL' AND vigente_hasta IS NULL")
    L.ok(abierta and float(abierta['porcentaje']) == 16, f"vigencia abierta IVA 16 % desde {abierta['vigente_desde'] if abierta else '?'}")
    L.ok(float(L.fn('fn_iva_pct', hoy)) == 16.0, 'fn_iva_pct(hoy) = 16')
    L.ok(float(L.fn('fn_iva_pct', manana)) == 16.0, 'fn_iva_pct(mañana) = 16 (aún la vigente)')

    # 2) Ventas previas congelan su alícuota en la fila (no se recalculan al cambiar)
    iva_ventas_antes = {r[0] for r in L.qs("SELECT DISTINCT iva_pct FROM tienda.ventas")}
    L.ok(iva_ventas_antes <= {16}, f'todas las ventas existentes llevan 16 % congelado ({iva_ventas_antes})')

    # 3) Cambio a 17 % desde mañana: cierra la vieja con vigente_hasta = hoy e inserta la nueva
    L.ejecutar("CALL tienda.sp_cambiar_alicuota('IVA_GENERAL', 17, %s, 'Gaceta Oficial 43.317 E2E fiscal', %s)", (manana, uid))
    L.commit()
    vieja = L.q1("SELECT vigente_hasta FROM tienda.parametros_fiscales WHERE codigo='IVA_GENERAL' AND vigente_hasta IS NOT NULL ORDER BY vigente_desde DESC LIMIT 1")
    nueva = L.fila("SELECT * FROM tienda.parametros_fiscales WHERE codigo='IVA_GENERAL' AND vigente_hasta IS NULL")
    L.ok(str(vieja) == str(hoy), f'la vigencia anterior cerró en {vieja} = desde − 1')
    L.ok(nueva and float(nueva['porcentaje']) == 17 and str(nueva['vigente_desde']) == str(manana), f'nueva vigencia 17 % desde {nueva["vigente_desde"]}')
    L.ok(float(L.fn('fn_iva_pct', hoy)) == 16.0, 'el día de hoy sigue cotizando a 16 % (congelado)')
    L.ok(float(L.fn('fn_iva_pct', manana)) == 17.0, 'desde mañana rige 17 %')

    # 4) Reglas de protección del cambio
    L.espera_error('misma fecha de nuevo rechazada (solape)', L.ejecutar,
                   "CALL tienda.sp_cambiar_alicuota('IVA_GENERAL', 17, %s, 'duplicado', %s)", (manana, uid))
    L.espera_error('fecha pasada rechazada (no reescribe el pasado)', L.ejecutar,
                   "CALL tienda.sp_cambiar_alicuota('IVA_GENERAL', 15, '2026-01-01', 'retroactivo', %s)", (uid,))
    L.espera_error('misma alícuota rechazada', L.ejecutar,
                   "CALL tienda.sp_cambiar_alicuota('IVA_GENERAL', 17, %s, 'sin cambio', %s)", (manana + datetime.timedelta(days=30), uid))
    L.espera_error('código inválido rechazado', L.ejecutar,
                   "CALL tienda.sp_cambiar_alicuota('IVA_RARO', 5, %s, 'falso', %s)", (manana, uid))

    # 5) La venta de HOY (antes del cambio) congela 16 % en su fila
    p = L.q1("SELECT id FROM tienda.productos WHERE activo AND NOT exento_iva ORDER BY id LIMIT 1")
    m = F.m_efectivo('Efectivo Bs')
    total = F.precio_total(p)
    venta = L.fn('fn_registrar_venta', uid, json.dumps(
        [{'producto_id': p, 'cantidad': 1, 'descuento_pct': 0}]),
        json.dumps([{'metodo_pago_id': m, 'monto': round(total * float(L.fn('fn_tasa_par', 'USD', 'VES', hoy)), 2)}]),
        None, 'Venta a 16 % antes del cambio', 'PRESENCIAL')
    L.commit()
    L.ok(float(L.q1("SELECT iva_pct FROM tienda.ventas WHERE id = %s", (venta,))) == 16,
         'venta de hoy congeló iva_pct = 16 en la fila (no se recalcula)')

    # 6) Sin fila vigente → fn_iva_pct lanza TV006 (no se inventa alícuota)
    err_sin = None
    try:
        L.ejecutar("DELETE FROM tienda.parametros_fiscales WHERE codigo = 'IVA_GENERAL'")
        L.fn('fn_iva_pct', hoy)
    except Exception as exc:
        err_sin = str(exc)
    L.rollback()
    L.ok(err_sin is not None and ('TV006' in err_sin or 'alícuota' in err_sin),
         'sin fila de alícuota → TV006 (no se inventa valor): ' + str(err_sin)[:60])
    L.ok(float(L.fn('fn_iva_pct', hoy)) == 16.0, 'estado restaurado tras el rollback')

    # 7) Restaurar 16 % al día siguiente del cambio (sin solapar la vigencia de 17 %)
    import datetime as _dt
    pasarela = manana + _dt.timedelta(days=1)
    L.ejecutar("CALL tienda.sp_cambiar_alicuota('IVA_GENERAL', 16, %s, 'Restauración de prueba E2E', %s)", (pasarela, uid))
    L.commit()
    L.ok(float(L.fn('fn_iva_pct', pasarela)) == 16.0, 'alícuota restaurada a 16 % al día siguiente')
    L.ok(float(L.fn('fn_iva_pct', hoy)) == 16.0, 'y hoy sigue en 16 % para el resto de las suites')
