# -*- coding: utf-8 -*-
"""f14 · MEDIA: Numeración de ventas — huecos auditables."""
import json as J

import e2e_lib as L
import f_lib as F


def main():
    L.empezar('f14 · Correlativo de ventas y huecos')
    uid = L.admin()
    p = L.q1("SELECT id FROM tienda.productos WHERE activo AND NOT exento_iva ORDER BY id LIMIT 1")
    m = F.m_efectivo('Efectivo Bs')
    items = J.dumps([{'producto_id': p, 'cantidad': 1, 'descuento_pct': 0}])

    huecos0 = L.q1("SELECT count(*) FROM tienda.v_ventas_huecos")
    ultimo = L.q1("SELECT max(numero) FROM tienda.ventas")

    # 1) Una venta fallida DESPUÉS de numerar (pagos que no cuadran) consume el número → hueco
    L.espera_error('venta con pago que no cuadra (falla tras numerar)', L.fn, 'fn_registrar_venta', uid, items,
                   J.dumps([{'metodo_pago_id': m, 'monto': 0.01}]), None, None, 'PRESENCIAL')
    # el hueco se hace visible cuando la SIGUIENTE venta consume el número que sigue al faltante
    total = F.precio_total(p)
    v = L.fn('fn_registrar_venta', uid, items, J.dumps([{'metodo_pago_id': m, 'monto': round(total * 36.5, 2), 'referencia': 'PM-H'}]), None, None, 'PRESENCIAL')
    L.commit()
    huecos1 = L.q1("SELECT count(*) FROM tienda.v_ventas_huecos")
    L.ok(huecos1 == huecos0 + 1, f'el intento fallido dejó un hueco auditable ({huecos0} → {huecos1})')
    h = L.fila("SELECT numero_faltante, numero_anterior, numero_siguiente, fecha_hora_siguiente FROM tienda.v_ventas_huecos ORDER BY numero_faltante DESC LIMIT 1")
    L.ok(h and int(h['numero_faltante']) == int(ultimo) + 1,
         f'v_ventas_huecos reporta el {h["numero_faltante"] if h else "?"} faltante (después del {ultimo})')
    L.ok(h and int(h['numero_anterior']) == int(ultimo), 'el hueco muestra el número anterior y el siguiente para reconstruir')
    L.ok(h and h['fecha_hora_siguiente'] is not None, 'el hueco queda fechado (cuándo se consumió)')

    # 2) Una venta ANULADA NO es hueco: conserva su número
    L.ejecutar("CALL tienda.sp_anular_venta(%s, %s, 'Anulación de prueba de correlativos')", (v, uid))
    L.commit()
    num = L.q1("SELECT numero FROM tienda.ventas WHERE id = %s", (v,))
    hueco_de_anulada = L.q1("SELECT count(*) FROM tienda.v_ventas_huecos WHERE numero_faltante = %s", (num,))
    L.ok(hueco_de_anulada == 0, f'la venta anulada #{num} conserva su número (no es hueco)')
    L.ok(L.q1("SELECT estado FROM tienda.ventas WHERE numero = %s", (num,)) == 'ANULADA', 'y sigue auditable como ANULADA')
