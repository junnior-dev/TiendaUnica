-- =============================================================================
--  22 · Calendario fiscal parametrizable (cargar y editar fechas por año, régimen y obligación)
-- =============================================================================
--  Requiere: 21. Es idempotente:  psql -d tienda -v ON_ERROR_STOP=1 -f 22_calendario_parametrizable.sql
--
--  Qué cambia respecto al 21:
--   · Las obligaciones salen de un catálogo (calendario_obligaciones) en vez de una lista fija: se pueden agregar más.
--   · Cada fila lleva el régimen al que aplica (ESPECIAL u ORDINARIO) y la fuente de la fecha. Así, cuando el SENIAT publique el
--     calendario de otro año (o tu contador te dé las fechas de un ordinario), se cargan desde la pantalla, sin SQL.
--   · Se agregan dos obligaciones de ISLR para sujetos pasivos especiales 2026 (entero de retenciones y autoliquidación anual).
--     Datos tomados de un resumen del calendario publicado por PwC Venezuela (Providencia SNAT/2025/000091): VERIFÍCALOS contra
--     la Gaceta Oficial 43.283. En la autoliquidación anual, el resumen consultado indicaba «ejercicio 2024»; aquí se guardó el
--     ejercicio 2025 (el que se declara en esas fechas), así que confírmalo con tu contador.
--   · El Panel muestra también los vencimientos de contribuyentes ordinarios cuando existan filas con ese régimen.
--  El calendario NO descuenta feriados ni días no hábiles.
-- =============================================================================
SET search_path = tienda, public;

-- ── Catálogo de obligaciones ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendario_obligaciones (
    codigo   varchar(20)  PRIMARY KEY CHECK (codigo ~ '^[A-Z0-9_]{2,20}$'),
    titulo   varchar(100) NOT NULL CHECK (length(trim(titulo)) >= 3),
    periodo  varchar(10)  NOT NULL CHECK (periodo IN ('QUINCENA','MES','ANIO','OTRO')),
    activa   boolean      NOT NULL DEFAULT true,
    orden    smallint     NOT NULL DEFAULT 100
);
COMMENT ON TABLE calendario_obligaciones IS 'Obligaciones que aparecen en el calendario fiscal. «periodo» solo decide cómo se escribe el período en pantalla.';

INSERT INTO calendario_obligaciones (codigo, titulo, periodo, orden) VALUES
    ('IVA',           'IVA, anticipo de ISLR, IGTF y retenciones de IVA', 'QUINCENA', 1),
    ('ISLR_ESTIMADA', 'Declaración estimada de ISLR',                     'MES',      2),
    ('ISLR_ENTERO',   'Entero de retenciones de ISLR',                    'MES',      3),
    ('ISLR_ANUAL',    'Autoliquidación anual de ISLR',                    'ANIO',     4)
ON CONFLICT (codigo) DO NOTHING;

-- ── Tabla de fechas: régimen, fuente y obligación libre ──────────────────────
DO $$
DECLARE c record;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint
              WHERE conrelid = 'calendario_fiscal'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%obligacion%'
    LOOP EXECUTE format('ALTER TABLE calendario_fiscal DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;

ALTER TABLE calendario_fiscal ADD COLUMN IF NOT EXISTS regimen varchar(10)  NOT NULL DEFAULT 'ESPECIAL' CHECK (regimen IN ('ESPECIAL','ORDINARIO'));
ALTER TABLE calendario_fiscal ADD COLUMN IF NOT EXISTS fuente  varchar(120);
ALTER TABLE calendario_fiscal ADD COLUMN IF NOT EXISTS actualizado_por bigint REFERENCES usuarios(id);
ALTER TABLE calendario_fiscal ADD COLUMN IF NOT EXISTS actualizado_en timestamptz;
UPDATE calendario_fiscal SET fuente = 'Providencia SNAT/2025/000091' WHERE fuente IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'calendario_fiscal'::regclass AND contype = 'f' AND conname = 'fk_calendario_obligacion') THEN
        ALTER TABLE calendario_fiscal ADD CONSTRAINT fk_calendario_obligacion FOREIGN KEY (obligacion) REFERENCES calendario_obligaciones(codigo);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'calendario_fiscal'::regclass AND contype = 'p' AND pg_get_constraintdef(oid) ILIKE '%regimen%') THEN
        ALTER TABLE calendario_fiscal DROP CONSTRAINT IF EXISTS calendario_fiscal_pkey;
        ALTER TABLE calendario_fiscal ADD CONSTRAINT calendario_fiscal_pkey PRIMARY KEY (regimen, obligacion, digito, periodo_desde);
    END IF;
