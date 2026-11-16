/**
 * EAN-13 en JavaScript — el mismo algoritmo que app/Support/Ean13.php (que es quien asigna los
 * códigos internos). Aquí solo se dibuja: los dígitos ya llegan listos del backend.
 *
 *   barrasEan13('2000000000053') → cadena de 95 módulos ('0'/'1') según el estándar:
 *   guardas 101 / 01010 / 101, la mitad izquierda con patrones L/G según la paridad del
 *   primer dígito y la derecha en patrón R (inverso de L).
 *
 * Los patrones L se definen a mano (los 10 del estándar) y R y G se DERIVAN:
 *   R[i] = complemento(L[i])   ·   G[i] = reverso del complemento de L[i]
 * así la tabla no puede desincronizarse del estándar por un error de transcripción.
 */

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((p) => p.split('').map((b) => (b === '1' ? '0' : '1')).join(''));
const G = R.map((p) => p.split('').reverse().join(''));

/* Paridad de la mitad izquierda según el primer dígito (L = patrón impar, G = par). */
const PARIDAD = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Dígito de control de un cuerpo de 12 dígitos (pesos 1-3-1-3…). */
export const digitoControl = (cuerpo) => {
    const d = String(cuerpo);
    if (!/^\d{12}$/.test(d)) throw new Error(`El cuerpo de un EAN-13 tiene 12 dígitos: «${d}»`);
    let s = 0;
    for (let i = 0; i < 12; i++) s += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
    return (10 - (s % 10)) % 10;
};

/** ¿13 dígitos con su control correcto? */
export const ean13Valido = (codigo) => /^\d{13}$/.test(String(codigo)) && Number(String(codigo)[12]) === digitoControl(String(codigo).slice(0, 12));

/** Cadena de 95 módulos ('0' = blanco, '1' = barra negra) de un EAN-13 válido. */
export const barrasEan13 = (codigo) => {
    const c = String(codigo);
    if (!ean13Valido(c)) throw new Error(`EAN-13 inválido: «${c}»`);
    const d = c.split('').map(Number);
    const par = PARIDAD[d[0]];
    let bits = '101';
    for (let i = 0; i < 6; i++) bits += (par[i] === 'L' ? L : G)[d[1 + i]];
    bits += '01010';
    for (let i = 0; i < 6; i++) bits += R[d[7 + i]];
    return bits + '101';
};

/** Agrupa la cadena de módulos en tramos de barra negra contigua: [[inicio, ancho], …]. */
export const tramosDe = (bits) => {
    const r = [];
    let i = 0;
    while (i < bits.length) {
        let j = i;
        while (j < bits.length && bits[j] === bits[i]) j++;
        if (bits[i] === '1') r.push([i, j - i]);
        i = j;
    }
    return r;
};

/** Índices de las barras de las guardas (inicio 101, central 01010 y final 101) — se dibujan más largas.
 *  Cada guarda son DOS barras de 1 módulo (101 = barra, blanco, barra), no una barra sólida. */
export const esGuarda = (inicio, ancho) => ancho === 1 && (inicio === 0 || inicio === 2 || inicio === 46 || inicio === 48 || inicio === 92 || inicio === 94);

/** Mayor tamaño de módulo (mm) ≤ «maximo» que cabe en «anchoUtil» respetando el quiet zone del
 *  estándar EAN-13: 11 módulos de blanco a CADA lado del símbolo → deben caber 95 + 22 módulos.
 *  Si no caben ni a 80 % de magnificación (0,264 mm), devuelve ese mínimo: mejor apretado que sin zona. */
export const moduloSeguro = (anchoUtil, maximo = 0.5) => Math.max(Math.min(anchoUtil / 117, maximo), 0.264);

/** Decodificador inverso — solo para las pruebas: verifica que lo dibujado equivale al número. */
export const decodificarEan13 = (bits) => {
    if (bits.length !== 95 || bits.slice(0, 3) !== '101' || bits.slice(45, 50) !== '01010' || bits.slice(92) !== '101') return null;
    const invL = Object.fromEntries(L.map((p, i) => [p, i]));
    const invG = Object.fromEntries(G.map((p, i) => [p, i]));
    const invR = Object.fromEntries(R.map((p, i) => [p, i]));
    let paridad = '';
    const izq = [];
    for (let i = 0; i < 6; i++) {
        const p = bits.slice(3 + i * 7, 10 + i * 7);
        if (p in invL) { paridad += 'L'; izq.push(invL[p]); } else if (p in invG) { paridad += 'G'; izq.push(invG[p]); } else return null;
    }
    const primero = PARIDAD.indexOf(paridad);
    if (primero < 0) return null;
    const der = [];
    for (let i = 0; i < 6; i++) {
        const p = bits.slice(50 + i * 7, 57 + i * 7);
        if (!(p in invR)) return null;
        der.push(invR[p]);
    }
    return `${primero}${izq.join('')}${der.join('')}`;
};
