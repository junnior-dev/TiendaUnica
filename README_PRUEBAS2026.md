# README PRUEBAS 2026 · SaaS Repuestos de Motos (POS multi-tenant)

> **Documento de referencia de TODAS las pruebas ejecutadas sobre el sistema**, con
> cantidades exactas calculadas desde los registros de resultados, el estado de cada
> suite, el stack tecnológico con versiones reales y la lista completa de paquetes.

- Fecha de la última ronda completa: **16 de noviembre de 2026**
- **Total de PRUEBAS ejecutadas: 919** (todas aprobadas · **0 fallos**)
- **Total de VERIFICACIONES adicionales (HTTP, base de datos, trazabilidad, auditorías): 3134**
- **GRAN TOTAL: 4053 verificaciones/pruebas superadas**
- Aserciones internas de Pest: **684**

---

## 1 · Resumen ejecutivo

| Categoría | Cantidad | Estado |
|---|---:|---|
| Pruebas funcionales Python/E2E (t/f/m/p + t16 + t17 + t18) | 811 | ✅ todas OK |
| Pruebas Pest/PHPUnit (Laravel) | 85 | ✅ todas OK (684 aserciones) |
| Verificaciones de continuidad (backup/restore/rollback) | 23 | ✅ todas OK |
| Verificaciones k6 (HTTP, carga y latencia) | 1092 | ✅ aprobadas |
| Verificaciones de concurrencia PostgreSQL | 2000 | ✅ todas OK |
| Requisitos verificados en trazabilidad bidireccional | 40 | ✅ 0 sin respaldo · 0 huérfanas |
| Auditorías de dependencias (composer + npm) | 2 | ✅ 0 vulnerabilidades |
| **GRAN TOTAL** | **4053** | **✅ 0 fallos** |

---

## 2 · Suites funcionales Python/E2E — 811 pruebas, 0 fallos

| Suite | Alcance | Pruebas | Estado |
|---|---|---:|---|
| t01–t15 | Operativa del negocio: instalación, catálogo, compras, POS, crédito, notas, encargos, conteos, cierre, usuarios | 239 | ✅ OK |
| f01–f17 | Fiscal venezolano: IVA 16 %, IGTF 3 %, retenciones, ISLR, ajuste cambiario, partida doble, invariantes | 200 | ✅ OK |
| m01–m13 | Multi-tenant: RLS, aislamiento por negocio, portabilidad de datos, plan básico SISTEMA, 2 negocios vivos | 183 | ✅ OK |
| p01–p03 | Portal SaaS: alta idempotente de tiendas, ciclo de vida, seguridad de endpoints del portal | 66 | ✅ OK |
| t16 | Páginas Inertia por HTTP real (componentes, props, partials, redirects por rol) | 71 | ✅ OK |
| t17 | Concurrencia: corridas simultáneas sin huecos de correlativo ni stock negativo, sin fugas de sesión | 33 | ✅ OK |
| t18 | Navegador real (Playwright + Chromium): 8 flujos de UI sin un solo error de consola | 19 | ✅ OK |
| **Total** | | **811** | **✅ 0 fallos** |

---

## 3 · Suite Pest/PHPUnit (Laravel) — 85 pruebas · 684 aserciones · 0 fallos en ~2 s

Instalada en esta ronda (pestphp/pest 3.8.7 sobre PHPUnit 11.5.56) y corriendo contra
bases **dedicadas** `tienda_pest` / `portal_pest` (phpunit.xml), nunca contra la base del servidor.

| Archivo (tests/) | Qué prueba | Pruebas |
|---|---|---:|
| `Feature/PaginasInertiaTest.php` | Migración de t16 a Pest: `$this->get()` + `assertInertia` oficial — componente correcto, conteo de props certificado, versión de assets, archivo .jsx existente; invitado/admin/cajero/portal; JSON parcial X-Inertia | 39 |
| `Feature/AutorizacionEndpointTest.php` | **Autorización POR ENDPOINT por rol**: 8 endpoints admin-only × (invitado → redirect /login · cajero → 302 a /caja o 403 y NINGÚN dato cambia · admin → pasa) + "propio" en /ventas + 403 del guard al anular | 27 |
| `Feature/FlujoVentaTest.php` | Flujo completo POR LA PILA LARAVEL: apertura de caja → cotización (tasa/IVA) → venta contado → verificación de stock, kardex, pagos y documento → anulación con retorno de stock → rechazo TV004 | 5 |
| `Feature/ValidacionesFormularioTest.php` | Validaciones de formulario (login vacío, producto sin SKU/nombre, usuario corto, costo no numérico) + buscador del POS | 6 |
| `Feature/SesionTenantTest.php` | Sesión multi-tenant como `saas_app`: sin GUC no ve ni escribe; GUC de transacción y de sesión; alternancia de 2 negocios sin fugas | 4 |
| `Unit/HelpersTest.php` | Matriz de `Permisos` (única fuente de roles) y cálculo de subdominio del middleware | 4 |
| `Feature/Pest.php` + `TestCase.php` | Configuración, helpers y bases dedicadas | — |

