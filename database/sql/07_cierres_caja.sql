-- =============================================================================
--  07 · Cierres de caja (OPCIONAL, no modifica ninguna tabla existente)
-- =============================================================================
--  Tu esquema ya calcula lo que se COBRÓ por día, método y moneda (v_cierre_caja / pagos_venta).
--  Lo que no guarda es el acto de cerrar: quién cerró, qué contó en efectivo, la diferencia y una
--  copia fija de las cifras. Esta tabla lo registra. Si no la creas, el módulo funciona igual en
--  modo consulta (informe y PDF), sin el botón «Registrar cierre».
--     psql -d tienda -f 07_cierres_caja.sql
-- =============================================================================
SET search_path = tienda, public;

CREATE TABLE IF NOT EXISTS cierres_caja (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha         date        NOT NULL,
    usuario_id    bigint      REFERENCES usuarios(id),          -- caja cerrada (NULL = todas las cajas del día)
    cerrado_por   bigint      NOT NULL REFERENCES usuarios(id),
    cerrado_en    timestamptz NOT NULL DEFAULT now(),
    ventas        integer     NOT NULL CHECK (ventas >= 0),
    total_usd     numeric(18,2) NOT NULL,                       -- total cobrado (con IGTF) en USD
    total_ves     numeric(18,2) NOT NULL,                       -- idem en Bs, con la tasa congelada de cada pago
    conteo        jsonb       NOT NULL DEFAULT '{}'::jsonb,     -- {"USD": 120.00, "VES": 5000}  efectivo contado por moneda
    esperado      jsonb       NOT NULL DEFAULT '{}'::jsonb,     -- efectivo que debía haber por moneda
    diferencia    jsonb       NOT NULL DEFAULT '{}'::jsonb,     -- contado − esperado por moneda
    observaciones text,
    detalle       jsonb       NOT NULL                          -- copia fija del informe en el momento del cierre
);
-- Un solo cierre por día y caja (y uno general por día).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cierre_dia_caja ON cierres_caja (fecha, COALESCE(usuario_id, 0));
CREATE INDEX IF NOT EXISTS ix_cierres_caja_fecha ON cierres_caja (fecha DESC);

-- Un cierre firmado no se edita ni se borra (igual que pagos_venta).
DROP TRIGGER IF EXISTS trg_cierres_caja_inmutable ON cierres_caja;
CREATE TRIGGER trg_cierres_caja_inmutable BEFORE UPDATE OR DELETE ON cierres_caja
    FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();

COMMENT ON TABLE cierres_caja IS 'Cierre de caja firmado: efectivo contado vs esperado por moneda y copia fija del informe del día.';
