# -*- coding: utf-8 -*-
"""t16 · PÁGINAS INERTIA: prueba de humo de pantallas contra el servidor real.

Complemento de las suites de negocio (t01–t15, que prueban la lógica en la base):
esta suite prueba la CAPA DE PRESENTACIÓN — que cada página Inertia que sirve el
backend llegue bien formada y con su componente existente en el frontend.

Para cada URL se verifica (carga completa de Inertia):
  1. HTTP 200.
  2. El HTML trae el atributo data-page con el JSON de Inertia
     {component, props, url, version} (las 4 llaves, con versión no vacía).
  3. props no viene vacío (la página lleva sus datos).
  4. El componente existe como archivo resources/js/Pages/<Nombre>.jsx
     (si no existiera, el navegador mostraría "Page not found" de Inertia).

Las rutas GET que responden JSON (autocompletados, reportes, APIs internas) se
clasifican como «endpoint AJAX» y no cuentan como página: su lógica ya la cubren
las suites de negocio. Los redireccionamientos (p. ej. GET / → /dashboard) se
siguen hasta la página final y se anotan.

Cobertura: páginas públicas (invitado), todas las páginas del administrador
(incluidas páginas de detalle con datos reales creados por la misma suite vía
HTTP: apertura de caja, venta al contado, venta a crédito → CxC, compra,
modelo de moto, encargo), el panel del portal SaaS y las páginas del cajero.
"""
import html as htmllib
import json
import os
import re
import sys
import time
import urllib.parse

import psycopg2
import requests

BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:8000')
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CLAVE_ADMIN = 'PaginasTest2026'
# Sufijo por corrida: datos únicos para poder relanzar la suite sin limpiar la base.
SUF = str(int(time.time()) % 100000)

OK = 0
FAIL = 0
HALLAZGOS = []


def ok(cond, nombre, detalle=''):
    global OK, FAIL
    if cond:
        OK += 1
        print(f'  OK   {nombre}', flush=True)
    else:
        FAIL += 1
        HALLAZGOS.append(f'{nombre} {detalle}'.strip())
        print(f'  FAIL {nombre} {detalle}', flush=True)


def db1(sql, params=()):
    con = psycopg2.connect(host=os.environ.get('PGHOST_PRUEBAS', '/tmp'),
                           port=int(os.environ.get('PGPORT_PRUEBAS', '5433')),
                           dbname='tienda', user='postgres')
    try:
        cur = con.cursor()
        cur.execute(sql, params)
        r = cur.fetchone()
        cur.close()
        return r[0] if r else None
    finally:
        con.close()


def csrf(s):
    """Token CSRF que Laravel comparte en la cookie XSRF-TOKEN (viaja cifrado)."""
    tok = s.cookies.get('XSRF-TOKEN')
    return urllib.parse.unquote(tok) if tok else None


def entrar_como(username, password):
    """Sesión nueva + POST /login real (el sistema ve un navegador cualquiera)."""
    s = requests.Session()
    s.headers['Accept'] = 'text/html, application/xhtml+xml'
    s.get(f'{BASE}/login')
    r = s.post(f'{BASE}/login', data={'username': username, 'password': password},
               headers={'X-XSRF-TOKEN': csrf(s)}, allow_redirects=False)
    return s, r


def pagina(s, url, etiqueta):
    """GET (siguiendo redirecciones) y validar la página Inertia. Devuelve el JSON data-page o None."""
    r = s.get(f'{BASE}{url}', allow_redirects=False)
    nota = ''
    saltos = 0
    while r.status_code in (301, 302, 303, 307, 308) and saltos < 4:
        destino = r.headers.get('Location', '')
        nota = f' (redirige a {destino})'
        r = s.get(urllib.parse.urljoin(f'{BASE}/', destino), allow_redirects=False)
        saltos += 1
    ctype = r.headers.get('Content-Type', '')
    if r.status_code != 200:
        ok(False, f'{etiqueta} [{url}]', f'→ HTTP {r.status_code} {ctype[:40]}')
        return None
    if 'application/json' in ctype:
        ok(True, f'{etiqueta} [{url}] → endpoint JSON (no es página)')
        return None
    m = re.search(r'data-page="([^"]*)"', r.text)
    if not m:
        ok(False, f'{etiqueta} [{url}]', 'HTML sin data-page (¿la página es Inertia?)')
        return None
    d = json.loads(htmllib.unescape(m.group(1)))
    comp = d.get('component')
    props = d.get('props') or {}
    bien_estructura = all(k in d for k in ('component', 'props', 'url', 'version')) and bool(d.get('version'))
    archivo = os.path.join(RAIZ, 'resources', 'js', 'Pages', f'{comp}.jsx')
    existe = os.path.isfile(archivo)
    ok(bien_estructura and existe and len(props) > 0,
       f'{etiqueta} [{url}] → {comp} · {len(props)} props{nota}',
       '' if (bien_estructura and existe and props) else
       f'estructura={bien_estructura} archivo={existe} props={len(props)}')
    return d


