# -*- coding: utf-8 -*-
"""f17 · ESTADOS IMPOSIBLES (capa 3): si ocurren, es bug crítico."""
import json as J

import e2e_lib as L
import f_lib as F


def main():
    L.empezar('f17 · Estados imposibles (capa 3)')
    uid = L.admin()
    hoy = L.hoy()

    # 1) Venta COMPLETADA sin pagos: imposible (validador)
    v0 = L.q1("SELECT count(*) FROM tienda.ventas v WHERE v.estado = 'COMPLETADA' AND NOT v.es_credito AND "
              "NOT EXISTS (SELECT 1 FROM tienda.pagos_venta p WHERE p.venta_id = v.id)")
    L.ok(v0 == 0, f'IMPOSIBLE venta de contado sin pagos: {v0} en la base')
    L.espera_error('crear venta de contado sin pagos: rechazada', L.fn, 'fn_registrar_venta', uid,
                   J.dumps([{'producto_id': L.q1("SELECT id FROM tienda.productos WHERE activo AND NOT exento_iva ORDER BY id LIMIT 1"), 'cantidad': 1}]),
                   J.dumps([]), None, None, 'PRESENCIAL')

    # 2) Retención enterada SIN asiento (con contab automática): imposible
    L.ejecutar("UPDATE tienda.contab_config SET automatica = true WHERE id = 1")
    L.commit()
    ent_sin = L.q1("SELECT count(*) FROM tienda.enteros_islr e WHERE e.estado = 'ACTIVO' AND "
                   "NOT EXISTS (SELECT 1 FROM tienda.asientos a WHERE a.origen_tipo = 'ENTERO_ISLR' AND a.origen_id = e.id)")
    L.ok(ent_sin == 0, f'IMPOSIBLE entero ISLR sin asiento: {ent_sin}')
    L.ejecutar("UPDATE tienda.contab_config SET automatica = false WHERE id = 1")
    L.commit()

    # 3) Nota de crédito que devuelva MÁS dinero del que queda reembolsable: imposible
    nota = L.fila("SELECT id, total_ves FROM tienda.notas_ajuste WHERE tipo = 'C' ORDER BY id DESC LIMIT 1")
    if nota:
        reemb = float(L.fn('fn_nota_reembolsable_ves', nota['id']))
        if reemb > 0:
            m = F.m_efectivo('Efectivo Bs')
            L.espera_error('devolver más de lo reembolsable: rechazado', L.fn, 'fn_devolver_nota_en_caja',
                           nota['id'], m, round(reemb + 500, 2), uid, 'EXCESO')
        else:
            L.ok(True, '(nota ya reembolsada por completo: caso de exceso probado en f09)')

    # 4) Venta en período contable cerrado: imposible por construcción (la venta siempre es de HOY
    #    y el mes en curso no se puede cerrar)
    L.ok(L.fn('fn_periodo_cerrado', hoy) is not True, 'IMPOSIBLE vender en período cerrado: el mes en curso no se cierra')
    L.espera_error('cerrar el mes en curso: rechazado', L.fn, 'fn_cerrar_periodo', hoy.replace(day=1), uid, 'Prematuro')

    # 5) CxC con saldo mayor al monto original: imposible
    c = L.q1("SELECT count(*) FROM tienda.cuentas_por_cobrar WHERE saldo_usd > monto_original_usd + 0.01 OR saldo_ves > monto_original_ves + 0.5")
    L.ok(c == 0, f'IMPOSIBLE CxC con saldo inflado: {c}')

    # 6) Venta con fecha_valor FUTURA: imposible (no se emite al futuro; históricas del seed son válidas)
    fv = L.q1("SELECT count(*) FROM tienda.ventas WHERE fecha_valor > %s", (hoy,))
    L.ok(fv == 0, f'IMPOSIBLE venta fechada en el futuro: {fv}')

    # 7) Pago de venta fuera de su transacción (pagos inmutables): imposible
    v = L.q1("SELECT id FROM tienda.ventas WHERE estado = 'COMPLETADA' AND NOT es_credito ORDER BY id DESC LIMIT 1")
    if v:
        m = L.q1("SELECT id FROM tienda.metodos_pago WHERE activo ORDER BY id LIMIT 1")
        L.espera_error('agregar pago a una venta ya confirmada: rechazado', L.q1,
                       "INSERT INTO tienda.pagos_venta (venta_id, metodo_pago_id, monto) VALUES (%s, %s, 1)", (v, m))

    # 8) Dos turnos abiertos para el mismo usuario: imposible
    L.espera_error('abrir dos turnos a la vez: rechazado', L.fn, 'fn_abrir_caja', uid, 10, 10)
    L.rollback()
