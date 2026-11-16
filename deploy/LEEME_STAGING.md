# Staging de ERP POS · Nivel 4 (observabilidad completa, en orden)

PHP-FPM + OPcache + nginx + pgBouncer + PostgreSQL 17 + Prometheus. k6 corre
contra ESTO — `artisan serve` nunca fue una referencia de rendimiento.

## Decisión de plataforma (por qué PHP-FPM y no Octane)

El aislamiento del negocio depende de `set_config('app.negocio_id', ..., false)`
(GUC de **sesión**) y de `Tenant::limpiar()` al terminar cada petición: el modelo
por-proceso de PHP-FPM es el que el código ya garantiza. Octane/RoadRunner
persisten el proceso entre peticiones y obligarían a re-auditar cada camino de
estado (sesiones, caché estático, singletons con tenant). Si un día se quiere
Octane, empieza por re-auditar `IdentificarTenant` y `Tenant::limpiar()` bajo
el modelo de worker persistente.

## Puesta en marcha (una sola vez)

1. Crea `deploy/.env` (no va a git):

   ```
   DB_PASSWORD=<contraseña fuerte de saas_app>
   METRICS_TOKEN=<valor aleatorio largo>
   ```

2. Crea `deploy/monitoring/metrics_token` con el MISMO `METRICS_TOKEN`
   (un renglón, sin comillas): es lo que Prometheus usa como Bearer al
   scrape. Tampoco va a git (`.gitignore`).

3. Levanta la pila:

   ```
   docker compose -f deploy/docker-compose.staging.yml up -d --build
   ```

4. **Instala el esquema UNA vez** (el contenedor no lo ejecuta solo, para que
   un `up` nocturno nunca re-instale sobre datos):

   ```
   psql -h 127.0.0.1 -p 5432 -U saas_app -d tienda \
     -v ON_ERROR_STOP=1 -f database/sql/00_instalar.sql
   # y después los 01–43 en el orden del LEEME.md (el 00 los encadena)
   ```

5. Configura el negocio en `/registro` (primer administrador) o carga una
   copia de la base con `dumps/` de producción desensibilizada.

## Qué queda expuesto y qué no

| Puerto (host) | Servicio | Acceso |
|---|---|---|
| 8080 | nginx → php-fpm | la app (la única puerta pública) |
| 127.0.0.1:5432 | postgres | solo desde el host (psql de mantenimiento) |
| 127.0.0.1:6432 | pgBouncer | solo desde el host |
| 127.0.0.1:9090 | Prometheus | solo desde el host |

La app **no** publica su puerto: nginx es la única entrada. `/metrics` exige
Bearer (`METRICS_TOKEN`); sin token responde 403 SIEMPRE.

## Verificación (5 minutos)

```
curl -s http://localhost:8080/health/db          # {"db":"ok",…}
curl -s http://localhost:8080/health/cache       # {"cache":"ok","driver":"file","ms":…}
curl -s http://localhost:8080/health/queue       # {"queue":"ok","driver":"database",…}
curl -s -H "Authorization: Bearer $(cat deploy/monitoring/metrics_token)" \
     http://localhost:8080/metrics               # formato de texto Prometheus
```

Abre `http://localhost:9090/alerts` → las alertas N2 cargadas (latencia caja,
5xx, conexiones PG, health caído, scrape).

## k6 contra staging (no contra artisan serve)

```
k6 run -e BASE_URL=http://localhost:8080 scripts/carga/k6_latencia.js
```

(k6_ventas requiere un turno de caja abierto y la tasa del día cargada: entra
al POS una vez antes de correrlo.)

## Alertas N2 (deploy/monitoring/alertas.yml)

Las cinco de la lista original: latencia de caja, 5xx > 1%, conexiones PG > 80%,
`/health/db` caído (2 scrapes) y ceguera de scrape. FALTA la sexta: «ERROR con
negocio_id en logs agrupado» — eso es agregación de logs (Loki + Promtail) y
queda para N3, cuando el volumen lo justifique. Nota honesta: con contadores
`_sum`/`_count` las alertas de latencia calculan PROMEDIO; el histograma de
buckets (p95 real) es la mejora N3.
