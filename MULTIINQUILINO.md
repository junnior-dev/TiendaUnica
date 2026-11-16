# Multiinquilino (SaaS) — una base de datos, un negocio_id por fila

**Decisión (2026-11-13):** el sistema pasa de tienda única a plataforma multi-negocio
**sin bases de datos separadas**: una sola base (`tienda`), un solo esquema, y cada fila
de negocio lleva `negocio_id`. Verificado con las tres suites en verde sobre la plantilla
reconstruida: **439 (operativas + fiscales) + 94 (multiinquilino m01–m09) + 17 (portal
p01) = 550 OK · 0 FAIL**.

## Cómo funciona

1. **Sesión**: la app declara su negocio al abrir cada petición:
   `SET app.negocio_id = '<id>';` — el middleware Laravel lo hace vía
   `SELECT set_config('app.negocio_id', …, false)`. Sin GUC, `fn_negocio_actual()`
   devuelve 1 (compatibilidad con la versión de tienda única y las pruebas, que corren
   como superusuario). Para roles de app, la guarda `fn_sesion_permitida()` **exige** el
   GUC: sin él la sesión no ve ni escribe nada — no cae por defecto al negocio 1.
2. **Sello**: las 63 tablas de negocio (más las 4 de ISLR anual de `36_islr_declaracion.sql`, que repite el mismo patrón: 67) llevan `negocio_id NOT NULL REFERENCES negocio(id)`
   e índice propio; el trigger `trg_sello_negocio` completa el INSERT que llega sin él.
3. **RLS + FORCE + guarda**: las 64 políticas (63 tablas + `negocio`) son
   `USING (negocio_id = fn_negocio_actual() AND (SELECT fn_sesion_permitida()))` con el
   mismo WITH CHECK. Las 33 vistas son `security_invoker` para respetar el RLS del
   invocador. El superusuario (instalación, portal, pruebas) no evalúa políticas.
4. **Unicidad por negocio**: RIF de cliente, SKU/código de barras, número de factura,
   plan de cuentas, calendario, retenciones… únicos DENTRO de cada negocio
   (`uq_neg_*`). Las PKs compuestas de catálogos (`unidades_medida`, `contab_parametros`,
   `contab_metodo_cuenta`, `calendario_fiscal`, `calendario_presentada`) ahora incluyen
   `negocio_id`; las «hijo de padre» (venta_id, combo_id…) quedan globales. Las 4 config
   de PK fija (`numeracion_fiscal`, `caja_config`, `contab_config`, `islr_config`)
   perdieron su `CHECK (id = 1)` y cada negocio lleva su fila con `id = id del negocio`.
5. **Funciones por negocio**: los singletons «WHERE id = 1» de `negocio`,
   `caja_config`, `contab_config`, `islr_config` y `numeracion_fiscal` pasaron a
   `WHERE id = fn_negocio_actual()` (44 puntos en 02–25). `fn_negocio_actual()` se
   define de forma temprana al inicio de 02 para poder instalar 00→30 sin 31 (31 la
   vuelve a crear idéntica). Las funciones del calendario fiscal
   (`fn_calendario_guardar`, `fn_marcar_presentada`) escriben con `negocio_id` explícito.
   `fn_registrar_venta` se consolidó en UNA firma de 8 argumentos (02 tenía una de 6
   que provocaba ambigüedad de overload con las extensiones de 15/16/24).
6. **Globales** (sin negocio_id): `negocio` (registro de tenants), `monedas`,
   `tasas_cambio`, `log_tasas_cambio`, `islr_conceptos`, `islr_ut`,
   `parametros_fiscales` (las alícuotas las fija el Ejecutivo Nacional),
   `calendario_obligaciones`, `solicitudes_idempotentes`.

## estado_tenants: control del portal dentro de la BD del tenant

