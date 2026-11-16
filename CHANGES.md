# CHANGES · Correcciones aplicadas tras la auditoría (15 de noviembre de 2026)

## Suite de Integración Hostil en Pest (16 de noviembre de 2026)

Cinco archivos nuevos en `tests/Feature/` (+191 pruebas: 779 → 970, 101 → 106
archivos) que ponen la aplicación al límite por HTTP real, con el paquete
oficial de Inertia y contra PostgreSQL (`tienda_pest`):

- **`TodasLasRutasTest`** — smoke sobre la TABLA DE RUTAS REAL
  (`Route::getRoutes()`), no una lista a mano: 3 pases (invitado, cajero,
  administrador) por TODAS las rutas GET. Nada puede responder 500; el
  invitado solo recibe 302 a `/login`; el cajero autenticado nunca puede ser
  expulsado a `/login`; y toda página Inertia 200 declara un componente que
  EXISTE en `resources/js/Pages`. Las rutas con parámetro se piden con un id
  inexistente (el camino correcto es 404/422).
- **`AislamientoMultiTenantHttpTest`** — BOLA/IDOR cross-tenant: el inquilino
  A ataca los ids del inquilino B por GET/PUT/PATCH/DELETE y las listas no
  deben filtrar ni una fila ajena. El aislamiento probado es el de
  PRODUCCIÓN: la sesión corre como `saas_app` (`SET ROLE`) para que RLS
  decida — con la conexión superusuario de las pruebas un 200 sería falso
  positivo del ambiente. Integridad de las filas de B verificada por SQL
  directo tras cada intento. El negocio 2 es permanente (trigger); su
  `estado_tenants` se retira en `afterEach` para devolver la base al modo
  tienda-única.
- **`ControladoresValidacionHostilTest`** — fuzzing de los 10 endpoints de
  escritura críticos (productos, clientes, proveedores, usuarios, métodos de
  pago, categorías, apertura de caja, movimientos, encargos, cobros): payloads
  vacíos, tipos equivocados, cadenas de 5000 caracteres, nulos, valores
  anidados, ids inexistentes y **inyección SQL** en los campos. Nunca 500;
  la basura no altera los conteos; la inyección es dato, no código.
- **`AutorizacionPorRolEstrictaTest`** — matriz de autorización con estado
  EXACTO por celda (96 GET + 75 escrituras): invitado → 302 `/login`;
  cajero → 302 `/caja` y 403 exacto en lo suyo no; admin → 200 y nunca
  403/405. El portal va aparte: la sesión de la tienda NO abre el panel y la
  contraseña del operador (`PORTAL_ADMIN_PASSWORD`) es la única llave.
- **`SesionYCsrfTest`** — CSRF (token falsificado → 419; token correcto →
  pasa), regeneración de id de sesión en el login (fijación), 429 en el
  sexto intento de login (`throttle:5,1`), usuario desactivado desloqueado
  al navegar, y logout que cierra de verdad.

El baseline de PHPStan congela las llamadas HTTP de los 5 archivos con su
conteo (mismo convenio del resto del suite). Los hallazgos que la suite
destape quedan registrados en el log del CI.

## Dependabot security-only · verificado empíricamente (16 de noviembre de 2026)

El `.github/dependabot.yml` quedó en modo quirúrgico: composer + npm +
github-actions, schedule lunes 06:00 UTC (02:00 Caracas) y
`open-pull-requests-limit: 0` — versiones OFF, solo seguridad. Los toggles del
repo (`vulnerability_alerts`, `dependabot_security_updates`) se activaron por
API.

La doc de GitHub afirma que limit 0 no afecta a los security updates, pero
hubo reportes de lo contrario. **Se verificó con un repo de test privado
(`dependabot-lim0-test`, archivado tras la prueba):** misma config quirúrgica,
`lodash 4.17.20` (CVE-2021-23337) y `minimist 1.2.0` (CVE-2021-44906) fijados,
ambos con parche publicado. Resultado en 3 minutos, sin intervención humana:

- **45 s:** 6 alertas abiertas (el toggle de alertas funciona).
- **180 s:** PR de seguridad abierto **por la app dependabot[bot] sola** — el
  intento de disparo manual por API devolvió 404 (el endpoint no existe como
  API pública), así que lo verificado fue el camino AUTOMÁTICO, el que importa
  en producción («funciona solo», no «funciona cuando lo pido»).
- El PR agrupó los DOS fixes en uno solo («bump the parches-menores group
  across 1 directory with 2 updates»: `4.17.20 → 4.18.1`, `1.2.0 → 1.2.6`) —
  el `groups` con `applies-to: security-updates` funciona.
- Cero PRs de versión: `limit: 0` cumple lo prometido.

