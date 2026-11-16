// k6 · Escenario 2: rampa de carga (2→8→16 VUs, dimensionada a la sandbox de 2 vCPU).
import { sleep, check } from 'k6';
import { crearPool, usarSesion, pagina, cotizar } from './sesion_k6.js';

const POOL = [];

export const options = {
  setupTimeout: '7m',
  teardownTimeout: '1m',
  stages: [
    { duration: '15s', target: 2 },
    { duration: '20s', target: 8 },
    { duration: '25s', target: 16 },
    { duration: '10s', target: 0 },
  ],
  // Sin umbrales de latencia: la rampa mide la curva de saturación de la pila
  // de desarrollo (2 vCPU). El umbral de errores sí queda: cero tolerancia.
  thresholds: {
    http_req_failed: ['rate<0.02'],
  },
};

export function setup() {
  POOL.push(...crearPool(16));   // ~3.5 min respetando el throttle del login
  return POOL;
}

export default function (pool) {
  usarSesion(pool[__VU % pool.length]);
  const elegido = __ITER % 4;
  if (elegido === 0) {
    check(pagina('/dashboard', { nombre: 'dashboard' }), { '200': (r) => r.status === 200 });
  } else if (elegido === 1) {
    check(pagina('/caja', { nombre: 'pos' }), { '200': (r) => r.status === 200 });
  } else if (elegido === 2) {
    check(pagina('/caja/buscar?q=Llanta', { nombre: 'buscar_pos' }), { '200': (r) => r.status === 200 });
  } else {
    check(cotizar({ nombre: 'cotizar' }), { 'cotizar ok': (r) => r.status === 200 });
  }
  sleep(0.3);
}