Global y sin RLS (solo el portal escribe): **subdominio** único (el middleware lo
resuelve), **activo** (suspensión por mora que RLS hace cumplir), **plan** y
**modulos** (verticales, los lee `fn_negocio_modulo()` y `Tenant::modulo()`).
`fn_subdominio_unico()` genera el slug libre. Efectos probados (m08):
sesión de app sin GUC → 0 filas y escritura rechazada; portal
`UPDATE estado_tenants SET activo=false` → la tienda queda sin lectura ni escritura
mientras los demás negocios siguen operando; reactivar restaura todo.

## Portabilidad completa: exportar y restaurar

- **`fn_exportar_negocio([p_negocio_id])`** — JSONB con TODAS las filas del negocio
  (63 tablas + la fila del negocio, `formato: v1`). La app solo exporta SU negocio
  (TV006 si pide otro); el portal, cualquiera. `estado_tenants` no sale en el paquete.
- **`fn_importar_negocio(p_paquete)`** (solo portal) — restaura el paquete como negocio
  NUEVO con ids remapeados: carga en `session_replication_role = replica` (sin disparar
  kardex/saldos/sellos), negocio→usuarios primero (el ciclo `configurado_por` se rompe
  con UPDATE), orden topológico de FK leído de `pg_constraint`, autoreferencias de
  `plan_cuentas.cuenta_padre_id` en un segundo pase acotado al negocio, PKs fijas con
  `id = negocio nuevo` y secuencias re-calibradas. El restaurado nace con su fila de
  `estado_tenants` y vive aislado (m09 lo prueba).

## Portal central: 33_portal.sql (base `portal_saas`)

UNA base para toda la plataforma, fuera de las BD de tenants: `planes` (BASE/PRACTICA/
PRO con precios, topes y verticales), `negocios_portal` (subdominio único,
host/bd/negocio_id, estado PRUEBA→ACTIVO→MORA→SUSPENDIDO→CANCELADO, `vence_el`),
`cobros` (UNIQUE por periodo), `eventos_portal` (bitácora). Funciones:
`fn_alta_tenant` (prueba 15 días), `fn_registrar_cobro` (activa y extiende al fin de
mes), `fn_verificar_vencimientos` (barrido diario → MORA), `fn_suspender`/
`fn_reactivar`. Vistas `v_cartera` y `v_mrr`. El **propagador** aplica el veredicto a
cada tenant con el `UPDATE estado_tenants` de arriba (m08 prueba ese lado).

## Laravel: implementado

- `app/Http/Middleware/IdentificarTenant.php` — prepend del grupo `web` en
  `bootstrap/app.php`: subdominio → tienda (404 si no está registrada, 403 si está
  suspendida), fija el GUC antes de tocar datos; `/up` no pasa por tenants.
- `app/Support/Tenant.php` — `resolver()/fijar()/id()/estado()/modulo()`: el SQL de la
  app NO filtra por negocio a mano.
- Conexión: `DB_USERNAME=saas_app` (nunca postgres) + `SAAS_BASE_DOMAIN` en
  `.env.example`. Alta del rol de conexión: `ALTER ROLE saas_app LOGIN PASSWORD '<secreto>';`
- Pendiente operativo (no de diseño): cron propagador portal→tenants y topes de plan.

## Archivos

| Archivo | Rol |
|---|---|
| `database/sql/31_multitenant.sql` | La migración (idempotente): sesión, `estado_tenants`, guardas, negocio_id, PKs, unicidades, RLS, vistas, rol `saas_app`, sellos, export/import |
| `database/sql/02…25` (editados) | Funciones por negocio (`fn_negocio_actual()`), fuentes idempotentes, `fn_negocio_actual` temprana en 02, venta consolidada |
| `database/sql/21/22` (editados) | Calendario fiscal por negocio |
| `database/sql/36_islr_declaracion.sql` | ISLR anual por negocio (anticipos, retenciones sufridas, tramos, borrador): negocio_id + RLS + sello; va después de 31 |
| `database/sql/33_portal.sql` | El portal central (`portal_saas`) |
| `app/Support/Tenant.php` · `app/Http/Middleware/IdentificarTenant.php` · `config/saas.php` | Capa Laravel |
| `tests/multiinquilino/` | Suite m01–m09 + `run_multi.py` (clon `tienda_multi` + negocio 2 «Bodega La Esquina»); corre como `saas_app` |
| `tests/portal/` | Suite p01 + `run_portal.py` (recrea `portal_saas` desde 33) |
| `scripts/multitenant/reinstalar_completo.sh` | Reconstruye TODO desde cero: cluster PG17 + tienda (00→31) + asistente + datos demo + portal |

