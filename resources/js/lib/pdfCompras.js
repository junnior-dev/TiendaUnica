/**
 * PDF del módulo de Compras, en blanco y negro como los libros fiscales:
 *  · construirPdfCompra: comprobante interno de una compra registrada
 *  · construirPdfRetencion: comprobante de retención de IVA para entregar al proveedor
 *  · construirPdfReporteCompras: listado del periodo (usa el mismo formato que los libros)
 * Son documentos de control. No sustituyen la factura del proveedor ni la declaración ante el SENIAT.
 */
import { n2 } from './format';
import { construirPdfLibro } from './pdfLibro';

const FINA = 0.15, MEDIA = 0.35, M = 16;
const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const money = (m, v) => (m === 'VES' ? `Bs ${n2(v)}` : `$ ${n2(v)}`);
const marca = () => new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Caracas', hour12: false }).format(new Date());

async function cargar() {
    const { jsPDF } = await import('jspdf');
    const at = await import('jspdf-autotable');
    const autoTable = at.autoTable || at.default?.default || at.default;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    doc.setTextColor(0).setDrawColor(0).setFillColor(255);
    return { doc, autoTable };
}

function cabecera(doc, emisor, titulo, lineas) {
    const W = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica', 'bold').setFontSize(12).text(emisor.comercial || emisor.razon_social || '', M, M + 4);
    doc.setFont('helvetica', 'normal').setFontSize(8);
    doc.text([emisor.rif && `RIF ${emisor.rif}`, emisor.comercial && emisor.razon_social !== emisor.comercial && emisor.razon_social].filter(Boolean).join('  ·  '), M, M + 8.5);
    const dir = doc.splitTextToSize([emisor.direccion, emisor.telefono && `Tel. ${emisor.telefono}`].filter(Boolean).join('  ·  '), W / 2 - M);
    doc.text(dir, M, M + 12.5);
    doc.setFont('helvetica', 'bold').setFontSize(14).text(titulo, W - M, M + 5, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(9);
    lineas.forEach((l, i) => doc.text(l, W - M, M + 10.5 + i * 4.4, { align: 'right' }));
    doc.setLineWidth(MEDIA).line(M, M + 21, W - M, M + 21);
    return M + 27;
}
function pie(doc, texto) {
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
        doc.setPage(i); doc.setLineWidth(FINA).line(M, H - 14, W - M, H - 14);
        doc.setFont('helvetica', 'normal').setFontSize(7);
        doc.text(doc.splitTextToSize(texto, W - M * 2 - 62), M, H - 10.5);
        doc.text(`Generado ${marca()}  ·  Página ${i} de ${n}`, W - M, H - 10.5, { align: 'right' });
    }
}
const base = (doc) => ({
    theme: 'plain', margin: { left: M, right: M, bottom: 18 },
    styles: { font: 'helvetica', fontSize: 8.5, textColor: 0, cellPadding: { top: 1.8, bottom: 1.8, left: 0.8, right: 0.8 }, overflow: 'linebreak' },
    headStyles: { fontStyle: 'bold', fillColor: false, textColor: 0, fontSize: 8 }, bodyStyles: { fillColor: false },
    didDrawCell: (d) => { const { x, y, width, height } = d.cell; doc.setDrawColor(0).setLineWidth(d.section === 'head' ? MEDIA : FINA); if (d.section !== 'foot') doc.line(x, y + height, x + width, y + height); },
});
const bloque = (doc, y, titulo, filas) => {
    const W = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica', 'bold').setFontSize(9.5).text(titulo, M, y); doc.setLineWidth(FINA).line(M, y + 1.8, W - M, y + 1.8);
    doc.setFont('helvetica', 'normal').setFontSize(9);
    let yy = y + 6.5;
    filas.filter(Boolean).forEach(([a, b]) => { doc.setTextColor(90).text(a, M, yy); doc.setTextColor(0).text(String(b ?? ''), M + 42, yy); yy += 4.8; });
    return yy + 3;
};

