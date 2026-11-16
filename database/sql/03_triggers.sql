-- =============================================================================
--  Archivo 03 · TRIGGERS (reglas que la base de datos hace cumplir SIEMPRE)
-- =============================================================================
--  La idea: aunque la app tenga un error (o alguien escriba SQL a mano), los números fiscales,
--  el stock y el historial no pueden quedar inconsistentes.
--
--  MAPA DE TRIGGERS
--   negocio .............. updated_at; no se borra
--   tasas_cambio ......... auditoría de altas/correcciones/borrados en log_tasas_cambio
--   productos ............ precio por margen · historial de precios y costos · stock SOLO por kardex
--   movimientos_inventario  kardex: bloquea fila, valida stock, actualiza stock_actual · inmutable
--   compras / compra_detalle  tasa congelada · IVA · costo con/sin IVA · política de costo nuevo · stock
--   ventas / detalle_venta / pagos_venta  congelan precio, costo, tasa, IVA, IGTF · totales · pagos mixtos
--   historiales .......... inmutables (solo se agregan filas)
--
--  Variables de sesión que usan los triggers (set_config(..., true) = válidas solo en la transacción):
--     tienda.usuario_id       usuario de la app (para historiales)
--     tienda.motivo_precio    motivo del próximo cambio de precio (lo fijan los procedimientos)
--     tienda.compra_detalle_id  línea de compra que origina un cambio de costo
--     tienda.mov_stock        '1' solo mientras el kardex toca productos.stock_actual
-- =============================================================================
SET search_path = tienda, public;

-- ---------------------------------------------------------------------------
--  1. GENERALES
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- Registros inmutables: solo se insertan. Para corregir se anula o se registra un movimiento nuevo.
CREATE OR REPLACE FUNCTION trg_bloquear_modificacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% es un registro inmutable: no se modifica ni se elimina (anule o registre un movimiento nuevo)', TG_TABLE_NAME
        USING ERRCODE = 'TV005';
END $$;

-- Comparadores de cabeceras. Se anulan en una COPIA de la fila nueva los campos que sí pueden cambiar y se compara la fila
-- completa con la antigua usando la comparación nativa de filas (columna a columna, sin convertir a JSON). Así, si algún día
-- se agrega una columna a ventas/compras, queda protegida automáticamente (no hay lista de columnas que mantener).
-- Existe una versión por tabla porque plpgsql no admite argumentos de tipo record.

-- TRUE si el UPDATE solo pasa el documento a ANULADA y rellena los campos de anulación (nada más cambia).
CREATE OR REPLACE FUNCTION fn_solo_cambio_estado_y_anulacion(p_old ventas, p_new ventas) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n ventas := p_new;
BEGIN
    IF p_old.estado = 'ANULADA' OR p_new.estado IS DISTINCT FROM 'ANULADA' THEN RETURN false; END IF;
    n.estado := p_old.estado; n.anulada_en := p_old.anulada_en; n.anulada_por := p_old.anulada_por; n.motivo_anulacion := p_old.motivo_anulacion;
    RETURN n IS NOT DISTINCT FROM p_old;
END $$;

CREATE OR REPLACE FUNCTION fn_solo_cambio_estado_y_anulacion(p_old compras, p_new compras) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n compras := p_new;
BEGIN
    IF p_old.estado = 'ANULADA' OR p_new.estado IS DISTINCT FROM 'ANULADA' THEN RETURN false; END IF;
    n.estado := p_old.estado; n.anulada_en := p_old.anulada_en; n.anulada_por := p_old.anulada_por; n.motivo_anulacion := p_old.motivo_anulacion;
    RETURN n IS NOT DISTINCT FROM p_old;
END $$;

-- TRUE si el UPDATE de una venta COMPLETADA solo fija (de NULL a un valor, una vez) el número de factura fiscal y/o de control.
CREATE OR REPLACE FUNCTION fn_solo_asigna_factura_fiscal(p_old ventas, p_new ventas) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n ventas := p_new;
BEGIN
    IF p_old.estado IS DISTINCT FROM 'COMPLETADA' OR p_new.estado IS DISTINCT FROM 'COMPLETADA' THEN RETURN false; END IF;
    n.numero_factura_fiscal := p_old.numero_factura_fiscal; n.numero_control := p_old.numero_control;
    IF n IS DISTINCT FROM p_old THEN RETURN false; END IF;
    RETURN (p_old.numero_factura_fiscal IS NULL OR p_new.numero_factura_fiscal IS NOT DISTINCT FROM p_old.numero_factura_fiscal)
       AND (p_old.numero_control IS NULL OR p_new.numero_control IS NOT DISTINCT FROM p_old.numero_control);
