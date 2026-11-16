# REPORTE DE PRUEBAS FISCALES Y CONTABLES E2E — Sistema POS Repuestos de Motos

**Fecha:** 2026-11-13 · **Ejecutado como:** plan de validación de un contador auditor antes de firmar el sistema ante el SENIAT
**Motor:** PostgreSQL 17 real (clon aislado `tienda_fiscal`), Python + Faker con semilla fija → **corridas reproducibles**

## 1. Veredicto ejecutivo

**200 pruebas fiscales/contables en verde (0 fallos), reproducidas en 2 corridas limpias consecutivas — y 437 en total del sistema con la corrida unificada `tests/run_todo.py` (237 operativas + 200 fiscales).**
El sistema **nunca permite un estado fiscal inválido** en ninguno de los 8 puntos críticos del plan, y en todos los
casos de error el contador puede reconstruir el documento (motivo, fecha, comprobante y contra-asiento quedan en la base).

| Prioridad | Áreas | Pruebas | Resultado |
|---|---|---|---|
| 🔴 CRÍTICA (multa SENIAT) | IVA alícuotas, ISLR sustraendo, IGTF, entero ISLR, libro de ventas, calendario (ESPECIAL + ORDINARIO), cierre de ejercicio, ajuste cambiario | 111 | ✅ 0 FAIL |
| 🟡 ALTA (pérdida de dinero) | Notas sobre CxC, retenciones de IVA, conciliación SENIAT | 37 | ✅ 0 FAIL |
| 🟢 MEDIA | Libro de compras, cierre de período, huecos, asientos automáticos | 34 | ✅ 0 FAIL |
| ⚙️ INVARIANTES (capa 2) | Partida doble, aritmética de ventas, stock, alícuota congelada | 9 | ✅ 0 FAIL |
| ⛔ IMPOSIBLES (capa 3) | Estados que jamás deben existir | 10 | ✅ 0 FAIL |
| | **TOTAL** | **200** | **✅ 0 FAIL** |

## 2. Los 10 puntos de mayor riesgo fiscal (todos verificados con números reales)

1. **Cambio de IVA a mitad de período** — `sp_cambiar_alicuota('IVA_GENERAL', 17, mañana, 'Gaceta…')`: cierra la
   vigencia con `vigente_hasta = desde − 1`, inserta la nueva, la venta de HOY congela `iva_pct = 16` en su fila y
   `fn_iva_pct` responde 16 hoy / 17 mañana. **Solape rechazado**, fecha pasada rechazada («las ventas ya emitidas
   congelaron la anterior»), alícuota igual rechazada, y sin fila vigente → `TV006` (nunca se inventa un porcentaje).
2. **ISLR natural con sustraendo (Decreto 1.808)** — UT Bs 43: natural honorarios 3 % sobre Bs 10.000 →
   **retenido Bs 192,50** (300 − 107,50, con sustraendo = 43 × 3 % × 83,3334), jurídica 5 % → **Bs 500,00 sin
   sustraendo**, base Bs 3.000 → `corresponde: false` (el sustraendo supera la retención). Cada fecha usa SU fila de
   UT; `sustraendo_una_vez_mes = true` → el segundo pago al mismo beneficiario ya no aplica sustraendo; un concepto
   con `sustraendo_nat = false` retiene base × % directo. La retención registrada **congela** base, sustraendo y tasa.
3. **IGTF en cobro posterior + reversión** — se causa solo con `negocio.cobra_igtf ∧ método.aplica_igtf`; en un
   **cobro de CxC se causa al cobrar con la alícuota de esa fecha** (cobro parcial en Zelle → IGTF sobre lo cobrado,
   no sobre el saldo). Al anular una venta con IGTF: `reversiones_igtf` registra la fila, `v_igtf_neto_diario` resta
   el revertido y **`v_igtf_a_declarar` NO lo resta** (lo expone aparte en `igtf_de_ventas_anuladas_usd` para
   reclamar el reintegro) — exactamente la regla del SENIAT que evita declarar de menos.
4. **Entero de ISLR rechaza períodos incompletos** — `fn_enterar_islr(oct, 15/10)` → rechazado; fecha futura →
   rechazado; el entero correcto genera **asiento `ENTERO_ISLR` cuadrado**, marca las retenciones con `entero_id`,
   y la retención enterada **no se puede anular** («primero desmarca el pago»). `fn_desmarcar_entero_islr` genera
   el **contra-asiento `ANULACION_ENTERO_ISLR`** y libera las retenciones.
