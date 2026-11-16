# -*- coding: utf-8 -*-
"""m02 · SELLO: INSERT sin negocio_id hereda el negocio de la sesión; un
negocio_id ajeno explícito lo rechaza el WITH CHECK."""
import e2e_lib as L  # noqa: E402
import m_lib as M  # noqa: E402


def main():
    L.empezar('m02 · SELLO: INSERT sin negocio_id hereda la sesión')
    M.como(2)
    L.ejecutar("INSERT INTO tienda.clientes (tipo_documento, documento, nombre, activo) "
               "VALUES ('V', '100-SELLADO', 'Cliente Sellado N2', true)")
    L.ok(L.q1("SELECT negocio_id FROM tienda.clientes WHERE documento = '100-SELLADO'") == 2,
         'INSERT sin negocio_id en la sesión del negocio 2 → hereda 2')
    L.commit()
    L.espera_error('INSERT con negocio_id ajeno → WITH CHECK lo rechaza',
                   lambda: L.ejecutar("INSERT INTO tienda.clientes (negocio_id, tipo_documento, documento, nombre, activo) "
                                      "VALUES (1, 'V', '200-CRUZADO', 'Intento Cruzado', true)"))
    M.como(2)
    L.ejecutar("INSERT INTO tienda.categorias (nombre) VALUES ('Aceites N2')")
    L.ok(L.q1("SELECT negocio_id FROM tienda.categorias WHERE nombre = 'Aceites N2'") == 2,
         'el sello también cubre catálogos (categorias hereda 2)')
    L.commit()
    M.como(2)
    L.espera_error('INSERT con negocio_id inexistente → rechazado',
                   lambda: L.ejecutar("INSERT INTO tienda.clientes (negocio_id, tipo_documento, documento, nombre, activo) "
                                      "VALUES (99, 'V', '300-FANTASMA', 'Fantasma', true)"))
    M.volver()
    L.ejecutar("INSERT INTO tienda.clientes (tipo_documento, documento, nombre, activo) "
               "VALUES ('V', '900-SEED', 'Cliente del Negocio 1', true)")
    L.ok(L.q1("SELECT negocio_id FROM tienda.clientes WHERE documento = '900-SEED'") == 1,
         'superusuario sin GUC → el sello usa el default 1 (compatibilidad)')
    L.commit()
    M.volver()