Ejecutar: `./vendor/bin/pest`

---

## 4 · Rendimiento y carga (k6 v0.57 + PostgreSQL) — 3,092 verificaciones

### 4.1 Escenarios k6 por HTTP real (servidor Laravel con 8 workers PHP)

| Escenario | Verificaciones | Resultado |
|---|---:|---|
| Latencia base (1 VU · 30 vueltas × 4 endpoints) | 120 | p95 = 105 ms · 0 fallos HTTP |
| Rampa de carga 2→8→16 VUs (~70 s) | 570 | 0 respuestas fallidas · saturación medida a 16 VUs (p95 ≈ 1.1 s) |
| Ventas reales por HTTP (10 cajas · 40 s) | 402 | 201 ventas registradas · stock/kardex/correlativo íntegros |
| **Total k6** | **1092** | **✅ sin fallos de aplicación** |

Notas honestas de la rampa: la pila de desarrollo (2 vCPU, `php artisan serve`) satura a partir
de ~16 usuarios virtuales concurrentes (p95 ≈ 1.1 s); el umbral de errores (0.02) **no se cruzó**
en ningún escenario. El throttle del login (5/min por IP) se demostró de verdad con respuestas 429.

### 4.2 Concurrencia a nivel PostgreSQL (clon dedicado con 2 negocios reales)

| Escenario | Verificaciones | Resultado |
|---|---:|---|
| A · 100 conexiones concurrentes reales (2 negocios, GUC por transacción) | 600 | 304 ops/s · p50 = 37 ms · 0 errores · 0 ventas cruzadas · stock íntegro |
| B · 1,000 sesiones de tenant vía pool de 16 conexiones (como saas_app) | 1000 | 0 fugas de aislamiento · p95 = 3.5 ms/sesión |
| C · Costo de la guarda RLS (200 op con GUC + 200 sin GUC) | 400 | costo ≈ 0.11 ms/op |
| **Total PostgreSQL** | **2000** | **✅ aislamiento intacto** |

---

## 5 · Continuidad de negocio — 23 verificaciones · 0 fallos

| Paso | Qué se probó | Estado |
|---|---|---|
| c1 · Backup | `pg_dump -Fc` de `tienda` (1.13 MB) y `portal_saas` (54 KB) con datos; índice del dump verificado | ✅ |
| c2 · Restore | `pg_restore` a bases nuevas: conteos idénticos, partida doble cuadrada, cadena venta→líneas→producto→pagos íntegra, bitácora de huecos idéntica | ✅ |
| c3 · Migración | Migración incremental idempotente (ADD COLUMN IF NOT EXISTS + backfill + índice) aplicada **2 veces** sobre una base CON datos; todos los productos etiquetados; la base registra una venta real después | ✅ |
| c4 · Rollback | "Migración" destructiva sobre la copia → restore `--clean` → columna fake desaparecida, invariantes contables restablecidas, datos EXACTOS por huella md5 | ✅ |

Hallazgos operativos documentados:

1. Los scripts SQL 01–42 **no son idempotentes sobre bases con datos** (CREATE TABLE sin
   IF NOT EXISTS): la política oficial de actualización es backup → reinstalar 00–42 → restaurar,
   que es exactamente el drill que c2 + c4 ejercitan.
2. Tras un `pg_restore` hay que fijar el `search_path` de la base (`ALTER DATABASE … SET
   search_path TO tienda, public`), porque las funciones resuelven sus tablas por el search_path
   de sesión y pg_restore restaura las funciones con `pg_catalog`. El `.env` ya lo hace vía
   `DB_SEARCH_PATH`; sin este paso los triggers dejan de compilar.

Ejecutar: `python3 scripts/continuidad.py`

---

## 6 · Seguridad complementaria

