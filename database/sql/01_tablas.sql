-- =============================================================================
--  SISTEMA DE VENTAS E INVENTARIO · TIENDA DE REPUESTOS DE MOTOS (VENEZUELA)
--  Archivo 01 · ESQUEMA Y TABLAS
-- =============================================================================
--  Motor:      PostgreSQL 14 o superior (probado en 16; no usa nada exclusivo de 18)
--  Ejecución:  psql -U postgres -d <base> -v ON_ERROR_STOP=1 -f 00_instalar.sql
--
--  CONVENCIONES
--   · Todo vive en el esquema «tienda» (no choca con las tablas de Laravel/FastAPI).
--   · Dinero base en USD (NUMERIC(18,4) para costos/precios, NUMERIC(18,2) para
--     totales). Los bolívares NUNCA se guardan en el catálogo: se calculan con la
--     tasa del día. Solo se guardan los Bs de documentos ya emitidos (ventas/compras),
--     junto con la tasa congelada que se usó.
--   · Tasas de cambio: NUMERIC(20,8) (el BCV publica 8 decimales). Se expresan como
--     «bolívares por 1 USD».
--   · Porcentajes se guardan como número «16.00» (no 0.16).
--   · Los usuarios (ADMINISTRADOR / CAJERO) viven en la tabla `usuarios`. Se atan con llave foránea
--     solo ventas.usuario_id y compras.usuario_id; las demás columnas «usuario_id BIGINT» de auditoría
--     (kardex, precios, notas, reversiones, tasas) quedan sin FK a propósito: se heredan por asociación.
--   · Los documentos emitidos (ventas, compras, pagos, movimientos) son INMUTABLES:
--     no se editan ni se borran; se ANULAN (ver 03_triggers.sql).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS tienda;
SET search_path = tienda, public;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;  -- evita que se solapen vigencias de impuestos
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public; -- búsqueda rápida de productos por texto parcial

