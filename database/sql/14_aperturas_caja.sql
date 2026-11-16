-- =============================================================================
--  14 · Turnos de caja: apertura con fondo inicial y cierre (Corte Z)
-- =============================================================================
--  Cada cajero abre su turno con un fondo inicial (USD y Bs) y no puede vender sin turno abierto (lo exige la app).
--  Un turno se cierra una sola vez, con el conteo de efectivo (cierres_caja.apertura_id). Un cajero puede abrir
--  y cerrar varios turnos el mismo día (mañana / tarde): por eso el índice «un cierre por día» pasa a valer solo
--  para los cierres antiguos, sin turno.
--     psql -d tienda -f 14_aperturas_caja.sql        (después del 07; es idempotente)
-- =============================================================================
SET search_path = tienda, public;

CREATE TABLE IF NOT EXISTS aperturas_caja (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id         bigint        NOT NULL REFERENCES usuarios(id),
    fecha_apertura     timestamptz   NOT NULL DEFAULT now(),
    fondo_inicial_usd  numeric(18,2) NOT NULL DEFAULT 0 CHECK (fondo_inicial_usd >= 0),
    fondo_inicial_ves  numeric(18,2) NOT NULL DEFAULT 0 CHECK (fondo_inicial_ves >= 0),
    estado             varchar(8)    NOT NULL DEFAULT 'ABIERTA' CHECK (estado IN ('ABIERTA','CERRADA')),
    cerrado_por        bigint        REFERENCES usuarios(id),
    fecha_cierre       timestamptz,
    created_at         timestamptz   NOT NULL DEFAULT now(),
    CHECK ((estado = 'ABIERTA' AND cerrado_por IS NULL AND fecha_cierre IS NULL)
        OR (estado = 'CERRADA' AND cerrado_por IS NOT NULL AND fecha_cierre IS NOT NULL AND fecha_cierre >= fecha_apertura))
);
-- Una sola caja abierta por usuario (la base lo garantiza aunque dos pestañas abran a la vez).
CREATE UNIQUE INDEX IF NOT EXISTS uq_apertura_abierta_por_usuario ON aperturas_caja (usuario_id) WHERE estado = 'ABIERTA';
CREATE INDEX IF NOT EXISTS ix_aperturas_usuario_fecha ON aperturas_caja (usuario_id, fecha_apertura DESC);
COMMENT ON TABLE  aperturas_caja IS 'Turno de caja: quién abrió, con cuánto fondo y cuándo se cerró. Las ventas del turno son las del cajero entre fecha_apertura y fecha_cierre.';
COMMENT ON COLUMN aperturas_caja.fondo_inicial_usd IS 'Efectivo en dólares con el que arranca el turno (cambio).';
COMMENT ON COLUMN aperturas_caja.fondo_inicial_ves IS 'Efectivo en bolívares con el que arranca el turno (cambio).';

-- Un turno no se borra ni se reabre; solo ABIERTA → CERRADA (una vez).
CREATE OR REPLACE FUNCTION trg_aperturas_guardia() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n aperturas_caja := NEW;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Un turno de caja no se puede borrar' USING ERRCODE = 'TV005'; END IF;
    IF OLD.estado = 'CERRADA' THEN RAISE EXCEPTION 'El turno ya está cerrado y no se puede modificar' USING ERRCODE = 'TV005'; END IF;
    n.estado := OLD.estado; n.cerrado_por := OLD.cerrado_por; n.fecha_cierre := OLD.fecha_cierre;
    IF n IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Del turno solo se puede registrar el cierre' USING ERRCODE = 'TV005'; END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_aperturas_guardia ON aperturas_caja;
CREATE TRIGGER trg_aperturas_guardia BEFORE UPDATE OR DELETE ON aperturas_caja FOR EACH ROW EXECUTE FUNCTION trg_aperturas_guardia();

-- Cierres de caja: enlazan con su turno. Un turno tiene un solo cierre; el «un cierre por día y caja» queda solo para los cierres sin turno.
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS apertura_id bigint REFERENCES aperturas_caja(id);
DROP INDEX IF EXISTS uq_cierre_dia_caja;
CREATE UNIQUE INDEX uq_cierre_dia_caja ON cierres_caja (fecha, COALESCE(usuario_id, 0)) WHERE apertura_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cierre_apertura ON cierres_caja (apertura_id) WHERE apertura_id IS NOT NULL;
COMMENT ON COLUMN cierres_caja.apertura_id IS 'Turno de caja que se cierra (NULL en los cierres anteriores a los turnos).';

-- Turno abierto de un usuario (NULL si no tiene).
CREATE OR REPLACE FUNCTION fn_apertura_activa(p_usuario_id bigint) RETURNS bigint LANGUAGE sql STABLE AS $$
    SELECT id FROM aperturas_caja WHERE usuario_id = p_usuario_id AND estado = 'ABIERTA'
$$;

-- Abre el turno. El bloqueo consultivo por usuario serializa dos aperturas simultáneas; el índice único es la red de seguridad.
CREATE OR REPLACE FUNCTION fn_abrir_caja(p_usuario_id bigint, p_fondo_usd numeric, p_fondo_ves numeric) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
    IF COALESCE(p_fondo_usd, 0) < 0 OR COALESCE(p_fondo_ves, 0) < 0 THEN RAISE EXCEPTION 'El fondo inicial no puede ser negativo' USING ERRCODE = 'TV006'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('tienda.apertura.' || p_usuario_id));
    IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_usuario_id AND activo) THEN RAISE EXCEPTION 'El usuario no existe o está inactivo' USING ERRCODE = 'TV006'; END IF;
    IF fn_apertura_activa(p_usuario_id) IS NOT NULL THEN RAISE EXCEPTION 'Ya tienes una caja abierta. Ciérrala antes de abrir otra.' USING ERRCODE = 'TV005'; END IF;
    INSERT INTO aperturas_caja (usuario_id, fondo_inicial_usd, fondo_inicial_ves)
    VALUES (p_usuario_id, ROUND(COALESCE(p_fondo_usd, 0), 2), ROUND(COALESCE(p_fondo_ves, 0), 2)) RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- Marca el turno como CERRADO. (El conteo y la firma del cierre los guarda cierres_caja; esto solo cierra el turno.)
CREATE OR REPLACE FUNCTION fn_cerrar_apertura(p_apertura_id bigint, p_cerrado_por bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE a aperturas_caja;
BEGIN
    SELECT * INTO a FROM aperturas_caja WHERE id = p_apertura_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION 'El turno de caja no existe' USING ERRCODE = 'TV006'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('tienda.apertura.' || a.usuario_id));
    IF a.estado = 'CERRADA' THEN RAISE EXCEPTION 'Este turno ya está cerrado' USING ERRCODE = 'TV005'; END IF;
    UPDATE aperturas_caja SET estado = 'CERRADA', cerrado_por = p_cerrado_por, fecha_cierre = clock_timestamp() WHERE id = p_apertura_id;
END $$;
