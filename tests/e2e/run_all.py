# -*- coding: utf-8 -*-
"""Orquestador del E2E completo: corre las 15 suites en orden (t01→t15), guarda el log
completo y regenera el RESUMEN. Uso: python3 run_all.py [--base tienda_e2e]"""
import io
import sys
import traceback

import e2e_lib as L

SUITES = [
    ('t01_configuracion', 't01 · Configuración e impuestos'),
    ('t02_catalogo', 't02 · Catálogo, compatibilidad y combos'),
    ('t03_usuarios', 't03 · Usuarios y sesión'),
    ('t04_compras', 't04 · Compras, proveedores y CxP'),
    ('t05_conteo_kardex', 't05 · Conteo físico y kardex'),
    ('t06_pos', 't06 · POS: apertura, ventas, IGTF, crédito y anulación'),
    ('t07_cxc', 't07 · Cuentas por cobrar (CxC)'),
    ('t08_devoluciones', 't08 · Devoluciones y notas de crédito'),
    ('t09_encargos', 't09 · Encargos de piezas (ciclo completo)'),
    ('t10_fiscal', 't10 · Fiscal: libros, IGTF y calendario'),
    ('t11_islr', 't11 · Retenciones ISLR (Decreto 1808)'),
    ('t12_contabilidad', 't12 · Contabilidad y libros'),
    ('t13_cierre_caja', 't13 · Cierre de caja (corte X y Z)'),
    ('t14_limites', 't14 · Límites y errores esperados'),
    ('t15_integridad', 't15 · Integridad global (conciliaciones)'),
]


def main():
    L.conectar()
    fallos_suites = []
    for modulo, titulo in SUITES:
        try:
            mod = __import__(modulo)
            mod.main()
        except Exception as exc:  # noqa: BLE001
            L.rollback()
            L.CONTEO.setdefault(titulo, [0, 0])
            L.CONTEO[titulo][1] += 1
            print(f"  FAIL suite interrumpida: {type(exc).__name__}: {exc}", flush=True)
            traceback.print_exc(file=sys.stderr)
            fallos_suites.append((modulo, str(exc)))
    total_fail = L.resumen_final()
    if fallos_suites:
        print('\nSUITES INTERRUMPIDAS POR ERROR NO MANEJADO:')
        for m, e in fallos_suites:
            print(f'  {m}: {e[:160]}')
    L.conn.close()
    sys.exit(1 if total_fail else 0)


if __name__ == '__main__':
    main()
