# -*- coding: utf-8 -*-
"""t18 · E2E REAL DE NAVEGADOR (Playwright + Chromium headless contra php artisan serve).

t16 verificó que cada página Inertia LLEGA bien formada; esta suite abre un
navegador de verdad y comprueba que React MONTA cada pantalla, que los hooks y
formularios FUNCIONAN y que la consola queda limpia (0 console.error, 0 pageerror).

Flujos:
  n1 · LOGIN por formulario → el dashboard React renderiza con sus datos.
  n2 · POS contado: buscar producto, agregar línea, cobrar con Efectivo Bs,
       confirmar → la venta existe en la base (y el turno del cajero la registró).
  n3 · POS a crédito: activar «Venta a crédito», identificar cliente desde el
       modal, registrar a crédito → la cuenta por cobrar existe.
  n4 · Compra nueva: buscar proveedor, agregar producto con cantidad y costo,
       registrar → la compra existe.
  n5 · Cierre de caja: la página del cierre muestra el turno y los cortes Z.
  n6 · Módulo fiscal: libro de ventas/compras/retenciones/IGTF/notas/alícuotas,
       retenciones ISLR, declaración ISLR y calendario fiscal renderizan.
  n7 · Portal SaaS: login del operador por formulario → panel de tiendas y pagos.
  n8 · Resto de pantallas del administrador renderizan sin errores de consola.
  n9 · HUMO DEL PDF (jspdf 4): la venta real descarga un PDF válido (%PDF-) sin
       errores de consola — re-verificación tras el salto jspdf 2.5.2 → 4.2.1.

Requisito: playwright con chromium instalado (PLAYWRIGHT_BROWSERS_PATH por defecto).
"""
import os
import sys
import time
from pathlib import Path

import psycopg2
from playwright.sync_api import sync_playwright, expect

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / 'tests' / 'e2e'))
import e2e_lib as L  # noqa: E402  (aserciones y resumen; NO usa su conexión)

BASE = 'http://127.0.0.1:8000'
CLAVE_ADMIN = 'PaginasTest2026'
CLAVE_PORTAL = 'portal-demo-2026'
USUARIO = 'admin'

OK = 0
FAIL = 0


def ok(cond, nombre, detalle=''):
    global OK, FAIL
    if cond:
        OK += 1
        print(f'  OK   {nombre}', flush=True)
    else:
        FAIL += 1
        print(f'  FAIL {nombre} {detalle}'.rstrip(), flush=True)


def db1(sql):
    con = psycopg2.connect(host=os.environ.get('PGHOST_PRUEBAS', '/tmp'),
                           port=int(os.environ.get('PGPORT_PRUEBAS', '5433')),
                           dbname='tienda', user='postgres')
    try:
        cur = con.cursor()
        cur.execute("SELECT set_config('app.negocio_id', '1', false)")
        cur.execute(sql)
        r = cur.fetchone()
        cur.close()
        return r[0] if r else None
    finally:
        con.close()


