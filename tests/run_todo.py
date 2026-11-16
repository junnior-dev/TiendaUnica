# -*- coding: utf-8 -*-
"""Orquestador TOTAL del proyecto: las 237 pruebas operativas (t01..t15, clon
tienda_e2e) más las 200 fiscales (f01..f17, clon tienda_fiscal) en una sola
corrida, con UN SOLO resumen y UN SOLO código de salida.

Uso:  python3 run_todo.py [salida.log]
Cada sub-runner reinicia su propio clon desde TEMPLATE tienda, así que las dos
suites no se contaminan entre sí. Sale 0 solo si TODAS las pruebas pasan."""
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent
RUNNERS = [
    (BASE / 'e2e' / 'run_all.py',    'OPERATIVAS  (t01..t15) · clon tienda_e2e'),
    (BASE / 'fiscal' / 'run_fiscal.py', 'FISCALES    (f01..f17) · clon tienda_fiscal'),
]
LINEA_TOTAL = re.compile(r'TOTAL\s+(\d+)\s+OK\s+(\d+)\s+FAIL')
# Rutas/puerto configurables (auditoría B-6): PSQL=/ruta/psql PGHOST=/tmp PGPORT=5433
PGSQL = os.environ.get('PSQL', 'psql')
PGHOST = os.environ.get('PGHOST_PRUEBAS', '/tmp')
PGPORT = os.environ.get('PGPORT_PRUEBAS', '5433')


def reset_clon(nombre):
    """Reinicia un clon de pruebas desde TEMPLATE tienda (con reintentos por lock)."""
    for intento in range(3):
        r = subprocess.run([PGSQL, '-h', PGHOST, '-p', PGPORT, '-U', 'postgres', '-d', 'postgres', '-tA',
                            '-c', f'DROP DATABASE IF EXISTS {nombre}',
                            '-c', f'CREATE DATABASE {nombre} TEMPLATE tienda'],
                           capture_output=True, text=True)
        if 'CREATE DATABASE' in (r.stdout + r.stderr):
            print(f'  clon {nombre} reiniciado desde TEMPLATE tienda')
            return True
        time.sleep(2)
    print(f'  ERROR: no se pudo reiniciar el clon {nombre}: {(r.stderr or r.stdout)[:150]}')
    return False


def main():
    salida = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / 'salida_total.log'
    salida.unlink(missing_ok=True)
    bloques, total_ok, total_fail, fallidos = [], 0, 0, []
    for runner, titulo in RUNNERS:
        clon = 'tienda_e2e' if 'OPERATIVAS' in titulo else 'tienda_fiscal'
        if not reset_clon(clon):
            total_fail += 1
            fallidos.append(titulo + ' (reset falló)')
            continue
        r = subprocess.run([sys.executable, str(runner)], capture_output=True, text=True)
        with open(salida, 'a', encoding='utf-8') as fh:
            fh.write('=' * 70 + f'\nCORRIDA TOTAL {datetime.now():%Y-%m-%d %H:%M:%S} — {titulo}\n' + '=' * 70 + '\n'
                     + r.stdout + ('\n[stderr]\n' + r.stderr if r.stderr.strip() else '') + '\n')
        m = LINEA_TOTAL.search(r.stdout)
        if m:
            ok, fail = int(m.group(1)), int(m.group(2))
            total_ok, total_fail = total_ok + ok, total_fail + fail
        else:
            total_fail += 1
            fail = '?'
        print(f'  {titulo}: {ok if m else "?"} OK · {fail} FAIL')
        if r.returncode != 0:
            fallidos.append(titulo)

    resumen = ['\n' + '=' * 70,
               'RESUMEN TOTAL DEL SISTEMA (237 operativas + 200 fiscales)', '=' * 70]
    per_suite = [linea for linea in '\n'.join(bloques).splitlines()
                 if 'OK' in linea and 'FAIL' in linea and linea.strip().startswith(('t', 'f'))]
    resumen += per_suite + ['-' * 70,
               f'  TOTAL GENERAL                               {total_ok} OK     {total_fail} FAIL',
               'RESULTADO: ' + ('TODAS LAS PRUEBAS PASARON' if total_fail == 0 and not fallidos
                                else 'HAY FALLOS — NO SE PUEDE FIRMAR'),
               '=' * 70]
    texto = '\n'.join(resumen)
    print(texto)
    with open(salida, 'a', encoding='utf-8') as fh:
        fh.write(texto + '\n')
    if fallidos:
        print('\nRUNNERS CON PROBLEMAS:')
        for t in fallidos:
            print('  ' + t)
    sys.exit(0 if total_fail == 0 and not fallidos else 1)


if __name__ == '__main__':
    main()
