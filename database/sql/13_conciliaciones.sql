-- =============================================================================
--  13_conciliaciones.sql — Cruce de cuentas: conciliación bancaria y conciliación fiscal (SENIAT)
--  Requiere 10_contabilidad.sql. Solo LEE asientos, asiento_detalle, ventas y compras: no las modifica.
--     psql -d tienda -f 13_conciliaciones.sql
--
--  1) CONCILIACIÓN BANCARIA. Compara el estado de cuenta del banco con la cuenta Bancos del libro mayor (1.1.02).
--     Partida doble y método clásico de dos lados:
--        Saldo según libros  ± ajustes del banco aún no registrados (comisiones, notas de crédito/débito del banco, intereses)
--                         =  Saldo libros ajustado
--        Saldo según banco   + depósitos en tránsito − pagos en tránsito (registrados en libros que el banco aún no refleja)
--                         =  Saldo banco ajustado           →  las dos cifras deben ser IGUALES para poder cerrar el acta.
--     Las partidas se unen con la tabla de cruces (una línea del banco puede agrupar varios asientos: lote de punto de venta).
--
--  2) CONCILIACIÓN FISCAL. El sistema no puede conectarse al portal del SENIAT, así que la persona anota aquí lo que declaró
--     (Forma 30 del IVA, retenciones de IVA enteradas, IGTF) y la pantalla lo compara con lo que calcula el sistema.
--
--  Las conciliaciones CERRADAS no se modifican (trigger). Nada de esto genera asientos: los ajustes del banco quedan listados
--  en el acta como «por registrar en libros» y se contabilizan con un asiento manual desde Contabilidad.
-- =============================================================================
SET search_path = tienda, public;

DO $$ BEGIN
    IF to_regclass('tienda.asientos') IS NULL THEN RAISE EXCEPTION 'Falta 10_contabilidad.sql: instálalo antes que este archivo.'; END IF;
END $$;

