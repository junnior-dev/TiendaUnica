/**
 * Libros fiscales en PDF: blanco y negro, líneas finas, sin rellenos. Horizontal para los libros y vertical para el resumen.
 * Los documentos anulados salen marcados con «(anulada)» y no suman en los totales.
 */
import { n2 } from './format';

export const FINA = 0.15, MEDIA = 0.35;
export const marca = () => new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Caracas', hour12: false }).format(new Date());

export async function cargar(orientation) {
    const { jsPDF } = await import('jspdf');
    const at = await import('jspdf-autotable');
    const autoTable = at.autoTable || at.default?.default || at.default;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation, compress: true });
    doc.setTextColor(0).setDrawColor(0).setFillColor(255);
    return { doc, autoTable };
}

export function encabezado(doc, emisor, titulo, periodo, M, unidad = 'Montos en bolívares (Bs)') {
    const W = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica', 'bold').setFontSize(12).text(emisor.comercial || emisor.razon_social || '', M, M + 4);
    doc.setFont('helvetica', 'normal').setFontSize(8);
    doc.text([emisor.rif && `RIF ${emisor.rif}`, emisor.comercial && emisor.razon_social !== emisor.comercial && emisor.razon_social].filter(Boolean).join('  ·  '), M, M + 8.5);
    if (emisor.direccion) doc.text(doc.splitTextToSize(emisor.direccion, W / 2 - M), M, M + 12.5);
    doc.setFont('helvetica', 'bold').setFontSize(15).text(titulo, W - M, M + 5, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(9).text(periodo, W - M, M + 10.5, { align: 'right' });
    doc.setFontSize(7.5).text(unidad, W - M, M + 15, { align: 'right' });
    doc.setLineWidth(MEDIA).line(M, M + 19, W - M, M + 19);
    return M + 23;
}

export function pie(doc, M) {
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
        doc.setPage(i);
        doc.setLineWidth(FINA).line(M, H - 12, W - M, H - 12);
        doc.setFont('helvetica', 'normal').setFontSize(7);
        doc.text(`Generado ${marca()}`, M, H - 8);
        doc.text(`Página ${i} de ${n}`, W - M, H - 8, { align: 'right' });
    }
}

export const estilosBase = (doc, M) => ({
    theme: 'plain', margin: { left: M, right: M, bottom: 16 },
    styles: { font: 'helvetica', fontSize: 7.5, textColor: 0, lineColor: 0, cellPadding: { top: 1.5, bottom: 1.5, left: 0.8, right: 0.8 }, overflow: 'linebreak' },
    headStyles: { fontStyle: 'bold', fillColor: false, textColor: 0, fontSize: 7 },
    bodyStyles: { fillColor: false }, alternateRowStyles: { fillColor: false },
    didDrawCell: (d) => {
        const { x, y, width, height } = d.cell;
        const marcada = d.section === 'head' || d.section === 'foot';
        doc.setDrawColor(0).setLineWidth(marcada ? MEDIA : FINA);
        if (d.section === 'head' || d.section === 'body') doc.line(x, y + height, x + width, y + height);
        if (d.section === 'foot') doc.line(x, y, x + width, y);
    },
});

/** columnas: [{ h: 'Base', a: 'right', w: 22 }] · filas: arreglos de texto · totales: arreglo o null · anuladas: índices de fila */
export async function construirPdfLibro({ emisor, titulo, periodo, columnas, filas, totales = null, anuladas = [], notas = [], unidad }) {
    const M = 12;
    const { doc, autoTable } = await cargar('landscape');
    doc.setProperties({ title: `${titulo} ${periodo}`, subject: emisor.comercial || emisor.razon_social, creator: 'Repuestos' });
    const y = encabezado(doc, emisor, titulo, periodo, M, unidad);
    const cs = {};
    columnas.forEach((c, i) => { cs[i] = { halign: c.a || 'left', ...(c.w ? { cellWidth: c.w } : {}) }; });
    autoTable(doc, {
        ...estilosBase(doc, M), startY: y,
        head: [columnas.map((c) => c.h)], body: filas.length ? filas : [columnas.map((_, i) => (i === 0 ? 'Sin movimientos en este período' : ''))],
        foot: totales ? [totales] : undefined, showFoot: 'lastPage',
        columnStyles: cs,
        footStyles: { fontStyle: 'bold', fillColor: false, textColor: 0, fontSize: 7.5 },
        didParseCell: (d) => {
            if (d.section === 'head' || d.section === 'foot') d.cell.styles.halign = columnas[d.column.index]?.a || 'left';
            if (d.section === 'body' && anuladas.includes(d.row.index)) d.cell.styles.fontStyle = 'italic';
        },
        didDrawCell: (() => { const b = estilosBase(doc, M).didDrawCell; return (d) => { b(d); if (d.section === 'body' && anuladas.includes(d.row.index) && d.column.index > 0) { const { x, y: cy, width, height } = d.cell; doc.setLineWidth(FINA).line(x + 0.8, cy + height / 2, x + width - 0.8, cy + height / 2); } }; })(),
    });
    let ny = doc.lastAutoTable.finalY + 6;
    doc.setFont('helvetica', 'normal').setFontSize(7.5);
    notas.forEach((t) => { const l = doc.splitTextToSize(t, doc.internal.pageSize.getWidth() - M * 2); doc.text(l, M, ny); ny += l.length * 3.6; });
    pie(doc, M);
    return doc;
}