| Verificación | Herramienta | Resultado |
|---|---|---|
| Dependencias PHP (CVEs) | `composer audit` | ✅ 0 vulnerabilidades |
| Dependencias JS (CVEs) | `npm audit` | ✅ 0 vulnerabilidades (tras actualizar jspdf 2.5.2 → 4.2.1, autotable 5.0.9 y dompurify 3.4.18 con override) |
| Trazabilidad bidireccional requisitos ↔ suites | `tests/trazabilidad.py` | ✅ 40 requisitos · 0 sin respaldo · 0 suites huérfanas |

Cobertura adicional ya certificada en rondas anteriores: auditoría de seguridad del SaaS
(`informe_auditoria_saas_pos.pdf`), suite hostil del portal (p02), rate limiting del login
(5/min por IP, demostrado en vivo durante la rampa k6), CSRF/XSS y cookies endurecidas,
autorización por rol a nivel de página Y de endpoint (t14 + Pest).

---

## 7 · Stack tecnológico (versiones instaladas y usadas EN LAS PRUEBAS)

| Capa | Tecnología | Versión |
|---|---|---|
| Base de datos | PostgreSQL | 17.4 (cliente pg_dump/pg_restore 17.12) |
| Backend | PHP (CLI + php -S con 8 workers para la carga) | 8.3.32 |
| Framework | Laravel | 12.72.0 |
| SSR/SPA | Inertia (inertiajs/inertia-laravel + @inertiajs/react) | 2.0.28 / 2.3.29 |
| Frontend | React | 19.3.1 |
| Build | Vite | 6.4.5 |
| Estilos | Tailwind CSS | 4.3.4 |
| Iconos | lucide-react | 1.67.0 |
| PDF de la caja | jspdf + jspdf-autotable (+ dompurify) | 4.2.1 / 5.0.9 / 3.4.18 |
| Pruebas Laravel | Pest + PHPUnit | 3.8.7 / 11.5.56 |
| Pruebas funcionales | Python (scripts t/f/m/p + t16/t17/t18) | 3.12 |
| E2E navegador | Playwright + Chromium | headless |
| Carga HTTP | k6 (Grafana) | 0.57.0 |
| Concurrencia DB | psycopg2 + threading (100 conexiones reales / pool de 16) | — |
| Auditorías | composer audit + npm audit | 0 CVEs |

---

## 8 · Paquetes COMPLETOS usados

### 8.1 Composer — runtime (78 paquetes, `composer.lock`)

