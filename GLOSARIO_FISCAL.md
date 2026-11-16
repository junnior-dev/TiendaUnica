# GLOSARIO FISCAL — para el dueño, la caja y el contador

Lenguaje sencillo, sin tecnicismos. Cada término es un concepto que el sistema ya maneja solo, pero que conviene
entender para usarlo bien y para conversar con el contador sin miedo.

---

## 1. CON_IVA / SIN_IVA — la base del IGTF

Cuando el negocio cobra **IGTF** (el 3 % por pagos en divisas), ese 3 % se calcula **sobre lo que el cliente pagó,
incluyendo el IVA**. En la pantalla y en los reportes verás dos palabras:

- **CON_IVA**: el monto «con todo»: mercancía + IVA. Sobre esto se calcula el 3 % del IGTF.
- **SIN_IVA**: el monto de la mercancía sola, sin el IVA. Es el número que usa el contador para el libro de ventas.

**En criollo:** si vendes Bs 100 de mercancía con Bs 16 de IVA, el cliente paga Bs 116; el IGTF (3 %) se calcula
sobre los **116**, no sobre los 100.

## 2. UT (Unidad Tributaria)

La **UT** es «la unidad de medida del fisco»: como el bolívar pierde valor, el SENIAT mide las cosas (retenciones,
multas, topes) en UT y la UT se actualiza periódicamente. Hoy el sistema la tiene cargada en **Bs 43**.

**¿Por qué la carga el contador?** Porque un cambio de UT cambia el cálculo de las retenciones de ISLR. El sistema
guarda **cada UT con su fecha**: las retenciones del mes pasado se calculan con la UT de ese mes, y las de este mes
con la de hoy — nunca se mezclan. Cuando el contador avisa «cambió la UT», se registra en Configuración y el
sistema empieza a usarla desde esa fecha, **sin tocar lo ya calculado**.

## 3. sustraendo_una_vez_mes

Cuando se retiene ISLR a una **persona natural** (por ejemplo un mecánico que te presta servicios), la ley deja
«descontar» una parte fija del cálculo: eso es el **sustraendo**.

- **Apagado (como está ahora)**: cada pago se calcula con su propio sustraendo.
- **Encendido**: si le pagas **dos veces en el mismo mes** a la misma persona, el sistema aplica el sustraendo
  **solo en el primer pago**; el segundo sale sin descuento (para no retener de menos).

**En criollo:** el sustraendo es un «regalito» legal que solo se usa una vez por mes por persona. Tu contador decide
si está encendido o apagado según cómo interprete el Decreto 1.808.

## 4. Tipos 01 / 02 / 03 / 04 del libro de ventas

El SENIAT clasifica cada renglón del libro de ventas así:

- **01 · Registro**: la factura normal de venta.
- **02 · Complemento**: la nota de **débito** (aumenta la deuda; en el sistema se usa poco).
- **03 · Anulación**: una factura **anulada**. Aparece en el libro marcada, pero **no suma** al total del mes.
- **04 · Ajuste**: la nota de **crédito** (devolución). Resta de lo vendido.

**En criollo:** 01 «vendí», 02 «me deben más», 03 «esa factura no vale», 04 «se lo devolví al cliente». El sistema
guarda las anuladas con su marca para que el auditor vea que no se «borró» nada, y las notas de crédito quedan en
su módulo propio con su efecto en caja, inventario y deuda del cliente.

## 5. Régimen ESPECIAL vs ORDINARIO

Es la pregunta que define **qué calendario** de vencimientos le toca al negocio:

- **ESPECIAL (contribuyente especial)**: el SENIAT te declara «especial» (por facturación alta, importaciones,
  etc.). Se declara IVA **dos veces al mes (quincenal)**, hay obligaciones extra y el sistema muestra ese calendario.
- **ORDINARIO (como la mayoría de las tiendas)**: se declara IVA **una vez al mes**, y el día exacto depende del
  **último dígito del RIF** (dígito 0 → día 10 del mes siguiente, 1 → 11 … 9 → 19).

**En criollo:** es tu «categoría» ante el SENIAT. El sistema ya trae **los dos calendarios sembrados** (2026 y 2027)
y usa el que corresponda según la casilla «contribuyente especial». Si cambias el RIF o la categoría, el sistema
recalcula las fechas solo. Igual se puede cargar un calendario nuevo cuando el SENIAT publique el del año.

