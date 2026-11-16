-- =============================================================================
--  27 · CONTEO FÍSICO CÍCLICO con ajuste masivo de inventario
-- =============================================================================
--  Requiere: 01..22 (kardex del 03). Es idempotente:
--     psql -d tienda -v ON_ERROR_STOP=1 -f 27_conteos_fisicos.sql
--
--  Qué resuelve: antes del 27, corregir el inventario era producto por producto (sp_ajustar_stock).
--  Un conteo cíclico es: abrir un conteo con un conjunto de productos → contar en la gaveta/estante
--  → guardar lo contado → APLICAR: el sistema genera TODOS los ajustes del kardex de una vez
--  (AJUSTE_ENTRADA / AJUSTE_SALIDA, uno por producto con diferencia), con su motivo.
--
--  Alcance del conteo (fn_crear_conteo):
--     · p_categoria_id   una categoría completa.
--     · p_producto_ids   una lista puntual de productos (jsonb).
--     · p_solo_bajo      solo los productos con stock bajo (v_stock_bajo).
--     · p_todos          todo el catálogo activo (conteo general; usar con calma).
--  Cada línea congela el stock del sistema AL CREAR el conteo: si algo se vende mientras se cuenta,
--  la diferencia se calcula contra lo que había al abrir, y así se declara en el motivo del ajuste.
--
--  Estados: ABIERTO → APLICADO (se registraron los ajustes) | ANULADO (se descarta sin tocar el kardex).
-- =============================================================================
SET search_path = tienda, public;

CREATE SEQUENCE IF NOT EXISTS seq_conteo_fisico START 1;