END $$;

-- Cabeceras de compras/ventas: no se borran; solo se pueden modificar en la transacción que las crea
-- (mientras se cargan líneas y pagos), para pasar a ANULADA (cambiando únicamente los campos de anulación) o,
-- en ventas, para fijar una sola vez el número de factura fiscal / de control.
CREATE OR REPLACE FUNCTION trg_guardia_cabecera() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'No se puede borrar un documento de % : anúlelo', TG_TABLE_NAME USING ERRCODE = 'TV005';
    END IF;
    IF OLD.creada_txid = pg_current_xact_id() THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'ventas' THEN
        IF fn_solo_asigna_factura_fiscal(OLD, NEW) OR fn_solo_cambio_estado_y_anulacion(OLD, NEW) THEN RETURN NEW; END IF;
    ELSIF TG_TABLE_NAME = 'compras' THEN
        IF fn_solo_cambio_estado_y_anulacion(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'El documento de % no se puede modificar: solo puede anularse', TG_TABLE_NAME USING ERRCODE = 'TV005';
END $$;
COMMENT ON FUNCTION fn_solo_cambio_estado_y_anulacion(ventas, ventas) IS 'TRUE si el UPDATE de una venta solo la pasa a ANULADA y rellena los campos de anulación. Compara filas nativamente (protege columnas futuras).';
COMMENT ON FUNCTION fn_solo_cambio_estado_y_anulacion(compras, compras) IS 'TRUE si el UPDATE de una compra solo la pasa a ANULADA y rellena los campos de anulación. Compara filas nativamente (protege columnas futuras).';
COMMENT ON FUNCTION fn_solo_asigna_factura_fiscal(ventas, ventas) IS 'TRUE si el UPDATE de una venta COMPLETADA solo fija una vez el número de factura fiscal y/o de control (de NULL a un valor).';

-- ---------------------------------------------------------------------------
--  2. NEGOCIO Y TASAS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_negocio_no_borrar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Los datos del negocio no se pueden borrar' USING ERRCODE = 'TV005'; END $$;

CREATE OR REPLACE TRIGGER trg_negocio_updated BEFORE UPDATE ON negocio FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE OR REPLACE TRIGGER trg_negocio_no_borrar BEFORE DELETE ON negocio FOR EACH ROW EXECUTE FUNCTION trg_negocio_no_borrar();

CREATE OR REPLACE FUNCTION trg_tasas_auditoria() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO log_tasas_cambio (tasa_cambio_id, accion, moneda_origen, moneda_destino, fecha_valor, tasa_anterior, fuente, usuario_id)
        VALUES (OLD.id, 'DELETE', OLD.moneda_origen, OLD.moneda_destino, OLD.fecha_valor, OLD.tasa, OLD.fuente, fn_usuario_sesion());
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO log_tasas_cambio (tasa_cambio_id, accion, moneda_origen, moneda_destino, fecha_valor, tasa_anterior, tasa_nueva, fuente, usuario_id)
        VALUES (NEW.id, 'UPDATE', NEW.moneda_origen, NEW.moneda_destino, NEW.fecha_valor, OLD.tasa, NEW.tasa, NEW.fuente, COALESCE(NEW.usuario_id, fn_usuario_sesion()));
    ELSE
        INSERT INTO log_tasas_cambio (tasa_cambio_id, accion, moneda_origen, moneda_destino, fecha_valor, tasa_nueva, fuente, usuario_id)
        VALUES (NEW.id, 'INSERT', NEW.moneda_origen, NEW.moneda_destino, NEW.fecha_valor, NEW.tasa, NEW.fuente, COALESCE(NEW.usuario_id, fn_usuario_sesion()));
    END IF;
    RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_tasas_auditoria AFTER INSERT OR UPDATE OR DELETE ON tasas_cambio FOR EACH ROW EXECUTE FUNCTION trg_tasas_auditoria();
CREATE OR REPLACE TRIGGER trg_log_tasas_inmutable BEFORE UPDATE OR DELETE ON log_tasas_cambio FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();

-- ---------------------------------------------------------------------------
--  3. PRODUCTOS: precio = costo + margen, historiales, stock protegido
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_productos_antes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE flag boolean := COALESCE(current_setting('tienda.mov_stock', true), '') = '1';
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.stock_actual <> 0 AND NOT flag THEN
            RAISE EXCEPTION 'El stock no se carga al crear el producto: use sp_ajustar_stock(..., inventario_inicial => true)' USING ERRCODE = 'TV005';
        END IF;
        -- Sin precio indicado: se calcula desde el costo y el margen (producto → categoría → negocio).
        IF NEW.precio_venta_usd = 0 AND NEW.costo_usd > 0 THEN
            NEW.precio_venta_usd := fn_calcular_precio_usd(NEW.costo_usd, fn_margen_para(NEW.margen_pct, NEW.categoria_id), NEW.exento_iva OR NEW.exonerado_iva);
        END IF;
    ELSE
        IF NEW.stock_actual IS DISTINCT FROM OLD.stock_actual AND NOT flag THEN
            RAISE EXCEPTION 'productos.stock_actual solo cambia mediante movimientos de inventario (kardex)' USING ERRCODE = 'TV005';
        END IF;
        -- Cambió el margen y no se tocó el precio: se recalcula el precio con el margen nuevo.
        IF NEW.margen_pct IS DISTINCT FROM OLD.margen_pct AND NEW.precio_venta_usd IS NOT DISTINCT FROM OLD.precio_venta_usd THEN
            NEW.precio_venta_usd := fn_calcular_precio_usd(NEW.costo_usd, fn_margen_para(NEW.margen_pct, NEW.categoria_id), NEW.exento_iva OR NEW.exonerado_iva);
            IF COALESCE(current_setting('tienda.motivo_precio', true), '') = '' THEN
                PERFORM set_config('tienda.motivo_precio', 'CAMBIO_MARGEN', true);
            END IF;
        END IF;
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION trg_productos_despues() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE motivo text := COALESCE(NULLIF(current_setting('tienda.motivo_precio', true), ''), 'MANUAL');
        cd bigint := NULLIF(current_setting('tienda.compra_detalle_id', true), '')::bigint;
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO historial_precios (producto_id, precio_anterior_usd, precio_nuevo_usd, margen_pct, motivo, usuario_id)
        VALUES (NEW.id, 0, NEW.precio_venta_usd, fn_margen_para(NEW.margen_pct, NEW.categoria_id), 'CREACION', fn_usuario_sesion());
        -- Trazabilidad del costo inicial: si el producto se da de alta con costo, queda registrado como CREACION
        -- (antes solo se registraban los CAMBIOS de costo, no el costo original).
        IF NEW.costo_usd > 0 THEN
            INSERT INTO historial_costos (producto_id, costo_anterior_usd, costo_nuevo_usd, metodo_costo)
            VALUES (NEW.id, 0, NEW.costo_usd, 'CREACION');
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.precio_venta_usd IS DISTINCT FROM OLD.precio_venta_usd THEN
        INSERT INTO historial_precios (producto_id, precio_anterior_usd, precio_nuevo_usd, margen_pct, motivo, usuario_id)
        VALUES (NEW.id, OLD.precio_venta_usd, NEW.precio_venta_usd, fn_margen_para(NEW.margen_pct, NEW.categoria_id), motivo, fn_usuario_sesion());
        IF motivo = 'CAMBIO_MARGEN' THEN PERFORM set_config('tienda.motivo_precio', '', true); END IF;
    END IF;
    IF NEW.costo_usd IS DISTINCT FROM OLD.costo_usd THEN
        INSERT INTO historial_costos (producto_id, costo_anterior_usd, costo_nuevo_usd, metodo_costo, compra_detalle_id)
        VALUES (NEW.id, OLD.costo_usd, NEW.costo_usd, CASE WHEN cd IS NULL THEN 'MANUAL' ELSE (SELECT metodo_costo FROM negocio WHERE id = fn_negocio_actual()) END, cd);
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_productos_antes   BEFORE INSERT OR UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION trg_productos_antes();
CREATE OR REPLACE TRIGGER trg_productos_despues AFTER  INSERT OR UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION trg_productos_despues();
CREATE OR REPLACE TRIGGER trg_hist_costos_inmutable  BEFORE UPDATE OR DELETE ON historial_costos  FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();
CREATE OR REPLACE TRIGGER trg_hist_precios_inmutable BEFORE UPDATE OR DELETE ON historial_precios FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();

-- ---------------------------------------------------------------------------
--  4. KARDEX: único camino para cambiar el stock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_kardex_aplicar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE p productos; nuevo numeric; negativo boolean;
BEGIN
    SELECT * INTO p FROM productos WHERE id = NEW.producto_id FOR UPDATE;   -- bloquea: dos cajas no pisan el mismo stock
    IF p.id IS NULL THEN RAISE EXCEPTION 'El producto % no existe', NEW.producto_id USING ERRCODE = 'TV006'; END IF;
    nuevo := p.stock_actual + NEW.cantidad;
    SELECT permitir_stock_negativo INTO negativo FROM negocio WHERE id = fn_negocio_actual();
    IF nuevo < 0 AND NOT COALESCE(negativo, false) THEN
        RAISE EXCEPTION 'Stock insuficiente de "%" (%): disponible %, se pidió %', p.nombre, p.sku, p.stock_actual, -NEW.cantidad
            USING ERRCODE = 'TV003';
    END IF;
    NEW.stock_resultante := nuevo;
    PERFORM set_config('tienda.mov_stock', '1', true);
    UPDATE productos SET stock_actual = nuevo WHERE id = NEW.producto_id;
    PERFORM set_config('tienda.mov_stock', '', true);
    RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_kardex_aplicar BEFORE INSERT ON movimientos_inventario FOR EACH ROW EXECUTE FUNCTION trg_kardex_aplicar();
CREATE OR REPLACE TRIGGER trg_kardex_inmutable BEFORE UPDATE OR DELETE ON movimientos_inventario FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();

-- ---------------------------------------------------------------------------
--  5. COMPRAS
-- ---------------------------------------------------------------------------
-- Cabecera: congela la tasa (si la factura es en Bs) y decide el crédito fiscal.
CREATE OR REPLACE FUNCTION trg_compras_antes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t tasas_cambio;
BEGIN
    IF NEW.moneda = 'USD' THEN
        NEW.tasa_cambio := 1; NEW.tasa_fecha_valor := NULL;
    ELSIF NEW.moneda = 'VES' THEN
        t := fn_tasa_aplicable(NEW.fecha_factura);
        NEW.tasa_cambio := t.tasa; NEW.tasa_fecha_valor := t.fecha_valor;
    ELSE
        RAISE EXCEPTION 'Moneda de compra no soportada: % (use USD o VES)', NEW.moneda USING ERRCODE = 'TV006';
    END IF;
    IF NEW.aplica_credito_fiscal IS NULL THEN
        SELECT recupera_credito_fiscal INTO NEW.aplica_credito_fiscal FROM negocio WHERE id = fn_negocio_actual();
    END IF;
    NEW.base_imponible := 0; NEW.base_exenta := 0; NEW.monto_iva := 0; NEW.total := 0; NEW.total_usd := 0;
    NEW.estado := 'REGISTRADA'; NEW.creada_txid := pg_current_xact_id();
    RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_compras_antes BEFORE INSERT ON compras FOR EACH ROW EXECUTE FUNCTION trg_compras_antes();
CREATE OR REPLACE TRIGGER trg_compras_guardia BEFORE UPDATE OR DELETE ON compras FOR EACH ROW EXECUTE FUNCTION trg_guardia_cabecera();

-- Línea: calcula IVA, costo en USD y costo de inventario (sin IVA si hay crédito fiscal, con IVA si no).
CREATE OR REPLACE FUNCTION trg_compra_detalle_antes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE c compras; p productos; iva numeric;
BEGIN
    SELECT * INTO c FROM compras WHERE id = NEW.compra_id;
    IF c.id IS NULL OR c.creada_txid <> pg_current_xact_id() OR c.estado <> 'REGISTRADA' THEN
        RAISE EXCEPTION 'Las líneas solo se agregan en la misma transacción que crea la compra' USING ERRCODE = 'TV005';
    END IF;
    SELECT * INTO p FROM productos WHERE id = NEW.producto_id FOR UPDATE;   -- bloquea ANTES de que el FK tome su bloqueo compartido (evita interbloqueo)
    IF p.id IS NULL THEN RAISE EXCEPTION 'El producto % no existe', NEW.producto_id USING ERRCODE = 'TV006'; END IF;
    NEW.exento := COALESCE(NEW.exento, p.exento_iva OR p.exonerado_iva);
    iva := CASE WHEN NEW.exento THEN 0 ELSE fn_iva_pct(c.fecha_factura) END;
    NEW.iva_pct := iva;
    NEW.base := ROUND(NEW.cantidad * NEW.costo_unitario, 2);
    NEW.monto_iva := ROUND(NEW.base * iva / 100, 2);
    NEW.costo_unitario_usd := ROUND(NEW.costo_unitario / c.tasa_cambio, 4);
    NEW.costo_inventario_unit_usd := CASE WHEN c.aplica_credito_fiscal THEN NEW.costo_unitario_usd
                                          ELSE ROUND(NEW.costo_unitario_usd * (1 + iva / 100), 4) END;
    RETURN NEW;
END $$;

-- Después de insertar la línea: totales de la factura, nuevo costo del producto, política de precio y kardex.
CREATE OR REPLACE FUNCTION trg_compra_detalle_despues() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE c compras; n negocio; p productos; costo_nuevo numeric; sugerido numeric; margen numeric;
BEGIN
    SELECT * INTO c FROM compras WHERE id = NEW.compra_id;
    SELECT * INTO n FROM negocio WHERE id = fn_negocio_actual();

    -- a) totales de la factura (en su moneda y en USD)
    UPDATE compras k SET
        base_imponible = s.bi, base_exenta = s.be, monto_iva = s.iva, total = s.bi + s.be + s.iva,
        total_usd = ROUND((s.bi + s.be + s.iva) / k.tasa_cambio, 2)
      FROM (SELECT COALESCE(sum(base) FILTER (WHERE NOT exento), 0) bi,
                   COALESCE(sum(base) FILTER (WHERE exento), 0) be,
                   COALESCE(sum(monto_iva), 0) iva
              FROM compra_detalle WHERE compra_id = NEW.compra_id) s
     WHERE k.id = NEW.compra_id;

    -- b) nuevo costo (ULTIMO = el de esta compra; PROMEDIO = ponderado con el stock que había)
    SELECT * INTO p FROM productos WHERE id = NEW.producto_id FOR UPDATE;
    IF n.metodo_costo = 'PROMEDIO' AND p.stock_actual > 0 THEN
        costo_nuevo := ROUND((p.stock_actual * p.costo_usd + NEW.cantidad * NEW.costo_inventario_unit_usd) / (p.stock_actual + NEW.cantidad), 4);
    ELSE
        costo_nuevo := NEW.costo_inventario_unit_usd;
    END IF;

    PERFORM set_config('tienda.compra_detalle_id', NEW.id::text, true);
    margen := fn_margen_para(p.margen_pct, p.categoria_id);
    sugerido := fn_calcular_precio_usd(costo_nuevo, margen, p.exento_iva OR p.exonerado_iva);

    IF costo_nuevo IS DISTINCT FROM p.costo_usd THEN
        IF n.politica_costo_nuevo = 'AUTOMATICO' OR (n.politica_costo_nuevo = 'AVISAR' AND p.precio_venta_usd = 0) THEN
            -- Automático (o producto sin precio todavía: no hay nada que proteger)
            PERFORM set_config('tienda.motivo_precio', 'COSTO_AUTOMATICO', true);
            UPDATE productos SET costo_usd = costo_nuevo, precio_venta_usd = sugerido WHERE id = p.id;
            PERFORM set_config('tienda.motivo_precio', '', true);
        ELSE
            UPDATE productos SET costo_usd = costo_nuevo WHERE id = p.id;
            IF n.politica_costo_nuevo = 'AVISAR' AND sugerido IS DISTINCT FROM p.precio_venta_usd THEN
                INSERT INTO alertas_precio (producto_id, costo_nuevo_usd, margen_pct, precio_actual_usd, precio_sugerido_usd, compra_detalle_id)
                VALUES (p.id, costo_nuevo, margen, p.precio_venta_usd, sugerido, NEW.id)
                ON CONFLICT (producto_id) WHERE estado = 'PENDIENTE'
                DO UPDATE SET costo_nuevo_usd = EXCLUDED.costo_nuevo_usd, margen_pct = EXCLUDED.margen_pct,
                              precio_actual_usd = EXCLUDED.precio_actual_usd, precio_sugerido_usd = EXCLUDED.precio_sugerido_usd,
                              compra_detalle_id = EXCLUDED.compra_detalle_id, creada_en = now();
            END IF;
        END IF;
    END IF;
    PERFORM set_config('tienda.compra_detalle_id', '', true);

    -- c) kardex (suma el stock)
    INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id)
    VALUES (NEW.producto_id, 'COMPRA', NEW.cantidad, 'COMPRA', NEW.compra_id, c.usuario_id);
    RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_compra_detalle_antes   BEFORE INSERT ON compra_detalle FOR EACH ROW EXECUTE FUNCTION trg_compra_detalle_antes();
