# -*- coding: utf-8 -*-
"""m04 · ESCRITURA CRUZADA: el USING filtra las filas ajenas y el WITH CHECK
rechaza escribir con negocio_id ajeno."""
import e2e_lib as L  # noqa: E402
import m_lib as M  # noqa: E402


def main():
    L.empezar('m04 · ESCRITURA CRUZADA: USING filtra y WITH CHECK rechaza')
    M.como(2)
    L.ejecutar("UPDATE tienda.clientes SET nombre = nombre WHERE negocio_id = 1")
    L.ok(L.q1("SELECT count(*) FROM tienda.clientes WHERE documento = '900-SEED' AND nombre = 'Intento N2'") == 0,
         'UPDATE cruzado sobre el negocio 1: 0 filas tocadas (USING las oculta)')
    L.ejecutar("UPDATE tienda.clientes SET nombre = 'Cliente Sellado N2 · editado' "
               "WHERE documento = '100-SELLADO'")
    L.ok(L.q1("SELECT count(*) FROM tienda.clientes WHERE documento = '100-SELLADO' "
              "AND nombre LIKE '%editado'") == 1, 'UPDATE propio: sí aplica (1 fila)')
    L.espera_error('INSERT cruzado (negocio_id=1) → WITH CHECK lo rechaza',
                   lambda: L.ejecutar("INSERT INTO tienda.clientes (negocio_id, tipo_documento, documento, nombre, activo) "
                                      "VALUES (1, 'V', '777-CRUCE', 'Cruce', true)"))
    L.ejecutar("DELETE FROM tienda.clientes WHERE negocio_id = 1")
    M.volver()   # los checks de supervivencia del negocio 1 requieren ver sus filas
    L.ok(L.q1("SELECT count(*) FROM tienda.clientes WHERE documento = '900-SEED'") == 1,
         'DELETE cruzado: no borra nada del negocio 1')
    L.ejecutar("DELETE FROM tienda.categorias WHERE nombre = 'Aceites N2'")
    L.ok(L.q1("SELECT count(*) FROM tienda.categorias WHERE nombre = 'Aceites N2'") == 0,
         'DELETE propio: sí borra')
    M.volver()