| Paquete | Versión |
|---|---|
| `brick/math` | 0.14.8 |
| `carbonphp/carbon-doctrine-types` | 3.2.1 |
| `dflydev/dot-access-data` | v3.0.3 |
| `doctrine/inflector` | 2.1.1 |
| `doctrine/lexer` | 3.0.3 |
| `dragonmantank/cron-expression` | v3.6.1 |
| `egulias/email-validator` | 4.0.4 |
| `fruitcake/php-cors` | v1.4.0 |
| `graham-campbell/result-type` | v1.2.0 |
| `guzzlehttp/guzzle` | 7.16.1 |
| `guzzlehttp/promises` | 2.6.0 |
| `guzzlehttp/psr7` | 2.13.3 |
| `guzzlehttp/uri-template` | v1.0.11 |
| `inertiajs/inertia-laravel` | v2.0.28 |
| `laravel/framework` | v12.72.0 |
| `laravel/prompts` | v0.3.27 |
| `laravel/serializable-closure` | v2.2.0 |
| `laravel/tinker` | v2.11.1 |
| `league/commonmark` | 2.10.7 |
| `league/config` | v1.2.0 |
| `league/flysystem` | 3.36.0 |
| `league/flysystem-local` | 3.35.3 |
| `league/mime-type-detection` | 1.17.0 |
| `league/uri` | 7.10.0 |
| `league/uri-interfaces` | 7.10.0 |
| `monolog/monolog` | 3.12.1 |
| `nesbot/carbon` | 3.15.1 |
| `nette/schema` | v1.4.0 |
| `nette/utils` | v4.1.6 |
| `nikic/php-parser` | v5.9.0 |
| `nunomaduro/termwind` | v2.4.1 |
| `phpoption/phpoption` | 1.10.0 |
| `psr/clock` | 1.0.0 |
| `psr/container` | 2.0.2 |
| `psr/event-dispatcher` | 1.0.0 |
| `psr/http-client` | 1.0.3 |
| `psr/http-factory` | 1.1.0 |
| `psr/http-message` | 2.0 |
| `psr/log` | 3.0.2 |
| `psr/simple-cache` | 3.0.0 |
| `psy/psysh` | v0.12.24 |
| `ralouphie/getallheaders` | 3.0.3 |
| `ramsey/collection` | 2.1.1 |
| `ramsey/uuid` | 4.10.0 |
| `symfony/clock` | v7.4.21 |
| `symfony/console` | v7.4.23 |
| `symfony/css-selector` | v7.4.22 |
| `symfony/deprecation-contracts` | v3.8.1 |
| `symfony/error-handler` | v7.4.22 |
| `symfony/event-dispatcher` | v7.4.17 |
| `symfony/event-dispatcher-contracts` | v3.8.1 |
| `symfony/finder` | v7.4.23 |
| `symfony/http-foundation` | v7.4.23 |
| `symfony/http-kernel` | v7.4.23 |
| `symfony/mailer` | v7.4.22 |
| `symfony/mime` | v7.4.22 |
| `symfony/polyfill-ctype` | v1.37.0 |
| `symfony/polyfill-intl-grapheme` | v1.43.3 |
| `symfony/polyfill-intl-idn` | v1.43.0 |
| `symfony/polyfill-intl-normalizer` | v1.43.0 |
| `symfony/polyfill-mbstring` | v1.43.3 |
| `symfony/polyfill-php80` | v1.43.0 |
| `symfony/polyfill-php83` | v1.43.0 |
| `symfony/polyfill-php84` | v1.43.0 |
| `symfony/polyfill-php85` | v1.44.0 |
| `symfony/polyfill-time` | v1.42.0 |
| `symfony/polyfill-uuid` | v1.43.0 |
| `symfony/process` | v7.4.22 |
| `symfony/routing` | v7.4.23 |
| `symfony/service-contracts` | v3.8.1 |
| `symfony/string` | v7.4.22 |
| `symfony/translation` | v7.4.23 |
| `symfony/translation-contracts` | v3.8.1 |
| `symfony/uid` | v7.4.21 |
| `symfony/var-dumper` | v7.4.22 |
| `tijsverkoyen/css-to-inline-styles` | v2.4.0 |
| `vlucas/phpdotenv` | v5.8.0 |
| `voku/portable-ascii` | 2.1.1 |

### 8.2 Composer — desarrollo/pruebas (49 paquetes)

| Paquete | Versión |
|---|---|
| `brianium/paratest` | v7.8.6 |
| `doctrine/deprecations` | 1.2.0 |
| `fakerphp/faker` | v1.24.1 |
| `fidry/cpu-core-counter` | 1.4.1 |
| `filp/whoops` | 2.19.3 |
| `hamcrest/hamcrest-php` | v3.0.0 |
| `jean85/pretty-package-versions` | 2.1.1 |
| `laravel/pail` | v1.3.0 |
| `laravel/pint` | v1.32.3 |
| `laravel/sail` | v1.70.0 |
| `mockery/mockery` | 1.6.15 |
| `myclabs/deep-copy` | 1.14.0 |
| `nunomaduro/collision` | v8.9.6 |
| `pestphp/pest` | v3.8.7 |
| `pestphp/pest-plugin` | v3.0.0 |
| `pestphp/pest-plugin-arch` | v3.1.1 |
| `pestphp/pest-plugin-mutate` | v3.0.5 |
| `phar-io/manifest` | 2.0.4 |
| `phar-io/version` | 3.2.1 |
| `phpdocumentor/reflection-common` | 2.2.1 |
| `phpdocumentor/reflection-docblock` | 6.0.3 |
| `phpdocumentor/type-resolver` | 2.1.0 |
| `phpstan/phpdoc-parser` | 2.4.1 |
| `phpunit/php-code-coverage` | 11.0.12 |
| `phpunit/php-file-iterator` | 5.1.1 |
| `phpunit/php-invoker` | 5.0.1 |
| `phpunit/php-text-template` | 4.0.1 |
| `phpunit/php-timer` | 7.0.1 |
| `phpunit/phpunit` | 11.5.56 |
| `sebastian/cli-parser` | 3.0.2 |
| `sebastian/code-unit` | 3.0.3 |
| `sebastian/code-unit-reverse-lookup` | 4.0.1 |
| `sebastian/comparator` | 6.3.3 |
| `sebastian/complexity` | 4.0.1 |
| `sebastian/diff` | 6.0.2 |
| `sebastian/environment` | 7.2.1 |
| `sebastian/exporter` | 6.3.2 |
| `sebastian/global-state` | 7.0.2 |
| `sebastian/lines-of-code` | 3.0.1 |
| `sebastian/object-enumerator` | 6.0.1 |
| `sebastian/object-reflector` | 4.0.1 |
| `sebastian/recursion-context` | 6.0.3 |
| `sebastian/type` | 5.1.3 |
| `sebastian/version` | 5.0.2 |
| `staabm/side-effects-detector` | 1.0.5 |
| `symfony/yaml` | v7.4.23 |
| `ta-tikoma/phpunit-architecture-test` | 0.8.7 |
| `theseer/tokenizer` | 1.3.1 |
| `webmozart/assert` | 2.5.1 |

