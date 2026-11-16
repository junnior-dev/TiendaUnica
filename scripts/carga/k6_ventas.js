// k6 · Escenario 3: throughput de VENTAS reales (10 cajas HTTP, 40 s).
import { check } from 'k6';
import { crearPool, usarSesion, cotizar, venta, abrirCaja, reponerStock } from './sesion_k6.js';
import { sleep } from 'k6';

const POOL = [];

export const options = {
  setupTimeout: '5m',
  vus: 10,
  duration: '40s',
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{nombre:venta}': ['p(95)<1200'],
  },
};

export function setup() {
  const pool = crearPool(10);   // ~2 min respetando el throttle del login
  usarSesion(pool[0]);
  abrirCaja();                  // el POS exige turno abierto para vender
  reponerStock(2000);           // 10 cajas × 40 s de ventas consumen inventario
  POOL.push(...pool);
  return POOL;
}

export default function (pool) {
  usarSesion(pool[__VU % pool.length]);
  const cot = cotizar({ nombre: 'cotizar' });
  if (!check(cot, { 'cotizar ok': (r) => r.status === 200 })) return;
  const res = venta(cot.json('total_ves'), `K6-${__VU}-${__ITER}`, { nombre: 'venta' });
  check(res, { 'venta 200': (r) => r.status === 200 && r.json('id') > 0 });
  sleep(0.35);   // pacing: ≤600/min por usuario (el throttle global autenticado)
}
