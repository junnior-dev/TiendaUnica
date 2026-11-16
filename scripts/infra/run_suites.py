#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Orquestador de TODAS las suites de pruebas del proyecto (DB-level):
e2e (t01..t15), fiscal (f01..f17), multiinquilino (m01..m13), portal (p01..p03).
Reinicia cada clon desde TEMPLATE tienda antes de cada suite. Uso:
  python3 run_suites.py [salida.log]
"""
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

BASE = Path(__file__).resolve().parents[2] / 'tests'
PY = sys.executable
# psql: primero el del entorno, luego el del PATH y como última alternativa los
# binarios del stack del sandbox (en CI el del PATH siempre está).
PGSQL = os.environ.get('PSQL') or shutil.which('psql') or next(
    (p for p in ('/home/z/my-project/work/stack/pg/bin/psql',
                 '/home/z/my-project/work/pgsql/postgresql-17.4.0-x86_64-unknown-linux-gnu/bin/psql')
     if os.path.isfile(p)), 'psql')

RUNNERS = [
    ('e2e/run_all.py',        'tienda_e2e',   'OPERATIVAS (t01..t15)'),
    ('fiscal/run_fiscal.py',  'tienda_fiscal','FISCALES (f01..f17)'),
    ('multiinquilino/run_multi.py', 'tienda_multi', 'MULTIINQUILINO (m01..m13)'),
    ('portal/run_portal.py',  'portal_saas',  'PORTAL (p01..p03)'),
]


def reset_clon(nombre: str, desde_template: bool) -> bool:
    """Reinicia un clon de pruebas (con reintentos por locks)."""
    host = os.environ.get('PGHOST', '/tmp')
    puerto = os.environ.get('PGPORT', '5433')
    for _ in range(4):
        cmds = ['-c', f'DROP DATABASE IF EXISTS {nombre}']
        if desde_template:
            cmds += ['-c', f'CREATE DATABASE {nombre} TEMPLATE tienda']
        r = subprocess.run([PGSQL, '-h', host, '-p', puerto, '-U', 'postgres', '-d', 'postgres', '-tA'] + cmds,
                           capture_output=True, text=True)
        if 'ERROR' not in (r.stderr or ''):
            return True
        time.sleep(2)
    print('  ERROR reset:', (r.stderr or r.stdout)[:200])
    return False


def main() -> int:
    salida = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp/pruebas_salida.log')
    salida.write_text('')
    import os
    import re
    env = dict(os.environ)
    env['PSQL'] = PGSQL
    env['PGHOST_PRUEBAS'] = os.environ.get('PGHOST', '/tmp')
    env['PGPORT_PRUEBAS'] = os.environ.get('PGPORT', '5433')
    # p02 (PortalConsultas) ejecuta tests/portal/consultas.php → necesita php en el
    # PATH. En el sandbox el php no está en el PATH sino en el stack compilado; en
    # CI (setup-php) sí está y este preprend se omite porque la carpeta no existe.
    php_stack = '/home/z/my-project/work/stack/php-8.3.32/sapi/cli'
    if os.path.isdir(php_stack):
        env['PATH'] = php_stack + os.pathsep + env.get('PATH', '')
    total_ok = total_fail = 0
    fallidas = []
    for runner, clon, titulo in RUNNERS:
        print(f'━━━ {titulo} · clon {clon}')
        # portal_saas se recrea dentro del runner (33+40+42); los otros desde TEMPLATE tienda
        template = 'portal_saas' not in clon
        if template and not reset_clon(clon, True):
            fallidas.append(titulo)
            continue
        r = subprocess.run([PY, str(BASE / runner)], capture_output=True, text=True, cwd=str(BASE / runner.split('/')[0]), env=env)
        out = (r.stdout + ('\n[stderr]\n' + r.stderr if r.stderr.strip() else ''))
        with open(salida, 'a', encoding='utf-8') as fh:
            fh.write('=' * 70 + f'\n{titulo}\n' + '=' * 70 + '\n' + out[-20000:] + '\n')
        m = re.search(r'TOTAL\s+(\d+)\s+OK\s+(\d+)\s+FAIL', out)
        if m:
            ok, fail = int(m.group(1)), int(m.group(2))
            total_ok += ok
            total_fail += fail
            print(f'  RESULTADO: {ok} OK / {fail} FAIL')
        else:
            print(f'  (sin línea TOTAL · salida en {salida.name})')
            fallidas.append(titulo + ' (sin resumen)')
    print(f'\n=== TOTALES: {total_ok} OK / {total_fail} FAIL ===')
    if fallidas:
        print('Suites con problemas:', fallidas)
    return 0 if total_fail == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