CREATE OR REPLACE TRIGGER trg_compra_detalle_despues AFTER  INSERT ON compra_detalle FOR EACH ROW EXECUTE FUNCTION trg_compra_detalle_despues();
CREATE OR REPLACE TRIGGER trg_compra_detalle_inmutable BEFORE UPDATE OR DELETE ON compra_detalle FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();

-- ---------------------------------------------------------------------------
--  6. VENTAS
-- ---------------------------------------------------------------------------
-- Cabecera: congela fecha valor, tasa BCV y alícuotas vigentes. La app no puede imponer estos valores.
CREATE OR REPLACE FUNCTION trg_ventas_antes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE n negocio; t tasas_cambio;
BEGIN
    PERFORM fn_exigir_configuracion();
    SELECT * INTO n FROM negocio WHERE id = fn_negocio_actual();
    t := fn_tasa_aplicable();
    NEW.fecha_hora := now();
    NEW.fecha_valor := fn_hoy();
    NEW.tasa_cambio := t.tasa; NEW.tasa_fecha_valor := t.fecha_valor;
    NEW.iva_pct := fn_iva_pct();
    NEW.precios_incluyen_iva := n.precios_incluyen_iva;
    NEW.cobra_igtf := n.cobra_igtf;
    NEW.igtf_pct := CASE WHEN n.cobra_igtf THEN fn_igtf_pct() ELSE 0 END;
    NEW.igtf_base := n.igtf_base;
    NEW.base_usd := 0; NEW.exento_usd := 0; NEW.iva_usd := 0; NEW.total_usd := 0; NEW.igtf_usd := 0; NEW.total_cobrar_usd := 0;
    NEW.base_ves := 0; NEW.exento_ves := 0; NEW.iva_ves := 0; NEW.total_ves := 0; NEW.igtf_ves := 0; NEW.total_cobrar_ves := 0;
    NEW.estado := 'COMPLETADA'; NEW.creada_txid := pg_current_xact_id();
    NEW.anulada_en := NULL; NEW.anulada_por := NULL; NEW.motivo_anulacion := NULL;
    RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_ventas_antes BEFORE INSERT ON ventas FOR EACH ROW EXECUTE FUNCTION trg_ventas_antes();