/** Resumen de IVA del mes (declaración): débito, crédito, resultado, IGTF y los últimos 12 meses. */
export async function construirPdfResumenIva({ emisor, periodo, iva, igtf, serie, regimen }) {
    const M = 18;
    const { doc, autoTable } = await cargar('portrait');
    doc.setProperties({ title: `Resumen de IVA ${periodo}`, subject: emisor.comercial || emisor.razon_social, creator: 'Repuestos' });
    let y = encabezado(doc, emisor, 'Resumen de IVA', periodo, M);
    const W = doc.internal.pageSize.getWidth();
    const R = { halign: 'right' };
    const sec = (t) => { doc.setFont('helvetica', 'bold').setFontSize(9.5).text(t, M, y); y += 1.8; doc.setLineWidth(FINA).line(M, y, W - M, y); y += 1.5; };
    const tabla = (opts) => { autoTable(doc, { ...estilosBase(doc, M), startY: y, ...opts }); y = doc.lastAutoTable.finalY + 8; };

    sec('Régimen');
    tabla({ body: [
        ['Contribuyente', regimen.especial ? 'Sujeto pasivo especial' : 'Ordinario de IVA'],
        ['Alícuota de IVA vigente', `${n2(regimen.iva_pct)} %`],
        ['Agente de percepción del IGTF', regimen.cobra_igtf ? `Sí (${n2(regimen.igtf_pct)} %)` : 'No'],
        ['IVA de compras', regimen.recupera_credito ? 'Se recupera como crédito fiscal' : 'Pasa al costo del inventario'],
    ], columnStyles: { 0: { cellWidth: 60 } } });

    sec('IVA del mes');
    const neto = iva.a_pagar > 0 ? ['IVA a pagar', n2(iva.a_pagar)] : ['Excedente de crédito fiscal (pasa al mes siguiente)', n2(iva.excedente)];
    tabla({ body: [
        ['Ventas gravadas (base imponible)', n2(iva.base)], ['Ventas exentas', n2(iva.exento)], ['Ventas exoneradas', n2(iva.exonerado)],
        [`Débito fiscal: IVA de ventas (${iva.facturas} facturas, ${iva.notas} notas)`, n2(iva.debito)],
        [`Crédito fiscal: IVA de compras recuperable (${iva.compras} facturas)`, n2(iva.credito)],
        ['Excedente de crédito del mes anterior', n2(iva.excedente_anterior)],
        neto,
    ], columnStyles: { 1: { halign: 'right', cellWidth: 40 } }, didParseCell: (d) => { if (d.section === 'body' && d.row.index >= 3 && [3, 4, 6].includes(d.row.index)) d.cell.styles.fontStyle = 'bold'; } });

    if (regimen.cobra_igtf) {
        sec('IGTF del mes');
        tabla({ body: [['IGTF cobrado en divisas (a declarar)', n2(igtf.ves)], ['Del cual, de ventas luego anuladas', n2(igtf.anuladas_ves)], ['Reversiones registradas (por reclamar)', n2(igtf.revertido_ves)]], columnStyles: { 1: { halign: 'right', cellWidth: 40 } } });
    }

    sec('Últimos 12 meses');
    const nom = (m) => new Intl.DateTimeFormat('es-VE', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T12:00:00Z`));
    tabla({ head: [['Mes', 'Débito', 'Crédito', 'Excedente anterior', 'A pagar', 'Excedente']], body: serie.map((s) => [nom(s.mes), n2(s.debito), n2(s.credito), n2(s.arrastre), n2(s.a_pagar), n2(s.excedente)]),
        columnStyles: { 1: R, 2: R, 3: R, 4: R, 5: R }, didParseCell: (d) => { if (d.section === 'head' && d.column.index >= 1) d.cell.styles.halign = 'right'; } });
    doc.setFont('helvetica', 'normal').setFontSize(7.5);
    doc.text(doc.splitTextToSize('Cálculo orientativo con los libros del sistema. El excedente se arrastra desde el primer mes mostrado. Confirma la declaración con tu contador.', W - M * 2), M, y - 3);
    pie(doc, M);
    return doc;
}

export function csv(nombre, columnas, filas, totales) {
    const esc = (v) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const l = [columnas.map((c) => c.h), ...filas, ...(totales ? [totales] : [])].map((r) => r.map(esc).join(';'));
    const blob = new Blob(['﻿' + l.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