**Plan B si GitHub cambiara este comportamiento:** `open-pull-requests-limit: 3`
(2–3 PRs de versión por semana, cerrables sin mergear) o crear los security
PRs a mano desde Security tab cuando llegue una alerta.

## Congelación del inventario del esquema (16 de noviembre de 2026)

Inventario verificado contra la instalación limpia de hoy (esquema `tienda`):
**80 tablas · 33 vistas · 226 rutinas (202 funciones + 24 procedimientos) ·
154 triggers · 55 secuencias · 248 índices** — 548 objetos de negocio.

- **m01 NO estaba desactualizado:** congela la ESTRUCTURA RLS (68 tablas de
  negocio con RLS + 69 políticas con `fn_sesion_permitida` + 9 globales fuera),
  y esa descomposición coincide exactamente con el esquema de hoy — el Nightly
  de ayer pasó verde con estos mismos scripts. Lo que nadie congelaba eran los
  TOTALES: `InventarioEsquemaTest` los fija, y una migración que añada o quite
  objetos sin querer rompe el CI. Al crecer el esquema a propósito, se
  actualizan esos números con commit (mismo contrato que t19).
- **Vectores revisados empíricamente (no por doc):** las 6 `SECURITY DEFINER`
  fijan `search_path` (0 sin él) y las 33 vistas llevan
  `security_invoker=true` (0 sin él — verificado por `pg_class.reloptions`,
  no por `pg_views.definition`, que solo contiene el SELECT y nunca las
  opciones). Ambas guardas quedaron PERMANENTES en el mismo test: cualquier
  vista nueva sin invoker o DEFINER sin search_path rompe el CI.
- **Pendiente documentado (runbook de continuidad):** tras cada restore de
  c1–c5, comparar el conteo de triggers contra 154 — un restore «verde» con
  menos triggers es un restore roto silencioso. No se tocó `continuidad.py`
  esta noche para no añadir superficie de fallo antes del primer Nightly
  programado.

## CI/CD · El run_all.sh ya NO es el único guardián (16 de noviembre de 2026)

Hasta hoy la cadena completa de pruebas solo existía si alguien ejecutaba
`scripts/run_all.sh` a mano: el sistema tenía 4.109 verificaciones pero ninguna
se ejecutaba sola. Ahora viven en GitHub Actions y se disparan en cada push y
en cada PR.

**El repo es autocontenido.** Los 4 scripts que orquestaban la cadena vivían
FUERA del proyecto (rutas absolutas del sandbox) y por eso ningún clon ajeno
podía ejecutar ni una sola prueba. Se vendieron al repo con sus rutas
hardcodeadas convertidas a variables de entorno (los defaults locales no
cambian: socket `/tmp`, puerto 5433):

- `scripts/infra/setup_db.py` — instalación limpia de `tienda`/`portal_saas`
  (scripts 00–43 + semilla). El SQL ahora se resuelve relativo al repo.
- `scripts/infra/run_suites.py` — orquestador de los 688 funcionales.
- `scripts/infra/continuidad.py` — c1–c5 (backup/restore/migración/rollback).
- `scripts/carga/` — k6 (latencia, rampa, ventas) y `concurrencia_pg.py`.
- Además, `run_all.sh` ahora apunta a las copias del repo, y las suites que
  tenían la conexión a la base hardcodeada (`e2e_lib.py`, `t16`, `t17`, `t18`,
  `t19`) leen `PGHOST`/`PGPORT` con los mismos defaults.

**`.github/workflows/ci.yml`** — en cada push y PR, 4 jobs en paralelo:

| Job | Qué ejecuta | Referencia |
| --- | --- | --- |
| `calidad` | lint PHP + EAN-13 (PHP y JS) + build Vite | cadena existente |
| `phpstan` | larastan nivel 6 (nuevo dev-dep) | 740 errores históricos congelados en `phpstan-baseline.neon`; CUALQUIER error nuevo rompe el build |
| `pest` | 99 archivos / 768 pruebas contra clones DEDICADOS frescos | `tienda_pest`/`portal_pest` creados desde TEMPLATE en el propio job |
| `t19-regresion` | regresión de hallazgos (68) + trazabilidad (40) | `tests/security/regresion_hallazgos.py` + `tests/trazabilidad.py` |

La base la pone un contenedor de servicio `postgres:17-alpine` (trust auth,
puerto 5433 mapeado); el `.env` de CI se genera desde `.env.example` y la
configuración de testing vive en `phpunit.xml` (que también recibió la
`APP_KEY` de pruebas y los valores SAAS que las pruebas asumen).

**`.github/workflows/nightly.yml`** — cadena completa a las 04:30 (hora
Venezuela) o manual, dos jobs:

