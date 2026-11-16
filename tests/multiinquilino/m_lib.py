# -*- coding: utf-8 -*-
"""Librería de la suite multiinquilino: clon «tienda_multi», provisionamiento del
negocio 2 (Bodega La Esquina) y sesiones de app (rol NO superusuario + GUC)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'e2e'))
import e2e_lib as L  # noqa: E402

L.DSN['dbname'] = 'tienda_multi'

# Catálogos y configuración que el negocio 2 hereda del negocio 1. id_fijo=True
# marca las 4 config de PK fija: su fila del negocio 2 lleva id = 2.
TABLAS_COPIA = [
    ('metodos_pago', False), ('unidades_medida', False), ('categorias', False),
    ('marcas', False), ('plan_cuentas', False), ('contab_parametros', False),
    ('contab_metodo_cuenta', False), ('calendario_fiscal', False),
    ('numeracion_fiscal', True), ('caja_config', True), ('contab_config', True),
    ('islr_config', True),
]


def provisionar_negocio_2():
    """Alta del negocio 2 como lo haría el portal: fila de negocio, catálogos
    heredados, usuarios propios y su fila de control en estado_tenants."""
    L.rollback()
    L.ejecutar("INSERT INTO tienda.negocio (id, razon_social, nombre_comercial, rif, direccion_fiscal, "
               "telefono, correo, es_contribuyente_especial, cobra_igtf, recupera_credito_fiscal, "
               "precios_incluyen_iva, configurado_en, configurado_por) "
               "VALUES (2, 'Bodega La Esquina C.A.', 'Bodega La Esquina', %s, 'Calle Falcón, Casa 12', "
               " '04141234567', 'bodega@esquina.com', true, false, true, false, now(), 1)", (L.rif('J'),))
    for t, id_fijo in TABLAS_COPIA:
        ident = L.q1("SELECT is_identity FROM information_schema.columns "
                     "WHERE table_schema='tienda' AND table_name = %s AND column_name = 'id'", (t,))
        cols = L.qd("SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema='tienda' AND table_name = %s "
                    "AND column_name NOT IN ('id','negocio_id','created_at','updated_at') "
                    "ORDER BY ordinal_position", (t,))
        cabecera, valores = ['negocio_id'], ['2']
        if id_fijo and ident != 'YES':     # PK fija (DEFAULT 1): la fila del negocio 2 lleva id = 2
            cabecera = ['id', 'negocio_id']
            valores = ['2', '2']
        nombres = ', '.join(cabecera + [c['column_name'] for c in cols])
        lista = ', '.join(valores + [c['column_name'] for c in cols])
        L.ejecutar(f"INSERT INTO tienda.{t} ({nombres}) SELECT {lista} FROM tienda.{t} WHERE negocio_id = 1")
    # Las filas copiadas conservan los ids de las cuentas del negocio 1: se re-apuntan a las cuentas propias del negocio 2 (por código).
    L.ejecutar("UPDATE tienda.plan_cuentas h SET cuenta_padre_id = (SELECT p2.id FROM tienda.plan_cuentas p1 JOIN tienda.plan_cuentas p2 ON p2.codigo = p1.codigo AND p2.negocio_id = 2 "
               "WHERE p1.id = h.cuenta_padre_id) WHERE h.negocio_id = 2 AND h.cuenta_padre_id IS NOT NULL")
    for t in ('contab_parametros', 'contab_metodo_cuenta'):
        L.ejecutar(f"UPDATE tienda.{t} c SET cuenta_id = (SELECT p2.id FROM tienda.plan_cuentas p1 JOIN tienda.plan_cuentas p2 ON p2.codigo = p1.codigo AND p2.negocio_id = 2 "
                   f"WHERE p1.id = c.cuenta_id) WHERE c.negocio_id = 2")
    for u, rol in (('admin_bodega', 'ADMINISTRADOR'), ('cajero_bodega', 'CAJERO')):
        L.ejecutar("INSERT INTO tienda.usuarios (negocio_id, username, password_hash, nombre_completo, rol, activo) "
                   "VALUES (2, %s, 'PENDIENTE', %s, %s, true)", (u, u.replace('_', ' ').title(), rol))
    # Fila de control del portal para el negocio 2 (lo que en producción hace el
    # alta del portal: subdominio, plan y verticales).
    L.ejecutar("INSERT INTO tienda.estado_tenants (negocio_id, subdominio, plan, modulos) "
               "VALUES (2, 'bodega-esquina', 'PRACTICA', '{\"repuestos\": true}'::jsonb)")
    L.ejecutar("INSERT INTO tienda.tasas_cambio (moneda_origen, moneda_destino, tasa, fecha_valor, fuente, es_oficial_bcv) "
               "SELECT 'USD', 'VES', 40.00, CURRENT_DATE, 'MANUAL', true "
               "WHERE NOT EXISTS (SELECT 1 FROM tienda.tasas_cambio WHERE moneda_origen='USD' "
               "AND moneda_destino='VES' AND fecha_valor = CURRENT_DATE)")
    L.commit()


def como(nid):
    """Sesión de la aplicación: rol NO superusuario + negocio activo (RLS aplicando)."""
    L.rollback()
    L.ejecutar("SET ROLE saas_app")
    L.ejecutar(f"SET app.negocio_id = '{nid}'")


def volver():
    """De vuelta a superusuario sin negocio fijado (portal/instalación)."""
    L.rollback()
    L.ejecutar("RESET app.negocio_id")
    L.ejecutar("RESET ROLE")


def producto_base(sku, nombre, precio=10.0, costo=7.0, codigo_barras=None):
    """Producto mínimo (stock en cero: el trigger no deja cargarlo al crear)."""
    extra = {'codigo_barras': codigo_barras} if codigo_barras else {}
    return L.ins('productos', sku=sku, nombre=nombre, unidad='UND', costo_usd=costo,
                 margen_pct=30, precio_venta_usd=precio, exento_iva=False, exonerado_iva=False,
                 stock_actual=0, stock_minimo=2, activo=True, **extra)


def carga_stock(prod, uid, cantidad=50):
    """Inventario inicial vía el procedimiento oficial (CALL sp_ajustar_stock)."""
    L.ejecutar("CALL tienda.sp_ajustar_stock(%s, %s, 'INVENTARIO INICIAL', %s, true)", (prod, cantidad, uid))


def uid_de(username):
    """Id del usuario de la sesión de app (fn_usuario_sesion via GUC tienda.usuario_id)."""
    return L.q1("SELECT id FROM tienda.usuarios WHERE username = %s", (username,))
