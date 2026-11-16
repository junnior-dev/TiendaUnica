-- Búsqueda de productos sin importar tildes: «bujia» encuentra «Bujía».
-- Ejecútalo una vez en tu base de datos (necesita permisos de superusuario o de crear extensiones).
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
