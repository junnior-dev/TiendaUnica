/**
 * Factura / nota de venta / ticket en PDF — blanco y negro, líneas finas, sin rellenos. Se genera en el navegador con jsPDF.
 *
 *   const pdf = await construirPdfVenta(doc, 'ticket' | 'carta');     // doc = respuesta de GET /caja/venta/{id}
 *   abrirPdf(pdf, { imprimir: true, nombre: 'venta-000042.pdf' });
 *
 * El título es «FACTURA» cuando la venta ya tiene número de factura fiscal y «NOTA DE VENTA» mientras no lo tenga:
 * la factura fiscal la emite la máquina fiscal o el sistema de facturación digital; este documento no la sustituye.
 */
import { n0, n2, tasa as fTasa } from './format';

const r2 = (v) => Math.round(v * 100) / 100;
const dec = (m, v) => (m === 'COP' ? n0(v) : n2(v));
const SIM = { USD: '$', EUR: '€', COP: 'COP', VES: 'Bs' };
const conMoneda = (m, v) => `${SIM[m] || m} ${dec(m, v)}`;
const qty = (v) => new Intl.NumberFormat('es-VE', { maximumFractionDigits: 3 }).format(v);
const num6 = (n) => String(n).padStart(6, '0');
const DOC = { V: 'V', E: 'E', J: 'J', G: 'G', P: 'P', C: 'C' };
const docCliente = (c) => (c ? `${DOC[c.tipo] || c.tipo}-${c.documento}` : '');
const titulo = (d) => (d.factura ? 'FACTURA' : 'NOTA DE VENTA');
const numeroDoc = (d) => (d.factura ? d.factura : `N.º ${num6(d.numero)}`);
const lineaVenta = (d, l) => (d.regimen.precios_incluyen_iva ? l.total_ves : l.base_ves);
const precioBs = (d, l) => r2(l.precio_usd * d.tasas.USD * (d.regimen.precios_incluyen_iva && l.alicuota === 'G' ? 1 + d.regimen.iva_pct / 100 : 1));

function resumenIva(d) {
    const t = d.totales, r = d.regimen;
    return [
        t.base_ves > 0 && [`Base imponible (${n2(r.iva_pct)} %)`, n2(t.base_ves)],
        t.exento_ves > 0 && ['Exento / exonerado', n2(t.exento_ves)],
        t.iva_ves > 0 && [`IVA (${n2(r.iva_pct)} %)`, n2(t.iva_ves)],
    ].filter(Boolean);
}