CREATE OR REPLACE TRIGGER trg_ventas_guardia BEFORE UPDATE OR DELETE ON ventas FOR EACH ROW EXECUTE FUNCTION trg_guardia_cabecera();

-- Línea: precio y costo salen del producto (congelados); IVA y Bs con la tasa de la cabecera.
CREATE OR REPLACE FUNCTION trg_detalle_venta_antes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v ventas; p productos; l record;
BEGIN
    SELECT * INTO v FROM ventas WHERE id = NEW.venta_id;
    IF v.id IS NULL OR v.creada_txid <> pg_current_xact_id() OR v.estado <> 'COMPLETADA' THEN
        RAISE EXCEPTION 'Las líneas solo se agregan en la misma transacción que crea la venta' USING ERRCODE = 'TV005';
    END IF;
    IF EXISTS (SELECT 1 FROM pagos_venta WHERE venta_id = NEW.venta_id) THEN
        RAISE EXCEPTION 'No se pueden agregar productos después de registrar pagos' USING ERRCODE = 'TV005';
    END IF;
    SELECT * INTO p FROM productos WHERE id = NEW.producto_id FOR UPDATE;   -- bloquea ANTES de que el FK tome su bloqueo compartido (evita interbloqueo)
    IF p.id IS NULL OR NOT p.activo THEN RAISE EXCEPTION 'El producto % no existe o está inactivo', NEW.producto_id USING ERRCODE = 'TV006'; END IF;
    IF p.precio_venta_usd <= 0 THEN RAISE EXCEPTION 'El producto "%" no tiene precio de venta', p.nombre USING ERRCODE = 'TV006'; END IF;

    NEW.descripcion := COALESCE(NEW.descripcion, p.nombre);
    NEW.precio_unitario_usd := p.precio_venta_usd;
    NEW.costo_unitario_usd := p.costo_usd;
    NEW.exento := p.exento_iva OR p.exonerado_iva;
    NEW.alicuota_codigo := CASE WHEN p.exento_iva THEN 'EXENTO' WHEN p.exonerado_iva THEN 'EXONERADO' ELSE 'IVA_GENERAL' END;
    NEW.iva_pct := CASE WHEN NEW.exento THEN 0 ELSE v.iva_pct END;
    SELECT * INTO l FROM fn_calcular_linea_venta(NEW.cantidad, NEW.precio_unitario_usd, NEW.descuento_pct, NEW.exento,
                                                  v.iva_pct, v.precios_incluyen_iva, v.tasa_cambio);
    NEW.base_usd := l.base_usd; NEW.iva_usd := l.iva_usd; NEW.total_usd := l.total_usd;
    NEW.base_ves := l.base_ves; NEW.iva_ves := l.iva_ves; NEW.total_ves := l.total_ves;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION trg_detalle_venta_despues() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE usr bigint;
