-- =============================================================================
--  30 · Calendario fiscal ORDINARIO (mensual, no quincenal) para 2026 y 2027
-- =============================================================================
--  Requiere: 22. Es idempotente:  psql -d tienda -v ON_ERROR_STOP=1 -f 30_calendario_ordinario.sql
--
--  Por qué existe: el sistema se sembró con el calendario de SUJETOS PASIVOS
--  ESPECIALES (quincenal). Si el negocio es contribuyente ORDINARIO
--  (es_contribuyente_especial = false), fn_proximos_vencimientos quedaba vacío
--  y el contador no veía ninguna fecha. Este script siembra el régimen
--  ORDINARIO con el esquema MENSUAL estándar:
--   · IVA (y anticipo de ISLR, IGTF, retenciones de IVA): se declara el mes
--     SIGUIENTE al período, según el último dígito del RIF:
--     dígito 0 → día 10, 1 → 11, 2 → 12 … 9 → día 19.
--   · Entero de retenciones de ISLR: hasta el día 10 del mes siguiente
--     (Decreto 1.808, retenciones practicadas en el mes).
--   · Autoliquidación anual de ISLR: por dígito del RIF entre el 30/01 y el
--     31/03 del año siguiente al ejercicio declarado.
--   · La declaración ESTIMADA de ISLR NO se siembra para ordinarios: solo
--     aplica a sujetos pasivos especiales.
--
--  Fuente: resumen del calendario publicado por PwC Venezuela (Providencia
--  SNAT/2025/000091, calendario 2026; se extendió el mismo esquema mensual a
--  2027 hasta que el SENIAT publique su calendario). VERIFÍCALOS contra la
--  Gaceta Oficial 43.283 y actualízalos con la pantalla (fn_calendario_cargar)
--  cuando salga una Providencia nueva. El calendario NO descuenta feriados.
-- =============================================================================

SET search_path = tienda, public;

-- ── IVA ordinario mensual: 12 meses × 10 dígitos, para 2026 y 2027 ──────────
INSERT INTO calendario_fiscal (regimen, obligacion, digito, periodo_desde, periodo_hasta, fecha_limite, fuente)
SELECT 'ORDINARIO', 'IVA', d.digito, m.desde, m.hasta,
       (m.hasta + (10 + d.digito))::date,
       'Providencia SNAT/2025/000091 (esquema mensual ordinario; verificar en Gaceta 43.283)'
FROM generate_series(0, 9) AS d(digito)
CROSS JOIN (
    SELECT generate_series(
               make_date(2026, 1, 1),
               make_date(2027, 12, 1),
               interval '1 month')::date AS desde,
           (generate_series(
               make_date(2026, 1, 1),
               make_date(2027, 12, 1),
               interval '1 month') + interval '1 month - 1 day')::date AS hasta
) AS m
ON CONFLICT (regimen, obligacion, digito, periodo_desde) DO NOTHING;

-- ── Entero de retenciones de ISLR (mensual): día 10 del mes siguiente ───────
INSERT INTO calendario_fiscal (regimen, obligacion, digito, periodo_desde, periodo_hasta, fecha_limite, fuente)
SELECT 'ORDINARIO', 'ISLR_ENTERO', d.digito, m.desde, m.hasta,
       (m.hasta + interval '10 day')::date,
       'Decreto 1.808 · entero mensual de retenciones (verificar fecha en la Providencia vigente)'
FROM generate_series(0, 9) AS d(digito)
CROSS JOIN (
    SELECT generate_series(
               make_date(2026, 1, 1),
               make_date(2027, 12, 1),
               interval '1 month')::date AS desde,
           (generate_series(
               make_date(2026, 1, 1),
               make_date(2027, 12, 1),
               interval '1 month') + interval '1 month - 1 day')::date AS hasta
) AS m
ON CONFLICT (regimen, obligacion, digito, periodo_desde) DO NOTHING;

-- ── Autoliquidación anual de ISLR: por dígito del RIF, 30/01 → 31/03 ────────
INSERT INTO calendario_fiscal (regimen, obligacion, digito, periodo_desde, periodo_hasta, fecha_limite, fuente)
SELECT 'ORDINARIO', 'ISLR_ANUAL', d.digito, y.desde, y.hasta,
       CASE d.digito
           WHEN 0 THEN (y.desde + interval '29 day')::date
           WHEN 1 THEN (y.desde + interval '36 day')::date
           WHEN 2 THEN (y.desde + interval '43 day')::date
           WHEN 3 THEN (y.desde + interval '50 day')::date
           WHEN 4 THEN (y.desde + interval '57 day')::date
           WHEN 5 THEN (y.desde + interval '64 day')::date
           WHEN 6 THEN (y.desde + interval '71 day')::date
           WHEN 7 THEN (y.desde + interval '78 day')::date
           WHEN 8 THEN (y.desde + interval '85 day')::date
           ELSE        (y.desde + interval '89 day')::date   -- dígito 9: 31/03
       END,
       'Providencia SNAT/2025/000091 · autoliquidación anual ordinaria (verificar en Gaceta 43.283)'
FROM generate_series(0, 9) AS d(digito)
CROSS JOIN (
    SELECT make_date(2025, 1, 1) AS desde, make_date(2025, 12, 31) AS hasta
    UNION ALL
    SELECT make_date(2026, 1, 1), make_date(2026, 12, 31)
) AS y
-- el ejercicio 2025 se declara en 2026 y el 2026 en 2027: el límite cae al año siguiente
ON CONFLICT (regimen, obligacion, digito, periodo_desde) DO NOTHING;

-- El límite anual debe caer en el año SIGUIENTE al ejercicio declarado:
UPDATE calendario_fiscal
SET fecha_limite = (make_date((EXTRACT(year FROM periodo_hasta)::int) + 1, EXTRACT(month FROM fecha_limite)::int,
                              EXTRACT(day FROM fecha_limite)::int))
WHERE regimen = 'ORDINARIO' AND obligacion = 'ISLR_ANUAL'
  AND EXTRACT(year FROM fecha_limite) = EXTRACT(year FROM periodo_hasta);

-- ── Verificación rápida ──────────────────────────────────────────────────────
-- Un contribuyente ORDINARIO ya debe ver fechas:
--   SELECT * FROM tienda.fn_proximos_vencimientos();  -- con es_contribuyente_especial = false
--   SELECT count(*) FROM tienda.calendario_fiscal WHERE regimen = 'ORDINARIO';  -- 260 filas (240 IVA + 20 anual) + 120 entero