-- -----------------------------------------------------------------------------
--  1. CONFIGURACIÓN DEL NEGOCIO (se llena en el asistente del primer inicio)
-- -----------------------------------------------------------------------------
CREATE TABLE monedas (
    codigo   CHAR(3)     PRIMARY KEY CHECK (codigo = upper(codigo)),
    nombre   VARCHAR(60) NOT NULL,
    simbolo  VARCHAR(5)  NOT NULL,
    activa   BOOLEAN     NOT NULL DEFAULT TRUE,
    es_base  BOOLEAN     NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX uq_moneda_base ON monedas (es_base) WHERE es_base;
COMMENT ON TABLE  monedas         IS 'Monedas manejadas. La moneda base (USD) es en la que se guardan costos y precios.';
COMMENT ON COLUMN monedas.es_base IS 'Solo una moneda puede ser la base. Costos y precios se guardan en ella.';

CREATE TABLE negocio (
    id                          SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- fila única
    -- Datos del negocio (paso 1 del asistente)
    razon_social                VARCHAR(200) NOT NULL,
    nombre_comercial            VARCHAR(200),
    rif                         VARCHAR(15),   -- validado por ck_negocio_rif (fn_validar_rif, definido en el archivo 02)
    direccion_fiscal            TEXT,
    telefono                    VARCHAR(40),
    correo                      VARCHAR(150),
    -- Régimen fiscal (paso 2)
    es_contribuyente_especial   BOOLEAN      NOT NULL DEFAULT FALSE,
    cobra_igtf                  BOOLEAN      NOT NULL DEFAULT FALSE,
    recupera_credito_fiscal     BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Políticas de precios y costos (pasos 3 y 4)
    precios_incluyen_iva        BOOLEAN      NOT NULL DEFAULT FALSE,
    igtf_base                   VARCHAR(8)   NOT NULL DEFAULT 'CON_IVA' CHECK (igtf_base IN ('CON_IVA','SIN_IVA')),
    politica_costo_nuevo        VARCHAR(10)  NOT NULL DEFAULT 'AVISAR' CHECK (politica_costo_nuevo IN ('AVISAR','AUTOMATICO','NINGUNA')),
    metodo_costo                VARCHAR(10)  NOT NULL DEFAULT 'ULTIMO' CHECK (metodo_costo IN ('ULTIMO','PROMEDIO')),
    margen_defecto_pct          NUMERIC(7,2) NOT NULL DEFAULT 30 CHECK (margen_defecto_pct >= 0 AND margen_defecto_pct <= 1000),
    redondeo_precio_usd         NUMERIC(6,4) NOT NULL DEFAULT 0.01 CHECK (redondeo_precio_usd > 0),
    -- Tasa de cambio y caja
    regla_tasa_sin_publicacion  VARCHAR(10)  NOT NULL DEFAULT 'SIGUIENTE' CHECK (regla_tasa_sin_publicacion IN ('ANTERIOR','SIGUIENTE')),
    dias_max_tasa_antigua       SMALLINT     NOT NULL DEFAULT 4 CHECK (dias_max_tasa_antigua >= 0),
    dias_max_tasa_futura        SMALLINT     NOT NULL DEFAULT 5 CHECK (dias_max_tasa_futura BETWEEN 0 AND 15),
    tolerancia_pago_usd         NUMERIC(6,4) NOT NULL DEFAULT 0.01 CHECK (tolerancia_pago_usd >= 0),
    permitir_stock_negativo     BOOLEAN      NOT NULL DEFAULT FALSE,
    reversa_igtf_en_anulacion   BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Confirmación del asistente
    configurado_en              TIMESTAMPTZ,
    configurado_por             BIGINT,
    created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_igtf_requiere_especial CHECK (NOT cobra_igtf OR es_contribuyente_especial)
);
COMMENT ON TABLE negocio IS 'Datos y políticas del negocio. UNA sola fila (id=1). La app no permite vender hasta que configurado_en tenga valor (ver sp_confirmar_configuracion_inicial).';
COMMENT ON COLUMN negocio.es_contribuyente_especial IS 'TRUE si el SENIAT lo califica como sujeto pasivo especial.';
COMMENT ON COLUMN negocio.cobra_igtf IS 'TRUE si el negocio actúa como agente de percepción del IGTF (3 % en pagos en divisas sin banco). Requiere ser contribuyente especial. CONFIRMAR CON EL CONTADOR.';
COMMENT ON COLUMN negocio.recupera_credito_fiscal IS 'TRUE (contribuyente ordinario de IVA, valor por defecto): el IVA de las compras es crédito fiscal y el costo del inventario se guarda SIN IVA. Según la investigación fiscal 2026 del proyecto, el crédito acumulado no vence y se traslada hasta agotarse. FALSE: el IVA pagado forma parte del costo. Confirmar con el contador.';
COMMENT ON COLUMN negocio.precios_incluyen_iva IS 'FALSE: precio_venta_usd es sin IVA y el IVA se suma al vender. TRUE: precio_venta_usd es el precio final al público con IVA incluido.';
COMMENT ON COLUMN negocio.igtf_base IS 'CON_IVA (valor por defecto): el IGTF se calcula sobre lo pagado en divisas INCLUYENDO el IVA (importe total de la operación); es la única base con respaldo en las fuentes consultadas (Moore, Dejuris, Gálac, Nayma; todas secundarias). SIN_IVA: solo sobre la parte sin IVA; NO tiene respaldo en ninguna fuente encontrada y se conserva solo por si un contador lo exige por escrito (sp_guardar_configuracion_negocio emite un WARNING al elegirlo).';
COMMENT ON COLUMN negocio.politica_costo_nuevo IS 'Qué hacer cuando entra mercancía con un costo distinto: AVISAR (crea una alerta para confirmar el nuevo precio), AUTOMATICO (recalcula el precio solo) o NINGUNA (solo actualiza el costo).';
COMMENT ON COLUMN negocio.metodo_costo IS 'ULTIMO: el costo del producto es el de la última compra. PROMEDIO: costo promedio ponderado con el stock existente.';
COMMENT ON COLUMN negocio.margen_defecto_pct IS 'Margen sobre el costo (10, 20, 30...) cuando ni el producto ni su categoría definen uno. precio = costo × (1 + margen/100).';
COMMENT ON COLUMN negocio.redondeo_precio_usd IS 'Paso de redondeo del precio de venta en USD (0.01 = centavos; 0.05 = cada 5 centavos; 0.50...).';
COMMENT ON COLUMN negocio.regla_tasa_sin_publicacion IS 'Fines de semana y feriados (el BCV no publica): SIGUIENTE (por defecto) usa la tasa publicada para el próximo día hábil (art. 25 Ley de IVA: las operaciones de fin de semana o feriado se convierten a la tasa del siguiente día hábil; fuente secundaria, confirmar con contador); ANTERIOR usa la última tasa publicada antes. Para el día de hoy SIGUIENTE solo aplica si ya se cargó la tasa del próximo día hábil; si no, cae en la anterior.';
COMMENT ON COLUMN negocio.dias_max_tasa_futura IS 'Cuántos días por delante de hoy admite sp_registrar_tasa como fecha valor (0 a 15). Por defecto 5: el BCV publica en la tarde con fecha valor del próximo día hábil, y el viernes eso es el lunes (hoy + 3), más fines de semana largos con feriado.';
COMMENT ON COLUMN negocio.dias_max_tasa_antigua IS 'Si la última tasa cargada tiene más de estos días de antigüedad, el sistema se niega a vender (evita cobrar con una tasa vieja sin darse cuenta).';
COMMENT ON COLUMN negocio.tolerancia_pago_usd IS 'Diferencia máxima aceptada (en USD) entre el total de la venta y la suma de los pagos.';

-- -----------------------------------------------------------------------------
--  1b. USUARIOS (quién opera el POS; la contraseña se guarda como hash bcrypt, nunca en claro)
-- -----------------------------------------------------------------------------
CREATE TABLE usuarios (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username              VARCHAR(40)  NOT NULL,
    password_hash         VARCHAR(255) NOT NULL DEFAULT 'PENDIENTE',
    nombre_completo       VARCHAR(200) NOT NULL,
    rol                   VARCHAR(20)  NOT NULL CHECK (rol IN ('ADMINISTRADOR', 'CAJERO')),
    activo                BOOLEAN      NOT NULL DEFAULT TRUE,
    debe_cambiar_password BOOLEAN      NOT NULL DEFAULT FALSE,
    ultimo_acceso         TIMESTAMPTZ,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_usuarios_username ON usuarios (lower(username));
COMMENT ON TABLE  usuarios IS 'Personas que operan el POS. El rol decide qué puede hacer cada una. La contraseña se guarda cifrada (bcrypt).';
COMMENT ON COLUMN usuarios.id IS 'Identificador del usuario (el que ventas.usuario_id y compras.usuario_id referencian).';
COMMENT ON COLUMN usuarios.username IS 'Nombre de usuario, único sin distinguir mayúsculas.';
COMMENT ON COLUMN usuarios.password_hash IS 'Hash bcrypt de la contraseña. El valor «PENDIENTE» significa que todavía no se configuró (solo aplica al administrador que siembra el asistente). Solo cambia con sp_primer_admin / sp_cambiar_password.';
COMMENT ON COLUMN usuarios.nombre_completo IS 'Nombre y apellido de la persona que atiende.';
COMMENT ON COLUMN usuarios.rol IS 'ADMINISTRADOR (todo) o CAJERO (vende, consulta su turno; no anula compras, no cambia precios, no edita el negocio).';
COMMENT ON COLUMN usuarios.activo IS 'FALSE = deshabilitado: puede verse en el histórico pero no iniciar sesión. Nunca se borra.';
COMMENT ON COLUMN usuarios.debe_cambiar_password IS 'TRUE obliga a cambiar la contraseña en el próximo inicio de sesión.';
COMMENT ON COLUMN usuarios.ultimo_acceso IS 'Marca de tiempo del último login exitoso.';
COMMENT ON COLUMN usuarios.created_at IS 'Fecha y hora de creación del registro.';
COMMENT ON COLUMN usuarios.updated_at IS 'Fecha y hora de la última modificación (la actualiza un trigger).';

CREATE TABLE parametros_fiscales (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo         VARCHAR(20)  NOT NULL CHECK (codigo IN ('IVA_GENERAL','IGTF_DIVISAS')),
    porcentaje     NUMERIC(7,4) NOT NULL CHECK (porcentaje >= 0 AND porcentaje <= 100),
    vigente_desde  DATE         NOT NULL,
    vigente_hasta  DATE,
    nota           TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    creado_por     BIGINT,
    CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
    -- una misma alícuota no puede tener dos vigencias solapadas
    EXCLUDE USING gist (codigo WITH =, daterange(vigente_desde, vigente_hasta, '[]') WITH &&)
);
COMMENT ON TABLE parametros_fiscales IS 'Alícuotas con fecha de vigencia. Cuando el Ejecutivo cambia una alícuota se cierra la fila anterior (vigente_hasta) y se agrega la nueva con sp_cambiar_alicuota (sin hueco ni solape); NUNCA se edita el pasado. Las ventas congelan el porcentaje usado. El EXCLUDE impide solapes pero NO huecos: un día sin alícuota vigente bloquea las ventas (TV006) a propósito.';
COMMENT ON COLUMN parametros_fiscales.creado_por IS 'Usuario que registró el cambio de alícuota con sp_cambiar_alicuota (NULL en los datos iniciales).';

-- -----------------------------------------------------------------------------
--  2. TASAS DE CAMBIO (BCV)
-- -----------------------------------------------------------------------------
CREATE TABLE tasas_cambio (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    moneda_origen    CHAR(3)      NOT NULL REFERENCES monedas(codigo),
    moneda_destino   CHAR(3)      NOT NULL REFERENCES monedas(codigo),
    tasa             NUMERIC(20,8) NOT NULL CHECK (tasa > 0),
    fecha_valor      DATE         NOT NULL,
    fuente           VARCHAR(30)  NOT NULL DEFAULT 'MANUAL' CHECK (fuente IN ('EXCHANGERATE_API','BCV','MANUAL')),
    es_oficial_bcv   BOOLEAN      NOT NULL DEFAULT FALSE,
    obtenida_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    usuario_id       BIGINT,
    CHECK (moneda_origen <> moneda_destino),
    UNIQUE (moneda_origen, moneda_destino, fecha_valor)
);
COMMENT ON TABLE  tasas_cambio IS 'Una tasa por par de monedas y por día. Se alimenta desde la API de tipo de cambio o a mano (sp_registrar_tasa). Cada cambio queda auditado en log_tasas_cambio.';
COMMENT ON COLUMN tasas_cambio.tasa IS 'Unidades de moneda_destino por 1 unidad de moneda_origen (ej. USD→VES = bolívares por dólar).';
COMMENT ON COLUMN tasas_cambio.fecha_valor IS 'Día al que corresponde la tasa (la «fecha valor» del BCV), no el día en que se descargó.';
COMMENT ON COLUMN tasas_cambio.es_oficial_bcv IS 'Marca si se sabe que la tasa es la oficial del BCV. Para documentos fiscales debe usarse la oficial.';

CREATE TABLE log_tasas_cambio (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tasa_cambio_id   BIGINT,
    accion           VARCHAR(10)   NOT NULL,
    moneda_origen    CHAR(3)       NOT NULL,
    moneda_destino   CHAR(3)       NOT NULL,
    fecha_valor      DATE          NOT NULL,
    tasa_anterior    NUMERIC(20,8),
    tasa_nueva       NUMERIC(20,8),
    fuente           VARCHAR(30),
    usuario_id       BIGINT,
    fecha            TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE log_tasas_cambio IS 'Auditoría de altas y cambios de tasas (quién y cuándo). Solo se agrega, nunca se edita.';

-- -----------------------------------------------------------------------------
--  3. CATÁLOGO: CATEGORÍAS, MARCAS, MOTOS, PRODUCTOS
-- -----------------------------------------------------------------------------
CREATE TABLE categorias (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL,
    margen_pct  NUMERIC(7,2) CHECK (margen_pct IS NULL OR (margen_pct >= 0 AND margen_pct <= 1000)),
    activa      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_categorias_nombre ON categorias (lower(nombre));
COMMENT ON COLUMN categorias.margen_pct IS 'Margen de la categoría. NULL = usa el margen por defecto del negocio. Un producto puede tener el suyo propio.';

CREATE TABLE marcas (
    id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre  VARCHAR(100) NOT NULL,
    activa  BOOLEAN      NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX uq_marcas_nombre ON marcas (lower(nombre));
COMMENT ON TABLE marcas IS 'Fabricante o marca del repuesto (NGK, Bendix, Yamaha Genuine...).';

CREATE TABLE motos_modelos (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    marca       VARCHAR(60)  NOT NULL,
    modelo      VARCHAR(80)  NOT NULL,
    cilindrada  SMALLINT     CHECK (cilindrada IS NULL OR cilindrada > 0),
    UNIQUE (marca, modelo, cilindrada)
);
COMMENT ON TABLE motos_modelos IS 'Modelos de moto (Bera SBR 150, Empire Horse, Yamaha FZ 16...). Sirve para buscar «qué repuestos le sirven a esta moto».';

CREATE TABLE productos (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku                VARCHAR(40)  NOT NULL,
    codigo_barras      VARCHAR(40),
    referencia_fabricante VARCHAR(60),
    nombre             VARCHAR(200) NOT NULL,
    descripcion        TEXT,
    categoria_id       BIGINT       REFERENCES categorias(id),
    marca_id           BIGINT       REFERENCES marcas(id),
    unidad             VARCHAR(10)  NOT NULL DEFAULT 'UND',
    ubicacion_almacen  VARCHAR(60),
    -- Costos y precios (siempre USD)
    costo_usd          NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (costo_usd >= 0),
    margen_pct         NUMERIC(7,2)  CHECK (margen_pct IS NULL OR (margen_pct >= 0 AND margen_pct <= 1000)),
    precio_venta_usd   NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (precio_venta_usd >= 0),
    exento_iva         BOOLEAN      NOT NULL DEFAULT FALSE,
    exonerado_iva      BOOLEAN      NOT NULL DEFAULT FALSE,   -- exonerado por decreto temporal (distinto de exento)
    -- Existencias
    stock_actual       NUMERIC(14,3) NOT NULL DEFAULT 0,
    stock_minimo       NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
    activo             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_productos_sku    ON productos (upper(sku));
CREATE UNIQUE INDEX uq_productos_barras ON productos (codigo_barras) WHERE codigo_barras IS NOT NULL;
CREATE INDEX ix_productos_nombre_trgm   ON productos USING gin (nombre gin_trgm_ops);
CREATE INDEX ix_productos_categoria     ON productos (categoria_id);
CREATE INDEX ix_productos_ref           ON productos (upper(referencia_fabricante)) WHERE referencia_fabricante IS NOT NULL;
COMMENT ON TABLE  productos IS 'Catálogo. El precio en bolívares NO existe aquí: se calcula con la tasa del día (ver v_productos_precios).';
COMMENT ON COLUMN productos.costo_usd IS 'Costo del inventario en USD. Sin IVA si el negocio recupera crédito fiscal; con IVA si no. Lo actualiza el trigger de compras según negocio.metodo_costo.';
COMMENT ON COLUMN productos.margen_pct IS 'Margen propio del producto (sobre el costo). NULL = hereda de la categoría y luego del negocio. Al cambiarlo, el precio se recalcula en el acto.';
COMMENT ON COLUMN productos.precio_venta_usd IS 'Precio vigente en USD (confirmado). Con política AVISAR no cambia solo cuando sube el costo: se crea una alerta en alertas_precio.';
COMMENT ON COLUMN productos.stock_actual IS 'Existencia. SOLO la modifica el trigger de movimientos_inventario; nunca se actualiza a mano.';

CREATE TABLE producto_compatibilidad (
    producto_id     BIGINT   NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    moto_modelo_id  BIGINT   NOT NULL REFERENCES motos_modelos(id) ON DELETE CASCADE,
    anio_desde      SMALLINT CHECK (anio_desde BETWEEN 1950 AND 2100),
    anio_hasta      SMALLINT CHECK (anio_hasta BETWEEN 1950 AND 2100),
    PRIMARY KEY (producto_id, moto_modelo_id),
    CHECK (anio_hasta IS NULL OR anio_desde IS NULL OR anio_hasta >= anio_desde)
);
CREATE INDEX ix_compat_moto ON producto_compatibilidad (moto_modelo_id);
COMMENT ON TABLE producto_compatibilidad IS 'Qué modelos de moto (y años) acepta cada repuesto.';

-- -----------------------------------------------------------------------------
--  4. PRECIOS: HISTORIAL Y ALERTAS
-- -----------------------------------------------------------------------------
CREATE TABLE historial_costos (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    producto_id      BIGINT        NOT NULL REFERENCES productos(id),
    costo_anterior_usd NUMERIC(18,4) NOT NULL,
    costo_nuevo_usd  NUMERIC(18,4) NOT NULL,
    metodo_costo     VARCHAR(10)   NOT NULL,
    compra_detalle_id BIGINT,
    fecha            TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ix_hist_costos_prod ON historial_costos (producto_id, fecha DESC);
COMMENT ON TABLE historial_costos IS 'Historia del costo de un producto: el costo inicial (CREACION) y cada cambio posterior con la compra que lo causó.';

CREATE TABLE historial_precios (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    producto_id        BIGINT        NOT NULL REFERENCES productos(id),
    precio_anterior_usd NUMERIC(18,4) NOT NULL,
    precio_nuevo_usd   NUMERIC(18,4) NOT NULL,
    margen_pct         NUMERIC(7,2),
    motivo             VARCHAR(30)   NOT NULL CHECK (motivo IN ('CREACION','CAMBIO_MARGEN','COSTO_AUTOMATICO','ALERTA_APLICADA','RECALCULO','MANUAL')),
    usuario_id         BIGINT,
    fecha              TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ix_hist_precios_prod ON historial_precios (producto_id, fecha DESC);
COMMENT ON TABLE historial_precios IS 'Cada cambio de precio de venta (USD) con su motivo.';

CREATE TABLE alertas_precio (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    producto_id         BIGINT        NOT NULL REFERENCES productos(id),
    costo_nuevo_usd     NUMERIC(18,4) NOT NULL,
    margen_pct          NUMERIC(7,2)  NOT NULL,
    precio_actual_usd   NUMERIC(18,4) NOT NULL,
    precio_sugerido_usd NUMERIC(18,4) NOT NULL,
    estado              VARCHAR(10)   NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','APLICADA','DESCARTADA')),
    compra_detalle_id   BIGINT,
    creada_en           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    resuelta_en         TIMESTAMPTZ,
    resuelta_por        BIGINT
);
-- máximo una alerta pendiente por producto (la nueva reemplaza a la anterior)
CREATE UNIQUE INDEX uq_alerta_pendiente ON alertas_precio (producto_id) WHERE estado = 'PENDIENTE';
COMMENT ON TABLE alertas_precio IS 'Política AVISAR: cuando llega mercancía con otro costo, el sistema propone un precio nuevo y espera confirmación (sp_resolver_alerta_precio).';

-- -----------------------------------------------------------------------------
--  5. TERCEROS
-- -----------------------------------------------------------------------------
CREATE TABLE proveedores (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rif           VARCHAR(15)  NOT NULL,   -- validado por ck_proveedores_rif (fn_validar_rif, definido en el archivo 02)
    razon_social  VARCHAR(200) NOT NULL,
    telefono      VARCHAR(40),
    correo        VARCHAR(150),
    direccion     TEXT,
    activo        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_proveedores_rif ON proveedores (upper(rif));
COMMENT ON COLUMN proveedores.rif IS 'RIF correcto y vigente (formato y dígito verificador validados): sin él no se puede tomar crédito fiscal de la factura de compra.';

CREATE TABLE clientes (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo_documento  CHAR(1)      NOT NULL CHECK (tipo_documento IN ('V','E','J','G','P','C')),
    documento       VARCHAR(20)  NOT NULL,
    nombre          VARCHAR(200) NOT NULL,
    telefono        VARCHAR(40),
    correo          VARCHAR(150),
    direccion       TEXT,
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (tipo_documento, documento)
);
CREATE INDEX ix_clientes_nombre_trgm ON clientes USING gin (nombre gin_trgm_ops);
COMMENT ON TABLE clientes IS 'Clientes (cédula V/E, RIF J/G, pasaporte P, C comunal). Una venta puede registrarse sin cliente (consumidor final).';

-- -----------------------------------------------------------------------------
--  6. MÉTODOS DE PAGO
-- -----------------------------------------------------------------------------
CREATE TABLE metodos_pago (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre       VARCHAR(60) NOT NULL,
    moneda       CHAR(3)     NOT NULL REFERENCES monedas(codigo),
    es_divisa    BOOLEAN     NOT NULL DEFAULT FALSE,
    aplica_igtf  BOOLEAN     NOT NULL DEFAULT FALSE,
    requiere_referencia BOOLEAN NOT NULL DEFAULT FALSE,
    activo       BOOLEAN     NOT NULL DEFAULT TRUE,
    CONSTRAINT ck_igtf_solo_divisa CHECK (NOT aplica_igtf OR es_divisa)
);
CREATE UNIQUE INDEX uq_metodos_pago_nombre ON metodos_pago (lower(nombre));
COMMENT ON TABLE  metodos_pago IS 'Formas de pago. aplica_igtf marca las divisas que NO pasan por la banca venezolana (efectivo USD, Zelle, USDT): solo esas generan IGTF.';
COMMENT ON COLUMN metodos_pago.requiere_referencia IS 'La app debe pedir número de referencia (pago móvil, transferencia, Zelle...).';

-- -----------------------------------------------------------------------------
--  7. INVENTARIO: MOVIMIENTOS (KARDEX)
-- -----------------------------------------------------------------------------
CREATE TABLE movimientos_inventario (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    producto_id      BIGINT        NOT NULL REFERENCES productos(id),
    tipo             VARCHAR(20)   NOT NULL CHECK (tipo IN ('COMPRA','VENTA','ANULACION_VENTA','ANULACION_COMPRA','AJUSTE_ENTRADA','AJUSTE_SALIDA','INVENTARIO_INICIAL')),
    cantidad         NUMERIC(14,3) NOT NULL CHECK (cantidad <> 0),
    stock_resultante NUMERIC(14,3),
    referencia_tipo  VARCHAR(20),
    referencia_id    BIGINT,
    motivo           TEXT,
    usuario_id       BIGINT,
    fecha            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    -- las entradas suman y las salidas restan
    CONSTRAINT ck_mov_signo CHECK (
        (tipo IN ('COMPRA','ANULACION_VENTA','AJUSTE_ENTRADA','INVENTARIO_INICIAL') AND cantidad > 0) OR
        (tipo IN ('VENTA','ANULACION_COMPRA','AJUSTE_SALIDA') AND cantidad < 0))
);
CREATE INDEX ix_mov_producto ON movimientos_inventario (producto_id, fecha DESC);
CREATE INDEX ix_mov_ref      ON movimientos_inventario (referencia_tipo, referencia_id);
COMMENT ON TABLE  movimientos_inventario IS 'Kardex: toda entrada o salida de mercancía. Inmutable. El stock del producto se calcula aquí (trigger) con bloqueo de fila, así dos cajas no pueden vender la misma última unidad.';
COMMENT ON COLUMN movimientos_inventario.cantidad IS 'Con signo: positivo entra, negativo sale.';

-- -----------------------------------------------------------------------------
--  8. COMPRAS
-- -----------------------------------------------------------------------------
CREATE TABLE compras (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proveedor_id          BIGINT        NOT NULL REFERENCES proveedores(id),
    numero_factura        VARCHAR(40)   NOT NULL,
    numero_control        VARCHAR(40),
    fecha_factura         DATE          NOT NULL,
    moneda                CHAR(3)       NOT NULL REFERENCES monedas(codigo),
    tasa_cambio           NUMERIC(20,8) NOT NULL DEFAULT 1 CHECK (tasa_cambio > 0),
    tasa_fecha_valor      DATE,
    aplica_credito_fiscal BOOLEAN,
    -- Totales en la moneda de la factura
    base_imponible        NUMERIC(18,2) NOT NULL DEFAULT 0,
    base_exenta           NUMERIC(18,2) NOT NULL DEFAULT 0,
    monto_iva             NUMERIC(18,2) NOT NULL DEFAULT 0,
    total                 NUMERIC(18,2) NOT NULL DEFAULT 0,
    -- Equivalente en USD
    total_usd             NUMERIC(18,2) NOT NULL DEFAULT 0,
    estado                VARCHAR(10)   NOT NULL DEFAULT 'REGISTRADA' CHECK (estado IN ('REGISTRADA','ANULADA')),
    observaciones         TEXT,
    usuario_id            BIGINT        NOT NULL,
    creada_txid           xid8          NOT NULL DEFAULT pg_current_xact_id(),
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    anulada_en            TIMESTAMPTZ,
    anulada_por           BIGINT,
    motivo_anulacion      TEXT,
    UNIQUE (proveedor_id, numero_factura)
);
CREATE INDEX ix_compras_fecha ON compras (fecha_factura);
COMMENT ON TABLE  compras IS 'Factura de compra al proveedor. Los totales los calculan los triggers a partir del detalle. La tasa se congela al registrar.';
COMMENT ON COLUMN compras.aplica_credito_fiscal IS 'NULL al insertar = toma negocio.recupera_credito_fiscal. FALSE: el IVA se suma al costo del inventario.';
COMMENT ON COLUMN compras.creada_txid IS 'Transacción que creó la compra: el detalle solo se puede agregar en esa misma transacción.';

CREATE TABLE compra_detalle (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    compra_id               BIGINT        NOT NULL REFERENCES compras(id),
    producto_id             BIGINT        NOT NULL REFERENCES productos(id),
    cantidad                NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
    costo_unitario          NUMERIC(18,4) NOT NULL CHECK (costo_unitario >= 0),
    exento                  BOOLEAN,
    iva_pct                 NUMERIC(7,4),
    base                    NUMERIC(18,2),
    monto_iva               NUMERIC(18,2),
    costo_unitario_usd      NUMERIC(18,4),
    costo_inventario_unit_usd NUMERIC(18,4)
);
CREATE INDEX ix_compra_det_compra ON compra_detalle (compra_id);
CREATE INDEX ix_compra_det_prod   ON compra_detalle (producto_id);
COMMENT ON COLUMN compra_detalle.costo_unitario IS 'Precio unitario SIN IVA, en la moneda de la factura (lo que aparece como base imponible).';
COMMENT ON COLUMN compra_detalle.costo_unitario_usd IS 'costo_unitario convertido a USD con la tasa de la factura (la calcula el trigger).';
COMMENT ON COLUMN compra_detalle.costo_inventario_unit_usd IS 'Costo que entra al inventario: sin IVA si hay crédito fiscal; con IVA si no. Es el valor que alimenta productos.costo_usd.';

-- -----------------------------------------------------------------------------
--  9. VENTAS
-- -----------------------------------------------------------------------------
CREATE SEQUENCE seq_numero_venta START 1;

CREATE TABLE ventas (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero               BIGINT        NOT NULL DEFAULT nextval('seq_numero_venta') UNIQUE,
    numero_factura_fiscal VARCHAR(40)  UNIQUE,
    numero_control       VARCHAR(40),
    tipo_emision         VARCHAR(20)   NOT NULL DEFAULT 'PRESENCIAL' CHECK (tipo_emision IN ('PRESENCIAL','DIGITAL','MAQUINA_FISCAL')),
    cliente_id           BIGINT        REFERENCES clientes(id),
    usuario_id           BIGINT        NOT NULL,
    fecha_hora           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    fecha_valor          DATE,
    -- Tasa congelada al momento de la venta
    tasa_cambio          NUMERIC(20,8),
    tasa_fecha_valor     DATE,
    -- Parámetros fiscales congelados
    iva_pct              NUMERIC(7,4),
    precios_incluyen_iva BOOLEAN,
    cobra_igtf           BOOLEAN,
    igtf_pct             NUMERIC(7,4),
    igtf_base            VARCHAR(8),
    -- Totales en USD
    base_usd             NUMERIC(18,2) NOT NULL DEFAULT 0,
    exento_usd           NUMERIC(18,2) NOT NULL DEFAULT 0,
    iva_usd              NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_usd            NUMERIC(18,2) NOT NULL DEFAULT 0,
    igtf_usd             NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_cobrar_usd     NUMERIC(18,2) NOT NULL DEFAULT 0,
    -- Totales en bolívares (documento fiscal)
    base_ves             NUMERIC(18,2) NOT NULL DEFAULT 0,
    exento_ves           NUMERIC(18,2) NOT NULL DEFAULT 0,
    iva_ves              NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_ves            NUMERIC(18,2) NOT NULL DEFAULT 0,
    igtf_ves             NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_cobrar_ves     NUMERIC(18,2) NOT NULL DEFAULT 0,
    estado               VARCHAR(10)   NOT NULL DEFAULT 'COMPLETADA' CHECK (estado IN ('COMPLETADA','ANULADA')),
    observaciones        TEXT,
    creada_txid          xid8          NOT NULL DEFAULT pg_current_xact_id(),
    anulada_en           TIMESTAMPTZ,
    anulada_por          BIGINT,
    motivo_anulacion     TEXT
);
CREATE INDEX ix_ventas_fecha    ON ventas (fecha_valor);
CREATE INDEX ix_ventas_cliente  ON ventas (cliente_id);
CREATE INDEX ix_ventas_usuario  ON ventas (usuario_id, fecha_hora);
COMMENT ON TABLE  ventas IS 'Cabecera de venta. Fecha, tasa y alícuotas las fija el trigger al insertar (el cliente de la API no puede elegirlas). Totales: los mantienen los triggers.';
COMMENT ON COLUMN ventas.total_usd IS 'Total de la mercancía con IVA, SIN IGTF.';
COMMENT ON COLUMN ventas.total_cobrar_usd IS 'total_usd + igtf_usd: lo que realmente paga el cliente.';
COMMENT ON COLUMN ventas.total_ves IS 'Total en bolívares del documento (suma de líneas redondeadas en Bs).';
COMMENT ON COLUMN ventas.creada_txid IS 'Detalle y pagos solo se pueden insertar en la transacción que creó la venta.';

CREATE TABLE detalle_venta (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    venta_id            BIGINT        NOT NULL REFERENCES ventas(id),
    producto_id         BIGINT        NOT NULL REFERENCES productos(id),
    descripcion         VARCHAR(200),
    cantidad            NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
    precio_unitario_usd NUMERIC(18,4),
    costo_unitario_usd  NUMERIC(18,4),
    descuento_pct       NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
    exento              BOOLEAN,
    alicuota_codigo     VARCHAR(20)   CHECK (alicuota_codigo IN ('IVA_GENERAL','EXENTO','EXONERADO')),
    iva_pct             NUMERIC(7,4),
    base_usd            NUMERIC(18,2),
    iva_usd             NUMERIC(18,2),
    total_usd           NUMERIC(18,2),
    base_ves            NUMERIC(18,2),
    iva_ves             NUMERIC(18,2),
    total_ves           NUMERIC(18,2)
);
CREATE INDEX ix_det_venta_venta ON detalle_venta (venta_id);
CREATE INDEX ix_det_venta_prod  ON detalle_venta (producto_id);
COMMENT ON COLUMN detalle_venta.precio_unitario_usd IS 'Precio vigente del producto al vender (congelado). Lo asigna el trigger.';
COMMENT ON COLUMN detalle_venta.costo_unitario_usd  IS 'Costo del producto al vender (congelado): permite calcular la utilidad real aunque el costo cambie después.';

CREATE TABLE pagos_venta (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    venta_id           BIGINT        NOT NULL REFERENCES ventas(id),
    metodo_pago_id     BIGINT        NOT NULL REFERENCES metodos_pago(id),
    moneda             CHAR(3),
    monto              NUMERIC(18,2) NOT NULL CHECK (monto > 0),
    referencia         VARCHAR(60),
    tasa_cambio        NUMERIC(20,8),
    monto_usd          NUMERIC(18,2),
    monto_ves          NUMERIC(18,2),
    aplica_igtf        BOOLEAN,
    igtf_monto         NUMERIC(18,2),
    igtf_usd           NUMERIC(18,2),
    igtf_ves           NUMERIC(18,2),
    monto_cobrado      NUMERIC(18,2),
    monto_entregado    NUMERIC(18,2),
    vuelto_monto       NUMERIC(18,2) CHECK (vuelto_monto IS NULL OR vuelto_monto >= 0),
    vuelto_moneda      CHAR(3)       REFERENCES monedas(codigo)
);
CREATE INDEX ix_pagos_venta ON pagos_venta (venta_id);
COMMENT ON TABLE  pagos_venta IS 'Pagos mixtos: una venta puede pagarse con varios métodos y monedas. La suma de monto_usd debe igualar total_usd de la venta (se verifica al confirmar la transacción).';
COMMENT ON COLUMN pagos_venta.monto IS 'Parte de la venta que cubre este pago, en la moneda del pago (sin IGTF).';
COMMENT ON COLUMN pagos_venta.igtf_monto IS 'IGTF de este pago, en la moneda del pago (solo si el método aplica IGTF y el negocio lo cobra).';
COMMENT ON COLUMN pagos_venta.monto_cobrado IS 'monto + igtf_monto: lo que el cliente entrega por este pago, en su moneda.';
COMMENT ON COLUMN pagos_venta.monto_entregado IS 'Efectivo que realmente entregó el cliente (informativo, para el cierre de caja).';
COMMENT ON COLUMN pagos_venta.vuelto_monto IS 'Vuelto entregado (puede ser en otra moneda que el pago). Informativo, para el cierre de caja.';

CREATE TABLE ventas_tasas (
    venta_id     BIGINT        NOT NULL REFERENCES ventas(id),
    moneda       CHAR(3)       NOT NULL REFERENCES monedas(codigo),
    tasa         NUMERIC(20,8) NOT NULL CHECK (tasa > 0),
    fecha_valor  DATE          NOT NULL,
    PRIMARY KEY (venta_id, moneda),
    CHECK (moneda NOT IN ('USD', 'VES'))
);
CREATE INDEX ix_ventas_tasas_venta ON ventas_tasas (venta_id);
COMMENT ON TABLE  ventas_tasas IS 'Tasas congeladas de las monedas de pago distintas de USD y VES (EUR, COP, etc.). USD y VES ya están congeladas en ventas.tasa_cambio; aquí solo entran las demás. Se llena automáticamente al insertar un pago en otra moneda. Inmutable.';
COMMENT ON COLUMN ventas_tasas.venta_id IS 'Venta a la que se congela la tasa.';
COMMENT ON COLUMN ventas_tasas.moneda IS 'Moneda de pago (distinta de USD y VES).';
COMMENT ON COLUMN ventas_tasas.tasa IS 'Tasa moneda → VES (bolívares por 1 unidad de la moneda) congelada al momento de la venta.';
COMMENT ON COLUMN ventas_tasas.fecha_valor IS 'Fecha-valor de la tasa usada.';

-- ---------------------------------------------------------------------------
--  Ajustes fiscales 2026: exoneración, tipo de emisión, alícuota por línea, notas de crédito/débito
-- ---------------------------------------------------------------------------
ALTER TABLE productos ADD CONSTRAINT ck_exento_o_exonerado CHECK (NOT (exento_iva AND exonerado_iva));
COMMENT ON COLUMN productos.exento_iva IS 'TRUE = exento de IVA por disposición legal permanente: se vende sin IVA.';
COMMENT ON COLUMN productos.exonerado_iva IS 'TRUE = exonerado del IVA por decreto/Gaceta temporal: se vende sin IVA mientras dure la exoneración. Se separa de exento_iva para discriminarlo en el libro de ventas y poder reactivar el IVA al vencer el decreto.';
COMMENT ON COLUMN ventas.tipo_emision IS 'Forma de emisión del documento: PRESENCIAL, DIGITAL o MAQUINA_FISCAL. Las operaciones por medios digitales y por máquina fiscal deben llevarse separadas en el libro de ventas (informe fiscal 2026; confirmar con el contador).';
COMMENT ON COLUMN detalle_venta.alicuota_codigo IS 'Alícuota aplicada a la línea (la asigna el trigger): IVA_GENERAL, EXENTO o EXONERADO. Permite discriminar el libro de ventas.';

-- Notas de crédito / débito emitidas sobre una venta. Registro inmutable; aparecen en v_libro_ventas.
-- NO modifican el stock (una devolución física se registra con sp_ajustar_stock o anulando la venta completa).
CREATE TABLE notas_ajuste (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo            CHAR(1)       NOT NULL CHECK (tipo IN ('C','D')),
    venta_id        BIGINT        NOT NULL REFERENCES ventas(id),
    numero          VARCHAR(40)   NOT NULL,
    numero_control  VARCHAR(40),
    fecha           DATE          NOT NULL,
    iva_pct         NUMERIC(7,4)  NOT NULL,
    base_ves        NUMERIC(18,2) NOT NULL CHECK (base_ves > 0),
    iva_ves         NUMERIC(18,2) NOT NULL CHECK (iva_ves >= 0),
    total_ves       NUMERIC(18,2) NOT NULL,
    motivo          TEXT          NOT NULL,
    usuario_id      BIGINT,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (tipo, numero),
    CONSTRAINT ck_nota_total CHECK (total_ves = base_ves + iva_ves)
);
CREATE INDEX ix_notas_ajuste_venta ON notas_ajuste (venta_id);
COMMENT ON TABLE notas_ajuste IS 'Notas de crédito (C) y de débito (D) sobre ventas, en Bs. Inmutables. No afectan el stock.';
COMMENT ON COLUMN notas_ajuste.tipo IS 'C = nota de crédito (resta en el libro de ventas), D = nota de débito (suma).';
COMMENT ON COLUMN notas_ajuste.base_ves IS 'Base imponible de la nota en Bs (positiva). El IVA se calcula con la alícuota de la venta original.';

-- Reversión del IGTF cuando se anula una venta (si negocio.reversa_igtf_en_anulacion = TRUE). Una fila por pago con IGTF.
-- Inmutable. Se usa en v_igtf_neto_diario. La regla legal de cómo se devuelve/acredita NO está definida aquí: solo se registra.
CREATE TABLE reversiones_igtf (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    venta_id        BIGINT        NOT NULL REFERENCES ventas(id),
    pago_venta_id   BIGINT        NOT NULL UNIQUE REFERENCES pagos_venta(id),
    igtf_usd        NUMERIC(18,2) NOT NULL CHECK (igtf_usd > 0),
    igtf_ves        NUMERIC(18,2) NOT NULL CHECK (igtf_ves >= 0),
    fecha           DATE          NOT NULL,
    usuario_id      BIGINT,
    motivo          TEXT          NOT NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ix_reversiones_igtf_venta ON reversiones_igtf (venta_id);
CREATE INDEX ix_reversiones_igtf_fecha ON reversiones_igtf (fecha);
COMMENT ON TABLE  reversiones_igtf IS 'Reintegros de IGTF por reclamar: IGTF devuelto al cliente al anular una venta (una fila por pago con IGTF). Según las fuentes consultadas se reclama al SENIAT; no reduce el IGTF a declarar (v_igtf_a_declarar). Inmutable. Solo se llena si negocio.reversa_igtf_en_anulacion es TRUE.';
COMMENT ON COLUMN reversiones_igtf.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN reversiones_igtf.venta_id IS 'Venta anulada a la que pertenece la reversión.';
COMMENT ON COLUMN reversiones_igtf.pago_venta_id IS 'Pago cuyo IGTF se revierte (único: un pago solo se revierte una vez).';
COMMENT ON COLUMN reversiones_igtf.igtf_usd IS 'IGTF revertido en USD (el mismo que se cobró en el pago).';
COMMENT ON COLUMN reversiones_igtf.igtf_ves IS 'IGTF revertido en Bs, a la tasa congelada del pago original (no a la tasa del día de la anulación).';
COMMENT ON COLUMN reversiones_igtf.fecha IS 'Fecha (hora de Caracas) en que se anuló la venta y se registró la reversión; es el período en que v_igtf_neto_diario la resta.';
COMMENT ON COLUMN reversiones_igtf.usuario_id IS 'Usuario que anuló la venta.';
COMMENT ON COLUMN reversiones_igtf.motivo IS 'Motivo de la anulación.';
COMMENT ON COLUMN reversiones_igtf.created_at IS 'Fecha y hora de creación del registro.';

-- ---------------------------------------------------------------------------
--  Documentación completa del catálogo (todas las tablas, columnas y rutinas públicas)
--  Verificada por pruebas/test_db_esquema.py: ninguna tabla ni columna puede quedar sin COMMENT.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE categorias IS 'Clasificación de productos; puede traer un margen por defecto.';
COMMENT ON TABLE compra_detalle IS 'Líneas de una compra: costo sin IVA, IVA y costo de inventario por unidad. Inmutable; solo se inserta en la transacción que crea la compra.';
COMMENT ON TABLE detalle_venta IS 'Líneas de una venta con precio, costo, IVA y Bs congelados. Inmutable; solo se inserta en la transacción que crea la venta.';
COMMENT ON TABLE proveedores IS 'Proveedores de mercancía (RIF único).';
COMMENT ON COLUMN alertas_precio.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN alertas_precio.producto_id IS 'Producto (productos.id).';
COMMENT ON COLUMN alertas_precio.costo_nuevo_usd IS 'Costo nuevo (USD) que originó la alerta.';
COMMENT ON COLUMN alertas_precio.margen_pct IS 'Margen aplicado para calcular el precio sugerido.';
COMMENT ON COLUMN alertas_precio.precio_actual_usd IS 'Precio de venta vigente cuando se creó la alerta.';
COMMENT ON COLUMN alertas_precio.precio_sugerido_usd IS 'Precio que resulta de costo nuevo + margen.';
COMMENT ON COLUMN alertas_precio.estado IS 'PENDIENTE (por decidir), APLICADA (se cambió el precio) o DESCARTADA.';
COMMENT ON COLUMN alertas_precio.compra_detalle_id IS 'Línea de compra que originó este registro (compra_detalle.id).';
COMMENT ON COLUMN alertas_precio.creada_en IS 'Fecha y hora en que se generó la alerta.';
COMMENT ON COLUMN alertas_precio.resuelta_en IS 'Fecha y hora en que se resolvió.';
COMMENT ON COLUMN alertas_precio.resuelta_por IS 'Usuario que la resolvió.';
COMMENT ON COLUMN categorias.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN categorias.nombre IS 'Nombre de la categoría (único sin distinguir mayúsculas).';
COMMENT ON COLUMN categorias.activa IS 'FALSE = deshabilitada: deja de ofrecerse pero se conserva el historial.';
COMMENT ON COLUMN categorias.created_at IS 'Fecha y hora de creación del registro.';
COMMENT ON COLUMN categorias.updated_at IS 'Fecha y hora de la última modificación (la actualiza un trigger).';
COMMENT ON COLUMN clientes.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN clientes.tipo_documento IS 'V, E, J, G, P o C (cédula, extranjero, RIF jurídico, gobierno, pasaporte, comuna).';
COMMENT ON COLUMN clientes.documento IS 'Número de documento sin letra.';
COMMENT ON COLUMN clientes.nombre IS 'Nombre o razón social.';
COMMENT ON COLUMN clientes.telefono IS 'Teléfono de contacto.';
COMMENT ON COLUMN clientes.correo IS 'Correo electrónico de contacto.';
COMMENT ON COLUMN clientes.direccion IS 'Dirección.';
COMMENT ON COLUMN clientes.activo IS 'FALSE = deshabilitado: deja de ofrecerse pero se conserva el historial.';
COMMENT ON COLUMN clientes.created_at IS 'Fecha y hora de creación del registro.';
COMMENT ON COLUMN clientes.updated_at IS 'Fecha y hora de la última modificación (la actualiza un trigger).';
COMMENT ON COLUMN compra_detalle.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN compra_detalle.compra_id IS 'Compra (compras.id).';
COMMENT ON COLUMN compra_detalle.producto_id IS 'Producto (productos.id).';
COMMENT ON COLUMN compra_detalle.cantidad IS 'Unidades compradas (> 0).';
COMMENT ON COLUMN compra_detalle.exento IS 'Si la línea no causa IVA; si es NULL toma el valor del producto.';
COMMENT ON COLUMN compra_detalle.iva_pct IS 'Porcentaje de IVA aplicado a la línea (0 si es exenta).';
COMMENT ON COLUMN compra_detalle.base IS 'Base de la línea en la moneda de la factura = cantidad × costo (calculado por trigger).';
COMMENT ON COLUMN compra_detalle.monto_iva IS 'IVA de la línea en la moneda de la factura (calculado por trigger).';
COMMENT ON COLUMN compras.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN compras.proveedor_id IS 'Proveedor (proveedores.id).';
COMMENT ON COLUMN compras.numero_factura IS 'Número de la factura del proveedor (único por proveedor).';
COMMENT ON COLUMN compras.numero_control IS 'Número de control de la factura (lo asigna la imprenta digital o máquina fiscal).';
COMMENT ON COLUMN compras.fecha_factura IS 'Fecha de emisión de la factura del proveedor.';
COMMENT ON COLUMN compras.moneda IS 'Moneda de la factura: USD o VES.';
COMMENT ON COLUMN compras.tasa_cambio IS '1 si la factura es en USD; si es en Bs, la tasa congelada (Bs por USD).';
COMMENT ON COLUMN compras.tasa_fecha_valor IS 'Fecha valor de la tasa usada (puede ser anterior a hoy en fines de semana/feriados).';
COMMENT ON COLUMN compras.base_imponible IS 'Suma de bases gravadas, en la moneda de la factura.';
COMMENT ON COLUMN compras.base_exenta IS 'Suma de bases exentas, en la moneda de la factura.';
COMMENT ON COLUMN compras.monto_iva IS 'IVA total, en la moneda de la factura.';
COMMENT ON COLUMN compras.total IS 'Total de la factura en su moneda.';
COMMENT ON COLUMN compras.total_usd IS 'Total de la factura expresado en USD.';
COMMENT ON COLUMN compras.estado IS 'REGISTRADA o ANULADA.';
COMMENT ON COLUMN compras.observaciones IS 'Notas libres del operador.';
COMMENT ON COLUMN compras.usuario_id IS 'ID del usuario de la aplicación que realizó la operación (sin FK: los usuarios los administra la app).';
COMMENT ON COLUMN compras.created_at IS 'Fecha y hora de creación del registro.';
COMMENT ON COLUMN compras.anulada_en IS 'Fecha y hora de la anulación.';
COMMENT ON COLUMN compras.anulada_por IS 'Usuario que anuló el documento.';
COMMENT ON COLUMN compras.motivo_anulacion IS 'Motivo de la anulación.';
COMMENT ON COLUMN detalle_venta.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN detalle_venta.venta_id IS 'Venta (ventas.id).';
COMMENT ON COLUMN detalle_venta.producto_id IS 'Producto (productos.id).';
COMMENT ON COLUMN detalle_venta.descripcion IS 'Nombre del producto copiado al vender (no cambia si luego se renombra).';
COMMENT ON COLUMN detalle_venta.cantidad IS 'Unidades vendidas (> 0).';
COMMENT ON COLUMN detalle_venta.descuento_pct IS 'Descuento % de la línea (0–100).';
COMMENT ON COLUMN detalle_venta.exento IS 'TRUE si la línea no lleva IVA (exento o exonerado).';
COMMENT ON COLUMN detalle_venta.iva_pct IS 'Porcentaje de IVA aplicado, congelado al registrar.';
COMMENT ON COLUMN detalle_venta.base_usd IS 'Base de la línea en USD.';
COMMENT ON COLUMN detalle_venta.iva_usd IS 'IVA de la línea en USD.';
COMMENT ON COLUMN detalle_venta.total_usd IS 'Total de la línea en USD.';
COMMENT ON COLUMN detalle_venta.base_ves IS 'Base de la línea en Bs (base USD × tasa).';
COMMENT ON COLUMN detalle_venta.iva_ves IS 'IVA de la línea en Bs (base Bs × alícuota).';
COMMENT ON COLUMN detalle_venta.total_ves IS 'Total de la línea en Bs.';
COMMENT ON COLUMN historial_costos.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN historial_costos.producto_id IS 'Producto (productos.id).';
COMMENT ON COLUMN historial_costos.costo_anterior_usd IS 'Costo antes del cambio.';
COMMENT ON COLUMN historial_costos.costo_nuevo_usd IS 'Costo después del cambio.';
COMMENT ON COLUMN historial_costos.metodo_costo IS 'ULTIMO, PROMEDIO, MANUAL (edición directa) o CREACION (costo inicial al dar de alta el producto).';
COMMENT ON COLUMN historial_costos.compra_detalle_id IS 'Línea de compra que originó este registro (compra_detalle.id).';
COMMENT ON COLUMN historial_costos.fecha IS 'Fecha y hora del cambio.';
COMMENT ON COLUMN historial_precios.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN historial_precios.producto_id IS 'Producto (productos.id).';
COMMENT ON COLUMN historial_precios.precio_anterior_usd IS 'Precio antes del cambio.';
COMMENT ON COLUMN historial_precios.precio_nuevo_usd IS 'Precio después del cambio.';
COMMENT ON COLUMN historial_precios.margen_pct IS 'Margen efectivo vigente al momento del cambio.';
COMMENT ON COLUMN historial_precios.motivo IS 'CREACION, CAMBIO_MARGEN, COSTO_AUTOMATICO, ALERTA_APLICADA, RECALCULO o MANUAL.';
COMMENT ON COLUMN historial_precios.usuario_id IS 'ID del usuario de la aplicación que realizó la operación (sin FK: los usuarios los administra la app).';
COMMENT ON COLUMN historial_precios.fecha IS 'Fecha y hora del evento.';
COMMENT ON COLUMN log_tasas_cambio.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN log_tasas_cambio.tasa_cambio_id IS 'ID de la tasa afectada (sin FK: puede haberse borrado).';
COMMENT ON COLUMN log_tasas_cambio.accion IS 'INSERT, UPDATE o DELETE sobre tasas_cambio.';
COMMENT ON COLUMN log_tasas_cambio.moneda_origen IS 'Moneda cotizada.';
COMMENT ON COLUMN log_tasas_cambio.moneda_destino IS 'Moneda de la cotización.';
COMMENT ON COLUMN log_tasas_cambio.fecha_valor IS 'Fecha valor de la tasa afectada.';
COMMENT ON COLUMN log_tasas_cambio.tasa_anterior IS 'Tasa antes de la corrección.';
COMMENT ON COLUMN log_tasas_cambio.tasa_nueva IS 'Tasa después del cambio.';
COMMENT ON COLUMN log_tasas_cambio.fuente IS 'Fuente de la tasa.';
COMMENT ON COLUMN log_tasas_cambio.usuario_id IS 'ID del usuario de la aplicación que realizó la operación (sin FK: los usuarios los administra la app).';
COMMENT ON COLUMN log_tasas_cambio.fecha IS 'Fecha y hora del evento.';
COMMENT ON COLUMN marcas.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN marcas.nombre IS 'Nombre de la marca (único sin distinguir mayúsculas).';
COMMENT ON COLUMN marcas.activa IS 'FALSE = deshabilitada: deja de ofrecerse pero se conserva el historial.';
COMMENT ON COLUMN metodos_pago.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN metodos_pago.nombre IS 'Nombre visible del método (Zelle, Pago móvil…).';
COMMENT ON COLUMN metodos_pago.moneda IS 'Moneda en la que se recibe el pago.';
COMMENT ON COLUMN metodos_pago.es_divisa IS 'TRUE si el pago es en divisas.';
COMMENT ON COLUMN metodos_pago.aplica_igtf IS 'TRUE si genera IGTF (solo divisas sin mediación bancaria venezolana).';
COMMENT ON COLUMN metodos_pago.activo IS 'FALSE = deshabilitado: deja de ofrecerse pero se conserva el historial.';
COMMENT ON COLUMN monedas.codigo IS 'Código ISO 4217 (USD, VES).';
COMMENT ON COLUMN monedas.nombre IS 'Nombre de la moneda.';
COMMENT ON COLUMN monedas.simbolo IS 'Símbolo para mostrar ($, Bs).';
COMMENT ON COLUMN monedas.activa IS 'FALSE = deshabilitada: deja de ofrecerse pero se conserva el historial.';
COMMENT ON COLUMN motos_modelos.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN motos_modelos.marca IS 'Marca de la moto.';
COMMENT ON COLUMN motos_modelos.modelo IS 'Modelo de la moto.';
COMMENT ON COLUMN motos_modelos.cilindrada IS 'Cilindrada en cm³.';
COMMENT ON COLUMN movimientos_inventario.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN movimientos_inventario.producto_id IS 'Producto (productos.id).';
COMMENT ON COLUMN movimientos_inventario.tipo IS 'COMPRA, VENTA, ANULACION_VENTA, ANULACION_COMPRA, AJUSTE_ENTRADA, AJUSTE_SALIDA o INVENTARIO_INICIAL.';
COMMENT ON COLUMN movimientos_inventario.stock_resultante IS 'Stock del producto justo después del movimiento (lo fija el trigger).';
COMMENT ON COLUMN movimientos_inventario.referencia_tipo IS 'Documento que origina el movimiento: COMPRA, VENTA o AJUSTE.';
COMMENT ON COLUMN movimientos_inventario.referencia_id IS 'ID del documento de origen.';
COMMENT ON COLUMN movimientos_inventario.motivo IS 'Motivo declarado por el operador (obligatorio en ajustes y anulaciones).';
COMMENT ON COLUMN movimientos_inventario.usuario_id IS 'ID del usuario de la aplicación que realizó la operación (sin FK: los usuarios los administra la app).';
COMMENT ON COLUMN movimientos_inventario.fecha IS 'Fecha y hora del movimiento.';
COMMENT ON COLUMN negocio.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN negocio.razon_social IS 'Razón social del negocio.';
COMMENT ON COLUMN negocio.nombre_comercial IS 'Nombre comercial (opcional).';
COMMENT ON COLUMN negocio.rif IS 'RIF del negocio (formato y dígito verificador validados con fn_validar_rif).';
COMMENT ON COLUMN negocio.direccion_fiscal IS 'Dirección fiscal.';
COMMENT ON COLUMN negocio.telefono IS 'Teléfono del negocio.';
COMMENT ON COLUMN negocio.correo IS 'Correo del negocio.';
COMMENT ON COLUMN negocio.reversa_igtf_en_anulacion IS 'TRUE (por defecto): al anular una venta se registra la reversión del IGTF cobrado en reversiones_igtf. FALSE: no se registra nada (el IGTF se considera no devuelto). DECISIÓN FISCAL SIN CONFIRMAR: validar con el contador cómo se devuelve o acredita el IGTF de una venta anulada.';
COMMENT ON COLUMN negocio.permitir_stock_negativo IS 'TRUE permite vender sin existencia suficiente (stock negativo).';
COMMENT ON COLUMN negocio.configurado_en IS 'Fecha en que se confirmó el asistente de primer inicio; NULL = ventas bloqueadas.';
COMMENT ON COLUMN negocio.configurado_por IS 'Usuario que confirmó la configuración.';
COMMENT ON COLUMN negocio.created_at IS 'Fecha y hora de creación del registro.';
COMMENT ON COLUMN negocio.updated_at IS 'Fecha y hora de la última modificación (la actualiza un trigger).';
COMMENT ON COLUMN notas_ajuste.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN notas_ajuste.venta_id IS 'Venta (ventas.id).';
COMMENT ON COLUMN notas_ajuste.numero IS 'Número de la nota (único por tipo).';
COMMENT ON COLUMN notas_ajuste.numero_control IS 'Número de control de la factura (lo asigna la imprenta digital o máquina fiscal).';
COMMENT ON COLUMN notas_ajuste.fecha IS 'Fecha de la nota.';
COMMENT ON COLUMN notas_ajuste.iva_pct IS 'Alícuota de IVA de la venta original.';
COMMENT ON COLUMN notas_ajuste.iva_ves IS 'IVA de la nota en Bs.';
COMMENT ON COLUMN notas_ajuste.total_ves IS 'Base + IVA en Bs.';
COMMENT ON COLUMN notas_ajuste.motivo IS 'Motivo de la nota (obligatorio).';
COMMENT ON COLUMN notas_ajuste.usuario_id IS 'ID del usuario de la aplicación que realizó la operación (sin FK: los usuarios los administra la app).';
COMMENT ON COLUMN notas_ajuste.created_at IS 'Fecha y hora de creación del registro.';
COMMENT ON COLUMN pagos_venta.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN pagos_venta.venta_id IS 'Venta (ventas.id).';
COMMENT ON COLUMN pagos_venta.metodo_pago_id IS 'Método de pago (metodos_pago.id).';
COMMENT ON COLUMN pagos_venta.moneda IS 'Moneda del método de pago (la fija el trigger).';
COMMENT ON COLUMN pagos_venta.referencia IS 'Referencia bancaria o comprobante (obligatoria en algunos métodos).';
COMMENT ON COLUMN pagos_venta.tasa_cambio IS '1 si el pago es en USD; si es en Bs, la tasa de la venta.';
COMMENT ON COLUMN pagos_venta.monto_usd IS 'Parte de la venta que cubre el pago, en USD.';
COMMENT ON COLUMN pagos_venta.monto_ves IS 'Parte de la venta que cubre el pago, en Bs.';
COMMENT ON COLUMN pagos_venta.aplica_igtf IS 'TRUE si este pago genera IGTF.';
COMMENT ON COLUMN pagos_venta.igtf_usd IS 'IGTF en USD.';
COMMENT ON COLUMN pagos_venta.igtf_ves IS 'IGTF en bolívares, con la tasa congelada.';
COMMENT ON COLUMN pagos_venta.vuelto_moneda IS 'Moneda en la que se entregó el vuelto.';
COMMENT ON COLUMN parametros_fiscales.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN parametros_fiscales.codigo IS 'IVA_GENERAL o IGTF_DIVISAS.';
COMMENT ON COLUMN parametros_fiscales.porcentaje IS 'Alícuota en %.';
COMMENT ON COLUMN parametros_fiscales.vigente_desde IS 'Primer día de vigencia.';
COMMENT ON COLUMN parametros_fiscales.vigente_hasta IS 'Último día de vigencia; NULL = sin fin.';
COMMENT ON COLUMN parametros_fiscales.nota IS 'Fuente o aclaración.';
COMMENT ON COLUMN parametros_fiscales.created_at IS 'Fecha y hora de creación del registro.';
COMMENT ON COLUMN producto_compatibilidad.producto_id IS 'Producto (productos.id).';
COMMENT ON COLUMN producto_compatibilidad.moto_modelo_id IS 'Modelo de moto (motos_modelos.id).';
COMMENT ON COLUMN producto_compatibilidad.anio_desde IS 'Primer año de fabricación compatible.';
COMMENT ON COLUMN producto_compatibilidad.anio_hasta IS 'Último año compatible; NULL = sin límite.';
COMMENT ON COLUMN productos.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN productos.sku IS 'Código interno único (sin distinguir mayúsculas).';
COMMENT ON COLUMN productos.codigo_barras IS 'Código de barras (único si se indica).';
COMMENT ON COLUMN productos.referencia_fabricante IS 'Referencia/OEM del fabricante.';
COMMENT ON COLUMN productos.nombre IS 'Nombre del producto.';
COMMENT ON COLUMN productos.descripcion IS 'Descripción ampliada.';
COMMENT ON COLUMN productos.categoria_id IS 'Categoría (categorias.id).';
COMMENT ON COLUMN productos.marca_id IS 'Marca (marcas.id).';
COMMENT ON COLUMN productos.unidad IS 'Unidad de medida (UND, PAR, JGO…).';
COMMENT ON COLUMN productos.ubicacion_almacen IS 'Ubicación en almacén (estante/gaveta).';
COMMENT ON COLUMN productos.stock_minimo IS 'Nivel mínimo antes de reponer (v_stock_bajo).';
COMMENT ON COLUMN productos.activo IS 'FALSE = deshabilitado: deja de ofrecerse pero se conserva el historial.';
COMMENT ON COLUMN productos.created_at IS 'Fecha y hora de creación del registro.';
COMMENT ON COLUMN productos.updated_at IS 'Fecha y hora de la última modificación (la actualiza un trigger).';
COMMENT ON COLUMN proveedores.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN proveedores.razon_social IS 'Razón social del proveedor.';
COMMENT ON COLUMN proveedores.telefono IS 'Teléfono de contacto.';
COMMENT ON COLUMN proveedores.correo IS 'Correo electrónico de contacto.';
COMMENT ON COLUMN proveedores.direccion IS 'Dirección.';
COMMENT ON COLUMN proveedores.activo IS 'FALSE = deshabilitado: deja de ofrecerse pero se conserva el historial.';
COMMENT ON COLUMN proveedores.created_at IS 'Fecha y hora de creación del registro.';
COMMENT ON COLUMN proveedores.updated_at IS 'Fecha y hora de la última modificación (la actualiza un trigger).';
COMMENT ON COLUMN tasas_cambio.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN tasas_cambio.moneda_origen IS 'Moneda que se cotiza (la que vale 1).';
COMMENT ON COLUMN tasas_cambio.moneda_destino IS 'Moneda en la que se expresa la cotización.';
COMMENT ON COLUMN tasas_cambio.fuente IS 'EXCHANGERATE_API, BCV o MANUAL.';
COMMENT ON COLUMN tasas_cambio.obtenida_en IS 'Momento en que se obtuvo o corrigió la tasa.';
COMMENT ON COLUMN tasas_cambio.usuario_id IS 'Usuario que la cargó (NULL si fue el job automático).';
COMMENT ON COLUMN ventas.id IS 'Identificador interno autonumérico.';
COMMENT ON COLUMN ventas.numero IS 'Número interno correlativo (puede tener saltos si una transacción se revierte; el número fiscal es otro).';
COMMENT ON COLUMN ventas.numero_factura_fiscal IS 'Número de factura fiscal asignado por el mecanismo de facturación (único).';
COMMENT ON COLUMN ventas.numero_control IS 'Número de control de la factura (lo asigna la imprenta digital o máquina fiscal).';
COMMENT ON COLUMN ventas.cliente_id IS 'Cliente (clientes.id); NULL = consumidor final.';
COMMENT ON COLUMN ventas.usuario_id IS 'ID del usuario de la aplicación que realizó la operación (sin FK: los usuarios los administra la app).';
COMMENT ON COLUMN ventas.fecha_hora IS 'Fecha y hora de la venta.';
COMMENT ON COLUMN ventas.fecha_valor IS 'Fecha fiscal de la operación (día de Venezuela).';
COMMENT ON COLUMN ventas.tasa_cambio IS 'Tasa USD→VES (Bs por 1 USD) congelada al registrar el documento.';
COMMENT ON COLUMN ventas.tasa_fecha_valor IS 'Fecha valor de la tasa usada (puede ser anterior a hoy en fines de semana/feriados).';
COMMENT ON COLUMN ventas.iva_pct IS 'Porcentaje de IVA aplicado, congelado al registrar.';
COMMENT ON COLUMN ventas.precios_incluyen_iva IS 'Configuración congelada: si los precios incluían IVA.';
COMMENT ON COLUMN ventas.cobra_igtf IS 'Configuración congelada: si el negocio cobraba IGTF.';
COMMENT ON COLUMN ventas.igtf_pct IS 'Porcentaje de IGTF congelado.';
COMMENT ON COLUMN ventas.igtf_base IS 'Base del IGTF congelada: CON_IVA o SIN_IVA.';
COMMENT ON COLUMN ventas.base_usd IS 'Base imponible gravada en USD.';
COMMENT ON COLUMN ventas.exento_usd IS 'Monto exento/exonerado en USD.';
COMMENT ON COLUMN ventas.iva_usd IS 'IVA total en USD.';
COMMENT ON COLUMN ventas.igtf_usd IS 'IGTF en USD.';
COMMENT ON COLUMN ventas.base_ves IS 'Base imponible gravada en Bs.';
COMMENT ON COLUMN ventas.exento_ves IS 'Monto exento/exonerado en Bs.';
COMMENT ON COLUMN ventas.iva_ves IS 'IVA total en Bs.';
COMMENT ON COLUMN ventas.igtf_ves IS 'IGTF en bolívares, con la tasa congelada.';
COMMENT ON COLUMN ventas.total_cobrar_ves IS 'Total a cobrar en Bs incluyendo IGTF.';
COMMENT ON COLUMN ventas.estado IS 'Estado del documento.';
COMMENT ON COLUMN ventas.observaciones IS 'Notas libres del operador.';
COMMENT ON COLUMN ventas.anulada_en IS 'Fecha y hora de la anulación.';
COMMENT ON COLUMN ventas.anulada_por IS 'Usuario que anuló el documento.';
COMMENT ON COLUMN ventas.motivo_anulacion IS 'Motivo de la anulación.';

-- ---------------------------------------------------------------------------
--  Idempotencia de la API (reintentos seguros)
-- ---------------------------------------------------------------------------
--  Si la red falla justo después de registrar una venta, la caja reintenta. Con la cabecera «Idempotency-Key» la API
--  guarda aquí la respuesta de la primera vez y la devuelve en los reintentos, en vez de duplicar la venta.
CREATE TABLE solicitudes_idempotentes (
    clave       VARCHAR(100) PRIMARY KEY,
    ruta        VARCHAR(100) NOT NULL,
    codigo_http SMALLINT,
    respuesta   JSONB,
    creada_en   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE solicitudes_idempotentes IS 'Respuestas guardadas por clave de idempotencia (API). Se pueden purgar pasadas 24 horas.';
COMMENT ON COLUMN solicitudes_idempotentes.clave IS 'Valor de la cabecera Idempotency-Key enviada por la caja (único).';
COMMENT ON COLUMN solicitudes_idempotentes.ruta IS 'Endpoint que originó la solicitud.';
COMMENT ON COLUMN solicitudes_idempotentes.codigo_http IS 'Código HTTP devuelto la primera vez.';
COMMENT ON COLUMN solicitudes_idempotentes.respuesta IS 'Cuerpo JSON devuelto la primera vez.';
COMMENT ON COLUMN solicitudes_idempotentes.creada_en IS 'Momento de la primera solicitud.';

-- ---------------------------------------------------------------------------
--  Blindaje contra NaN
-- ---------------------------------------------------------------------------
--  En PostgreSQL el valor numérico 'NaN' pasa los CHECK como (cantidad > 0) o (costo >= 0) porque NaN se considera
--  mayor que cualquier número. Un NaN en una cantidad o precio contaminaría stock y totales. Este bloque agrega a CADA
--  columna numeric del esquema un CHECK (col <> 'NaN'). (Infinity ya lo rechaza la precisión NUMERIC(p,s).)
--  Detectado por pruebas/test_db_esquema.py::test_numeric_especiales_rechazados_en_cantidades.
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT c.relname AS t, a.attname AS col
               FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
              WHERE c.relnamespace = 'tienda'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
                AND a.atttypid = 'numeric'::regtype ORDER BY 1, 2 LOOP
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I <> ''NaN''::numeric)', r.t, 'ck_sin_nan_' || r.t || '_' || r.col, r.col);
    END LOOP;
END $$;

-- Índices en claves foráneas que se usan en uniones/reportes (hallazgo de las pruebas de esquema)
CREATE INDEX ix_productos_marca ON productos (marca_id);
CREATE INDEX ix_pagos_venta_metodo ON pagos_venta (metodo_pago_id);
CREATE INDEX ix_compras_usuario ON compras (usuario_id);

-- Usuarios reales: ventas y compras quedan atadas a `usuarios`. Las otras columnas usuario_id
-- (movimientos_inventario, historial_precios, notas_ajuste, reversiones_igtf, log_tasas_cambio,
-- parametros_fiscales.creado_por, negocio.configurado_por, tasas_cambio.usuario_id) se heredan por
-- asociación y no llevan FK: atarlas obligaría a mantener una FK por cada fila de auditoría sin ganar
-- integridad real.
ALTER TABLE ventas  ADD CONSTRAINT fk_ventas_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT;
ALTER TABLE compras ADD CONSTRAINT fk_compras_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT;
COMMENT ON COLUMN ventas.usuario_id IS 'Quien cobró. FK a usuarios.';
COMMENT ON COLUMN compras.usuario_id IS 'Quien registró la compra. FK a usuarios.';