BEGIN
    UPDATE ventas v SET
        base_usd = s.bu, exento_usd = s.eu, iva_usd = s.iu, total_usd = s.tu, total_cobrar_usd = s.tu,
        base_ves = s.bv, exento_ves = s.ev, iva_ves = s.iv, total_ves = s.tv, total_cobrar_ves = s.tv
      FROM (SELECT COALESCE(sum(base_usd) FILTER (WHERE NOT exento), 0) bu, COALESCE(sum(base_usd) FILTER (WHERE exento), 0) eu,
                   COALESCE(sum(iva_usd), 0) iu, COALESCE(sum(total_usd), 0) tu,
                   COALESCE(sum(base_ves) FILTER (WHERE NOT exento), 0) bv, COALESCE(sum(base_ves) FILTER (WHERE exento), 0) ev,
                   COALESCE(sum(iva_ves), 0) iv, COALESCE(sum(total_ves), 0) tv
              FROM detalle_venta WHERE venta_id = NEW.venta_id) s
     WHERE v.id = NEW.venta_id
    RETURNING v.usuario_id INTO usr;

    INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, usuario_id)
    VALUES (NEW.producto_id, 'VENTA', -NEW.cantidad, 'VENTA', NEW.venta_id, usr);
    RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_detalle_venta_antes   BEFORE INSERT ON detalle_venta FOR EACH ROW EXECUTE FUNCTION trg_detalle_venta_antes();
