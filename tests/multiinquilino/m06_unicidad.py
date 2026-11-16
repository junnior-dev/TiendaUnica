# -*- coding: utf-8 -*-
"""m06 · UNICIDAD POR NEGOCIO: RIF de cliente y SKU pueden repetirse ENTRE
negocios pero no DENTRO del mismo negocio."""
import e2e_lib as L  # noqa: E402
import m_lib as M  # noqa: E402


def main():
    L.empezar('m06 · UNICIDAD POR NEGOCIO: fronteras de clave')
    M.volver()
    # mismo RIF de cliente en ambos negocios: permitido (negocios distintos)
    L.ejecutar("INSERT INTO tienda.clientes (negocio_id, tipo_documento, documento, nombre, activo) "
               "VALUES (1, 'V', '123-UNICO', 'RIF compartido n1', true)")
    L.commit()
    M.como(2)
    L.ejecutar("INSERT INTO tienda.clientes (tipo_documento, documento, nombre, activo) "
               "VALUES ('V', '123-UNICO', 'RIF compartido n2', true)")
    L.commit()
    M.volver()   # el conteo cruzado necesita ver AMBOS negocios (RLS filtra por sesión)
    L.ok(L.q1("SELECT count(*) FROM tienda.clientes WHERE documento = '123-UNICO'") == 2,
         'el mismo documento de cliente puede existir en dos negocios')
    M.como(2)
    L.espera_error('el mismo documento DUPLICADO dentro del negocio 2 → rechazado',
                   lambda: L.ejecutar("INSERT INTO tienda.clientes (tipo_documento, documento, nombre, activo) "
                                      "VALUES ('V', '123-UNICO', 'Duplicado n2', true)"))
    M.como(2)
    L.ejecutar("SELECT set_config('app.negocio_id', '2', false)")
    p1 = M.producto_base('SKU-COMPARTIDO', 'Producto compartido N2', codigo_barras='7700000000021')
    L.commit()
    M.volver()
    L.ejecutar("SELECT set_config('app.negocio_id', '1', false)")
    L.ejecutar("INSERT INTO tienda.productos (negocio_id, sku, nombre, unidad, costo_usd, margen_pct, "
               "precio_venta_usd, exento_iva, exonerado_iva, stock_actual, stock_minimo, activo, codigo_barras) "
               "VALUES (1, 'SKU-COMPARTIDO', 'Producto compartido N1', 'UND', 7, 30, 10, false, false, 0, 2, true, '7700000000022')")
    L.commit()
    L.ok(L.q1("SELECT count(*) FROM tienda.productos WHERE sku = 'SKU-COMPARTIDO'") == 2,
         'el mismo SKU puede existir en dos negocios (2 productos)')
    M.como(2)
    L.espera_error('SKU duplicado DENTRO del negocio 2 → rechazado',
                   lambda: L.ejecutar("INSERT INTO tienda.productos (sku, nombre, unidad, costo_usd, margen_pct, "
                                      "precio_venta_usd, exento_iva, exonerado_iva, stock_actual, stock_minimo, activo) "
                                      "VALUES ('SKU-COMPARTIDO', 'Duplicado', 'UND', 7, 30, 10, false, false, 0, 2, true)"))
    M.como(2)
    L.espera_error('código de barras duplicado dentro del negocio 2 → rechazado',
                   lambda: L.ejecutar("INSERT INTO tienda.productos (sku, nombre, unidad, costo_usd, margen_pct, "
                                      "precio_venta_usd, exento_iva, exonerado_iva, stock_actual, stock_minimo, activo, "
                                      "codigo_barras) VALUES ('SKU-OTRO', 'Duplicado barras', 'UND', 7, 30, 10, "
                                      "false, false, 0, 2, true, '7700000000021')"))
    M.volver()
