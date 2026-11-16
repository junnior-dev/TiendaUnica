-- =============================================================================
--  19 · Historial del régimen fiscal y asiento de apertura guiado
-- =============================================================================
--  Requiere: 10_contabilidad.sql. Es idempotente:
--     psql -d tienda -v ON_ERROR_STOP=1 -f 19_regimen_y_apertura.sql
--
--  1. Historial del régimen (especial u ordinario): el SENIAT puede revocar de oficio el estatus de sujeto pasivo especial, y desde
--     ese día cambian el IVA (declaración mensual), la retención de IVA, la percepción del IGTF y los anticipos de ISLR. El negocio
--     cambia su estatus en Configuración y aquí queda quién, cuándo y con qué valores (inmutable, para una fiscalización).
--  2. Asiento de apertura: el primer asiento del Libro Diario, con la situación con la que arranca la contabilidad.
--       Debe : Caja, Bancos, Inventario (a costo, tomado del kardex), Mobiliario y equipos, Otras cuentas por cobrar.
--       Haber: Otras cuentas por pagar y el Capital (la diferencia; si fuera negativa, va al debe de Resultados acumulados).
--     Las cuentas por cobrar y por pagar de ventas y compras del sistema NO se cargan aquí: tienen su propio control (1.1.06 y 2.1.01
--     deben seguir siendo iguales a lo que muestran Cuentas por cobrar y Cuentas por pagar).
--  Los montos son un punto de partida: revísalos con tu contador.
-- =============================================================================
SET search_path = tienda, public;

-- ---------------------------------------------------------------------------
--  1. HISTORIAL DEL RÉGIMEN
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS negocio_regimen_historial (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    es_especial   boolean     NOT NULL,
    cobra_igtf    boolean     NOT NULL,
    cambiado_en   timestamptz NOT NULL DEFAULT now(),
    usuario_id    bigint      REFERENCES usuarios(id),
    nota          text
);
COMMENT ON TABLE negocio_regimen_historial IS 'Cada vez que cambia el estatus de contribuyente especial o el cobro de IGTF. Solo se inserta.';
DROP TRIGGER IF EXISTS trg_regimen_hist_inmutable ON negocio_regimen_historial;
CREATE TRIGGER trg_regimen_hist_inmutable BEFORE UPDATE OR DELETE ON negocio_regimen_historial FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();

CREATE OR REPLACE FUNCTION trg_negocio_regimen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO negocio_regimen_historial (es_especial, cobra_igtf, usuario_id, nota)
    VALUES (NEW.es_contribuyente_especial, NEW.cobra_igtf, NEW.configurado_por,
            CASE WHEN TG_OP = 'INSERT' THEN 'Alta del negocio'
                 WHEN OLD.es_contribuyente_especial AND NOT NEW.es_contribuyente_especial THEN 'Dejó de ser contribuyente especial'
                 WHEN NOT OLD.es_contribuyente_especial AND NEW.es_contribuyente_especial THEN 'Pasó a contribuyente especial'
                 ELSE 'Cambió el cobro de IGTF' END);
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_negocio_regimen_upd ON negocio;
CREATE TRIGGER trg_negocio_regimen_upd AFTER UPDATE ON negocio
    FOR EACH ROW WHEN (OLD.es_contribuyente_especial IS DISTINCT FROM NEW.es_contribuyente_especial OR OLD.cobra_igtf IS DISTINCT FROM NEW.cobra_igtf)
    EXECUTE FUNCTION trg_negocio_regimen();
DROP TRIGGER IF EXISTS trg_negocio_regimen_ins ON negocio;
CREATE TRIGGER trg_negocio_regimen_ins AFTER INSERT ON negocio FOR EACH ROW EXECUTE FUNCTION trg_negocio_regimen();

-- Punto de partida para los negocios que ya existían.
INSERT INTO negocio_regimen_historial (es_especial, cobra_igtf, usuario_id, nota)
SELECT n.es_contribuyente_especial, n.cobra_igtf, n.configurado_por, 'Régimen al instalar el historial'
  FROM negocio n WHERE NOT EXISTS (SELECT 1 FROM negocio_regimen_historial);

-- ---------------------------------------------------------------------------
--  2. CUENTAS Y PARÁMETROS PARA LA APERTURA (y para el ISLR del SQL 20)
-- ---------------------------------------------------------------------------
INSERT INTO plan_cuentas (codigo, nombre, tipo, cuenta_padre_id, permite_movimiento)
SELECT x.codigo, x.nombre, x.tipo, (SELECT id FROM plan_cuentas WHERE codigo = x.padre), x.mov
  FROM (VALUES
    ('1.2',    'Activo no corriente',          'ACTIVO', '1',   false),
    ('1.2.01', 'Mobiliario y equipos',         'ACTIVO', '1.2', true),
    ('1.1.07', 'Otras cuentas por cobrar',     'ACTIVO', '1.1', true),
    ('2.1.04', 'ISLR retenido por pagar',      'PASIVO', '2.1', true),
    ('2.1.05', 'Otras cuentas por pagar',      'PASIVO', '2.1', true)
  ) AS x(codigo, nombre, tipo, padre, mov)
 WHERE NOT EXISTS (SELECT 1 FROM plan_cuentas p WHERE p.codigo = x.codigo);

