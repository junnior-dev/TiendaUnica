-- =============================================================================
--  Archivo 05 · DATOS INICIALES (catálogos mínimos para arrancar)
-- =============================================================================
--  Idempotente: se puede ejecutar más de una vez sin duplicar.
--  Incluye solo el usuario «admin» sin contraseña (el asistente la fija con sp_primer_admin). No incluye productos ni tasas de cambio (las trae la API).
--  Referencias (informe fiscal 2026 del proyecto): IVA general 16 % vigente; IGTF 3 % sobre pagos en divisas;
--  base del IGTF = CON_IVA (doctrina mayoritaria); contribuyente ordinario = crédito fiscal recuperable (costo sin IVA).
--  Confirme con su contador y, cuando la ley cambie, agregue una fila nueva en parametros_fiscales con otra vigencia.
-- =============================================================================
SET search_path = tienda, public;

INSERT INTO monedas (codigo, nombre, simbolo, es_base) VALUES
    ('USD', 'Dólar estadounidense', '$',  TRUE),
    ('VES', 'Bolívar',              'Bs', FALSE),
    ('EUR', 'Euro',                 '€',  FALSE),
    ('COP', 'Peso colombiano',      '$',  FALSE)
ON CONFLICT (codigo) DO NOTHING;

-- Fila única del negocio, sin configurar: ventas bloqueadas hasta confirmar el asistente.
INSERT INTO negocio (id, razon_social) VALUES (1, 'PENDIENTE DE CONFIGURAR') ON CONFLICT (id) DO NOTHING;

INSERT INTO parametros_fiscales (codigo, porcentaje, vigente_desde, nota)
SELECT 'IVA_GENERAL', 16, DATE '2015-01-01', 'Alícuota general del IVA. Verificar vigencia con el contador.'
WHERE NOT EXISTS (SELECT 1 FROM parametros_fiscales WHERE codigo = 'IVA_GENERAL');
INSERT INTO parametros_fiscales (codigo, porcentaje, vigente_desde, nota)
SELECT 'IGTF_DIVISAS', 3, DATE '2022-03-28', 'IGTF sobre pagos en divisas sin mediación bancaria venezolana. Verificar con el contador.'
WHERE NOT EXISTS (SELECT 1 FROM parametros_fiscales WHERE codigo = 'IGTF_DIVISAS');

-- Métodos de pago típicos. es_divisa/aplica_igtf: solo los pagos en divisas (efectivo, Zelle) generan IGTF.
INSERT INTO metodos_pago (nombre, moneda, es_divisa, aplica_igtf, requiere_referencia) VALUES
    ('Efectivo USD',        'USD', TRUE,  TRUE,  FALSE),
    ('Zelle',               'USD', TRUE,  TRUE,  TRUE),
    ('Efectivo Bs',         'VES', FALSE, FALSE, FALSE),
    ('Pago móvil',          'VES', FALSE, FALSE, TRUE),
    ('Punto de venta',      'VES', FALSE, FALSE, TRUE),
    ('Transferencia Bs',    'VES', FALSE, FALSE, TRUE),
    ('Efectivo EUR',        'EUR', TRUE,  TRUE,  FALSE),
    ('Efectivo COP',        'COP', TRUE,  TRUE,  FALSE)
ON CONFLICT DO NOTHING;
-- OJO: aplica_igtf = TRUE para EUR y COP es la posición CONSERVADORA. Si el contador dice que no causan IGTF:
--   UPDATE metodos_pago SET aplica_igtf = FALSE WHERE nombre = 'Efectivo COP';   (ver README_BASE_DE_DATOS «Decisión fiscal pendiente»)

INSERT INTO categorias (nombre) VALUES
    ('Motor'), ('Transmisión y cadena'), ('Frenos'), ('Suspensión y dirección'), ('Eléctrico y encendido'),
    ('Lubricantes y fluidos'), ('Cauchos y neumáticos'), ('Carrocería y plásticos'), ('Accesorios'), ('Tornillería y varios')
ON CONFLICT DO NOTHING;

INSERT INTO marcas (nombre) VALUES
    ('Genérica'), ('Empire Keeway'), ('Bera'), ('Suzuki'), ('Honda'), ('Yamaha'), ('Skygo'), ('Owen')
ON CONFLICT DO NOTHING;

-- Administrador semilla: nace con password_hash = 'PENDIENTE'. Cuando el asistente pide la contraseña, la API
-- calcula el hash bcrypt y llama a sp_primer_admin(hash). Hasta entonces fn_checklist_configuracion() deja el
-- último paso incompleto y no se puede confirmar el asistente. (id fijo = 1: la columna es GENERATED ALWAYS.)
INSERT INTO usuarios (id, username, password_hash, nombre_completo, rol)
OVERRIDING SYSTEM VALUE
VALUES (1, 'admin', 'PENDIENTE', 'Administrador del sistema', 'ADMINISTRADOR')
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('usuarios', 'id'), GREATEST((SELECT max(id) FROM usuarios), 1));
