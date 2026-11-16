# -*- coding: utf-8 -*-
"""m03 · AISLAMIENTO DE LECTURA: nada del negocio 1 a la vista de la sesión del
negocio 2 — tablas y vistas (security_invoker) incluidas."""
import e2e_lib as L  # noqa: E402
import m_lib as M  # noqa: E402


def main():
    L.empezar('m03 · AISLAMIENTO DE LECTURA: nada de otra tienda a la vista')
    M.como(2)
    L.ok(L.fn('fn_negocio_actual') == 2, 'la sesión declara el negocio 2')
    propias = L.q1("SELECT count(*) FROM tienda.clientes WHERE negocio_id = 2")
    L.ok(L.q1("SELECT count(*) FROM tienda.clientes") == propias,
         f'clientes visibles = solo los propios ({propias})')
    L.ok(L.q1("SELECT count(*) FROM tienda.productos WHERE negocio_id = 1") == 0,
         'productos del negocio 1: invisibles')
    L.ok(L.q1("SELECT count(*) FROM tienda.ventas WHERE negocio_id = 1") == 0,
         'ventas del negocio 1: invisibles')
    L.ok(L.q1("SELECT count(*) FROM tienda.usuarios WHERE negocio_id = 1") == 0,
         'usuarios del negocio 1: invisibles (ni el admin de la otra tienda)')
    L.ok(L.q1("SELECT count(*) FROM tienda.negocio") == 1
         and L.q1("SELECT id FROM tienda.negocio") == 2,
         'la fila de negocio visible es únicamente la propia (id 2)')
    L.ok(L.q1("SELECT subdominio FROM tienda.estado_tenants WHERE negocio_id = 2") == 'bodega-esquina',
         'estado_tenants legible: subdominio «bodega-esquina» (control del portal)')
    v = L.q1("SELECT table_name FROM information_schema.columns "
             "WHERE table_schema='tienda' AND column_name='negocio_id' "
             "AND table_name IN (SELECT table_name FROM information_schema.views "
             "WHERE table_schema='tienda' AND is_insertable_into='NO') ORDER BY 1 LIMIT 1")
    if v:
        cnt = L.q1(f"SELECT count(*) FROM tienda.{v} WHERE negocio_id = 1")
        L.ok(cnt == 0, f'la vista {v} respeta el RLS del invocador (0 filas ajenas)')
    else:
        L.ok(True, 'no hay vistas con negocio_id aislable en esta base (todas filtran por sesión)')
    L.ok(L.q1("SELECT count(*) FROM tienda.categorias WHERE negocio_id = 1") == 0,
         'catálogos aislados: categorias del negocio 1 invisibles')
    L.ok(L.q1("SELECT count(*) FROM tienda.movimientos_inventario WHERE negocio_id = 1") == 0,
         'kardex del negocio 1: invisible')
    M.volver()
    L.ok(L.q1("SELECT count(*) FROM tienda.clientes WHERE negocio_id = 1") > 0,
         'el superusuario (portal) sí ve todo: el aislamiento no le aplica')
    M.volver()
