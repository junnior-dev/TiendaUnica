// k6 · Manejador de sesión compartido por los escenarios.
// Laravel re-emite (re-encripta) la cookie de sesión y la XSRF-TOKEN en cada
// respuesta; la cookie de sesión se lleva a mano tomándose SIEMPRE del último
// Set-Cookie. El login NO sigue el redirect: la nueva cookie de sesión nace en
// el salto 302. El throttle del login (5/min por IP) obliga a crear las sesiones
// del pool a ritmo controlado en setup() — como cajeros entrando por la mañana.
import http from 'k6/http';
import { sleep } from 'k6';

export const BASE = 'http://127.0.0.1:8000';

let SES = null;   // { nombreSesion, valorSesion, token } de ESTA VU

function registrar(res) {
  const sc = (res.headers['Set-Cookie'] || '').split(/\n/);
  for (const linea of sc) {
    const ses = linea.match(/([A-Za-z0-9_-]*-session)=([^;]+)/);
    if (ses) {
      SES.nombreSesion = ses[1];
      SES.valorSesion = ses[2];
    }
    const xsrf = linea.match(/XSRF-TOKEN=([^;]+)/);
    if (xsrf) SES.token = decodeURIComponent(xsrf[1]);
  }
}

function post(url, cuerpo, tags, cabeceras = {}, params = {}) {
  const res = http.post(url, cuerpo, {
    headers: { 'X-XSRF-TOKEN': SES.token, Cookie: `${SES.nombreSesion}=${SES.valorSesion}`, ...cabeceras },
    tags: tags || {},
    ...params,
  });
  registrar(res);
  return res;
}

function get(url, tags, params = {}) {
  const res = http.get(url, {
    headers: { Cookie: `${SES.nombreSesion}=${SES.valorSesion}` },
    tags: tags || {},
    ...params,
  });
  registrar(res);
  return res;
}

/** Crea UNA sesión nueva (login completo) y deja SES apuntando a ella. */
export function crearSesion() {
  SES = { nombreSesion: null, valorSesion: null, token: '' };
  get(`${BASE}/login`);
  const res = post(`${BASE}/login`, { username: 'admin', password: 'PaginasTest2026' },
    null, { 'Content-Type': 'application/x-www-form-urlencoded' }, { redirects: 0 });
  if (res.status !== 302) {
    throw new Error(`El login de k6 no fue exitoso: status ${res.status}`);
  }
  const entrada = get(`${BASE}/dashboard`, { nombre: 'sesion' });
  if (entrada.status !== 200) {
    throw new Error('La sesión de k6 no quedó autenticada tras el login');
  }
  return { nombreSesion: SES.nombreSesion, valorSesion: SES.valorSesion, token: SES.token };
}

/** Crea `n` sesiones respetando el throttle del login (5/min por IP). */
export function crearPool(n, pausaMs = 14000) {
  const pool = [];
  for (let i = 0; i < n; i++) {
    pool.push(crearSesion());
    if (i < n - 1) sleep(pausaMs / 1000);
  }
  return pool;
}

/** Los VUs retoman SU sesión del pool al inicio de cada iteración. */
export function usarSesion(s) {
  SES = { nombreSesion: s.nombreSesion, valorSesion: s.valorSesion, token: s.token };
}

/** ¿La sesión murió? (la petición terminó en la pantalla de login) */
function sesionMuerta(res) {
  return typeof res.url === 'string' && res.url.includes('/login');
}

/** Abre la caja del admin (turno del POS). Si ya está abierta, sigue. */
export function abrirCaja() {
  const res = post(`${BASE}/caja/apertura`,
    // OJO: k6 NO serializa objetos a JSON aunque la cabecera lo diga; hay que
    // stringifyar a mano o Laravel recibe el payload vacío y responde 422.
    JSON.stringify({ fondo_inicial_usd: 100, fondo_inicial_ves: 3650 }),
    { nombre: 'apertura' },
    { 'Content-Type': 'application/json' });
  if (![200, 302, 422].includes(res.status)) {
    throw new Error(`La apertura de caja falló: status ${res.status}`);
  }
  return res;
}

/** Repone stock del producto 1 vía el endpoint de ajuste (camino real de la app). */
export function reponerStock(cantidad) {
  const res = post(`${BASE}/productos/1/ajustar`,
    JSON.stringify({ cantidad, motivo: 'Reposición para la prueba de carga k6' }),
    { nombre: 'ajuste' },
    { 'Content-Type': 'application/json' });
  // ESTRICTO a propósito: un 422 aquí (payload malformado, regla nueva del
  // endpoint…) dejaba el inventario en el del seed y TODAS las ventas de la
  // corrida empezaban a fallar en silencio cuando el stock se agotaba.
  if (![200, 302].includes(res.status)) {
    throw new Error(`El ajuste de stock falló: status ${res.status} → ${res.body.slice(0, 200)}`);
  }
  return res;
}

export function pagina(ruta, tags) {
  const res = get(`${BASE}${ruta}`, tags);
  if (sesionMuerta(res)) SES = null;
  return res;
}

export function cotizar(tags) {
  const res = post(`${BASE}/caja/cotizar`,
    JSON.stringify({ items: [{ producto_id: 1, cantidad: 1, descuento_pct: 0 }] }),
    tags, { 'Content-Type': 'application/json' });
  if (res.status !== 200 || sesionMuerta(res)) SES = null;
  return res;
}

export function venta(totalVes, referencia, tags) {
  const res = post(`${BASE}/caja/venta`, JSON.stringify({
    items: [{ producto_id: 1, cantidad: 1, descuento_pct: 0 }],
    pagos: [{ metodo_pago_id: 4, monto: totalVes, referencia }],
    es_credito: false,
  }), tags, { 'Content-Type': 'application/json' });
  if (res.status !== 200 || sesionMuerta(res)) SES = null;
  return res;
}
