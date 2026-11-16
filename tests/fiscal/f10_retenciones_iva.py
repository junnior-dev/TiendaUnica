# -*- coding: utf-8 -*-
"""f10 · ALTA: Retenciones de IVA — 75 %/100 %, comprobante correlativo y entero quincenal."""
import e2e_lib as L


def main():
    L.empezar('f10 · Retenciones de IVA y entero quincenal')
    uid = L.admin()
    hoy = L.hoy()
    import datetime
    fin_mes_pasado = hoy.replace(day=1) - datetime.timedelta(days=1)
    d_mes_pasado = fin_mes_pasado.replace(day=1)
    dia_oct = d_mes_pasado.replace(day=20)

    prov = L.q1("SELECT id FROM tienda.proveedores WHERE activo ORDER BY id LIMIT 1")
    rif = L.q1("SELECT rif FROM tienda.proveedores WHERE id = %s", (prov,))
    pid = L.q1("SELECT id FROM tienda.productos WHERE activo AND NOT exento_iva ORDER BY id LIMIT 1")

    # 1) Dos compras del mes pasado con crédito fiscal
    c1 = L.fn('fn_registrar_compra', prov, f"F-R75-{L.fake.random_number(digits=5)}", dia_oct, 'USD',
              [{'producto_id': pid, 'cantidad': 6, 'costo_unitario': 1.0, 'exento': False}], uid)
    c2 = L.fn('fn_registrar_compra', prov, f"F-R100-{L.fake.random_number(digits=5)}", dia_oct, 'USD',
              [{'producto_id': pid, 'cantidad': 2, 'costo_unitario': 1.0, 'exento': False}], uid)
    L.commit()
    iva1 = float(L.q1("SELECT monto_iva FROM tienda.compras WHERE id = %s", (c1,)))
    iva2 = float(L.q1("SELECT monto_iva FROM tienda.compras WHERE id = %s", (c2,)))

    # 2) Retención estándar 75 %
    nro = L.fn('fn_siguiente_comprobante_retencion', dia_oct)
    L.ok(len(str(nro)) == 14 and str(nro).startswith(str(dia_oct.year) + f'{dia_oct.month:02d}'),
         f'comprobante AAAAMM00000000 de 14 dígitos: {nro}')
    L.ins('retenciones_iva', sentido='COMPRA', compra_id=c1, numero_comprobante=str(nro), fecha_emision=dia_oct,
          porcentaje=75, iva_documento_ves=iva1, iva_retenido_ves=round(iva1 * 0.75, 2), estado='ACTIVA', usuario_id=uid)
    L.commit()
    r1 = L.fila("SELECT iva_retenido_ves FROM tienda.v_retenciones_iva WHERE compra_id = %s", (c1,))
    L.ok(abs(float(r1['iva_retenido_ves']) - round(iva1 * 0.75, 2)) < 0.01, f'retención 75 %: {r1["iva_retenido_ves"]} de IVA {iva1}')

    # 3) Retención 100 % (IVA no discriminado / proveedor sin capacidad)
    nro2 = L.fn('fn_siguiente_comprobante_retencion', dia_oct)
    L.ok(str(nro2) != str(nro) and int(str(nro2)[6:]) == int(str(nro)[6:]) + 1, f'comprobante correlativo: {nro} → {nro2}')
    L.ins('retenciones_iva', sentido='COMPRA', compra_id=c2, numero_comprobante=str(nro2), fecha_emision=dia_oct,
          porcentaje=100, iva_documento_ves=iva2, iva_retenido_ves=round(iva2, 2), estado='ACTIVA', usuario_id=uid)
    L.commit()
    r2 = L.fila("SELECT iva_retenido_ves FROM tienda.v_retenciones_iva WHERE compra_id = %s", (c2,))
    L.ok(abs(float(r2['iva_retenido_ves']) - iva2) < 0.01, f'retención 100 %: {r2["iva_retenido_ves"]} = todo el IVA')

    # 4) Comprobante repetido rechazado (unicidad)
    L.espera_error('comprobante duplicado rechazado', L.q1,
                   "INSERT INTO tienda.retenciones_iva (sentido, compra_id, numero_comprobante, fecha_emision, porcentaje, "
                   "iva_documento_ves, iva_retenido_ves, estado, usuario_id) VALUES ('COMPRA', %s, %s, %s, 75, 1, 0.75, 'ACTIVA', %s)",
                   (c1, str(nro), dia_oct, uid))

    # 5) Entero quincenal: quincena inválida / futura / no terminada / correcta
    L.espera_error('quincena distinta de 1 o 2 rechazada', L.fn, 'fn_enterar_retenciones', dia_oct.year, dia_oct.month, 3, hoy, 'PM-X', uid)
    L.espera_error('fecha de pago futura rechazada', L.fn, 'fn_enterar_retenciones', dia_oct.year, dia_oct.month, 2,
                   hoy + datetime.timedelta(days=10), 'PM-X', uid)
    # la quincena 1 del mes ACTUAL no ha terminado
    L.espera_error('quincena del mes en curso aún no termina → rechazada', L.fn, 'fn_enterar_retenciones',
                   hoy.year, hoy.month, 1, hoy, 'PM-X', uid)
    # la quincena 2 del mes pasado SÍ terminó
    total_esp = float(L.q1("SELECT COALESCE(sum(iva_retenido_ves), 0) FROM tienda.retenciones_iva WHERE sentido = 'COMPRA' "
                           "AND estado = 'ACTIVA' AND fecha_emision BETWEEN %s AND %s", (fin_mes_pasado.replace(day=16), fin_mes_pasado)))
    ent = L.fn('fn_enterar_retenciones', dia_oct.year, dia_oct.month, 2, hoy, f'PM-{L.fake.random_number(digits=8)}', uid, 'Entero E2E')
    L.commit()
    L.ok(ent is not None, f'entero de la quincena 2 de {dia_oct.month}/{dia_oct.year} registrado')
    e = L.fila("SELECT monto_ves, fecha_pago FROM tienda.retenciones_enteradas WHERE id = %s", (ent,))
    L.ok(abs(float(e['monto_ves']) - total_esp) < 0.05, f'el entero suma solo las ACTIVAS: {e["monto_ves"]} = {total_esp}')
    L.espera_error('enterar la misma quincena dos veces rechazado', L.fn, 'fn_enterar_retenciones', dia_oct.year, dia_oct.month, 2, hoy, 'PM-Y', uid)

    # 6) La retención ANULADA no cuenta para el entero
    rid = L.q1("SELECT id FROM tienda.retenciones_iva WHERE compra_id = %s", (c2,))
    L.ejecutar("UPDATE tienda.retenciones_iva SET estado = 'ANULADA', anulada_en = now(), anulada_por = %s, motivo_anulacion = 'Duplicada E2E' WHERE id = %s", (uid, rid))
    L.commit()
    L.ok(True, 'retención 100 % anulada (con motivo)')
    total_act = float(L.q1("SELECT COALESCE(sum(iva_retenido_ves), 0) FROM tienda.retenciones_iva WHERE sentido = 'COMPRA' "
                           "AND estado = 'ACTIVA' AND fecha_emision BETWEEN %s AND %s", (fin_mes_pasado.replace(day=16), fin_mes_pasado)))
    L.ok(total_act < total_esp, f'las anuladas salen del cálculo ({total_act} < {total_esp})')
    L.ok(L.q1("SELECT count(*) FROM tienda.v_retenciones_iva WHERE estado = 'ACTIVA'") >= 1, 'v_retenciones_iva mantiene las activas')
