# -*- coding: utf-8 -*-
"""Núcleo de las pruebas fiscales: reutiliza el harness del E2E pero contra el clon
dedicado «tienda_fiscal» (aislado de los datos del E2E)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'e2e'))
import e2e_lib as L  # noqa: E402

L.DSN['dbname'] = 'tienda_fiscal'


def conectar_fiscal():
    L.conectar()
    # turno abierto para el admin (las ventas exigen caja)
    uid = L.admin()
    if L.fn('fn_apertura_activa', uid) is None:
        L.fn('fn_abrir_caja', uid, 100, 1000)
        L.commit()
    return uid


def activar_especial(on):
    """Régimen ESPECIAL con IGTF (acción de Configuración → Régimen)."""
    L.ejecutar("UPDATE tienda.negocio SET es_contribuyente_especial = %s, cobra_igtf = %s WHERE id = 1", (on, on))
    L.commit()


def m_efectivo(nombre='Efectivo USD'):
    return L.q1("SELECT id FROM tienda.metodos_pago WHERE nombre = %s AND activo", (nombre,))


def precio_total(p, cantidad=1, desc=0):
    precio = float(L.q1("SELECT precio_venta_usd FROM tienda.productos WHERE id = %s", (p,)))
    return round(precio * cantidad * (1 - desc / 100) * 1.16, 2)
