"""Prueba de carga HTTP (Locust) contra Laravel 12 + Inertia + PostgreSQL.

Simula usuarios operando el POS de Tienda Única (Repuestos de Motos):
  · Login inicial con CSRF (1 sesión compartida para no chocar con el throttle de /login)
  · Dashboard (/dashboard) y Catálogo (/productos)
  · Punto de venta (/caja), búsqueda (/caja/buscar) y cotización (/caja/cotizar)
  · Observabilidad (/health/sistema)

Uso:
  python -m locust -f scripts/carga/locustfile.py --headless -u 20 -r 5 -t 15s --host http://127.0.0.1:8020
"""
import re
import requests
from locust import HttpUser, between, events, task

SHARED_COOKIES = {}
SHARED_CSRF = ''


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    global SHARED_COOKIES, SHARED_CSRF
    s = requests.Session()
    r = s.get(f'{environment.host}/login', timeout=15)
    m = re.search(r'<meta name="csrf-token" content="([^"]+)"', r.text)
    token = m.group(1) if m else ''
    resp = s.post(
        f'{environment.host}/login',
        data={'_token': token, 'username': 'admin', 'password': 'PaginasTest2026'},
        headers={'X-CSRF-TOKEN': token},
        timeout=15,
    )
    m2 = re.search(r'<meta name="csrf-token" content="([^"]+)"', resp.text)
    SHARED_CSRF = m2.group(1) if m2 else token
    SHARED_COOKIES = s.cookies.get_dict()


class CajeroPosUser(HttpUser):
    wait_time = between(0.2, 0.6)

    def on_start(self):
        for k, v in SHARED_COOKIES.items():
            self.client.cookies.set(k, v)

    @task(3)
    def buscar_repuesto(self):
        self.client.get('/caja/buscar?q=Aceite', name='GET /caja/buscar')

    @task(2)
    def cotizar_venta(self):
        self.client.post(
            '/caja/cotizar',
            json={'items': [{'producto_id': 1, 'cantidad': 1, 'descuento_pct': 0}]},
            headers={
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRF-TOKEN': SHARED_CSRF,
            },
            name='POST /caja/cotizar',
        )

    @task(2)
    def abrir_caja_ui(self):
        self.client.get('/caja', name='GET /caja')

    @task(1)
    def dashboard_y_productos(self):
        self.client.get('/dashboard', name='GET /dashboard')
        self.client.get('/productos', name='GET /productos')

    @task(1)
    def health_sistema(self):
        self.client.get('/health/sistema', name='GET /health/sistema')