/* ═══════════════ Ticket de 80 mm ═══════════════ */
function dibujarTicket(doc, d) {
    const W = 80, M = 4, C = W / 2, X2 = W - M;
    let y = 6;
    const t = (s, x, o = {}) => doc.text(String(s), x, y, o);
    const linea = (puntos = true) => { doc.setLineWidth(0.15); if (puntos) doc.setLineDash([0.6, 0.8], 0); doc.line(M, y, X2, y); doc.setLineDash([], 0); y += 3.4; };
    const fila = (a, b, negrita) => { doc.setFont('helvetica', negrita ? 'bold' : 'normal'); t(a, M); t(b, X2, { align: 'right' }); y += 3.5; };
    const envuelto = (s, x, ancho, o = {}) => { const l = doc.splitTextToSize(String(s), ancho); doc.text(l, x, y, o); y += l.length * 3.3; };

    doc.setTextColor(0); doc.setDrawColor(0);
    doc.setFont('helvetica', 'bold').setFontSize(9.5);
    const nom = d.emisor.nombre_comercial || d.emisor.razon_social;
    doc.splitTextToSize(nom, W - 2 * M).forEach((l) => { t(l, C, { align: 'center' }); y += 4; });
    doc.setFont('helvetica', 'normal').setFontSize(7);
    if (d.emisor.nombre_comercial && d.emisor.razon_social !== d.emisor.nombre_comercial) { t(d.emisor.razon_social, C, { align: 'center' }); y += 3.2; }
    t(`RIF ${d.emisor.rif}`, C, { align: 'center' }); y += 3.2;
    if (d.emisor.direccion) doc.splitTextToSize(d.emisor.direccion, W - 2 * M).forEach((l) => { t(l, C, { align: 'center' }); y += 3.1; });
    if (d.emisor.telefono) { t(`Tel. ${d.emisor.telefono}`, C, { align: 'center' }); y += 3.2; }
    if (d.regimen.especial) { t('Sujeto pasivo especial', C, { align: 'center' }); y += 3.2; }
    y += 1; linea();

    doc.setFont('helvetica', 'bold').setFontSize(10); t(titulo(d), C, { align: 'center' }); y += 4.2;
    doc.setFontSize(8.5); t(numeroDoc(d), C, { align: 'center' }); y += 3.8;
    doc.setFont('helvetica', 'normal').setFontSize(7);
    if (d.factura && d.control) { t(`Control ${d.control}`, C, { align: 'center' }); y += 3.2; }
    if (d.factura) { t(`Venta N.º ${num6(d.numero)}`, C, { align: 'center' }); y += 3.2; }
    t(`${d.fecha}  ${d.hora}`, M); t(`Cajero: ${d.cajero || '—'}`, X2, { align: 'right' }); y += 3.6;
    if (d.estado === 'ANULADA') { doc.setFont('helvetica', 'bold').setFontSize(9); t('*** VENTA ANULADA ***', C, { align: 'center' }); y += 4; doc.setFont('helvetica', 'normal').setFontSize(7); }
    linea();

    doc.setFont('helvetica', 'bold'); t(d.cliente ? d.cliente.nombre : 'Consumidor final', M); y += 3.4; doc.setFont('helvetica', 'normal');
    if (d.cliente) { t(docCliente(d.cliente), M); y += 3.2; if (d.cliente.direccion) envuelto(d.cliente.direccion, M, W - 2 * M); }
    linea();

    doc.setFontSize(7.5);
    d.lineas.forEach((l) => {
        doc.setFont('helvetica', 'normal'); envuelto(l.descripcion, M, W - 2 * M - 0);
        const pu = `${qty(l.cantidad)} x ${n2(precioBs(d, l))}${l.descuento_pct > 0 ? `  -${n2(l.descuento_pct)} %` : ''}`;
        doc.setFontSize(7); t(pu, M + 1.5); t(`${n2(lineaVenta(d, l))} (${l.alicuota})`, X2, { align: 'right' }); y += 3.7; doc.setFontSize(7.5);
    });
    y -= 0.4; linea();

    doc.setFontSize(7.5);
    resumenIva(d).forEach(([a, b]) => fila(a, b));
    doc.setFontSize(9); fila('TOTAL Bs', n2(d.totales.total_ves), true); doc.setFontSize(7.5);
    if (d.totales.igtf_ves > 0) {
        fila(`IGTF (${n2(d.regimen.igtf_pct)} %) en divisas`, n2(d.totales.igtf_ves));
        doc.setFontSize(9); fila('TOTAL A PAGAR Bs', n2(d.totales.total_cobrar_ves), true); doc.setFontSize(7.5);
    }
    doc.setFontSize(7); t(`Referencia: $ ${n2(d.totales.total_cobrar_usd)}  ·  Tasa Bs ${fTasa(d.tasas.USD)}`, M); y += 3.4;
    Object.entries(d.tasas).filter(([m]) => m !== 'USD').forEach(([m, v]) => { t(`1 ${m} = Bs ${fTasa(v)}`, M); y += 3.1; });
    y += 0.6; linea();

    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); t('Forma de pago', M); y += 3.6; doc.setFont('helvetica', 'normal');
    d.pagos.forEach((p) => {
        fila(p.metodo, conMoneda(p.moneda, p.cobrado ?? p.monto));
        if (p.referencia) { doc.setFontSize(7); t(`Ref. ${p.referencia}`, M + 1.5); y += 3.1; doc.setFontSize(7.5); }
        if (p.vuelto > 0) { doc.setFontSize(7); t(`Recibido ${conMoneda(p.moneda, p.entregado)}  ·  Vuelto ${conMoneda(p.vuelto_moneda || p.moneda, p.vuelto)}`, M + 1.5); y += 3.2; doc.setFontSize(7.5); }
    });
    y += 0.6; linea();
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    t('Gracias por su compra', C, { align: 'center' }); y += 3.3;
    if (!d.factura) { doc.splitTextToSize('Nota de venta sin valor fiscal. No sustituye a la factura emitida por el medio de facturación autorizado.', W - 2 * M).forEach((l) => { t(l, C, { align: 'center' }); y += 3; }); }
    return y + 3;
}