- `suites-python`: t16 (71) + t17 (33) + t18 (19, con Playwright/Chromium) +
  los 688 funcionales + trazabilidad, contra servidor HTTP con assets
  construidos.
- `carga-continuidad`: k6 latencia + rampa + `k6_ventas` (que repone
  inventario por API en su `setup()`) → concurrencia_pg (A/B/C) → continuidad
  c1–c5 sobre una base CON ventas reales, con cliente PostgreSQL 17.

Los logs de cualquier job fallido quedan como artefactos descargables 7 días.

**Higiene del repositorio.** Historia git nueva y limpia: el árbol previo
arrastraba ~452 MB de snapshots accidentales (binarios de PostgreSQL/k6 y
zips de 46 MB re-commitados). El repo final pesa 4.6 MB y respeta la regla
M-7 del `.gitignore`: sin `preview/`, `dumps/`, `evidencias/` ni cachés de
bytecode (`__pycache__`, `*.pyc`) — ahora sí aplicadas al índice.

**Tres bugs que la primera validación de la CI destapó** (y que ninguna
corrida a mano había destapado, porque la CI corre con clones FRESCOS)
— y un cuarto encontrado al re-validar la cadena completa:

1. **k6: `abrirCaja()` y `reponerStock()` enviaban un objeto JS con cabecera
   `Content-Type: application/json`.** k6 NO serializa objetos a JSON: el
   body iba form-urlencoded y Laravel recibía el payload vacío → 422. La caja
   "sobrevivía" en local porque t16/t17 dejaban un turno abierto; el restock
   FALLABA EN SILENCIO (el script toleraba el 422) y el inventario se quedaba
   en el del seed: con el stock agotado, la corrida reproductora de
   `k6_ventas` caía al 54.3 % de checks. El restock **nunca había funcionado**.
   Ahora ambos stringifyan y el restock es ESTRICTO (422 = error). Demostrado
   con stock drenado a 2 unidades vía `sp_ajustar_stock`: la corrida repone
   por la API real y pasa 100 % (386/386 checks) con el movimiento de
   reposición registrado en el kardex.
2. **`AutorizacionEndpointTest` dependía de un turno residual.** La venta del
   admin vía `fn_registrar_venta` moría con TV005 («abre tu caja antes de
   vender») en un clon fresco: el test abría el turno del CAJERO pero asumía
   el turno del admin heredado de otras corridas. Ahora abre SU turno.
3. **El orden de la nightly era el inverso al de `run_all.sh`.** Las suites
   funcionales crean sus clones desde la plantilla `tienda` y exigen que la
   plantilla sea PRISTINA: si t18 (que vende contra la base real) corre
   antes, la FK `ventas_cliente_id_fkey` bloquea la escritura cruzada de m04
   (5 FAIL reproducidos). El workflow ejecuta ahora: suites → t16–t18.
4. **`run_portal.py` recreaba `portal_saas` sin el 34 y sin el 42.** La
   recreación solo aplicaba `33_portal.sql` + `40_ciclo_cobro.sql`: sin el
   34 (cuentas de cobro) y sin el 42 (roles y GRANTs de `portal_app`), el
   portal quedaba sin permisos y el M-6 de t19 caía (3 FAIL: «permission
   denied for schema portal»). Las corridas verdes anteriores solo pasaban
   porque el DROP/CREATE inicial fallaba, se saltaba la recreación y
   quedaba la base con los grants del setup. Ahora la recreación replica
   EXACTAMENTE los PORTAL_FILES de setup_db (33 + 34 + 40 + 42), y el host
   de la recreación sale de `PGHOST_PRUEBAS` (antes `/tmp` fijado, roto en
   CI). Con la recreación COMPLETA afloró además un test de p01 que
   exigía «3 planes sembrados» (catálogo anterior al 34): actualizado a los
   6 planes reales (BASE, PRACTICA, PRO + SISTEMA, ESPECIAL, DEMO).

## CRÍTICO

Este documento resume TODAS las correcciones aplicadas al sistema después de la
auditoría técnica y de seguridad completa (688 pruebas + revisión de código +
pruebas HTTP empíricas). El detalle de cada hallazgo está en el informe
`informe_auditoria_saas_pos.pdf`. Ninguna prueba se eliminó: las 4 suites del
proyecto vuelven a pasar al 100 % después de los cambios.

## CRÍTICO