CREATE TABLE IF NOT EXISTS conteos_fisicos (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero      bigint NOT NULL DEFAULT nextval('seq_conteo_fisico') UNIQUE,
    fecha       date   NOT NULL DEFAULT fn_hoy(),
    alcance     varchar(20) NOT NULL CHECK (alcance IN ('CATEGORIA','LISTA','STOCK_BAJO','TODO')),
    categoria_id bigint REFERENCES categorias(id),
    descripcion text,
    estado      varchar(8) NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO','APLICADO','ANULADO')),
    usuario_id  bigint NOT NULL REFERENCES usuarios(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    aplicado_en timestamptz, aplicado_por bigint REFERENCES usuarios(id),
    anulado_en  timestamptz, anulado_por bigint REFERENCES usuarios(id), anulado_motivo text,
    CONSTRAINT ck_conteo_estado CHECK (
        (estado = 'APLICADO' OR aplicado_en IS NULL) AND
        (estado <> 'ANULADO' OR (anulado_motivo IS NOT NULL AND anulado_en IS NOT NULL)) AND
        (estado <> 'ANULADO' OR aplicado_en IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_conteos_estado ON conteos_fisicos (estado, created_at DESC);
COMMENT ON TABLE  conteos_fisicos IS 'Conteo físico de inventario: un conjunto de productos que se cuenta y luego se aplica (ajustes del kardex en lote) o se anula.';
COMMENT ON COLUMN conteos_fisicos.alcance IS 'CATEGORIA (una categoría), LISTA (productos puntuales), STOCK_BAJO (los de v_stock_bajo) o TODO (todo el catálogo activo).';

CREATE TABLE IF NOT EXISTS conteo_detalle (
    conteo_id     bigint        NOT NULL REFERENCES conteos_fisicos(id),
    producto_id   bigint        NOT NULL REFERENCES productos(id),
    stock_sistema numeric(14,3) NOT NULL,              -- congelado al abrir el conteo
    contado       numeric(14,3),                        -- NULL mientras no se cuente
    PRIMARY KEY (conteo_id, producto_id),
    CHECK (stock_sistema >= 0 AND (contado IS NULL OR contado >= 0))
);
CREATE INDEX IF NOT EXISTS ix_conteo_det_prod ON conteo_detalle (producto_id);
COMMENT ON TABLE  conteo_detalle IS 'Líneas del conteo: lo que decía el sistema al abrirlo y lo que se contó. La diferencia genera el ajuste al aplicar.';
COMMENT ON COLUMN conteo_detalle.stock_sistema IS 'Existencia del producto al momento de crear el conteo (la fija fn_crear_conteo).';

-- Guardias: el conteo aplicado o anulado no cambia; lo contado se escribe solo con fn_contar.
CREATE OR REPLACE FUNCTION trg_conteos_guardia() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o jsonb; n jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Un conteo no se borra: anúlalo' USING ERRCODE = 'TV005'; END IF;
    o := to_jsonb(OLD) - 'estado' - 'aplicado_en' - 'aplicado_por' - 'anulado_en' - 'anulado_por' - 'anulado_motivo' - 'updated_at';
    n := to_jsonb(NEW) - 'estado' - 'aplicado_en' - 'aplicado_por' - 'anulado_en' - 'anulado_por' - 'anulado_motivo' - 'updated_at';
    IF o <> n THEN RAISE EXCEPTION 'El encabezado del conteo no se edita después de crearlo' USING ERRCODE = 'TV005'; END IF;
    IF OLD.estado <> 'ABIERTO' THEN RAISE EXCEPTION 'El conteo ya está % y no cambia', OLD.estado USING ERRCODE = 'TV005'; END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_conteos_guardia ON conteos_fisicos;
CREATE TRIGGER trg_conteos_guardia BEFORE UPDATE OR DELETE ON conteos_fisicos FOR EACH ROW EXECUTE FUNCTION trg_conteos_guardia();
DROP TRIGGER IF EXISTS trg_conteos_updated ON conteos_fisicos;
CREATE TRIGGER trg_conteos_updated BEFORE UPDATE ON conteos_fisicos FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE OR REPLACE FUNCTION trg_conteo_detalle_guardia() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c conteos_fisicos;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT * INTO c FROM conteos_fisicos WHERE id = OLD.conteo_id;
        IF c.estado = 'APLICADO' THEN RAISE EXCEPTION 'Las líneas de un conteo aplicado no se borran' USING ERRCODE = 'TV005'; END IF;
        RETURN OLD;
    END IF;
    SELECT * INTO c FROM conteos_fisicos WHERE id = NEW.conteo_id;
    IF c.estado <> 'ABIERTO' THEN RAISE EXCEPTION 'El conteo está %: sus líneas ya no cambian', c.estado USING ERRCODE = 'TV005'; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.stock_sistema IS DISTINCT FROM OLD.stock_sistema THEN
            RAISE EXCEPTION 'El stock del sistema lo congela el conteo; no se edita' USING ERRCODE = 'TV005'; END IF;
        IF NEW.producto_id IS DISTINCT FROM OLD.producto_id THEN
            RAISE EXCEPTION 'Las líneas del conteo no cambian de producto' USING ERRCODE = 'TV005'; END IF;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_conteo_detalle_guardia ON conteo_detalle;
CREATE TRIGGER trg_conteo_detalle_guardia BEFORE INSERT OR UPDATE OR DELETE ON conteo_detalle
    FOR EACH ROW EXECUTE FUNCTION trg_conteo_detalle_guardia();

-- ---------------------------------------------------------------------------
--  1. CREAR EL CONTEO
-- ---------------------------------------------------------------------------
--  p_alcance: 'CATEGORIA' (con p_categoria_id) | 'LISTA' (con p_producto_ids jsonb) | 'STOCK_BAJO' | 'TODO'
--  Congela el stock de cada línea al abrir. Si un producto ya está en OTRO conteo ABIERTO, no se duplica (TV006):
--  una pieza no puede estar en dos conteos a la vez.
CREATE OR REPLACE FUNCTION fn_crear_conteo(
    p_alcance text, p_usuario_id bigint, p_descripcion text DEFAULT NULL,
    p_categoria_id bigint DEFAULT NULL, p_producto_ids jsonb DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint; n int; alcance text := upper(COALESCE(p_alcance, ''));
BEGIN
    IF alcance NOT IN ('CATEGORIA','LISTA','STOCK_BAJO','TODO') THEN
        RAISE EXCEPTION 'Alcance inválido "%": use CATEGORIA, LISTA, STOCK_BAJO o TODO', p_alcance USING ERRCODE = 'TV006'; END IF;
    IF alcance = 'CATEGORIA' AND (p_categoria_id IS NULL OR NOT EXISTS (SELECT 1 FROM categorias WHERE id = p_categoria_id)) THEN
        RAISE EXCEPTION 'Elige la categoría a contar' USING ERRCODE = 'TV006'; END IF;
    IF alcance = 'LISTA' AND (p_producto_ids IS NULL OR jsonb_typeof(p_producto_ids) <> 'array' OR jsonb_array_length(p_producto_ids) = 0) THEN
        RAISE EXCEPTION 'La lista de productos a contar está vacía' USING ERRCODE = 'TV006'; END IF;

    -- ¿Alguno de esos productos ya está en un conteo abierto?
    IF EXISTS (
        WITH base AS (
            SELECT p.id FROM productos p
             WHERE p.activo
               AND (CASE WHEN alcance = 'CATEGORIA' THEN p.categoria_id = p_categoria_id
                         WHEN alcance = 'LISTA'     THEN p.id IN (SELECT value::bigint FROM jsonb_array_elements_text(p_producto_ids))
                         WHEN alcance = 'STOCK_BAJO' THEN p.stock_actual <= p.stock_minimo
                         ELSE TRUE END))
        SELECT 1 FROM base JOIN conteo_detalle d ON d.producto_id = base.id
                JOIN conteos_fisicos c ON c.id = d.conteo_id AND c.estado = 'ABIERTO' LIMIT 1) THEN
        RAISE EXCEPTION 'Hay productos de este alcance en otro conteo ABIERTO: aplícalo o anúlalo antes de abrir otro' USING ERRCODE = 'TV005';
    END IF;

    INSERT INTO conteos_fisicos (alcance, categoria_id, descripcion, usuario_id)
    VALUES (alcance, p_categoria_id, NULLIF(trim(p_descripcion), ''), p_usuario_id) RETURNING id INTO v_id;

    INSERT INTO conteo_detalle (conteo_id, producto_id, stock_sistema)
    SELECT v_id, p.id, p.stock_actual
      FROM productos p
     WHERE p.activo
       AND (CASE WHEN alcance = 'CATEGORIA' THEN p.categoria_id = p_categoria_id
                 WHEN alcance = 'LISTA'     THEN p.id IN (SELECT value::bigint FROM jsonb_array_elements_text(p_producto_ids))
                 WHEN alcance = 'STOCK_BAJO' THEN p.stock_actual <= p.stock_minimo
                 ELSE TRUE END)
    ON CONFLICT (conteo_id, producto_id) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
        RAISE EXCEPTION 'El alcance elegido no trajo ningún producto activo: revise el filtro' USING ERRCODE = 'TV006';
    END IF;
    RETURN v_id;
END $$;
COMMENT ON FUNCTION fn_crear_conteo(text, bigint, text, bigint, jsonb) IS 'Abre un conteo físico y congela el stock del sistema por línea. Una pieza no puede estar en dos conteos abiertos a la vez.';

-- Guardar lo contado. p_items: [{"producto_id":1,"contado":12}, ...] — solo productos del conteo.
-- Sin p_items: guarda TODO lo que traiga la pantalla (también se puede línea por línea).
CREATE OR REPLACE FUNCTION fn_contar(p_conteo_id bigint, p_items jsonb, p_usuario_id bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE it record; d conteo_detalle;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM conteos_fisicos WHERE id = p_conteo_id AND estado = 'ABIERTO') THEN
        RAISE EXCEPTION 'El conteo no existe o ya no está abierto' USING ERRCODE = 'TV005'; END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Envía las cantidades contadas' USING ERRCODE = 'TV006'; END IF;
    FOR it IN SELECT * FROM jsonb_to_recordset(p_items) AS x(producto_id bigint, contado numeric) LOOP
        SELECT * INTO d FROM conteo_detalle WHERE conteo_id = p_conteo_id AND producto_id = it.producto_id;
        IF d.producto_id IS NULL THEN
            RAISE EXCEPTION 'El producto % no pertenece a este conteo', it.producto_id USING ERRCODE = 'TV006'; END IF;
        IF it.contado IS NULL OR it.contado < 0 THEN
            RAISE EXCEPTION 'La cantidad contada del producto % debe ser 0 o más', it.producto_id USING ERRCODE = 'TV006'; END IF;
        UPDATE conteo_detalle SET contado = ROUND(it.contado, 3) WHERE conteo_id = p_conteo_id AND producto_id = it.producto_id;
    END LOOP;
END $$;
COMMENT ON FUNCTION fn_contar(bigint, jsonb, bigint) IS 'Guarda (o corrige) lo contado de las líneas de un conteo abierto.';

-- APLICAR: genera TODOS los ajustes del kardex de una vez (uno por producto con diferencia <> 0).
--  La diferencia = contado − stock del sistema CONGELADO AL ABRIR el conteo (se declara en el motivo).
--  Si el stock actual ya cambió (se vendió mientras se contaba), el ajuste deja el stock REAL en
--  «contado»: el movimiento parte del stock_resultante que el kardex calcula al insertar.
--  Un ajuste no puede dejar el stock en negativo salvo negocio.permitir_stock_negativo (regla del kardex).
CREATE OR REPLACE FUNCTION fn_aplicar_conteo(p_conteo_id bigint, p_usuario_id bigint)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE c conteos_fisicos; d record; mov int := 0; falta bigint;
BEGIN
    SELECT * INTO c FROM conteos_fisicos WHERE id = p_conteo_id FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'El conteo no existe' USING ERRCODE = 'TV006'; END IF;
    IF c.estado <> 'ABIERTO' THEN RAISE EXCEPTION 'El conteo ya está %', c.estado USING ERRCODE = 'TV005'; END IF;
    SELECT count(*) INTO falta FROM conteo_detalle WHERE conteo_id = p_conteo_id AND contado IS NULL;
    IF falta > 0 THEN
        RAISE EXCEPTION 'Faltan % líneas por contar: llénalas todas (o quítalas) antes de aplicar', falta USING ERRCODE = 'TV006'; END IF;

    PERFORM set_config('tienda.usuario_id', COALESCE(p_usuario_id::text, ''), true);
    FOR d IN SELECT cd.producto_id, cd.contado, cd.stock_sistema, p.nombre, p.sku
               FROM conteo_detalle cd JOIN productos p ON p.id = cd.producto_id
              WHERE cd.conteo_id = p_conteo_id ORDER BY cd.producto_id LOOP
        IF d.contado <> d.stock_sistema THEN
            INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, motivo, usuario_id)
            VALUES (d.producto_id,
                    CASE WHEN d.contado > d.stock_sistema THEN 'AJUSTE_ENTRADA' ELSE 'AJUSTE_SALIDA' END,
                    ROUND(d.contado - d.stock_sistema, 3), 'CONTEO', p_conteo_id,
                    'Conteo físico N.º ' || c.numero || ': contado ' || d.contado || ' vs sistema ' || d.stock_sistema,
                    p_usuario_id);
            mov := mov + 1;
        END IF;
    END LOOP;
    UPDATE conteos_fisicos SET estado = 'APLICADO', aplicado_en = now(), aplicado_por = p_usuario_id WHERE id = p_conteo_id;
    RETURN mov;
END $$;
COMMENT ON FUNCTION fn_aplicar_conteo(bigint, bigint) IS 'Aplica el conteo: crea TODOS los ajustes de kardex de una vez (AJUSTE_ENTRADA/SALIDA, motivo «Conteo físico N.º») y firma el conteo. Devuelve cuántos ajustes hizo.';

-- Quitar productos del conteo (se contaron aparte o no corresponden). Solo antes de aplicar.
CREATE OR REPLACE FUNCTION fn_quitar_linea_conteo(p_conteo_id bigint, p_producto_id bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM conteos_fisicos WHERE id = p_conteo_id AND estado = 'ABIERTO') THEN
        RAISE EXCEPTION 'El conteo no existe o ya no está abierto' USING ERRCODE = 'TV005'; END IF;
    DELETE FROM conteo_detalle WHERE conteo_id = p_conteo_id AND producto_id = p_producto_id;
END $$;
COMMENT ON FUNCTION fn_quitar_linea_conteo(bigint, bigint) IS 'Quita una línea del conteo abierto.';

-- Anular un conteo sin aplicar (se descarta; el kardex no se toca).
CREATE OR REPLACE FUNCTION fn_anular_conteo(p_conteo_id bigint, p_usuario_id bigint, p_motivo text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c conteos_fisicos;
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Indica el motivo de la anulación' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO c FROM conteos_fisicos WHERE id = p_conteo_id FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'El conteo no existe' USING ERRCODE = 'TV006'; END IF;
    IF c.estado <> 'ABIERTO' THEN RAISE EXCEPTION 'El conteo ya está %', c.estado USING ERRCODE = 'TV005'; END IF;
    UPDATE conteos_fisicos SET estado = 'ANULADO', anulado_en = now(), anulado_por = p_usuario_id, anulado_motivo = trim(p_motivo) WHERE id = p_conteo_id;
END $$;
COMMENT ON FUNCTION fn_anular_conteo(bigint, bigint, text) IS 'Anula un conteo abierto sin tocar el inventario.';

-- ---------------------------------------------------------------------------
--  2. CONSULTAS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_conteos AS
SELECT c.id, c.numero, c.fecha, c.alcance, cat.nombre AS categoria, c.descripcion, c.estado,
       u.nombre_completo AS por, c.created_at, c.aplicado_en, ua.nombre_completo AS aplicado_por_nombre,
       count(d.producto_id) AS lineas,
       count(d.contado) FILTER (WHERE d.contado IS NOT NULL) AS contadas,
       count(*) FILTER (WHERE d.contado IS NOT NULL AND d.contado <> d.stock_sistema) AS con_diferencia,
       COALESCE(sum(ABS(d.contado - d.stock_sistema)), 0) AS diferencia_absoluta
  FROM conteos_fisicos c
  LEFT JOIN categorias cat ON cat.id = c.categoria_id
  LEFT JOIN usuarios u ON u.id = c.usuario_id
  LEFT JOIN usuarios ua ON ua.id = c.aplicado_por
  LEFT JOIN conteo_detalle d ON d.conteo_id = c.id
 GROUP BY c.id, cat.id, u.id, ua.id;
COMMENT ON VIEW v_conteos IS 'Conteos físicos con su avance: cuántas líneas van contadas y cuántas traen diferencia.';

CREATE OR REPLACE VIEW v_conteo_detalle AS
SELECT d.conteo_id, c.estado, d.producto_id, p.sku, p.nombre, p.unidad, cat.nombre AS categoria,
       d.stock_sistema, d.contado, (d.contado - d.stock_sistema) AS diferencia,
       COALESCE(d.contado, d.stock_sistema) * p.costo_usd AS valor_costo_usd
  FROM conteo_detalle d
  JOIN conteos_fisicos c ON c.id = d.conteo_id
  JOIN productos p ON p.id = d.producto_id
  LEFT JOIN categorias cat ON cat.id = p.categoria_id;
COMMENT ON VIEW v_conteo_detalle IS 'Líneas legibles de un conteo: sistema vs contado vs diferencia, con el valor en riesgo a costo.';