CREATE OR REPLACE TRIGGER trg_detalle_venta_despues AFTER  INSERT ON detalle_venta FOR EACH ROW EXECUTE FUNCTION trg_detalle_venta_despues();
CREATE OR REPLACE TRIGGER trg_detalle_venta_inmutable BEFORE UPDATE OR DELETE ON detalle_venta FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();

-- Pago: moneda del método, tasa congelada, equivalentes USD/Bs, congelación de la tasa para monedas
-- distintas de USD/VES (EUR, COP...) e IGTF solo sobre la parte en divisas.
--   «monto» es lo que el pago cubre de la venta (en la moneda del método), sin IGTF.
--   USD:  monto_usd = monto,             monto_ves = monto × tasa_venta
--   VES:  monto_usd = monto / tasa_venta, monto_ves = monto
--   Otras: se congela la tasa moneda→VES en ventas_tasas (una vez por venta y moneda) y
--          monto_ves = monto × tasa_directa; monto_usd = monto_ves / tasa_venta.
CREATE OR REPLACE FUNCTION trg_pagos_venta_antes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v ventas; m metodos_pago; tasa_directa numeric;
BEGIN
    SELECT * INTO v FROM ventas WHERE id = NEW.venta_id;
    IF v.id IS NULL OR v.creada_txid <> pg_current_xact_id() OR v.estado <> 'COMPLETADA' THEN
        RAISE EXCEPTION 'Los pagos solo se agregan en la misma transacción que crea la venta' USING ERRCODE = 'TV005';
    END IF;
    SELECT * INTO m FROM metodos_pago WHERE id = NEW.metodo_pago_id;
    IF m.id IS NULL OR NOT m.activo THEN RAISE EXCEPTION 'El método de pago % no existe o está inactivo', NEW.metodo_pago_id USING ERRCODE = 'TV006'; END IF;
    IF m.requiere_referencia AND (NEW.referencia IS NULL OR length(trim(NEW.referencia)) = 0) THEN
        RAISE EXCEPTION 'El método "%" requiere número de referencia', m.nombre USING ERRCODE = 'TV006';
    END IF;

    NEW.moneda := m.moneda;

    IF m.moneda NOT IN ('USD', 'VES') THEN
        -- Congela la tasa de esa moneda la primera vez que aparece en la venta (TV002 si falta o está vencida).
        INSERT INTO ventas_tasas (venta_id, moneda, tasa, fecha_valor)
        SELECT v.id, m.moneda, t.tasa, t.fecha_valor
          FROM fn_tasa_aplicable(v.fecha_valor, m.moneda, 'VES') t
        ON CONFLICT (venta_id, moneda) DO NOTHING;
        SELECT tasa INTO tasa_directa FROM ventas_tasas WHERE venta_id = v.id AND moneda = m.moneda;
    END IF;

    IF m.moneda = 'USD' THEN
        NEW.tasa_cambio := 1;
        NEW.monto_usd := NEW.monto;
        NEW.monto_ves := ROUND(NEW.monto * v.tasa_cambio, 2);
    ELSIF m.moneda = 'VES' THEN
        NEW.tasa_cambio := v.tasa_cambio;
        NEW.monto_usd := ROUND(NEW.monto / v.tasa_cambio, 2);
        NEW.monto_ves := NEW.monto;
    ELSE
        NEW.tasa_cambio := tasa_directa;
        NEW.monto_ves := ROUND(NEW.monto * tasa_directa, 2);
        NEW.monto_usd := ROUND(NEW.monto_ves / v.tasa_cambio, 2);
    END IF;

    NEW.aplica_igtf := COALESCE(v.cobra_igtf, false) AND m.aplica_igtf;
    IF NEW.aplica_igtf THEN
        NEW.igtf_usd := fn_igtf_usd(NEW.monto_usd, v.total_usd, v.iva_usd, v.igtf_base, v.igtf_pct);
        NEW.igtf_ves := ROUND(NEW.igtf_usd * v.tasa_cambio, 2);
        -- igtf_monto va en la moneda del pago
        IF m.moneda = 'USD' THEN NEW.igtf_monto := NEW.igtf_usd;
        ELSIF m.moneda = 'VES' THEN NEW.igtf_monto := NEW.igtf_ves;
        ELSE NEW.igtf_monto := ROUND(NEW.igtf_ves / tasa_directa, 2);
        END IF;
    ELSE
        NEW.igtf_usd := 0; NEW.igtf_ves := 0; NEW.igtf_monto := 0;
    END IF;
    NEW.monto_cobrado := NEW.monto + NEW.igtf_monto;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION trg_pagos_venta_despues() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE ventas v SET
        igtf_usd = s.iu, igtf_ves = s.iv,
        total_cobrar_usd = v.total_usd + s.iu, total_cobrar_ves = v.total_ves + s.iv
      FROM (SELECT COALESCE(sum(igtf_usd), 0) iu, COALESCE(sum(igtf_ves), 0) iv FROM pagos_venta WHERE venta_id = NEW.venta_id) s
     WHERE v.id = NEW.venta_id;
    RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_pagos_venta_antes   BEFORE INSERT ON pagos_venta FOR EACH ROW EXECUTE FUNCTION trg_pagos_venta_antes();
