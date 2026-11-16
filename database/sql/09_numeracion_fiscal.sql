-- =============================================================================
--  09 · Numeración automática de factura y control (OPCIONAL, no modifica nada existente)
-- =============================================================================
--  El Punto de venta emite la factura al confirmar la venta: toma el siguiente número de factura y de control
--  de un contador propio y los fija con sp_asignar_factura_fiscal. El contador es una tabla de una sola fila
--  (no una SECUENCIA): si algo falla, la transacción se revierte y el número NO se pierde, así la numeración
--  queda correlativa y sin saltos.
--
--  Si prefieres usar los números de tu máquina fiscal o de un proveedor de facturación digital que te los entrega,
--  desactiva el automático y el POS volverá a pedir el número a mano:
--      UPDATE tienda.numeracion_fiscal SET automatica = false;
--  Para cambiar el formato o el punto de partida (por ejemplo, si vienes de otro sistema con facturas ya emitidas):
--      UPDATE tienda.numeracion_fiscal SET prefijo_factura = 'A-', siguiente_factura = 1501, prefijo_control = '00-', siguiente_control = 1501;
--
--  OJO: este es un correlativo interno del sistema. Que ese número sea válido ante el SENIAT depende de tu medio de
--  facturación (imprenta digital autorizada / máquina fiscal). Confírmalo con tu contador antes de entregar facturas.
--     psql -d tienda -f 09_numeracion_fiscal.sql
-- =============================================================================
SET search_path = tienda, public;

CREATE TABLE IF NOT EXISTS numeracion_fiscal (
    id                 smallint     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    automatica         boolean      NOT NULL DEFAULT true,
    prefijo_factura    varchar(10)  NOT NULL DEFAULT 'FAC-',
    siguiente_factura  bigint       NOT NULL DEFAULT 1 CHECK (siguiente_factura > 0),
    prefijo_control    varchar(10)  NOT NULL DEFAULT '00-',
    siguiente_control  bigint       NOT NULL DEFAULT 1 CHECK (siguiente_control > 0),
    actualizado_en     timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON TABLE numeracion_fiscal IS 'Contador (una sola fila) para numerar factura y control de forma correlativa desde el POS.';

-- Arranca después del mayor número ya usado con el mismo formato, para no chocar con facturas existentes.
INSERT INTO numeracion_fiscal (siguiente_factura, siguiente_control)
SELECT COALESCE((SELECT max(substring(numero_factura_fiscal FROM '^FAC-(\d+)$')::bigint) FROM ventas), 0) + 1,
       COALESCE((SELECT max(substring(numero_control FROM '^00-(\d+)$')::bigint) FROM ventas), 0) + 1
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION fn_emitir_factura_fiscal(p_venta_id bigint)
RETURNS TABLE (numero_factura text, numero_control text)
LANGUAGE plpgsql AS $$
DECLARE v ventas; n numeracion_fiscal; f text; c text;
BEGIN
    SELECT * INTO v FROM ventas WHERE id = p_venta_id FOR UPDATE;
    IF v.id IS NULL OR v.estado <> 'COMPLETADA' THEN RAISE EXCEPTION 'La venta % no existe o está anulada', p_venta_id USING ERRCODE = 'TV006'; END IF;
    IF v.numero_factura_fiscal IS NOT NULL THEN RAISE EXCEPTION 'La venta % ya tiene factura fiscal %', v.numero, v.numero_factura_fiscal USING ERRCODE = 'TV005'; END IF;

    SELECT * INTO n FROM numeracion_fiscal WHERE id = fn_negocio_actual() FOR UPDATE;
    IF n.id IS NULL THEN RAISE EXCEPTION 'No está configurada la numeración de facturas' USING ERRCODE = 'TV006'; END IF;

    -- Salta números que ya estén usados (por ejemplo, cargados a mano antes de activar el automático).
    LOOP
        f := n.prefijo_factura || lpad(n.siguiente_factura::text, 8, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM ventas WHERE numero_factura_fiscal = f);
        n.siguiente_factura := n.siguiente_factura + 1;
    END LOOP;
    c := n.prefijo_control || lpad(n.siguiente_control::text, 8, '0');

    CALL sp_asignar_factura_fiscal(p_venta_id, f, c);
    UPDATE numeracion_fiscal SET siguiente_factura = n.siguiente_factura + 1, siguiente_control = n.siguiente_control + 1, actualizado_en = now() WHERE id = fn_negocio_actual();
    RETURN QUERY SELECT f, c;
END $$;
COMMENT ON FUNCTION fn_emitir_factura_fiscal(bigint) IS 'Asigna a una venta el siguiente número de factura y de control, de forma correlativa y atómica.';
