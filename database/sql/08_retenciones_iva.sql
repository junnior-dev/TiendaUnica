-- =============================================================================
--  08 · Retenciones de IVA e importaciones (OPCIONAL, no modifica nada existente)
-- =============================================================================
--  Tu esquema calcula el IVA de ventas y compras, pero no guarda dos cosas que el libro fiscal pide:
--    · El IVA RETENIDO y el número del comprobante de retención.
--        COMPRA = retención que TÚ practicas a un proveedor (solo si eres contribuyente especial).
--        VENTA  = retención que un CLIENTE te practicó a ti (reduce el IVA que pagas).
--    · La planilla de importación (aduana) de una compra al exterior.
--  Este archivo solo AGREGA tablas, procedimientos y una vista. Si no lo ejecutas, el módulo
--  «Libros fiscales» sigue funcionando; solo muestra un aviso en lugar de las columnas de retención.
--     psql -d tienda -f 08_retenciones_iva.sql
--  Base normativa leída (Providencia SNAT/2025/000054, Gaceta 43.171): 75 % regla general; 100 % si el IVA no está discriminado, la factura no cumple
--  requisitos o el proveedor no tiene RIF / está sujeto a 100 %; comprobante de 14 caracteres AAAAMMSSSSSSSS entregado en los 2 primeros días hábiles del
--  período siguiente; entero por quincena según calendario. Confirma el texto vigente con tu contador.
-- =============================================================================
SET search_path = tienda, public;

-- ---------------------------------------------------------------------------
--  1. RETENCIONES DE IVA
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retenciones_iva (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sentido             varchar(6)    NOT NULL CHECK (sentido IN ('COMPRA','VENTA')),
    compra_id           bigint        REFERENCES compras(id),
    venta_id            bigint        REFERENCES ventas(id),
    numero_comprobante  varchar(40)   NOT NULL CHECK (length(trim(numero_comprobante)) > 0),
    fecha_emision       date          NOT NULL,
    porcentaje          numeric(5,2)  NOT NULL CHECK (porcentaje IN (75, 100)),
    iva_documento_ves   numeric(18,2) NOT NULL CHECK (iva_documento_ves > 0),   -- IVA de la factura, en Bs, al registrar
    iva_retenido_ves    numeric(18,2) NOT NULL CHECK (iva_retenido_ves > 0),
    observaciones       text,
    estado              varchar(10)   NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA','ANULADA')),
    usuario_id          bigint        REFERENCES usuarios(id),
    created_at          timestamptz   NOT NULL DEFAULT now(),
    anulada_en          timestamptz,
    anulada_por         bigint        REFERENCES usuarios(id),
    motivo_anulacion    text,
    CONSTRAINT ck_ret_documento CHECK (
        (sentido = 'COMPRA' AND compra_id IS NOT NULL AND venta_id IS NULL) OR
        (sentido = 'VENTA'  AND venta_id  IS NOT NULL AND compra_id IS NULL)),
    -- Comprobante que TÚ emites: 14 caracteres AAAAMMSSSSSSSS (año, mes y secuencial de 8 dígitos), según la providencia SNAT/2025/000054.
    CONSTRAINT ck_ret_comprobante_propio CHECK (sentido <> 'COMPRA' OR numero_comprobante ~ '^[0-9]{4}(0[1-9]|1[0-2])[0-9]{8}$'),
    CONSTRAINT ck_ret_monto CHECK (iva_retenido_ves <= iva_documento_ves),
    CONSTRAINT ck_ret_anulacion CHECK (estado = 'ACTIVA' OR (anulada_en IS NOT NULL AND length(trim(COALESCE(motivo_anulacion, ''))) >= 3))
);
-- Una sola retención activa por factura.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ret_compra_activa ON retenciones_iva (compra_id) WHERE estado = 'ACTIVA' AND compra_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ret_venta_activa  ON retenciones_iva (venta_id)  WHERE estado = 'ACTIVA' AND venta_id  IS NOT NULL;
-- El comprobante que TÚ emites (sentido COMPRA) no se repite. El de clientes lo numera cada cliente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ret_comprobante_propio ON retenciones_iva (numero_comprobante) WHERE sentido = 'COMPRA';
CREATE INDEX IF NOT EXISTS ix_ret_fecha ON retenciones_iva (fecha_emision);