export async function construirPdfCompra(d) {
    const { doc, autoTable } = await cargar(); const W = doc.internal.pageSize.getWidth(); const m = d.moneda;
    doc.setProperties({ title: `Compra ${d.factura}`, subject: d.proveedor.nombre, creator: 'Repuestos' });
    let y = cabecera(doc, d.emisor, 'COMPRA REGISTRADA', [`Factura ${d.factura}`, `Fecha ${dmy(d.fecha)}`, d.estado === 'ANULADA' ? 'ANULADA' : '']);
    y = bloque(doc, y, 'Proveedor', [['Razón social', d.proveedor.nombre], ['RIF', d.proveedor.rif], d.proveedor.telefono && ['Teléfono', d.proveedor.telefono], d.control && ['N.º de control', d.control],
        ['Moneda', m === 'VES' ? `Bolívares${d.tasa_fecha ? ` (tasa del ${dmy(d.tasa_fecha)}: Bs ${n2(d.tasa)} por $)` : ''}` : 'Dólares'], ['IVA', d.credito ? 'Crédito fiscal' : 'No es crédito fiscal (se suma al costo)']]);
    autoTable(doc, { ...base(doc), startY: y,
        head: [['Código', 'Producto', 'Cant.', 'Costo unit.', 'IVA', 'Subtotal']],
        body: d.items.map((i) => [i.sku, i.nombre, n2(i.cantidad).replace(/,00$/, ''), n2(i.costo), i.exento ? 'Exento' : `${n2(i.iva_pct).replace(/,00$/, '')} %`, n2(i.base)]),
        columnStyles: { 0: { cellWidth: 28 }, 2: { halign: 'right', cellWidth: 16 }, 3: { halign: 'right', cellWidth: 24 }, 4: { halign: 'right', cellWidth: 16 }, 5: { halign: 'right', cellWidth: 26 } },
        didParseCell: (x) => { if (x.section === 'head' && x.column.index >= 2) x.cell.styles.halign = 'right'; } });
    y = doc.lastAutoTable.finalY + 6;
    const fila = (a, b, fuerte) => { doc.setFont('helvetica', fuerte ? 'bold' : 'normal').setFontSize(fuerte ? 10.5 : 9); doc.text(a, W - M - 62, y); doc.text(b, W - M, y, { align: 'right' }); y += fuerte ? 6 : 4.8; };
    if (d.base > 0) fila('Base imponible', money(m, d.base)); if (d.exento > 0) fila('Exento', money(m, d.exento)); fila('IVA', money(m, d.iva));
    doc.setLineWidth(FINA).line(W - M - 62, y - 3, W - M, y - 3); y += 1.5; fila('Total de la factura', money(m, d.total), true);
    if (m === 'VES') { doc.setFont('helvetica', 'normal').setFontSize(8.5); doc.text(`Equivale a $ ${n2(d.total_usd)}`, W - M, y - 1, { align: 'right' }); y += 4; }
    y += 4;
    const extra = [d.retencion && ['Retención de IVA', `${n2(d.retencion.porcentaje).replace(/,00$/, '')} % · comprobante ${d.retencion.comprobante} · retenido Bs ${n2(d.retencion.iva_retenido_ves)}`],
        d.importacion && ['Importación', `Planilla ${d.importacion.planilla} del ${dmy(d.importacion.fecha)}${d.importacion.aduana ? ` · ${d.importacion.aduana}` : ''}`],
        d.observaciones && ['Nota', d.observaciones],
        d.anulacion && ['Anulada', `${dmy(d.anulacion.fecha)}${d.anulacion.por ? ` por ${d.anulacion.por}` : ''} · ${d.anulacion.motivo}`],
        ['Registrada por', d.registrada_por || '—']];
    bloque(doc, y, 'Otros datos', extra);
    pie(doc, 'Comprobante interno de control de inventario. No sustituye la factura del proveedor.');
    return doc;
}

