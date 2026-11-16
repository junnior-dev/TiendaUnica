# -*- coding: utf-8 -*-
"""t08 · Devoluciones y notas de crédito: devolvibles, nota que devuelve inventario,
reembolso en caja y nota administrativa."""
import e2e_lib as L


def main():
    L.empezar('t08 · Devoluciones y notas de crédito')
    uid = L.admin()
    hoy = L.hoy()

    # 1) Venta fresca de una unidad para devolver
    p1 = L.q1("SELECT id FROM tienda.productos WHERE activo AND NOT exento_iva ORDER BY id LIMIT 1")
    st0 = float(L.q1("SELECT stock_actual FROM tienda.productos WHERE id = %s", (p1,)))
    m_ef = L.q1("SELECT id FROM tienda.metodos_pago WHERE nombre = 'Efectivo USD' AND activo")
    precio = float(L.q1("SELECT precio_venta_usd FROM tienda.productos WHERE id = %s", (p1,)))
    total = round(precio * 1.16, 2)
    venta = L.fn('fn_registrar_venta', uid, __import__('json').dumps([{'producto_id': p1, 'cantidad': 1, 'descuento_pct': 0}]),
                 __import__('json').dumps([{'metodo_pago_id': m_ef, 'monto': total}]), None, 'Venta para devolución E2E', 'PRESENCIAL')
    L.commit()
    L.ok(venta is not None, f'venta base #{venta} por {total} USD')

    # 2) Devolvibles: el módulo la propone para devolución
    dev = L.fn('fn_devolvibles_venta', venta)
    L.ok(dev is not None, f'fn_devolvibles_venta responde ({str(dev)[:70]}…)')

    # 3) Nota de crédito que devuelve el inventario (así la crea el módulo de Ventas)
    tasa_n = float(L.fn_fila('fn_tasa_aplicable', hoy, 'USD', 'VES')['tasa'])
    base_n = round(precio * tasa_n, 2)
    iva_n = round(precio * 0.16 * tasa_n, 2)
    nro_nota = str(int(L.q1("SELECT COALESCE(max(numero::bigint), 0) + 1 FROM tienda.notas_ajuste WHERE tipo = 'C'") or 1))
    nota = L.ins('notas_ajuste', tipo='C', numero=nro_nota, venta_id=venta, fecha=hoy, iva_pct=16,
                 base_ves=base_n, iva_ves=iva_n, total_ves=base_n + iva_n,
                 motivo='Producto defectuoso E2E', usuario_id=uid, devuelve_inventario=True)
    L.ins('notas_ajuste_detalle', nota_id=nota, producto_id=p1, cantidad=1)
    L.commit()
    L.ok(nota is not None, f'nota de crédito #{nota} creada con detalle')

    # 4) Reembolso en caja: sale el dinero por el método elegido; el reembolsable de la nota queda en cero
    L.fn('fn_devolver_nota_en_caja', nota, m_ef, total, uid, f"DEV-{L.fake.random_number(digits=6)}")
    L.commit()
    L.ok(abs(float(L.fn('fn_nota_reembolsable_ves', nota))) < 0.01, 'nota reembolsada completa (reembolsable = 0)')
    L.espera_error('no se puede reembolsar la misma nota dos veces', L.fn, 'fn_devolver_nota_en_caja', nota, m_ef, 1, uid, None)

    # 5) La vista de notas CxC/listado muestra la nota del día
    L.ok(L.q1("SELECT count(*) FROM tienda.notas_ajuste WHERE id = %s AND fecha = %s", (nota, hoy)) == 1,
         'nota del día consultable')
    L.ok(L.q1("SELECT count(*) FROM tienda.movimientos_caja WHERE estado = 'ACTIVO' AND tipo = 'EGRESO'") >= 1,
         'el reembolso salió como EGRESO de caja')
