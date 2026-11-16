/**
 * Ticket térmico de 80 mm del Corte X (parcial) y del Corte Z (cierre del turno de caja). Courier 8,5 pt, 40 columnas, alto dinámico.
 *   const pdf = await construirTicketCorte({ tipo: 'Z', numero, resumen, conteo, diferencia, cerrado_por, cerrado_en });
 *   imprimirTicketCorte(pdf, 'corte-z-000123.pdf');     // abre el PDF con el diálogo de impresión
 * `resumen` es la respuesta de fn_resumen_apertura (+ emisor): apertura, ventas, metodos, ingresos, egresos, monedas, igtf_*.
 * Solo texto ASCII/Latin-1: las fuentes base de PDF no dibujan símbolos como «−» o «→».
 */
import { n0, n2 } from './format';

const COLS = 40, ANCHO = 80, MARGEN = 4, LH = 3.55, FS = 8.5;
const SIM = { USD: '$', EUR: 'EUR', VES: 'Bs', COP: 'COP' };
const num = (m, v) => (m === 'COP' ? n0(v) : n2(v));
const mon = (m, v) => `${SIM[m] || m} ${num(m, v)}`;
const fecha = (iso) => {
    const d = iso ? new Date(iso) : new Date();
    return new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Caracas', hour12: false }).format(d);
};

/** Parte un texto en líneas de hasta `n` caracteres sin cortar palabras (palabras muy largas sí se cortan). */
function envolver(t, n = COLS) {
    const out = []; let linea = '';
    for (let w of String(t ?? '').split(/\s+/).filter(Boolean)) {
        while (w.length > n) { if (linea) { out.push(linea); linea = ''; } out.push(w.slice(0, n)); w = w.slice(n); }
        if (!linea) linea = w; else if ((linea + ' ' + w).length <= n) linea += ' ' + w; else { out.push(linea); linea = w; }
    }
    if (linea) out.push(linea);
    return out;
}

