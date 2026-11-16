// Réplica de tienda.fn_validar_rif (letra + 8 dígitos + dígito verificador módulo 11).
const LETRA = { V: 1, E: 2, J: 3, P: 4, G: 5, C: 3 };
const PESOS = [3, 2, 7, 6, 5, 4, 3, 2];

export function normalizarRif(v) {
    const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return s.length === 10 ? `${s[0]}-${s.slice(1, 9)}-${s[9]}` : v.toUpperCase();
}

export function validarRif(v) {
    const m = /^([JGVECP])-?(\d{8})-?(\d)$/i.exec(v.trim());
    if (!m) return 'Formato inválido. Ejemplo: J-12345678-4';
    const suma = LETRA[m[1].toUpperCase()] * 4 + [...m[2]].reduce((a, d, i) => a + d * PESOS[i], 0);
    let dv = 11 - (suma % 11);
    if (dv >= 10) dv = 0;
    return dv === Number(m[3]) ? null : `Dígito verificador incorrecto (debería ser ${dv})`;
}