class Consola:
    """Captura console.error y pageerror de una página (los acumula por etiqueta)."""

    def __init__(self, page, etiqueta):
        self.etiqueta = etiqueta
        self.errores = []
        page.on('console', lambda m: self.errores.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
        page.on('pageerror', lambda e: self.errores.append(f'pageerror: {e}\n{getattr(e, "stack", "")}'))

    def verificar(self, nombre):
        limpios = not self.errores
        ok(limpios, nombre, '' if limpios else f' → {self.errores[:3]}')
        self.errores = []
        return limpios


def login_admin(page):
    page.goto(f'{BASE}/login', wait_until='networkidle')
    page.get_by_label('Usuario', exact=True).fill(USUARIO)
    page.get_by_label('Contraseña', exact=True).fill(CLAVE_ADMIN)
    page.click('button[type="submit"]')
    page.wait_for_url(f'{BASE}/dashboard', timeout=15000)
    page.wait_for_load_state('networkidle')


def asegurar_turno_abierto(page):
    """Si el POS bloquea con el modal de apertura, abre la caja con un fondo."""
    modal = page.locator('[aria-label="Abrir caja"]')
    if modal.count() > 0 and modal.first.is_visible():
        page.get_by_label('Fondo inicial en dólares (USD)').fill('100')
        page.get_by_label('Fondo inicial en bolívares (Bs)').fill('3650')
        modal.locator('button:has-text("Abrir")').first.click()
        page.wait_for_timeout(900)


def elegir_cliente(page, cliente):
    """El negocio es contribuyente especial: toda venta necesita cliente identificado.
    Con el crédito activado, la caja ABRE el modal sola (setCredito) — se respeta."""
    dialogo = page.locator('[aria-label="Cliente de la venta"]')
    if not (dialogo.count() > 0 and dialogo.first.is_visible()):
        page.locator('button:has-text("Identificar al cliente"), button:has-text("Consumidor final")').first.click()
    dialogo.first.wait_for(state='visible', timeout=5000)
    page.get_by_label('Buscar por cédula, RIF o nombre').fill(cliente[:10])
    page.wait_for_timeout(700)
    page.locator('[role="dialog"] li button').first.click()
    page.wait_for_timeout(300)


def main():
    print('== t18 · E2E de navegador (Playwright + Chromium, sin errores de consola) ==', flush=True)
    fallos_totales = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={'width': 1366, 'height': 850}, locale='es-VE')

        # ── n1 · LOGIN + DASHBOARD ────────────────────────────────────────────
        L.empezar('n1 · LOGIN por formulario y dashboard React')
        page = ctx.new_page()
        c = Consola(page, 'login')
        page.goto(f'{BASE}/login', wait_until='networkidle')
        page.get_by_label('Usuario', exact=True).fill(USUARIO)
        page.get_by_label('Contraseña', exact=True).fill(CLAVE_ADMIN)
        page.click('button[type="submit"]')
        page.wait_for_url(f'{BASE}/dashboard', timeout=15000)
        page.wait_for_load_state('networkidle')
        ok(page.locator('h1').count() > 0, 'el dashboard React renderiza tras el login')
        c.verificar('n1 sin errores de consola ni excepciones')

        # ── n2 · POS CONTADO ──────────────────────────────────────────────────
        L.empezar('n2 · POS en el navegador: venta al contado con Efectivo Bs')
        c = Consola(page, 'pos')
        producto = db1("SELECT nombre FROM tienda.productos WHERE negocio_id = 1 AND activo AND stock_actual > 2 ORDER BY id LIMIT 1")
        cliente = db1("SELECT nombre FROM tienda.clientes WHERE negocio_id = 1 AND activo ORDER BY id LIMIT 1")
        ventas_antes = db1('SELECT count(*) FROM tienda.ventas')
        page.goto(f'{BASE}/caja', wait_until='networkidle')
        page.wait_for_timeout(300)
        asegurar_turno_abierto(page)
        page.wait_for_timeout(300)
        buscador = page.locator('input[role="combobox"]').first
        buscador.fill(producto[:12])
        page.wait_for_timeout(700)          # la búsqueda hace fetch AJAX
        opciones = page.locator('[role="option"]')
        ok(opciones.count() > 0, f'la búsqueda del POS encontró resultados para «{producto[:12]}…»',
           f'({opciones.count()} opciones)')
        opciones.first.click()
        page.wait_for_timeout(300)
        ok(page.get_by_text('Cobrar').count() > 0 or page.locator('button:has-text("Cobrar")').count() > 0,
           'la línea quedó en la venta y el botón Cobrar se habilitó')
        elegir_cliente(page, cliente)
        page.locator('button:has-text("Cobrar")').first.click()
        page.wait_for_timeout(400)
        page.locator('button:has-text("Efectivo Bs")').first.click()
        cubrir = page.locator('button:has-text("Cubrir resto")').first
        cubrir.wait_for(state='visible', timeout=5000)
        cubrir.click()
        confirmar = page.locator('button:has-text("Confirmar venta")').first
        expect(confirmar).to_be_enabled(timeout=5000)
        confirmar.click()
        page.wait_for_timeout(1200)         # router.post → re-render de Inertia
        ventas_despues = db1('SELECT count(*) FROM tienda.ventas')
        ok(ventas_despues == ventas_antes + 1,
           f'la venta quedó registrada en la base ({ventas_antes} → {ventas_despues})')
        c.verificar('n2 sin errores de consola ni excepciones')

        # ── n3 · POS A CRÉDITO ────────────────────────────────────────────────
        L.empezar('n3 · POS en el navegador: venta a crédito con cliente del modal')
        c = Consola(page, 'credito')
        cxc_antes = db1('SELECT count(*) FROM tienda.cuentas_por_cobrar')
        page.goto(f'{BASE}/caja', wait_until='networkidle')
        page.wait_for_timeout(300)
        asegurar_turno_abierto(page)
        page.wait_for_timeout(300)
        page.locator('input[role="combobox"]').first.fill(producto[:12])
        page.wait_for_timeout(700)
        page.locator('[role="option"]').first.click()
        page.wait_for_timeout(200)
        # activar el switch «Venta a crédito»
        page.locator('button[role="switch"][aria-label="Venta a crédito"]').click()
        page.wait_for_timeout(200)
        # identificar cliente (obligatorio por el régimen y por el crédito)
        elegir_cliente(page, cliente)
        # con crédito y cliente, el botón cambia a «Registrar crédito»
        page.locator('button:has-text("Registrar crédito")').first.click()
        page.wait_for_timeout(300)
        page.locator('button:has-text("Registrar a crédito")').first.click()
        page.wait_for_timeout(1200)
        cxc_despues = db1('SELECT count(*) FROM tienda.cuentas_por_cobrar')
        ok(cxc_despues == cxc_antes + 1,
           f'la venta a crédito creó su cuenta por cobrar ({cxc_antes} → {cxc_despues})')
        c.verificar('n3 sin errores de consola ni excepciones')

        # ── n4 · COMPRA NUEVA ─────────────────────────────────────────────────
        L.empezar('n4 · Compras en el navegador: registrar una compra')
        c = Consola(page, 'compras')
        compras_antes = db1('SELECT count(*) FROM tienda.compras')
        prov_nombre = db1("SELECT razon_social FROM tienda.proveedores WHERE negocio_id = 1 AND activo ORDER BY id LIMIT 1")
        page.goto(f'{BASE}/compras/nueva', wait_until='networkidle')
        page.wait_for_timeout(300)
        page.locator('[aria-label="Buscar proveedor"]').fill(prov_nombre[:6])
        page.wait_for_timeout(600)
        page.locator(f'ul li button:has-text("{prov_nombre[:10]}")').first.click()
        page.wait_for_timeout(300)
        # buscar producto para la línea
        page.locator('[aria-label="Buscar producto"]').fill(producto[:12])
        page.wait_for_timeout(600)
        page.locator(f'ul li button:has-text("{producto[:10]}")').first.click()
        page.wait_for_timeout(200)
        page.locator('[aria-label^="Cantidad de"]').first.fill('2')
        page.locator('[aria-label^="Costo unitario de"]').first.fill('1,50')
        # la compra exige el N.º de factura del proveedor (única por corrida:
        # el sistema rechaza una compra repetida con la misma factura → 422)
        page.get_by_label('N.º de factura', exact=True).fill(f'FC-{int(time.time()) % 100000}')
        page.locator('button:has-text("Registrar compra")').first.click()
        page.wait_for_timeout(1200)
        compras_despues = db1('SELECT count(*) FROM tienda.compras')
        ok(compras_despues == compras_antes + 1,
           f'la compra quedó registrada ({compras_antes} → {compras_despues})')
        c.verificar('n4 sin errores de consola ni excepciones')

        # ── n5 · CIERRE DE CAJA ───────────────────────────────────────────────
        L.empezar('n5 · Cierre de caja en el navegador')
        c = Consola(page, 'cierre')
        page.goto(f'{BASE}/cierre-caja', wait_until='networkidle')
        ok(page.locator('h1, h2, h3').all_inner_texts() != [],
           'la página del cierre de caja renderiza sus secciones',
           f'encabezados={page.locator("h1, h2, h3").all_inner_texts()[:3]}')
        c.verificar('n5 sin errores de consola ni excepciones')

        # ── n6 · MÓDULO FISCAL ────────────────────────────────────────────────
        L.empezar('n6 · Módulo fiscal en el navegador (6 vistas + ISLR + calendario)')
        c = Consola(page, 'fiscal')
        ok_f = True
        for vista in ('ventas', 'compras', 'retenciones', 'igtf', 'notas', 'alicuotas'):
            page.goto(f'{BASE}/libros-fiscales?vista={vista}', wait_until='networkidle')
            page.wait_for_timeout(150)
            if page.locator('table tbody tr').count() == 0 and page.locator('p').count() == 0:
                ok_f = False
        ok(ok_f, 'las 6 vistas de libros fiscales renderizan con tabla o vacío controlado')
        for ruta in ('/retenciones-islr', '/declaracion-islr', '/calendario-fiscal'):
            page.goto(f'{BASE}{ruta}', wait_until='networkidle')
            page.wait_for_timeout(150)
        ok(page.locator('h1, h2').count() > 0, 'retenciones ISLR, declaración y calendario renderizan')
        c.verificar('n6 sin errores de consola ni excepciones')

        # ── n7 · PORTAL SAAS ──────────────────────────────────────────────────
        L.empezar('n7 · Portal SaaS en el navegador: login del operador y panel')
        c = Consola(page, 'portal')
        page.goto(f'{BASE}/portal/login', wait_until='networkidle')
        page.get_by_label('Contraseña del operador').fill(CLAVE_PORTAL)
        page.locator('button[type="submit"]').click()
        page.wait_for_url(f'{BASE}/portal', timeout=15000)
        page.wait_for_load_state('networkidle')
        ok(page.get_by_text('Pagos por verificar').count() > 0 or page.locator('table tbody tr').count() > 0,
           'el panel del portal renderiza (resumen, tiendas y pagos por verificar)')
        c.verificar('n7 sin errores de consola ni excepciones')

        # ── n8 · RESTO DE PANTALLAS ───────────────────────────────────────────
        L.empezar('n8 · Resto de pantallas del administrador (React monta sin errores)')
        c = Consola(page, 'admin')
        sesion_portal = ctx.new_page()
        c2 = Consola(sesion_portal, 'admin2')
        # misma sesión ya autenticada: /login redirige al dashboard; se entra directo
        sesion_portal.goto(f'{BASE}/dashboard', wait_until='networkidle')
        bien = True
        for ruta in ('/usuarios', '/productos', '/clientes', '/proveedores', '/kardex',
                     '/modelos', '/compatibilidad', '/tasas', '/metodos-pago', '/configuracion',
                     '/suscripcion', '/reportes', '/conciliacion', '/movimientos-caja', '/combos',
                     '/cuentas-por-cobrar', '/ventas', '/encargos'):
            sesion_portal.goto(f'{BASE}{ruta}', wait_until='networkidle')
            sesion_portal.wait_for_timeout(120)
            if sesion_portal.locator('#app[data-page]').count() == 0:
                bien = False
        ok(bien, '18 pantallas montan su página Inertia en el DOM')
        c2.verificar('n8 sin errores de consola ni excepciones')

        # ── n9 · HUMO DEL PDF (jspdf 4.2.1) ───────────────────────────────────
        # El salto jspdf 2.5.2 → 4.2.1 tiene cambios de API; el único comprobante
        # honesto es descargar el PDF DE UNA VENTA REAL desde el navegador y
        # verificar que nace válido (%PDF-) y con contenido.
        L.empezar('n9 · Humo del PDF con jspdf 4: la venta descarga un PDF válido')
        c = Consola(page, 'pdf')
        page.goto(f'{BASE}/ventas', wait_until='networkidle')
        page.wait_for_timeout(400)
        fila = page.locator('[role="button"][aria-label^="Ver la venta"]').first
        fila.wait_for(state='visible', timeout=8000)
        fila.click()
        page.wait_for_timeout(800)          # el detalle (modal) carga sus props
        boton = page.locator('button:has-text("Descargar PDF")').first
        boton.wait_for(state='visible', timeout=8000)
        destino_pdf = '/tmp/rg_ticket_e2e.pdf'
        with page.expect_download(timeout=20000) as descarga:
            boton.click()
        descarga.value.save_as(destino_pdf)
        pdf_bytes = open(destino_pdf, 'rb').read()
        ok(pdf_bytes[:5] == b'%PDF-', 'el PDF nace con la firma %PDF- (jsPDF 4 genera un documento válido)',
           f'primeros bytes={pdf_bytes[:8]!r}')
        ok(len(pdf_bytes) > 1000, f'el PDF tiene contenido ({len(pdf_bytes):,} bytes)')
        c.verificar('n9 sin errores de consola ni excepciones (jspdf 4 no rompe el ticket)')

        browser.close()

    print('\n' + '=' * 68)
    print(f'RESUMEN t18: {OK} OK · {FAIL} FAIL')
    print('RESULTADO: ' + ('TODAS LAS PRUEBAS PASARON' if FAIL == 0 else f'{FAIL} PRUEBAS FALLARON'))
    print('=' * 68)
    return 0 if FAIL == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
