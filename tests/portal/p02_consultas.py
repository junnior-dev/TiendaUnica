# -*- coding: utf-8 -*-
"""p02 · PANEL DEL PORTAL: filtros, orden y paginación en el servidor.
Las consultas las genera app/Support/PortalConsultas.php (php consultas.php las emite como JSON) y aquí se ejecutan
en PostgreSQL contra el esquema real del portal (33 + 34) con 30 tiendas de ejemplo."""
import json
import os
import subprocess
from datetime import date, timedelta

import e2e_lib as L

L.DSN['dbname'] = 'portal_saas'
AQUI = os.path.dirname(os.path.abspath(__file__))
EST = ['ACTIVO', 'ACTIVO', 'PRUEBA', 'MORA', 'SUSPENDIDO', 'CANCELADO']      # por i % 6


def correr(c):
    """Ejecuta [sql, binds] con parámetros posicionales (? → %s) y devuelve filas como dicts."""
    return L.qd(c[0].replace('?', '%s'), tuple(c[1]))


def main():
    hoy = date.today()
    L.empezar('p02 · PANEL: datos de ejemplo (30 tiendas, 12 reportes de pago, 14 cobros)')
    # El 34 (solicitudes de pago, cuentas) se instala aquí para no alterar los asertos de p01; se parte de un portal limpio.
    r = subprocess.run([os.environ.get('PSQL', 'psql'), '-h', '/tmp', '-p', os.environ.get('PGPORT_PRUEBAS', '5433'), '-U', 'postgres', '-d', 'portal_saas', '-v', 'ON_ERROR_STOP=1', '-q', '-f',
                        os.path.join(AQUI, '..', '..', 'database', 'sql', '34_portal_pagos.sql')], capture_output=True, text=True)
    L.ok(r.returncode == 0, '34_portal_pagos.sql se instala sobre el portal' + ('' if r.returncode == 0 else ': ' + r.stderr[:200]))
    L.rollback()
    L.ejecutar("DELETE FROM portal.negocios_portal")
    planes = [f['id'] for f in L.qd("SELECT id FROM portal.planes ORDER BY id")]      # las tiendas se reparten entre los 3 primeros
    ids = {}
    for i in range(1, 31):
        sub = 'oferta_100%' if i == 30 else f'tienda-{i:02d}'
        ids[i] = L.q1("INSERT INTO portal.negocios_portal (subdominio, negocio_id, plan_id, estado, vence_el, correo_facturacion, creado_en) "
                      "VALUES (%s, %s, %s, %s, %s, %s, now() - make_interval(days => %s)) RETURNING id",
                      (sub, 1000 + i, planes[i % 3], EST[i % 6], hoy + timedelta(days=i - 10), f'dueno{i}@correo.com', i))
    for i in range(1, 13):
        est = 'REPORTADO' if i % 4 == 0 else ('RECHAZADO' if i % 4 == 3 else 'VERIFICADO')
        L.ejecutar("INSERT INTO portal.solicitudes_pago (negocio_portal_id, periodo, moneda, monto_usd, banco_origen, referencia, pagado_el, estado, verificado_en, rechazo_motivo) "
                   "VALUES (%s, date_trunc('month', now())::date, 'USD', 60, 'Zelle', %s, %s, %s, CASE WHEN %s = 'REPORTADO' THEN NULL ELSE now() - make_interval(hours => %s) END, %s)",
                   (ids[i], f'REF-{i:04d}', hoy, est, est, i, 'No aparece en el banco' if est == 'RECHAZADO' else None))
    for i in range(1, 15):
        L.ejecutar("INSERT INTO portal.cobros (negocio_portal_id, periodo, monto, metodo, pagado_el, nota) VALUES (%s, date_trunc('month', now())::date, %s, %s, %s, %s)",
                   (ids[i], 60 if i % 2 else 80, 'Zelle' if i % 2 == 0 else 'Pago móvil', hoy, f'tienda {i}'))
    L.commit()
    L.ok(L.q1("SELECT count(*) FROM portal.negocios_portal") == 30, '30 tiendas cargadas')

    r = subprocess.run(['php', os.path.join(AQUI, 'consultas.php')], capture_output=True, text=True)
    L.ok(r.returncode == 0, 'PortalConsultas.php genera las consultas' + ('' if r.returncode == 0 else ': ' + r.stderr[:200]))
    C = json.loads(r.stdout)
    t = lambda k: correr(C[k]['filas'])          # noqa: E731
    total = lambda k: correr(C[k]['total'])[0]    # noqa: E731

    L.empezar('p02 · TIENDAS: orden por atención, paginación y total')
    p1, p3 = t('tiendas_p1'), t('tiendas_p3')
    L.ok(len(p1) == 10 and total('tiendas_p1')['n'] == 30, 'página 1: 10 filas de 30')
    L.ok([f['estado'] for f in p1[:5]] == ['MORA'] * 5 and [f['estado'] for f in p1[5:]] == ['SUSPENDIDO'] * 5, 'primero lo que pide atención: en mora y suspendidas')
    L.ok(len(p3) == 10 and [f['estado'] for f in p3[5:]] == ['CANCELADO'] * 5, 'página 3: las últimas 10, con las canceladas al final')
    L.ok(not ({f['id'] for f in p1} & {f['id'] for f in p3}), 'las páginas no se repiten filas')

    L.empezar('p02 · TIENDAS: filtros y búsqueda')
    m = t('tiendas_mora')
    L.ok(len(m) == 5 and total('tiendas_mora')['n'] == 5 and {f['estado'] for f in m} == {'MORA'}, 'filtro por estado En mora: 5 de 5')
    plan2 = L.q1("SELECT nombre FROM portal.planes WHERE id = 2")
    L.ok(len(t('tiendas_plan')) == 10 and {f['plan'] for f in t('tiendas_plan')} == {plan2}, 'filtro por plan: 10 tiendas del plan')
    L.ok(len(t('tiendas_q')) == 10, 'búsqueda «tienda-1» → 10 tiendas')
    L.ok([f['subdominio'] for f in t('tiendas_correo')] == ['tienda-07'], 'la búsqueda también mira el correo de facturación')
    L.ok([f['subdominio'] for f in t('tiendas_pct')] == ['oferta_100%'], 'un «%» se busca literal, no como comodín')
    L.ok([f['subdominio'] for f in t('tiendas_guion')] == ['oferta_100%'], 'un «_» se busca literal, no como comodín')
    L.ok([f['subdominio'] for f in t('tiendas_100')] == ['oferta_100%'], 'búsqueda «100%» → la tienda exacta')
    L.ok(len(t('tiendas_combo')) == 4, 'filtros combinados (al día + plan + texto) → 4 tiendas')

    L.empezar('p02 · TIENDAS: orden elegido por el usuario')
    v, rc, nm = t('tiendas_vence'), t('tiendas_recientes'), t('tiendas_nombre')
    L.ok([f['vence_el'] for f in v] == sorted(f['vence_el'] for f in v), 'orden «Vence pronto»: fechas ascendentes')
    L.ok([f['creado_en'] for f in rc] == sorted((f['creado_en'] for f in rc), reverse=True), 'orden «Más recientes»: alta descendente')
    L.ok([f['subdominio'] for f in nm] == sorted(f['subdominio'] for f in nm), 'orden «Nombre»: alfabético')

    L.empezar('p02 · SEGURIDAD: lo que llega del navegador no rompe nada')
    L.ok(len(t('tiendas_mala_orden')) == 30, 'un «orden» inventado cae al orden por defecto')
    L.ok(len(t('tiendas_mal_estado')) == 30, 'un «estado» inválido se ignora')
    L.ok(len(t('tiendas_inyeccion')) == 0 and L.q1("SELECT to_regclass('portal.cobros') IS NOT NULL"), 'intento de inyección SQL: 0 resultados y la tabla sigue ahí')
    L.ok(C['saneo'] == [10, 25, 10, 1, 7, 100000], 'tamaño de página y número de página saneados (1000→10, −5→1…)')
    mt = C['meta']
    L.ok(mt[0]['paginas'] == 3 and mt[1]['pagina'] == 3 and mt[2]['paginas'] == 1 and mt[3]['paginas'] == 4, 'meta: página pedida fuera de rango se ajusta; 31 filas → 4 páginas; vacío → 1')

    L.empezar('p02 · RESUMEN: por vencer y contadores')
    esp = sorted([(hoy + timedelta(days=i - 10), f'tienda-{i:02d}') for i in range(1, 31) if EST[i % 6] in ('ACTIVO', 'PRUEBA', 'MORA') and i - 10 <= 7])
    pv = correr(C['por_vencer'])
    L.ok([f['subdominio'] for f in pv] == [s for _, s in esp][:6], f'por vencer: las 6 con plazo más cercano (de {len(esp)} que vencen en 7 días o ya vencieron)')
    ce = {f['estado']: f['n'] for f in correr(C['conteos_estados'])}
    L.ok(sum(ce.values()) == 30 and ce['MORA'] == 5 and ce['ACTIVO'] == 10, f'contadores por estado suman 30: {ce}')
    L.ok(sum(f['n'] for f in correr(C['conteos_planes'])) == 30, 'contadores por plan suman 30')

    L.empezar('p02 · PAGOS: historial y cobros')
    L.ok(total('historial')['n'] == 9 and len(t('historial')) == 9, 'historial: 9 resueltos (los 3 reportados siguen en la cola)')
    L.ok(total('historial_ver')['n'] == 6 and {f['estado'] for f in t('historial_ver')} == {'VERIFICADO'}, 'filtro «Verificados»: 6')
    L.ok(total('historial_rech')['n'] == 3 and all(f['rechazo_motivo'] for f in t('historial_rech')), 'filtro «Rechazados»: 3, con su motivo')
    L.ok([f['referencia'] for f in t('historial_q')] == ['REF-0003'], 'búsqueda por referencia del pago')
    cb = total('cobros')
    L.ok(cb['n'] == 14 and abs(cb['suma'] - sum(60 if i % 2 else 80 for i in range(1, 15))) < 0.001, f'cobros: 14 registros, suma {cb["suma"]:.0f} US$')
    L.ok(total('cobros_q')['n'] == 7, 'búsqueda de cobros por método («zelle») → 7')