INSERT INTO contab_parametros (clave, cuenta_id, nota)
SELECT x.clave, (SELECT id FROM plan_cuentas WHERE codigo = x.codigo), x.nota
  FROM (VALUES
    ('ACTIVOS_FIJOS',   '1.2.01', 'Mobiliario y equipos que se cargan en la apertura'),
    ('OTRAS_CXC',       '1.1.07', 'Cuentas por cobrar que no vienen de ventas del sistema (apertura)'),
    ('OTRAS_CXP',       '2.1.05', 'Deudas que no vienen de compras del sistema (apertura)'),
    ('CAPITAL',         '3.1.01', 'Capital con el que arranca la contabilidad'),
    ('RESULTADOS_ACUM', '3.1.02', 'Resultados acumulados (cierre de ejercicio y déficit de apertura)'),
    ('ISLR_POR_PAGAR',  '2.1.04', 'ISLR retenido a proveedores, pendiente de enterar al SENIAT'),
    ('GASTOS_GENERALES','5.2.02', 'Gasto de los servicios sobre los que se retiene ISLR')
  ) AS x(clave, codigo, nota)
ON CONFLICT (clave) DO NOTHING;

-- Tipos de asiento nuevos (este SQL y el 20). Algunos nombres son más largos que la columna original (varchar(20)).
ALTER TABLE asientos ALTER COLUMN origen_tipo TYPE varchar(40);
ALTER TABLE asientos DROP CONSTRAINT IF EXISTS asientos_origen_tipo_check;
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo IN
    ('MANUAL','APERTURA','VENTA','ANULACION_VENTA','COMPRA','ANULACION_COMPRA','NOTA_CREDITO','NOTA_DEBITO','DEVOLUCION_COSTO','PAGO_PROVEEDOR','ANULACION_PAGO','CIERRE','AJUSTE_CAMBIARIO','COBRO_CLIENTE','ANULACION_COBRO',
     'RETENCION_ISLR','ANULACION_RETENCION_ISLR','ENTERO_ISLR','ANULACION_ENTERO_ISLR'));

-- ---------------------------------------------------------------------------
--  3. ASIENTO DE APERTURA
-- ---------------------------------------------------------------------------
-- Lo que el sistema ya sabe para una fecha de apertura: valor del inventario a costo al cierre del día anterior (kardex),
-- tasa de ese día, si ya existe la apertura y desde cuándo hay asientos (la apertura no puede ser posterior).
CREATE OR REPLACE FUNCTION fn_apertura_vista(p_fecha date) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE t numeric; inv_usd numeric; prod bigint; primero date; ap asientos;
BEGIN
    BEGIN t := fn_tasa_par('USD', 'VES', p_fecha); EXCEPTION WHEN OTHERS THEN t := NULL; END;
    SELECT l.valor_usd, l.productos INTO inv_usd, prod FROM fn_libro_inventario(p_fecha - 1) l WHERE l.es_total;
    SELECT min(fecha) INTO primero FROM asientos WHERE origen_tipo <> 'APERTURA';
    SELECT * INTO ap FROM asientos WHERE origen_tipo = 'APERTURA' LIMIT 1;
    RETURN jsonb_build_object(
        'existe', ap.id IS NOT NULL, 'fecha_apertura', ap.fecha, 'numero_asiento', ap.numero_asiento,
        'tasa', t, 'inventario_usd', COALESCE(inv_usd, 0), 'inventario_ves', CASE WHEN t IS NOT NULL THEN ROUND(COALESCE(inv_usd, 0) * t, 2) END,
        'productos', COALESCE(prod, 0), 'primer_asiento', primero,
        'automatica', COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false));
END $$;
COMMENT ON FUNCTION fn_apertura_vista(date) IS 'Datos que el asistente de apertura toma del sistema: inventario a costo al cierre del día anterior, tasa y estado de la apertura.';

