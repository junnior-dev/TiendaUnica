# REPORTE E2E — Sistema POS Repuestos de Motos (Moto Repuestos El Táchira)

> **Total del sistema: 437 pruebas automáticas (237 operativas + 200 fiscales) · 437 OK · 0 FAIL.**
> Este reporte detalla las 237 operativas (t01..t15); las 200 fiscales están en `tests/fiscal/REPORTE_FISCAL.md` y la corrida unificada en `tests/run_todo.py`.


**Fecha:** 2026-11-13 · **Motor de pruebas:** PostgreSQL 17.4 real + Python (psycopg2 + Faker, semilla fija `20261113` para corridas reproducibles)

## 1. Qué se probó (metodología)

Pruebas E2E **reales contra la base de datos**: cada suite ejecuta exactamente las mismas funciones, triggers, vistas y restricciones que la aplicación Laravel llama en producción (tienda.fn_registrar_venta, fn_registrar_compra, fn_entregar_encargo, sp_anular_venta, etc.). No hay mocks: los datos se generan con **Faker** (clientes, proveedores, RIF con dígito de control válido, montos) y toda la lógica de negocio se valida en un **clon aislado** de la base real (`tienda_e2e`, creado con `CREATE DATABASE … TEMPLATE tienda`), de modo que las pruebas no contaminan los datos de la tienda.

- **15 suites** que cubren **todos los módulos** del sistema, en el orden de un día real de operación.
- **237 pruebas** por corrida, incluyendo casos positivos (el flujo completo funciona y los números cuadran) y **casos negativos** (la base rechaza lo que debe rechazar, con el mensaje correcto).
- **Resultado: 237 OK · 0 FAIL, reproducido en 2 corridas limpias consecutivas** (log completo en `salida_e2e_corrida1.log` y `salida_e2e_corrida2.log`).

## 2. Resumen por suite

| Suite | Módulo | Pruebas | Resultado |
|---|---|---|---|
| t01 | Configuración, impuestos, tasas y métodos de pago | 19 | ✅ 0 FAIL |
| t02 | Catálogo (categoría/marca/modelo), compatibilidad y combos | 10 | ✅ 0 FAIL |
| t03 | Usuarios, roles y sesión (auditoría) | 8 | ✅ 0 FAIL |
| t04 | Compras, proveedores y cuentas por pagar | 18 | ✅ 0 FAIL |
| t05 | Conteo físico y kardex | 16 | ✅ 0 FAIL |
| t06 | **POS completo**: apertura, cotización, ventas, IGTF, crédito, combo, factura, anulación | 29 | ✅ 0 FAIL |
| t07 | Cuentas por cobrar (cobros, comprobante, anulación) | 13 | ✅ 0 FAIL |
| t08 | Devoluciones y notas de crédito | 7 | ✅ 0 FAIL |
| t09 | Encargos de piezas (ciclo completo con anticipos) | 17 | ✅ 0 FAIL |
| t10 | Fiscal: libros de ventas/compras, IGTF, calendario, ajuste cambiario | 13 | ✅ 0 FAIL |
| t11 | Retenciones ISLR (UT, Decreto 1808, enteros) | 14 | ✅ 0 FAIL |
| t12 | Contabilidad: asientos automáticos, contra-asiento, libros, períodos | 18 | ✅ 0 FAIL |
| t13 | Cierre de caja (corte X, arqueo, cierre Z) | 15 | ✅ 0 FAIL |
| t14 | Límites y errores esperados (12 casos negativos) | 16 | ✅ 0 FAIL |
| t15 | **Integridad global**: conciliaciones cruzadas entre módulos | 24 | ✅ 0 FAIL |
| | **TOTAL** | **237** | **✅ 0 FAIL** |

## 3. Flujos completos verificados de punta a punta

1. **POS (el más completo)**: abrir caja con fondo → cotizar con tasa e IVA del día → venta de contado en Bs (pago móvil con referencia) → venta con efectivo y **vuelto** → venta a **crédito** con cuenta por cobrar a 15 días → venta de **combo** desglosada en sus piezas → salida al kardex firmada (−cantidad) → factura fiscal con numeración → **anulación** que devuelve mercancía → rechazo de pagos que no cuadran → corte X con desglose → arqueo → **cierre Z** con informe → nuevo turno.
2. **Inventario**: compra con crédito fiscal (base + IVA + total), costo según la política del negocio (`ULTIMO`), conteo físico por categoría con **todas** las líneas, diferencias valorizadas, ajustes firmados al kardex, anulación sin movimientos, kardex consultable que cierra al centavo.
3. **Fiscal**: libro de ventas con facturas emitidas, libro de compras con crédito fiscal, IGTF diario cuadrado contra los pagos, calendario del régimen con marcar/desmarcar declaraciones, ajuste cambiario aplicado y firmado.
4. **ISLR**: UT vigente, cálculo jurídico (base × %) y natural con **sustraendo** (UT × % × factor), retención registrada en Bs por la tasa del día, entero del período, desmarcado y anulación.
5. **Contabilidad**: asiento automático de venta **cuadrado** (debe = cobros + costo vendido, en Bs por la tasa), asiento de compra, asiento manual cuadrado / descuadrado rechazado, contra-asiento de reversión, diario, mayor y mayor por cuenta, apertura de balance, cierre y reapertura de período con rechazo de asientos fuera de tiempo.
6. **Encargos**: solicitar → ordenar → recibir (la pieza entra al inventario) → avisar → **anticipo** que entra a caja → entrega que genera la venta con saldo = precio − anticipos → imposibilidad de entregar dos veces → cancelación con motivo obligatorio.
7. **Integridad global (t15)**: stock = kardex para todo el catálogo, pagos = total en todas las ventas, total_cobrar = total + IGTF, toda anulación devolvió inventario, asientos cuadrados, saldos CxC/CxP consistentes, encargos entregados con venta e historial, sin movimientos de caja huérfanos, correlativos sin huecos nuevos, y las 14 vistas clave de los módulos respondiendo.