export async function construirPdfRetencion(d) {
    const { doc } = await cargar(); const r = d.retencion; const W = doc.internal.pageSize.getWidth();
    doc.setProperties({ title: `Retención de IVA ${r.comprobante}`, subject: d.proveedor.nombre, creator: 'Repuestos' });
    let y = cabecera(doc, d.emisor, 'RETENCIÓN DE IVA', [`Comprobante ${r.comprobante}`, `Fecha ${dmy(r.fecha)}`, `Período fiscal ${String(r.fecha).slice(0, 7).replace('-', '/')}`]);
    y = bloque(doc, y, 'Agente de retención (quien compra)', [['Razón social', d.emisor.razon_social], ['RIF', d.emisor.rif], d.emisor.direccion && ['Dirección', d.emisor.direccion]]);
    y = bloque(doc, y, 'Sujeto retenido (proveedor)', [['Razón social', d.proveedor.nombre], ['RIF', d.proveedor.rif]]);
    y = bloque(doc, y, 'Documento que origina la retención', [['Factura', d.factura], d.control && ['N.º de control', d.control], ['Fecha de la factura', dmy(d.fecha)], ['Total de la factura', money(d.moneda, d.total)]]);
    y = bloque(doc, y, 'Cálculo de la retención', [['IVA de la factura', `Bs ${n2(r.iva_documento_ves)}`], ['Porcentaje retenido', `${n2(r.porcentaje).replace(/,00$/, '')} %`]]);
    doc.setLineWidth(MEDIA).line(M, y - 1, W - M, y - 1);
    doc.setFont('helvetica', 'bold').setFontSize(12).text('IVA retenido', M, y + 6); doc.text(`Bs ${n2(r.iva_retenido_ves)}`, W - M, y + 6, { align: 'right' });
    doc.setLineWidth(MEDIA).line(M, y + 9, W - M, y + 9);
    y += 38; doc.setLineWidth(FINA).line(M, y, M + 70, y); doc.line(W - M - 70, y, W - M, y);
    doc.setFont('helvetica', 'normal').setFontSize(8.5); doc.text('Firma y sello del agente de retención', M, y + 4.5); doc.text('Recibido por el proveedor', W - M - 70, y + 4.5);
    pie(doc, 'Comprobante generado por el sistema. Confirma con tu contador que cumple el formato vigente del SENIAT para comprobantes de retención.');
    return doc;
}

const NOMBRE = { mes: 'Este mes', semana: 'Esta semana', mespasado: 'Mes pasado', anio: 'Este año', rango: 'Fechas elegidas' };
export async function construirPdfReporteCompras({ emisor, filtros: f, resumen: R, filas, proveedor, especial, retenciones_activas }) {
    const verRet = especial && retenciones_activas;
    const periodo = `${NOMBRE[f.periodo] || 'Periodo'}: ${dmy(f.desde)} al ${dmy(f.hasta)}`;
    const columnas = [{ h: 'Fecha', w: 20 }, { h: 'Proveedor' }, { h: 'RIF', w: 26 }, { h: 'Factura', w: 26 }, { h: 'Control', w: 26 }, { h: 'Moneda', w: 14 }, { h: 'IVA', a: 'right', w: 24 }, { h: 'Total', a: 'right', w: 28 }, { h: 'Total en $', a: 'right', w: 24 }, ...(verRet ? [{ h: 'Retención', w: 24 }] : [])];
    const anuladas = []; const cuerpo = filas.map((x, i) => { if (x.estado === 'ANULADA') anuladas.push(i); return [dmy(x.fecha), x.proveedor, x.rif, x.factura, x.control || '', x.moneda === 'VES' ? 'Bs' : '$', n2(x.iva), n2(x.total), n2(x.total_usd),
        ...(verRet ? [x.importacion ? 'Importación' : x.retencion_pct ? `${n2(x.retencion_pct).replace(/,00$/, '')} %` : x.estado === 'REGISTRADA' && x.iva > 0 ? 'Pendiente' : '—'] : [])]; });
    const filtro = [f.estado && (f.estado === 'ANULADA' ? 'Solo anuladas' : 'Solo registradas'), proveedor && `Proveedor: ${proveedor}`, f.q && `Búsqueda: «${f.q}»`, f.retencion && 'Solo sin retención'].filter(Boolean);
    return construirPdfLibro({ emisor, titulo: 'Reporte de compras', periodo, unidad: 'Cada monto en la moneda de su factura', columnas, filas: cuerpo, anuladas,
        totales: ['', `${R.compras} facturas registradas`, '', '', '', '', '', '', n2(R.total_usd), ...(verRet ? [''] : [])],
        notas: [...(filtro.length ? [`Filtros aplicados: ${filtro.join(' · ')}.`] : []), 'La columna «Total en $» convierte cada factura a dólares con la tasa de su fecha. Las compras anuladas salen en cursiva y no suman.'] });
}

export function abrirPdf(pdf, { nombre = 'compras.pdf', descargar = false } = {}) {
    if (descargar) { pdf.save(nombre); return; }
    const url = URL.createObjectURL(pdf.output('blob'));
    if (!window.open(url, '_blank')) pdf.save(nombre);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