- **C-1 · Panel del portal sin autorización.** Las rutas `/portal/*` de escritura
  (`/portal/pagos/{id}/verificar`, `/portal/tasa`, `/portal/tenants/{id}/estado`,
  `/portal/cuentas`) eran accesibles SIN sesión: cualquiera podía aprobar pagos,
  publicar la tasa, suspender tiendas o crear cuentas de cobro.
  - Nuevo middleware `App\Http\Middleware\PortalAdmin` (alias `portal_admin`)
    aplicado a TODO el grupo de rutas del portal excepto el login
    (`routes/web.php`). Ninguna ruta futura puede olvidarlo.
  - Además, los 4 métodos re-verifican `autorizado()` internamente (defensa en
    profundidad) y `autenticar()` compara con `hash_equals()` y regenera la
    sesión tras entrar (M-1).

## ALTAS (aislamiento multiinquilino)

- **A-1 · `estado_tenants` escribible por `saas_app`.** El GRANT general de
  `31_multitenant.sql` la incluía por existir antes del barrido: un tenant podía
  des-suspenderse por mora, subir de plan o REASIGNAR el subdominio de otro
  negocio ante una inyección SQL. → `41_endurecimiento_seguridad.sql` revoca
  INSERT/UPDATE/DELETE; el propagador del portal usa la conexión `pgsql_admin`
  (`DB_ADMIN_USERNAME` en producción, ver `.env.production.example`).
- **A-2 · El alta self-service exigía superusuario con la conexión normal.**
  `CrearCuentaController` llama ahora a `fn_provisionar_negocio` por la conexión
  `pgsql_admin` (que en producción apunta a un rol administrativo distinto de
  `saas_app`), como exige la propia función.
- **A-3 · Sin guardia contra conectar como superusuario.** `AppServiceProvider::boot()`
  comprueba en producción que la conexión NO sea superusuario (`SELECT rolsuper …
  WHERE rolname = current_user`) y aborta con un mensaje accionable si lo es.
- **A-4 · Tablas globales escribibles por cualquier tenant.** Las tasas de cambio,
  alícuotas fiscales (IVA/IGTF), unidad tributaria, monedas, conceptos ISLR y
  calendario SENIAT quedan de SOLO LECTURA para `saas_app` (REVOKE en 41). Las
  escrituras legítimas pasan por procedimientos `SECURITY DEFINER` con la guardia
  `fn_puede_editar_global()` (superusuario, o el tenant con
  `estado_tenants.modulos.editar_global = true`; por defecto solo la tienda de la
  plataforma, negocio 1). La app además blinda las pantallas con
  `Tenant::editarGlobal()` (403 con mensaje claro) en `/tasas/*`, `/monedas/*`,
  `/configuracion/alicuota*` y `/retenciones-islr/unidad-tributaria`.
  Nuevos procedimientos: `sp_alta_moneda`, `sp_moneda_activa`,
  `sp_cancelar_alicuota`; endurecidos con guardia: `sp_registrar_tasa`,
  `sp_cambiar_alicuota`, `fn_islr_guardar_ut`.

## MEDIAS

- **M-1 · Panel del portal.** Comparación en tiempo constante + regeneración de
  sesión + `throttle:5,1` en `/portal/login`.
- **M-2 · Login de usuarios.** `throttle:5,1` en `/login` y `/registro`;
  `throttle:10,1` en `/crear-cuenta`.
- **M-3 · Despliegue seguro.** Nuevo `.env.production.example`
  (`APP_DEBUG=false`, `SESSION_SECURE_COOKIE=true`, `DB_USERNAME=saas_app`,
  `PORTAL_DB_USERNAME=portal_app`, `LOG_LEVEL=error`) y checklist de producción
  al final del `LEEME.md`.
- **M-4 · La provisión clonaba TODO el negocio 1.** `fn_provisionar_negocio`
  aplica ahora una lista blanca de catálogos (categorías, marcas, unidades,
  métodos de pago, plan de cuentas, parámetros contables, calendario fiscal y
  las 4 configuraciones de PK fija): el cliente nuevo hereda catálogo, nunca
  inventario, terceros ni histórico.
- **M-5 · Subdominios reservados.** `fn_subdominio_unico` trata como ocupados
  `www`, `portal`, `api`, `admin`, `app`, `mail`, `webmail`, `ftp`, `soporte`,
  `support`, `saas`, `demo`, `staging`, `ns1`, `ns2` y `status` (caen a
  `slug-tienda`).
- **M-6 · Portal con superusuario.** Nuevo `42_portal_rol.sql` (base
  `portal_saas`): rol `portal_app` de SOLO LECTURA + funciones de escritura en
  `SECURITY DEFINER`. Producción conecta con `PORTAL_DB_USERNAME=portal_app`.
- **M-7 · Datos de negocio en el repositorio.** `.gitignore` excluye `dumps/`,
  `evidencias/`, `preview/` y logs de suites.