## 6. Zona horaria America/Caracas

Todo el sistema «piensa» en la **hora de Venezuela** (UTC−4). Esto importa porque los cierres de caja, las ventas y
los vencimientos son **por día local**:

- Antes de la corrección (probada en las pruebas E2E), cobrar a las 8:00 p. m. del sábado venezolano «caía» en el
  domingo por UTC y el sistema se quejaba de cobrar en un día pasado.
- Ahora la venta de las 11:59 p. m. del viernes **es del viernes**, el corte de caja cierra el día correcto y el
  IGTF del cobro se calcula con la alícuota de la **fecha venezolana** del cobro.

**En criollo:** el sistema usa tu reloj, no el del servidor que vive en otro país.

## 7. Reintegro de IGTF

Si anulaste una venta donde cobraste IGTF, ese IGTF **no desaparece de tu declaración**: el SENIAT ya considera que
lo cobraste ese día y lo debes declarar. Lo que cambia es que el cliente te lo «reclama» — le debes devolver ese
3 % — y tú a su vez puedes **reclamar el reintegro** al fisco.

El sistema lo maneja así (probado):

- La anulación **registra la reversión** en su tabla, con fecha y motivo.
- El **neto del día** baja (venta menos anulación).
- Pero **lo que se declara no se resta**: el reporte `v_igtf_a_declarar` sigue mostrando el IGTF cobrado y
  **aparte** muestra cuánto corresponde a ventas anuladas — ese es el monto del reintegro a reclamar.

**En criollo:** «lo cobrado se decla­ra; lo devuelto se reclama». Nunca restes a mano: el sistema ya separa los dos
montos para que no declares de menos y te multen.

## 8. Crédito fiscal (compras)

Si la compra tiene **factura con RIF y el IVA discriminado**, ese IVA te sirve para **restarlo del IVA de tus
ventas** — es el «crédito fiscal». Si la factura es informal (sin RIF, sin IVA separado), no hay crédito y el IVA
se queda **dentro del costo** del producto. El libro de compras del sistema separa las dos columnas para que el
contador declare el crédito correcto.

## 9. Comprobante de retención (AAAAMM00000000)

Cuando le retienes IVA a un proveedor, emites un **comprobante de retención** numerado así: **AAAAMM** + un número
de 8 dígitos, correlativo y sin huecos permitidos (14 dígitos en total, ejemplo `20261100000001`). El sistema
asigna el número, rechaza duplicados y guarda el comprobante en la retención — es el papel que el proveedor usa
para pedir su crédito.

## 10. Entero (pago al SENIAT)

«Enterar» = **pagarle al SENIAT** lo retenido. Las retenciones de IVA se enteran **por quincena** (y solo cuando la
quincena ya terminó); las retenciones de ISLR se enteran **por mes** y solo con el mes completo. Al enterar, el
sistema genera el asiento contable y **marca** las retenciones enteradas — una retención enterada no se puede
anular sin antes «desmarcar» el entero (y ese desmarque genera el contra-asiento). Así el libro siempre cuadra.

## 11. Ajuste cambiario del inventario

Como las compras quedan valoradas en divisas, el **valor en bolívares del inventario cambia cuando la tasa cambia**.
El cierre de cada mes puede calcular la diferencia entre lo que dice el libro contable y lo que vale el inventario
físico a la tasa del día, y genera el asiento de la diferencia (ganancia o pérdida cambiaria). Es el asiento que
muchos sistemas olvidan — este lo hace con un clic y un solo ajuste por mes.

## 12. Nota de crédito (devolución)

Es el «recibo por devolución»: le resta mercancía y/o dinero al cliente sin borrar la factura original. El sistema
la aplica **primero a la deuda** si la venta fue a crédito (no sale dinero), y si sobra (la nota es mayor que la
deuda), el exceso se **devuelve en caja** con su egreso. Anular una venta que ya tiene notas está **prohibido** por
el sistema — se emite una nota por lo que falte.

---

*Cada uno de estos comportamientos está probado automáticamente: ver `MATRIZ_TRAZABILIDAD.md` para la norma que
respalda cada caso y los suites f01…f17 para las 200 pruebas fiscales.*
