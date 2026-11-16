#!/bin/bash
# Reconstrucción completa del entorno PostgreSQL 17 multitenant desde los scripts
# del proyecto. El cluster anterior fue reinicializado por PG16 durante el
# reciclaje del sandbox; el estado verificado (543/0) se recrea con:
#   tienda  = 00_instalar (01→05) + 06…30 + 31_multitenant
#   portal  = 33_portal.sql
set -e
PG=/home/z/my-project/work/pgsql/postgresql-17.4.0-x86_64-unknown-linux-gnu/bin
SQL=/home/z/my-project/work/sistema/sistema-repuestos-motos/database/sql
DATA=/home/z/my-project/work/pg/data

echo "── 1 · cluster PG17 fresco"
$PG/pg_ctl -D "$DATA" stop 2>/dev/null || true
[ -d "$DATA" ] && { rm -rf "${DATA}_pg16_reciclado"; mv "$DATA" "${DATA}_pg16_reciclado"; }
$PG/initdb -D "$DATA" -U postgres -E UTF8 --locale=C.UTF-8 > /tmp/initdb.log 2>&1
$PG/pg_ctl -D "$DATA" -l /tmp/pg.log -o "-p 5433 -k /tmp" start
sleep 2

echo "── 2 · tienda (esquema + funciones + multitenant)"
$PG/psql -h /tmp -p 5433 -U postgres -d postgres -tA -c "DROP DATABASE IF EXISTS tienda"
$PG/createdb -h /tmp -p 5433 -U postgres tienda
$PG/psql -h /tmp -p 5433 -U postgres -d tienda -v ON_ERROR_STOP=1 -q -f "$SQL/00_instalar.sql"
for f in "$SQL"/0[6-9]_*.sql "$SQL"/{10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30}_*.sql; do
    echo "   + $(basename "$f")"
    $PG/psql -h /tmp -p 5433 -U postgres -d tienda -v ON_ERROR_STOP=1 -q -f "$f"
done
$PG/psql -h /tmp -p 5433 -U postgres -d tienda -v ON_ERROR_STOP=1 -f "$SQL/31_multitenant.sql" 2>&1 | tail -3
$PG/psql -h /tmp -p 5433 -U postgres -d tienda -v ON_ERROR_STOP=1 -f "$SQL/35_provisionar.sql" 2>&1 | tail -2
$PG/psql -h /tmp -p 5433 -U postgres -d tienda -v ON_ERROR_STOP=1 -q -f "$SQL/36_islr_declaracion.sql" 2>&1 | grep -v NOTICE | tail -2
$PG/psql -h /tmp -p 5433 -U postgres -d tienda -v ON_ERROR_STOP=1 -q -f "$SQL/37_libro_ventas_negocio.sql" 2>&1 | grep -v NOTICE | tail -2
$PG/psql -h /tmp -p 5433 -U postgres -d tienda -v ON_ERROR_STOP=1 -q -f "$SQL/38_presentaciones_venta.sql" 2>&1 | grep -v NOTICE | tail -2
$PG/psql -h /tmp -p 5433 -U postgres -d tienda -v ON_ERROR_STOP=1 -q -f "$SQL/39_islr_asientos.sql" 2>&1 | grep -v NOTICE | tail -2

echo "── 2b · asistente de primer inicio + tasas del día (estado «configurado»)"
$PG/psql -h /tmp -p 5433 -U postgres -d tienda -v ON_ERROR_STOP=1 -q <<'SQL'
SET search_path = tienda, public;
-- Tasas del día primero (el checklist de confirmación las exige recientes)
INSERT INTO tienda.tasas_cambio (moneda_origen, moneda_destino, tasa, fecha_valor, fuente, es_oficial_bcv)
VALUES ('USD', 'VES', 36.50, CURRENT_DATE, 'BCV', true)
ON CONFLICT (moneda_origen, moneda_destino, fecha_valor) DO NOTHING;
INSERT INTO tienda.tasas_cambio (moneda_origen, moneda_destino, tasa, fecha_valor, fuente, es_oficial_bcv)
VALUES ('EUR', 'VES', 1.0352, CURRENT_DATE, 'BCV', true)
ON CONFLICT (moneda_origen, moneda_destino, fecha_valor) DO NOTHING;
INSERT INTO tienda.tasas_cambio (moneda_origen, moneda_destino, tasa, fecha_valor, fuente, es_oficial_bcv)
VALUES ('COP', 'VES', 0.2280, CURRENT_DATE, 'BCV', true)
ON CONFLICT (moneda_origen, moneda_destino, fecha_valor) DO NOTHING;
-- Contraseña real del admin (el seed la deja PENDIENTE; el checklist la exige)
CALL tienda.sp_cambiar_password(1, '$2y$12$cbaFYjBCzIjTqXLQPTpvkuxCNJDfbZQ0tjJRNChF3KSP5dKO5RG7a');
CALL tienda.sp_guardar_configuracion_negocio(
    'Distribuidora Moto Piezas C.A.', 'J-07013380-5', 'Av. Principal, local 4, Barquisimeto',
    true, true, true, false, 'AUTOMATICO', 'ULTIMO', 30, 'CON_IVA',
    'Moto Piezas', '0251-1234567', 'ventas@motopiezas.com', 1);
CALL tienda.sp_confirmar_configuracion_inicial(1);
UPDATE tienda.estado_tenants SET subdominio = tienda.fn_subdominio_unico('Moto Piezas', 1) WHERE negocio_id = 1;
-- Datos demo de la tienda (repuestos), como la plantilla configurada original
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
-- Proveedores demo (los suites fiscales compran contra ellos)
INSERT INTO tienda.proveedores (negocio_id, razon_social, rif, activo)
SELECT 1, x.r, x.rif, true
  FROM (VALUES ('Repuestos del Este C.A.','J-33978211-2'),
               ('Accesorios Venezolanos C.A.','J-12449005-6')) AS x(r, rif)
  WHERE NOT EXISTS (SELECT 1 FROM tienda.proveedores p WHERE p.rif = x.rif);
-- Histórico de UT (los suites fiscales usan la vigencia del período anterior)
SELECT tienda.fn_islr_guardar_ut(DATE '2026-09-01', 40.00, 'UT de septembre (demo plantilla)', 1);
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
-- Combo demo (la caja vende «Kit afinación»: componentes con stock)
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
SQL
echo "   ✓ negocio 1 configurado (RIF J-07013380-5, régimen especial, IGTF) + tasas del día"

echo "── 3 · portal_saas (33_portal.sql)"
$PG/psql -h /tmp -p 5433 -U postgres -d postgres -tA -c "DROP DATABASE IF EXISTS portal_saas"
$PG/createdb -h /tmp -p 5433 -U postgres portal_saas
$PG/psql -h /tmp -p 5433 -U postgres -d portal_saas -v ON_ERROR_STOP=1 -f "$SQL/33_portal.sql" 2>&1 | tail -2
$PG/psql -h /tmp -p 5433 -U postgres -d portal_saas -v ON_ERROR_STOP=1 -f "$SQL/34_portal_pagos.sql" 2>&1 | tail -2

echo "── 4 · verificación de bases"
$PG/psql -h /tmp -p 5433 -U postgres -d postgres -tA -c "SELECT datname||' ('||pg_size_pretty(pg_database_size(datname))||')' FROM pg_database WHERE datname NOT LIKE 'template%' ORDER BY datname"
echo "REINSTALACIÓN COMPLETA"
