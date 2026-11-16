#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Instalación completa de las bases del sistema (tienda + portal_saas) replicando
scripts/multitenant/reinstalar_completo.sh del proyecto, con psycopg2 (no hay psql necesario).
Uso: python3 setup_db.py [--solo-verificar]
"""
import os
import sys
from pathlib import Path

import psycopg2

SQL = str(Path(__file__).resolve().parents[2] / 'database' / 'sql')
HOST = os.environ.get('PGHOST', '/tmp')
PORT = int(os.environ.get('PGPORT', '5433'))

TIENDA_FILES = (
    ['01_tablas.sql', '02_funciones_procedimientos.sql', '03_triggers.sql', '04_vistas.sql', '05_datos_iniciales.sql']
    + [f'{n:02d}_{n2}.sql' for n, n2 in
       [(6, 'busqueda_sin_tildes'), (7, 'cierres_caja'), (8, 'retenciones_iva'), (9, 'numeracion_fiscal'),
        (10, 'contabilidad'), (11, 'cierre_y_pagos'), (12, 'devolucion_notas'), (13, 'conciliaciones'),
        (14, 'aperturas_caja'), (15, 'cuentas_por_cobrar'), (16, 'correcciones_control'), (17, 'metodos_pago'),
        (18, 'devolucion_en_caja'), (19, 'regimen_y_apertura'), (20, 'retenciones_islr'), (21, 'calendario_fiscal'),
        (22, 'calendario_parametrizable'), (23, 'unidades_piezas'), (24, 'encargos'), (25, 'combos'),
        (26, 'ordenes_compra'), (27, 'conteos_fisicos'), (28, 'analisis_rentabilidad'), (29, 'caja_desglose'),
        (30, 'calendario_ordinario')]]
    + ['31_multitenant.sql', '35_provisionar.sql', '36_islr_declaracion.sql',
       '37_libro_ventas_negocio.sql', '38_presentaciones_venta.sql', '39_islr_asientos.sql',
       '41_endurecimiento_seguridad.sql', '43_plataforma_admin.sql']
)

PORTAL_FILES = ['33_portal.sql', '34_portal_pagos.sql', '40_ciclo_cobro.sql', '42_portal_rol.sql']

# Semilla idéntica a reinstalar_completo.sh (negocio 1 demo, admin con contraseña conocida por las pruebas)
SEED_TIENDA = r"""
SET search_path = tienda, public;
INSERT INTO tienda.tasas_cambio (moneda_origen, moneda_destino, tasa, fecha_valor, fuente, es_oficial_bcv)
VALUES ('USD', 'VES', 36.50, CURRENT_DATE, 'BCV', true)
ON CONFLICT (moneda_origen, moneda_destino, fecha_valor) DO NOTHING;
INSERT INTO tienda.tasas_cambio (moneda_origen, moneda_destino, tasa, fecha_valor, fuente, es_oficial_bcv)
VALUES ('EUR', 'VES', 1.0352, CURRENT_DATE, 'BCV', true)
ON CONFLICT (moneda_origen, moneda_destino, fecha_valor) DO NOTHING;
INSERT INTO tienda.tasas_cambio (moneda_origen, moneda_destino, tasa, fecha_valor, fuente, es_oficial_bcv)
VALUES ('COP', 'VES', 0.2280, CURRENT_DATE, 'BCV', true)
ON CONFLICT (moneda_origen, moneda_destino, fecha_valor) DO NOTHING;
-- Hash bcrypt (costo 12) de «PaginasTest2026»: la clave del admin que usan las
-- suites t16 (páginas Inertia), t17 (concurrencia) y t18 (navegador).
CALL tienda.sp_cambiar_password(1, '$2y$12$qmLHKY5xflsGqI2PL8H0o.QqmmJtxbch6rUPuoWfOC08nSf1g4Vqy');
CALL tienda.sp_guardar_configuracion_negocio(
    'Distribuidora Moto Piezas C.A.', 'J-07013380-5', 'Av. Principal, local 4, Barquisimeto',
    true, true, true, false, 'AUTOMATICO', 'ULTIMO', 30, 'CON_IVA',
    'Moto Piezas', '0251-1234567', 'ventas@motopiezas.com', 1);