/* ═══════════════ Hoja carta ═══════════════ */
async function dibujarCarta(doc, d, autoTable) {
    const W = 215.9, M = 18, ANCHO = W - 2 * M;
    let y = M;
    doc.setTextColor(0); doc.setDrawColor(0); doc.setFillColor(255);
    const nom = d.emisor.nombre_comercial || d.emisor.razon_social;
    doc.setFont('helvetica', 'bold').setFontSize(13); doc.text(nom, M, y + 4);
    doc.setFont('helvetica', 'normal').setFontSize(8);
    doc.text([d.emisor.nombre_comercial && d.emisor.razon_social !== d.emisor.nombre_comercial ? d.emisor.razon_social : null, `RIF ${d.emisor.rif}${d.regimen.especial ? '  ·  Sujeto pasivo especial' : ''}`].filter(Boolean), M, y + 9);
    const dir = doc.splitTextToSize([d.emisor.direccion, d.emisor.telefono && `Tel. ${d.emisor.telefono}`].filter(Boolean).join('  ·  '), 100);
    doc.text(dir, M, y + 17);

    doc.setFont('helvetica', 'bold').setFontSize(17); doc.text(titulo(d), W - M, y + 5, { align: 'right' });
    doc.setFontSize(11); doc.text(numeroDoc(d), W - M, y + 11, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(8);
    const der = [d.factura && d.control ? `N.º de control ${d.control}` : null, d.factura ? `Venta N.º ${num6(d.numero)}` : null, `Fecha ${d.fecha}  ·  ${d.hora}`, `Cajero: ${d.cajero || '—'}`].filter(Boolean);
    doc.text(der, W - M, y + 16, { align: 'right', lineHeightFactor: 1.35 });
    y += 35;
    doc.setLineWidth(0.35).line(M, y, W - M, y); y += 6;

    if (d.estado === 'ANULADA') { doc.setFont('helvetica', 'bold').setFontSize(12); doc.text('VENTA ANULADA', W - M, y, { align: 'right' }); }
    doc.setFont('helvetica', 'bold').setFontSize(8); doc.text('Cliente', M, y); doc.setFont('helvetica', 'normal').setFontSize(9);
    doc.text(d.cliente ? d.cliente.nombre : 'Consumidor final', M, y + 4.8);
    doc.setFontSize(8);
    if (d.cliente) doc.text([`${docCliente(d.cliente)}${d.cliente.telefono ? `  ·  ${d.cliente.telefono}` : ''}`, ...(d.cliente.direccion ? doc.splitTextToSize(d.cliente.direccion, 110) : [])], M, y + 9.4);
    y += 22;

    const hayDesc = d.lineas.some((l) => l.descuento_pct > 0);
    const incl = d.regimen.precios_incluyen_iva;
    autoTable(doc, {
        startY: y, theme: 'plain', margin: { left: M, right: M },
        styles: { font: 'helvetica', fontSize: 8, textColor: 0, lineColor: 0, cellPadding: { top: 1.8, bottom: 1.8, left: 0.8, right: 0.8 }, overflow: 'linebreak' },
        headStyles: { fontStyle: 'bold', fillColor: false, textColor: 0, fontSize: 7.5 },
        head: [[{ content: 'Cant.', styles: { halign: 'right' } }, 'Descripción', 'Código', { content: 'P. unitario Bs', styles: { halign: 'right' } }, ...(hayDesc ? [{ content: 'Desc.', styles: { halign: 'right' } }] : []), 'Alíc.', { content: incl ? 'Total Bs' : 'Monto Bs', styles: { halign: 'right' } }]],
        body: d.lineas.map((l) => [qty(l.cantidad), l.descripcion, l.sku, n2(precioBs(d, l)), ...(hayDesc ? [l.descuento_pct > 0 ? `${n2(l.descuento_pct)} %` : ''] : []), l.alicuota === 'G' ? `G ${n2(d.regimen.iva_pct)} %` : l.alicuota === 'X' ? 'Exonerado' : 'Exento', n2(lineaVenta(d, l))]),
        columnStyles: { 0: { cellWidth: 14, halign: 'right' }, 2: { cellWidth: 28 }, 3: { halign: 'right', cellWidth: 26 }, [hayDesc ? 5 : 4]: { cellWidth: 20 }, [hayDesc ? 6 : 5]: { halign: 'right', cellWidth: 26 }, ...(hayDesc ? { 4: { halign: 'right', cellWidth: 14 } } : {}) },
        didParseCell: (c) => { if (c.section === 'head') { const cs = c.table.settings.columnStyles?.[c.column.index]; if (cs?.halign) c.cell.styles.halign = cs.halign; } },
        didDrawCell: (c) => { const { x, y: cy, width, height } = c.cell; doc.setLineWidth(c.section === 'head' ? 0.35 : 0.1); doc.line(x, cy + height, x + width, cy + height); },
    });
    y = doc.lastAutoTable.finalY + 6;

    // Totales (derecha) y forma de pago (izquierda)
    const filas = [...resumenIva(d), ['Total Bs', n2(d.totales.total_ves), true], ...(d.totales.igtf_ves > 0 ? [[`IGTF (${n2(d.regimen.igtf_pct)} %) sobre pagos en divisas`, n2(d.totales.igtf_ves)], ['Total a pagar Bs', n2(d.totales.total_cobrar_ves), true]] : [])];
    if (y + 12 + filas.length * 5 + d.pagos.length * 6 > 262) { doc.addPage(); y = M; }
    const y0 = y, xr = W - M, xl = W - M - 78;
    filas.forEach(([a, b, neg]) => { if (neg) { doc.setLineWidth(0.15).line(xl, y - 4, xr, y - 4); y += 0.8; } doc.setFont('helvetica', neg ? 'bold' : 'normal').setFontSize(neg ? 10 : 8.5); doc.text(a, xl, y); doc.text(b, xr, y, { align: 'right' }); y += neg ? 6 : 5; });
    doc.setFont('helvetica', 'normal').setFontSize(7.5);
    doc.text(`Referencia en dólares: $ ${n2(d.totales.total_cobrar_usd)}  ·  Tasa del día Bs ${fTasa(d.tasas.USD)} (${d.tasa_fecha ? d.tasa_fecha.split('-').reverse().join('/') : ''})`, xr, y + 1, { align: 'right' });
    const yt = y + 6;

    y = y0;
    doc.setFont('helvetica', 'bold').setFontSize(8.5); doc.text('Forma de pago', M, y); y += 3;
    autoTable(doc, {
        startY: y, theme: 'plain', margin: { left: M, right: W - M - 84 }, tableWidth: 84,
        styles: { font: 'helvetica', fontSize: 7.5, textColor: 0, lineColor: 0, cellPadding: { top: 1.4, bottom: 1.4, left: 0.6, right: 0.6 } },
        body: d.pagos.map((p) => [`${p.metodo}${p.referencia ? `\nRef. ${p.referencia}` : ''}${p.vuelto > 0 ? `\nRecibido ${conMoneda(p.moneda, p.entregado)} · vuelto ${conMoneda(p.vuelto_moneda || p.moneda, p.vuelto)}` : ''}`, conMoneda(p.moneda, p.cobrado ?? p.monto)]),
        columnStyles: { 1: { halign: 'right', cellWidth: 26 } },
        didDrawCell: (c) => { const { x, y: cy, width, height } = c.cell; doc.setLineWidth(0.1); doc.line(x, cy + height, x + width, cy + height); },
    });
    y = Math.max(doc.lastAutoTable.finalY, yt) + 10;

    // Pie
    const py = 268;
    doc.setLineWidth(0.15).line(M, py - 4, W - M, py - 4);
    doc.setFont('helvetica', 'normal').setFontSize(7);
    doc.text(d.factura ? 'Gracias por su compra.' : 'Nota de venta sin valor fiscal. No sustituye a la factura emitida por la máquina fiscal o el sistema de facturación digital autorizado.', M, py);
    doc.text(`Generado ${new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Caracas', hour12: false }).format(new Date())}`, W - M, py, { align: 'right' });
}

export async function construirPdfVenta(d, formato = 'ticket') {
    const { jsPDF } = await import('jspdf');
    const nombre = `${titulo(d) === 'FACTURA' ? 'Factura' : 'Nota de venta'} ${d.factura || num6(d.numero)}`;
    if (formato === 'carta') {
        const at = await import('jspdf-autotable');
        const autoTable = at.autoTable || at.default?.default || at.default;
        const doc = new jsPDF({ unit: 'mm', format: 'letter', compress: true });
        doc.setProperties({ title: nombre, subject: d.emisor.razon_social, creator: 'Repuestos' });
        await dibujarCarta(doc, d, autoTable);
        return doc;
    }
    const medir = new jsPDF({ unit: 'mm', format: [80, 1200], compress: true });
    const alto = dibujarTicket(medir, d);
    const doc = new jsPDF({ unit: 'mm', format: [80, Math.max(alto, 60)], compress: true });
    doc.setProperties({ title: nombre, subject: d.emisor.razon_social, creator: 'Repuestos' });
    dibujarTicket(doc, d);
    return doc;
}

/** Abre el PDF en una pestaña (con el diálogo de impresión) o lo descarga. */
export function abrirPdf(pdf, { imprimir = false, nombre = 'venta.pdf', descargar = false } = {}) {
    if (descargar) { pdf.save(nombre); return; }
    if (imprimir) pdf.autoPrint();
    const url = URL.createObjectURL(pdf.output('blob'));
    const w = window.open(url, '_blank');
    if (!w) pdf.save(nombre); // si el navegador bloquea la ventana, se descarga
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
