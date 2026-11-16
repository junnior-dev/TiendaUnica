# Cómo ver el preview y probar el sistema (guía para levantar el entorno)

Hay **tres cosas distintas**. No las mezcles, porque cada una necesita herramientas diferentes:

| # | Qué es | Necesita | Para qué sirve |
|---|--------|----------|----------------|
| A | **Preview de pantallas** (`preview/server.mjs`) | Solo Node | Ver y capturar las pantallas con datos de muestra. **No usa PHP ni PostgreSQL.** |
| B | **Base de datos de pruebas** (PostgreSQL) | PostgreSQL 16 | Instalar los SQL 00–21 y probar triggers, asientos, IGTF, cuentas por cobrar. |
| C | **Sistema real** (Laravel 12 + PostgreSQL + Vite) | PHP, Composer, Node, PostgreSQL | Usar el sistema de verdad. |

> Honestidad: en el entorno donde se desarrolló **no se pudo instalar Laravel** (sin acceso a Packagist). Por eso las pantallas se
> verificaron con el preview (A) y la lógica con PostgreSQL real (B) más un arnés de PHP con piezas de Laravel simuladas. El flujo
> completo con Laravel real (C) hay que probarlo en tu máquina siguiendo el LEEME.

---

## A. Preview de pantallas (solo Node, sin PHP ni base de datos)

`preview/server.mjs` levanta Vite y responde las páginas Inertia y las llamadas `fetch` con datos falsos (`preview/*-fixtures.mjs`).
Sirve para revisar el diseño, no para probar reglas de negocio.

```bash
# 1. Requisitos: Node 20 o superior
node -v

# 2. Dentro de la carpeta del proyecto (la que tiene package.json)
npm install

# 3. Levantar el preview (puerto 5199)
node preview/server.mjs
```

Abre en el navegador:

- http://localhost:5199/caja — Punto de venta (con turno abierto, crédito, Corte X y Cerrar caja Z)
- http://localhost:5199/cuentas-por-cobrar
- http://localhost:5199/movimientos-caja
- http://localhost:5199/metodos-pago
- http://localhost:5199/reportes
- http://localhost:5199/ventas, `/clientes`, `/productos`, `/compras`, `/contabilidad`, `/libros-fiscales`, `/retenciones-islr`, `/calendario-fiscal`, `/usuarios`, etc.

Detalles útiles:

- Para reiniciar el servidor: detén el proceso (Ctrl+C) y vuelve a ejecutar `node preview/server.mjs`.
- Si el puerto está ocupado: `pgrep -f "preview/server.mjs"` y `kill <pid>`.
- Si falla un `import`, casi siempre falta `npm install`.
- Las pantallas guardan en memoria: al reiniciar el servidor, los datos de muestra vuelven al inicio.
- Si cambias un `.jsx`, Vite lo recarga solo. Si cambias un `*-fixtures.mjs`, reinicia el servidor.

### Capturas de pantalla automáticas (opcional)

Se usó Playwright (Chromium). Ejemplo mínimo, guardado como `captura.mjs`:

```js
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
p.on('pageerror', (e) => console.log('ERROR', e.message));
await p.goto('http://localhost:5199/metodos-pago');
await p.waitForTimeout(900);
await p.screenshot({ path: 'metodos-pago.png', fullPage: true });
await b.close();
```

```bash
npm i -D playwright && npx playwright install chromium
node captura.mjs
```

Para abrir modales: `await p.getByRole('button', { name: 'Nuevo método' }).first().click();` antes de la captura.
Para descargar un PDF (ticket, reportes): `const d = p.waitForEvent('download'); await p.evaluate(() => { window.open = () => null; }); await p.getByRole('button', { name: 'Imprimir ticket' }).click(); (await d).saveAs('ticket.pdf');`
y luego `pdftoppm -r 70 -png ticket.pdf ticket` para verlo como imagen.

---

## B. PostgreSQL de pruebas

### B.1 Instalación

- **Windows:** instalador de https://www.postgresql.org/download/windows/ (versión 16). Anota la clave del usuario `postgres`.
- **Ubuntu/Debian:** `sudo apt install postgresql-16`.
- **macOS:** `brew install postgresql@16`.

### B.2 Crear la base e instalar los scripts, en orden