-- ---------------------------------------------------------------------------
--  1. CONCILIACIÓN BANCARIA
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conciliaciones_bancarias (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cuenta_id          bigint        NOT NULL REFERENCES plan_cuentas(id),      -- normalmente 1.1.02 Bancos
    banco              varchar(80)   NOT NULL CHECK (length(trim(banco)) > 0),
    cuenta_bancaria    varchar(30),                                             -- últimos dígitos o nombre de la cuenta, solo informativo
    desde              date          NOT NULL,
    hasta              date          NOT NULL,
    saldo_banco_final  numeric(18,2),                                           -- saldo final del estado de cuenta (NULL = aún no indicado)
    tolerancia_dias    smallint      NOT NULL DEFAULT 2 CHECK (tolerancia_dias BETWEEN 0 AND 7),
    folio_inicial      integer       NOT NULL DEFAULT 1 CHECK (folio_inicial >= 1),
    archivo            varchar(200),
    observaciones      text,
    estado             varchar(10)   NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR','CERRADA')),
    acta               jsonb,                                                   -- fotografía del acta al cerrar (lo que se firma no cambia)
    usuario_id         bigint        REFERENCES usuarios(id),
    created_at         timestamptz   NOT NULL DEFAULT now(),
    cerrada_at         timestamptz,
    CONSTRAINT ck_conc_periodo CHECK (hasta >= desde AND hasta - desde <= 366),
    CONSTRAINT ck_conc_cerrada CHECK ((estado = 'CERRADA') = (cerrada_at IS NOT NULL AND acta IS NOT NULL AND saldo_banco_final IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_conc_cuenta_hasta ON conciliaciones_bancarias (cuenta_id, hasta DESC);
COMMENT ON TABLE conciliaciones_bancarias IS 'Cabecera de cada conciliación bancaria (un estado de cuenta contra la cuenta Bancos del mayor). Cerrada = acta firmada, ya no cambia.';

CREATE TABLE IF NOT EXISTS conciliacion_banco_lineas (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conciliacion_id  bigint        NOT NULL REFERENCES conciliaciones_bancarias(id),
    fecha            date          NOT NULL,
    referencia       varchar(60),
    descripcion      varchar(250),
    monto            numeric(18,2) NOT NULL CHECK (monto <> 0),                 -- + abono (entra dinero) / − cargo (sale dinero), visto desde nuestra cuenta
    saldo_banco      numeric(18,2),                                             -- saldo que muestra el banco tras el movimiento, si el archivo lo trae
    huella           varchar(64)   NOT NULL,                                    -- evita duplicar la línea si se sube el mismo archivo dos veces
    clase            varchar(20)   CHECK (clase IN ('COMISION','NOTA_CREDITO_BANCO','NOTA_DEBITO_BANCO','INTERES','OTRO')),
    nota             varchar(250),
    UNIQUE (conciliacion_id, huella)
);
CREATE INDEX IF NOT EXISTS ix_conc_lineas_conc ON conciliacion_banco_lineas (conciliacion_id, fecha);
COMMENT ON COLUMN conciliacion_banco_lineas.clase IS 'Si el movimiento del banco NO tiene asiento (comisión, nota de crédito/débito del banco, interés), se clasifica aquí y el acta lo lista como ajuste por registrar en libros.';

CREATE TABLE IF NOT EXISTS conciliacion_cruces (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conciliacion_id   bigint       NOT NULL REFERENCES conciliaciones_bancarias(id),
    banco_linea_id    bigint       REFERENCES conciliacion_banco_lineas(id),    -- NULL solo con metodo = 'ANTERIOR'
    asiento_detalle_id bigint      NOT NULL UNIQUE REFERENCES asiento_detalle(id), -- una línea del libro se concilia una sola vez en toda la historia
    metodo            varchar(10)  NOT NULL CHECK (metodo IN ('AUTO','MANUAL','ANTERIOR')),
    usuario_id        bigint       REFERENCES usuarios(id),
    created_at        timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT ck_cruce_anterior CHECK ((metodo = 'ANTERIOR') = (banco_linea_id IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_conc_cruces_linea ON conciliacion_cruces (banco_linea_id);
COMMENT ON COLUMN conciliacion_cruces.metodo IS 'AUTO = monto exacto dentro de la tolerancia de días; MANUAL = lo emparejó una persona; ANTERIOR = el asiento ya estaba conciliado antes de usar el sistema (no tiene línea de banco aquí).';

-- Una conciliación cerrada es de solo lectura (cabecera, líneas del banco y cruces).
CREATE OR REPLACE FUNCTION trg_conc_cerrada() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_estado text;
BEGIN
    IF TG_TABLE_NAME = 'conciliaciones_bancarias' THEN
        IF TG_OP = 'DELETE' AND OLD.estado = 'CERRADA' THEN RAISE EXCEPTION 'Una conciliación cerrada no se puede borrar.'; END IF;
        IF TG_OP = 'UPDATE' AND OLD.estado = 'CERRADA' THEN RAISE EXCEPTION 'La conciliación ya está cerrada: no se puede modificar.'; END IF;
        RETURN COALESCE(NEW, OLD);
    END IF;
    v_id := COALESCE(NEW.conciliacion_id, OLD.conciliacion_id);
    SELECT estado INTO v_estado FROM conciliaciones_bancarias WHERE id = v_id;
    IF v_estado = 'CERRADA' THEN RAISE EXCEPTION 'La conciliación ya está cerrada: no se puede modificar.'; END IF;
    RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_conc_cab_cerrada ON conciliaciones_bancarias;
CREATE TRIGGER trg_conc_cab_cerrada BEFORE UPDATE OR DELETE ON conciliaciones_bancarias FOR EACH ROW EXECUTE FUNCTION trg_conc_cerrada();
DROP TRIGGER IF EXISTS trg_conc_lin_cerrada ON conciliacion_banco_lineas;
CREATE TRIGGER trg_conc_lin_cerrada BEFORE INSERT OR UPDATE OR DELETE ON conciliacion_banco_lineas FOR EACH ROW EXECUTE FUNCTION trg_conc_cerrada();
DROP TRIGGER IF EXISTS trg_conc_cru_cerrada ON conciliacion_cruces;
CREATE TRIGGER trg_conc_cru_cerrada BEFORE INSERT OR UPDATE OR DELETE ON conciliacion_cruces FOR EACH ROW EXECUTE FUNCTION trg_conc_cerrada();

-- 1.1 Líneas del LIBRO (cuenta de bancos) hasta el cierre de la conciliación: monto = debe − haber (+ entra / − sale).
--     cruzado_aqui / cruzado_otra: ya conciliada en esta o en otra conciliación. Las no cruzadas son las candidatas.
CREATE OR REPLACE FUNCTION fn_conciliacion_libro(p_id bigint)
RETURNS TABLE (detalle_id bigint, fecha date, numero_asiento bigint, concepto text, glosa text, monto numeric, cruzado_aqui boolean, cruzado_otra boolean)
LANGUAGE sql STABLE AS $$
    SELECT d.id, a.fecha, a.numero_asiento, a.concepto, d.glosa, d.debe - d.haber,
           COALESCE(k.conciliacion_id = p_id, false), COALESCE(k.conciliacion_id <> p_id, false)
      FROM conciliaciones_bancarias c
      JOIN asiento_detalle d ON d.cuenta_id = c.cuenta_id
      JOIN asientos a ON a.id = d.asiento_id AND a.fecha <= c.hasta
      LEFT JOIN conciliacion_cruces k ON k.asiento_detalle_id = d.id
     WHERE c.id = p_id
     ORDER BY a.fecha, a.numero_asiento, d.id
$$;

-- 1.2 Cifras del acta. Todo sale de las tablas: la pantalla y el PDF muestran exactamente esto.
CREATE OR REPLACE FUNCTION fn_conciliacion_resumen(p_id bigint)
RETURNS TABLE (saldo_libros numeric, ajustes_abonos numeric, ajustes_cargos numeric, saldo_libros_ajustado numeric,
               saldo_banco numeric, depositos_transito numeric, pagos_transito numeric, saldo_banco_ajustado numeric,
               diferencia numeric, lineas_banco int, lineas_pendientes int, monto_pendiente numeric, libro_sin_cruzar int)
LANGUAGE sql STABLE AS $$
    WITH c AS (SELECT * FROM conciliaciones_bancarias WHERE id = p_id),
    libro AS (SELECT COALESCE(sum(monto), 0) AS saldo,
                     COALESCE(sum(monto) FILTER (WHERE NOT cruzado_aqui AND NOT cruzado_otra AND monto > 0), 0) AS dep,
                     COALESCE(sum(monto) FILTER (WHERE NOT cruzado_aqui AND NOT cruzado_otra AND monto < 0), 0) AS pag,
                     count(*) FILTER (WHERE NOT cruzado_aqui AND NOT cruzado_otra)::int AS n_sin
                FROM fn_conciliacion_libro(p_id)),
    b AS (SELECT COALESCE(sum(l.monto) FILTER (WHERE l.clase IS NOT NULL AND l.monto > 0), 0) AS abonos,
                 COALESCE(sum(l.monto) FILTER (WHERE l.clase IS NOT NULL AND l.monto < 0), 0) AS cargos,
                 count(*)::int AS n,
                 count(*) FILTER (WHERE l.clase IS NULL AND NOT EXISTS (SELECT 1 FROM conciliacion_cruces k WHERE k.banco_linea_id = l.id))::int AS n_pend,
                 COALESCE(sum(l.monto) FILTER (WHERE l.clase IS NULL AND NOT EXISTS (SELECT 1 FROM conciliacion_cruces k WHERE k.banco_linea_id = l.id)), 0) AS m_pend
            FROM conciliacion_banco_lineas l WHERE l.conciliacion_id = p_id)
    SELECT libro.saldo, b.abonos, b.cargos, libro.saldo + b.abonos + b.cargos,
           c.saldo_banco_final, libro.dep, libro.pag, c.saldo_banco_final + libro.dep + libro.pag,
           (libro.saldo + b.abonos + b.cargos) - (c.saldo_banco_final + libro.dep + libro.pag),
           b.n, b.n_pend, b.m_pend, libro.n_sin
      FROM c, libro, b
$$;
COMMENT ON FUNCTION fn_conciliacion_resumen(bigint) IS 'Acta de conciliación: saldo libros ajustado vs. saldo banco ajustado. diferencia = 0 cuando cuadra; con líneas del banco sin clasificar ni cruzar (lineas_pendientes) nunca cuadra.';

-- 1.3 Cruzar una línea del banco con uno o varios asientos del libro. La suma debe ser IGUAL al monto del banco.
CREATE OR REPLACE FUNCTION fn_cruzar_banco(p_conciliacion bigint, p_linea bigint, p_detalles bigint[], p_metodo text, p_usuario bigint DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_linea conciliacion_banco_lineas; v_suma numeric; v_ok int;
BEGIN
    IF p_metodo NOT IN ('AUTO','MANUAL') THEN RAISE EXCEPTION 'Método de cruce no válido.'; END IF;
    SELECT * INTO v_linea FROM conciliacion_banco_lineas WHERE id = p_linea AND conciliacion_id = p_conciliacion FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa línea del banco no pertenece a esta conciliación.'; END IF;
    IF v_linea.clase IS NOT NULL THEN RAISE EXCEPTION 'Esa línea está clasificada como ajuste: quítale la clasificación antes de cruzarla.'; END IF;
    IF p_detalles IS NULL OR cardinality(p_detalles) = 0 THEN RAISE EXCEPTION 'Elige al menos un asiento del libro.'; END IF;
    SELECT count(*), COALESCE(sum(monto), 0) INTO v_ok, v_suma FROM fn_conciliacion_libro(p_conciliacion) WHERE detalle_id = ANY (p_detalles) AND NOT cruzado_aqui AND NOT cruzado_otra;
    IF v_ok <> cardinality(p_detalles) THEN RAISE EXCEPTION 'Alguno de los asientos elegidos ya está conciliado o no es de esta cuenta.'; END IF;
    IF v_suma <> v_linea.monto THEN RAISE EXCEPTION 'Los asientos suman % y el banco muestra %: no se pueden emparejar. Clasifica la diferencia como comisión o ajuste.', v_suma, v_linea.monto; END IF;
    INSERT INTO conciliacion_cruces (conciliacion_id, banco_linea_id, asiento_detalle_id, metodo, usuario_id)
    SELECT p_conciliacion, p_linea, x, p_metodo, p_usuario FROM unnest(p_detalles) x;
END $$;

-- 1.3b Marcar asientos como «conciliados antes de usar el sistema» (no tienen línea de banco en esta conciliación).
--      Sirve para depurar el arrastre del primer mes: asientos viejos que el banco ya reflejó en períodos anteriores.
CREATE OR REPLACE FUNCTION fn_marcar_conciliado_anterior(p_conciliacion bigint, p_detalles bigint[], p_usuario bigint DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok int;
BEGIN
    IF p_detalles IS NULL OR cardinality(p_detalles) = 0 THEN RAISE EXCEPTION 'Elige al menos un asiento del libro.'; END IF;
    SELECT count(*) INTO v_ok FROM fn_conciliacion_libro(p_conciliacion) WHERE detalle_id = ANY (p_detalles) AND NOT cruzado_aqui AND NOT cruzado_otra;
    IF v_ok <> cardinality(p_detalles) THEN RAISE EXCEPTION 'Alguno de los asientos elegidos ya está conciliado o no es de esta cuenta.'; END IF;
    INSERT INTO conciliacion_cruces (conciliacion_id, banco_linea_id, asiento_detalle_id, metodo, usuario_id)
    SELECT p_conciliacion, NULL, x, 'ANTERIOR', p_usuario FROM unnest(p_detalles) x;
END $$;

-- 1.4 Cierre del acta: solo si cuadra (diferencia 0), no quedan líneas del banco sin resolver y se indicó el saldo del banco.
CREATE OR REPLACE FUNCTION fn_cerrar_conciliacion(p_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c conciliaciones_bancarias; r record; v_acta jsonb;
BEGIN
    SELECT * INTO c FROM conciliaciones_bancarias WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La conciliación no existe.'; END IF;
    IF c.estado = 'CERRADA' THEN RAISE EXCEPTION 'La conciliación ya está cerrada.'; END IF;
    IF c.saldo_banco_final IS NULL THEN RAISE EXCEPTION 'Indica el saldo final del estado de cuenta antes de cerrar.'; END IF;
    SELECT * INTO r FROM fn_conciliacion_resumen(p_id);
    IF r.lineas_pendientes > 0 THEN RAISE EXCEPTION 'Quedan % movimientos del banco sin cruzar ni clasificar.', r.lineas_pendientes; END IF;
    IF r.diferencia <> 0 THEN RAISE EXCEPTION 'La conciliación no cuadra: diferencia de %.', r.diferencia; END IF;
    v_acta := jsonb_build_object('resumen', to_jsonb(r),
        'ajustes', (SELECT COALESCE(jsonb_agg(to_jsonb(l) - 'huella' ORDER BY l.fecha, l.id), '[]') FROM conciliacion_banco_lineas l WHERE l.conciliacion_id = p_id AND l.clase IS NOT NULL),
        'transito', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.fecha, t.numero_asiento), '[]') FROM fn_conciliacion_libro(p_id) t WHERE NOT t.cruzado_aqui AND NOT t.cruzado_otra));
    UPDATE conciliaciones_bancarias SET estado = 'CERRADA', cerrada_at = now(), acta = v_acta WHERE id = p_id;
END $$;

-- ---------------------------------------------------------------------------
--  2. CONCILIACIÓN FISCAL: lo que la persona declaró en el portal del SENIAT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS declaraciones_seniat (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo                varchar(20)  NOT NULL CHECK (tipo IN ('FORMA_30','RETENCIONES_IVA','IGTF')),
    periodicidad        varchar(10)  NOT NULL CHECK (periodicidad IN ('QUINCENAL','MENSUAL')),
    desde               date         NOT NULL,
    hasta               date         NOT NULL,
    numero_planilla     varchar(40),                                            -- número de la planilla o del comprobante de pago
    fecha_presentacion  date,
    observaciones       text,
    usuario_id          bigint       REFERENCES usuarios(id),
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_decl_periodo UNIQUE (tipo, desde, hasta),                     -- una declaración vigente por tipo y período (corregirla la reemplaza)
    CONSTRAINT ck_decl_periodo CHECK (hasta >= desde AND hasta - desde <= 31)
);
COMMENT ON TABLE declaraciones_seniat IS 'Lo que se declaró efectivamente en el portal del SENIAT. El sistema no se conecta al portal: estos montos los escribe una persona.';

CREATE TABLE IF NOT EXISTS declaraciones_seniat_montos (
    declaracion_id  bigint        NOT NULL REFERENCES declaraciones_seniat(id) ON DELETE CASCADE,
    concepto        varchar(30)   NOT NULL,
    monto           numeric(18,2) NOT NULL,
    PRIMARY KEY (declaracion_id, concepto)
);
COMMENT ON COLUMN declaraciones_seniat_montos.concepto IS 'FORMA_30: BASE_VENTAS_GRAVADAS, VENTAS_NO_GRAVADAS, DEBITO_FISCAL, BASE_COMPRAS, CREDITO_FISCAL, RETENCIONES_SOPORTADAS, IVA_A_PAGAR, EXCEDENTE_CREDITO · RETENCIONES_IVA: RETENCION_ENTERADA · IGTF: BASE_DIVISAS_USD, IGTF_BS.';