CREATE OR REPLACE TRIGGER trg_pagos_venta_despues AFTER  INSERT ON pagos_venta FOR EACH ROW EXECUTE FUNCTION trg_pagos_venta_despues();
CREATE OR REPLACE TRIGGER trg_pagos_venta_inmutable BEFORE UPDATE OR DELETE ON pagos_venta FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();
CREATE OR REPLACE TRIGGER trg_ventas_tasas_inmutable BEFORE UPDATE OR DELETE ON ventas_tasas FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();

-- PAGOS MIXTOS: al confirmar la transacción, la suma de pagos (en USD) debe igualar el total de la venta
-- (tolerancia = negocio.tolerancia_pago_usd). Es un trigger DIFERIDO: se evalúa en el COMMIT, cuando ya están
-- todas las líneas y pagos. Así no se puede guardar una venta sin pagos o con pagos que no cuadran.
CREATE OR REPLACE FUNCTION trg_ventas_validar_pagos() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN PERFORM fn_validar_pagos_venta(NEW.id); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS trg_pagos_mixto ON ventas;
CREATE CONSTRAINT TRIGGER trg_pagos_mixto AFTER INSERT ON ventas
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_ventas_validar_pagos();

-- ---------------------------------------------------------------------------
--  7. updated_at de catálogos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_notas_ajuste_inmutable BEFORE UPDATE OR DELETE ON notas_ajuste FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();
CREATE OR REPLACE TRIGGER trg_reversiones_igtf_inmutable BEFORE UPDATE OR DELETE ON reversiones_igtf FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();
CREATE OR REPLACE TRIGGER trg_categorias_updated  BEFORE UPDATE ON categorias  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE OR REPLACE TRIGGER trg_proveedores_updated BEFORE UPDATE ON proveedores FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE OR REPLACE TRIGGER trg_clientes_updated    BEFORE UPDATE ON clientes    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Usuarios: el hash de la contraseña solo cambia desde sp_primer_admin / sp_cambiar_password (que activan
-- tienda.cambiando_password dentro de su transacción). Un UPDATE directo se rechaza. Es una guarda contra
-- accidentes, no contra un administrador de la base que active la variable a propósito.
CREATE OR REPLACE FUNCTION trg_usuarios_password() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
       AND COALESCE(current_setting('tienda.cambiando_password', true), '') <> '1' THEN
        RAISE EXCEPTION 'La contraseña solo cambia mediante sp_primer_admin o sp_cambiar_password' USING ERRCODE = 'TV005';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_usuarios_antes BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION trg_usuarios_password();