CALL tienda.sp_confirmar_configuracion_inicial(1);
UPDATE tienda.estado_tenants SET subdominio = tienda.fn_subdominio_unico('Moto Piezas', 1) WHERE negocio_id = 1;
INSERT INTO tienda.productos (negocio_id, sku, nombre, unidad, costo_usd, margen_pct, exento_iva, exonerado_iva, stock_minimo, activo)
SELECT 1, x.sku, x.nombre, 'UND', x.costo, 30, false, false, 2, true
  FROM (VALUES ('M2-ACEITE','Aceite motor 20W-50 1L',7.0),
               ('M2-BUJIA','Bujía NGK CR7HSA',2.5),
               ('M2-FILTRO','Filtro de aceite GX',3.2),
               ('M2-PASTILLA','Pastillas de freno delanteras',8.0),
               ('M2-LLANTA','Llanta 2.75-17',18.0),
               ('M2-CAMARA','Cámara 2.75-17',4.5),
               ('M2-CADENA','Cadena 428H 120 eslabones',9.0),
               ('M2-ESPEJO','Espejo retrovisor universal',3.8)) AS x(sku, nombre, costo)
  WHERE NOT EXISTS (SELECT 1 FROM tienda.productos p WHERE p.sku = x.sku);
UPDATE tienda.productos SET codigo_barras = '7700000000' || lpad(id::text, 4, '0') WHERE codigo_barras IS NULL;
UPDATE tienda.productos SET categoria_id = (SELECT min(id) FROM tienda.categorias) WHERE categoria_id IS NULL;
INSERT INTO tienda.proveedores (negocio_id, razon_social, rif, activo)
SELECT 1, x.r, x.rif, true
  FROM (VALUES ('Repuestos del Este C.A.','J-33978211-2'),
               ('Accesorios Venezolanos C.A.','J-12449005-6')) AS x(r, rif)
  WHERE NOT EXISTS (SELECT 1 FROM tienda.proveedores p WHERE p.rif = x.rif);
SELECT tienda.fn_islr_guardar_ut(DATE '2026-09-01', 40.00, 'UT de septiembre (demo plantilla)', 1);
SELECT tienda.fn_islr_guardar_ut(DATE '2026-10-01', 41.50, 'UT de octubre (demo plantilla)', 1);
DO $$
DECLARE pid bigint; rec record;
BEGIN
  FOR rec IN SELECT * FROM (VALUES ('M2-ACEITE',50),('M2-BUJIA',80),('M2-FILTRO',40),('M2-PASTILLA',30),
                                   ('M2-LLANTA',15),('M2-CAMARA',25),('M2-CADENA',20),('M2-ESPEJO',35))
                        AS x(sku, qty) LOOP
    SELECT min(id) INTO pid FROM tienda.productos WHERE sku = rec.sku;
    CALL tienda.sp_ajustar_stock(pid, rec.qty, 'INVENTARIO INICIAL', 1, true);
  END LOOP;
END $$;
INSERT INTO tienda.clientes (negocio_id, tipo_documento, documento, nombre, telefono, activo)
SELECT 1, 'V', x.doc, x.nombre, '', true
  FROM (VALUES ('11111111','María Pérez'), ('22222222','Juan Rodríguez')) AS x(doc, nombre)
  WHERE NOT EXISTS (SELECT 1 FROM tienda.clientes c WHERE c.documento = x.doc);
INSERT INTO tienda.combos (negocio_id, sku, nombre, descripcion, precio_usd, activo)
SELECT 1, 'KIT-DEMO-01', 'Kit afinación demo', 'Bujía + filtro de aceite', 7.00, true
  WHERE NOT EXISTS (SELECT 1 FROM tienda.combos WHERE sku = 'KIT-DEMO-01');
INSERT INTO tienda.combo_componentes (negocio_id, combo_id, producto_id, cantidad)
SELECT 1, (SELECT id FROM tienda.combos WHERE sku = 'KIT-DEMO-01'),
       (SELECT id FROM tienda.productos WHERE sku = 'M2-BUJIA'), 1
  WHERE NOT EXISTS (SELECT 1 FROM tienda.combo_componentes cc JOIN tienda.combos c ON c.id = cc.combo_id
                     WHERE c.sku = 'KIT-DEMO-01' AND cc.producto_id = (SELECT id FROM tienda.productos WHERE sku = 'M2-BUJIA'));
INSERT INTO tienda.combo_componentes (negocio_id, combo_id, producto_id, cantidad)
SELECT 1, (SELECT id FROM tienda.combos WHERE sku = 'KIT-DEMO-01'),
       (SELECT id FROM tienda.productos WHERE sku = 'M2-FILTRO'), 1
  WHERE NOT EXISTS (SELECT 1 FROM tienda.combo_componentes cc JOIN tienda.combos c ON c.id = cc.combo_id
                     WHERE c.sku = 'KIT-DEMO-01' AND cc.producto_id = (SELECT id FROM tienda.productos WHERE sku = 'M2-FILTRO'));