END $$;

-- ── Datos 2026 de ISLR para sujetos pasivos especiales ───────────────────────
-- Orden de las columnas: dígitos {0,8} · {1,4} · {2,3} · {5,9} · {6,7}. Una fila por mes con el día de vencimiento de cada grupo.
INSERT INTO calendario_fiscal (regimen, obligacion, digito, periodo_desde, periodo_hasta, fecha_limite, fuente)
SELECT 'ESPECIAL', 'ISLR_ENTERO', d, make_date(2026, m.mes, 1), (make_date(2026, m.mes, 1) + interval '1 month - 1 day')::date,
       make_date(2026, m.mes, (string_to_array(m.dias, ','))[g.n]::int), 'PwC Venezuela (resumen de la Providencia SNAT/2025/000091): verificar'
  FROM (VALUES (1,'15,09,08,14,13'),(2,'09,10,05,06,11'),(3,'06,11,09,05,10'),(4,'10,07,08,09,06'),(5,'12,13,07,08,11'),(6,'05,11,10,09,04'),
               (7,'08,10,07,06,09'),(8,'07,06,12,11,10'),(9,'08,09,10,07,04'),(10,'09,06,07,08,13'),(11,'06,05,09,10,11'),(12,'09,07,04,10,08')) AS m(mes, dias)
  CROSS JOIN (VALUES (1,ARRAY[0,8]),(2,ARRAY[1,4]),(3,ARRAY[2,3]),(4,ARRAY[5,9]),(5,ARRAY[6,7])) AS g(n, digs)
  CROSS JOIN LATERAL unnest(g.digs) AS d
ON CONFLICT (regimen, obligacion, digito, periodo_desde) DO NOTHING;

INSERT INTO calendario_fiscal (regimen, obligacion, digito, periodo_desde, periodo_hasta, fecha_limite, fuente)
SELECT 'ESPECIAL', 'ISLR_ANUAL', d, DATE '2025-01-01', DATE '2025-12-31', a.fecha::date, 'PwC Venezuela (resumen de la Providencia SNAT/2025/000091): verificar el ejercicio'
  FROM (VALUES (ARRAY[2,3],'2026-01-30'),(ARRAY[5,9],'2026-02-27'),(ARRAY[0,8],'2026-03-06'),(ARRAY[1,4],'2026-03-11'),(ARRAY[6,7],'2026-03-16')) AS a(digs, fecha)
  CROSS JOIN LATERAL unnest(a.digs) AS d
ON CONFLICT (regimen, obligacion, digito, periodo_desde) DO NOTHING;

