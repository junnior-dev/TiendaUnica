--  Archivo 35 · PROVISIÓN SELF-SERVICE — crea el negocio de un cliente nuevo
--
--  Se ejecuta en la BASE DE LA TIENDA (multitenant), como superusuario.
--
--  Es la versión SaaS del asistente de primer inicio: cada cliente que se
--  registra en /crear-cuenta obtiene SU negocio con catálogos heredados de la
--  semilla (negocio 1), su usuario administrador y su fila en estado_tenants,
--  sin tocar a los demás negocios.
--
--   fn_provisionar_negocio(razon_social, rif, subdominio, admin_nombre,
--                          admin_password_hash, admin_username,
--                          plan, telefono, correo, direccion, nombre_comercial)
--     → negocio_id nuevo (con estado_tenants listo para el middleware).
--
--  El registro comercial (portal.negocios_portal, PRUEBA 15 días) lo da
--  portal.fn_alta_tenant en la base del portal: la app llama a las dos bases
--  en una misma transacción lógica (conexión 'portal' + conexión 'mysql'…).

CREATE OR REPLACE FUNCTION fn_provisionar_negocio(p_razon_social text, p_rif text,
        p_subdominio text, p_admin_nombre text, p_admin_password_hash text,
        p_admin_username text DEFAULT NULL, p_plan text DEFAULT 'DEMO',
        p_telefono text DEFAULT NULL, p_correo text DEFAULT NULL,
        p_direccion text DEFAULT NULL, p_nombre_comercial text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SET search_path = tienda, public AS $$
DECLARE
    pkg jsonb;
    n_new integer;
    v_admin integer;
    v_plan  text := upper(COALESCE(p_plan, 'DEMO'));
    v_modulos jsonb;
    v_slug  text;
    _clave  text;
BEGIN
    IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
        RAISE EXCEPTION 'La provisión es una operación del portal (superusuario)' USING ERRCODE = 'TV006';
    END IF;
    IF v_plan NOT IN ('SISTEMA', 'ESPECIAL', 'DEMO') THEN
        RAISE EXCEPTION 'El plan «%» no existe: usa SISTEMA, ESPECIAL o DEMO', p_plan;
    END IF;
    IF trim(COALESCE(p_razon_social, '')) = '' OR trim(COALESCE(p_rif, '')) = '' THEN
        RAISE EXCEPTION 'La razón social y el RIF son obligatorios';
    END IF;
    IF trim(COALESCE(p_admin_password_hash, '')) = '' THEN
        RAISE EXCEPTION 'Falta la contraseña del administrador (hash bcrypt)';
    END IF;

    -- Subdominio único y normalizado (la-cava-2, …) según fn_subdominio_unico.
    v_slug := tienda.fn_subdominio_unico(p_subdominio, NULL::integer);

    -- Catálogos heredados de la semilla: exportamos el negocio 1 y lo re-creamos
    -- como un negocio nuevo. Quitamos los usuarios (los usernames son únicos en
    -- toda la plataforma: el admin lo creamos aparte, con su propio username).
    pkg := tienda.fn_exportar_negocio(1) - 'usuarios';
    -- Lista blanca de catálogo (auditoría M-4): el cliente nuevo hereda SOLO
    -- catálogos y configuración base, nunca inventario, terceros ni histórico.
    -- (Si el negocio 1 operara, sus ventas/facturas/kardex no se filtran al nuevo.)
    FOR _clave IN SELECT jsonb_object_keys(pkg) LOOP
        IF _clave NOT IN ('formato', 'exportado_en', 'negocio', 'tablas_exportadas',
                          'categorias', 'marcas', 'unidades_medida', 'metodos_pago',
                          'plan_cuentas', 'contab_parametros', 'contab_metodo_cuenta',
                          'calendario_fiscal', 'numeracion_fiscal', 'caja_config',
                          'contab_config', 'islr_config') THEN
            pkg := pkg - _clave;
        END IF;
    END LOOP;
    pkg := jsonb_set(pkg, '{negocio}',
        jsonb_strip_nulls(
            -- 'id' se conserva: fn_importar_negocio lo usa para el mapa de ids
            -- (y lo sobreescribe con max+1); configurado_por/en se recalculan aquí.
            ((pkg->'negocio') - 'configurado_por' - 'configurado_en')
            || jsonb_build_object(
                 'razon_social', trim(p_razon_social),
                 'rif', upper(trim(p_rif)),
                 'nombre_comercial', NULLIF(trim(COALESCE(p_nombre_comercial, '')), ''),
                 'direccion_fiscal', NULLIF(trim(COALESCE(p_direccion, '')), ''),
                 'telefono', NULLIF(trim(COALESCE(p_telefono, '')), ''),
                 'correo', NULLIF(trim(COALESCE(p_correo, '')), ''),
                 'configurado_en', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));

    n_new := tienda.fn_importar_negocio(pkg);

    -- Usuario administrador de la nueva tienda (username único por plataforma).
    INSERT INTO tienda.usuarios (username, password_hash, nombre_completo, rol, activo,
                                 debe_cambiar_password, negocio_id)
    VALUES (lower(COALESCE(NULLIF(trim(p_admin_username), ''), v_slug || '_admin')),
            p_admin_password_hash, trim(p_admin_nombre), 'ADMINISTRADOR', true, false, n_new)
    RETURNING id INTO v_admin;

    UPDATE tienda.negocio SET configurado_por = v_admin WHERE id = n_new;

    -- Módulos según el plan: ESPECIAL y DEMO ven la parte fiscal; SISTEMA no.
    v_modulos := CASE v_plan
        WHEN 'ESPECIAL' THEN '{"repuestos": true, "ropa": true, "fiscal": true}'::jsonb
        WHEN 'DEMO'     THEN '{"repuestos": true, "fiscal": true}'::jsonb
        ELSE '{}'::jsonb
    END;
    -- fn_importar_negocio ya siembra estado_tenants con los datos de la semilla;
    -- el upsert impone el subdominio, plan y módulos reales del cliente nuevo.
    INSERT INTO tienda.estado_tenants (negocio_id, subdominio, activo, plan, modulos)
    VALUES (n_new, v_slug, true, v_plan, v_modulos)
    ON CONFLICT (negocio_id) DO UPDATE
        SET subdominio = EXCLUDED.subdominio, activo = true,
            plan = EXCLUDED.plan, modulos = EXCLUDED.modulos,
            suspendida_en = NULL, motivo = NULL;

    RETURN n_new;
END $$;
COMMENT ON FUNCTION fn_provisionar_negocio(text, text, text, text, text, text, text, text, text, text, text) IS 'Alta self-service de una tienda: negocio nuevo con catálogos de la semilla, admin propio y estado_tenants (plan y módulos). El registro comercial lo hace portal.fn_alta_tenant.';
