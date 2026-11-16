# MATRIZ DE TRAZABILIDAD FISCAL — Sistema POS Repuestos de Motos

**Para el contador que firma:** esta tabla cruza cada **requisito fiscal venezolano** con el **escenario probado**
automáticamente y **dónde** está la prueba que lo respalda. Las 437 pruebas se ejecutan contra PostgreSQL real
(`python3 tests/run_todo.py`) y quedan en un log firmable. Cada fila es una garantía auditable: si mañana cambia una
alícuota, un dígito de RIF o una Providencia, la suite correspondiente fallará y te avisará.

> **Nota de alcance:** las referencias normativas se citan tal como las compartió el contador responsable del
> proyecto (Ley del IVA y su Reglamento, Decreto 1.808 de retenciones de ISLR, Providencias SNAT 2022/000013
> (IGTF), 2025/000054 (agentes de retención de IVA) y 2025/000091 (calendario fiscal 2026), Código de Comercio y
> Principios de Contabilidad de Costos (PCC)). Antes de firmar una declaración, verifica el artículo vigente contra
> la **Gaceta Oficial** — las Providencias se actualizan cada año.

## 1. Impuesto al Valor Agregado (IVA)

| Norma / Requisito | Escenario probado | Suite | Tests | Estado |
|---|---|---|---|---|
| Ley del IVA · alícuota general vigente | Las ventas cotizan con la alícuota vigente de su fecha (16 %) | f01 · IVA | 1–3 | ✅ |
| Ley del IVA · cambio de alícuota NO retroactivo | `sp_cambiar_alicuota(17)`: cierra la vigencia con `desde−1`, inserta la nueva; fecha pasada → rechazada | f01 · IVA | 4–6 | ✅ |
| Ley del IVA · la venta congeló SU alícuota | La venta de hoy guarda `iva_pct = 16` en su fila y no se recalcula al cambiar la alícuota | f01 · IVA | 7 | ✅ |
| Ley del IVA · no se declara sin alícuota definida | Sin fila vigente, `fn_iva_pct` lanza `TV006` (nunca inventa un porcentaje) | f01 · IVA | 12 | ✅ |
| Ley del IVA · un solo cambio vigente sin solapes | Cambio con la misma fecha, código inválido o alícuota repetida → todos rechazados | f01 · IVA | 8–11 | ✅ |
| Reglamento Ley IVA · libro de ventas cuadrado | Renglón a renglón: base + exento + exonerado = total − IVA | f05 · Libro ventas | 1–2 | ✅ |
| Reglamento Ley IVA · facturas anuladas no suman | La anulación aparece marcada y el total del mes la excluye | f05 · Libro ventas | 3–5 | ✅ |
| Reglamento Ley IVA · columnas por alícuota | El producto exento cae en `exento_ves` con IVA 0; el general en `base_imponible_ves` | f05 · Libro ventas | 6–7 | ✅ |
| Ley del IVA · crédito fiscal vs IVA al costo | Con crédito fiscal el IVA va al crédito; sin él (factura informal) se lleva al costo | f12 · Libro compras | 1–4 | ✅ |
| Ley del IVA · no valorar sin tasa del día | Compra en divisa sin tasa registrada → base en Bs NULL (el sistema no inventa valores) | f12 · Libro compras | 5 | ✅ |
| Ley del IVA · compra anulada no genera crédito | La compra anulada queda ANULADA y el crédito fiscal no crece | f12 · Libro compras | 6–8 | ✅ |
| Providencia SNAT/2025/000054 · retención 75 % | Retención estándar del 75 % sobre el IVA de la compra | f10 · Retenc. IVA | 1–3 | ✅ |
| Providencia SNAT/2025/000054 · retención 100 % | Retención del 100 % (documento sin IVA discriminado) | f10 · Retenc. IVA | 4 | ✅ |
| Providencia SNAT/2025/000054 · comprobante correlativo | Formato AAAAMM00000000 de 14 dígitos, correlativo, duplicado rechazado por unicidad | f10 · Retenc. IVA | 5–6 | ✅ |
| Providencia SNAT/2025/000054 · enterar por quincena | La quincena no terminada se rechaza; el entero suma solo retenciones ACTIVAS; no se entera dos veces | f10 · Retenc. IVA | 7–11 | ✅ |
| Ley del IVA · IGTF solo en divisas elegibles | Se cobra solo si `cobra_igtf` y el método tiene `aplica_igtf` (Pago móvil → 0) | f03 · IGTF | 1–5 | ✅ |
| Providencia SNAT/2022/000013 · IGTF se causa al COBRAR | Crédito cobrado después en Zelle: IGTF del cobro, no de la factura; parcial → sobre lo cobrado | f03 · IGTF | 6–8 | ✅ |
| Providencia SNAT/2022/000013 · el IGTF anulado se DECLARA igual | Al anular: `reversiones_igtf` registra, el neto baja, y `v_igtf_a_declarar` NO lo resta (reintegro aparte) | f03 · IGTF | 9–11 | ✅ |
| Ley del IVA · IGTF congelado por venta | `total_cobrar = total + IGTF` en toda venta con IGTF (invariante global) | f16 · Invariantes | 3 | ✅ |