-- ── Escritura (todas las reglas viven aquí) ──────────────────────────────────
CREATE OR REPLACE FUNCTION fn_calendario_guardar(p_regimen text, p_obligacion text, p_digito int, p_desde date, p_hasta date, p_limite date, p_fuente text, p_usuario_id bigint)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_regimen NOT IN ('ESPECIAL','ORDINARIO') THEN RAISE EXCEPTION 'El régimen debe ser especial u ordinario' USING ERRCODE = 'TV006'; END IF;
    IF NOT EXISTS (SELECT 1 FROM calendario_obligaciones WHERE codigo = p_obligacion AND activa) THEN
        RAISE EXCEPTION 'La obligación «%» no existe en el catálogo', p_obligacion USING ERRCODE = 'TV006'; END IF;
    IF p_digito IS NULL OR p_digito NOT BETWEEN 0 AND 9 THEN RAISE EXCEPTION 'El último dígito del RIF debe ir de 0 a 9' USING ERRCODE = 'TV006'; END IF;
    IF p_desde IS NULL OR p_hasta IS NULL OR p_limite IS NULL THEN RAISE EXCEPTION 'Faltan fechas: período desde, hasta y fecha límite' USING ERRCODE = 'TV006'; END IF;
    IF p_hasta < p_desde THEN RAISE EXCEPTION 'El período termina antes de empezar (%  a  %)', p_desde, p_hasta USING ERRCODE = 'TV006'; END IF;
    IF p_limite < p_desde THEN RAISE EXCEPTION 'La fecha límite (%) es anterior al inicio del período', p_limite USING ERRCODE = 'TV006'; END IF;
    IF p_limite < DATE '2020-01-01' OR p_limite > DATE '2100-12-31' THEN RAISE EXCEPTION 'La fecha límite % no parece correcta', p_limite USING ERRCODE = 'TV006'; END IF;
    INSERT INTO calendario_fiscal (negocio_id, regimen, obligacion, digito, periodo_desde, periodo_hasta, fecha_limite, fuente, actualizado_por, actualizado_en)
    VALUES (fn_negocio_actual(), p_regimen, p_obligacion, p_digito, p_desde, p_hasta, p_limite, NULLIF(trim(p_fuente), ''), p_usuario_id, now())
    ON CONFLICT (negocio_id, regimen, obligacion, digito, periodo_desde) DO UPDATE
       SET periodo_hasta = EXCLUDED.periodo_hasta, fecha_limite = EXCLUDED.fecha_limite, fuente = EXCLUDED.fuente,
           actualizado_por = EXCLUDED.actualizado_por, actualizado_en = EXCLUDED.actualizado_en;
END $$;

-- Carga masiva: o entra todo o no entra nada. p_filas = [{regimen, obligacion, digito, desde, hasta, limite, fuente}, ...]
CREATE OR REPLACE FUNCTION fn_calendario_cargar(p_filas jsonb, p_usuario_id bigint) RETURNS int LANGUAGE plpgsql AS $$
DECLARE f record; n int := 0;
BEGIN
    IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 THEN
        RAISE EXCEPTION 'No hay filas para cargar' USING ERRCODE = 'TV006'; END IF;
    IF jsonb_array_length(p_filas) > 2000 THEN RAISE EXCEPTION 'Son demasiadas filas de una vez (máximo 2.000)' USING ERRCODE = 'TV006'; END IF;
    FOR f IN SELECT e AS fila, i FROM jsonb_array_elements(p_filas) WITH ORDINALITY AS t(e, i) LOOP
        BEGIN
            PERFORM fn_calendario_guardar(COALESCE(f.fila->>'regimen', 'ESPECIAL'), f.fila->>'obligacion', (f.fila->>'digito')::int,
                                          (f.fila->>'desde')::date, (f.fila->>'hasta')::date, (f.fila->>'limite')::date, f.fila->>'fuente', p_usuario_id);
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Fila %: %', f.i, SQLERRM USING ERRCODE = 'TV006';
        END;
        n := n + 1;
    END LOOP;
    RETURN n;
END $$;

CREATE OR REPLACE FUNCTION fn_calendario_eliminar(p_regimen text, p_obligacion text, p_digito int, p_desde date) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM calendario_fiscal WHERE regimen = p_regimen AND obligacion = p_obligacion AND digito = p_digito AND periodo_desde = p_desde;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa fecha ya no existe' USING ERRCODE = 'TV006'; END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_calendario_obligacion_guardar(p_codigo text, p_titulo text, p_periodo text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    p_codigo := upper(trim(p_codigo));
    IF p_codigo !~ '^[A-Z0-9_]{2,20}$' THEN RAISE EXCEPTION 'El código solo lleva letras, números y guion bajo (2 a 20 caracteres)' USING ERRCODE = 'TV006'; END IF;
    IF length(trim(COALESCE(p_titulo, ''))) < 3 THEN RAISE EXCEPTION 'Escribe el nombre de la obligación' USING ERRCODE = 'TV006'; END IF;
    IF p_periodo NOT IN ('QUINCENA','MES','ANIO','OTRO') THEN RAISE EXCEPTION 'Período no válido' USING ERRCODE = 'TV006'; END IF;
    INSERT INTO calendario_obligaciones (codigo, titulo, periodo, orden)
    VALUES (p_codigo, trim(p_titulo), p_periodo, COALESCE((SELECT max(orden) + 1 FROM calendario_obligaciones), 1))
    ON CONFLICT (codigo) DO UPDATE SET titulo = EXCLUDED.titulo, periodo = EXCLUDED.periodo, activa = true;
