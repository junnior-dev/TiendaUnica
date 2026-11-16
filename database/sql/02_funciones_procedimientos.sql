-- =============================================================================
--  Archivo 02 · FUNCIONES Y PROCEDIMIENTOS ALMACENADOS
-- =============================================================================
--  CÓDIGOS DE ERROR PROPIOS (SQLSTATE) para que la app distinga los errores de negocio:
--     TV001  El sistema aún no fue configurado (asistente de primer inicio)
--     TV002  No hay tasa de cambio vigente (falta cargarla o está vencida)
--     TV003  Stock insuficiente
--     TV004  Los pagos no cuadran con el total de la venta
--     TV005  Documento inmutable (no se edita ni se borra: se anula)
--     TV006  Datos inválidos / regla de negocio incumplida
--
--  USO DESDE LA APP (Laravel / FastAPI), dentro de UNA transacción:
--     SELECT tienda.fn_cotizar_venta('[{"producto_id":1,"cantidad":2}]');   -- totales para mostrar en caja
--     SELECT tienda.fn_registrar_venta(:usuario, :items::jsonb, :pagos::jsonb);   -- registra todo
--     CALL   tienda.sp_anular_venta(:venta_id, :usuario, 'motivo');
-- =============================================================================
SET search_path = tienda, public;

-- ── 0 · Sesión multitenant (definición temprana) ────────────────────────────
--  Las funciones de negocio leen su configuración con fn_negocio_actual() en un
--  esquema multi-negocio. Esta definición temprana permite instalar 00→30 sin
--  31; el archivo 31 la vuelve a crear idéntica (fuente de verdad).
CREATE OR REPLACE FUNCTION fn_negocio_actual() RETURNS integer
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT COALESCE(NULLIF(current_setting('app.negocio_id', true), '')::integer, 1)
$$;

-- ---------------------------------------------------------------------------
--  A. UTILIDADES
-- ---------------------------------------------------------------------------

-- Fecha de hoy en hora de Venezuela (UTC-4), sin depender de la zona horaria del servidor.
CREATE OR REPLACE FUNCTION fn_hoy() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Caracas')::date $$;

-- Usuario que la app declaró para la sesión:  SELECT set_config('tienda.usuario_id','5',true);
CREATE OR REPLACE FUNCTION fn_usuario_sesion() RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('tienda.usuario_id', true), '')::bigint $$;

-- Bloquea la operación si el asistente de primer inicio no fue confirmado.
CREATE OR REPLACE FUNCTION fn_exigir_configuracion() RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM negocio WHERE configurado_en IS NOT NULL) THEN
        RAISE EXCEPTION 'El sistema aún no fue configurado: complete el asistente de configuración inicial' USING ERRCODE = 'TV001';
    END IF;
END $$;

-- Porcentaje vigente de una alícuota en una fecha (IVA_GENERAL o IGTF_DIVISAS).
CREATE OR REPLACE FUNCTION fn_param_fiscal(p_codigo text, p_fecha date DEFAULT NULL) RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE v numeric; f date := COALESCE(p_fecha, fn_hoy());
BEGIN
    SELECT porcentaje INTO v FROM parametros_fiscales
     WHERE codigo = p_codigo AND vigente_desde <= f AND (vigente_hasta IS NULL OR vigente_hasta >= f);
    IF v IS NULL THEN
        RAISE EXCEPTION 'No hay una alícuota % vigente para la fecha %', p_codigo, f USING ERRCODE = 'TV006';
    END IF;
    RETURN v;
END $$;

CREATE OR REPLACE FUNCTION fn_iva_pct(p_fecha date DEFAULT NULL) RETURNS numeric
LANGUAGE sql STABLE AS $$ SELECT fn_param_fiscal('IVA_GENERAL', p_fecha) $$;

CREATE OR REPLACE FUNCTION fn_igtf_pct(p_fecha date DEFAULT NULL) RETURNS numeric
LANGUAGE sql STABLE AS $$ SELECT fn_param_fiscal('IGTF_DIVISAS', p_fecha) $$;