## Orden de aplicación

**Instalación fresca:** `createdb tienda` → `psql -d tienda -f 00_instalar.sql`
(01→05) → archivos `06…30` → `31_multitenant.sql` → asistente de primer inicio
(`sp_guardar_configuracion_negocio` + `sp_confirmar_configuracion_inicial` + tasas del
día). Portal aparte: `createdb portal_saas` + `psql -d portal_saas -f 33_portal.sql`.
**O más fácil:** `bash scripts/multitenant/reinstalar_completo.sh` (lo hace todo).
**Base ya instalada:** re-ejecutar los archivos tocados (todos son idempotentes) y
`31_multitenant.sql` al final (restaura el `security_invoker` de las vistas).

## Cobertura honesta

- El RLS protege a roles NO superusuario: producción debe conectar como `saas_app`.
- El restore/import es una operación del portal (superusuario); verifica conteos y
  FKs en m09 pero NO recalcula saldos históricos (la carga es en modo `replica`).
- Las colas/comandos artisan deben llamar `Tenant::fijar($id)` por proceso.
- Los reportes agregados ENTRE negocios (ETL al portal) siguen como fase posterior.

## Ajustes de la ronda "profesional"

- **37_libro_ventas_negocio.sql**: `v_libro_ventas` expone la columna `id_negocio` (security_invoker). NO se llama `negocio_id` a propósito: `fn_exportar_negocio` / `fn_importar_negocio` descubren tablas por ese nombre de columna y una vista con él rompería la importación.
- **Módulo fiscal por plan**: el middleware `ModuloFiscal` (registrado en el grupo `auth` de `routes/web.php`) protege libros-fiscales, retenciones-islr, calendario-fiscal, declaracion-islr y contabilidad. Sin el módulo: 403 JSON (no-GET) o pantalla `Suscripcion/PlanRequerido`.
- **Semilla de 31**: los negocios preexistentes quedan con `modulos = {"fiscal": true}`. Solo afecta instalaciones nuevas. En una BD ya instalada:
  `UPDATE tienda.estado_tenants SET modulos = modulos || '{"fiscal":true}' WHERE negocio_id = 1;`
- **Orden de instalación**: ... 35 → 36 → 37 (ya incluido en `scripts/multitenant/reinstalar_completo.sh`).
- Los scripts de `tests/` mantienen rutas de PostgreSQL 17 y puerto por defecto: ajústalos a tu entorno local.
- **38_presentaciones_venta.sql**: tabla `producto_presentaciones` (RLS FORCE, sello, único por negocio). **39_islr_asientos.sql**: cuentas 1.1.08, 1.1.09, 2.1.06, 5.3.01 y sus 4 parámetros por negocio. Total: 68 tablas con `negocio_id`. Orden: … 35 → 36 → 37 → 38 → 39.
- La prueba m_lib de provisión (negocio 2) ahora re-apunta `contab_parametros` y `contab_metodo_cuenta` a las cuentas propias del negocio 2 (antes las copiaba con los ids del negocio 1; la provisión real por importación sí los remapea).

## Planes y módulos
El plan solo decide qué se muestra: `estado_tenants.modulos` (clave `fiscal`) gobierna menú, panel y `ModuloFiscal`. Los datos fiscales y los asientos se guardan siempre, para que subir de plan no obligue a regenerar nada (`m13_plan_basico.py`). Ningún controlador debe fijar `negocio id = 1`: usa `fn_negocio_actual()` o `Tenant::id()`.