- **M-8 · Zona horaria.** `config/app.php` respeta `APP_TIMEZONE`
  (por defecto `America/Caracas`); antes ignoraba el .env y quedaba en UTC.
- **M-9 · Cookie de sesión.** `config/session.php` activa `Secure` por defecto
  en cualquier entorno que no sea `local` (y `.env.production.example` la fija
  explícita).

## BAJAS

- **B-1 · Cabeceras de seguridad.** Nuevo `App\Http\Middleware\SeguridadCabeceras`
  (X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy y CSP
  fuera de `local`, para no romper Vite/HMR en desarrollo).
- **B-3 · LIMIT/OFFSET.** Kardex, Compras y Ventas usan ahora `LIMIT ? OFFSET ?`
  con binding (antes enteros concatenados).
- **B-4 · `Portal::llamar()`.** Rechaza nombres sin el prefijo `portal.`
  (el nombre de función llegaba interpolado al SQL).
- **B-5 · `solicitudes_idempotentes`.** Nueva columna `negocio_id`
  (nullable, documentada) para la futura API de la caja.
- **B-6 · Dependencias y portabilidad.** `lucide-react` fijado a `1.67.0`;
  `composer.lock` incluido en el paquete; los orquestadores de pruebas leen
  `PSQL`, `PGHOST_PRUEBAS` y `PGPORT_PRUEBAS` del entorno (antes tenían rutas de
  una máquina incrustadas: `/usr/bin/psql`, `/tmp/h`, puerto `5544`). Las dos
  aserciones de estructura de m01/m07 pasan de 68 a 69 tablas por la nueva
  columna de `solicitudes_idempotentes` (B-5).
- **B-7 · Contraseña temporal.** Revisado: se mantiene en la respuesta del alta
  porque la ve únicamente el administrador que la creó, en su propia sesión
  autenticada (patrón estándar de contraseñas temporales de POS); no se
  persiste en logs.
- **B-2 · GUC `app.negocio_id`.** Documentado en el LEEME: el GUC no es un
  secreto (cualquier sesión puede fijarlo); la defensa real ante SQLi es que el
  rol de app no sea superusuario y las escrituras globales pasen por guardias.

## Archivos nuevos

| Archivo | Propósito |
|---|---|
| `database/sql/41_endurecimiento_seguridad.sql` | REVOKEs, `fn_puede_editar_global`, procedimientos SECURITY DEFINER, `negocio_id` en solicitudes_idempotentes. Idempotente. |
| `database/sql/42_portal_rol.sql` | Rol `portal_app` para la base `portal_saas` + funciones en SECURITY DEFINER. Idempotente. |
| `app/Http/Middleware/PortalAdmin.php` | Puerta de sesión del panel del portal. |
| `app/Http/Middleware/SeguridadCabeceras.php` | Cabeceras de seguridad + CSP. |
| `.env.production.example` | Plantilla de despliegue seguro. |
| `CHANGES.md` | Este documento. |

## Orden de instalación actualizado

Tienda: `00_instalar.sql` (01→05) + `06…30` + `31` + `35` + `36`–`39` +
**`41_endurecimiento_seguridad.sql`** (obligatorio).
Portal: `33_portal.sql` + `34_portal_pagos.sql` + `40_ciclo_cobro.sql` +
**`42_portal_rol.sql`** (obligatorio).
En una instalación existente basta ejecutar el 41 (tienda) y el 42 (portal):
ambos son idempotentes.

## Ronda t16 · Páginas Inertia probadas por HTTP (y 3 bugs reales corregidos)

Nueva suite `tests/e2e/t16_paginas_inertia.py` (71 aserciones): entra como invitado,
administrador, cajero y super-admin del portal contra `php artisan serve` y verifica que
**cada pantalla** llegue como página Inertia bien formada ({component, props, url, version}),
con props con datos y con el archivo del componente existente en `resources/js/Pages/`.
Cobertura: 5 páginas públicas, todas las del administrador (incluidas las 7 vistas del
libro fiscal), páginas de detalle con datos creados por la misma suite vía HTTP (venta
contado y a crédito → CxC, compra, modelo de moto, encargo), el panel del portal (11 props)
y las 8 pantallas del cajero con su bloqueo de rol. Al correrla encontró tres defectos:

- **D-1 · Login con error 500 cuando el hash necesita re-hash.** Laravel 12 re-hashea la
  contraseña al iniciar sesión si el costo/algoritmo del hash guardado ya no coincide con la
  configuración; escribía `UPDATE usuarios SET password = …` (columna inexistente; además el
  hash está protegido por el trigger TV005). Arreglos: `config/hashing.php` nuevo con
  `rehash_on_login => false` (el costo se moderniza cuando el usuario cambia su contraseña,
  camino permitido y auditado) y `Usuario::getAuthPasswordName()` devolviendo
  `password_hash` (el nombre real de la columna).