-- Cambia una alícuota (IVA_GENERAL / IGTF_DIVISAS) SIN dejar hueco ni solape, en una sola transacción:
--   cierra la vigencia abierta con vigente_hasta = p_desde − 1 e inserta la nueva con vigente_desde = p_desde.
-- Un hueco de vigencia bloquea a propósito las ventas (fn_param_fiscal lanza TV006): mejor no vender que vender con
-- una alícuota inventada. Este procedimiento es la forma de rellenar/evitar ese hueco.
-- Reglas: p_desde no puede ser anterior a hoy (las ventas ya emitidas congelaron la alícuota; no se reescribe el pasado)
--         y debe ser posterior al inicio de la vigencia abierta; el porcentaje debe ser distinto del vigente en p_desde.
-- Dos llamadas simultáneas para el mismo código se serializan (la segunda falla con TV006: su fecha ya no es posterior al inicio de la vigencia abierta).
CREATE OR REPLACE PROCEDURE sp_cambiar_alicuota(p_codigo text, p_nuevo_pct numeric, p_desde date, p_nota text, p_usuario_id bigint DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE abierta parametros_fiscales;
BEGIN
    IF p_codigo IS NULL OR p_codigo NOT IN ('IVA_GENERAL', 'IGTF_DIVISAS') THEN
        RAISE EXCEPTION 'Código de alícuota inválido: % (use IVA_GENERAL o IGTF_DIVISAS)', p_codigo USING ERRCODE = 'TV006'; END IF;
    IF p_nuevo_pct IS NULL OR p_nuevo_pct = 'NaN' OR p_nuevo_pct < 0 OR p_nuevo_pct > 100 THEN
        RAISE EXCEPTION 'El porcentaje debe estar entre 0 y 100' USING ERRCODE = 'TV006'; END IF;
    IF p_desde IS NULL THEN RAISE EXCEPTION 'Indique desde qué fecha rige la nueva alícuota' USING ERRCODE = 'TV006'; END IF;
    IF p_desde < fn_hoy() THEN
        RAISE EXCEPTION 'La nueva alícuota no puede regir desde una fecha pasada (%): las ventas ya emitidas congelaron la anterior', p_desde USING ERRCODE = 'TV006'; END IF;
    IF p_nota IS NULL OR length(trim(p_nota)) < 3 THEN
        RAISE EXCEPTION 'Indique la nota (decreto o fuente) del cambio de alícuota' USING ERRCODE = 'TV006'; END IF;

    PERFORM pg_advisory_xact_lock(hashtext('parametros_fiscales:' || p_codigo));
    SELECT * INTO abierta FROM parametros_fiscales WHERE codigo = p_codigo AND vigente_hasta IS NULL;
    IF abierta.id IS NULL THEN
        RAISE EXCEPTION 'No hay una vigencia abierta de % que cerrar; revise parametros_fiscales', p_codigo USING ERRCODE = 'TV006'; END IF;
    IF p_desde <= abierta.vigente_desde THEN
        RAISE EXCEPTION 'La nueva vigencia (%) debe ser posterior al inicio de la vigente (%)', p_desde, abierta.vigente_desde USING ERRCODE = 'TV006'; END IF;
    IF abierta.porcentaje = p_nuevo_pct THEN
        RAISE EXCEPTION 'La alícuota % ya es % %% desde %', p_codigo, p_nuevo_pct, abierta.vigente_desde USING ERRCODE = 'TV006'; END IF;

    UPDATE parametros_fiscales SET vigente_hasta = p_desde - 1 WHERE id = abierta.id;
    INSERT INTO parametros_fiscales (codigo, porcentaje, vigente_desde, nota, creado_por)
    VALUES (p_codigo, p_nuevo_pct, p_desde, trim(p_nota), p_usuario_id);
END $$;

-- ---------------------------------------------------------------------------
--  A0. VALIDACIÓN DEL RIF
-- ---------------------------------------------------------------------------
-- Valida formato Y dígito verificador del RIF (módulo 11). Acepta guiones opcionales y minúsculas:
--   'J-07013380-5', 'j070133805', 'J-07013380-5' → TRUE      'J-07013380-4' → FALSE (verificador malo)
-- Algoritmo (no publicado oficialmente por el SENIAT; es el de uso general):
--   valor de la letra: V=1, E=2, J=3, P=4, G=5, C=3 (×4 = 12, igual que J; NO cambiar a 6: ver README_BASE_DE_DATOS §8 punto 5)
--   suma = valor_letra × 4  +  d1×3 + d2×2 + d3×7 + d4×6 + d5×5 + d6×4 + d7×3 + d8×2
--   verificador = 11 − (suma mod 11);  si el resultado es ≥ 10 → 0
-- Verificado contra un RIF real conocido (J-07013380-5). El valor de la letra C y los RIF de personas con
-- cédula de 7 dígitos (se escriben con un cero a la izquierda) NO se pudieron contrastar con una fuente oficial.
-- Es IMMUTABLE (depende solo del argumento), por eso puede usarse en CHECK e índices.
CREATE OR REPLACE FUNCTION fn_validar_rif(p_rif text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    norm text; letra char(1); cuerpo text; suma int := 0; v int; dv int;
    pesos int[] := ARRAY[3,2,7,6,5,4,3,2];
BEGIN
    IF p_rif IS NULL THEN RETURN false; END IF;
    -- estructura exacta: letra, guion opcional, 8 dígitos, guion opcional, 1 dígito verificador
    IF p_rif !~ '^[JGVECPjgvecp]-?[0-9]{8}-?[0-9]$' THEN RETURN false; END IF;
    norm := upper(replace(p_rif, '-', ''));
    letra := substr(norm, 1, 1);
    cuerpo := substr(norm, 2, 8);
    v := CASE letra WHEN 'V' THEN 1 WHEN 'E' THEN 2 WHEN 'J' THEN 3 WHEN 'P' THEN 4 WHEN 'G' THEN 5 WHEN 'C' THEN 3 END;
    suma := v * 4;
    FOR i IN 1..8 LOOP
        suma := suma + substr(cuerpo, i, 1)::int * pesos[i];
    END LOOP;
    dv := 11 - (suma % 11);
    IF dv >= 10 THEN dv := 0; END IF;
    -- La letra C (comuna / consejo comunal) usa el valor de Wikipedia; no se pudo contrastar con un RIF real.
    IF letra = 'C' AND dv = substr(norm, 10, 1)::int THEN
        RAISE WARNING 'RIF % con letra C validado con el algoritmo de Wikipedia; confirmar con el contador si es RIF de comunidad', p_rif;
    END IF;
    RETURN dv = substr(norm, 10, 1)::int;
END $$;

-- Los CHECK se agregan aquí (y no en el archivo 01) porque necesitan que la función ya exista.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_negocio_rif') THEN
        ALTER TABLE negocio ADD CONSTRAINT ck_negocio_rif CHECK (rif IS NULL OR fn_validar_rif(rif));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_proveedores_rif') THEN
        ALTER TABLE proveedores ADD CONSTRAINT ck_proveedores_rif CHECK (fn_validar_rif(rif));
    END IF;
END $$;

-- ---------------------------------------------------------------------------
--  B. TASA DE CAMBIO
-- ---------------------------------------------------------------------------

-- Tasa USD→VES aplicable a una fecha, según la regla del negocio:
--   · Si hay tasa con esa fecha_valor, se usa.
--   · Si no (fin de semana/feriado): SIGUIENTE (defecto) = la próxima publicada (art. 25 Ley de IVA: fin de semana y feriado se
--     convierten a la tasa del siguiente día hábil); ANTERIOR = la última publicada antes. Si no existe la siguiente (p. ej. hoy,
--     antes de que el BCV publique), cae en la anterior.
--   · Si la tasa encontrada está a más de negocio.dias_max_tasa_antigua días, lanza TV002:
--     es preferible NO vender a vender con una tasa vieja sin que nadie se dé cuenta.
CREATE OR REPLACE FUNCTION fn_tasa_aplicable(p_fecha date DEFAULT NULL, p_origen char(3) DEFAULT 'USD', p_destino char(3) DEFAULT 'VES')
RETURNS tasas_cambio
LANGUAGE plpgsql STABLE AS $$
DECLARE
    f date := COALESCE(p_fecha, fn_hoy());
    r tasas_cambio;
    regla text; maxdias int;
BEGIN
    SELECT regla_tasa_sin_publicacion, dias_max_tasa_antigua INTO regla, maxdias FROM negocio WHERE id = fn_negocio_actual();
    regla := COALESCE(regla, 'SIGUIENTE'); maxdias := COALESCE(maxdias, 4);

    SELECT * INTO r FROM tasas_cambio WHERE moneda_origen = p_origen AND moneda_destino = p_destino AND fecha_valor = f;
    IF r.id IS NULL AND regla = 'SIGUIENTE' THEN
        SELECT * INTO r FROM tasas_cambio WHERE moneda_origen = p_origen AND moneda_destino = p_destino AND fecha_valor > f
         ORDER BY fecha_valor ASC LIMIT 1;
    END IF;
    IF r.id IS NULL THEN
        SELECT * INTO r FROM tasas_cambio WHERE moneda_origen = p_origen AND moneda_destino = p_destino AND fecha_valor < f
         ORDER BY fecha_valor DESC LIMIT 1;
    END IF;
    IF r.id IS NULL THEN
        RAISE EXCEPTION 'No hay tasa de cambio % → % cargada. Registre la tasa del día.', p_origen, p_destino USING ERRCODE = 'TV002';
    END IF;
    IF abs(f - r.fecha_valor) > maxdias THEN
        RAISE EXCEPTION 'La última tasa % → % disponible es del % (más de % días). Actualice la tasa.', p_origen, p_destino, r.fecha_valor, maxdias USING ERRCODE = 'TV002';
    END IF;
    RETURN r;
END $$;

-- Conveniencia: solo el número.
CREATE OR REPLACE FUNCTION fn_tasa_bcv(p_fecha date DEFAULT NULL) RETURNS numeric
LANGUAGE sql STABLE AS $$ SELECT (fn_tasa_aplicable(p_fecha)).tasa $$;

-- Tasa entre dos monedas cualesquiera usando VES como pivote.
--   fn_tasa_par('EUR','USD') = tasa(EUR→VES) / tasa(USD→VES)
--   fn_tasa_par('COP','VES') = tasa(COP→VES)
--   fn_tasa_par('VES','EUR') = 1 / tasa(EUR→VES)
-- EUR↔COP pasa por VES. Si falta alguna tasa, fn_tasa_aplicable lanza TV002.
CREATE OR REPLACE FUNCTION fn_tasa_par(p_origen CHAR(3), p_destino CHAR(3), p_fecha DATE DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $$
DECLARE
    f DATE := COALESCE(p_fecha, fn_hoy());
    t_origen  NUMERIC;
    t_destino NUMERIC;
BEGIN
    IF p_origen = p_destino THEN RETURN 1; END IF;
    t_origen  := CASE WHEN p_origen  = 'VES' THEN 1 ELSE (fn_tasa_aplicable(f, p_origen,  'VES')).tasa END;
    t_destino := CASE WHEN p_destino = 'VES' THEN 1 ELSE (fn_tasa_aplicable(f, p_destino, 'VES')).tasa END;
    RETURN t_origen / t_destino;
END $$;

-- Guarda (o corrige) la tasa de un día. La usa el job que consulta la API y también la pantalla manual.
--   p_fuente: 'EXCHANGERATE_API' | 'BCV' | 'MANUAL'.  Corregir una tasa queda auditado en log_tasas_cambio.
--   Fecha valor: se admite hasta hoy + negocio.dias_max_tasa_futura (defecto 5). El BCV publica en la tarde la tasa con fecha valor
--   del próximo día hábil: el viernes eso es el lunes (hoy + 3), y un feriado lo aleja más. Más allá del límite se rechaza (TV006):
--   sería una tasa inventada para el futuro. (Fuentes secundarias; no verificado contra un comunicado oficial del BCV.)
CREATE OR REPLACE PROCEDURE sp_registrar_tasa(
    p_tasa numeric, p_fecha_valor date, p_fuente text DEFAULT 'MANUAL', p_es_oficial_bcv boolean DEFAULT false,
    p_usuario_id bigint DEFAULT NULL, p_origen char(3) DEFAULT 'USD', p_destino char(3) DEFAULT 'VES')
LANGUAGE plpgsql AS $$
DECLARE maxfut int;
BEGIN
    SELECT dias_max_tasa_futura INTO maxfut FROM negocio WHERE id = fn_negocio_actual();
    maxfut := COALESCE(maxfut, 5);
    IF p_tasa IS NULL OR p_tasa = 'NaN' OR p_tasa <= 0 THEN RAISE EXCEPTION 'La tasa debe ser un número mayor que cero' USING ERRCODE = 'TV006'; END IF;
    IF p_fecha_valor > fn_hoy() + maxfut THEN RAISE EXCEPTION 'La fecha valor % está demasiado adelantada (máximo hoy + % días)', p_fecha_valor, maxfut USING ERRCODE = 'TV006'; END IF;
    INSERT INTO tasas_cambio (moneda_origen, moneda_destino, tasa, fecha_valor, fuente, es_oficial_bcv, usuario_id)
    VALUES (p_origen, p_destino, p_tasa, p_fecha_valor, p_fuente, p_es_oficial_bcv, p_usuario_id)
    ON CONFLICT (moneda_origen, moneda_destino, fecha_valor)
    DO UPDATE SET tasa = EXCLUDED.tasa, fuente = EXCLUDED.fuente, es_oficial_bcv = EXCLUDED.es_oficial_bcv,
                  obtenida_en = now(), usuario_id = EXCLUDED.usuario_id;
END $$;

-- ---------------------------------------------------------------------------
--  C. PRECIOS: costo + margen = precio de venta
-- ---------------------------------------------------------------------------

-- Margen que aplica a un producto: el suyo → el de su categoría → el del negocio.
CREATE OR REPLACE FUNCTION fn_margen_para(p_margen numeric, p_categoria_id bigint) RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(p_margen,
                    (SELECT margen_pct FROM categorias WHERE id = p_categoria_id),
                    (SELECT margen_defecto_pct FROM negocio WHERE id = fn_negocio_actual()),
                    30)
$$;

CREATE OR REPLACE FUNCTION fn_margen_efectivo(p_producto_id bigint) RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT fn_margen_para(margen_pct, categoria_id) FROM productos WHERE id = p_producto_id
$$;

-- precio = costo × (1 + margen/100), redondeado al paso del negocio.
-- Si negocio.precios_incluyen_iva, el precio resultante ya trae el IVA (salvo productos exentos).
-- Ejemplo: costo 10, margen 30 → 13.00 (sin IVA)  |  con IVA incluido (16 %) → 15.08
CREATE OR REPLACE FUNCTION fn_calcular_precio_usd(p_costo numeric, p_margen numeric, p_exento boolean DEFAULT false)
RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE n negocio; precio numeric;
BEGIN
    SELECT * INTO n FROM negocio WHERE id = fn_negocio_actual();
    precio := p_costo * (1 + p_margen / 100);
    IF COALESCE(n.precios_incluyen_iva, false) AND NOT COALESCE(p_exento, false) THEN
        precio := precio * (1 + fn_iva_pct() / 100);
    END IF;
    RETURN ROUND(precio / COALESCE(n.redondeo_precio_usd, 0.01)) * COALESCE(n.redondeo_precio_usd, 0.01);
END $$;

-- Cálculo de UNA línea de venta (lo usan el trigger y la cotización: una sola fórmula en todo el sistema).
--   · Los USD se redondean a 2 decimales por línea.
--   · Los Bs salen de la base en USD × tasa, y el IVA en Bs es base_Bs × alícuota (así se factura en Bs).
CREATE OR REPLACE FUNCTION fn_calcular_linea_venta(
    p_cantidad numeric, p_precio_usd numeric, p_descuento_pct numeric, p_exento boolean,
    p_iva_pct numeric, p_precios_incluyen_iva boolean, p_tasa numeric,
    OUT base_usd numeric, OUT iva_usd numeric, OUT total_usd numeric,
    OUT base_ves numeric, OUT iva_ves numeric, OUT total_ves numeric)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE bruto numeric := p_cantidad * p_precio_usd * (1 - COALESCE(p_descuento_pct, 0) / 100);
BEGIN
    IF p_exento THEN
        base_usd := ROUND(bruto, 2); iva_usd := 0; total_usd := base_usd;
    ELSIF p_precios_incluyen_iva THEN
        total_usd := ROUND(bruto, 2);
        base_usd  := ROUND(total_usd / (1 + p_iva_pct / 100), 2);
        iva_usd   := total_usd - base_usd;
    ELSE
        base_usd := ROUND(bruto, 2);
        iva_usd  := ROUND(base_usd * p_iva_pct / 100, 2);
        total_usd := base_usd + iva_usd;
    END IF;
    base_ves  := ROUND(base_usd * p_tasa, 2);
    iva_ves   := CASE WHEN p_exento THEN 0 ELSE ROUND(base_ves * p_iva_pct / 100, 2) END;
    total_ves := base_ves + iva_ves;
END $$;

-- IGTF de un pago en divisas. p_aplicado_usd = parte de la venta que cubre ese pago (en USD).
--   igtf_base = 'CON_IVA' → pct × aplicado         (ej. 116 USD pagados → 3 % de 116 = 3.48)
--   igtf_base = 'SIN_IVA' → pct × (aplicado sin la porción de IVA)
CREATE OR REPLACE FUNCTION fn_igtf_usd(p_aplicado_usd numeric, p_total_usd numeric, p_iva_usd numeric, p_igtf_base text, p_pct numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
    SELECT ROUND(
        CASE WHEN p_igtf_base = 'SIN_IVA' AND p_total_usd > 0
             THEN p_aplicado_usd * (p_total_usd - p_iva_usd) / p_total_usd
             ELSE p_aplicado_usd END
        * COALESCE(p_pct, 0) / 100, 2)
$$;

-- Recalcula el precio de los productos desde su costo y su margen efectivo (útil después de cambiar el
-- margen de una categoría, el margen por defecto del negocio o el IVA). Cierra las alertas pendientes.
--   p_categoria_id NULL = todos los productos activos.
CREATE OR REPLACE PROCEDURE sp_recalcular_precios(p_usuario_id bigint, p_categoria_id bigint DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
    PERFORM set_config('tienda.usuario_id', COALESCE(p_usuario_id::text, ''), true);
    PERFORM set_config('tienda.motivo_precio', 'RECALCULO', true);
    FOR r IN SELECT id, costo_usd, margen_pct, categoria_id, (exento_iva OR exonerado_iva) AS sin_iva FROM productos
              WHERE activo AND (p_categoria_id IS NULL OR categoria_id = p_categoria_id) LOOP
        UPDATE productos
           SET precio_venta_usd = fn_calcular_precio_usd(r.costo_usd, fn_margen_para(r.margen_pct, r.categoria_id), r.sin_iva)
         WHERE id = r.id;
        UPDATE alertas_precio SET estado = 'APLICADA', resuelta_en = now(), resuelta_por = p_usuario_id
         WHERE producto_id = r.id AND estado = 'PENDIENTE';
    END LOOP;
    PERFORM set_config('tienda.motivo_precio', '', true);
END $$;

-- Resuelve una alerta de precio (política AVISAR).
--   APLICAR   → pone el precio sugerido (recalculado con el costo y margen actuales) o p_precio_manual si se indica.
--   DESCARTAR → deja el precio como está.
CREATE OR REPLACE PROCEDURE sp_resolver_alerta_precio(p_alerta_id bigint, p_accion text, p_usuario_id bigint, p_precio_manual numeric DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE a alertas_precio; p productos; nuevo numeric;
BEGIN
    SELECT * INTO a FROM alertas_precio WHERE id = p_alerta_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION 'La alerta % no existe', p_alerta_id USING ERRCODE = 'TV006'; END IF;
    IF a.estado <> 'PENDIENTE' THEN RAISE EXCEPTION 'La alerta % ya fue resuelta (%)', p_alerta_id, a.estado USING ERRCODE = 'TV006'; END IF;
    IF upper(p_accion) = 'APLICAR' THEN
        SELECT * INTO p FROM productos WHERE id = a.producto_id FOR UPDATE;
        nuevo := COALESCE(p_precio_manual, fn_calcular_precio_usd(p.costo_usd, fn_margen_para(p.margen_pct, p.categoria_id), p.exento_iva OR p.exonerado_iva));
        IF nuevo < 0 THEN RAISE EXCEPTION 'El precio no puede ser negativo' USING ERRCODE = 'TV006'; END IF;
        PERFORM set_config('tienda.usuario_id', COALESCE(p_usuario_id::text, ''), true);
        PERFORM set_config('tienda.motivo_precio', 'ALERTA_APLICADA', true);
        UPDATE productos SET precio_venta_usd = nuevo WHERE id = a.producto_id;
        PERFORM set_config('tienda.motivo_precio', '', true);
        UPDATE alertas_precio SET estado = 'APLICADA', resuelta_en = now(), resuelta_por = p_usuario_id WHERE id = a.id;
    ELSIF upper(p_accion) = 'DESCARTAR' THEN
        UPDATE alertas_precio SET estado = 'DESCARTADA', resuelta_en = now(), resuelta_por = p_usuario_id WHERE id = a.id;
    ELSE
        RAISE EXCEPTION 'Acción inválida "%": use APLICAR o DESCARTAR', p_accion USING ERRCODE = 'TV006';
    END IF;
END $$;

-- Aplica de una vez todas las alertas pendientes (botón «Aceptar todos los precios sugeridos»).
CREATE OR REPLACE PROCEDURE sp_aplicar_alertas_pendientes(p_usuario_id bigint)
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
    FOR r IN SELECT id FROM alertas_precio WHERE estado = 'PENDIENTE' ORDER BY id LOOP
        CALL sp_resolver_alerta_precio(r.id, 'APLICAR', p_usuario_id);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
--  D. CONFIGURACIÓN INICIAL (asistente de primer inicio)
-- ---------------------------------------------------------------------------

-- Lista de lo que falta para poder vender. La pantalla del asistente la muestra como checklist.
CREATE OR REPLACE FUNCTION fn_checklist_configuracion()
RETURNS TABLE (paso text, completo boolean, detalle text)
LANGUAGE plpgsql STABLE AS $$
DECLARE n negocio; hoy date := fn_hoy();
BEGIN
    SELECT * INTO n FROM negocio WHERE id = fn_negocio_actual();
    paso := 'Datos del negocio';
    completo := n.razon_social IS NOT NULL AND n.razon_social <> 'PENDIENTE DE CONFIGURAR' AND n.rif IS NOT NULL AND n.direccion_fiscal IS NOT NULL;
    detalle := 'Razón social, RIF y dirección fiscal'; RETURN NEXT;

    paso := 'IVA vigente';
    completo := EXISTS (SELECT 1 FROM parametros_fiscales WHERE codigo = 'IVA_GENERAL' AND vigente_desde <= hoy AND (vigente_hasta IS NULL OR vigente_hasta >= hoy));
    detalle := 'Alícuota general de IVA con vigencia hoy'; RETURN NEXT;

    paso := 'IGTF vigente';
    completo := NOT COALESCE(n.cobra_igtf, false)
                OR EXISTS (SELECT 1 FROM parametros_fiscales WHERE codigo = 'IGTF_DIVISAS' AND vigente_desde <= hoy AND (vigente_hasta IS NULL OR vigente_hasta >= hoy));
    detalle := 'Solo si el negocio cobra IGTF'; RETURN NEXT;

    paso := 'Métodos de pago';
    completo := EXISTS (SELECT 1 FROM metodos_pago WHERE activo);
    detalle := 'Al menos un método de pago activo'; RETURN NEXT;

    paso := 'Tasa de cambio';
    completo := EXISTS (SELECT 1 FROM tasas_cambio WHERE moneda_origen = 'USD' AND moneda_destino = 'VES'
                         AND abs(hoy - fecha_valor) <= COALESCE(n.dias_max_tasa_antigua, 4));
    detalle := 'Una tasa USD→VES reciente'; RETURN NEXT;

    paso := 'Administrador con contraseña';
    completo := EXISTS (SELECT 1 FROM usuarios WHERE rol = 'ADMINISTRADOR' AND activo AND password_hash <> 'PENDIENTE');
    detalle := 'El asistente la pide al confirmar'; RETURN NEXT;
END $$;

-- Paso final del asistente («confirmar»). Falla indicando qué falta; si todo está completo, habilita las ventas.
CREATE OR REPLACE PROCEDURE sp_confirmar_configuracion_inicial(p_usuario_id bigint)
LANGUAGE plpgsql AS $$
DECLARE faltan text;
BEGIN
    SELECT string_agg(paso, ', ') INTO faltan FROM fn_checklist_configuracion() WHERE NOT completo;
    IF faltan IS NOT NULL THEN
        RAISE EXCEPTION 'No se puede confirmar. Falta completar: %', faltan USING ERRCODE = 'TV006';
    END IF;
    UPDATE negocio SET configurado_en = now(), configurado_por = p_usuario_id WHERE id = fn_negocio_actual();
END $$;

-- ---------------------------------------------------------------------------
--  E. COMPRAS
-- ---------------------------------------------------------------------------

-- Registra una factura de compra completa (cabecera + líneas) en una sola llamada.
--   p_items: [{"producto_id":1,"cantidad":10,"costo_unitario":4.50}, ...]   costo SIN IVA, en la moneda de la factura
--            (opcional por línea: "exento": true)
--   p_moneda: 'USD' o 'VES'. La tasa se toma de la fecha de la factura y queda congelada.
--   Los triggers calculan IVA, costo en USD, costo del inventario (con/sin IVA según crédito fiscal),
--   actualizan costo y precio según la política del negocio y suman el stock.
CREATE OR REPLACE FUNCTION fn_registrar_compra(
    p_proveedor_id bigint, p_numero_factura text, p_fecha_factura date, p_moneda char(3), p_items jsonb,
    p_usuario_id bigint, p_numero_control text DEFAULT NULL, p_aplica_credito_fiscal boolean DEFAULT NULL,
    p_observaciones text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint; it record;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'La compra debe tener al menos un producto' USING ERRCODE = 'TV006';
    END IF;
    PERFORM set_config('tienda.usuario_id', COALESCE(p_usuario_id::text, ''), true);
    -- Bloqueo previo en orden fijo (por id) de TODOS los productos de la compra: evita interbloqueos entre cajas que
    -- compran los mismos productos en distinto orden y entre el FK de la línea y el bloqueo del kardex.
    PERFORM 1 FROM productos WHERE id IN (SELECT producto_id FROM jsonb_to_recordset(p_items) AS x(producto_id bigint)) ORDER BY id FOR UPDATE;

    INSERT INTO compras (proveedor_id, numero_factura, numero_control, fecha_factura, moneda, aplica_credito_fiscal, observaciones, usuario_id)
    VALUES (p_proveedor_id, trim(p_numero_factura), p_numero_control, p_fecha_factura, p_moneda, p_aplica_credito_fiscal, p_observaciones, p_usuario_id)
    RETURNING id INTO v_id;

    FOR it IN SELECT * FROM jsonb_to_recordset(p_items) AS x(producto_id bigint, cantidad numeric, costo_unitario numeric, exento boolean) LOOP
        INSERT INTO compra_detalle (compra_id, producto_id, cantidad, costo_unitario, exento)
        VALUES (v_id, it.producto_id, it.cantidad, it.costo_unitario, it.exento);
    END LOOP;
    RETURN v_id;
END $$;

-- Anula una compra: devuelve el stock (falla si ya se vendió parte de esa mercancía).
-- El costo del producto NO se revierte (queda en el historial); corríjalo con otra compra o ajuste.
CREATE OR REPLACE PROCEDURE sp_anular_compra(p_compra_id bigint, p_usuario_id bigint, p_motivo text)
LANGUAGE plpgsql AS $$
DECLARE c compras; d record;
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Indique el motivo de la anulación' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO c FROM compras WHERE id = p_compra_id FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'La compra % no existe', p_compra_id USING ERRCODE = 'TV006'; END IF;
    IF c.estado = 'ANULADA' THEN RAISE EXCEPTION 'La compra % ya está anulada', p_compra_id USING ERRCODE = 'TV006'; END IF;
    PERFORM set_config('tienda.usuario_id', COALESCE(p_usuario_id::text, ''), true);

    FOR d IN SELECT producto_id, sum(cantidad) AS cantidad FROM compra_detalle WHERE compra_id = p_compra_id GROUP BY producto_id ORDER BY producto_id LOOP
        INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, motivo, usuario_id)
        VALUES (d.producto_id, 'ANULACION_COMPRA', -d.cantidad, 'COMPRA', p_compra_id, p_motivo, p_usuario_id);
    END LOOP;
    UPDATE compras SET estado = 'ANULADA', anulada_en = now(), anulada_por = p_usuario_id, motivo_anulacion = trim(p_motivo) WHERE id = p_compra_id;
END $$;

-- ---------------------------------------------------------------------------
--  F. VENTAS
-- ---------------------------------------------------------------------------

-- Valida que una venta tenga líneas y que los pagos igualen el total (dentro de la tolerancia del negocio).
-- La llaman fn_registrar_venta (para dar el error enseguida) y el trigger diferido (al confirmar la transacción,
-- por si alguien inserta ventas sin pasar por la función).
CREATE OR REPLACE FUNCTION fn_validar_pagos_venta(p_venta_id bigint) RETURNS void
LANGUAGE plpgsql STABLE AS $$
DECLARE v ventas; pagado numeric; tol numeric; lineas int;
BEGIN
    SELECT * INTO v FROM ventas WHERE id = p_venta_id;
    IF v.id IS NULL OR v.estado <> 'COMPLETADA' THEN RETURN; END IF;
    SELECT count(*) INTO lineas FROM detalle_venta WHERE venta_id = p_venta_id;
    IF lineas = 0 THEN RAISE EXCEPTION 'La venta % no tiene productos', v.numero USING ERRCODE = 'TV006'; END IF;
    SELECT COALESCE(sum(monto_usd), 0) INTO pagado FROM pagos_venta WHERE venta_id = p_venta_id;
    SELECT COALESCE(tolerancia_pago_usd, 0.01) INTO tol FROM negocio WHERE id = fn_negocio_actual();
    IF abs(pagado - v.total_usd) > COALESCE(tol, 0.01) THEN
        RAISE EXCEPTION 'Los pagos (USD %) no cuadran con el total de la venta (USD %)', pagado, v.total_usd USING ERRCODE = 'TV004';
    END IF;
END $$;

-- Cotiza una venta SIN guardarla: totales en USD y Bs con la tasa de hoy. La caja la usa para mostrar el total
-- antes de pedir los pagos.   p_items: [{"producto_id":1,"cantidad":2,"descuento_pct":0}, ...]
CREATE OR REPLACE FUNCTION fn_cotizar_venta(
    p_items jsonb,
    OUT tasa_cambio numeric, OUT tasa_fecha_valor date, OUT iva_pct numeric,
    OUT base_usd numeric, OUT exento_usd numeric, OUT iva_usd numeric, OUT total_usd numeric,
    OUT base_ves numeric, OUT exento_ves numeric, OUT iva_ves numeric, OUT total_ves numeric,
    OUT cobra_igtf boolean, OUT igtf_pct numeric, OUT igtf_base text)
LANGUAGE plpgsql STABLE AS $$
DECLARE t tasas_cambio; n negocio; it record; p productos; l record;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Agregue al menos un producto' USING ERRCODE = 'TV006';
    END IF;
    SELECT * INTO n FROM negocio WHERE id = fn_negocio_actual();
    t := fn_tasa_aplicable(); tasa_cambio := t.tasa; tasa_fecha_valor := t.fecha_valor;
    iva_pct := fn_iva_pct();
    cobra_igtf := COALESCE(n.cobra_igtf, false);
    igtf_pct := CASE WHEN cobra_igtf THEN fn_igtf_pct() ELSE 0 END;
    igtf_base := n.igtf_base;
    base_usd := 0; exento_usd := 0; iva_usd := 0; total_usd := 0; base_ves := 0; exento_ves := 0; iva_ves := 0; total_ves := 0;

    FOR it IN SELECT * FROM jsonb_to_recordset(p_items) AS x(producto_id bigint, cantidad numeric, descuento_pct numeric) LOOP
        SELECT * INTO p FROM productos WHERE id = it.producto_id;
        IF p.id IS NULL THEN RAISE EXCEPTION 'El producto % no existe', it.producto_id USING ERRCODE = 'TV006'; END IF;
        SELECT * INTO l FROM fn_calcular_linea_venta(it.cantidad, p.precio_venta_usd, COALESCE(it.descuento_pct, 0), p.exento_iva OR p.exonerado_iva, iva_pct, n.precios_incluyen_iva, tasa_cambio);
        IF p.exento_iva OR p.exonerado_iva THEN
            exento_usd := exento_usd + l.base_usd; exento_ves := exento_ves + l.base_ves;
        ELSE
            base_usd := base_usd + l.base_usd; base_ves := base_ves + l.base_ves;
        END IF;
        iva_usd := iva_usd + l.iva_usd; iva_ves := iva_ves + l.iva_ves;
        total_usd := total_usd + l.total_usd; total_ves := total_ves + l.total_ves;
    END LOOP;
END $$;

-- Registra una venta completa en una transacción: cabecera, líneas, pagos (mixtos) e IGTF.
--   p_items: [{"producto_id":1,"cantidad":2,"descuento_pct":0}, ...]
--   p_pagos: [{"metodo_pago_id":1,"monto":50.00,"referencia":"...","monto_entregado":60,"vuelto_monto":10,"vuelto_moneda":"VES"}, ...]
--            «monto» = parte de la venta que cubre ese pago, EN LA MONEDA DEL MÉTODO (sin IGTF).
--   El precio, el costo, la tasa y las alícuotas los fija la base de datos; la app no los envía.
--   Devuelve el id de la venta. Errores: TV001 sin configurar, TV002 sin tasa, TV003 sin stock, TV004 pagos no cuadran.
-- La definición original (6 argumentos) de fn_registrar_venta se consolidó en las
-- extensiones sucesivas (15, 16, 24): una sola firma de 8 argumentos evita la
-- ambigüedad de overload. Ver 24_encargos.sql (última definición).

-- Anula una venta: conserva el documento (y su número), marca la anulación y devuelve la mercancía al stock.
CREATE OR REPLACE PROCEDURE sp_anular_venta(p_venta_id bigint, p_usuario_id bigint, p_motivo text)
LANGUAGE plpgsql AS $$
DECLARE v ventas; d record;
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Indique el motivo de la anulación' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO v FROM ventas WHERE id = p_venta_id FOR UPDATE;
    IF v.id IS NULL THEN RAISE EXCEPTION 'La venta % no existe', p_venta_id USING ERRCODE = 'TV006'; END IF;
    IF v.estado = 'ANULADA' THEN RAISE EXCEPTION 'La venta % ya está anulada', v.numero USING ERRCODE = 'TV006'; END IF;
    PERFORM set_config('tienda.usuario_id', COALESCE(p_usuario_id::text, ''), true);

    FOR d IN SELECT producto_id, sum(cantidad) AS cantidad FROM detalle_venta WHERE venta_id = p_venta_id GROUP BY producto_id ORDER BY producto_id LOOP
        INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, motivo, usuario_id)
        VALUES (d.producto_id, 'ANULACION_VENTA', d.cantidad, 'VENTA', p_venta_id, p_motivo, p_usuario_id);
    END LOOP;
    -- IGTF: si la política del negocio lo indica, se registra su reversión (una fila por pago con IGTF).
    -- No se decide aquí cómo se devuelve o acredita al cliente: solo queda constancia consultable (v_igtf_neto_diario).
    IF COALESCE((SELECT reversa_igtf_en_anulacion FROM negocio WHERE id = fn_negocio_actual()), true) THEN
        INSERT INTO reversiones_igtf (venta_id, pago_venta_id, igtf_usd, igtf_ves, fecha, usuario_id, motivo)
        SELECT p_venta_id, id, igtf_usd, COALESCE(igtf_ves, 0), fn_hoy(), p_usuario_id, trim(p_motivo)
          FROM pagos_venta WHERE venta_id = p_venta_id AND COALESCE(igtf_usd, 0) > 0;
    END IF;
    UPDATE ventas SET estado = 'ANULADA', anulada_en = now(), anulada_por = p_usuario_id, motivo_anulacion = trim(p_motivo) WHERE id = p_venta_id;
END $$;

-- Asigna el número de factura fiscal (y de control) que entregó el mecanismo de facturación. Solo una vez por venta.
CREATE OR REPLACE PROCEDURE sp_asignar_factura_fiscal(p_venta_id bigint, p_numero_factura text, p_numero_control text DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE v ventas;
BEGIN
    IF p_numero_factura IS NULL OR length(trim(p_numero_factura)) = 0 THEN RAISE EXCEPTION 'Indique el número de factura' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO v FROM ventas WHERE id = p_venta_id FOR UPDATE;
    IF v.id IS NULL OR v.estado <> 'COMPLETADA' THEN RAISE EXCEPTION 'La venta % no existe o está anulada', p_venta_id USING ERRCODE = 'TV006'; END IF;
    IF v.numero_factura_fiscal IS NOT NULL THEN RAISE EXCEPTION 'La venta % ya tiene factura fiscal %', v.numero, v.numero_factura_fiscal USING ERRCODE = 'TV005'; END IF;
    UPDATE ventas SET numero_factura_fiscal = trim(p_numero_factura), numero_control = COALESCE(p_numero_control, numero_control) WHERE id = p_venta_id;
END $$;
COMMENT ON PROCEDURE sp_asignar_factura_fiscal IS 'Fija una sola vez el número de factura fiscal y de control de una venta ya emitida.';

-- ---------------------------------------------------------------------------
--  G. INVENTARIO
-- ---------------------------------------------------------------------------

-- Ajuste manual de existencias. p_cantidad con signo: positivo entra, negativo sale.
--   p_inventario_inicial = true para la carga inicial de stock (tipo INVENTARIO_INICIAL; solo entradas).
CREATE OR REPLACE PROCEDURE sp_ajustar_stock(p_producto_id bigint, p_cantidad numeric, p_motivo text, p_usuario_id bigint, p_inventario_inicial boolean DEFAULT false)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_cantidad IS NULL OR p_cantidad = 0 THEN RAISE EXCEPTION 'La cantidad del ajuste no puede ser cero' USING ERRCODE = 'TV006'; END IF;
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Indique el motivo del ajuste' USING ERRCODE = 'TV006'; END IF;
    IF p_inventario_inicial AND p_cantidad < 0 THEN RAISE EXCEPTION 'El inventario inicial solo admite cantidades positivas' USING ERRCODE = 'TV006'; END IF;
    INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, motivo, usuario_id)
    VALUES (p_producto_id,
            CASE WHEN p_inventario_inicial THEN 'INVENTARIO_INICIAL' WHEN p_cantidad > 0 THEN 'AJUSTE_ENTRADA' ELSE 'AJUSTE_SALIDA' END,
            p_cantidad, 'AJUSTE', trim(p_motivo), p_usuario_id);
END $$;

-- ---------------------------------------------------------------------------
--  H. ASISTENTE DE PRIMER INICIO: guardar datos y reglas del negocio
-- ---------------------------------------------------------------------------
-- Guarda (o corrige) los datos del negocio y sus reglas fiscales/comerciales. Todo es parametrizable.
-- El asistente puede llamarla varias veces; al final llama a sp_confirmar_configuracion_inicial.
--   p_es_contribuyente_especial: si es FALSE, cobra_igtf se fuerza a FALSE (solo los sujetos pasivos especiales
--   actúan como agentes de percepción del IGTF; confirmar con el contador).
CREATE OR REPLACE PROCEDURE sp_guardar_configuracion_negocio(
    p_razon_social text, p_rif text, p_direccion_fiscal text,
    p_es_contribuyente_especial boolean DEFAULT false, p_cobra_igtf boolean DEFAULT false,
    p_recupera_credito_fiscal boolean DEFAULT true, p_precios_incluyen_iva boolean DEFAULT false,
    p_politica_costo_nuevo text DEFAULT 'AVISAR', p_metodo_costo text DEFAULT 'ULTIMO',
    p_margen_defecto_pct numeric DEFAULT 30, p_igtf_base text DEFAULT 'CON_IVA',
    p_nombre_comercial text DEFAULT NULL, p_telefono text DEFAULT NULL, p_correo text DEFAULT NULL,
    p_usuario_id bigint DEFAULT NULL)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_razon_social IS NULL OR length(trim(p_razon_social)) < 2 THEN RAISE EXCEPTION 'La razón social es obligatoria' USING ERRCODE = 'TV006'; END IF;
    IF p_rif IS NULL OR p_rif !~ '^[JGVECPjgvecp]-?[0-9]{8}-?[0-9]$' THEN
        RAISE EXCEPTION 'RIF inválido: formato incorrecto (ejemplo: J-12345678-4)' USING ERRCODE = 'TV006';
    END IF;
    IF NOT fn_validar_rif(trim(p_rif)) THEN
        RAISE EXCEPTION 'RIF inválido: dígito verificador incorrecto' USING ERRCODE = 'TV006';
    END IF;
    IF p_direccion_fiscal IS NULL OR length(trim(p_direccion_fiscal)) < 5 THEN RAISE EXCEPTION 'La dirección fiscal es obligatoria' USING ERRCODE = 'TV006'; END IF;
    IF p_igtf_base = 'SIN_IVA' THEN
        RAISE WARNING 'igtf_base = SIN_IVA no tiene respaldo en las fuentes consultadas (la base del IGTF es lo pagado en divisas, IVA incluido). Úselo solo si su contador lo confirma por escrito.';
    END IF;
    UPDATE negocio SET
        razon_social = trim(p_razon_social), nombre_comercial = p_nombre_comercial, rif = upper(trim(p_rif)),
        direccion_fiscal = trim(p_direccion_fiscal), telefono = p_telefono, correo = p_correo,
        es_contribuyente_especial = p_es_contribuyente_especial,
        cobra_igtf = p_cobra_igtf AND p_es_contribuyente_especial,
        recupera_credito_fiscal = p_recupera_credito_fiscal, precios_incluyen_iva = p_precios_incluyen_iva,
        igtf_base = p_igtf_base, politica_costo_nuevo = p_politica_costo_nuevo, metodo_costo = p_metodo_costo,
        margen_defecto_pct = p_margen_defecto_pct
     WHERE id = fn_negocio_actual();
END $$;

-- El asistente de primer inicio llama a este procedimiento con el hash bcrypt de la contraseña que elige el
-- dueño. Solo funciona si todavía no hay ningún administrador con contraseña (no pisa una ya establecida).
CREATE OR REPLACE PROCEDURE sp_primer_admin(p_password_hash text, p_nombre_completo text DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE filas int;
BEGIN
    IF p_password_hash IS NULL OR length(trim(p_password_hash)) < 20 THEN
        RAISE EXCEPTION 'La contraseña del administrador es obligatoria' USING ERRCODE = 'TV006';
    END IF;
    IF EXISTS (SELECT 1 FROM usuarios WHERE rol = 'ADMINISTRADOR' AND password_hash <> 'PENDIENTE') THEN
        RAISE EXCEPTION 'Ya hay un administrador configurado; use el cambio de contraseña' USING ERRCODE = 'TV006';
    END IF;
    PERFORM set_config('tienda.cambiando_password', '1', true);
    UPDATE usuarios
       SET password_hash = p_password_hash,
           nombre_completo = COALESCE(NULLIF(trim(p_nombre_completo), ''), nombre_completo),
           debe_cambiar_password = FALSE
     WHERE rol = 'ADMINISTRADOR' AND password_hash = 'PENDIENTE';
    GET DIAGNOSTICS filas = ROW_COUNT;
    PERFORM set_config('tienda.cambiando_password', '', true);
    IF filas = 0 THEN
        RAISE EXCEPTION 'No hay un administrador pendiente de contraseña' USING ERRCODE = 'TV006';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
--  I. NOTAS DE CRÉDITO / DÉBITO
-- ---------------------------------------------------------------------------
-- Registra una nota de crédito ('C') o débito ('D') sobre una venta completada. El IVA se calcula con la alícuota
-- congelada de la venta. No toca el stock. Aparece en v_libro_ventas (las de crédito restan).
CREATE OR REPLACE PROCEDURE sp_registrar_nota_ajuste(
    p_tipo char(1), p_venta_id bigint, p_numero text, p_base_ves numeric, p_motivo text, p_usuario_id bigint,
    p_numero_control text DEFAULT NULL, p_fecha date DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE v ventas; iva numeric;
BEGIN
    IF p_tipo NOT IN ('C','D') THEN RAISE EXCEPTION 'Tipo de nota inválido: use C (crédito) o D (débito)' USING ERRCODE = 'TV006'; END IF;
    IF p_base_ves IS NULL OR p_base_ves <= 0 THEN RAISE EXCEPTION 'La base de la nota debe ser mayor que cero' USING ERRCODE = 'TV006'; END IF;
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Indique el motivo de la nota' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO v FROM ventas WHERE id = p_venta_id;
    IF v.id IS NULL OR v.estado <> 'COMPLETADA' THEN RAISE EXCEPTION 'La venta % no existe o está anulada', p_venta_id USING ERRCODE = 'TV006'; END IF;
    iva := ROUND(p_base_ves * v.iva_pct / 100, 2);
    INSERT INTO notas_ajuste (tipo, venta_id, numero, numero_control, fecha, iva_pct, base_ves, iva_ves, total_ves, motivo, usuario_id)
    VALUES (p_tipo, p_venta_id, trim(p_numero), p_numero_control, COALESCE(p_fecha, fn_hoy()), v.iva_pct, p_base_ves, iva, p_base_ves + iva, trim(p_motivo), p_usuario_id);
END $$;
COMMENT ON PROCEDURE sp_registrar_nota_ajuste(char(1), bigint, text, numeric, text, bigint, text, date)IS 'Registra una nota de crédito (C) o débito (D) sobre una venta; no toca el stock.';


-- Alta de usuario. La API pasa el hash ya calculado con bcrypt. El rol debe ser ADMINISTRADOR o CAJERO.
CREATE OR REPLACE PROCEDURE sp_crear_usuario(
    p_username text, p_password_hash text, p_nombre_completo text, p_rol text,
    p_debe_cambiar_password boolean DEFAULT TRUE)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_username IS NULL OR length(trim(p_username)) < 3 THEN
        RAISE EXCEPTION 'El nombre de usuario debe tener al menos 3 caracteres' USING ERRCODE = 'TV006';
    END IF;
    IF p_password_hash IS NULL OR length(p_password_hash) < 20 THEN
        RAISE EXCEPTION 'La contraseña es obligatoria' USING ERRCODE = 'TV006';
    END IF;
    IF p_rol IS NULL OR p_rol NOT IN ('ADMINISTRADOR','CAJERO') THEN
        RAISE EXCEPTION 'Rol inválido: % (use ADMINISTRADOR o CAJERO)', p_rol USING ERRCODE = 'TV006';
    END IF;
    IF p_nombre_completo IS NULL OR length(trim(p_nombre_completo)) < 3 THEN
        RAISE EXCEPTION 'El nombre completo es obligatorio' USING ERRCODE = 'TV006';
    END IF;
    INSERT INTO usuarios (username, password_hash, nombre_completo, rol, debe_cambiar_password)
    VALUES (trim(p_username), p_password_hash, trim(p_nombre_completo), p_rol, p_debe_cambiar_password);
END $$;

-- Cambio de contraseña (la API comprueba la anterior antes de llamar).
CREATE OR REPLACE PROCEDURE sp_cambiar_password(p_usuario_id bigint, p_password_hash text)
LANGUAGE plpgsql AS $$
DECLARE u usuarios;
BEGIN
    IF p_password_hash IS NULL OR length(p_password_hash) < 20 THEN
        RAISE EXCEPTION 'La nueva contraseña es obligatoria' USING ERRCODE = 'TV006';
    END IF;
    SELECT * INTO u FROM usuarios WHERE id = p_usuario_id FOR UPDATE;
    IF u.id IS NULL THEN
        RAISE EXCEPTION 'El usuario % no existe', p_usuario_id USING ERRCODE = 'TV006';
    END IF;
    PERFORM set_config('tienda.cambiando_password', '1', true);
    UPDATE usuarios SET password_hash = p_password_hash, debe_cambiar_password = FALSE WHERE id = p_usuario_id;
    PERFORM set_config('tienda.cambiando_password', '', true);
END $$;

-- Re-hash controlado del login: moderniza el COSTO/ALGORITMO de un hash válido
-- (p. ej. semilla con bcrypt 10 y configuración con 12) por el único camino que
-- el trigger admite, SIN tocar debe_cambiar_password (no es un cambio de
-- contraseña: el usuario acaba de demostrar que conoce la actual). El rehash
-- nativo de Laravel queda desactivado porque haría un UPDATE directo (TV005).
CREATE OR REPLACE PROCEDURE sp_rehash_password(p_usuario_id bigint, p_password_hash text)
LANGUAGE plpgsql AS $$
DECLARE u usuarios;
BEGIN
    IF p_password_hash IS NULL OR length(p_password_hash) < 20 THEN
        RAISE EXCEPTION 'El hash nuevo es obligatorio' USING ERRCODE = 'TV006';
    END IF;
    SELECT id INTO u FROM usuarios WHERE id = p_usuario_id FOR UPDATE;
    IF u.id IS NULL THEN
        RAISE EXCEPTION 'El usuario % no existe', p_usuario_id USING ERRCODE = 'TV006';
    END IF;
    PERFORM set_config('tienda.cambiando_password', '1', true);
    UPDATE usuarios SET password_hash = p_password_hash WHERE id = p_usuario_id;
    PERFORM set_config('tienda.cambiando_password', '', true);
END $$;

COMMENT ON PROCEDURE sp_rehash_password IS 'Moderniza el costo/algoritmo del hash tras un login exitoso (la contraseña ya fue verificada). No cambia debe_cambiar_password ni la contraseña efectiva.';

-- Desactivar (no borrar): el histórico conserva la firma del usuario.
CREATE OR REPLACE PROCEDURE sp_desactivar_usuario(p_usuario_id bigint)LANGUAGE plpgsql AS $$
DECLARE u usuarios; admins_restantes int;
BEGIN
    SELECT * INTO u FROM usuarios WHERE id = p_usuario_id FOR UPDATE;
    IF u.id IS NULL THEN
        RAISE EXCEPTION 'El usuario % no existe', p_usuario_id USING ERRCODE = 'TV006';
    END IF;
    IF u.rol = 'ADMINISTRADOR' AND u.activo THEN
        SELECT count(*) INTO admins_restantes FROM usuarios
         WHERE rol = 'ADMINISTRADOR' AND activo AND id <> p_usuario_id;
        IF admins_restantes = 0 THEN
            RAISE EXCEPTION 'No se puede desactivar el último administrador activo' USING ERRCODE = 'TV006';
        END IF;
    END IF;
    UPDATE usuarios SET activo = FALSE WHERE id = p_usuario_id;
END $$;

-- Marca el último acceso (la API lo llama en un login exitoso).
CREATE OR REPLACE PROCEDURE sp_registrar_login(p_usuario_id bigint)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE usuarios SET ultimo_acceso = now() WHERE id = p_usuario_id;
END $$;

-- ---------------------------------------------------------------------------
--  Documentación en el catálogo (se ve en pgAdmin/DBeaver al pasar el cursor)
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION fn_hoy IS 'Fecha de hoy en hora de Venezuela (UTC-4).';
COMMENT ON FUNCTION fn_tasa_aplicable IS 'Tasa de cambio aplicable a una fecha según la regla del negocio; lanza TV002 si falta o está vencida.';
COMMENT ON FUNCTION fn_tasa_bcv IS 'Solo el número de la tasa USD→VES aplicable (atajo de fn_tasa_aplicable).';
COMMENT ON PROCEDURE sp_registrar_tasa IS 'Guarda o corrige la tasa de un día (API, BCV o manual). Las correcciones quedan en log_tasas_cambio. Admite fecha valor hasta hoy + negocio.dias_max_tasa_futura (defecto 5: el BCV publica con fecha valor del próximo día hábil, el viernes el lunes); más allá se rechaza con TV006.';
COMMENT ON FUNCTION fn_calcular_precio_usd IS 'precio = costo × (1 + margen/100), con IVA incluido si el negocio así lo configuró, redondeado.';
COMMENT ON FUNCTION fn_calcular_linea_venta IS 'Fórmula única de una línea de venta (USD y Bs, IVA e incluido/no incluido).';
COMMENT ON FUNCTION fn_igtf_usd IS 'IGTF de un pago en divisas según la base configurada (CON_IVA / SIN_IVA). Con SIN_IVA el IVA se descuenta en proporción a cada pago (prorrateo); la variante "sin prorratear" NO está implementada (ver README_BASE_DE_DATOS §8).';
COMMENT ON PROCEDURE sp_recalcular_precios IS 'Recalcula precios desde costo y margen (todos o de una categoría).';
COMMENT ON PROCEDURE sp_resolver_alerta_precio IS 'APLICAR o DESCARTAR una alerta de precio pendiente (política AVISAR).';
COMMENT ON PROCEDURE sp_aplicar_alertas_pendientes IS 'Aplica todas las alertas de precio pendientes.';
COMMENT ON FUNCTION fn_checklist_configuracion IS 'Qué falta para poder vender (checklist del asistente de primer inicio). Incluye «Administrador con contraseña»: el asistente la configura al confirmar.';
COMMENT ON PROCEDURE sp_guardar_configuracion_negocio IS 'Asistente: guarda datos del negocio y reglas fiscales/comerciales. Emite un WARNING si se elige igtf_base = SIN_IVA (sin respaldo en las fuentes consultadas).';
COMMENT ON PROCEDURE sp_confirmar_configuracion_inicial IS 'Asistente: paso final de confirmación; habilita las ventas.';
COMMENT ON FUNCTION fn_registrar_compra IS 'Registra una compra completa (cabecera + líneas) en una transacción; devuelve su id.';
COMMENT ON PROCEDURE sp_anular_compra IS 'Anula una compra y revierte el stock.';
COMMENT ON FUNCTION fn_cotizar_venta IS 'Totales de una venta en USD y Bs sin guardarla (pantalla de caja).';
COMMENT ON FUNCTION fn_validar_pagos_venta IS 'Verifica que la suma de pagos iguale el total de la venta (TV004).';
COMMENT ON PROCEDURE sp_anular_venta IS 'Anula una venta conservando el documento, devuelve el stock y, si negocio.reversa_igtf_en_anulacion es TRUE, registra la reversión del IGTF en reversiones_igtf.';
COMMENT ON PROCEDURE sp_ajustar_stock IS 'Ajuste manual de existencias o inventario inicial (siempre con motivo).';
COMMENT ON FUNCTION fn_usuario_sesion IS 'Usuario de la app declarado con set_config(''tienda.usuario_id'', …) en la transacción actual.';
COMMENT ON FUNCTION fn_exigir_configuracion IS 'Lanza TV001 si el asistente de primer inicio no fue confirmado.';
COMMENT ON FUNCTION fn_param_fiscal IS 'Alícuota vigente (IVA_GENERAL / IGTF_DIVISAS) en una fecha; TV006 si no hay.';
COMMENT ON FUNCTION fn_iva_pct IS 'Porcentaje de IVA vigente en una fecha (hoy por defecto).';
COMMENT ON FUNCTION fn_validar_rif IS 'TRUE si el RIF tiene formato válido y dígito verificador correcto (módulo 11). IMMUTABLE: se usa en los CHECK de negocio.rif y proveedores.rif. Letra C = 12 (igual que J, según Wikipedia; no contrastada con un RIF real): al validar un RIF con C correcto emite un WARNING para dejar rastro en el log del servidor.';
COMMENT ON PROCEDURE sp_cambiar_alicuota IS 'Cambia IVA_GENERAL/IGTF_DIVISAS cerrando la vigencia abierta en p_desde − 1 e insertando la nueva en p_desde, sin hueco ni solape. No admite fechas pasadas.';
COMMENT ON FUNCTION fn_igtf_pct IS 'Porcentaje de IGTF vigente en una fecha (hoy por defecto).';
COMMENT ON FUNCTION fn_margen_para IS 'Margen aplicable: el del producto, si no el de su categoría, si no el del negocio.';
COMMENT ON FUNCTION fn_margen_efectivo IS 'Margen efectivo de un producto por su id.';
COMMENT ON FUNCTION fn_tasa_par IS 'Tasa entre dos monedas cualesquiera, con VES como pivote. 1 si son la misma; TV002 si falta alguna de las tasas.';
COMMENT ON PROCEDURE sp_primer_admin IS 'Configura la contraseña del administrador que sembró el asistente. Solo funciona una vez (TV006 si ya hay un administrador con contraseña).';
COMMENT ON PROCEDURE sp_crear_usuario IS 'Crea un usuario. El hash bcrypt lo calcula la API. Por defecto debe cambiar la contraseña en el primer login.';
COMMENT ON PROCEDURE sp_cambiar_password IS 'Cambia el hash de la contraseña. La API comprueba la anterior antes de llamar.';
COMMENT ON PROCEDURE sp_desactivar_usuario IS 'Deshabilita un usuario (no lo borra). Falla si dejaría el sistema sin ningún administrador activo.';
COMMENT ON PROCEDURE sp_registrar_login IS 'Marca la hora del último login exitoso.';
