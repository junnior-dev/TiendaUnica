# Pruebas fiscales y contables E2E (plan del contador auditor)

17 suites · 200 pruebas contra PostgreSQL real (clon `tienda_fiscal`), cubriendo el plan fiscal completo:
IVA con vigencias, ISLR Decreto 1.808 con sustraendo, IGTF con reversión y declaración, enteros ISLR,
libros de ventas/compras, calendario fiscal, cierre de ejercicio y período, ajuste cambiario, notas sobre
CxC, retenciones de IVA quincenales, conciliación SENIAT, invariantes globales y estados imposibles.

```bash
pip install psycopg2-binary faker
cd tests/fiscal && python3 run_fiscal.py
```

Última corrida: **200 OK · 0 FAIL** (2 corridas limpias consecutivas) · **Total del sistema: 437 OK · 0 FAIL** con `python3 tests/run_todo.py`. Detalle y hallazgos: `REPORTE_FISCAL.md`; trazabilidad por norma: `MATRIZ_TRAZABILIDAD.md`; glosario: `GLOSARIO_FISCAL.md`.