5. **Libro de ventas con cuadre interno** — renglón a renglón `base + exento + exonerado = total − IVA`; la
   factura anulada aparece marcada y **el total del mes excluye las anuladas**; el IVA del libro = IVA congelado en
   las filas de ventas; la base exenta cae en su columna con IVA 0.
6. **Calendario fiscal reacciona al RIF y al régimen** — cambiar el dígito verificador del RIF (generado VÁLIDO
   porque la base lo valida) cambia las fechas de `fn_proximos_vencimientos`; el régimen **ORDINARIO mensual está
   sembrado** (script `30_calendario_ordinario.sql`, 500 filas 2026–2027) y su calendario difiere del quincenal especial; `fn_marcar_presentada` rechaza
   vencimientos ajenos al calendario y fechas futuras; la carga masiva 2027 con `fn_calendario_cargar` funciona.
7. **Cierre de ejercicio deja cuentas en cero** — con saldos sembrados (ingreso 1.000, gasto 400): `fn_cierre_ejercicio(2024)`
   genera el asiento `CIERRE` fechado 31/12 cuadrado, INGRESO y GASTO quedan en cero en el mayor del año, la
   utilidad (600) aterriza en **3.1.02 resultados acumulados**, el doble cierre se rechaza y **cerrar 2025 sin
   cerrar 2024 primero se rechaza** («Primero cierra el ejercicio…»); asiento manual en período cerrado → rechazado.
8. **Ajuste cambiario del inventario** — `fn_ajuste_cambiario_calculo` devuelve `valor_fisico_ves = Σ stock × costo ×
   tasa` (verificado contra el cálculo independiente de la prueba), la diferencia = físico − contable, el asiento
   `AJUSTE_CAMBIARIO` (clave AAAAMM) queda cuadrado, **un ajuste por mes**, fecha futura rechazada y mes contable
   cerrado rechazado.
9. **Nota de crédito sobre venta a crédito** — nota parcial → baja la CxC y **NO sale dinero**; nota por encima del
   saldo → liquida la CxC a 0 (PAGADA), el exceso queda reembolsable y su devolución en caja genera el EGRESO
   correcto; nota sobre venta de contado → 100 % reembolsable; **anular la venta con notas aplicadas se rechaza**
   («Emite notas de crédito por lo que falte»); el asiento de la nota queda cuadrado.
10. **Retenciones de IVA 75 % / 100 % y entero quincenal** — comprobante **AAAAMM00000000 de 14 dígitos** con
    correlativo, duplicado rechazado por unicidad; la retención **anulada sale del cálculo** del entero;
    `fn_enterar_retenciones` exige quincena 1/2, fecha de pago no futura y **quincena terminada** (la quincena 1 del
    mes en curso se rechaza), y no se puede enterar dos veces.

## 3. Capa 2 — Invariantes globales (siempre verdaderas)

- Partida doble: **0 asientos descuadrados** en toda la base.
- Aritmética de ventas: `total_ves = base + exento + IVA` (y `total_cobrar = total + IGTF`) — 0 excepciones.
- 0 líneas de venta con cantidad ≤ 0; 0 montos NaN/negativos; 0 productos con stock negativo.
- **Alícuota congelada**: cada venta lleva el porcentaje vigente en SU fecha (0 desvíos).
- Pagos de contado = total en todas las ventas; ninguna CxC con saldo mayor al original.

## 4. Capa 3 — Estados imposibles (comprobados como imposible)

Venta de contado sin pagos · retención enterada sin asiento · devolución mayor a lo reembolsable · venta en período
contable cerrado (el mes en curso no se puede cerrar) · CxC inflada · venta fechada en el futuro · agregar pagos a
una venta confirmada (pagos inmutables) · dos turnos abiertos del mismo usuario. **Todos rechazados por la base.**

## 5. Hallazgos y observaciones del auditor (con acción recomendada)