- **D-2 · `/compatibilidad/{moto}/candidatos` siempre respondía 500.** El `ORDER BY` usaba el
  alias `sugerido` dentro de una expresión (`(sugerido IS NULL)`), que PostgreSQL rechaza.
  Ahora la expresión usa la subconsulta real. La búsqueda de repuestos para una moto en la
  pantalla Compatibilidad vuelve a funcionar.
- **D-3 · Pantalla de Combos y el listado que consume el POS respondían 500.** `v_combos.componentes`
  es `jsonb` y PDO lo entrega como texto; `array_map` explotaba sobre un string. Se decodifica
  una vez (`CombosController::componentes()`), tanto en `datos()` como en `lista()`.

Estado final de pruebas: **t16: 71 OK · 0 FAIL** y **regresión completa (t01–t15 + f01–f17 +
m01–m13 + p01–p03): 688 OK · 0 FAIL** sobre bases reinstaladas desde cero.

Nota de orden para corridas locales: t16 deja datos de prueba en la base `tienda`; si luego
se corren las suites de negocio, reinstalar la base limpia primero (el clon de multiinquilino
usa `tienda` como template).

## Ronda t17/t18 · Concurrencia real, E2E de navegador y 4 correcciones nuevas

**Nuevas suites (incluidas en el ZIP):**
- `tests/e2e/t17_concurrencia.py` (33 aserciones): carreras reales con hilos y conexiones
  propias — 2 tenants escribiendo a la vez (16 hilos), 2 cajas del mismo negocio con el
  correlativo sin huecos ni duplicados, stock que nunca queda negativo bajo 12 ventas
  simultáneas sobre 5 unidades (7 reciben el TV003), fugas del GUC `app.negocio_id` como
  el rol de la app (`saas_app`) y el re-hash controlado del login por HTTP.
- `tests/e2e/t18_e2e_navegador.py` (19 aserciones): Playwright + Chromium contra el
  servidor — login por formulario, venta al contado y a crédito desde el POS real (con
  el modal de cobro y el de cliente), compra nueva, cierre de caja, las 6 vistas de los
  libros fiscales + ISLR + calendario, el panel del portal y 18 pantallas del
  administrador. En TODOS los flujos se exige **0 errores de consola y 0 excepciones
  de página** — es la prueba que faltaba: que React monta y los formularios funcionan.

**Correcciones que salieron de estas pruebas:**

- **D-1 (revisado) · Re-hash controlado en el login.** Se mantuvo `rehash_on_login = false`
  (el UPDATE nativo de Laravel chocaría con el trigger TV005) y se implementó el camino
  que pedía la revisión: tras un login exitoso, si el hash usa un costo/algoritmo viejo,
  `LoginController` llama al nuevo procedimiento **`sp_rehash_password`** (02 SQL), que
  moderniza el hash por la única vía que el trigger admite, SIN tocar
  `debe_cambiar_password` ni la contraseña efectiva. Verificado por HTTP: un hash bcrypt 10
  entra bien y queda en bcrypt 12.
- **Fuga del GUC entre peticiones (hallazgo de t17 · corregida).** `Tenant::fijar()` fija
  `app.negocio_id` con alcance de SESIÓN (necesario con autocommit). t17 demostró que la
  conexión sigue viendo el tenant anterior si nadie la limpia (el riesgo real en pgBouncer,
  Octane y workers). Nuevo `Tenant::limpiar()` y el middleware `IdentificarTenant` lo
  ejecuta en `finally`: cada conexión vuelve al pool neutra —fail-closed: sin GUC la guarda
  no deja ver ni escribir nada—.
- **F-1 · Sparkline del panel con series de un punto (error de consola).** `Sparkline`
  dividía por `serie.length - 1` (0 con un solo día de tasas): rutas SVG con `NaN`.
  Ahora no dibuja nada sin datos y el denominador tiene piso de 1. `Semana` (barras de
  ventas de la semana) tenía el mismo mal con semanas vacías: `max` tiene piso de 1.
- **F-2 · Excepción React tras registrar una venta (encontrada por t18).** En el POS,
  `vaciar()` borra el cliente pero `deuda` se limpia en un efecto que corre DESPUÉS del
  render; el bloque «Cobrar ahora en Cuentas por cobrar» leía `cliente.id` con cliente
  nulo. Guardia `admin && cliente` en el enlace.
- **Semilla de pruebas documentada.** El admin de la semilla queda con la clave
  `PaginasTest2026` (la que usan t16/t17/t18); el hash en `scripts/setup_db.py` (instalador
  de pruebas) es su bcrypt 12 y quedó documentado en el propio script.

