# -*- coding: utf-8 -*-
"""Orquestador de la suite del portal: recrea «portal_saas» desde 33_portal.sql + 40_ciclo_cobro.sql
y corre el ciclo de vida comercial (p01).

Uso: python3 run_portal.py [salida.log]"""
import os
import subprocess
import sys
import traceback

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'e2e'))
import e2e_lib as L  # noqa: E402
import psycopg2  # noqa: E402

PG = os.environ.get('PSQL', 'psql')                 # ruta de psql de tu máquina
PUERTO = os.environ.get('PGPORT_PRUEBAS', '5433')   # puerto del PostgreSQL de pruebas
# MISMA lista que setup_db.py (scripts/infra): una recreación que omite el 34
# (cuentas de cobro) o el 42 (roles/grants de portal_app) deja el portal SIN la
# parte que t19 (M-6) y el ciclo de cobro ejercitan.
SQLS = [os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'database', 'sql', f)
        for f in ('33_portal.sql', '34_portal_pagos.sql', '40_ciclo_cobro.sql', '42_portal_rol.sql')]

SUITES = [
    ('p01_portal', 'p01 · PORTAL: ciclo de vida comercial completo'),
    ('p02_consultas', 'p02 · PANEL DEL PORTAL: filtros, orden y paginación'),
    ('p03_ciclo_cobro', 'p03 · CICLO DE COBRO: no pierde días, mora y suspensión automáticas'),
]


def reset_portal():
    r = subprocess.run([PG, '-h', os.environ.get('PGHOST_PRUEBAS', '/tmp'), '-p', PUERTO, '-U', 'postgres',
                        '-d', 'postgres', '-tA',
                        '-c', 'DROP DATABASE IF EXISTS portal_saas',
                        '-c', 'CREATE DATABASE portal_saas'], capture_output=True, text=True)
    if 'CREATE DATABASE' not in (r.stdout + r.stderr):
        raise RuntimeError('no se pudo recrear portal_saas: ' + (r.stderr or r.stdout)[:200])
    for sql in SQLS:
        r = subprocess.run([PG, '-h', '/tmp', '-p', PUERTO, '-U', 'postgres', '-d', 'portal_saas',
                            '-v', 'ON_ERROR_STOP=1', '-q', '-f', sql], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(os.path.basename(sql) + ' falló: ' + (r.stderr or r.stdout)[:400])


def main():
    reset_portal()
    L.DSN['dbname'] = 'portal_saas'
    # Conexión directa: conectar() presupone el esquema tienda (v_ventas_huecos),
    # que la base del portal no tiene.
    L.conn = psycopg2.connect(**L.DSN)
    L.conn.autocommit = False
    fallos = []
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
            fallos.append((modulo, str(exc)))
    total_fail = L.resumen_final()
    if fallos:
        print('\nSUITES INTERRUMPIDAS POR ERROR NO MANEJADO:')
        for m, e in fallos:
            print(f'  {m}: {e[:160]}')
    L.conn.close()
    sys.exit(1 if total_fail else 0)


if __name__ == '__main__':
    main()