1. **Hallazgo (configuración, RESUELTO): el calendario sembrado solo traía régimen ESPECIAL.** Con
   `es_contribuyente_especial = false`, `fn_proximos_vencimientos` quedaba vacío (régimen ORDINARIO sin filas).
   **Acción recomendada (EJECUTADA):** se creó e instaló `database/sql/30_calendario_ordinario.sql` — siembra el
   calendario ORDINARIO mensual 2026–2027 (500 filas: IVA por dígito del RIF, entero de retenciones de ISLR y
   autoliquidación anual; la estimada no aplica a ordinarios). Verificado: un contribuyente ordinario ya ve sus
   fechas. **Acción permanente del contador:** cada año cargar el calendario nuevo con `fn_calendario_cargar` y
   verificar las fechas contra la Gaceta Oficial correspondiente.
2. **Hallazgo (diseño): el dígito del calendario es el dígito VERIFICADOR del RIF** (`right(rif,1)`), no el último
   dígito del cuerpo. Al cambiar el RIF hay que recalcular el dígito de control para que la base acepte el cambio
   (`ck_negocio_rif` valida el algoritmo). **Acción recomendada:** documentado para el usuario en
   `GLOSARIO_FISCAL.md` §5; en la pantalla de Configuración, al editar el RIF, mostrar el dígito de control
   recalculado (mejora de UI, no de base). No bloquea el release.
3. **Confirmado (correcto): compras en divisa SIN tasa del día salen con base en Bs NULL** — el libro no inventa
   valores (la prueba lo documenta). **Acción recomendada:** ninguna en código (comportamiento correcto);
   operativamente, registrar la tasa del día ANTES de registrar compras en divisa — mencionado en
   `GLOSARIO_FISCAL.md` y de paso para el manual del contador.
4. **Confirmado (correcto): la anulación de compra en período cerrado está protegida** por el trigger
   `trg_periodo_anular_compra` (probado en f13 con el período cerrado). **Acción recomendada:** no requiere
   acción — comportamiento correcto verificado.
5. **Confirmado (correcto): `fn_registrar_pago_cobrar` compara la fecha del cobro contra el día LOCAL (Caracas)**
   del `created_at` — el parche de la entrega anterior quedó verificado por estas pruebas. **Acción recomendada:**
   no requiere acción — parche verificado en producción de pruebas.
6. **Regla del mes en curso:** `fn_cerrar_periodo` rechaza cerrar el mes que aún corre («Solo se puede cerrar un mes
   que ya terminó») — por construcción una venta nunca cae en período cerrado (capa 3). **Acción recomendada:** no
   requiere acción — regla correcta y probada.
7. **Restauración vigencial:** en las pruebas el regreso a 16 % se hizo al día siguiente del cambio a 17 % (la
   función exige `desde` posterior al inicio de la vigencia actual). **Acción recomendada:** no requiere acción en
   código; operativamente, cuando el SENIAT revoque una alícuota, el contador hará el cambio vigente desde la fecha
   de la nueva Gaceta (el mismo flujo probado).
8. **Limitación documentada:** el sandbox no incluye `pdo_pgsql` en el PHP portátil, por lo que estas pruebas
   cubren toda la lógica fiscal a nivel de base de datos — la misma que los controladores Laravel invocan.
   **Acción recomendada (antes del release):** en el servidor de producción instalar/activar la extensión PHP
   `pdo_pgsql` (una línea en php.ini del hosting); sin ella la app Laravel no conecta. El resto del stack no
   requiere cambios.

## 6. Cómo correr las pruebas

```bash
pip install psycopg2-binary faker
python3 tests/run_todo.py            # TODO: 437 pruebas (237 operativas + 200 fiscales), un solo resumen
cd tests/fiscal && python3 run_fiscal.py   # solo las fiscales: reinicia el clon tienda_fiscal y corre f01→f17
```

El runner reinicia el clon desde `TEMPLATE tienda` (aislado), ejecuta las 17 suites en orden fiscal lógico,
imprime cada verificación y sale con código 0 solo si todo pasó. Semilla Faker fija → corridas reproducibles.

## 7. Contenido del paquete

- `f_lib.py` — núcleo (clon dedicado, régimen especial on/off, helpers fiscales).
- `f01…f17 .py` — las 17 suites del plan (8 críticas, 3 altas, 4 medias, invariantes, imposibles).
- `run_fiscal.py` — orquestador con reinicio de clon y resumen.
- `salida_fiscal_corrida1.log` / `salida_fiscal_corrida2.log` — las dos corridas verdes completas de la suite fiscal (y `tests/salida_total_corrida1/2.log` para las corridas TOTALES de 437 pruebas).
- `README.md` — guía rápida.
- `explora.py` — script de exploración usado para documentar comportamientos antes de fijar aserciones.