export async function construirTicketCorte(d) {
    const r = d.resumen;
    const esZ = d.tipo === 'Z';
    const L = []; // { t: texto, b: negrita, c: centrado }
    const l = (t = '', b = false) => L.push({ t, b });
    const c = (t, b = false) => envolver(t).forEach((x) => L.push({ t: x, b, c: true }));
    const kv = (a, v, b = false) => { const av = String(a); const vv = String(v); l(av.length + vv.length + 1 > COLS ? av.slice(0, Math.max(0, COLS - vv.length - 1)) + ' ' + vv : av + ' '.repeat(COLS - av.length - vv.length) + vv, b); };
    const hr = (ch = '-') => l(ch.repeat(COLS));
    const sec = (t) => { l(); hr('='); l(t, true); hr('-'); };

    // 1 · Emisor
    const e = r.emisor || {};
    c(e.comercial || e.razon_social || '', true);
    if (e.comercial && e.razon_social && e.razon_social !== e.comercial) c(e.razon_social);
    if (e.rif) c(`RIF ${e.rif}`);
    if (e.direccion) c(e.direccion);

    // 2 · Título
    l(); hr('=');
    c(esZ ? 'CORTE Z' : 'CORTE X (PARCIAL)', true);
    if (esZ && d.numero) c(`N.o ${String(d.numero).padStart(6, '0')}`, true);
    if (!esZ) c('No cierra la caja');
    hr('=');

    // 3 · Fecha, hora y cajero
    kv('Fecha:', fecha(esZ ? d.cerrado_en : null));
    kv('Apertura:', fecha(r.apertura.fecha_apertura));
    kv('Cajero:', (r.apertura.cajero || '').slice(0, 30));
    if (esZ && d.cerrado_por && d.cerrado_por !== r.apertura.cajero) kv('Cerro:', d.cerrado_por.slice(0, 30));

    // 4 · Fondo inicial
    sec('FONDO INICIAL');
    kv('Dolares (USD)', mon('USD', r.apertura.fondo_usd));
    kv('Bolivares (VES)', mon('VES', r.apertura.fondo_ves));

    // 5 · Ventas por método de pago
    sec('VENTAS POR METODO DE PAGO');
    if (!r.metodos.length) l('Sin cobros en este turno.');
    r.metodos.forEach((m) => {
        kv(m.metodo.slice(0, 28), `${m.n} op.`, true);
        kv('  cobrado', mon(m.moneda, m.cobrado));
        if (m.moneda !== 'USD') kv('  eq. USD', mon('USD', m.usd));
        if (m.moneda !== 'VES') kv('  eq. Bs', mon('VES', m.ves));
    });
    hr();
    kv(`Ventas: ${r.ventas}${r.ventas_credito ? ` (${r.ventas_credito} a credito)` : ''}`, '');
    kv('Total cobrado USD', mon('USD', r.total_usd), true);
    kv('Total cobrado Bs', mon('VES', r.total_ves), true);
    if (r.a_credito_usd > 0) kv('Quedo a credito', mon('USD', r.a_credito_usd));

    // 6 · IGTF
    sec('IGTF COBRADO');
    kv('IGTF en USD', mon('USD', r.igtf_usd));
    kv('IGTF en Bs', mon('VES', r.igtf_ves));

    // 7 · Ingresos de caja / 8 · Egresos
    const listaMov = (titulo, lista, signo) => {
        sec(titulo);
        if (!lista.length) { l('Ninguno.'); return; }
        lista.forEach((m) => {
            envolver(`${m.hora} ${m.concepto}`, COLS - 14).forEach((x, i, a) => (i === a.length - 1 ? kv(x, `${signo}${mon(m.moneda, m.monto)}`) : l(x)));
            if (!m.es_efectivo) l('  (no es efectivo: no cuenta en el arqueo)');
        });
    };
    listaMov('INGRESOS DE CAJA (cobros y otros)', r.ingresos, '+');
    listaMov('EGRESOS DE CAJA', r.egresos, '-');

    // 9 · Efectivo esperado por moneda
    sec('EFECTIVO ESPERADO');
    r.monedas.forEach((m) => {
        l(`${m.moneda}`, true);
        kv('  Fondo inicial', num(m.moneda, m.fondo));
        kv('  + Ventas en efectivo', num(m.moneda, m.efectivo_recibido));
        kv('  - Vueltos entregados', num(m.moneda, m.vuelto));
        kv('  + Ingresos de caja', num(m.moneda, m.ingresos));
        kv('  - Egresos de caja', num(m.moneda, m.egresos));
        kv('  TOTAL ESPERADO', mon(m.moneda, m.esperado), true);
    });

    // 10 · Contado y 11 · Diferencia (solo en el Z)
    if (esZ) {
        sec('TOTAL CONTADO');
        r.monedas.filter((m) => d.conteo && m.moneda in d.conteo).forEach((m) => kv(m.moneda, mon(m.moneda, d.conteo[m.moneda]), true));
        sec('DIFERENCIA (contado - esperado)');
        r.monedas.filter((m) => d.diferencia && m.moneda in d.diferencia).forEach((m) => {
            const v = d.diferencia[m.moneda];
            kv(`${m.moneda} ${Math.abs(v) < 0.005 ? 'CUADRA' : v > 0 ? 'SOBRA' : 'FALTA'}`, `${v > 0 ? '+' : v < 0 ? '-' : ''}${num(m.moneda, Math.abs(v))}`, true);
        });
        if (d.observaciones) { l(); envolver(`Obs: ${d.observaciones}`).forEach((x) => l(x)); }
    } else {
        sec('CONTEO');
        l('Corte parcial: el efectivo se cuenta');
        l('al hacer el Corte Z.');
    }

    // 12 · Firmas
    l(); l(); l();
    hr('_'); c('Firma del Cajero'); l(); l(); l();
    hr('_'); c('Firma del Supervisor'); l(); c('Comprobante interno, no es documento fiscal');

    const alto = Math.max(60, MARGEN * 2 + L.length * LH + 4);
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: [ANCHO, alto], compress: true });
    doc.setTextColor(0).setFontSize(FS);
    let y = MARGEN + 2.5;
    L.forEach((x) => {
        doc.setFont('courier', x.b ? 'bold' : 'normal');
        if (x.c) doc.text(x.t, ANCHO / 2, y, { align: 'center' }); else doc.text(x.t, MARGEN, y);
        y += LH;
    });
    return doc;
}

/** Abre el PDF con el diálogo de impresión (si el navegador bloquea la ventana, lo descarga). */
export function imprimirTicketCorte(pdf, nombre = 'corte.pdf') {
    pdf.autoPrint();
    const w = window.open(pdf.output('bloburl'), '_blank');
    if (!w) pdf.save(nombre);
}