Desde la carpeta `database/sql` (cambia `-U postgres` si usas otro usuario; en Windows usa `psql` desde "SQL Shell" o el PATH):

```bash
createdb -U postgres tienda
psql -U postgres -d tienda -v ON_ERROR_STOP=1 -f 00_instalar.sql        # ejecuta 01 al 05
for f in 06_busqueda_sin_tildes 07_cierres_caja 08_retenciones_iva 09_numeracion_fiscal 10_contabilidad \
         11_cierre_y_pagos 12_devolucion_notas 13_conciliaciones 14_aperturas_caja 15_cuentas_por_cobrar \
         16_correcciones_control 17_metodos_pago 18_devolucion_en_caja 19_regimen_y_apertura 20_retenciones_islr 21_calendario_fiscal 22_calendario_parametrizable; do
  echo "== $f"; psql -U postgres -d tienda -v ON_ERROR_STOP=1 -f $f.sql || break
done
```

Todos son idempotentes: si se corta a la mitad, corrige el error y vuelve a ejecutar ese archivo.
Si quieres asientos automáticos: `UPDATE tienda.contab_config SET automatica = true;`

### B.3 Cluster temporal de pruebas (como se hizo en el entorno de desarrollo)

Útil cuando **no quieres tocar tu PostgreSQL real** o cuando trabajas como `root` en un contenedor
(PostgreSQL se niega a correr como root: hay que usar el usuario `postgres`).

```bash
# Crear un cluster en /tmp/pgd, puerto 5544, socket en /tmp
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/pgd -A trust -U postgres"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgd -o '-p 5544 -k /tmp' -l /tmp/pg.log start"

# Comprobar y conectar
pg_isready -h /tmp -p 5544
psql -h /tmp -p 5544 -U postgres -c "select version()"

# Base nueva con todos los scripts
psql -h /tmp -p 5544 -U postgres -c "create database tienda_t"
cd database/sql && psql -h /tmp -p 5544 -U postgres -d tienda_t -v ON_ERROR_STOP=1 -f 00_instalar.sql
# ...y luego los demás scripts como en B.2 (con -h /tmp -p 5544)

# Copia rápida para probar sin ensuciar la base buena (se repite cuantas veces quieras)
psql -h /tmp -p 5544 -U postgres -c "drop database if exists tienda_prueba" -c "create database tienda_prueba template tienda_t"
```

Si el servidor se cae (pasa en contenedores): vuelve a ejecutar el `pg_ctl ... start` y revisa `/tmp/pg.log`.

### B.4 Probar a mano un flujo (ejemplo: venta a crédito → cobro con IGTF)

```sql
SET search_path = tienda, public;
SELECT fn_abrir_caja(2, 50, 500);                                   -- usuario 2 abre turno con fondo 50 USD y 500 Bs
SELECT fn_registrar_venta(2, '[{"producto_id":2,"cantidad":2}]', '[]', 3, NULL, 'PRESENCIAL', true);   -- venta a crédito, cliente 3
SELECT * FROM v_cuentas_por_cobrar;                                 -- la cuenta aparece con su saldo
SELECT fn_registrar_pago_cobrar(1, fn_hoy(), NULL, 4, 'ZEL123', 2, 2);   -- cobro de 4 USD por Zelle (método 2) → IGTF 3 % = 0,12
SELECT fn_comprobante_cobro(1);                                     -- datos del recibo con el IGTF desglosado
SELECT * FROM v_igtf_a_declarar;                                    -- el IGTF entra a lo que se declara
```

Para ver que la contabilidad cuadra:

```sql
SELECT bool_and(total_debe = total_haber) FROM asientos;            -- debe dar true
SELECT sum(d.debe - d.haber) FROM asiento_detalle d JOIN plan_cuentas p ON p.id = d.cuenta_id WHERE p.codigo = '1.1.06';
SELECT sum(saldo_ves) FROM cuentas_por_cobrar WHERE estado = 'PENDIENTE';   -- ambas cifras deben ser iguales
```

(Los ids de usuario, cliente, producto y método dependen de tus datos: ajústalos.)

---

## C. Sistema real (Laravel 12 + Inertia + React)

Es lo que está en el `LEEME.md`, resumido:

