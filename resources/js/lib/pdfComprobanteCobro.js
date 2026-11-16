/**
 * Recibo de cobro de una cuenta por cobrar (ticket de 80 mm). Si el cobro fue en divisas y causó IGTF, el mismo papel es el
 * comprobante de percepción: desglosa base, alícuota, IGTF y el total que entregó el cliente.
 *   const pdf = await construirComprobanteCobro(datos);      // datos = GET /cuentas-por-cobrar/pagos/{id}/comprobante
 *   imprimirTicketCorte(pdf, 'recibo-000012.pdf');            // (lib/pdfTicketCorte.js) abre el diálogo de impresión
 * Comprobante INTERNO numerado «REC-n»: no es una factura ni un documento autorizado por el SENIAT (el LEEME explica el porqué).
 * Solo texto ASCII/Latin-1: las fuentes base de PDF no dibujan símbolos como «−» o «→».
 */
import { n0, n2 } from './format';

const COLS = 40, ANCHO = 80, MARGEN = 4, LH = 3.55, FS = 8.5;
const SIM = { USD: '$', EUR: 'EUR', VES: 'Bs', COP: 'COP' };
const mon = (m, v) => `${SIM[m] || m} ${m === 'COP' ? n0(v) : n2(v)}`;
const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

function envolver(t, n = COLS) {
    const out = []; let linea = '';
    for (let w of String(t ?? '').split(/\s+/).filter(Boolean)) {
        while (w.length > n) { if (linea) { out.push(linea); linea = ''; } out.push(w.slice(0, n)); w = w.slice(n); }
        if (!linea) linea = w; else if ((linea + ' ' + w).length <= n) linea += ' ' + w; else { out.push(linea); linea = w; }
    }
    if (linea) out.push(linea);
    return out;
}

export async function construirComprobanteCobro(d) {
    const L = [];
    const l = (t = '', b = false) => L.push({ t, b });
    const c = (t, b = false) => envolver(t).forEach((x) => L.push({ t: x, b, c: true }));
    const kv = (a, v, b = false) => { const av = String(a), vv = String(v); l(av.length + vv.length + 1 > COLS ? av.slice(0, Math.max(0, COLS - vv.length - 1)) + ' ' + vv : av + ' '.repeat(COLS - av.length - vv.length) + vv, b); };
    const hr = (ch = '-') => l(ch.repeat(COLS));
    const sec = (t) => { l(); hr('='); l(t, true); hr('-'); };

    const e = d.emisor || {};
    c(e.comercial || e.razon_social || '', true);
    if (e.comercial && e.razon_social && e.razon_social !== e.comercial) c(e.razon_social);
    if (e.rif) c(`RIF ${e.rif}`);
    if (e.direccion) c(e.direccion);

    l(); hr('=');
    c(d.aplica_igtf ? 'COMPROBANTE DE PERCEPCION DE IGTF' : 'RECIBO DE COBRO', true);
    c(d.numero, true);
    if (d.estado === 'ANULADO') { c('*** COBRO ANULADO ***', true); if (d.motivo_anulacion) envolver(`Motivo: ${d.motivo_anulacion}`).forEach((x) => l(x)); }
    hr('=');

    kv('Fecha:', dmy(d.fecha));
    kv('Hora:', d.hora || '');
    kv('Cobrado por:', String(d.cobrado_por || '').slice(0, 26));

    sec('CLIENTE');
    envolver(d.cliente || '').forEach((x) => l(x, true));
    if (d.documento) l(d.documento);
    kv('Venta N.o', String(d.venta_numero ?? '').padStart(6, '0'));
    if (d.factura) kv('Factura N.o', d.factura);

    sec('DETALLE DEL COBRO');
    kv('Metodo', String(d.metodo).slice(0, 28));
    if (d.referencia) kv('Referencia', String(d.referencia).slice(0, 26));
    if (d.moneda !== 'VES') kv('Tasa del dia', `Bs ${Number(d.tasa_ves).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`);
    kv('Monto cobrado', mon(d.moneda, d.monto), true);
    if (d.moneda !== 'USD') kv('  eq. USD', mon('USD', d.monto_usd));
    if (d.moneda !== 'VES') kv('  eq. Bs', mon('VES', d.monto_ves));

    if (d.aplica_igtf) {
        sec('IGTF PERCIBIDO');
        kv('Base (pago en divisas)', mon(d.moneda, d.base_igtf));
        kv('Alicuota', `${String(d.igtf_pct).replace('.', ',')} %`);
        kv('IGTF', mon(d.moneda, d.igtf), true);
        kv('  eq. USD', mon('USD', d.igtf_usd));
        kv('  eq. Bs', mon('VES', d.igtf_ves));
        hr();
        kv('TOTAL ENTREGADO', mon(d.moneda, d.total_entregado), true);
        l();
        envolver('El IGTF se causa al recibir el pago en divisas. La factura de esta venta se emitio a credito y no lo incluye.').forEach((x) => l(x));
    } else {
        l(); kv('TOTAL ENTREGADO', mon(d.moneda, d.total_entregado), true);
    }

    sec('SALDO DE LA CUENTA');
    kv('Saldo actual USD', mon('USD', d.saldo_usd));
    kv('Saldo actual Bs', mon('VES', d.saldo_ves));
    if (d.estado_cuenta === 'PAGADA') c('CUENTA SALDADA', true);

    l(); l(); l();
    hr('_'); c('Recibi conforme (cliente)'); l(); c('Comprobante interno, no es factura ni documento fiscal autorizado');

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
