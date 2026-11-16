# Pruebas E2E reales del sistema

Suite de pruebas end-to-end contra PostgreSQL **real**: cada prueba llama las mismas funciones
(`tienda.fn_*`), triggers y restricciones que la aplicación usa en producción, con datos generados
por Faker (semilla fija → corridas reproducibles) y sobre un clon aislado de la base (`tienda_e2e`).

## Uso rápido

```bash
pip install psycopg2-binary faker
psql -h /tmp -p 5433 -U postgres -d postgres -c "CREATE DATABASE tienda_e2e TEMPLATE tienda"
cd tests/e2e && python3 run_all.py
```

## Qué cubre

| Suite | Módulo |
|---|---|
| t01 | Configuración, impuestos, tasas, métodos de pago |
| t02 | Catálogo, compatibilidad, combos |
| t03 | Usuarios y sesión |
| t04 | Compras, proveedores, CxP |
| t05 | Conteo físico y kardex |
| t06 | POS: apertura, ventas, IGTF, crédito, combo, factura, anulación |
| t07 | Cuentas por cobrar |
| t08 | Devoluciones y notas de crédito |
| t09 | Encargos (ciclo completo) |
| t10 | Fiscal: libros, IGTF, calendario, ajuste cambiario |
| t11 | Retenciones ISLR |
| t12 | Contabilidad y libros |
| t13 | Cierre de caja (X / Z) |
| t14 | Límites y errores esperados |
| t15 | Integridad global (conciliaciones) |
| t16 | Páginas Inertia vía HTTP real (humo de pantallas) |

## t16 · Páginas Inertia (HTTP real)

Las suites t01–t15 prueban la lógica en la base; t16 prueba la **capa de presentación**:
entra como invitado, administrador, cajero y super-admin del portal, recorre todas las
pantallas y verifica que cada página Inertia llegue bien formada ({component, props, url,
version}), que sus props traigan datos y que el archivo del componente exista en
`resources/js/Pages/`. Además crea datos reales por HTTP (apertura de caja, venta
contado/crédito, compra, modelo, encargo) para probar las páginas de detalle.

Necesita el servidor Laravel corriendo (`php artisan serve`) y la base `tienda` instalada
con datos semilla. Conexión a la base vía host `/tmp`, puerto `5433` (ajustable con `BASE_URL`).

```bash
php artisan serve --port=8000 &
cd tests/e2e && python3 t16_paginas_inertia.py
```

Nota de orden: t16 deja datos de prueba en la base `tienda`. Si después vas a correr las
suites de negocio, reinstala la base limpia primero (o el clon de multiinquilino, que usa
`tienda` como template, se encontraría con datos inesperados).

Última corrida: **237 OK · 0 FAIL** (detalle en `REPORTE_E2E.md`) · **Total del sistema: 437 OK · 0 FAIL** (237 operativas + 200 fiscales) con `python3 tests/run_todo.py`.
