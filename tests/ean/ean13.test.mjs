/* Prueba del codificador EAN-13 (resources/js/lib/barcode.js) y del cálculo del quiet zone.
 * Corre con: node tests/ean/ean13.test.mjs   (también en el CI de .github/workflows/ci.yml)
 * Valida: dígito de control contra el ejemplo clásico del estándar, estructura de 95 módulos,
 * derivación R/G desde L, ida y vuelta dibujar→decodificar y la garantía de zona blanca. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* barcode.js usa sintaxis ESM y el proyecto no es type:module; se importa por data-URL
 * para evaluar el archivo real del proyecto sin tocarlo. */
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = await readFile(join(raiz, 'resources', 'js', 'lib', 'barcode.js'), 'utf8');
const mod = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
const { barrasEan13, decodificarEan13, digitoControl, ean13Valido, moduloSeguro, tramosDe } = mod;

let fallos = 0;
const ok = (cond, nombre) => { console.log((cond ? 'OK  ' : 'FAIL') + ' ' + nombre); if (!cond) fallos++; };

/* 1. El ejemplo clásico del estándar EAN-13 */
ok(ean13Valido('5901234123457'), '5901234123457 válido (control = 7)');
ok(digitoControl('590123412345') === 7, 'dígito de control calculado = 7');
ok(!ean13Valido('1234567890123'), 'rechaza un control incorrecto');
ok(!ean13Valido('59012341234'), 'rechaza longitud corta');
ok(!ean13Valido('ABC'), 'rechaza letras');

/* 2. Estructura de la cadena de módulos */
const bits = barrasEan13('5901234123457');
ok(bits.length === 95, `cadena de módulos = 95 (${bits.length})`);
ok(bits.startsWith('101') && bits.slice(45, 50) === '01010' && bits.endsWith('101'), 'guardas 101 / 01010 / 101');
ok(bits.split('1').length - 1 === 49, 'módulos negros = 49 para el ejemplo');
ok(tramosDe(bits).length === 30, '30 tramos de barra (2+12+2+12+2)');

/* 3. Patrones: L impar (3 o 5 unos), cada uno de 7 módulos */
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
ok(L.every((p) => (p.split('1').length - 1) % 2 === 1 && p.length === 7), 'patrones L del estándar (7 módulos, unos impares)');

/* 4. Ida y vuelta: dibujar → decodificar → mismo número */
let ronda = true;
for (const c of ['200000000005', '210000000003', '200123456789', '779876543210', '400638133393']) {
    const completo = c + digitoControl(c);
    if (decodificarEan13(barrasEan13(completo)) !== completo) { ronda = false; console.log(`   desajuste: ${completo}`); }
}
ok(ronda, 'ida y vuelta dibujar→decodificar en 5 cuerpos');

/* 5. Códigos internos de producto (20…) y encargo (21…) */
const prod = '200000000005' + digitoControl('200000000005');
const enc = '210000000003' + digitoControl('210000000003');
ok(prod === '2000000000053' && decodificarEan13(barrasEan13(prod)) === prod, 'código interno de producto id 5 (…053)');
ok(enc === '2100000000036' && decodificarEan13(barrasEan13(enc)) === enc, 'código interno de encargo id 3 (…036)');

/* 6. Quiet zone: 95 + 22 módulos (11 de blanco por lado) deben caber en el ancho útil */
const casos = [[72, 0.55, 'término 80 mm'], [64.23, 0.5, 'hoja carta'], [72, 0.33, 'ticket de encargo']];
for (const [ancho, max, nombre] of casos) {
    const m = moduloSeguro(ancho, max);
    ok(m <= max && 117 * m <= ancho + 1e-9, `${nombre}: módulo ${m.toFixed(3)} mm deja quiet zone ≥ 11 módulos`);
}
ok(moduloSeguro(30, 0.5) === 0.264, 'ancho muy pequeño cae al mínimo estándar (80 % de magnificación)');

console.log(fallos ? `\n${fallos} FALLOS` : '\nTODAS LAS PRUEBAS EAN-13 PASARON');
process.exit(fallos ? 1 : 0);