```bash
# Requisitos: PHP 8.2+ con la extensión pdo_pgsql, Composer, Node 20+, PostgreSQL 16 con los scripts de la parte B
php -m | grep -i pdo_pgsql          # debe aparecer pdo_pgsql (en Windows: habilítala en php.ini: extension=pdo_pgsql)

composer install
# El proyecto trae .env: edita DB_DATABASE, DB_USERNAME, DB_PASSWORD (y DB_PORT si no es 5432)
php artisan key:generate
npm install
npm run build                       # o "npm run dev" en otra terminal para desarrollar con recarga en vivo
php artisan serve                   # http://localhost:8000
```

- La primera vez abre http://localhost:8000/registro: crea al administrador.
- El administrador del seed trae la clave `PENDIENTE`; créale clave con `sp_cambiar_password` (ver LEEME, punto 25).
- Si algo falla con "could not find driver": falta `pdo_pgsql` en PHP.
- Si ves la pantalla en blanco: ejecuta `npm run build` (o deja corriendo `npm run dev`).
- Si un cambio de SQL no se refleja: confirma que ejecutaste el script en **la misma base** que usa tu `.env`.
- Orden de instalación y qué agrega cada script: LEEME, punto 2 y puntos 26 al 34.

### Prueba de humo sugerida en el sistema real

1. Entra como administrador → **Finanzas → Métodos de pago**: revisa que "Efectivo" esté marcado como efectivo y Zelle/Efectivo USD con IGTF.
2. **Punto de venta** → abre caja (fondo USD y Bs) → vende a crédito a un cliente (activa "Venta a crédito").
3. **Cuentas por cobrar** → registra un cobro por Zelle → imprime el comprobante.
4. **Corte X** y **Cerrar caja (Z)**: el efectivo esperado debe coincidir con lo que contaste.
5. Entra como cajero: debe ver Cuentas por cobrar y cobrar, pero no poder anular un cobro ni abrir Métodos de pago.
6. **Libros fiscales → IGTF**: debe aparecer el IGTF del cobro.

Lo fiscal y lo contable (IGTF, comprobante, plan de cuentas): confírmalo con tu contador.

## Pantallas del SaaS (rediseño)
`node preview/saas.mjs` (puerto 5200) sirve sin PHP: /login, /crear-cuenta, /precios, /suscripcion?estado=PRUEBA|ACTIVO|MORA|SUSPENDIDO, /plan-requerido, /cuenta/contrasena?obligatorio=1, /portal/login, /portal.
Componentes nuevos compartidos: `resources/js/Components/saas.jsx` (Dias, Estado, Aviso). Solo cambió la parte visual; no se tocó ninguna ruta, controlador ni SQL.

## Presentaciones de venta (POS)
`preview/capturas/pos-presentaciones-1-selector.png` (selector «Unidad / Caja × 10») y `pos-presentaciones-2-venta.png` (una caja y una pieza en la misma venta). Pruebas de base de datos: `tests/multiinquilino/m11_presentaciones.py` (caja, docena, pieza, stock en piezas, IVA, descuento, aislamiento) y `m12_islr_asientos.py` (asientos del ISLR).

## Plan básico vs completo
`node preview/plan-capturas.mjs` (con `node preview/server.mjs` corriendo) captura el panel en los dos planes; la vista previa cambia de plan con `/__plan?valor=basico|completo` y usa los mismos patrones que `ModuloFiscal.php`. Pruebas: `php tests/plan_basico/cerca_fiscal.php` (recorre todas las rutas de `routes/web.php`: las fiscales quedan cercadas, las operativas libres, y varios intentos de saltarse la cerca por la forma de la URL), `php tests/plan_basico/sin_id_fijo.php` y `tests/multiinquilino/m13_plan_basico.py` (alta real con plan SISTEMA, venta, asiento, subida de plan; 183 OK en total).

## Portal y pantallas SaaS (capturas)
`node preview/saas.mjs` (puerto 5200, datos de `preview/portal-fixtures.mjs`) y luego `node preview/saas-capturas.mjs` regenera las 25 capturas en `preview/capturas/saas/`. Pruebas SQL del portal: `python3 tests/portal/run_portal.py` (variables `PSQL` y `PGPORT_PRUEBAS`).

Ciclo de cobro (`40_ciclo_cobro.sql`): lo cubre `tests/portal/p03_ciclo_cobro.py` dentro de `run_portal.py` (instala 33 y 40; p02 instala el 34). Comando de la tienda: `php artisan portal:propagar`.