END $$;

-- ── Lectura para el negocio (su régimen y su dígito) ─────────────────────────
CREATE OR REPLACE FUNCTION fn_regimen_calendario() RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN es_contribuyente_especial THEN 'ESPECIAL' ELSE 'ORDINARIO' END FROM negocio LIMIT 1
$$;

DROP FUNCTION IF EXISTS fn_proximos_vencimientos(date, int);
CREATE FUNCTION fn_proximos_vencimientos(p_hoy date DEFAULT NULL, p_limite int DEFAULT 6)
RETURNS TABLE (obligacion text, titulo text, tipo_periodo text, periodo_desde date, periodo_hasta date, fecha_limite date, dias int, presentada boolean, presentada_en date)
LANGUAGE sql STABLE AS $$
    SELECT c.obligacion::text, o.titulo::text, o.periodo::text, c.periodo_desde, c.periodo_hasta, c.fecha_limite,
           (c.fecha_limite - COALESCE(p_hoy, fn_hoy()))::int, (p.obligacion IS NOT NULL), p.presentada_en
      FROM calendario_fiscal c
      JOIN calendario_obligaciones o ON o.codigo = c.obligacion AND o.activa
      LEFT JOIN calendario_presentada p ON p.obligacion = c.obligacion AND p.periodo_desde = c.periodo_desde
     WHERE c.digito = fn_digito_rif_negocio()
       AND c.regimen = fn_regimen_calendario()
       AND c.fecha_limite >= COALESCE(p_hoy, fn_hoy()) - 45
     ORDER BY c.fecha_limite, o.orden
     LIMIT GREATEST(p_limite, 1)
$$;

-- Todo el año del negocio (para la vista del calendario). El año es el de la fecha límite.
CREATE OR REPLACE FUNCTION fn_calendario_negocio(p_anio int)
RETURNS TABLE (obligacion text, titulo text, tipo_periodo text, periodo_desde date, periodo_hasta date, fecha_limite date, dias int, presentada boolean, presentada_en date, referencia text, fuente text)
LANGUAGE sql STABLE AS $$
    SELECT c.obligacion::text, o.titulo::text, o.periodo::text, c.periodo_desde, c.periodo_hasta, c.fecha_limite,
           (c.fecha_limite - fn_hoy())::int, (p.obligacion IS NOT NULL), p.presentada_en, p.referencia::text, c.fuente::text
      FROM calendario_fiscal c
      JOIN calendario_obligaciones o ON o.codigo = c.obligacion AND o.activa
      LEFT JOIN calendario_presentada p ON p.obligacion = c.obligacion AND p.periodo_desde = c.periodo_desde
     WHERE c.digito = fn_digito_rif_negocio() AND c.regimen = fn_regimen_calendario()
       AND extract(year FROM c.fecha_limite)::int = p_anio
     ORDER BY c.fecha_limite, o.orden
$$;

CREATE OR REPLACE FUNCTION fn_marcar_presentada(p_obligacion text, p_periodo_desde date, p_fecha date, p_referencia text, p_usuario_id bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM calendario_fiscal WHERE obligacion = p_obligacion AND periodo_desde = p_periodo_desde
                      AND digito = fn_digito_rif_negocio() AND regimen = fn_regimen_calendario()) THEN
        RAISE EXCEPTION 'Ese vencimiento no está en tu calendario' USING ERRCODE = 'TV006'; END IF;
    IF p_fecha IS NULL OR p_fecha > fn_hoy() THEN RAISE EXCEPTION 'La fecha de presentación no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    INSERT INTO calendario_presentada (negocio_id, obligacion, periodo_desde, presentada_en, referencia, usuario_id)
    VALUES (fn_negocio_actual(), p_obligacion, p_periodo_desde, p_fecha, NULLIF(trim(p_referencia), ''), p_usuario_id)
    ON CONFLICT (negocio_id, obligacion, periodo_desde) DO UPDATE SET presentada_en = EXCLUDED.presentada_en, referencia = EXCLUDED.referencia, usuario_id = EXCLUDED.usuario_id;
END $$;
