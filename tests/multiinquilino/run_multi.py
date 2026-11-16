# -*- coding: utf-8 -*-
"""Orquestador de la suite multiinquilino: reinicia el clon «tienda_multi», aprovisiona
el negocio 2 (Bodega La Esquina) y corre m01→m09.

Uso: python3 run_multi.py [salida.log]"""
import os
import subprocess
import sys
import traceback

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'e2e'))
import e2e_lib as L  # noqa: E402
import m_lib as M  # noqa: E402

SUITES = [
    ('m01_sesion',      'm01 · SESIÓN: GUC app.negocio_id y estructura'),
    ('m02_sello',       'm02 · SELLO: INSERT sin negocio_id hereda la sesión'),
    ('m03_aislamiento', 'm03 · AISLAMIENTO DE LECTURA: tablas y vistas'),
    ('m04_cruces',      'm04 · ESCRITURA CRUZADA: USING filtra, WITH CHECK rechaza'),
    ('m05_funciones',   'm05 · FUNCIONES POR NEGOCIO: caja, venta, factura, régimen'),
    ('m06_unicidad',    'm06 · UNICIDAD POR NEGOCIO: documentos y códigos'),
    ('m07_exportar',    'm07 · PORTABILIDAD: el cliente puede llevarse sus datos'),
    ('m08_suspension',  'm08 · GUARDA DE SESIÓN y SUSPENSIÓN POR MORA'),
    ('m09_importar',    'm09 · IMPORTAR: restaurar un negocio con ids remapeados'),
    ('m10_islr',        'm10 · ISLR ANUAL: declaración aislada por negocio'),
    ('m11_presentaciones', 'm11 · PRESENTACIONES DE VENTA: caja, docena y pieza'),
    ('m12_islr_asientos', 'm12 · ISLR ANUAL: asientos contables'),
    ('m13_plan_basico', 'm13 · PLAN BÁSICO vs COMPLETO: se oculta, no se borra'),
]


def reset_clon():
    pg = os.environ.get('PSQL', 'psql')
    host = os.environ.get('PGHOST_PRUEBAS', '/tmp')
    puerto = os.environ.get('PGPORT_PRUEBAS', '5433')
    cmd = [pg, '-h', host, '-p', puerto, '-U', 'postgres', '-d', 'postgres', '-tA',
           '-c', 'DROP DATABASE IF EXISTS tienda_multi', '-c', 'CREATE DATABASE tienda_multi TEMPLATE tienda']
    r = subprocess.run(cmd, capture_output=True, text=True)
    if 'CREATE DATABASE' not in (r.stdout + r.stderr):
        raise RuntimeError('no se pudo recrear tienda_multi: ' + (r.stderr or r.stdout)[:200])


def main():
    reset_clon()
    L.conectar()
    M.provisionar_negocio_2()
    fallos_suites = []
    for modulo, titulo in SUITES:
        try:
            mod = __import__(modulo)
            mod.main()
        except Exception as exc:  # noqa: BLE001
            L.rollback()
            M.volver()
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
