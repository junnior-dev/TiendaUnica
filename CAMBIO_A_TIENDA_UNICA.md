# CAMBIO A TIENDA ÚNICA — Documentación Completa

**Fecha:** 16 de noviembre de 2026  
**Autor:** Sistema de Repuestos de Motos  
**Estado:** Documentación de migración de multi-tenant a tienda única

---

## 📋 Índice

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Análisis del Sistema Actual](#análisis-del-sistema-actual)
3. [Verticales de Negocio Soportadas](#verticales-de-negocio-soportadas)
4. [Arquitectura Multi-tenant Actual](#arquitectura-multi-tenant-actual)
5. [Plan de Conversión a Tienda Única](#plan-de-conversión-a-tienda-única)
6. [Cambios en Base de Datos (SQL)](#cambios-en-base-de-datos-sql)
7. [Cambios en Laravel (PHP)](#cambios-en-laravel-php)
8. [Módulos Verticales por Tipo de Negocio](#módulos-verticales-por-tipo-de-negocio)
9. [Plan de Ejecución](#plan-de-ejecución)
10. [Verificación y Pruebas](#verificación-y-pruebas)

---

## 🎯 Resumen Ejecutivo

### Contexto

El sistema actual es un SaaS multi-tenant diseñado para repuestos de motos en Venezuela, con capacidad de escalar a múltiples verticales de negocio (ferretería, ropa, bodega/abarrotes). La arquitectura soporta:

- **67 tablas** con aislamiento por `negocio_id`
- **Row-Level Security (RLS)** para separación de datos
- **Portal central** para gestión de suscripciones
- **Módulos verticales** activables por tenant

### Decisión

Convertir el sistema de **multi-tenant** a **tienda única** para simplificar:

- Eliminar complejidad de RLS y portal
- Reducir carga de infraestructura
- Mantener toda la funcionalidad de negocio
- Preservar la capacidad de expansión vertical

### Impacto

| Aspecto | Antes (Multi-tenant) | Después (Tienda única) |
|---------|---------------------|------------------------|
| Aislamiento de datos | RLS + GUC + Portal | `negocio_id = 1` fijo |
| Complejidad SQL | Alta (RLS, sellos, export/import) | Baja (funciones simplificadas) |
| Infraestructura | Portal separado + Base tenant | Una sola base |
| Verticalización | Por `estado_tenants.modulos` | Por `negocio.vertical` |
| Esfuerzo de cambio | — | 4-5 horas |

---

## 🏗️ Análisis del Sistema Actual

### Stack Tecnológico

| Componente | Tecnología | Versión |
|------------|------------|---------|
| **Backend** | Laravel | 12.x (PHP 8.2+ / 8.3) |
| **Frontend** | React + Inertia.js | React 19, Inertia 2.0 |
| **Base de datos** | PostgreSQL | 17 en CI / 18 en local |
| **Estilos** | Tailwind CSS | 4.0 |
| **Iconos** | Lucide React | 1.67.0 |
| **PDF** | jsPDF + jsPDF-AutoTable | 4.2.1 + 5.0.9 |
| **Autenticación** | Session-based (bcrypt) | — |

### Módulos del Sistema

```
┌─────────────────────────────────────────────────────────┐
│                    NÚCLEO DEL SISTEMA                    │
├─────────────────────────────────────────────────────────┤
│ ✓ Punto de Venta (POS)                                  │
│ ✓ Inventario y Kardex                                   │
│ ✓ Compras y Proveedores                                 │
│ ✓ Ventas y Clientes                                     │
│ ✓ Cuentas por Cobrar                                    │
│ ✓ Cuentas por Pagar                                     │
│ ✓ Cierres de Caja                                       │
│ ✓ Contabilidad General                                  │
│ ✓ Libros Fiscales (SENIAT)                              │
│ ✓ Retenciones IVA e ISLR                                │
│ ✓ Calendario Fiscal                                     │
│ ✓ Órdenes de Compra                                     │
│ ✓ Encargos y Combos                                     │
│ ✓ Análisis de Rentabilidad (ABC)                        │
│ ✓ Conciliación Bancaria                                 │
│ ✓ Multi-tenant con RLS                                  │
└─────────────────────────────────────────────────────────┘
```

### Archivos SQL del Sistema

| Archivo | Propósito | ¿Se modifica? |
|---------|-----------|---------------|
| `00_instalar.sql` | Instalador principal | No |
| `01_tablas.sql` | Definición de tablas | No |
| `02_funciones_procedimientos.sql` | Lógica de negocio | No |
| `03_triggers.sql` | Automatizaciones | No |
| `04_vistas.sql` | Vistas de consulta | No |
| `05_datos_iniciales.sql` | Datos semilla | No |
| `06_busqueda_sin_tildes.sql` | Búsqueda con unaccent | No |
| `07_cierres_caja.sql` | Módulo de cierres | No |
| `08_retenciones_iva.sql` | Retenciones IVA | No |
| `09_numeracion_fiscal.sql` | Facturación | No |
| `10_contabilidad.sql` | Contabilidad | No |
| `11_cierre_y_pagos.sql` | Pagos a proveedores | No |
| `12_devolucion_notas.sql` | Notas de crédito | No |
| `13_conciliaciones.sql` | Conciliación bancaria | No |
| `14_aperturas_caja.sql` | Turnos de caja | No |
| `15_cuentas_por_cobrar.sql` | Crédito a clientes | No |
| `16_correcciones_control.sql` | Correcciones | No |
| `17_metodos_pago.sql` | Métodos de pago | No |
| `18_devolucion_en_caja.sql` | Devoluciones | No |
| `19_regimen_y_apertura.sql` | Régimen fiscal | No |
| `20_retenciones_islr.sql` | Retenciones ISLR | No |
| `21_calendario_fiscal.sql` | Calendario fiscal | No |
| `22_calendario_parametrizable.sql` | Calendario custom | No |
| `23_unidades_piezas.sql` | Unidades de medida | No |
| `24_encargos.sql` | Encargos | No |
| `25_combos.sql` | Combos/kits | No |
| `26_ordenes_compra.sql` | Órdenes de compra | No |
| `27_conteos_fisicos.sql` | Inventarios físicos | No |
| `28_analisis_rentabilidad.sql` | Análisis ABC | No |
| `29_caja_desglose.sql` | Desglose de caja | No |
| `30_calendario_ordinario.sql` | Calendario ordinario | No |
| **`31_multitenant.sql`** | **Multi-tenant (RLS, sellos, PKs/índices por negocio)** | **SÍ - Simplificar a `31_tienda_unica.sql` (conservando sellos o `DEFAULT 1`)** |
| **`33_portal.sql`** | **Portal central (`portal_saas`)** | **SÍ - Eliminar** |
| **`34_portal_pagos.sql`** | **Pagos del portal (`portal_saas`)** | **SÍ - Eliminar** |
| **`35_provisionar.sql`** | **Alta self-service (`fn_provisionar_negocio`)** | **SÍ - Eliminar (depende de `estado_tenants` y `fn_importar_negocio`)** |
| `36_islr_declaracion.sql` | ISLR anual (anticipos, retenciones sufridas, declaración) | **SÍ - Ajustar bloque final** (quitar `ENABLE/FORCE RLS` y `CREATE POLICY`) |
| `37_libro_ventas_negocio.sql` | `v_libro_ventas` con `id_negocio` | No (funciona con `fn_negocio_actual() = 1`) |
| `38_presentaciones_venta.sql` | Presentaciones de venta (unidad, caja, juego) | **SÍ - Ajustar bloque final** (quitar `ENABLE/FORCE RLS` y `CREATE POLICY`) |
| `39_islr_asientos.sql` | Asientos contables del ISLR anual | No |
| **`40_ciclo_cobro.sql`** | **Ciclo de cobro (`portal_saas`)** | **SÍ - Eliminar** |
| **`41_endurecimiento_seguridad.sql`** | **Guardia global y `REVOKE` a `saas_app`** | **SÍ - Simplificar** (`fn_puede_editar_global() → true`, quitar referencias a `estado_tenants` y `saas_app`) |
| **`42_portal_rol.sql`** | **Rol `portal_app` (`portal_saas`)** | **SÍ - Eliminar** |
| **`43_plataforma_admin.sql`** | **Tablas `plataforma_admin` y `plataforma_roles`** | **SÍ - Eliminar** (si ya se ejecutó, `31_tienda_unica.sql` las limpia) |

---

## 🏪 Verticales de Negocio Soportadas

### Visión General

El sistema está diseñado para soportar **4 verticales de negocio** en Venezuela:

```
┌─────────────────────────────────────────────────────────┐
│                 PLATAFORMA TIENDA ÚNICA                  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐  ┌──────────────┐                     │
│  │  REPUESTOS   │  │ FERRETERÍA   │                     │
│  │   DE MOTOS   │  │              │                     │
│  └──────────────┘  └──────────────┘                     │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐                     │
│  │     ROPA     │  │   BODEGA     │                     │
│  │  / BOUTIQUE  │  │  / ABARROTES │                     │
│  └──────────────┘  └──────────────┘                     │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │          FISCAL VENEZUELA (Compartido)          │    │
│  │  IVA 16% │ IGTF 3% │ Retenciones │ SENIAT       │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Cuadro Comparativo de Verticales

| Característica | Repuestos Motos | Ferretería | Ropa/Boutique | Bodega/Abarrotes |
|----------------|-----------------|------------|---------------|------------------|
| **Productos** | Repuestos específicos | Herramientas, materiales | Prendas por talla/color | Productos perecederos |
| **Inventario** | Por pieza | Por pieza/kg/metro | Por talla+color | Por lote y caducidad |
| **Compatibilidad** | Motos (marca/modelo/año) | Equipos (opcional) | No aplica | No aplica |
| **Unidades típicas** | UND, PAR, JGO | UND, KG, LTR, MTS, JGO | UND, PAR | UND, CAJA, KG, LTR |
| **Márgenes** | 30-40% | 25-45% | 40-65% | 15-35% |
| **Rotación** | Media | Media-baja | Alta (temporadas) | Alta (perecederos) |
| **Fiscal** | Completo | Completo | Completo | Completo |
| **Módulo SQL** | Incluido (motos_modelos) | `44_ferreteria_venezuela.sql` | `46_ropa_venezuela.sql` | `45_bodega_venezuela.sql` |

---

## 🔧 Módulos Verticales por Tipo de Negocio

### 1. REPUESTOS DE MOTOS (Actual)

**Estado:** Implementado y funcionando

**Tablas específicas:**
```sql
-- Ya existe en el sistema
motos_modelos (
    id BIGINT,
    marca VARCHAR(60),        -- Yamaha, Honda, Bajaj, etc.
    modelo VARCHAR(80),       -- FZ 16, CG 125, etc.
    cilindrada SMALLINT       -- 150, 200, etc.
)

producto_compatibilidad (
    producto_id BIGINT,
    moto_modelo_id BIGINT,
    anio_desde SMALLINT,
    anio_hasta SMALLINT
)
```

**Funcionalidades:**
- Búsqueda de repuestos por moto
- Compatibilidad por marca/modelo/año
- Categorías específicas (Motor, Frenos, Eléctrico, etc.)
- Unidades de medida (UND, PAR, JGO, SET)

**Categorías de ejemplo:**
```sql
INSERT INTO categorias (nombre, margen_pct) VALUES
    ('Motor y Transmisión', 35),
    ('Frenos', 32),
    ('Sistema Eléctrico', 38),
    ('Suspensión', 30),
    ('Carrocería', 28),
    ('Neumáticos', 25),
    ('Aceites y Lubricantes', 22),
    ('Accesorios', 45);
```

---

### 2. FERRETERÍA

**Estado:** Pendiente de implementar

**Archivo SQL:** `database/sql/44_ferreteria_venezuela.sql`

**Cambios necesarios:**

```sql
-- =============================================================
--  44_ferreteria_venezuela.sql
--  Módulo vertical para ferreterías
-- =============================================================

SET search_path = tienda, public;

-- -------------------------------------------------------------------
--  1. TABLA DE COMPATIBILIDAD (NO renombrar motos_modelos)
-- -------------------------------------------------------------------
-- IMPORTANTE: NO hacer ALTER TABLE motos_modelos RENAME TO equipos_modelos.
-- La vista v_compatibilidad (04_vistas.sql), encargos (24_encargos.sql) y los
-- controladores ModelosController, CompatibilidadController, MarcasController y
-- ProductosController consultan "motos_modelos" por nombre. Se mantiene el nombre
-- físico (con una vista alias opcional) y solo se cambia la etiqueta en la UI.
COMMENT ON TABLE motos_modelos IS 'Modelos de motos o equipos (taladros, sierras, compresores) para compatibilidad de repuestos.';
CREATE OR REPLACE VIEW equipos_modelos AS SELECT * FROM motos_modelos;

-- -------------------------------------------------------------------
--  2. AGREGAR DIMENSIONES FÍSICAS A PRODUCTOS
-- -------------------------------------------------------------------
ALTER TABLE productos ADD COLUMN IF NOT EXISTS peso_kg NUMERIC(8,3);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS dimensiones_cm VARCHAR(30); -- "30x20x15"

COMMENT ON COLUMN productos.peso_kg IS 'Peso del producto en kilogramos (útil para envíos y cálculo de flete).';
COMMENT ON COLUMN productos.dimensiones_cm IS 'Dimensiones en formato "largo x ancho x alto" en centímetros.';

-- -------------------------------------------------------------------
--  3. ESPECIFICACIONES TÉCNICAS (JSONB FLEXIBLE)
-- -------------------------------------------------------------------
ALTER TABLE productos ADD COLUMN IF NOT EXISTS especificaciones JSONB DEFAULT '{}';

COMMENT ON COLUMN productos.especificaciones IS 'Especificaciones técnicas del producto en formato JSON. Ejemplo: {"voltaje": "120V", "potencia_w": 750, "rpm": 3000, "material": "acero inoxidable", "garantia_meses": 12}';

-- Ejemplo de uso:
-- UPDATE productos 
-- SET especificaciones = '{"voltaje": "120V", "potencia_w": 750, "rpm": 3000}'::jsonb
-- WHERE id = 123;

-- -------------------------------------------------------------------
--  4. CATEGORÍAS DE FERRETERÍA VENEZOLANA
-- -------------------------------------------------------------------
-- Nota: el índice único es expresional (uq_neg_categorias_nombre sobre
-- negocio_id, lower(nombre)); usamos WHERE NOT EXISTS para idempotencia.
INSERT INTO categorias (negocio_id, nombre, margen_pct)
SELECT 1, v.nombre, v.margen_pct
  FROM (VALUES
    ('Herramientas Eléctricas', 35),
    ('Herramientas Manuales', 40),
    ('Tornillería y Fijación', 25),
    ('Fontanería y Plomería', 30),
    ('Electricidad', 32),
    ('Pinturas y Acabados', 38),
    ('Soldadura', 28),
    ('Seguridad Industrial', 45),
    ('Construcción', 22),
    ('Herrería', 30),
    ('Carpintería', 33),
    ('Jardinería', 28),
    ('Adhesivos y Selladores', 42),
    ('Medición y Precisión', 48)
  ) AS v(nombre, margen_pct)
 WHERE NOT EXISTS (
    SELECT 1 FROM categorias c WHERE c.negocio_id = 1 AND lower(c.nombre) = lower(v.nombre)
 );

-- -------------------------------------------------------------------
--  5. NUEVAS UNIDADES DE MEDIDA FERRETERA
-- -------------------------------------------------------------------
-- La PK compuesta creada en 31 es (negocio_id, codigo).
INSERT INTO unidades_medida (negocio_id, codigo, nombre, permite_fraccion) VALUES
    (1, 'PZA', 'Pieza', false),
    (1, 'KIT', 'Kit', false),
    (1, 'ROL', 'Rollo', false),
    (1, 'LAM', 'Lámina', false),
    (1, 'TUB', 'Tubo', false),
    (1, 'PLK', 'Paquete', false),
    (1, 'SAC', 'Saco', false),
    (1, 'BOL', 'Bolsa', false),
    (1, 'VAR', 'Varilla', false),
    (1, 'MTR', 'Metro lineal', true),
    (1, 'M2', 'Metro cuadrado', true),
    (1, 'PUL', 'Pulgada', true)
ON CONFLICT (negocio_id, codigo) DO NOTHING;

-- -------------------------------------------------------------------
--  6. MARCAS DE FERRETERÍA
-- -------------------------------------------------------------------
INSERT INTO marcas (negocio_id, nombre)
SELECT 1, v.nombre
  FROM (VALUES
    ('Bosch'), ('DeWalt'), ('Stanley'), ('Makita'), ('Coro'),
    ('Black+Decker'), ('Truper'), ('Cumberland'), ('Venoco'),
    ('Irwin'), ('Vonder'), ('Eletrônica'), ('Parada')
  ) AS v(nombre)
 WHERE NOT EXISTS (
    SELECT 1 FROM marcas m WHERE m.negocio_id = 1 AND lower(m.nombre) = lower(v.nombre)
 );

-- -------------------------------------------------------------------
--  7. FUNCIÓN: PRODUCTOS CON ESPECIFICACIONES TÉCNICAS
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_productos_con_especificaciones(
    p_categoria_id BIGINT DEFAULT NULL,
    p_busqueda TEXT DEFAULT NULL
)
RETURNS TABLE (
    id BIGINT,
    sku VARCHAR,
    nombre VARCHAR,
    categoria VARCHAR,
    marca VARCHAR,
    precio_usd NUMERIC,
    stock NUMERIC,
    especificaciones JSONB
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    SELECT p.id, p.sku, p.nombre, c.nombre, m.nombre,
           p.precio_venta_usd, p.stock_actual, p.especificaciones
      FROM productos p
      LEFT JOIN categorias c ON c.id = p.categoria_id
      LEFT JOIN marcas m ON m.id = p.marca_id
     WHERE p.activo
       AND (p_categoria_id IS NULL OR p.categoria_id = p_categoria_id)
       AND (p_busqueda IS NULL OR p.nombre ILIKE '%' || p_busqueda || '%')
     ORDER BY p.nombre;
END;
$$;

COMMENT ON FUNCTION fn_productos_con_especificaciones(bigint, text) IS 'Lista productos con sus especificaciones técnicas (ferretería).';

-- -------------------------------------------------------------------
--  8. TRIGGER: VALIDAR ESPECIFICACIONES TÉCNICAS
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_validar_especificaciones() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- Validar que especificaciones sea un JSON válido
    IF NEW.especificaciones IS NOT NULL AND jsonb_typeof(NEW.especificaciones) IS NULL THEN
        RAISE EXCEPTION 'Las especificaciones deben ser un JSON válido' USING ERRCODE = 'TV006';
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_especificaciones ON productos;
CREATE TRIGGER trg_validar_especificaciones 
    BEFORE INSERT OR UPDATE ON productos
    FOR EACH ROW 
    EXECUTE FUNCTION trg_validar_especificaciones();
```

**Casos de uso típicos:**
- Taladro eléctrico: `{"voltaje": "120V", "potencia_w": 750, "rpm": 3000}`
- Sierra circular: `{"voltaje": "120V", "diametro_disco_pulg": 7.25, "rpm": 5800}`
- Soldadora: `{"voltaje": "220V", "amperaje_max": 200, "tipo": "MIG/MAG"}`
- Bomba de agua: `{"potencia_hp": 1, "caudal_lpm": 60, "altura_m": 15}`

---

### 3. TIENDA DE ROPA / BOUTIQUE

**Estado:** Pendiente de implementar

**Archivo SQL:** `database/sql/46_ropa_venezuela.sql`

**Cambios necesarios:**

```sql
-- =============================================================
--  46_ropa_venezuela.sql
--  Módulo vertical para tiendas de ropa y boutiques
-- =============================================================

SET search_path = tienda, public;

-- -------------------------------------------------------------------
--  1. TABLA DE TALLAS
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tallas (
    codigo VARCHAR(10) PRIMARY KEY,
    nombre VARCHAR(30) NOT NULL,
    orden SMALLINT NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE tallas IS 'Catálogo de tallas para ropa. El campo "orden" define el orden de presentación en el POS.';

INSERT INTO tallas (codigo, nombre, orden) VALUES
    -- Tallas estándar
    ('XS', 'Extra Small', 1),
    ('S', 'Small', 2),
    ('M', 'Medium', 3),
    ('L', 'Large', 4),
    ('XL', 'Extra Large', 5),
    ('XXL', 'XX Large', 6),
    ('XXXL', 'XXX Large', 7),
    -- Tallas numéricas (pantalones, zapatos)
    ('26', '26', 10),
    ('28', '28', 11),
    ('30', '30', 12),
    ('32', '32', 13),
    ('34', '34', 14),
    ('36', '36', 15),
    ('38', '38', 16),
    ('40', '40', 17),
    ('42', '42', 18),
    ('44', '44', 19),
    ('46', '46', 20),
    ('48', '48', 21),
    -- Talla única
    ('UNI', 'Única', 99),
    -- Infantil
    ('2A', '2 Años', 30),
    ('4A', '4 Años', 31),
    ('6A', '6 Años', 32),
    ('8A', '8 Años', 33),
    ('10A', '10 Años', 34),
    ('12A', '12 Años', 35)
ON CONFLICT (codigo) DO NOTHING;

-- -------------------------------------------------------------------
--  2. TABLA DE COLORES
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS colores (
    codigo VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(40) NOT NULL
);

COMMENT ON TABLE colores IS 'Catálogo de colores para ropa.';

INSERT INTO colores (codigo, nombre) VALUES
    ('NEGRO', 'Negro'),
    ('BLANCO', 'Blanco'),
    ('AZUL_MARINO', 'Azul Marino'),
    ('AZUL', 'Azul'),
    ('AZUL_CLARO', 'Azul Claro'),
    ('ROJO', 'Rojo'),
    ('ROJO_VINO', 'Rojo Vino'),
    ('VERDE', 'Verde'),
    ('VERDE_MILITAR', 'Verde Militar'),
    ('AMARILLO', 'Amarillo'),
    ('GRIS', 'Gris'),
    ('GRIS_OSCURO', 'Gris Oscuro'),
    ('BEIGE', 'Beige'),
    ('CREMA', 'Crema'),
    ('ROSADO', 'Rosado'),
    ('FUCSIA', 'Fucsia'),
    ('MORADO', 'Morado'),
    ('LILA', 'Lila'),
    ('NARANJA', 'Naranja'),
    ('CAFÉ', 'Café'),
    ('CAFÉ_CLARO', 'Café Claro'),
    ('NEGRO_BLANCO', 'Negro/Blanco'),
    ('ESTAMPADO', 'Estampado'),
    ('CUADROS', 'Cuadros'),
    ('RAYAS', 'Rayas')
ON CONFLICT (codigo) DO NOTHING;

-- -------------------------------------------------------------------
--  3. VARIANTES DE PRODUCTO (TALLA + COLOR)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS producto_variantes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    producto_id BIGINT NOT NULL REFERENCES productos(id),
    talla VARCHAR(10) NOT NULL,
    color VARCHAR(20) NOT NULL,
    codigo_barras VARCHAR(40),
    sku_variante VARCHAR(60),
    stock_actual NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (stock_actual >= 0),
    costo_usd NUMERIC(18,4),
    precio_venta_usd NUMERIC(18,4),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    negocio_id INTEGER NOT NULL REFERENCES negocio(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_variante UNIQUE (negocio_id, producto_id, talla, color)
);

CREATE INDEX ix_variantes_producto ON producto_variantes (producto_id);
CREATE INDEX ix_variantes_barras ON producto_variantes (codigo_barras) WHERE codigo_barras IS NOT NULL;
CREATE INDEX ix_variantes_stock ON producto_variantes (producto_id, stock_actual) WHERE activo;

COMMENT ON TABLE producto_variantes IS 'Variantes de ropa por talla y color. El stock se controla aquí, no en la tabla productos padre.';
COMMENT ON COLUMN producto_variantes.sku_variante IS 'SKU específico de la variante. Ejemplo: CAMISA-001-M-NEGRO';
COMMENT ON COLUMN producto_variantes.costo_usd IS 'Costo específico de la variante (puede diferir del producto padre). NULL = usa el del padre.';

-- -------------------------------------------------------------------
--  4. NOTA DE ARQUITECTURA: STOCK EN PRODUCTO PADRE VS. VARIANTES
-- -------------------------------------------------------------------
-- IMPORTANTE: En este sistema (03_triggers.sql:140 y 392):
--   a) trg_productos_antes() BLOQUEA cualquier UPDATE directo de
--      productos.stock_actual salvo que venga del kardex (tienda.mov_stock = '1').
--   b) Al insertar en detalle_venta, trg_detalle_venta_despues() inserta en
--      movimientos_inventario, lo que YA descuenta el stock_actual del padre.
-- Por eso NO debe existir un trigger en producto_variantes que haga
-- UPDATE productos SET stock_actual = SUM(...), porque chocará con el kardex
-- o descontará dos veces al vender. El stock total se mueve por el kardex
-- (sp_ajustar_stock / compras / ventas) y producto_variantes lleva solo el
-- desglose por talla/color.

-- -------------------------------------------------------------------
--  5. AJUSTAR DETALLE DE VENTA PARA VARIANTES
-- -------------------------------------------------------------------
ALTER TABLE detalle_venta ADD COLUMN IF NOT EXISTS variante_id BIGINT REFERENCES producto_variantes(id);

COMMENT ON COLUMN detalle_venta.variante_id IS 'Para ropa: referencia a la variante talla+color específica vendida. NULL para productos sin variantes.';

-- -------------------------------------------------------------------
--  6. TRIGGER: VENTA DE VARIANTE ACTUALIZA SU STOCK
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_venta_variante() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.variante_id IS NOT NULL THEN
        UPDATE producto_variantes
           SET stock_actual = stock_actual - NEW.cantidad,
               updated_at = now()
         WHERE id = NEW.variante_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_venta_variante ON detalle_venta;
CREATE TRIGGER trg_venta_variante 
    AFTER INSERT ON detalle_venta
    FOR EACH ROW 
    EXECUTE FUNCTION trg_venta_variante();

-- -------------------------------------------------------------------
--  7. CATEGORÍAS DE ROPA VENEZOLANA
-- -------------------------------------------------------------------
INSERT INTO categorias (negocio_id, nombre, margen_pct)
SELECT 1, v.nombre, v.margen_pct
  FROM (VALUES
    ('Camisas', 50),
    ('Pantalones', 45),
    ('Vestidos', 55),
    ('Shorts', 48),
    ('Trajes de Baño', 60),
    ('Ropa Interior', 35),
    ('Zapatos', 40),
    ('Bolsos', 55),
    ('Accesorios', 65),
    ('Ropa Deportiva', 48),
    ('Uniformes Escolares', 30),
    ('Uniformes Corporativos', 35),
    ('Jeans', 42),
    ('Franelas', 52),
    ('Blusas', 53),
    ('Faldas', 50),
    ('Trajes', 70),
    ('Ropa de Bebé', 45)
  ) AS v(nombre, margen_pct)
 WHERE NOT EXISTS (
    SELECT 1 FROM categorias c WHERE c.negocio_id = 1 AND lower(c.nombre) = lower(v.nombre)
 );

-- -------------------------------------------------------------------
--  8. TEMPORADAS
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS temporadas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(40) NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    negocio_id INTEGER NOT NULL DEFAULT 1 REFERENCES negocio(id),
    CONSTRAINT ck_temporada_fechas CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX ix_temporadas_activas ON temporadas (negocio_id, fecha_inicio, fecha_fin) WHERE activa;

COMMENT ON TABLE temporadas IS 'Temporadas de ropa: Verano, Invierno, Escolar, Navideña, Black Friday, etc.';

INSERT INTO temporadas (nombre, fecha_inicio, fecha_fin, negocio_id) VALUES
    ('Temporada Escolar 2026', '2026-09-01', '2026-10-15', 1),
    ('Navidad 2026', '2026-11-15', '2026-12-31', 1),
    ('Verano 2027', '2027-03-01', '2027-05-31', 1)
ON CONFLICT DO NOTHING;

-- -------------------------------------------------------------------
--  9. VISTA PARA EL POS: PRODUCTOS CON VARIANTES
-- -------------------------------------------------------------------
CREATE OR REPLACE VIEW v_productos_ropa AS
SELECT p.id AS producto_id, 
       p.sku, 
       p.nombre, 
       p.categoria_id, 
       c.nombre AS categoria,
       v.id AS variante_id, 
       v.talla, 
       v.color, 
       v.codigo_barras, 
       v.sku_variante,
       COALESCE(v.precio_venta_usd, p.precio_venta_usd) AS precio_usd,
       v.stock_actual AS stock_variante,
       CASE WHEN v.id IS NULL THEN p.stock_actual ELSE v.stock_actual END AS stock_disponible
  FROM productos p
  LEFT JOIN producto_variantes v ON v.producto_id = p.id AND v.activo
  LEFT JOIN categorias c ON c.id = p.categoria_id
 WHERE p.activo
 ORDER BY p.nombre, v.talla, v.color;

COMMENT ON VIEW v_productos_ropa IS 'Vista para el POS de ropa: muestra cada variante (talla+color) como una línea seleccionable.';

-- -------------------------------------------------------------------
--  10. FUNCIÓN: CREAR VARIANTE AUTOMÁTICAMENTE
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_crear_variantes_producto(
    p_producto_id BIGINT,
    p_tallas TEXT[],
    p_colores TEXT[],
    p_precio_base_usd NUMERIC DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
    t TEXT;
    c TEXT;
    contador INTEGER := 0;
    precio NUMERIC;
BEGIN
    -- Obtener precio base
    SELECT COALESCE(p_precio_base_usd, precio_venta_usd) INTO precio
      FROM productos WHERE id = p_producto_id;
    
    IF precio IS NULL THEN
        RAISE EXCEPTION 'El producto no tiene precio de venta' USING ERRCODE = 'TV006';
    END IF;
    
    -- Crear combinaciones talla × color
    FOREACH t IN ARRAY p_tallas LOOP
        FOREACH c IN ARRAY p_colores LOOP
            INSERT INTO producto_variantes (producto_id, talla, color, precio_venta_usd, negocio_id)
            VALUES (p_producto_id, t, c, precio, fn_negocio_actual())
            ON CONFLICT (negocio_id, producto_id, talla, color) DO NOTHING;
            
            contador := contador + 1;
        END LOOP;
    END LOOP;
    
    RETURN contador;
END;
$$;

COMMENT ON FUNCTION fn_crear_variantes_producto(bigint, text[], text[], numeric) IS 'Crea automáticamente todas las combinaciones talla×color para un producto. Devuelve el número de variantes creadas.';

-- Ejemplo de uso:
-- SELECT fn_crear_variantes_producto(123, ARRAY['S','M','L','XL'], ARRAY['NEGRO','AZUL_MARINO','BLANCO'], 25.00);

-- -------------------------------------------------------------------
--  11. FUNCIÓN: REPORTE DE VENTAS POR TALLA
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_ventas_por_talla(
    p_desde DATE,
    p_hasta DATE,
    p_categoria_id BIGINT DEFAULT NULL
)
RETURNS TABLE (
    talla VARCHAR,
    unidades_vendidas NUMERIC,
    ingreso_usd NUMERIC,
    porcentaje NUMERIC
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    WITH por_talla AS (
        SELECT pv.talla AS talla_cod,
               SUM(d.cantidad) AS unidades,
               SUM(d.total_usd) AS ingreso
          FROM detalle_venta d
          JOIN ventas v ON v.id = d.venta_id AND v.estado = 'COMPLETADA'
                       AND v.fecha_valor BETWEEN p_desde AND p_hasta
          JOIN producto_variantes pv ON pv.id = d.variante_id
          LEFT JOIN productos p ON p.id = d.producto_id
         WHERE d.variante_id IS NOT NULL
           AND (p_categoria_id IS NULL OR p.categoria_id = p_categoria_id)
         GROUP BY pv.talla
    )
    SELECT pt.talla_cod,
           pt.unidades,
           pt.ingreso,
           ROUND(100.0 * pt.unidades / NULLIF(SUM(pt.unidades) OVER (), 0), 2) AS pct
      FROM por_talla pt
     ORDER BY pt.unidades DESC;
END;
$$;

COMMENT ON FUNCTION fn_ventas_por_talla(date, date, bigint) IS 'Reporte de ventas desglosado por talla. Útil para identificar qué tallas se venden más.';
```

**Casos de uso típicos:**

1. **Crear un producto con variantes:**
```sql
-- Crear el producto padre
INSERT INTO productos (sku, nombre, categoria_id, precio_venta_usd)
VALUES ('CAMISA-001', 'Camisa Oxford', 1, 35.00);

-- Crear variantes automáticamente
SELECT fn_crear_variantes_producto(
    (SELECT id FROM productos WHERE sku = 'CAMISA-001'),
    ARRAY['S','M','L','XL'],
    ARRAY['NEGRO','BLANCO','AZUL_MARINO']
);
-- Crea 12 variantes (4 tallas × 3 colores)
```

2. **Vender una variante específica:**
```sql
-- El POS muestra la vista v_productos_ropa
-- El cliente selecciona: Camisa Oxford - M - NEGRO
-- El sistema registra la venta con variante_id específico
```

---

### 4. BODEGA / ABARROTES

**Estado:** Pendiente de implementar

**Archivo SQL:** `database/sql/45_bodega_venezuela.sql`

**Cambios necesarios:**

```sql
-- =============================================================
--  45_bodega_venezuela.sql
--  Módulo vertical para bodegas y abarrotes
-- =============================================================

SET search_path = tienda, public;

-- -------------------------------------------------------------------
--  1. CONTROL DE LOTES Y CADUCIDAD
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS producto_lotes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    producto_id BIGINT NOT NULL REFERENCES productos(id),
    lote VARCHAR(60) NOT NULL,
    fecha_elaboracion DATE,
    fecha_caducidad DATE NOT NULL,
    cantidad NUMERIC(14,3) NOT NULL CHECK (cantidad >= 0),
    costo_unitario_usd NUMERIC(18,4),
    ubicacion VARCHAR(40),
    proveedor_id BIGINT REFERENCES proveedores(id),
    negocio_id INTEGER NOT NULL REFERENCES negocio(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_lote UNIQUE (negocio_id, producto_id, lote, fecha_caducidad)
);

CREATE INDEX ix_lotes_producto ON producto_lotes (producto_id);
CREATE INDEX ix_lotes_caducidad ON producto_lotes (fecha_caducidad) WHERE cantidad > 0;
CREATE INDEX ix_lotes_ubicacion ON producto_lotes (ubicacion) WHERE ubicacion IS NOT NULL;

COMMENT ON TABLE producto_lotes IS 'Control de lotes y caducidad para productos perecederos. El sistema usa FIFO automático por fecha de caducidad al vender.';
COMMENT ON COLUMN producto_lotes.lote IS 'Número de lote del proveedor. Puede repetirse entre productos.';
COMMENT ON COLUMN producto_lotes.fecha_caducidad IS 'Fecha de vencimiento del lote. Obligatoria para productos perecederos.';
COMMENT ON COLUMN producto_lotes.ubicacion IS 'Ubicación física en el almacén (estante, pasillo, nevera, etc.).';

-- -------------------------------------------------------------------
--  2. ALERTA DE PRODUCTOS PRÓXIMOS A CADUCAR
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_productos_a_caducar(
    p_dias INTEGER DEFAULT 30,
    p_negocio_id INTEGER DEFAULT NULL
)
RETURNS TABLE (
    producto_id BIGINT,
    producto VARCHAR,
    lote VARCHAR,
    fecha_caducidad DATE,
    dias_restantes INTEGER,
    cantidad NUMERIC,
    valor_usd NUMERIC,
    ubicacion VARCHAR
)
LANGUAGE sql STABLE AS $$
    SELECT pl.producto_id, 
           p.nombre, 
           pl.lote,
           pl.fecha_caducidad,
           (pl.fecha_caducidad - fn_hoy())::INTEGER,
           pl.cantidad,
           ROUND(pl.cantidad * COALESCE(pl.costo_unitario_usd, p.costo_usd), 2),
           pl.ubicacion
      FROM producto_lotes pl
      JOIN productos p ON p.id = pl.producto_id
     WHERE pl.fecha_caducidad <= fn_hoy() + p_dias
       AND pl.cantidad > 0
       AND (p_negocio_id IS NULL OR pl.negocio_id = p_negocio_id)
     ORDER BY pl.fecha_caducidad, pl.cantidad DESC;
$$;

COMMENT ON FUNCTION fn_productos_a_caducar(integer, integer) IS 'Lista productos que caducan en los próximos N días. Ordenado por urgencia.';

-- -------------------------------------------------------------------
--  3. TRIGGER: VENTA CON FIFO POR FECHA DE CADUCIDAD
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_venta_fifo_caducidad() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    lote record;
    cantidad_pendiente NUMERIC := NEW.cantidad;
    cantidad_a_descontar NUMERIC;
BEGIN
    -- Solo para productos con control de lotes
    IF EXISTS (SELECT 1 FROM producto_lotes WHERE producto_id = NEW.producto_id AND cantidad > 0) THEN
        
        -- Procesar lotes en orden FIFO (más próximo a caducar primero)
        FOR lote IN 
            SELECT id, lote, cantidad, costo_unitario_usd
              FROM producto_lotes
             WHERE producto_id = NEW.producto_id 
               AND cantidad > 0
             ORDER BY fecha_caducidad ASC
             FOR UPDATE
        LOOP
            IF cantidad_pendiente <= 0 THEN
                EXIT;
            END IF;
            
            -- Calcular cuánto tomar de este lote
            cantidad_a_descontar := LEAST(lote.cantidad, cantidad_pendiente);
            
            -- Descontar del lote
            UPDATE producto_lotes
               SET cantidad = cantidad - cantidad_a_descontar
             WHERE id = lote.id;
            
            -- Registrar el costo del lote (para Kardex y costo de ventas)
            IF cantidad_pendiente = NEW.cantidad THEN
                -- Primera iteración: usar el costo del primer lote
                NEW.costo_unitario_usd := lote.costo_unitario_usd;
            END IF;
            
            cantidad_pendiente := cantidad_pendiente - cantidad_a_descontar;
        END LOOP;
        
        -- Si no alcanzó el stock de todos los lotes
        IF cantidad_pendiente > 0 THEN
            RAISE EXCEPTION 'Stock insuficiente en lotes para el producto %. Faltan % unidades', 
                NEW.producto_id, cantidad_pendiente USING ERRCODE = 'TV003';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_venta_fifo_caducidad ON detalle_venta;
CREATE TRIGGER trg_venta_fifo_caducidad
    BEFORE INSERT ON detalle_venta
    FOR EACH ROW
    EXECUTE FUNCTION trg_venta_fifo_caducidad();

-- -------------------------------------------------------------------
--  4. MARCAR PRODUCTO COMO PERECEDERO
-- -------------------------------------------------------------------
ALTER TABLE productos ADD COLUMN IF NOT EXISTS es_perecedero BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS dias_vida_util INTEGER;

COMMENT ON COLUMN productos.es_perecedero IS 'TRUE para productos que caducan (alimentos, medicinas, cosméticos). Activa el control de lotes.';
COMMENT ON COLUMN productos.dias_vida_util IS 'Días de vida útil típicos del producto. Útil para alertas proactivas.';

-- -------------------------------------------------------------------
--  5. CATEGORÍAS DE BODEGA VENEZOLANA
-- -------------------------------------------------------------------
INSERT INTO categorias (negocio_id, nombre, margen_pct)
SELECT 1, v.nombre, v.margen_pct
  FROM (VALUES
    ('Abarrotes', 20),
    ('Arroz y Pastas', 18),
    ('Harinas y Cereales', 22),
    ('Aceites y Grasas', 25),
    ('Lácteos y Derivados', 15),
    ('Bebidas No Alcohólicas', 28),
    ('Bebidas Alcohólicas', 35),
    ('Limpieza del Hogar', 30),
    ('Higiene Personal', 32),
    ('Charcutería y Embutidos', 18),
    ('Carnes y Pollo', 12),
    ('Frutas y Verduras', 10),
    ('Condimentos y Especias', 35),
    ('Conservas y Enlatados', 25),
    ('Confitería y Dulces', 38),
    ('Helados', 22),
    ('Panadería', 15),
    ('Mascotas', 28)
  ) AS v(nombre, margen_pct)
 WHERE NOT EXISTS (
    SELECT 1 FROM categorias c WHERE c.negocio_id = 1 AND lower(c.nombre) = lower(v.nombre)
 );

-- -------------------------------------------------------------------
--  6. MARCAS DE BODEGA VENEZOLANA
-- -------------------------------------------------------------------
INSERT INTO marcas (negocio_id, nombre)
SELECT 1, v.nombre
  FROM (VALUES
    ('Empresas Polar'),
    ('Alimentos Mary'),
    ('Mavesa'),
    ('Ron Santa Teresa'),
    ('Cervecería Regional'),
    ('Cervecería Polar'),
    ('PepsiCo Venezuela'),
    ('Coca-Cola FEMSA'),
    ('Nestlé Venezuela'),
    ('Alimentos Heinz'),
    ('Fábrica de Galletas La Comercial'),
    ('Manapa'),
    ('Venoco'),
    ('Lácteos Los Andes'),
    ('Inlaca'),
    ('Planta'),
    ('Rikesa'),
    ('Alimentos Capri'),
    ('Venevizia')
  ) AS v(nombre)
 WHERE NOT EXISTS (
    SELECT 1 FROM marcas m WHERE m.negocio_id = 1 AND lower(m.nombre) = lower(v.nombre)
 );

-- -------------------------------------------------------------------
--  7. FUNCIÓN: RECIBIR COMPRA CON LOTES
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_recibir_compra_con_lotes(
    p_compra_id BIGINT,
    p_lotes JSONB  -- [{"producto_id": 1, "lote": "L001", "fecha_caducidad": "2026-12-31", "ubicacion": "A-01"}]
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    l record;
BEGIN
    FOR l IN SELECT * FROM jsonb_to_recordset(p_lotes) AS x(
        producto_id BIGINT,
        lote VARCHAR,
        fecha_caducidad DATE,
        ubicacion VARCHAR
    ) LOOP
        -- Obtener cantidad y costo del detalle de compra
        INSERT INTO producto_lotes (producto_id, lote, fecha_caducidad, cantidad, costo_unitario_usd, ubicacion, negocio_id)
        SELECT cd.producto_id, l.lote, l.fecha_caducidad, cd.cantidad, cd.costo_unitario_usd, l.ubicacion, fn_negocio_actual()
          FROM compra_detalle cd
         WHERE cd.compra_id = p_compra_id AND cd.producto_id = l.producto_id
        ON CONFLICT (negocio_id, producto_id, lote, fecha_caducidad) 
        DO UPDATE SET cantidad = producto_lotes.cantidad + EXCLUDED.cantidad;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION fn_recibir_compra_con_lotes(bigint, jsonb) IS 'Registra lotes al recibir una compra. Se llama después de registrar la compra normal.';

-- -------------------------------------------------------------------
--  8. VISTA: STOCK POR LOTE
-- -------------------------------------------------------------------
CREATE OR REPLACE VIEW v_stock_por_lote AS
SELECT p.id AS producto_id,
       p.sku,
       p.nombre,
       p.categoria_id,
       c.nombre AS categoria,
       pl.id AS lote_id,
       pl.lote,
       pl.fecha_caducidad,
       pl.cantidad AS stock_lote,
       (pl.fecha_caducidad - fn_hoy())::INTEGER AS dias_para_caducar,
       pl.ubicacion,
       CASE 
           WHEN pl.fecha_caducidad < fn_hoy() THEN 'CADUCADO'
           WHEN pl.fecha_caducidad <= fn_hoy() + 7 THEN 'URGENTE'
           WHEN pl.fecha_caducidad <= fn_hoy() + 30 THEN 'PRÓXIMO'
           ELSE 'OK'
       END AS estado_caducidad
  FROM productos p
  JOIN producto_lotes pl ON pl.producto_id = p.id
  LEFT JOIN categorias c ON c.id = p.categoria_id
 WHERE pl.cantidad > 0
 ORDER BY pl.fecha_caducidad;

COMMENT ON VIEW v_stock_por_lote IS 'Stock desglosado por lote con estado de caducidad.';

-- -------------------------------------------------------------------
--  9. REPORTES DE BODEGA
-- -------------------------------------------------------------------

-- Reporte: Productos caducados
CREATE OR REPLACE VIEW v_productos_caducados AS
SELECT p.id, p.sku, p.nombre, pl.lote, pl.fecha_caducidad, 
       pl.cantidad, pl.ubicacion,
       ROUND(pl.cantidad * p.costo_usd, 2) AS valor_perdido_usd
  FROM producto_lotes pl
  JOIN productos p ON p.id = pl.producto_id
 WHERE pl.fecha_caducidad < fn_hoy()
   AND pl.cantidad > 0
 ORDER BY pl.fecha_caducidad;

COMMENT ON VIEW v_productos_caducados IS 'Productos ya caducados que aún están en inventario. Deben darse de baja.';

-- Reporte: Rotación por lote
CREATE OR REPLACE FUNCTION fn_rotacion_por_lote(
    p_meses INTEGER DEFAULT 3
)
RETURNS TABLE (
    producto_id BIGINT,
    producto VARCHAR,
    lote VARCHAR,
    stock_inicial NUMERIC,
    ventas NUMERIC,
    rotacion NUMERIC
)
LANGUAGE sql STABLE AS $$
    WITH ventas_lote AS (
        -- Aproximación: ventas totales del producto divididas entre lotes activos
        SELECT d.producto_id, SUM(d.cantidad) AS total_vendido
          FROM detalle_venta d
          JOIN ventas v ON v.id = d.venta_id 
                        AND v.estado = 'COMPLETADA'
                        AND v.fecha_valor >= fn_hoy() - (p_meses || ' months')::interval
         WHERE EXISTS (SELECT 1 FROM producto_lotes WHERE producto_id = d.producto_id)
         GROUP BY d.producto_id
    )
    SELECT pl.producto_id,
           p.nombre,
           pl.lote,
           pl.cantidad AS stock_inicial,
           COALESCE(vl.total_vendido / NULLIF((SELECT COUNT(*) FROM producto_lotes pl2 WHERE pl2.producto_id = pl.producto_id), 0), 0) AS ventas,
           CASE WHEN pl.cantidad > 0 
                THEN COALESCE(vl.total_vendido / NULLIF((SELECT COUNT(*) FROM producto_lotes pl2 WHERE pl2.producto_id = pl.producto_id), 0), 0) / pl.cantidad 
                END AS rotacion
      FROM producto_lotes pl
      JOIN productos p ON p.id = pl.producto_id
      LEFT JOIN ventas_lote vl ON vl.producto_id = pl.producto_id
     WHERE pl.cantidad > 0
     ORDER BY rotacion DESC;
$$;
```

**Casos de uso típicos:**

1. **Recibir una compra con lotes:**
```sql
-- 1. Registrar la compra normalmente
SELECT fn_registrar_compra(proveedor_id, 'FAC-001', '2026-11-15', 'USD', 
    '[{"producto_id": 1, "cantidad": 100, "costo_unitario": 2.50}]'::jsonb,
    usuario_id);

-- 2. Registrar los lotes
SELECT fn_recibir_compra_con_lotes(123, 
    '[{"producto_id": 1, "lote": "L2026-001", "fecha_caducidad": "2027-06-30", "ubicacion": "A-01"}]'::jsonb);
```

2. **Ver productos a caducar:**
```sql
SELECT * FROM fn_productos_a_caducar(30);
-- Muestra productos que caducan en los próximos 30 días
```

3. **Ver productos caducados:**
```sql
SELECT * FROM v_productos_caducados;
-- Lista productos que ya pasaron su fecha de caducidad
```

---

## 🏗️ Arquitectura Multi-tenant Actual

### Componentes del Sistema Multi-tenant

```
┌─────────────────────────────────────────────────────────────┐
│                    PORTAL CENTRAL (portal_saas)              │
│  ┌───────────┬───────────┬───────────┬───────────┐         │
│  │  planes   │  cobros   │ eventos   │ cartera   │         │
│  │  BASE     │  PayPal   │  portal   │  MRR      │         │
│  │  PRÁCTICA │  Banesco  │           │           │         │
│  │  PRO      │  USD      │           │           │         │
│  └───────────┴───────────┴───────────┴───────────┘         │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ propagador (cron cada 5 min)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   BASE DE TENANT (tienda)                    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │          TABLAS CON negocio_id (67 tablas)           │   │
│  │                                                       │   │
│  │  negocio_id INTEGER NOT NULL REFERENCES negocio(id)  │   │
│  │  + Índice: ix_[tabla]_negocio                        │   │
│  │  + RLS: p_tenant policy                              │   │
│  │  + Trigger: trg_sello_negocio                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           CONTROL DE TENANT                          │   │
│  │                                                       │   │
│  │  estado_tenants (                                    │   │
│  │    negocio_id INTEGER,                               │   │
│  │    subdominio TEXT UNIQUE,                           │   │
│  │    activo BOOLEAN,                                   │   │
│  │    plan TEXT,                                        │   │
│  │    modulos JSONB  -- {"fiscal": true, "ropa": false} │   │
│  │  )                                                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           FUNCIONES DE SESIÓN                        │   │
│  │                                                       │   │
│  │  fn_negocio_actual()                                 │   │
│  │    → Lee GUC app.negocio_id                          │   │
│  │    → Devuelve 1 si no está fijado                    │   │
│  │                                                       │   │
│  │  fn_sesion_permitida()                               │   │
│  │    → Verifica GUC fijado                             │   │
│  │    → Verifica tenant activo                          │   │
│  │    → TRUE = acceso permitido                         │   │
│  │                                                       │   │
│  │  fn_negocio_modulo(codigo)                           │   │
│  │    → Lee estado_tenants.modulos                      │   │
│  │    → TRUE si el módulo está activo                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           ROW-LEVEL SECURITY (RLS)                   │   │
│  │                                                       │   │
│  │  ALTER TABLE [tabla] ENABLE ROW LEVEL SECURITY;      │   │
│  │  ALTER TABLE [tabla] FORCE ROW LEVEL SECURITY;       │   │
│  │                                                       │   │
│  │  CREATE POLICY p_tenant ON [tabla]                   │   │
│  │    USING (negocio_id = fn_negocio_actual()           │   │
│  │           AND (SELECT fn_sesion_permitida()))        │   │
│  │    WITH CHECK (negocio_id = fn_negocio_actual()      │   │
│  │                AND (SELECT fn_sesion_permitida()));  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           ROL DE APLICACIÓN                          │   │
│  │                                                       │   │
│  │  CREATE ROLE saas_app NOLOGIN;                       │   │
│  │  GRANT SELECT, INSERT, UPDATE, DELETE                │   │
│  │    ON ALL TABLES IN SCHEMA tienda TO saas_app;       │   │
│  │                                                       │   │
│  │  -- Producción conecta como saas_app (NO superuser)  │   │
│  │  -- RLS solo protege a roles no superusuario         │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Flujo de una Petición HTTP (Multi-tenant)

```
Usuario accede a: la-cava.misitiolibre.com
                              │
                              ▼
                    ┌─────────────────┐
                    │   Nginx/Apache  │
                    │   (reverse)     │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │    Laravel      │
                    │   Request       │
                    └─────────────────┘
                              │
                              ▼
         ┌────────────────────────────────────┐
         │  Middleware: IdentificarTenant     │
         │                                     │
         │  1. Extraer subdominio: "la-cava"  │
         │  2. Buscar en estado_tenants       │
         │  3. Verificar activo = true        │
         │  4. Fijar GUC:                     │
         │     SELECT set_config(             │
         │       'app.negocio_id', '5', false │
         │     );                             │
         └────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Controlador    │
                    │  (ej: Ventas)   │
                    └─────────────────┘
                              │
                              ▼
         ┌────────────────────────────────────┐
         │  PostgreSQL (conexión saas_app)    │
         │                                     │
         │  SELECT * FROM productos           │
         │  WHERE sku = 'BUJIA-001';          │
         │                                     │
         │  -- RLS añade automáticamente:    │
         │  -- WHERE negocio_id = 5           │
         │  --   AND fn_sesion_permitida()    │
         └────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   Solo datos    │
                    │   del tenant 5  │
                    └─────────────────┘
```

### Archivos PHP y Frontend del Sistema Multi-tenant

| Archivo | Propósito |
|---------|-----------|
| `app/Http/Middleware/IdentificarTenant.php` | Resuelve subdominio y fija GUC |
| `app/Support/Tenant.php` | Clase estática para acceder al tenant actual |
| `app/Support/Portal.php` | Comunicación con el portal central |
| `app/Support/PortalConsultas.php` | Consultas del panel admin del portal |
| `app/Support/Propagador.php` | Propaga cambios de estado desde el portal |
| `app/Http/Middleware/PortalAdmin.php` | Autenticación del panel del portal |
| `app/Http/Controllers/Portal/PortalAdminController.php` | Panel `/portal` del super administrador |
| `app/Http/Controllers/Auth/CrearCuentaController.php` | Alta self-service `/crear-cuenta` |
| `app/Http/Controllers/SuscripcionController.php` | Gestión de suscripciones `/suscripcion` |
| `app/Providers/AppServiceProvider.php` | Guardia A-3 (`guardarSuperusuario`) y rate limiter `portal_escritura` |
| `routes/web.php` | Rutas `/crear-cuenta`, `/suscripcion`, `/precios`, `/portal/*` y `/health/db` |
| `routes/console.php` | Comandos `portal:propagar` e `islr:alertas` (que lee `estado_tenants`) |
| `config/database.php` | Conexiones `pgsql_admin` y `portal` |
| `config/saas.php` | Configuración del dominio base y portal |
| `resources/js/Layouts/AppLayout.jsx` | Enlace `/suscripcion` en el menú lateral |
| `resources/js/Pages/Portal/*`, `Suscripcion/Index.jsx`, `Precios.jsx`, `Auth/CrearCuenta.jsx` | Vistas de Inertia exclusivas del SaaS/portal |
| `scripts/infra/setup_db.py` y `.github/workflows/ci.yml` | Orquestador de instalación de bases y pipeline de CI |

---

## 🔄 Plan de Conversión a Tienda Única

### Principio Rector

**Mantener `negocio_id = 1` con `DEFAULT 1` (o triggers de sello) y simplificar su uso:**

- `negocio_id` siempre será `1` (con `DEFAULT 1` en las columnas para que los `DB::table(...)->insert(...)` directos de Laravel sigan funcionando sin enviar `negocio_id`)
- Eliminar RLS y políticas `p_tenant`
- Eliminar la base y archivos del portal (`portal_saas`)
- Simplificar funciones de sesión (`fn_negocio_actual() → 1`, `fn_sesion_permitida() → true`, `fn_puede_editar_global() → true`)
- Desactivar la guardia `guardarSuperusuario()` en `AppServiceProvider.php` para que producción pueda conectar sin el rol `saas_app`
- Preservar toda la funcionalidad del ERP y la capacidad de expansión vertical

### Cambios Requeridos

| Componente | Acción | Complejidad |
|------------|--------|-------------|
| `31_multitenant.sql` | Simplificar → `31_tienda_unica.sql` (con `DEFAULT 1`, `REASSIGN/DROP OWNED` antes de borrar `saas_app` y `DO $$` para `RAISE NOTICE`) | Media |
| `33_portal.sql`, `34_portal_pagos.sql`, `35_provisionar.sql`, `40_ciclo_cobro.sql`, `42_portal_rol.sql`, `43_plataforma_admin.sql` | Eliminar | — |
| `36_islr_declaracion.sql`, `38_presentaciones_venta.sql` | Quitar bloque final de RLS / `p_tenant` (para instalaciones desde cero) | Fácil |
| `41_endurecimiento_seguridad.sql` | Simplificar `fn_puede_editar_global() → true` y quitar referencias a `estado_tenants` / `saas_app` | Fácil |
| `IdentificarTenant.php` y `Tenant.php` | Simplificar (`id() → 1`, `modulo() → true`, `fiscal() → true`, `editarGlobal() → true`) | Fácil |
| `AppServiceProvider.php` | Quitar listener `guardarSuperusuario()` y rate limiter `portal_escritura` | Fácil |
| `routes/web.php` | Quitar rutas `/crear-cuenta`, `/suscripcion`, `/precios`, `/portal/*` y el fallo 500 por superusuario en `/health/db` | Fácil |
| `routes/console.php` | Eliminar `portal:propagar` y ajustar `islr:alertas` para consultar `negocio_id = 1` sin `estado_tenants` | Fácil |
| `Portal.php`, `PortalConsultas.php`, `Propagador.php`, `PortalAdmin.php`, `PortalAdminController.php`, `CrearCuentaController.php`, `SuscripcionController.php`, `config/saas.php` | Eliminar | — |
| `config/database.php` y `.env` | Quitar conexión `portal` y variables `SAAS_*` / `PORTAL_*` / `DB_ADMIN_*` | Fácil |
| `resources/js/Layouts/AppLayout.jsx` y páginas SaaS | Quitar ítem `/suscripcion` del menú y eliminar páginas `Portal/*`, `Suscripcion/*`, `Precios.jsx`, `Auth/CrearCuenta.jsx` | Fácil |
| `scripts/infra/setup_db.py`, `.github/workflows/ci.yml` y tests multi-tenant/portal | Actualizar lista de SQL y retirar suites exclusivas de multi-tenant/portal | Media |

---

## 🗄️ Cambios en Base de Datos (SQL)

### Archivo: `database/sql/31_tienda_unica.sql`

Crear este nuevo archivo que reemplaza a `31_multitenant.sql` (o se aplica sobre una base `tienda` ya instalada con los scripts 01–43):

```sql
-- =============================================================
--  31_tienda_unica.sql
--  Convierte el sistema multi-tenant en tienda única
-- =============================================================
--  Este archivo puede ejecutarse sobre una base tienda ya instalada:
--     psql -U postgres -d tienda -v ON_ERROR_STOP=1 -f database/sql/31_tienda_unica.sql
--
--  Qué hace:
--   · fn_negocio_actual() siempre devuelve 1
--   · fn_sesion_permitida() y fn_puede_editar_global() siempre devuelven true
--   · Pone DEFAULT 1 en todas las columnas negocio_id y conserva trg_sello_negocio
--     (CRÍTICO: CategoriasController, MarcasController, ModelosController,
--      MetodosPagoController, ProductosController, CierreCajaController y
--      trg_productos_despues hacen INSERT sin negocio_id explícito)
--   · Desactiva RLS en las tablas de negocio Y en tienda.negocio
--   · Elimina estado_tenants, plataforma_admin y plataforma_roles
--   · Limpia privilegios (DROP OWNED) antes de eliminar el rol saas_app
-- =============================================================

SET search_path = tienda, public;

-- -------------------------------------------------------------------
--  1. FUNCIONES DE SESIÓN Y GUARDIA SIMPLIFICADAS
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_negocio_actual() RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT 1
$$;
COMMENT ON FUNCTION fn_negocio_actual() IS 'Tienda única: siempre devuelve 1. La sesión no necesita declarar negocio_id.';

CREATE OR REPLACE FUNCTION fn_sesion_permitida() RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT true
$$;
COMMENT ON FUNCTION fn_sesion_permitida() IS 'Tienda única: sin control de suspensión por mora. Siempre permite acceso.';

CREATE OR REPLACE FUNCTION fn_negocio_modulo(p_codigo text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT true
$$;
COMMENT ON FUNCTION fn_negocio_modulo(text) IS 'Tienda única: todos los módulos activos por defecto (fiscal, repuestos, etc.).';

-- Guardia creada en 41/43 usada por sp_registrar_tasa, sp_cambiar_alicuota,
-- sp_cancelar_alicuota, fn_islr_guardar_ut, sp_alta_moneda y sp_moneda_activa:
CREATE OR REPLACE FUNCTION tienda.fn_puede_editar_global() RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT true
$$;
COMMENT ON FUNCTION tienda.fn_puede_editar_global() IS 'Tienda única: la tienda administra directamente sus tasas, alícuotas, UT y monedas.';

-- -------------------------------------------------------------------
--  2. GARANTIZAR DEFAULT 1 EN TODAS LAS COLUMNAS negocio_id
-- -------------------------------------------------------------------
-- CRÍTICO: varios controladores Laravel (Categorías, Marcas, Modelos,
-- Métodos de pago, Productos, Cierres de caja) y triggers internos
-- (historial_precios / historial_costos) insertan filas sin especificar
-- negocio_id. Con DEFAULT 1 + fn_sello_negocio() nunca fallan por NOT NULL.
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT table_name FROM information_schema.columns
              WHERE table_schema = 'tienda' AND column_name = 'negocio_id'
              ORDER BY table_name LOOP
        EXECUTE format('ALTER TABLE tienda.%I ALTER COLUMN negocio_id SET DEFAULT 1', t);
    END LOOP;
    RAISE NOTICE 'DEFAULT 1 configurado en todas las columnas negocio_id';
END $$;

-- -------------------------------------------------------------------
--  3. DESACTIVAR ROW-LEVEL SECURITY (INCLUYENDO tienda.negocio)
-- -------------------------------------------------------------------
-- Nota: tienda.negocio tiene su clave primaria en "id" (no tiene columna
-- negocio_id), pero 31_multitenant.sql también le activó ENABLE/FORCE RLS.
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables
              WHERE schemaname = 'tienda'
              ORDER BY tablename LOOP
        EXECUTE format('ALTER TABLE tienda.%I DISABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE tienda.%I NO FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS p_tenant ON tienda.%I', t);
    END LOOP;
    RAISE NOTICE 'RLS y políticas p_tenant desactivados en todo el esquema tienda';
END $$;

-- -------------------------------------------------------------------
--  4. ELIMINAR TABLAS DE CONTROL MULTI-TENANT / PLATAFORMA
-- -------------------------------------------------------------------
DROP TABLE IF EXISTS tienda.estado_tenants CASCADE;
DROP TABLE IF EXISTS tienda.plataforma_admin CASCADE;
DROP TABLE IF EXISTS tienda.plataforma_roles CASCADE;

-- -------------------------------------------------------------------
--  5. ELIMINAR ROL saas_app (LIMPIANDO PRIVILEGIOS PRIMERO)
-- -------------------------------------------------------------------
-- PostgreSQL no permite DROP ROLE si el rol tiene GRANTs o DEFAULT PRIVILEGES
-- en el esquema; primero se reasignan/eliminan sus objetos y permisos.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saas_app') THEN
        EXECUTE 'REASSIGN OWNED BY saas_app TO CURRENT_USER';
        EXECUTE 'DROP OWNED BY saas_app';
        EXECUTE 'DROP ROLE saas_app';
        RAISE NOTICE 'Rol saas_app y sus privilegios eliminados';
    END IF;
END $$;

-- -------------------------------------------------------------------
--  6. ELIMINAR FUNCIONES DE PROVISIÓN Y EXPORT/IMPORT MULTI-TENANT
-- -------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_provisionar_negocio(text, text, text, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS fn_exportar_negocio(integer);
DROP FUNCTION IF EXISTS fn_importar_negocio(jsonb);
DROP FUNCTION IF EXISTS fn_subdominio_unico(text, integer);

-- -------------------------------------------------------------------
--  7. AGREGAR COLUMNA vertical A NEGOCIO
-- -------------------------------------------------------------------
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS vertical VARCHAR(20) DEFAULT 'REPUESTOS';
COMMENT ON COLUMN negocio.vertical IS 'Vertical de negocio: REPUESTOS, FERRETERIA, ROPA, BODEGA. Define qué módulos específicos usar.';

-- -------------------------------------------------------------------
--  8. VERIFICACIÓN Y RESUMEN
-- -------------------------------------------------------------------
DO $$
DECLARE
    tablas_con_rls INTEGER;
BEGIN
    SELECT COUNT(*) INTO tablas_con_rls
      FROM pg_tables
     WHERE schemaname = 'tienda' AND rowsecurity IS TRUE;

    IF tablas_con_rls > 0 THEN
        RAISE EXCEPTION 'Error: aún quedan % tablas con RLS activo', tablas_con_rls;
    END IF;

    IF EXISTS (SELECT 1 FROM motos_modelos LIMIT 1) THEN
        UPDATE negocio SET vertical = 'REPUESTOS' WHERE id = 1;
    END IF;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Conversión a tienda única completada';
    RAISE NOTICE '========================================';
    RAISE NOTICE '- fn_negocio_actual() devuelve 1';
    RAISE NOTICE '- fn_sesion_permitida() y fn_puede_editar_global() devuelven true';
    RAISE NOTICE '- DEFAULT 1 activo en todas las columnas negocio_id';
    RAISE NOTICE '- RLS desactivado en todas las tablas (incluida negocio)';
    RAISE NOTICE '- estado_tenants, plataforma_admin, plataforma_roles y saas_app eliminados';
END $$;

COMMENT ON SCHEMA tienda IS 'Esquema de tienda única. Todas las tablas operan con negocio_id = 1 (DEFAULT 1). Sin RLS ni portal.';
```

### Archivos SQL a Eliminar o Ajustar

```bash
# 1. Eliminar archivos exclusivos del portal y provisión SaaS
rm database/sql/33_portal.sql
rm database/sql/34_portal_pagos.sql
rm database/sql/35_provisionar.sql
rm database/sql/40_ciclo_cobro.sql
rm database/sql/42_portal_rol.sql
rm database/sql/43_plataforma_admin.sql

# 2. Si se hacen instalaciones limpias (setup_db.py):
#    - En 36_islr_declaracion.sql y 38_presentaciones_venta.sql: quitar las líneas finales que hacen ENABLE/FORCE ROW LEVEL SECURITY y CREATE POLICY p_tenant.
#    - En 41_endurecimiento_seguridad.sql: dejar fn_puede_editar_global() devolviendo true y quitar los REVOKE/GRANT a saas_app y el UPDATE a estado_tenants.
```

---

## 🐘 Cambios en Laravel (PHP)

### Archivo: `app/Support/Tenant.php` (Simplificar)

```php
<?php

namespace App\Support;

/**
 * Tienda única: el negocio siempre es 1.
 * 
 * Se mantiene la clase por compatibilidad con el código existente
 * que llama a Tenant::id(), Tenant::fiscal(), etc.
 */
class Tenant
{
    /**
     * En tienda única siempre devuelve 1.
     */
    public static function id(): int
    {
        return 1;
    }

    /**
     * Todos los módulos activos en tienda única.
     */
    public static function modulo(string $codigo): bool
    {
        return true;
    }

    /**
     * Parte fiscal siempre activa en tienda única.
     */
    public static function fiscal(): bool
    {
        return true;
    }

    /**
     * Sin control de edición global en tienda única.
     */
    public static function editarGlobal(): bool
    {
        return true;
    }

    /**
     * No hace falta fijar el GUC en tienda única.
     * Se mantiene por compatibilidad con jobs en cola.
     */
    public static function fijar(int $negocioId = 1): int
    {
        return 1;
    }

    /**
     * No hace falta limpiar en tienda única.
     */
    public static function limpiar(): void
    {
        // Nada que limpiar
    }

    /**
     * Resolver el tenant desde el host.
     * En tienda única no hace nada, pero se mantiene por compatibilidad.
     */
    public static function resolver(string $host): int
    {
        return 1;
    }

    /**
     * Ejecutar un trabajo sin cambio de contexto.
     */
    public static function ejecutar(int $negocioId, callable $trabajo): mixed
    {
        return $trabajo(1);
    }

    /**
     * Estado del tenant (vacío en tienda única).
     */
    public static function estado(): ?array
    {
        return null;
    }
}
```

### Archivo: `app/Http/Middleware/IdentificarTenant.php` (Simplificar)

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Tienda única: ya no se resuelve subdominio ni se fija negocio_id.
 * 
 * El SQL siempre trabaja con negocio_id = 1.
 * Se mantiene el middleware por compatibilidad con la cadena de middlewares.
 */
class IdentificarTenant
{
    public function handle(Request $request, Closure $next): Response
    {
        // En tienda única no hay nada que resolver
        // Simplemente continuar con la petición
        return $next($request);
    }
}
```

### Archivo: `bootstrap/app.php` (Simplificar)

```php
<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Middleware simplificado para tienda única
        // IdentificarTenant se mantiene pero no hace nada
        $middleware->web(prepend: [
            \App\Http\Middleware\IdentificarTenant::class,
            \App\Http\Middleware\LogContexto::class
        ]);
        
        $middleware->web(append: [
            \App\Http\Middleware\HandleInertiaRequests::class,
            \App\Http\Middleware\SeguridadCabeceras::class
        ]);
        
        // Eliminar alias de portal_admin (no se usa en tienda única)
        // $middleware->alias(['portal_admin' => ...]);
        
        $middleware->redirectGuestsTo('/login');
        $middleware->redirectUsersTo('/dashboard');
        
        // Excluir CSP report del CSRF
        $middleware->validateCsrfTokens(except: ['csp-report']);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
```

### Archivo: `app/Http/Middleware/LogContexto.php` (Actualizar)

```php
// Línea 35, cambiar:
'negocio_id' => Tenant::id(),

// Por:
'negocio_id' => 1,
```

### Archivo: `app/Providers/AppServiceProvider.php` (Actualizar)

En modo multi-tenant, `AppServiceProvider` aborta con 500 en producción si el usuario de PostgreSQL es superusuario (`guardarSuperusuario()`) y registra el rate limiter `portal_escritura`. En tienda única se quitan ambos:

```php
// 1. En boot(): eliminar el bloque que escucha ConnectionEstablished y llama a $this->guardarSuperusuario().
// 2. Eliminar el método guardarSuperusuario() y la propiedad $esSuperusuario.
// 3. Eliminar RateLimiter::for('portal_escritura', ...).
```

### Archivo: `routes/web.php` (Actualizar)

Eliminar las rutas que apuntan a controladores del SaaS/portal y ajustar `/health/db`:

```php
// 1. Dentro de Route::middleware('guest'): eliminar GET y POST '/crear-cuenta' (CrearCuentaController).
// 2. Dentro del grupo autenticado: eliminar GET '/suscripcion' y POST '/suscripcion/pagos' (SuscripcionController).
// 3. Fuera del grupo: eliminar GET '/precios', GET/POST '/portal/login' y todo el grupo Route::middleware('portal_admin').
// 4. En GET '/health/db': quitar el if (app()->environment('production') && $super) que devolvía 500.
```

### Archivo: `routes/console.php` (Actualizar)

Reemplazar la consulta a `estado_tenants` en `islr:alertas` y eliminar `portal:propagar`:

```php
Artisan::command('islr:alertas {--dias=7 : Días de anticipación}', function () {
    $vencido = false;
    $hubo = false;
    foreach (\App\Http\Controllers\DeclaracionIslrController::alertas(max(0, (int) $this->option('dias'))) as $a) {
        $hubo = true;
        $vencido = $vencido || $a['gravedad'] === 'VENCIDO';
        $linea = '['.$a['gravedad'].'] '.$a['mensaje'];
        $a['gravedad'] === 'VENCIDO' ? $this->error($linea) : $this->warn($linea);
        Log::warning('ISLR: '.$linea);
    }
    if (! $hubo) {
        $this->info('Sin alertas de ISLR.');
    }

    return $vencido ? 1 : 0;
})->purpose('Avisa de retenciones de ISLR por enterar y de vencimientos de ISLR cercanos');

Schedule::command('islr:alertas')->dailyAt('07:00')->timezone('America/Caracas');
// (Eliminar el comando portal:propagar y su Schedule::command)
```

### Archivo: `resources/js/Layouts/AppLayout.jsx` (Actualizar)

En la constante `MENU` (grupo `Administración`, línea 51), eliminar la entrada de suscripción:

```js
// Eliminar esta línea:
{ t: 'Suscripción', i: CreditCard, href: '/suscripcion', admin: true },
```

### Archivo: `.env` y `config/database.php` (Limpiar)

Eliminar estas variables de `.env` (y quitar la conexión `'portal'` de `config/database.php`):

```env
# ELIMINAR estas variables (no se necesitan en tienda única)
SAAS_BASE_DOMAIN=
PORTAL_ADMIN_PASSWORD=
PORTAL_DB_HOST=
PORTAL_DB_PORT=
PORTAL_DB_DATABASE=
PORTAL_DB_USERNAME=
PORTAL_DB_PASSWORD=
DB_ADMIN_USERNAME=
DB_ADMIN_PASSWORD=
```

### Archivos PHP y React a Eliminar

```bash
# Eliminar soporte, middleware y controladores del portal / alta SaaS
rm app/Support/Portal.php
rm app/Support/PortalConsultas.php
rm app/Support/Propagador.php
rm app/Http/Controllers/SuscripcionController.php
rm app/Http/Controllers/Auth/CrearCuentaController.php
rm -rf app/Http/Controllers/Portal
rm app/Http/Middleware/PortalAdmin.php

# Eliminar configuración del SaaS
rm config/saas.php

# Eliminar vistas Inertia exclusivas del portal / SaaS
rm -rf resources/js/Pages/Portal
rm -rf resources/js/Pages/Suscripcion
rm resources/js/Pages/Precios.jsx
rm resources/js/Pages/Auth/CrearCuenta.jsx
rm resources/js/Layouts/PortalLayout.jsx
```

---

## 📋 Plan de Ejecución

### Paso 1: Backup Completo

```bash
# 1. Backup de la base de datos
pg_dump -U postgres -F c -f backup_tienda_$(date +%Y%m%d).dump tienda

# 2. Backup del código
git add .
git commit -m "Antes de convertir a tienda única"
git checkout -b backup-multi-tenant
git checkout main

# 3. Crear rama de trabajo
git checkout -b tienda-unica
```

### Paso 2: Modificar Base de Datos

```bash
# 1. Crear el nuevo archivo SQL
# (Crear database/sql/31_tienda_unica.sql con el contenido de arriba)

# 2. Ejecutar sobre la base existente
psql -U postgres -d tienda -v ON_ERROR_STOP=1 -f database/sql/31_tienda_unica.sql

# 3. Eliminar archivos del portal y provisión SaaS
rm database/sql/33_portal.sql
rm database/sql/34_portal_pagos.sql
rm database/sql/35_provisionar.sql
rm database/sql/40_ciclo_cobro.sql
rm database/sql/42_portal_rol.sql
rm database/sql/43_plataforma_admin.sql

# 4. (Opcional) Instalar módulos verticales según el tipo de negocio
# psql -U postgres -d tienda -v ON_ERROR_STOP=1 -f database/sql/44_ferreteria_venezuela.sql
# psql -U postgres -d tienda -v ON_ERROR_STOP=1 -f database/sql/45_bodega_venezuela.sql
# psql -U postgres -d tienda -v ON_ERROR_STOP=1 -f database/sql/46_ropa_venezuela.sql
```

### Paso 3: Modificar Código Laravel y Frontend

```bash
# 1. Simplificar archivos PHP y React (Tenant.php, IdentificarTenant.php,
#    bootstrap/app.php, LogContexto.php, AppServiceProvider.php,
#    routes/web.php, routes/console.php, AppLayout.jsx)

# 2. Eliminar archivos del portal y alta SaaS
rm app/Support/Portal.php
rm app/Support/PortalConsultas.php
rm app/Support/Propagador.php
rm app/Http/Controllers/SuscripcionController.php
rm app/Http/Controllers/Auth/CrearCuentaController.php
rm -rf app/Http/Controllers/Portal
rm app/Http/Middleware/PortalAdmin.php
rm config/saas.php
rm -rf resources/js/Pages/Portal
rm -rf resources/js/Pages/Suscripcion
rm resources/js/Pages/Precios.jsx
rm resources/js/Pages/Auth/CrearCuenta.jsx
rm resources/js/Layouts/PortalLayout.jsx

# 3. Actualizar .env y config/database.php
# Eliminar: SAAS_BASE_DOMAIN, PORTAL_*, DB_ADMIN_* y la conexión 'portal'
```

### Paso 4: Ajustar Scripts de Infraestructura y Pruebas

```bash
# 1. En scripts/infra/setup_db.py:
#    - Reemplazar '31_multitenant.sql' por '31_tienda_unica.sql'
#    - Quitar '35_provisionar.sql' y '43_plataforma_admin.sql' de TIENDA_FILES
#    - Quitar la creación y carga de 'portal_saas' (PORTAL_FILES) y la creación de saas_app

# 2. Retirar las pruebas que evalúan aislamiento multi-tenant o el portal:
rm -rf tests/portal tests/multiinquilino
rm tests/Feature/PortalRutasTest.php
rm tests/Feature/AislamientoMultiTenantHttpTest.php
rm tests/Feature/AislamientoFiltrosDashboardTest.php
rm tests/Feature/AtaqueBolaIdsCruzadosTest.php
rm tests/Feature/SesionTenantTest.php
```

### Paso 5: Limpiar Cache y Compilar

```bash
# Limpiar cache de Laravel
php artisan config:clear
php artisan route:clear
php artisan view:clear
php artisan cache:clear

# Compilar frontend
npm run build
```

### Paso 6: Verificar Funcionamiento

```bash
# 1. Correr pruebas operativas y fiscales (237 + 200) y Pest
python tests/run_todo.py
./vendor/bin/pest

# 2. Iniciar servidor de desarrollo
php artisan serve
npm run dev

# 3. Probar manualmente:
#    - Login
#    - Crear categoría, marca, modelo y producto (verifica que DEFAULT 1 funciona)
#    - Registrar una tasa de cambio (verifica que fn_puede_editar_global() devuelve true)
#    - Crear una venta y registrar una compra
#    - Ver kardex, cerrar caja y generar libros fiscales
```

---

## ✅ Verificación y Pruebas

### Lista de Verificación

Después de completar la conversión, verificar:

- [ ] **Base de datos**
  - [ ] `fn_negocio_actual()` devuelve `1`
  - [ ] `fn_sesion_permitida()` devuelve `true`
  - [ ] `fn_puede_editar_global()` devuelve `true`
  - [ ] Todas las columnas `negocio_id` tienen `DEFAULT 1`
  - [ ] RLS desactivado en todas las tablas de `tienda` (incluida `tienda.negocio`)
  - [ ] Tablas `estado_tenants`, `plataforma_admin` y `plataforma_roles` eliminadas
  - [ ] Rol `saas_app` eliminado (previo `REASSIGN OWNED` / `DROP OWNED`)

- [ ] **Laravel y React**
  - [ ] `Tenant::id()` devuelve `1`, `Tenant::fiscal()` y `Tenant::editarGlobal()` devuelven `true`
  - [ ] `AppServiceProvider` ya no aborta cuando la conexión usa un rol superusuario
  - [ ] Rutas `/crear-cuenta`, `/suscripcion`, `/precios` y `/portal/*` eliminadas de `routes/web.php`
  - [ ] `routes/console.php` sin `portal:propagar` y con `islr:alertas` funcionando sin `estado_tenants`
  - [ ] Menú lateral (`AppLayout.jsx`) sin el enlace a `/suscripcion`
  - [ ] `.env` y `config/database.php` limpios de variables/conexión del portal

- [ ] **Funcionalidad**
  - [ ] Login funciona
  - [ ] Crear categorías, marcas, modelos, métodos de pago y productos funciona sin error de `negocio_id`
  - [ ] Registrar tasas de cambio y alícuotas funciona
  - [ ] Registrar ventas y compras funciona
  - [ ] Kardex, cierres de caja, libros fiscales y contabilidad cuadran

- [ ] **Pruebas automáticas**
  - [ ] `python tests/run_todo.py` pasa las 237 pruebas operativas y 200 fiscales
  - [ ] `./vendor/bin/pest` pasa en verde

### Comandos de Verificación SQL

```sql
-- Verificar funciones de sesión y guardia
SELECT fn_negocio_actual(), fn_sesion_permitida(), tienda.fn_puede_editar_global();
-- Debe devolver: 1 | t | t

-- Verificar que NINGUNA tabla del esquema tienda tiene RLS activo
SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'tienda' AND rowsecurity IS TRUE;
-- Debe devolver: 0

-- Verificar que todas las columnas negocio_id tienen DEFAULT 1
SELECT COUNT(*) FROM information_schema.columns
 WHERE table_schema = 'tienda' AND column_name = 'negocio_id'
   AND (column_default IS NULL OR column_default NOT LIKE '1%');
-- Debe devolver: 0

-- Verificar que estado_tenants, plataforma_admin y saas_app no existen
SELECT to_regclass('tienda.estado_tenants'),
       to_regclass('tienda.plataforma_admin'),
       (SELECT COUNT(*) FROM pg_roles WHERE rolname = 'saas_app');
-- Debe devolver: NULL | NULL | 0

-- Verificar que negocio tiene la columna vertical
SELECT vertical FROM negocio WHERE id = 1;
-- Debe mostrar: REPUESTOS (o el vertical que corresponda)
```

---

## 📚 Referencias

### Archivos Creados

| Archivo | Propósito |
|---------|-----------|
| `database/sql/31_tienda_unica.sql` | Conversión a tienda única |
| `database/sql/44_ferreteria_venezuela.sql` | Módulo vertical ferretería |
| `database/sql/45_bodega_venezuela.sql` | Módulo vertical bodega |
| `database/sql/46_ropa_venezuela.sql` | Módulo vertical ropa |

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `database/sql/36_islr_declaracion.sql` y `38_presentaciones_venta.sql` | Sin bloque final de RLS / `p_tenant` |
| `database/sql/41_endurecimiento_seguridad.sql` | `fn_puede_editar_global() → true`, sin `saas_app` ni `estado_tenants` |
| `app/Support/Tenant.php` | Simplificado para devolver siempre `1` / `true` |
| `app/Http/Middleware/IdentificarTenant.php` | Simplificado (pasa directo al siguiente middleware) |
| `app/Http/Middleware/LogContexto.php` | `negocio_id = 1` fijo |
| `app/Providers/AppServiceProvider.php` | Sin guardia `guardarSuperusuario()` ni rate limiter `portal_escritura` |
| `bootstrap/app.php` | Sin alias `portal_admin` |
| `routes/web.php` y `routes/console.php` | Sin rutas del portal/suscripción/crear-cuenta; `islr:alertas` directo sobre la tienda |
| `resources/js/Layouts/AppLayout.jsx` | Sin ítem `/suscripcion` en el menú |
| `config/database.php` y `.env` | Sin conexión `portal` ni variables `SAAS_*` / `PORTAL_*` / `DB_ADMIN_*` |
| `scripts/infra/setup_db.py` y `.github/workflows/ci.yml` | Ajustados a una sola base (`tienda`) |

### Archivos Eliminados

| Archivo | Motivo |
|---------|--------|
| `database/sql/31_multitenant.sql` | Reemplazado por `31_tienda_unica.sql` |
| `database/sql/33_portal.sql`, `34_portal_pagos.sql`, `40_ciclo_cobro.sql`, `42_portal_rol.sql` | Base `portal_saas` no necesaria |
| `database/sql/35_provisionar.sql`, `43_plataforma_admin.sql` | Provisión y guardia multi-tenant no necesarias |
| `app/Support/Portal.php`, `PortalConsultas.php`, `Propagador.php` | Portal no necesario |
| `app/Http/Controllers/Portal/PortalAdminController.php` | Panel `/portal` no necesario |
| `app/Http/Controllers/Auth/CrearCuentaController.php` | Alta self-service `/crear-cuenta` no necesaria |
| `app/Http/Controllers/SuscripcionController.php` | Sin suscripciones |
| `app/Http/Middleware/PortalAdmin.php` y `config/saas.php` | Sin configuración SaaS |
| `resources/js/Pages/Portal/*`, `Pages/Suscripcion/*`, `Pages/Precios.jsx`, `Pages/Auth/CrearCuenta.jsx`, `Layouts/PortalLayout.jsx` | Vistas SaaS no necesarias |

---

## 🎯 Conclusión

La conversión de multi-tenant a tienda única es un proceso relativamente simple que:

1. **Simplifica el sistema** eliminando RLS, portal y funciones de export/import
2. **Preserva toda la funcionalidad** de negocio (ventas, compras, inventario, fiscal, contabilidad)
3. **Mantiene la capacidad de expansión** vertical (ferretería, ropa, bodega)
4. **Requiere solo 4-5 horas** de trabajo
5. **Es reversible** mediante la rama de backup

### Beneficios

- ✅ Menor complejidad de código
- ✅ Menor carga de infraestructura (sin portal)
- ✅ Mejor rendimiento (sin RLS verificando cada consulta)
- ✅ Mantenimiento más sencillo
- ✅ Preserva toda la funcionalidad fiscal venezolana

### Próximos Pasos

1. Ejecutar la conversión siguiendo el plan
2. Verificar que todas las pruebas pasan
3. Instalar los módulos verticales según el tipo de negocio
4. Documentar cualquier personalización adicional

---

**Fin del documento**
