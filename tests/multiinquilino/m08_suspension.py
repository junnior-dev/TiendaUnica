# -*- coding: utf-8 -*-
"""m08 · GUARDA DE SESIÓN y SUSPENSIÓN POR MORA: sin GUC no se ve ni se escribe
(ni se cae al negocio 1); el portal corta el grifo del tenant con un UPDATE."""
import e2e_lib as L  # noqa: E402
import m_lib as M  # noqa: E402


def main():
    L.empezar('m08 · GUARDA DE SESIÓN: sin GUC no se ve ni se escribe')
    M.como(2)
    base_ventas = L.q1("SELECT count(*) FROM tienda.ventas")
    base_clientes = L.q1("SELECT count(*) FROM tienda.clientes")
    L.ok(base_ventas > 0, f'sesión normal del negocio 2 → {base_ventas} ventas visibles (baseline)')
    L.ejecutar("RESET app.negocio_id")
    L.ok(L.fn('fn_sesion_permitida') is False,
         'RESET del GUC → fn_sesion_permitida = False («» vacío cuenta como sin fijar)')
    L.ok(L.fn('fn_negocio_actual') == 1,
         'sin GUC fn_negocio_actual devuelve 1 (compatibilidad del superusuario intacta)')
    L.ok(L.q1("SELECT count(*) FROM tienda.ventas") == 0, 'ventas visibles sin GUC: 0')
    L.ok(L.q1("SELECT count(*) FROM tienda.clientes") == 0,
         f'clientes visibles sin GUC: 0 (la sesión tenía {base_clientes})')
    L.ok(L.q1("SELECT count(*) FROM tienda.negocio") == 0, 'ni la propia fila de negocio se ve sin GUC')
    L.espera_error('INSERT sin GUC → WITH CHECK de la política lo rechaza',
                   lambda: L.ejecutar("INSERT INTO tienda.categorias (nombre) VALUES ('fantasma-sin-guc')"))
    M.como(2)
    L.ok(L.q1("SELECT count(*) FROM tienda.ventas") == base_ventas, 'GUC restaurado → todo vuelve a la vista')

    L.empezar('m08 · SUSPENSIÓN POR MORA: el portal corta el grifo')
    M.volver()
    L.ejecutar("UPDATE tienda.estado_tenants SET activo = false, suspendida_en = now(), "
               " motivo = 'factura vencida' WHERE negocio_id = 2")
    L.commit()
    M.como(2)
    L.ok(L.q1("SELECT count(*) FROM tienda.ventas") == 0, 'suspendido: 0 ventas visibles (la guarda evalúa la política)')
    L.ok(L.q1("SELECT count(*) FROM tienda.negocio") == 0, 'suspendido: ni su propia configuración se ve')
    L.espera_error('INSERT suspendido → rechazado por RLS',
                   lambda: L.ejecutar("INSERT INTO tienda.categorias (nombre) VALUES ('mora')"))
    M.como(2)   # espera_error hizo rollback: SET ROLE y el GUC se revierten con la transacción
    L.espera_error('exportar datos suspendido → el negocio es invisible para su propia sesión',
                   lambda: L.fn('fn_exportar_negocio'))
    M.como(2)
    M.volver()
    L.ok(L.q1("SELECT count(*) FROM tienda.clientes WHERE negocio_id = 1") > 0,
         'el negocio 1 (al día) sigue operando con el 2 suspendido')
    L.ejecutar("UPDATE tienda.estado_tenants SET activo = true, suspendida_en = NULL, motivo = NULL "
               "WHERE negocio_id = 2")
    L.commit()
    M.como(2)
    L.ok(L.q1("SELECT count(*) FROM tienda.ventas") == base_ventas, 'reactivado: la sesión del negocio 2 vuelve a ver todo')

    L.empezar('m08 · VERTICALES Y SUBDOMINIO: control del portal por tenant')
    L.ok(L.fn('fn_negocio_modulo', 'repuestos') is True, "módulo «repuestos» activo para el negocio 2 (estado_tenants.modulos)")
    L.ok(L.fn('fn_negocio_modulo', 'ropa') is False, "módulo «ropa» NO activo para el negocio 2")
    M.volver()
    L.ok(L.fn('fn_negocio_modulo', 'repuestos') is False, 'el negocio 1 no tiene verticales (generalista)')
    L.espera_error('subdominio duplicado → UNIQUE lo rechaza',
                   lambda: L.ejecutar("INSERT INTO tienda.estado_tenants (negocio_id, subdominio) "
                                      "VALUES (2, 'moto-piezas')"))
    L.commit()
    tomado = L.q1("SELECT subdominio FROM tienda.estado_tenants WHERE negocio_id = 1")
    L.ok(L.fn('fn_subdominio_unico', tomado, 9) == tomado + '-9',
         f'subdominio tomado ({tomado}) → fn_subdominio_unico propone «slug-id»')
    M.volver()
