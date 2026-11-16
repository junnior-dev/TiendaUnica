# -*- coding: utf-8 -*-
"""Núcleo del E2E real: conexión a PostgreSQL (clon tienda_e2e), datos con Faker,
aserciones con contador por suite y resumen final.

Este harness corre EXACTAMENTE la misma lógica que la app Laravel usa en producción:
las funciones tienda.fn_* y los triggers/restricciones de la base. No hay atajos.
"""
import json
import os
import sys
import psycopg2
from faker import Faker

# Clon aislado: igual estructura y datos sembrados que la base real «tienda».
# La conexión sale de PGHOST/PGPORT (defaults del sandbox: socket /tmp, 5433).
DSN = dict(host=os.environ.get('PGHOST_PRUEBAS', '/tmp'),
           port=int(os.environ.get('PGPORT_PRUEBAS', '5433')),
           dbname='tienda_e2e', user=os.environ.get('PGUSER_PRUEBAS', 'postgres'),
           options='-c search_path=tienda,public -c TimeZone=America/Caracas')
conn = None
CONTEO = {}          # suite -> [ok, fail]
SUITE = ''
HUECOS_BASE = 0      # huecos de correlativo que ya trae la base sembrada

fake = Faker('es_ES')
fake.seed_instance(20261113)   # corrida reproducible


def rif(tipo=None):
    """RIF venezolano CON dígito de control real (mismo algoritmo de fn_validar_rif)."""
    tipo = tipo or fake.random_element(['J', 'J', 'J', 'V', 'E'])
    cuerpo = str(fake.random_number(digits=8, fix_len=True))
    v = {'V': 1, 'E': 2, 'J': 3, 'P': 4, 'G': 5, 'C': 3}[tipo]
    suma = v * 4
    for i, d in enumerate(cuerpo):
        suma += int(d) * [3, 2, 7, 6, 5, 4, 3, 2][i]
    dv = 11 - (suma % 11)
    if dv >= 10:
        dv = 0
    return f"{tipo}-{cuerpo}-{dv}"


def conectar():
    global conn
    global HUECOS_BASE
    conn = psycopg2.connect(**DSN)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SELECT count(*) FROM tienda.v_ventas_huecos")
    HUECOS_BASE = cur.fetchone()[0]
    cur.close()
    return conn


def empezar(nombre):
    global SUITE
    SUITE = nombre
    CONTEO.setdefault(nombre, [0, 0])
    print(f"\n== {nombre} ==", flush=True)


def ok(cond, nombre, detalle=''):
    CONTEO[SUITE][0 if cond else 1] += 1
    tag = 'OK  ' if cond else 'FAIL'
    extra = f"  [{detalle}]" if (detalle and not cond) else (f"  [{detalle}]" if detalle else '')
    print(f"  {tag} {nombre}{extra}", flush=True)
    return bool(cond)


def q1(sql, args=None):
    cur = conn.cursor()
    cur.execute(sql, args)
    r = cur.fetchone()
    cur.close()
    return r[0] if r else None


def ejecutar(sql, args=None):
    """UPDATE / INSERT / CALL: sin resultado que leer."""
    cur = conn.cursor()
    cur.execute(sql, args)
    cur.close()


def fila(sql, args=None):
    cur = conn.cursor()
    cur.execute(sql, args)
    r = cur.fetchone()
    if r is None:
        cur.close()
        return None
    cols = [d[0] for d in cur.description]
    cur.close()
    return dict(zip(cols, r))


def qd(sql, args=None):
    """Lista de filas como dicts (columnas con nombre)."""
    cur = conn.cursor()
    cur.execute(sql, args)
    cols = [d[0] for d in cur.description]
    r = cur.fetchall()
    cur.close()
    return [dict(zip(cols, row)) for row in r]


def qs(sql, args=None):
    cur = conn.cursor()
    cur.execute(sql, args)
    r = cur.fetchall()
    cur.close()
    return r


def ins(tabla, **vals):
    cols = ', '.join(vals)
    marks = ', '.join(['%s'] * len(vals))
    cur = conn.cursor()
    cur.execute(f"INSERT INTO tienda.{tabla} ({cols}) VALUES ({marks}) RETURNING *", list(vals.values()))
    r = cur.fetchone()[0]
    cur.close()
    return r


def _json_args(args):
    """psycopg2 no adapta dict/list a jsonb solo: los serializa como JSON."""
    return [json.dumps(a) if isinstance(a, (dict, list)) else a for a in args]


def fn(nombre, *args):
    """Llama tienda.fn_x(...) y devuelve el primer valor (o None)."""
    cur = conn.cursor()
    cur.execute(f"SELECT tienda.{nombre}({','.join(['%s'] * len(args))})", _json_args(args))
    r = cur.fetchone()
    cur.close()
    return r[0] if r else None


def fn_fila(nombre, *args):
    """Para funciones con OUT: devuelve dict columna→valor."""
    cur = conn.cursor()
    cur.execute(f"SELECT * FROM tienda.{nombre}({','.join(['%s'] * len(args))})", _json_args(args))
    r = cur.fetchone()
    cols = [d[0] for d in cur.description]
    cur.close()
    return dict(zip(cols, r)) if r else {}


def espera_error(nombre, callable_fn, *args, contiene=None):
    """Ejecuta esperando un error SQL; valida el mensaje y hace rollback para seguir."""
    try:
        callable_fn(*args)
        conn.rollback()
        ok(False, nombre, 'NO lanzó error cuando debía')
        return None
    except psycopg2.Error as e:
        conn.rollback()
        msg = e.diag.message_primary or str(e).strip()
        bien = (contiene.lower() in msg.lower()) if contiene else True
        ok(bien, nombre, '' if bien else f"mensaje inesperado: {msg[:140]}")
        return msg
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        ok(False, nombre, f"error no-SQL: {e}")
        return None


def commit():
    conn.commit()


def rollback():
    conn.rollback()


def admin():
    return q1("SELECT id FROM tienda.usuarios WHERE rol = 'ADMINISTRADOR' ORDER BY id LIMIT 1")


def cajero():
    u = q1("SELECT id FROM tienda.usuarios WHERE rol = 'CAJERO' AND activo ORDER BY id LIMIT 1")
    return u or admin()


def hoy():
    return fn('fn_hoy')


def resumen_final():
    print('\n' + '=' * 68)
    print('RESUMEN POR SUITE (pruebas reales contra PostgreSQL)')
    print('=' * 68)
    tot_ok = tot_fail = 0
    for s, (o, f) in CONTEO.items():
        print(f"  {s:<44} {o:>3} OK   {f:>3} FAIL")
        tot_ok += o
        tot_fail += f
    print('-' * 68)
    print(f"  {'TOTAL':<44} {tot_ok:>3} OK   {tot_fail:>3} FAIL")
    print('RESULTADO: ' + ('TODAS LAS PRUEBAS PASARON' if tot_fail == 0 else f'{tot_fail} PRUEBAS FALLARON'))
    print('=' * 68)
    return tot_fail