## 2. Impuesto sobre la Renta (ISLR) — Decreto 1.808

| Norma / Requisito | Escenario probado | Suite | Tests | Estado |
|---|---|---|---|---|
| Decreto 1.808 · sustraendo de persona natural | Honorarios 3 %, Bs 10.000, UT 43 → retenido **Bs 192,50** (sustraendo 107,50 = UT × 3 % × 83,3334) | f02 · ISLR | 2–3 | ✅ |
| Decreto 1.808 · persona jurídica sin sustraendo | Honorarios 5 % → Bs 500,00 exactos | f02 · ISLR | 4 | ✅ |
| Decreto 1.808 · mínimo sujeto a retención | Base 3.000: el sustraendo supera la retención → `corresponde: false`, retenido 0 | f02 · ISLR | 5 | ✅ |
| Decreto 1.808 · la UT de la FECHA del pago | Cada fecha usa SU fila de UT (hoy 43; el período anterior usó 43,75) — nunca se mezclan | f02 · ISLR | 1, 6 | ✅ |
| Decreto 1.808 · sustraendo una vez al mes | `sustraendo_una_vez_mes = true`: el segundo pago al mismo beneficiario ya no aplica sustraendo | f02 · ISLR | 7–8 | ✅ |
| Decreto 1.808 · concepto sin sustraendo | `sustraendo_nat = false`: retenido = base × % directo | f02 · ISLR | 9 | ✅ |
| Decreto 1.808 · la retención congela su cálculo | Base, sustraendo, tasa y UT quedan guardados en la fila de `retenciones_islr` | f02 · ISLR | 10–11 | ✅ |
| Decreto 1.808 · enterar retenciones del mes completo | Pago antes del cierre del período → rechazado; fecha futura → rechazada | f04 · Entero ISLR | 1–3 | ✅ |
| Decreto 1.808 · el entero genera asiento y enlaza | Asiento `ENTERO_ISLR` cuadrado; retenciones marcadas con `entero_id`; doble entero → rechazado | f04 · Entero ISLR | 4–6 | ✅ |
| Decreto 1.808 · retención enterada no se anula | «Esa retención ya se enteró: primero desmarca el pago»; desmarcar genera contra-asiento y libera | f04 · Entero ISLR | 7–9 | ✅ |
| Providencia calendario · enterar retenciones de ISLR | El ORDINARIO lleva el entero mensual (día 10 del mes siguiente) sembrado por el script 30 | f06 · Calendario | 5 | ✅ |

## 3. Calendario fiscal y régimen

