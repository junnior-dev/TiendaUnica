# -*- coding: utf-8 -*-
"""t02 · Catálogo: categoría/marca/modelo, producto con precio calculado, compatibilidad,
EAN-13 con unicidad y combo con cotización."""
import json as J

import e2e_lib as L


def main():
    L.empezar('t02 · Catálogo, compatibilidad y combos')
    uid = L.admin()

    # 1) Árbol del catálogo: categoría → marca → modelo de moto (como Modelos/Index)
    cat = L.ins('categorias', nombre=f'Frenos {L.fake.word()} E2E', activa=True)
    marca = L.ins('marcas', nombre=f'{L.fake.word().capitalize()} Parts E2E', activa=True)
    modelo = L.ins('motos_modelos', marca=L.q1("SELECT nombre FROM tienda.marcas WHERE id = %s", (marca,)), modelo=f'{L.fake.word().capitalize()} {L.fake.random_int(110, 250)}',
                   cilindrada=150)
    L.commit()
    L.ok(cat and marca and modelo, 'categoría, marca y modelo creados', f'{cat}/{marca}/{modelo}')

    # 2) Producto nuevo con precio derivado del costo y el margen (regla del panel de productos)
    costo, margen = 6.4, 30
    precio = float(L.fn('fn_calcular_precio_usd', costo, margen, False))
    sku = f"E2E-{L.fake.lexify('????').upper()}{L.fake.random_int(100, 999)}"
    prod = L.ins('productos', sku=sku, nombre=f'Kit de arrastre {L.fake.word()} E2E',
                 categoria_id=cat, marca_id=marca, unidad='UND', costo_usd=costo, margen_pct=margen,
                 precio_venta_usd=precio, exento_iva=False, exonerado_iva=False,
                 stock_actual=0, stock_minimo=2, activo=True, piezas_por_presentacion=12, unidad_compra='CAJA')
    L.commit()
    L.ok(abs(precio - round(costo * (1 + margen / 100), 2)) < 0.001,
         f'precio = costo × (1+margen): {costo} × 1.30 = {precio}')
    p = L.fila("SELECT * FROM tienda.productos WHERE id = %s", (prod,))
    L.ok(p and float(p['precio_venta_usd']) == precio, 'precio persistido en el producto')

    # 3) Compatibilidad: la moto deja de estar «sin repuestos»
    L.ins('producto_compatibilidad', producto_id=prod, moto_modelo_id=modelo)
    L.commit()
    L.ok(L.q1("SELECT count(*) FROM tienda.producto_compatibilidad WHERE producto_id = %s", (prod,)) == 1,
         'compatibilidad producto↔moto registrada')
    L.ok(L.q1("SELECT count(*) FROM tienda.v_compatibilidad WHERE producto_id = %s", (prod,)) >= 1,
         'vista v_compatibilidad muestra el repuesto')

    # 4) EAN-13 interno del rango 200–299, igual que Productos → «Etiquetas con código»
    cuerpo = '20' + str(prod).rjust(10, '0')
    s = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(cuerpo))
    ean = cuerpo + str((10 - s % 10) % 10)
    L.ejecutar("UPDATE tienda.productos SET codigo_barras = %s WHERE id = %s", (ean, prod))
    L.commit()
    L.ok(len(ean) == 13 and L.q1("SELECT codigo_barras FROM tienda.productos WHERE id = %s", (prod,)) == ean,
         f'EAN-13 interno asignado: {ean}')
    L.espera_error('código de barras duplicado rechazado (unicidad)', L.q1,
                   "INSERT INTO tienda.productos (sku, nombre, unidad, costo_usd, margen_pct, precio_venta_usd, "
                   "stock_actual, stock_minimo, activo, codigo_barras) VALUES (%s, %s, 'UND', 1, 30, 1.3, 0, 0, true, %s)",
                   (f"E2E-{L.fake.lexify('????').upper()}99", 'Producto duplicado EAN', ean))

    # 5) Combo/kit: componentes y cotización con ahorro
    combo = L.ins('combos', sku=f"E2E-KIT{L.fake.random_int(10, 99)}", nombre='Kit sintonía E2E',
                  descripcion='Bujía + filtro', precio_usd=8.0, activo=True)
    L.ins('combo_componentes', combo_id=combo, producto_id=prod, cantidad=1)
    prod2 = L.q1("SELECT id FROM tienda.productos WHERE activo AND id <> %s ORDER BY id LIMIT 1", (prod,))
    L.ins('combo_componentes', combo_id=combo, producto_id=prod2, cantidad=2)
    L.commit()
    items = L.fn('fn_combo_items', combo, 1)
    items = items if isinstance(items, list) else J.loads(items)
    L.ok(len(items) == 2, f'combo desglosa {len(items)} componentes')
    cot = L.fn('fn_cotizar_combo', combo, 1)
    cot = cot if isinstance(cot, dict) else J.loads(cot)
    total_combo = float(cot.get('total_usd') or cot.get('precio') or cot.get('precio_usd'))
    suma = float(L.q1("SELECT COALESCE(sum(pp.precio_venta_usd * cc.cantidad), 0) FROM tienda.combo_componentes cc "
                      "JOIN tienda.productos pp ON pp.id = cc.producto_id WHERE cc.combo_id = %s", (combo,)))
    L.ok(total_combo <= suma + 0.01, f'cotizar combo ({total_combo}) ≤ suma piezas ({suma})')
    L.ok(L.q1("SELECT count(*) FROM tienda.v_combos WHERE id = %s", (combo,)) == 1, 'v_combos lo lista')