COMMENT ON TABLE  retenciones_iva IS 'IVA retenido: COMPRA = lo que retienes a un proveedor; VENTA = lo que un cliente te retuvo. No se modifica: solo se anula.';
COMMENT ON COLUMN retenciones_iva.porcentaje IS '75 % es la regla general. 100 % si el IVA no está discriminado, la factura no cumple los requisitos, o el proveedor no tiene RIF o está sujeto a 100 % (SNAT/2025/000054, arts. 4 y 5).';

-- Solo se permite pasar de ACTIVA a ANULADA (con motivo). Nada más se modifica y nada se borra.
CREATE OR REPLACE FUNCTION trg_retenciones_iva_proteger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'retenciones_iva es un registro inmutable: no se elimina (anule la retención)' USING ERRCODE = 'TV005';
    END IF;
    IF OLD.estado = 'ACTIVA' AND NEW.estado = 'ANULADA'
       AND (to_jsonb(NEW) - 'estado' - 'anulada_en' - 'anulada_por' - 'motivo_anulacion')
         = (to_jsonb(OLD) - 'estado' - 'anulada_en' - 'anulada_por' - 'motivo_anulacion') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'retenciones_iva es un registro inmutable: solo se puede anular (anule la retención y registre otra)' USING ERRCODE = 'TV005';
END $$;

DROP TRIGGER IF EXISTS trg_retenciones_iva_inmutable ON retenciones_iva;
CREATE TRIGGER trg_retenciones_iva_inmutable BEFORE UPDATE OR DELETE ON retenciones_iva
    FOR EACH ROW EXECUTE FUNCTION trg_retenciones_iva_proteger();

-- ---------------------------------------------------------------------------
--  2. IMPORTACIONES (planilla de aduana de una compra)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compras_importacion (
    compra_id        bigint PRIMARY KEY REFERENCES compras(id),
    numero_planilla  varchar(40)  NOT NULL CHECK (length(trim(numero_planilla)) > 0),
    fecha_planilla   date         NOT NULL,
    aduana           varchar(120),
    usuario_id       bigint       REFERENCES usuarios(id),
    created_at       timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (numero_planilla)
);
COMMENT ON TABLE compras_importacion IS 'Planilla de importación (aduana) asociada a una compra. El libro de compras la muestra en lugar del número de factura/control.';

DROP TRIGGER IF EXISTS trg_compras_importacion_inmutable ON compras_importacion;
CREATE TRIGGER trg_compras_importacion_inmutable BEFORE UPDATE OR DELETE ON compras_importacion
    FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();

-- ---------------------------------------------------------------------------
--  3. PROCEDIMIENTOS
-- ---------------------------------------------------------------------------
-- Siguiente número de TU comprobante: AAAAMM + secuencial de 8 dígitos (continuo; no reutiliza números de comprobantes anulados).
CREATE OR REPLACE FUNCTION fn_siguiente_comprobante_retencion(p_fecha date) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE sec bigint;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('tienda.retenciones_iva.comprobante'));
    SELECT COALESCE(max(substr(numero_comprobante, 7)::bigint), 0) + 1 INTO sec FROM retenciones_iva WHERE sentido = 'COMPRA';
    IF sec > 99999999 THEN sec := 1; END IF;
    RETURN to_char(p_fecha, 'YYYYMM') || lpad(sec::text, 8, '0');
END $$;
COMMENT ON FUNCTION fn_siguiente_comprobante_retencion(date) IS 'Siguiente número de comprobante de retención propio (formato AAAAMMSSSSSSSS).';

