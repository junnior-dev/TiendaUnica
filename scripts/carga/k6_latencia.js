// k6 · Escenario 1: latencia base por endpoint clave (1 VU, 30 vueltas).
import { sleep, check } from 'k6';
import { BASE, crearPool, usarSesion, pagina, cotizar } from './sesion_k6.js';

const POOL = [];

export const options = {
  vus: 1, iterations: 30,
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  POOL.push(...crearPool(1));
  return POOL;
}

export default function (pool) {
  usarSesion(pool[__VU % pool.length]);
  check(pagina('/dashboard', { nombre: 'dashboard' }), { 'dashboard 200': (r) => r.status === 200 });
  check(pagina('/caja', { nombre: 'pos' }), { 'pos 200': (r) => r.status === 200 });
  check(pagina('/caja/buscar?q=Llanta', { nombre: 'buscar_pos' }), { 'buscar 200': (r) => r.status === 200 });
  check(cotizar({ nombre: 'cotizar' }), { 'cotizar 200': (r) => r.status === 200 && r.json('total_usd') > 0 });
  sleep(0.2);
}
