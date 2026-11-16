# php-fpm 8.3 con las extensiones que el ERP necesita en producción.
FROM php:8.3-fpm-alpine

RUN apk add --no-cache postgresql-dev icu-dev libzip-dev oniguruma-dev git unzip \
    && docker-php-ext-install -j$(nproc) pdo_pgsql pgsql intl mbstring zip opcache

# Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# OPcache en modo producción (Nivel 4): sin comentarios ni validación de
# timestamps (el despliegue reemplaza el código completo; validate se apaga
# para ahorrar stat() en cada petición; en staging se deja revalidate por si
# se toca el código en caliente).
RUN { \
      echo "opcache.enable=1"; \
      echo "opcache.enable_cli=0"; \
      echo "opcache.memory_consumption=192"; \
      echo "opcache.interned_strings_buffer=16"; \
      echo "opcache.max_accelerated_files=20000"; \
      echo "opcache.validate_timestamps=1"; \
      echo "opcache.revalidate_freq=2"; \
      echo "opcache.jit=tracing"; \
      echo "opcache.jit_buffer_size=64M"; \
    } > /usr/local/etc/php/conf.d/opcache.ini

WORKDIR /var/www/html

COPY composer.json composer.lock ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-scripts --no-autoloader

COPY . .
RUN composer dump-autoload --optimize && \
    php artisan config:cache && \
    php artisan route:cache && \
    php artisan view:cache && \
    chown -R www-data:www-data storage bootstrap/cache

# La instalación del esquema (scripts 00–43 + semilla) es manual y UNA vez:
# psql -h 127.0.0.1 -p 5432 -U saas_app -d tienda -f database/sql/00_instalar.sql …
# (ver deploy/LEEME_STAGING.md). El contenedor NO la ejecuta: evitar que un
# `docker compose up` de noche re-instale nada encima de datos reales.
CMD ["php-fpm"]