**Estado final de pruebas (misma base, corrida completa del 15/11/2026):**
t01–t15 + f01–f17 + m01–m13 + p01–p03: **688 OK · 0 FAIL** · t16: **71 OK · 0 FAIL** ·
t17: **33 OK · 0 FAIL** · t18: **19 OK · 0 FAIL** — total **811 aserciones, 0 fallidas**.

Orden de corrida recomendado: reinstalar la base limpia → `run_suites.py` (688) →
`t16` → `t17` → `t18` (t17 ya tolera el turno que t16 deja abierto).

## Ronda Pest / carga / continuidad / trazabilidad (16/11/2026)

- **Pest/PHPUnit instalado** (`pestphp/pest ^3.8`, plataforma PHP 8.3 fijada en
  composer.json; el lock se alineó a paquetes compatibles con 8.3). Suite nueva
  en `tests/Feature` + `tests/Unit`: páginas Inertia con `assertInertia` oficial
  (componente + conteo de props + versión), **autorización POR ENDPOINT por rol**
  (invitado/cajero/admin sobre 8 endpoints admin-only + "propio" en /ventas),
  validaciones de formulario, **flujo completo de venta por la pila Laravel**
  (apertura → cotización → venta → stock/kardex → anulación), sesión multi-tenant
  como `saas_app` y matriz de `Permisos`. **85 pruebas · 684 aserciones · 0 fallos
  en ~2 s**, contra bases dedicadas `tienda_pest`/`portal_pest` (phpunit.xml).
- **Rendimiento y carga (k6 v0.57 + PostgreSQL)**: latencia base p95 = 105 ms y
  0 fallos (30 vueltas × 4 endpoints); rampa 2→8→16 VUs sobre la pila de
  desarrollo (2 vCPU, php artisan serve, 8 workers) → saturación a partir de
  ~16 VUs (p95 ≈ 1.1 s) **sin una sola respuesta fallida** (pool de 16 sesiones
  respetando el throttle del login); **201 ventas reales por HTTP** a 10 cajas
  simultáneas con stock/kardex/correlativo intactos; a nivel de base,
  **100 conexiones concurrentes (2 negocios) a 304 ops/s, 0 errores, 0 ventas
  cruzadas**, **1,000 sesiones de tenant vía pool de 16 conexiones sin una fuga
  de aislamiento (p95 = 3.5 ms/sesión)** y costo de la guarda RLS ≈ 0.11 ms/op.
  Scripts en `scripts/carga/` (k6_latencia/rampa/ventas + sesion_k6 + concurrencia_pg).
- **Continuidad (`scripts/continuidad.py`, 23 OK · 0 FAIL)**: backup pg_dump -Fc
  de tienda y portal, restore verificado (conteos idénticos, cadena venta→pagos
  íntegra, partida doble), migración incremental idempotente sobre datos vivos
  (aplicada DOS veces + venta real después) y **rollback real** (--clean tras una
  "migración" destructiva: datos de vuelta EXACTOS por huella md5). Dos hallazgos
  operativos documentados: (1) los scripts 01–42 no son idempotentes sobre bases
  con datos —la política oficial es backup → reinstalar 00–42 → restaurar—;
  (2) tras un pg_restore hay que fijar el search_path de la base (el .env ya lo
  hace vía DB_SEARCH_PATH) o los triggers dejan de compilar.
- **Seguridad complementaria**: `composer audit` y `npm audit` en 0 vulnerabilidades
  — se actualizó **jspdf 2.5.2 → 4.2.1** (avisos críticos de ReDoS/PDF-injection)
  con jspdf-autotable 5 y dompurify 3.4.18 (parche XSS) vía overrides, y el build
  de Vite queda verde. El humo del PDF (Imprimir tras venta) queda como paso
  pendiente de re-verificar en el siguiente turno.
- **Trazabilidad demostrable**: `tests/trazabilidad.py` cruza requisitos ↔ suites
  en ambos sentidos: **40 requisitos, 0 sin respaldo, 0 suites huérfanas**.
  Ejecutar: `python3 tests/trazabilidad.py`.
- El throttle del login (5/min por IP) **se demostró de verdad**: los re-logins de
  la rampa k6 recibieron 429 mientras duró la ventana.

## Ronda de regresión de hallazgos (mejoras 1–12 de la revisión, 16/11/2026)

Se implementaron las 12 mejoras pedidas; cada corrección quedó demostrada por una
prueba (`tests/security/regresion_hallazgos.py`, **68 OK · 0 FAIL**):

