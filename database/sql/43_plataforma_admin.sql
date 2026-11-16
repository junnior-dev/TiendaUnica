-- =============================================================================
--  Archivo 43 · PLATAFORMA ADMIN: guardia de tablas globales SIN acoplar a «negocio 1»
--  (revisión de la auditoría 2026-11-16 · mejora A-4 del CHANGES.md)
--
--  Problema del 41: fn_puede_editar_global() decidía por el flag
--  estado_tenants.modulos.editar_global, cuyo portador era por CONVENCIÓN el
--  negocio 1. Acoplar la seguridad a un ID literal es frágil: si la tienda de
--  la plataforma cambia de ID, o si otro negocio se marca editar_global por
--  error, la guardia queda mal.
--
--  Diseño nuevo (tres canales EXCLUYENTES y todos auditables):
--    1 · Superusuario  → instalación y propagador (pg_dump/restore, ALTER ROLE).
--    2 · tienda.plataforma_admin(negocio_id) → el negocio que administra las
--        globales como TIENDA (la nueva fuente de verdad, sin ID hardcodeado).
--    3 · app.rol = 'platform_admin' → trabajos/comandos administrativos de la
--        PLATAFORMA que no son tenant (p. ej. un job nocturno que publica la
--        tasa del BCV). CRÍTICO: el GUC es escribible por CUALQUIER sesión
--        (set_config es libre en PostgreSQL), así que SOLO se acepta si el
--        session_user (el rol LOGIN con el que se abrió la conexión) está en
--        tienda.plataforma_roles. Los tenants conectan como saas_app; si
--        saas_app no está en plataforma_roles, un tenant que se auto-declare
--        platform_admin sigue sin poder nada (fail-closed, con prueba).
--
--  Idempotente: seguro de ejecutarlo varias veces (y sobre una base ya
--  endurecida con el 41).
-- =============================================================================

-- ── 1 · ¿Qué negocio administra las tablas globales? (antes: «negocio 1») ────
CREATE TABLE IF NOT EXISTS tienda.plataforma_admin (
    negocio_id  smallint PRIMARY KEY REFERENCES tienda.negocio(id) ON DELETE CASCADE,
    asignado_en timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE tienda.plataforma_admin IS
'Negocio(s) que administran las tablas GLOBALES (tasas, alícuotas, UT, monedas). Fuente de verdad de la guardia fn_puede_editar_global: sustituye al «negocio 1» por convención. Lo maneja el operador de la plataforma.';

-- Migración de datos: el negocio que el 41 marcó con editar_global=true pasa a
-- plataforma_admin (no hardcodeamos el 1: se conserva quien lo tuviera).
INSERT INTO tienda.plataforma_admin (negocio_id)
SELECT negocio_id FROM tienda.estado_tenants
 WHERE (modulos ->> 'editar_global')::boolean IS TRUE
   AND negocio_id IN (SELECT id FROM tienda.negocio)
ON CONFLICT (negocio_id) DO NOTHING;

-- ── 2 · Roles LOGIN autorizados a declarar app.rol = 'platform_admin' ────────
CREATE TABLE IF NOT EXISTS tienda.plataforma_roles (
    rol         name PRIMARY KEY,
    nota        text,
    asignado_en timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE tienda.plataforma_roles IS
'Roles LOGIN de conexión autorizados a usar app.rol=platform_admin (canales administrativos de la plataforma, p. ej. el job que publica la tasa). Los tenants usan saas_app, que NO debe estar aquí; la comparación es contra session_user, no contra current_user, para que no cambie dentro de un SECURITY DEFINER.';
INSERT INTO tienda.plataforma_roles (rol, nota) VALUES
    ('postgres', 'Instalación/mantenimiento local')
ON CONFLICT (rol) DO NOTHING;
-- Producción: INSERT INTO tienda.plataforma_roles VALUES ('<rol_admin>', 'Operador');

-- ── 3 · La guardia nueva (reemplaza la del 41) ───────────────────────────────
--  CORRECCIÓN CRÍTICA encontrada POR la prueba de regresión de A-4 (mejora 1):
--  1 · La guardia del 41 preguntaba rolsuper por CURRENT_USER, pero se evalúa
--      DENTRO de procedimientos SECURITY DEFINER, donde current_user = dueño
--      (postgres) → la guardia devolvía TRUE para TODO el mundo y cualquier
--      tenant podía registrar tasas/alícuotas/UT vía sp_registrar_tasa (los
--      REVOKE solo frenaban el SQL directo, no la puerta de los procedimientos,
--      que llevan GRANT EXECUTE a saas_app). Se comprueba SESSION_USER, que NO
--      cambia dentro de un SECURITY DEFINER: es el rol LOGIN que abrió la
--      conexión —postgres para el administrador, saas_app para los tenants—.
--  2 · FAIL-OPEN SOBRE NULL: `false OR NULL = NULL`, y `IF NOT fn(...) THEN`
--      con NULL NO eleva → una sesión SIN GUC de negocio y sin app.rol pasaba
--      la guardia. Todo el OR va dentro de un COALESCE(…, false): si algo no
--      está claro, la respuesta es NO.
--  3 · DEFAULT «negocio 1»: fn_negocio_actual() cae al negocio 1 cuando no hay
--      GUC (comodidad de tienda única en local). Si la cláusula tenant usara
--      fn_negocio_actual() a secas, una sesión SIN GUC se convertiría en
--      «negocio 1» y heredaría los derechos de la plataforma. La cláusula
--      exige el GUC EXPLÍCITO (sin GUC → -1 → nunca coincide) y queda
--      fail-closed; el aislamiento de DATOS ya era fail-closed vía
--      fn_sesion_permitida(), esto lo extiende a las EDICIONES GLOBALES.
CREATE OR REPLACE FUNCTION tienda.fn_puede_editar_global() RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = session_user), false)
        OR (current_setting('app.rol', true) = 'platform_admin'
            AND EXISTS (SELECT 1 FROM tienda.plataforma_roles WHERE rol = session_user))
        OR EXISTS (SELECT 1 FROM tienda.plataforma_admin
                    WHERE negocio_id = COALESCE(NULLIF(current_setting('app.negocio_id', true), '')::integer, -1)),
    false)
$$;
COMMENT ON FUNCTION tienda.fn_puede_editar_global() IS
'¿Puede la sesión escribir las tablas globales (tasas_cambio, parametros_fiscales, islr_ut, monedas)? Superusuario; o sesión cuyo session_user está en plataforma_roles y se declaró app.rol=platform_admin; o el negocio actual está en plataforma_admin. NOTA: app.rol se acepta SOLO desde roles de plataforma confiables, porque cualquier sesión puede fijar un GUC con set_config.';
GRANT SELECT ON tienda.plataforma_admin, tienda.plataforma_roles TO saas_app;
REVOKE INSERT, UPDATE, DELETE ON tienda.plataforma_admin, tienda.plataforma_roles FROM saas_app;

-- ── 4 · El flag viejo deja de mandar: queda solo como pantalla informativa ──
--  Se ELIMINA de la guardia deliberadamente: la fuente de verdad ahora es
--  plataforma_admin. El UPDATE de datos ya se hizo arriba.
COMMENT ON COLUMN tienda.estado_tenants.modulos IS
'Módulos del plan (repuestos, ropa, fiscal, editar_global…). editar_global quedó INFORMATIVO: la guardia real de las tablas globales es tienda.plataforma_admin + tienda.plataforma_roles (ver 43_plataforma_admin.sql).';