-- Crea la apertura (una sola vez). Fecha = primer día de la contabilidad; el inventario sale del kardex al cierre del día anterior.
CREATE OR REPLACE FUNCTION fn_crear_apertura(
    p_fecha date, p_caja_ves numeric, p_caja_usd numeric, p_bancos_ves numeric, p_bancos_usd numeric,
    p_activos_fijos_ves numeric, p_otras_cxc_ves numeric, p_deudas_ves numeric, p_usuario_id bigint)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE t numeric; inv_usd numeric; inv_ves numeric; caja numeric; bancos numeric; fijos numeric; cxc numeric; deudas numeric;
        activos numeric; dif numeric; lineas jsonb := '[]'::jsonb; primero date; v_id bigint;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('tienda.apertura.contable'));
    IF p_fecha IS NULL OR p_fecha > fn_hoy() THEN RAISE EXCEPTION 'La fecha de la apertura no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    IF EXISTS (SELECT 1 FROM asientos WHERE origen_tipo = 'APERTURA') THEN
        RAISE EXCEPTION 'Ya existe el asiento de apertura. Si hay un error, corrígelo con un asiento manual' USING ERRCODE = 'TV005';
    END IF;
    SELECT min(fecha) INTO primero FROM asientos;
    IF primero IS NOT NULL AND primero < p_fecha THEN
        RAISE EXCEPTION 'Ya hay asientos desde el % (ventas o compras con contabilidad automática): la apertura debe tener esa fecha o una anterior, porque si no esos movimientos se contarían dos veces', to_char(primero, 'DD/MM/YYYY') USING ERRCODE = 'TV005';
    END IF;
    IF LEAST(COALESCE(p_caja_ves,0), COALESCE(p_caja_usd,0), COALESCE(p_bancos_ves,0), COALESCE(p_bancos_usd,0), COALESCE(p_activos_fijos_ves,0), COALESCE(p_otras_cxc_ves,0), COALESCE(p_deudas_ves,0)) < 0 THEN
        RAISE EXCEPTION 'Los montos no pueden ser negativos' USING ERRCODE = 'TV006';
    END IF;
    BEGIN t := fn_tasa_par('USD', 'VES', p_fecha); EXCEPTION WHEN OTHERS THEN t := NULL; END;
    IF t IS NULL OR t <= 0 THEN RAISE EXCEPTION 'No hay tasa del dólar para el %: cárgala en Tasas de cambio', to_char(p_fecha, 'DD/MM/YYYY') USING ERRCODE = 'TV006'; END IF;

    SELECT COALESCE(l.valor_usd, 0) INTO inv_usd FROM fn_libro_inventario(p_fecha - 1) l WHERE l.es_total;
    inv_ves := ROUND(COALESCE(inv_usd, 0) * t, 2);
    caja := ROUND(COALESCE(p_caja_ves, 0) + COALESCE(p_caja_usd, 0) * t, 2);
    bancos := ROUND(COALESCE(p_bancos_ves, 0) + COALESCE(p_bancos_usd, 0) * t, 2);
    fijos := ROUND(COALESCE(p_activos_fijos_ves, 0), 2); cxc := ROUND(COALESCE(p_otras_cxc_ves, 0), 2); deudas := ROUND(COALESCE(p_deudas_ves, 0), 2);
    activos := caja + bancos + inv_ves + fijos + cxc;
    IF activos = 0 THEN RAISE EXCEPTION 'No hay nada que abrir: indica al menos un monto o carga el inventario inicial' USING ERRCODE = 'TV006'; END IF;

    IF caja   > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('CAJA'),          'debe', caja,    'glosa', 'Efectivo en caja'); END IF;
    IF bancos > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('BANCOS'),        'debe', bancos,  'glosa', 'Saldos en bancos'); END IF;
    IF inv_ves > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('INVENTARIO'),   'debe', inv_ves, 'glosa', 'Inventario a costo (kardex), tasa ' || to_char(t, 'FM999G999G990D0000')); END IF;
    IF fijos  > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('ACTIVOS_FIJOS'), 'debe', fijos,   'glosa', 'Mobiliario y equipos'); END IF;
    IF cxc    > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('OTRAS_CXC'),     'debe', cxc,     'glosa', 'Otras cuentas por cobrar'); END IF;
    IF deudas > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('OTRAS_CXP'),     'haber', deudas, 'glosa', 'Deudas anteriores'); END IF;
    dif := activos - deudas;
    IF dif > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('CAPITAL'), 'haber', dif, 'glosa', 'Capital: activos menos deudas');
    ELSIF dif < 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('RESULTADOS_ACUM'), 'debe', -dif, 'glosa', 'Déficit inicial: las deudas superan a los activos'); END IF;

    v_id := fn_crear_asiento(p_fecha, 'Asiento de apertura al ' || to_char(p_fecha, 'DD/MM/YYYY') || ' (dólar a Bs ' || to_char(t, 'FM999G999G990D0000') || ')', 'APERTURA', 1, lineas, p_usuario_id);
    RETURN v_id;
END $$;
COMMENT ON FUNCTION fn_crear_apertura(date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, bigint) IS 'Asiento de apertura (una sola vez). Inventario del kardex a costo; efectivo y bancos en USD se convierten a la tasa de la fecha; el capital es la diferencia.';