## 4. Hallazgos reales del E2E (valor de las pruebas)

1. **🐛 BUG REAL ENCONTRADO Y CORREGIDO — zona horaria en cobros de CxC**: `fn_registrar_pago_cobrar` comparaba la fecha del cobro contra `created_at::date` (que en PostgreSQL es la fecha **UTC**). En Venezuela (UTC−4), después de las 20:00 el día UTC ya es el siguiente: todo cobro registrado el mismo día de la venta con `fn_hoy()` fallaba con «La fecha del cobro no puede ser anterior a la venta». **Corregido** en `database/sql/15_cuentas_por_cobrar.sql` y `database/sql/16_correcciones_control.sql` usando la fecha local: `(c.created_at AT TIME ZONE 'America/Caracas')::date`. La función corregida quedó instalada en la base y el E2E pasó.
2. **Reglas de negocio decodificadas y ahora documentadas por las pruebas** (antes solo vivían en el código):
   - `fn_validar_pagos_venta`: los pagos (en USD) deben cuadrar con `total_usd` con tolerancia de 0,01; las ventas a crédito pueden pagar menos (el resto va a CxC) pero nunca más de lo que se debe.
   - IGTF: solo aplica cuando **negocio.cobra_igtf = true Y el método tiene aplica_igtf**; además la base exige régimen especial (constraint `ck_igtf_requiere_especial`).
   - El proveedor/los RIF se validan con **dígito de control real** (constraint `ck_proveedores_rif`): faker genera RIF inválidos y la base los rechaza — correcto.
   - `fn_registrar_compra` suma el IVA al total cuando hay crédito fiscal (el `costo_unitario` es sin IVA) y el costo del producto sigue la política `metodo_costo` del negocio.
   - El kardex firma las **salidas en negativo** y `stock_resultante` siempre cierra contra `productos.stock_actual`.
   - Los datos de un encargo **no se editan** después de crearlo (trigger de inmutabilidad): el precio se pacta al crear.
   - La nota de crédito que devuelve dinero es la de tipo **'C'**; su reembolso sale como EGRESO de caja ligado a la nota.
   - `fn_enterar_islr` exige un período completo (fecha de pago ≥ fin del período y no futura).
3. **Comportamientos correctos que confirmaron las pruebas negativas** (t14): venta sin productos/pagos, pago menor al total, producto inexistente, cantidad cero, documento de cliente duplicado, costo negativo, proveedor inexistente, enviar/recibir órdenes en estado inválido o cantidades mayores a lo pedido, cancelar encargo sin motivo, cobro mayor que el saldo, método de pago inactivo y movimiento de caja sin turno abierto — **todos rechazados con el mensaje claro correspondiente**.
4. **Nota de operación**: las funciones que validan frescura de tasas («más de 4 días») comparan contra el reloj del servidor; si `fn_hoy()` difiere del reloj (tienda «operando atrasada»), hay que registrar la tasa del día — el flujo está probado en t01.
5. **Limitación documentada**: el entorno del sandbox no incluye `pdo_pgsql` en el PHP portátil, por lo que la capa HTTP de Laravel no puede levantarse aquí; las pruebas E2E cubren toda la lógica de negocio a nivel de base de datos — la misma que los controladores invocan — más los tests de unidad EAN-13 (PHP/JS) ya integrados al CI.

## 5. Cómo correr las pruebas

```bash
# 1) PostgreSQL arriba (puerto 5433, socket /tmp)
# 2) Clonar la base real a un entorno aislado:
psql -h /tmp -p 5433 -U postgres -d postgres -c "DROP DATABASE IF EXISTS tienda_e2e"
psql -h /tmp -p 5433 -U postgres -d postgres -c "CREATE DATABASE tienda_e2e TEMPLATE tienda"
# 3) Correr las 15 suites (Faker genera los datos; semilla fija = reproducible):
cd tests/e2e && python3 run_all.py
```

Requisitos: `pip install psycopg2-binary faker`. El runner imprime cada verificación, el resumen por suite y sale con código 0 solo si todo pasó.

## 6. Contenido del paquete

- `e2e_lib.py` — harness (conexión al clon, Faker, aserciones, errores esperados, resumen).
- `t01…t15 .py` — las 15 suites, una por módulo/flujo.
- `run_all.py` — orquestador: corre en orden, tolera que una suite falle sin detener las demás, y resume.
- `salida_e2e_corrida1.log` / `salida_e2e_corrida2.log` — salida completa de las dos corridas verdes.
- `README.md` — guía rápida.
- **Fix incluido**: `fix_fn_registrar_pago_cobrar.sql` — el parche de zona horaria (ya aplicado en `database/sql/`).
