-- =============================================================================
--  Archivo 42 · ROL DE MÍNIMOS PRIVILEGIOS PARA LA BASE DEL PORTAL
--  (auditoría del 2026-11-15 · se ejecuta en la base portal_saas, NO en tienda)
--
--  La app (Portal, PortalConsultas, SuscripcionController, PortalAdminController)
--  conectaba con el superusuario (PORTAL_DB_USERNAME=postgres). Aquí se crea el
--  rol portal_app: SOLO LECTURA de las tablas comerciales, y las escrituras
--  únicamente a través de las funciones portal.fn_* que la app ya usa, dejadas
--  en SECURITY DEFINER (dueño: el superusuario que instaló el esquema).
--
--  Uso en producción (.env): PORTAL_DB_USERNAME=portal_app + ALTER ROLE
--  portal_app LOGIN PASSWORD '<secreto>'. Local/demo puede seguir con postgres.
--  Idempotente: seguro de ejecutarlo varias veces.
-- =============================================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
        CREATE ROLE portal_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END $$;
COMMENT ON ROLE portal_app IS 'Rol de conexión de la app Laravel a portal_saas: lectura directa + escritura solo vía portal.fn_* (SECURITY DEFINER).';

GRANT USAGE ON SCHEMA portal TO portal_app;
GRANT SELECT ON ALL TABLES IN SCHEMA portal TO portal_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA portal GRANT SELECT ON TABLES TO portal_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA portal TO portal_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA portal TO portal_app;

-- Las funciones que ESCRIBEN quedan en SECURITY DEFINER (la app no puede
-- INSERT/UPDATE/DELETE directo: solo llamarlas). Comportamiento intacto para
-- el superusuario (instalación y pruebas).
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS fn
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'portal'
                AND p.proname IN ('fn_alta_tenant', 'fn_cambiar_plan', 'fn_reportar_pago',
                                  'fn_verificar_pago', 'fn_publicar_tasa', 'fn_suspender',
                                  'fn_reactivar', 'fn_verificar_vencimientos', 'fn_suspender_morosos',
                                  'fn_registrar_cobro')
    LOOP
        EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER SET search_path = portal, public', f.fn);
    END LOOP;
END $$;

REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA portal FROM portal_app;
