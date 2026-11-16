-- =============================================================================
--  17 · Módulo de métodos de pago + comprobante de cobro (con IGTF)
-- =============================================================================
--  Requiere: 10 (contabilidad), 14, 15 y 16. Es idempotente.
--     psql -d tienda -v ON_ERROR_STOP=1 -f 17_metodos_pago.sql
--
--  Qué agrega
--   1. Guardias en metodos_pago (las reglas viven en la base, no en la pantalla):
--        · es_divisa se deduce de la moneda (solo VES es bolívar): nadie la marca a mano.
--        · El IGTF solo puede aplicar a pagos en divisas.
--        · La moneda de un método con movimientos no se puede cambiar (reescribiría el historial).
--        · Mientras haya un turno de caja abierto no se cambia si un método es efectivo ni si causa IGTF
--          (cambiaría el arqueo y el IGTF de un turno a medias). Crear métodos nuevos sí se puede.
--        · Siempre debe quedar al menos un método activo.
--        · Un método con movimientos no se borra (se desactiva).
--   2. fn_guardar_cuenta_metodo: cuenta contable de cada método (banco o caja donde cae el dinero).
--   3. v_metodos_pago_uso: método + cuántas veces se usó + cuenta contable (alimenta la pantalla).
--   4. fn_comprobante_cobro: datos del recibo de cobro / comprobante de percepción de IGTF de un cobro.
--
--  Sobre el comprobante (confirmar con el contador): el IGTF se causa al recibir el pago en divisas, no al facturar
--  (así lo exponen Gálac y Gerencia y Tributos; fuentes secundarias). La factura de una venta a crédito no lleva IGTF
--  porque aún no se había percibido. La Providencia SNAT/2022/000013 no dice qué documento emitir en un pago posterior:
--  el sistema emite un comprobante interno numerado «REC-n» con el IGTF desglosado y la fecha del cobro. No es una
--  factura ni un documento fiscal autorizado por el SENIAT.
-- =============================================================================
SET search_path = tienda, public;

-- ---------------------------------------------------------------------------
--  1. Guardias de metodos_pago
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_metodo_en_uso(p_metodo_id bigint) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM pagos_venta WHERE metodo_pago_id = p_metodo_id)
        OR EXISTS (SELECT 1 FROM pagos_cobrar WHERE metodo_pago_id = p_metodo_id)
$$;

CREATE OR REPLACE FUNCTION trg_metodo_pago_guardia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF fn_metodo_en_uso(OLD.id) THEN
            RAISE EXCEPTION 'El método "%" ya tiene ventas o cobros: no se puede borrar. Desactívalo para que deje de ofrecerse.', OLD.nombre USING ERRCODE = 'TV005';
        END IF;
        DELETE FROM contab_metodo_cuenta WHERE metodo_pago_id = OLD.id;
        RETURN OLD;
    END IF;

    NEW.nombre := trim(NEW.nombre);
    IF length(NEW.nombre) < 2 THEN RAISE EXCEPTION 'Escribe el nombre del método de pago' USING ERRCODE = 'TV006'; END IF;
    IF NOT EXISTS (SELECT 1 FROM monedas WHERE codigo = NEW.moneda AND activa) THEN
        RAISE EXCEPTION 'La moneda % no existe o está desactivada', trim(NEW.moneda) USING ERRCODE = 'TV006';
    END IF;
    NEW.es_divisa := (trim(NEW.moneda) <> 'VES');
    IF NEW.aplica_igtf AND NOT NEW.es_divisa THEN
        RAISE EXCEPTION 'El IGTF solo aplica a pagos en divisas, no en bolívares' USING ERRCODE = 'TV006';
    END IF;
    IF NEW.es_efectivo AND NEW.requiere_referencia THEN
        RAISE EXCEPTION 'Un método en efectivo no pide número de referencia' USING ERRCODE = 'TV006';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.moneda IS DISTINCT FROM OLD.moneda AND fn_metodo_en_uso(OLD.id) THEN
            RAISE EXCEPTION 'No se puede cambiar la moneda de "%": ya tiene ventas o cobros. Crea otro método en esa moneda.', OLD.nombre USING ERRCODE = 'TV005';
        END IF;
        IF (NEW.es_efectivo IS DISTINCT FROM OLD.es_efectivo OR NEW.aplica_igtf IS DISTINCT FROM OLD.aplica_igtf)
           AND EXISTS (SELECT 1 FROM aperturas_caja WHERE estado = 'ABIERTA') THEN
            RAISE EXCEPTION 'Hay turnos de caja abiertos: ciérralos antes de cambiar si "%" es efectivo o si causa IGTF.', OLD.nombre USING ERRCODE = 'TV005';
        END IF;
        IF OLD.activo AND NOT NEW.activo AND NOT EXISTS (SELECT 1 FROM metodos_pago WHERE activo AND id <> OLD.id) THEN
            RAISE EXCEPTION 'Debe quedar al menos un método de pago activo' USING ERRCODE = 'TV005';
        END IF;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_metodo_pago_guardia ON metodos_pago;   -- se llama después de trg_metodo_es_efectivo (orden alfabético)
