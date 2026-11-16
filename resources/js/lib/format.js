const nf = (min, max) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const F2 = nf(2, 2), F0 = nf(0, 0), F4 = nf(2, 4);

export const n2 = (v) => F2.format(v);
export const n0 = (v) => F0.format(v);
export const usd = (v) => `$ ${F2.format(v)}`;
export const bs = (v) => `Bs ${F2.format(v)}`;
/* Tasas pequeñas (COP) necesitan más decimales */
export const tasa = (v) => (v < 1 ? new Intl.NumberFormat('es-VE', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(v) : F4.format(v));
export const pct = (v, signo) => `${signo && v > 0 ? '+' : ''}${F2.format(v)} %`;

/* Monedas conocidas de entrada; cualquier otra que se agregue en Tasas se registra con registrarMonedas() y, si falta algo, se usa el código. */
const SIMBOLO_BASE = { USD: '$', EUR: '€', COP: 'COP', VES: 'Bs' };
const NOMBRE_BASE = { USD: 'Dólar', EUR: 'Euro', COP: 'Peso colombiano', VES: 'Bolívar' };
/* Un color por moneda, validados juntos (distinción para daltonismo y contraste ≥ 3:1). */
const COLOR_BASE = { USD: '#1E4FD6', EUR: '#0E9F8E', COP: '#C97300', VES: '#7A5AF8' };
const PALETA = ['#B4326E', '#2F7D32', '#8A4FD1', '#B5651D', '#1F7A99', '#6B6F1E', '#A63D2F', '#3F5BA9'];
const colorDe = (c) => PALETA[[...String(c)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % PALETA.length];
const conRespaldo = (base, respaldo) => new Proxy(base, { get: (t, k) => (typeof k === 'string' && !(k in t) ? respaldo(k) : t[k]) });
export const SIMBOLO = conRespaldo({ ...SIMBOLO_BASE }, (c) => c);
export const NOMBRE = conRespaldo({ ...NOMBRE_BASE }, (c) => c);
export const COLOR = conRespaldo({ ...COLOR_BASE }, colorDe);
/** Da de alta nombre y símbolo de monedas llegadas del servidor: [{ codigo, nombre, simbolo }]. */
export const registrarMonedas = (lista = []) => lista.forEach((m) => { if (!(m.codigo in SIMBOLO_BASE)) { SIMBOLO[m.codigo] = m.simbolo || m.codigo; NOMBRE[m.codigo] = m.nombre || m.codigo; } });
export const monto = (m, v) => (m === 'COP' ? `COP ${F0.format(v)}` : m === 'VES' ? bs(v) : `${SIMBOLO[m]} ${F2.format(v)}`);