-- Registra una retención sobre una compra (la practicas tú) o una venta (te la practicó un cliente).
-- p_iva_retenido NULL = se calcula: IVA del documento en Bs × porcentaje.
-- p_comprobante NULL o vacío en una COMPRA = se asigna el siguiente número propio (fn_siguiente_comprobante_retencion).
-- Plazos (SNAT/2025/000054): el comprobante se entrega al proveedor a más tardar en los 2 primeros días hábiles del período siguiente;
-- el entero se hace por quincena (1-15 y 16-fin de mes) según el calendario del SENIAT, previa declaración de compras en el Portal Fiscal.
CREATE OR REPLACE PROCEDURE sp_registrar_retencion_iva(
    p_sentido text, p_documento_id bigint, p_comprobante text, p_fecha date, p_porcentaje numeric,
    p_usuario_id bigint, p_iva_retenido numeric DEFAULT NULL, p_observaciones text DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE iva numeric; retenido numeric; esp boolean; est text; fecha_doc date;
BEGIN
    IF p_sentido NOT IN ('COMPRA','VENTA') THEN RAISE EXCEPTION 'El sentido debe ser COMPRA o VENTA' USING ERRCODE = 'TV006'; END IF;
    IF p_sentido = 'VENTA' AND (p_comprobante IS NULL OR length(trim(p_comprobante)) = 0) THEN RAISE EXCEPTION 'Indique el número del comprobante que le dio el cliente' USING ERRCODE = 'TV006'; END IF;
    IF p_porcentaje NOT IN (75, 100) THEN RAISE EXCEPTION 'El porcentaje de retención debe ser 75 o 100' USING ERRCODE = 'TV006'; END IF;
    IF p_fecha IS NULL THEN RAISE EXCEPTION 'Indique la fecha del comprobante' USING ERRCODE = 'TV006'; END IF;

    IF p_sentido = 'COMPRA' THEN
        SELECT es_contribuyente_especial INTO esp FROM negocio WHERE id = fn_negocio_actual();
        IF NOT COALESCE(esp, FALSE) THEN
            RAISE EXCEPTION 'Solo un contribuyente especial retiene IVA a sus proveedores (revise los datos del negocio)' USING ERRCODE = 'TV006';
        END IF;
        SELECT c.estado, c.fecha_factura, l.iva_ves INTO est, fecha_doc, iva
          FROM compras c JOIN v_libro_compras l ON l.compra_id = c.id WHERE c.id = p_documento_id;
    ELSE
        SELECT v.estado, v.fecha_valor, v.iva_ves INTO est, fecha_doc, iva FROM ventas v WHERE v.id = p_documento_id;
    END IF;

    IF est IS NULL THEN RAISE EXCEPTION 'La % % no existe', lower(p_sentido), p_documento_id USING ERRCODE = 'TV006'; END IF;
    IF est = 'ANULADA' THEN RAISE EXCEPTION 'La % % está anulada: no admite retención', lower(p_sentido), p_documento_id USING ERRCODE = 'TV006'; END IF;
    IF COALESCE(iva, 0) <= 0 THEN RAISE EXCEPTION 'La factura no tiene IVA: no hay nada que retener' USING ERRCODE = 'TV006'; END IF;
    IF p_fecha < fecha_doc THEN RAISE EXCEPTION 'El comprobante (%) no puede ser anterior a la factura (%)', p_fecha, fecha_doc USING ERRCODE = 'TV006'; END IF;

    retenido := COALESCE(p_iva_retenido, ROUND(iva * p_porcentaje / 100, 2));
    IF retenido <= 0 OR retenido > iva THEN
        RAISE EXCEPTION 'El IVA retenido (%) debe ser mayor que 0 y no superar el IVA de la factura (%)', retenido, iva USING ERRCODE = 'TV006';
    END IF;

    IF p_sentido = 'COMPRA' THEN
        IF p_comprobante IS NULL OR length(trim(p_comprobante)) = 0 THEN
            p_comprobante := fn_siguiente_comprobante_retencion(p_fecha);
        ELSIF trim(p_comprobante) !~ '^[0-9]{4}(0[1-9]|1[0-2])[0-9]{8}$' THEN
            RAISE EXCEPTION 'El comprobante propio tiene 14 dígitos: año (4), mes (2) y secuencial (8), por ejemplo 20261100000001' USING ERRCODE = 'TV006';
        END IF;
    END IF;

    PERFORM set_config('tienda.usuario_id', COALESCE(p_usuario_id::text, ''), true);
    BEGIN
        INSERT INTO retenciones_iva (sentido, compra_id, venta_id, numero_comprobante, fecha_emision, porcentaje,
                                     iva_documento_ves, iva_retenido_ves, observaciones, usuario_id)
        VALUES (p_sentido,
                CASE WHEN p_sentido = 'COMPRA' THEN p_documento_id END,
                CASE WHEN p_sentido = 'VENTA'  THEN p_documento_id END,
                trim(p_comprobante), p_fecha, p_porcentaje, iva, retenido, NULLIF(trim(COALESCE(p_observaciones, '')), ''), p_usuario_id);
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'Ya existe una retención activa para esa factura o el comprobante % ya fue usado', trim(p_comprobante) USING ERRCODE = 'TV006';
    END;
END $$;
COMMENT ON PROCEDURE sp_registrar_retencion_iva(text, bigint, text, date, numeric, bigint, numeric, text) IS 'Registra el IVA retenido de una compra (COMPRA) o de una venta (VENTA) con su comprobante.';

CREATE OR REPLACE PROCEDURE sp_anular_retencion_iva(p_id bigint, p_usuario_id bigint, p_motivo text)
LANGUAGE plpgsql AS $$
DECLARE r retenciones_iva;
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Indique el motivo de la anulación' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO r FROM retenciones_iva WHERE id = p_id FOR UPDATE;
    IF r.id IS NULL THEN RAISE EXCEPTION 'La retención % no existe', p_id USING ERRCODE = 'TV006'; END IF;
    IF r.estado = 'ANULADA' THEN RAISE EXCEPTION 'La retención % ya está anulada', p_id USING ERRCODE = 'TV006'; END IF;
    UPDATE retenciones_iva SET estado = 'ANULADA', anulada_en = now(), anulada_por = p_usuario_id, motivo_anulacion = trim(p_motivo) WHERE id = p_id;
END $$;
COMMENT ON PROCEDURE sp_anular_retencion_iva(bigint, bigint, text) IS 'Anula una retención de IVA (no se borra).';

CREATE OR REPLACE PROCEDURE sp_registrar_importacion(
    p_compra_id bigint, p_planilla text, p_fecha date, p_aduana text, p_usuario_id bigint)
LANGUAGE plpgsql AS $$
DECLARE est text;
BEGIN
    IF p_planilla IS NULL OR length(trim(p_planilla)) = 0 THEN RAISE EXCEPTION 'Indique el número de la planilla de importación' USING ERRCODE = 'TV006'; END IF;
    IF p_fecha IS NULL THEN RAISE EXCEPTION 'Indique la fecha de la planilla' USING ERRCODE = 'TV006'; END IF;
    SELECT estado INTO est FROM compras WHERE id = p_compra_id;
    IF est IS NULL THEN RAISE EXCEPTION 'La compra % no existe', p_compra_id USING ERRCODE = 'TV006'; END IF;
    IF est = 'ANULADA' THEN RAISE EXCEPTION 'La compra % está anulada', p_compra_id USING ERRCODE = 'TV006'; END IF;
    BEGIN
        INSERT INTO compras_importacion (compra_id, numero_planilla, fecha_planilla, aduana, usuario_id)
        VALUES (p_compra_id, trim(p_planilla), p_fecha, NULLIF(trim(COALESCE(p_aduana, '')), ''), p_usuario_id);
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'La compra ya tiene planilla o el número % ya fue usado', trim(p_planilla) USING ERRCODE = 'TV006';
    END;
END $$;
COMMENT ON PROCEDURE sp_registrar_importacion(bigint, text, date, text, bigint) IS 'Asocia la planilla de importación (aduana) a una compra.';

-- ---------------------------------------------------------------------------
--  4. VISTA para el libro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_retenciones_iva AS
SELECT r.id, r.sentido, r.estado, r.numero_comprobante, r.fecha_emision, r.porcentaje,
       r.iva_documento_ves, r.iva_retenido_ves, r.compra_id, r.venta_id,
       CASE WHEN r.sentido = 'COMPRA' THEN c.numero_factura ELSE COALESCE(v.numero_factura_fiscal, v.numero::text) END AS documento,
       CASE WHEN r.sentido = 'COMPRA' THEN pr.razon_social ELSE COALESCE(cl.nombre, 'Consumidor final') END AS tercero
  FROM retenciones_iva r
  LEFT JOIN compras c      ON c.id = r.compra_id
  LEFT JOIN proveedores pr ON pr.id = c.proveedor_id
  LEFT JOIN ventas v       ON v.id = r.venta_id
  LEFT JOIN clientes cl    ON cl.id = v.cliente_id;