CREATE TRIGGER trg_metodo_pago_guardia BEFORE INSERT OR UPDATE OR DELETE ON metodos_pago FOR EACH ROW EXECUTE FUNCTION trg_metodo_pago_guardia();

-- ---------------------------------------------------------------------------
--  2. Cuenta contable del método (NULL = la de Caja o Bancos según sea efectivo o no)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_guardar_cuenta_metodo(p_metodo_id bigint, p_cuenta_id bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM metodos_pago WHERE id = p_metodo_id) THEN RAISE EXCEPTION 'El método de pago no existe' USING ERRCODE = 'TV006'; END IF;
    IF p_cuenta_id IS NULL THEN
        DELETE FROM contab_metodo_cuenta WHERE metodo_pago_id = p_metodo_id;
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM plan_cuentas WHERE id = p_cuenta_id AND activa AND permite_movimiento AND tipo = 'ACTIVO') THEN
        RAISE EXCEPTION 'Elige una cuenta de activo (caja o banco) activa y que acepte movimientos' USING ERRCODE = 'TV006';
    END IF;
    INSERT INTO contab_metodo_cuenta (negocio_id, metodo_pago_id, cuenta_id) VALUES (fn_negocio_actual(), p_metodo_id, p_cuenta_id)
    ON CONFLICT (negocio_id, metodo_pago_id) DO UPDATE SET cuenta_id = EXCLUDED.cuenta_id;
END $$;

-- ---------------------------------------------------------------------------
--  3. Vista para la pantalla
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_metodos_pago_uso AS
SELECT m.id, m.nombre, trim(m.moneda) AS moneda, m.es_divisa, m.es_efectivo, m.aplica_igtf, m.requiere_referencia, m.activo,
       (SELECT count(*) FROM pagos_venta pv WHERE pv.metodo_pago_id = m.id)  AS pagos_ventas,
       (SELECT count(*) FROM pagos_cobrar pc WHERE pc.metodo_pago_id = m.id) AS pagos_cobros,
       c.id AS cuenta_id, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre
  FROM metodos_pago m
  LEFT JOIN contab_metodo_cuenta mc ON mc.metodo_pago_id = m.id
  LEFT JOIN plan_cuentas c ON c.id = mc.cuenta_id;

-- ---------------------------------------------------------------------------
--  4. Comprobante de un cobro de cuenta por cobrar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_comprobante_cobro(p_pago_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE p pagos_cobrar; c v_cuentas_por_cobrar; m metodos_pago; pct numeric; u text;
BEGIN
    SELECT * INTO p FROM pagos_cobrar WHERE id = p_pago_id;
    IF p.id IS NULL THEN RAISE EXCEPTION 'El cobro no existe' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO c FROM v_cuentas_por_cobrar WHERE id = p.cuenta_por_cobrar_id;
    SELECT * INTO m FROM metodos_pago WHERE id = p.metodo_pago_id;
    pct := CASE WHEN p.igtf_monto > 0 THEN COALESCE(fn_igtf_pct(p.fecha), 0) ELSE 0 END;
    SELECT nombre_completo INTO u FROM usuarios WHERE id = p.usuario_id;
    RETURN jsonb_build_object(
        'id', p.id, 'numero', 'REC-' || lpad(p.id::text, 6, '0'), 'fecha', p.fecha, 'hora', to_char(p.created_at AT TIME ZONE 'America/Caracas', 'HH24:MI'),
        'estado', p.estado, 'motivo_anulacion', p.motivo_anulacion, 'cobrado_por', u,
        'metodo', COALESCE(m.nombre, CASE WHEN p.es_efectivo THEN 'Efectivo' ELSE 'Cobro bancario' END), 'moneda', trim(p.moneda),
        'es_efectivo', p.es_efectivo, 'referencia', p.referencia,
        'monto', p.monto, 'monto_usd', p.monto_usd, 'monto_ves', p.monto_ves, 'tasa_ves', p.tasa_ves,
        'aplica_igtf', p.igtf_monto > 0, 'igtf_pct', pct,
        'base_igtf', CASE WHEN pct > 0 THEN ROUND(p.igtf_monto * 100 / pct, 2) ELSE 0 END,
        'igtf', p.igtf_monto, 'igtf_usd', p.igtf_usd, 'igtf_ves', p.igtf_ves,
        'total_entregado', ROUND(p.monto + p.igtf_monto, 2),
        'cliente', c.cliente, 'documento', c.documento, 'venta_numero', c.venta_numero, 'factura', c.factura,
        'saldo_usd', c.saldo_usd, 'saldo_ves', c.saldo_ves, 'estado_cuenta', c.estado);
END $$;
COMMENT ON FUNCTION fn_comprobante_cobro(bigint) IS 'Datos del recibo de cobro / comprobante de percepción de IGTF de un cobro de cuenta por cobrar (comprobante interno, no es factura).';