"""

SEED_PORTAL = r"""
INSERT INTO portal.config (clave, valor) VALUES ('tasa_usd_ves', '36.50') ON CONFLICT (clave) DO NOTHING;
"""


def ejecutar(db: str, sql: str, etiqueta: str, conn_params: dict) -> None:
    conn = psycopg2.connect(**conn_params, dbname=db)
    conn.autocommit = True
    cur = conn.cursor()
    try:
        cur.execute(sql)
    except Exception as e:
        msg = str(e).split('\n')[0][:300]
        print(f'  ✗ {etiqueta}: {msg}')
        raise
    finally:
        cur.close()
        conn.close()
    print(f'  ✓ {etiqueta}')


def admin_params() -> dict:
    return dict(host=HOST, port=PORT, user='postgres')


def main() -> None:
    # GUARDIA anti-desastre: este script hace DROP DATABASE de las bases del
    # sistema contra el puerto que le indique PGPORT. En el CI eso es 5433 (un
    # contenedor efímero postgres:17); en la máquina de desarrollo, 5432 es el
    # SERVIDOR VIVO con la base real del negocio (tienda, usuario admin).
    # Soltar aquí los DROP con PGPORT=5432 la destruiría. Solo se permite otro
    # puerto con la bandera explícita --puerto-riesgo-propietario.
    if PORT != 5433 and '--puerto-riesgo-propietario' not in sys.argv:
        print('✗ ABORTADO: PGPORT={} — solo 5433 está permitido sin la bandera '
              'explícita --puerto-riesgo-propietario. Este script hace DROP '
              'DATABASE contra el puerto dado y en 5432 vive la base REAL '
              '(«tienda» del negocio).'.format(PORT))
        sys.exit(2)

    if '--solo-verificar' in sys.argv:
        for db in ('tienda', 'portal_saas'):
            c = psycopg2.connect(**admin_params(), dbname=db)
            cur = c.cursor()
            cur.execute("SELECT count(*) FROM pg_tables WHERE schemaname = 'tienda' OR schemaname = 'portal'")
            print(db, 'tablas:', cur.fetchone()[0])
            cur.close()
            c.close()
        return

    con = psycopg2.connect(**admin_params(), dbname='postgres')
    con.autocommit = True
    cur = con.cursor()
    for db in ('tienda', 'portal_saas', 'tienda_e2e', 'tienda_fiscal', 'tienda_multi'):
        cur.execute('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()', (db,))
        cur.execute(f'DROP DATABASE IF EXISTS {db}')
        print(f'  · DROP {db}')
    for db in ('tienda', 'portal_saas'):
        cur.execute(f'CREATE DATABASE {db}')
    # Ajustes A NIVEL DE BASE (viajan a los clones por TEMPLATE y a los restores
    # por el dump): zona horaria fiscal (M-8) y search_path por defecto — sin
    # esto, CURRENT_DATE de la semilla sale en UTC y no coincide con fn_hoy()
    # (Caracas): las compras de las suites piden la tasa del día equivocado.
    cur.execute("ALTER DATABASE tienda SET TIMEZONE TO 'America/Caracas'")
    cur.execute("ALTER DATABASE tienda SET search_path TO tienda, public")
    cur.execute("ALTER DATABASE portal_saas SET TIMEZONE TO 'America/Caracas'")
    cur.execute("ALTER DATABASE portal_saas SET search_path TO portal, public")
    cur.close()
    con.close()

    print('── tienda: esquema completo')
    for f in TIENDA_FILES:
        ejecutar('tienda', open(f'{SQL}/{f}').read(), f, admin_params())
    print('── tienda: semilla (negocio 1 demo)')
    ejecutar('tienda', SEED_TIENDA, 'semilla negocio 1', admin_params())
    print('── portal_saas: esquema + semilla')
    for f in PORTAL_FILES:
        ejecutar('portal_saas', open(f'{SQL}/{f}').read(), f, admin_params())
    ejecutar('portal_saas', SEED_PORTAL, 'semilla portal', admin_params())

    # Verificación final
    c = psycopg2.connect(**admin_params(), dbname='tienda')
    cur = c.cursor()
    cur.execute("SELECT count(*) FROM pg_tables WHERE schemaname='tienda'")
    print('tienda tablas:', cur.fetchone()[0])
    cur.execute('SELECT id, razon_social, configurado_en IS NOT NULL FROM tienda.negocio ORDER BY id')
    print('negocios:', cur.fetchall())
    cur.execute('SELECT negocio_id, subdominio, activo, plan FROM tienda.estado_tenants ORDER BY negocio_id')
    print('estado_tenants:', cur.fetchall())
    cur.execute('SELECT count(*) FROM tienda.productos')
    print('productos negocio 1:', cur.fetchone()[0])
    cur.close()
    c.close()
    print('INSTALACIÓN COMPLETA')


if __name__ == '__main__':
    main()