def enviar(s, url, datos=None, jsonp=None):
    """POST con CSRF, SIN seguir redirects (para que un redirect no se cuele como 200).
    Con jsonp se envía JSON (como lo hace el frontend Inertia/fetch) — imprescindible
    para payloads anidados (items, pagos): como form-data, requests aplana los
    diccionarios y Laravel los recibiría como texto (validación → redirect 302)."""
    if jsonp is not None:
        r = s.post(f'{BASE}{url}', json=jsonp,
                   headers={'X-XSRF-TOKEN': csrf(s), 'X-Requested-With': 'XMLHttpRequest',
                            'Accept': 'application/json'}, allow_redirects=False)
    else:
        r = s.post(f'{BASE}{url}', data=datos, headers={'X-XSRF-TOKEN': csrf(s)}, allow_redirects=False)
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, {}


def main():
    print('== t16 · Páginas Inertia (humo de pantallas contra servidor real) ==', flush=True)
    print(f'    base: {BASE}', flush=True)

    # ── 1. Invitado: lo que ve cualquiera sin sesión ─────────────────────────
    print('\n-- Invitado (páginas públicas) --', flush=True)
    publico = requests.Session()
    publico.headers['Accept'] = 'text/html, application/xhtml+xml'
    pagina(publico, '/login', 'Invitado · Iniciar sesión')
    pagina(publico, '/registro', 'Invitado · Registro del primer admin')
    pagina(publico, '/crear-cuenta', 'Invitado · Registro self-service SaaS')
    pagina(publico, '/precios', 'Invitado · Precios de planes')
    pagina(publico, '/portal/login', 'Invitado · Login del portal')
    r = publico.get(f'{BASE}/dashboard', allow_redirects=False)
    ok(r.status_code in (301, 302), f'Invitado sin sesión → /dashboard te manda al login (HTTP {r.status_code})',
       'el grupo auth protege las pantallas privadas')

    # ── 2. Administrador de la tienda ────────────────────────────────────────
    print('\n-- Administrador: entrar --', flush=True)
    s, r = entrar_como('admin', CLAVE_ADMIN)
    ok(r.status_code in (301, 302), f'POST /login con credenciales válidas (HTTP {r.status_code})')
    d_dash = pagina(s, '/dashboard', 'Admin · Panel del negocio')
    ok(d_dash is not None, 'Admin · sesión válida sirviendo páginas')

    print('\n-- Administrador: pantallas generales --', flush=True)
    for url, etiqueta in [
        ('/', 'Admin · Entrada (redirect a inicio)'),
        ('/cuenta/contrasena', 'Admin · Cambiar contraseña'),
        ('/usuarios', 'Admin · Usuarios y accesos'),
        ('/productos', 'Admin · Productos'),
        ('/kardex', 'Admin · Existencias y kardex'),
        ('/clientes', 'Admin · Clientes'),
        ('/proveedores', 'Admin · Proveedores'),
        ('/categorias', 'Admin · Categorías'),
        ('/marcas', 'Admin · Marcas'),
        ('/modelos', 'Admin · Modelos de motos'),
        ('/compatibilidad', 'Admin · Compatibilidad'),
        ('/tasas', 'Admin · Tasas de cambio'),
        ('/metodos-pago', 'Admin · Métodos de pago'),
        ('/configuracion', 'Admin · Configuración'),
        ('/suscripcion', 'Admin · Suscripción de la tienda'),
        ('/reportes', 'Admin · Reportes'),
        ('/conciliacion', 'Admin · Conciliación'),
        ('/cierre-caja', 'Admin · Cierre de caja'),
        ('/movimientos-caja', 'Admin · Movimientos de caja'),
    ]:
        pagina(s, url, etiqueta)

    print('\n-- Administrador: módulo fiscal --', flush=True)
    for url, etiqueta in [
        ('/libros-fiscales', 'Fiscal · Libros (resumen)'),
        ('/libros-fiscales?vista=ventas', 'Fiscal · Libro de ventas'),
        ('/libros-fiscales?vista=compras', 'Fiscal · Libro de compras'),
        ('/libros-fiscales?vista=retenciones', 'Fiscal · Retenciones de IVA'),
        ('/libros-fiscales?vista=igtf', 'Fiscal · IGTF'),
        ('/libros-fiscales?vista=notas', 'Fiscal · Notas de crédito'),
        ('/libros-fiscales?vista=alicuotas', 'Fiscal · Alícuotas'),
        ('/retenciones-islr', 'Fiscal · Retenciones ISLR'),
        ('/declaracion-islr', 'Fiscal · Declaración ISLR'),
        ('/calendario-fiscal', 'Fiscal · Calendario'),
    ]:
        pagina(s, url, etiqueta)

    # ── 3. Datos reales por HTTP para las páginas de detalle ────────────────
    print('\n-- Administrador: crear datos reales (POS, compra, modelo, encargo) --', flush=True)
    pid = db1('SELECT min(id) FROM tienda.productos WHERE stock_actual > 0')
    cid = db1('SELECT min(id) FROM tienda.clientes WHERE activo')
    prid = db1('SELECT min(id) FROM tienda.proveedores WHERE activo')
    mpid = db1('SELECT min(id) FROM tienda.metodos_pago WHERE activo')
    ok(all(v is not None for v in (pid, cid, prid, mpid)),
       f'datos semilla disponibles (producto {pid}, cliente {cid}, proveedor {prid}, método {mpid})')

    st, _ = enviar(s, '/caja/apertura', {'fondo_inicial_usd': 100, 'fondo_inicial_ves': 3650})
    ok(st in (200, 422), f'POST /caja/apertura → turno abierto (HTTP {st}; 422 = ya había turno)')

    st, cot = enviar(s, '/caja/cotizar', jsonp={'items': [{'producto_id': pid, 'cantidad': 1}]})
    total = round(float((cot or {}).get('total_usd') or 0), 2)
    ok(st == 200 and total > 0, f'POST /caja/cotizar → total de la venta: {total} USD (HTTP {st})')
    st, venta = enviar(s, '/caja/venta', jsonp={'items': [{'producto_id': pid, 'cantidad': 1}],
                                                'pagos': [{'metodo_pago_id': mpid, 'monto': total}]})
    ok(st == 200, f'POST /caja/venta (contado, pago exacto) → venta real (HTTP {st})')
    vid = (venta or {}).get('id') or db1('SELECT max(id) FROM tienda.ventas')

    st, venta_cr = enviar(s, '/caja/venta', jsonp={'items': [{'producto_id': pid, 'cantidad': 1}],
                                                   'es_credito': True, 'dias_credito': 15, 'cliente_id': cid})
    ok(st == 200, f'POST /caja/venta (crédito) → cuenta por cobrar real (HTTP {st})')
    cxcid = db1("SELECT max(id) FROM tienda.cuentas_por_cobrar WHERE estado = 'PENDIENTE'")

    st, compra = enviar(s, '/compras', jsonp={'proveedor_id': prid, 'numero_factura': f'T16-{SUF}',
                                              'fecha_factura': str(db1('SELECT tienda.fn_hoy()')), 'moneda': 'USD',
                                              'credito_fiscal': True,
                                              'items': [{'producto_id': pid, 'cantidad': 5, 'costo_unitario': 2.5}]})
    ok(st == 200, f'POST /compras → compra real (HTTP {st})')
    coid = (compra or {}).get('id')

    st, _ = enviar(s, '/modelos', {'marca': 'AKT', 'modelo': f'NKD 125 t{SUF}', 'cilindrada': 125})
    ok(st in (200, 302), f'POST /modelos → modelo de moto real (HTTP {st})')
    mid = db1('SELECT max(id) FROM tienda.motos_modelos WHERE modelo = %s', (f'NKD 125 t{SUF}',))

    st, encargo = enviar(s, '/encargos', {'cliente_id': cid, 'descripcion': f'Cilindro tunado 125 (prueba t16 {SUF})',
                                          'producto_id': pid})
    ok(st == 200, f'POST /encargos → encargo real (HTTP {st})')
    eid = (encargo or {}).get('id') or db1('SELECT max(id) FROM tienda.encargos')

    print('\n-- Administrador: páginas de detalle con datos reales --', flush=True)
    pagina(s, f'/productos/{pid}', 'Admin · Ficha de producto')
    pagina(s, f'/clientes/{cid}', 'Admin · Ficha de cliente')
    pagina(s, f'/proveedores/{prid}', 'Admin · Ficha de proveedor')
    if mid:
        pagina(s, f'/modelos/{mid}', 'Admin · Detalle de modelo')
        pagina(s, f'/compatibilidad/{mid}/candidatos', 'Admin · Candidatos de compatibilidad (AJAX)')
    if vid:
        pagina(s, f'/ventas/{vid}', 'Admin · Venta registrada')
    if coid:
        pagina(s, f'/compras/{coid}', 'Admin · Compra registrada')
    if eid:
        pagina(s, f'/encargos/{eid}', 'Admin · Encargo de pieza')
    if cxcid:
        pagina(s, f'/cuentas-por-cobrar/{cxcid}', 'Admin · Cuenta por cobrar')
        pagina(s, f'/cuentas-por-cobrar/cliente/{cid}', 'Admin · Estado de cuenta del cliente (AJAX)')

    # ── 4. Panel del portal SaaS ─────────────────────────────────────────────
    print('\n-- Portal SaaS (super administrador) --', flush=True)
    clave_portal = ''
    with open(os.path.join(RAIZ, '.env'), encoding='utf-8') as f:
        for linea in f:
            if linea.startswith('PORTAL_ADMIN_PASSWORD='):
                clave_portal = linea.split('=', 1)[1].strip().strip('"\'')
                break
    p = requests.Session()
    p.headers['Accept'] = 'text/html, application/xhtml+xml'
    p.get(f'{BASE}/portal/login')
    r = p.post(f'{BASE}/portal/login', data={'password': clave_portal}, headers={'X-XSRF-TOKEN': csrf(p)},
               allow_redirects=False)
    ok(r.status_code in (301, 302), f'POST /portal/login con la clave del .env (HTTP {r.status_code})')
    pagina(p, '/portal', 'Portal · Panel de tiendas y pagos')

    # ── 5. Cajero: lo que sí ve, lo que no ──────────────────────────────────
    print('\n-- Cajero (rol restringido) --', flush=True)
    usuario_cajero = f'cajero_t{SUF}'
    st, _ = enviar(s, '/usuarios', {'username': usuario_cajero, 'nombre': 'Cajero de Prueba T16',
                                    'rol': 'CAJERO', 'password': 'CajeroT16#2026'})
    ok(st == 200, f'POST /usuarios → cajero creado (HTTP {st})')
    sc, rc = entrar_como(usuario_cajero, 'CajeroT16#2026')
    ok(rc.status_code in (301, 302), 'POST /login del cajero (HTTP %s)' % rc.status_code)
    # El sistema fuerza el primer cambio de contraseña (debe_cambiar_password):
    # lo hacemos por la vía legítima, que además prueba el propio endpoint.
    st, _ = enviar(sc, '/cuenta/contrasena', {'actual': 'CajeroT16#2026', 'nueva': 'CajeroT16#2027',
                                              'nueva_confirmation': 'CajeroT16#2027'})
    ok(st in (200, 302), f'Cajero · cambia su contraseña temporal (HTTP {st})')
    for url, etiqueta in [
        ('/', 'Cajero · Entrada (redirect a /caja)'),
        ('/caja', 'Cajero · Punto de venta'),
        ('/ventas', 'Cajero · Sus ventas'),
        ('/encargos', 'Cajero · Encargos'),
        ('/combos', 'Cajero · Combos'),
        ('/cierre-caja', 'Cajero · Cierre de caja'),
        ('/cuentas-por-cobrar', 'Cajero · Cuentas por cobrar'),
        ('/cuenta/contrasena', 'Cajero · Cambiar contraseña'),
    ]:
        pagina(sc, url, etiqueta)
    r = sc.get(f'{BASE}/dashboard', allow_redirects=False)
    ok(r.status_code in (301, 302) and '/dashboard' not in (r.headers.get('Location') or ''),
       f'Cajero · /dashboard bloqueado por rol → {r.headers.get("Location") or "(sin redirigir)"}')

    # ── 6. Petición Inertia parcial (como el router SPA pide más datos) ─────
    print('\n-- Petición Inertia parcial (X-Inertia) --', flush=True)
    if d_dash:
        ver = d_dash.get('version')
        rp = s.get(f'{BASE}/dashboard', headers={'X-Inertia': 'true', 'X-Inertia-Version': ver or ''})
        try:
            j = rp.json()
            parcial = all(k in j for k in ('component', 'props', 'url', 'version'))
        except ValueError:
            j, parcial = {}, False
        ok(rp.status_code == 200 and parcial,
           f'GET /dashboard con X-Inertia → JSON parcial válido (HTTP {rp.status_code}, {len((j.get("props") or {}))} props)')

    # ── Resumen ──────────────────────────────────────────────────────────────
    print(f'\nRESUMEN t16: {OK} OK · {FAIL} FAIL', flush=True)
    if HALLAZGOS:
        print('HALLAZGOS:', flush=True)
        for h in HALLAZGOS:
            print(f'  - {h}', flush=True)
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