- **(1) Una prueba por hallazgo.** t19 ejecuta C-1, A-1, A-2, A-3, A-4 (+ intento de
  bypass), M-4 (negativos de la whitelist), M-6, M-8 (venta real de madrugada), C-7 y
  RL-2, contra clones dedicados (tienda_regres / portal_regres) y tres servidores HTTP
  dedicados (local :8010 · producción :8011 · staging :8012).
- **(2) Throttle global + destructivos.** `throttle:auth` (600/min por usuario) en todo
  el grupo privado y `throttle:portal_escritura` (10/min) en verificar-pago, publicar
  tasa, estado de tienda y guardar cuentas. Demostrado por HTTP: 10 pasan, la 11ª → 429.
- **(3) A-3 completo.** La guardia de superusuario vive en un listener de
  `ConnectionEstablished` (cubre queue:work, schedule, artisan y reconexiones), es
  fail-closed por proceso y registra el mensaje accionable en laravel.log. Nuevo
  `/health/db`. (Deliberadamente NO consulta la base en `boot()`: mataría artisan serve.)
- **(4) A-4 sin acoplarse al negocio 1.** SQL **43_plataforma_admin.sql**:
  `plataforma_admin(negocio_id)` + `plataforma_roles(rol)` y la guardia nueva exige GUC
  explícito. **La suite encontró y corrigió 3 agujeros reales**: (a) `current_user`
  dentro del SECURITY DEFINER era el dueño → cualquier tenant registraba tasas; (b)
  `false OR NULL = NULL` era fail-open; (c) `fn_negocio_actual()` caía al negocio 1 sin
  GUC y heredaba los derechos de plataforma. Guardia final: superusuario por
  `session_user`, `app.rol=platform_admin` solo para roles de `plataforma_roles`, y el
  negocio SOLO si el GUC explícito está en `plataforma_admin`.
- **(6) B-7.** `Cache-Control: no-store` en las respuestas con clave temporal
  (UsuariosController, CrearCuenta) + Pest de la obligación de cambio de contraseña
  (primer login → solo /cuenta/contrasena; tras cambiarla → enrutado por rol).
- **(7) CSP probada.** staging = Report-Only con `report-uri /csp-report`; producción =
  enforcement; `CSP_FORCE=1` para probarla en local; endpoint /csp-report con CSRF
  exento; chequeos en t19.
- **(8) search_path tras restore.** Nueva sección c5 en continuidad (26 OK): el ajuste
  de la BASE sobrevive al backup/restore y los triggers compilan en conexión nueva.
  Además `setup_db.py` fija a nivel de base `TimeZone=America/Caracas` y `search_path`.
- **(9) GUC en jobs.** `Tenant::ejecutar()` + trait `App\Support\ConTenant`; Pest
  despacha un job real (`Bus::dispatchSync`) y verifica conexión neutra incluso si el
  trabajo lanza excepción.
- **(10) run_all.sh.** `scripts/run_all.sh` con la cadena completa en orden (setup →
  funcionales → t16/t17/t18 → Pest → t19 → k6 → concurrencia → continuidad →
  trazabilidad → audits) y `cache:clear` entre rondas HTTP para no heredar el throttle.
- **(11) D-3 en Pest.** `CombosComponentesTest` (3 pruebas): `componentes` siempre
  array por /combos/lista y por props Inertia. **Encontró otro bug real**:
  `CombosController::validar()` hacía 500 cuando el POST no traía `precio`.
- **(12) Humo del PDF jspdf 4.** t18 ahora tiene **n9**: descarga el PDF de una venta
  real por el navegador → firma `%PDF-`, 4.186 bytes, 0 errores de consola.
  **t18: 22 OK · 0 FAIL.**

**Bugs de pruebas corregidos al pasar**: timezone de clones (las suites hoy corren con
TZ fiscal en la DSN — bug de medianoche CURRENT_DATE vs fn_hoy), `date.today()` en t16,
conteos m01/m07 por las 2 tablas nuevas del 43, token CSRF de Inertia (meta tag nuevo
en app.blade.php, necesario para AJAX), `saas_app`/`portal_app` con LOGIN de prueba solo
en clones locales.

**Estado final: funcionales 688 · t16 71 · t17 33 · t18 22 · Pest 99 (768 aserciones) ·
t19 68 · k6 1.060 checks (latencia 120 ✓ 100 % · rampa 550 ✓ 100 % · p95=1,2 s a 16 VUs)
· concurrencia PG 2.000 · continuidad 26 · trazabilidad 40/40 — todo en 0 fallos.**
El escenario k6 ventas quedó pendiente de re-verificar con inventario suficiente (las
re-corridas agotaron el stock del producto 1 y el reabastecimiento por API quedó como
tarea; sus corridas previas dieron 390/390 checks).