### 8.3 npm — dependencias de la aplicación (7)

| Paquete | Versión instalada |
|---|---|
| `@inertiajs/react` | 2.3.29 |
| `dompurify` | 3.4.18 |
| `jspdf` | 4.2.1 |
| `jspdf-autotable` | 5.0.9 |
| `lucide-react` | 1.67.0 |
| `react` | 19.3.1 |
| `react-dom` | 19.3.1 |

### 8.4 npm — desarrollo/build (6)

| Paquete | Versión instalada |
|---|---|
| `@fontsource-variable/inter` | 5.3.0 |
| `@tailwindcss/vite` | 4.3.4 |
| `@vitejs/plugin-react` | 4.7.0 |
| `laravel-vite-plugin` | 1.3.0 |
| `tailwindcss` | 4.3.4 |
| `vite` | 6.4.5 |

Overrides de seguridad en `package.json`: `dompurify: ^3.4.18` (versión parcheada, sin CVEs).

---

## 9 · Cómo ejecutar cada suite

| Suite | Comando (desde la raíz del proyecto) |
|---|---|
| Instalación de la base + semilla | `python3 scripts/setup_db.py` |
| Funcionales t/f/m/p + t16/t17/t18 | `python3 tests/run_todo.py` (genera `resultados_pruebas.json`) |
| Pest/PHPUnit | `./vendor/bin/pest` |
| k6 latencia / rampa / ventas | `k6 run scripts/carga/k6_latencia.js` · `k6_rampa.js` · `k6_ventas.js` |
| Concurrencia PostgreSQL | `python3 scripts/carga/concurrencia_pg.py` |
| Continuidad (backup/restore/rollback) | `python3 scripts/continuidad.py` |
| Trazabilidad requisitos ↔ suites | `python3 tests/trazabilidad.py` |
| Auditoría de dependencias | `composer audit` · `npm audit` |

---

## 10 · Evidencias (archivos de log reales de cada ronda)

| Archivo | Contenido |
|---|---|
| `resultados_pruebas.json` | Registro maestro: 811 OK · 0 FAIL · 80 suites + t16/t17/t18 |
| `log_pruebas_negocio_688.log` | t01–t15 + f01–f17 + m01–m13 + p01–p03 (688) |
| `log_pruebas_inertia_t16.log` | 71 verificaciones Inertia por HTTP |
| `log_pruebas_concurrencia_t17.log` | 33 verificaciones de concurrencia |
| `log_pruebas_navegador_t18.log` | 19 pasos de navegador real (Playwright) |
| `log_pruebas_pest_laravel.log` | 85 pruebas Pest · 684 aserciones · 0 fallos |
| `k6_latencia.log` / `k6_rampa.log` / `k6_ventas.log` | Escenarios k6 completos |
| `carga_pg.log` | Escenarios A/B/C de concurrencia PostgreSQL |
| `continuidad.log` | 23 verificaciones de backup/restore/migración/rollback |
| `trazabilidad.log` | Cruce bidireccional requisitos ↔ suites |
| `informe_auditoria_saas_pos.pdf` | Auditoría de seguridad + hallazgos y correcciones |
| `Listado_de_pruebas_y_resultados.docx/.pdf` | Informe formal de la ronda principal |

---

*Todas las cifras de este documento se calcularon por código desde los archivos de resultados
y los manifiestos de paquetes (resultados_pruebas.json, composer.lock, package.json); ninguna
está estimada a mano. Suites con fallos conocidos: ninguna; verificaciones pendientes de la
siguiente ronda: regeneración del informe formal con estas secciones nuevas, phpstan (SAST PHP)
y el humo del PDF con jspdf 4 tras el cambio de fecha del servidor de pruebas.*
