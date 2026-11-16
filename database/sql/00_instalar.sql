-- =============================================================================
--  Archivo 00 · INSTALADOR (ejecuta todo en orden)
-- =============================================================================
--  Uso (desde esta carpeta):
--     createdb -U postgres tienda
--     psql -U postgres -d tienda -v ON_ERROR_STOP=1 -f 00_instalar.sql
--  Es seguro ejecutarlo UNA vez sobre una base vacía. Para recrear: DROP SCHEMA tienda CASCADE; y repetir.
-- =============================================================================
\echo '>> 01 tablas'
\ir 01_tablas.sql
\echo '>> 02 funciones y procedimientos'
\ir 02_funciones_procedimientos.sql
\echo '>> 03 triggers'
\ir 03_triggers.sql
\echo '>> 04 vistas'
\ir 04_vistas.sql
\echo '>> 05 datos iniciales'
\ir 05_datos_iniciales.sql
\echo '>> Instalación completa. Siguiente paso: asistente de primer inicio (ver README_BASE_DE_DATOS.md).'