| Norma / Requisito | Escenario probado | Suite | Tests | Estado |
|---|---|---|---|---|
| Providencia SNAT/2025/000091 · dígito del RIF | El dígito VERIFICADOR del RIF decide la fecha; cambiar el RIF cambia las fechas | f06 · Calendario | 1–2 | ✅ |
| Providencia SNAT/2025/000091 · régimen ESPECIAL (quincenal) | Contribuyente especial ve su calendario quincenal con IGTF | f06 · Calendario | 3–4 | ✅ |
| Providencia SNAT/2025/000091 · régimen ORDINARIO (mensual) | Con `es_contribuyente_especial = false` hay vencimientos mensuales (script `30_calendario_ordinario.sql`) | f06 · Calendario | 5–6 | ✅ |
| Providencia calendario · solo fechas reales | Presentar un vencimiento que no está en el calendario → rechazado; presentar «a futuro» → rechazado | f06 · Calendario | 7–8 | ✅ |
| Providencia calendario · carga de años nuevos | Carga masiva 2027 con `fn_calendario_cargar` sin errores | f06 · Calendario | 9 | ✅ |

## 4. Contabilidad y libros legales (Código de Comercio)

| Norma / Requisito | Escenario probado | Suite | Tests | Estado |
|---|---|---|---|---|
| Código de Comercio · cierre anual del ejercicio | Ingreso 1.000 y gasto 400 → asiento `CIERRE` 31/12; INGRESO y GASTO quedan en cero; utilidad 600 a 3.1.02 | f07 · Cierre ejercicio | 1–3, 5–7 | ✅ |
| Código de Comercio · ejercicios en orden | Cerrar 2025 sin cerrar 2024 → «Primero cierra el ejercicio…»; doble cierre → rechazado | f07 · Cierre ejercicio | 4, 8 | ✅ |
| Código de Comercio · no se escribe en período cerrado | Asiento manual en mes cerrado → rechazado; reabrir exige motivo | f13 · Cierre período | 1–3, 6–7 | ✅ |
| Código de Comercio · anulación fuera de tiempo | Anular compra de un período cerrado → rechazada por el trigger fiscal | f13 · Cierre período | 4 | ✅ |
| PCC · ajuste cambiario del inventario | Valor físico = Σ stock × costo × tasa; diferencia a resultados; un ajuste por mes (AAAAMM) | f08 · Ajuste cambiario | 1–5 | ✅ |
| PCC / partida doble · todo asiento cuadra | 0 asientos descuadrados en TODA la base, por origen y en total | f15 · Asientos, f16 | todos | ✅ |
| Resolución de facturación · numeración correlativa | El intento fallido deja hueco auditable con anterior/siguiente y fecha; la anulada NO es hueco | f14 · Huecos | 1–5 | ✅ |
| Libros legales · cada asiento apunta a su documento | `origen_id` de VENTA/COMPRA/ENTERO_ISLR siempre referencia un documento real; CIERRE lleva el año | f15 · Asientos | 2–3 | ✅ |

## 5. Estados imposibles (defensa en profundidad)

| Norma / Requisito | Escenario probado | Suite | Tests | Estado |
|---|---|---|---|---|
| Integridad · venta de contado sin pagos | Imposible: validador la rechaza y no existe en la base | f17 · Imposibles | 1–2 | ✅ |
| Integridad · retención enterada sin asiento | Imposible con contabilidad automática | f17 · Imposibles | 3 | ✅ |
| Integridad · devolver más de lo reembolsable | Imposible: la nota no devuelve más dinero del que le queda | f17 · Imposibles | 4 | ✅ |
| Integridad · venta o asiento en período cerrado | Imposible (el mes en curso no se puede cerrar; asiento cerrado → rechazado) | f17 · Imposibles | 5 | ✅ |
| Integridad · CxC inflada / venta futura / pagos mutados | 0 CxC con saldo mayor al original; 0 ventas fechadas a futuro; pagos inmutables; un solo turno | f17 · Imposibles | 6–8 | ✅ |
| Invariantes globales · aritmética fiscal | `total = base + exento + IVA`; cantidades > 0; sin NaN; stock ≥ 0; alícuota congelada = vigente de su fecha | f16 · Invariantes | 1–9 | ✅ |

**Resumen: 26 garantías fiscales · 437 pruebas automatizadas · 0 fallos · 2 corridas reproducidas.**
Detalle completo de cada escenario: `tests/e2e/REPORTE_E2E.md` y `tests/fiscal/REPORTE_FISCAL.md`.
