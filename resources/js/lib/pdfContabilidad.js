/**
 * Libros contables y estados financieros en PDF (blanco y negro, listos para imprimir, firmar y foliar):
 *  · Libro diario        · Libro mayor (analítico por cuenta)        · Libro de inventarios (por producto)
 *  · Balance de comprobación, estado de resultados y balance general (un solo PDF)
 * Cada hoja lleva razón social, RIF, domicilio, período y número de folio. El diario trae «suma y sigue / suman y vienen».
 */
import { cargar, estilosBase, FINA, MEDIA, marca } from './pdfLibro';
import { n2 } from './format';

export const M = 14, TOP = 41;                                       // margen lateral y arranque del contenido bajo el encabezado
const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const cel = (v) => (v ? n2(v) : '');
const mesLargo = (ym) => { const t = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T12:00:00Z`)); return t.charAt(0).toUpperCase() + t.slice(1); };
const TIPO = { ACTIVO: 'Activo', PASIVO: 'Pasivo', PATRIMONIO: 'Patrimonio', INGRESO: 'Ingreso', GASTO: 'Gasto' };

/* ── encabezado por hoja con folio ── */
export function nuevo(doc, { emisor, titulo, periodo, unidad, folio }) {
    const hechas = new Set();
    const cabecera = () => {
        const n = doc.internal.getCurrentPageInfo().pageNumber;
        if (hechas.has(n)) return; hechas.add(n);
        const W = doc.internal.pageSize.getWidth();
        doc.setFont('helvetica', 'bold').setFontSize(11).text(emisor.comercial || emisor.razon_social || '', M, M + 3);
        doc.setFont('helvetica', 'normal').setFontSize(8);
        doc.text([emisor.rif && `RIF ${emisor.rif}`, emisor.comercial && emisor.razon_social !== emisor.comercial && emisor.razon_social].filter(Boolean).join('  ·  '), M, M + 7.5);
        if (emisor.direccion) doc.text(doc.splitTextToSize(`Domicilio fiscal: ${emisor.direccion}`, W / 2 - M).slice(0, 2), M, M + 11.5);
        doc.setFont('helvetica', 'bold').setFontSize(13).text(titulo, W - M, M + 4, { align: 'right' });
        doc.setFont('helvetica', 'normal').setFontSize(8.5).text(periodo, W - M, M + 9, { align: 'right' });
        doc.setFontSize(7.5).text(unidad, W - M, M + 13, { align: 'right' });
        doc.setFont('helvetica', 'bold').setFontSize(8.5).text(`Folio N.º ${folio + n - 1}`, W - M, M + 17.5, { align: 'right' });
        doc.setLineWidth(MEDIA).line(M, M + 21, W - M, M + 21);
    };
    return cabecera;
}

export function pieHojas(doc) {
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
        doc.setPage(i); doc.setLineWidth(FINA).line(M, H - 11, W - M, H - 11);
        doc.setFont('helvetica', 'normal').setFontSize(7).text(`Emitido por el sistema el ${marca()}`, M, H - 7.5);
        doc.text(`Hoja ${i} de ${n}`, W - M, H - 7.5, { align: 'right' });
    }
}

/** Bloque de firmas al final del último libro/estado. */
export function firmas(doc, y, cabecera, { contador, lugar }) {
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    if (y > H - 62) { doc.addPage(); cabecera(); y = TOP; }
    y += 8;
    doc.setFont('helvetica', 'normal').setFontSize(8).text(`${lugar || 'San Cristóbal'}, ${new Intl.DateTimeFormat('es-VE', { dateStyle: 'long', timeZone: 'America/Caracas' }).format(new Date())}`, M, y);
    y += 22; const mitad = (W - M * 2 - 16) / 2;
    doc.setLineWidth(FINA).line(M, y, M + mitad, y).line(W - M - mitad, y, W - M, y);
    doc.setFontSize(8).setFont('helvetica', 'bold');
    doc.text('Representante legal', M + mitad / 2, y + 4, { align: 'center' });
    doc.text('Contador público', W - M - mitad / 2, y + 4, { align: 'center' });
    doc.setFont('helvetica', 'normal').setFontSize(7.5);
    doc.text('Nombre, C.I. y firma', M + mitad / 2, y + 8, { align: 'center' });
    doc.text([contador?.nombre || 'Nombre y firma', contador?.cpc ? `C.P.C. N.º ${contador.cpc}` : 'C.P.C. N.º'].join('\n'), W - M - mitad / 2, y + 8, { align: 'center' });
    return y + 16;
}

export const base = (doc, cabecera, extra = {}) => ({
    ...estilosBase(doc, M), margin: { left: M, right: M, top: TOP, bottom: 24 }, startY: TOP, showHead: 'everyPage',
    didDrawPage: cabecera, ...extra,
});

/* ═════════════ LIBRO DIARIO ═════════════ */
export async function pdfLibroDiario(d, { folio = 1, contador } = {}) {
    const { doc, autoTable } = await cargar('portrait');
    const periodo = `${mesLargo(d.mes)} · del ${dmy(d.desde)} al ${dmy(d.hasta)}`;
    doc.setProperties({ title: `Libro diario ${d.mes}`, subject: d.emisor.razon_social, creator: 'Repuestos' });
    const cab = nuevo(doc, { emisor: d.emisor, titulo: 'Libro diario', periodo, unidad: 'Expresado en bolívares (Bs)', folio });
    const body = [], meta = [];
    d.filas.forEach((a) => {
        body.push([dmy(a.fecha), { content: `Asiento N.º ${a.numero}  —  ${a.concepto}`, colSpan: 4 }]); meta.push({ t: 'asiento' });
        a.lineas.forEach((l) => { body.push(['', l.codigo, l.glosa ? `${l.cuenta}  (${l.glosa})` : l.cuenta, cel(l.debe), cel(l.haber)]); meta.push({ t: 'linea', haber: l.haber > 0, debe: l.debe, hab: l.haber }); });
    });
    if (!body.length) { body.push(['', '', 'Sin asientos en este período', '', '']); meta.push({ t: 'linea', debe: 0, hab: 0 }); }
    const sumas = {};                                        // debe/haber dibujados por hoja
    cab();
    autoTable(doc, base(doc, cab, {
        head: [['Fecha', 'Código', 'Cuenta (y detalle)', 'Debe', 'Haber']], body,
        columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 18 }, 3: { halign: 'right', cellWidth: 29 }, 4: { halign: 'right', cellWidth: 29 } },
        didParseCell: (x) => {
            if (x.section === 'head' && x.column.index >= 3) x.cell.styles.halign = 'right';
            const m = meta[x.row.index]; if (x.section !== 'body' || !m) return;
            if (m.t === 'asiento') { x.cell.styles.fontStyle = 'bold'; x.cell.styles.fontSize = 8; }
            if (m.t === 'linea' && m.haber && x.column.index === 2) x.cell.styles.cellPadding = { top: 1.5, bottom: 1.5, left: 6, right: 0.8 };
        },
        didDrawCell: (() => { const b = estilosBase(doc, M).didDrawCell; return (x) => {
            b(x); const m = meta[x.row.index];
            if (x.section === 'body' && m?.t === 'linea' && x.column.index === 3) { const pg = doc.internal.getCurrentPageInfo().pageNumber; sumas[pg] = sumas[pg] || [0, 0]; sumas[pg][0] += m.debe || 0; sumas[pg][1] += m.hab || 0; }
        }; })(),
    }));
    let y = doc.lastAutoTable.finalY + 2;
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), np = doc.getNumberOfPages();
    // «Suma y sigue» al pie y «Suman y vienen» arriba de cada hoja
    let acum = [0, 0];
    for (let p = 1; p <= np; p++) {
        doc.setPage(p);
        if (p > 1) { doc.setFont('helvetica', 'bolditalic').setFontSize(7.5).text('Suman y vienen', M + 20, TOP - 2.5); doc.text(n2(acum[0]), W - M - 29 - 1, TOP - 2.5, { align: 'right' }); doc.text(n2(acum[1]), W - M - 1, TOP - 2.5, { align: 'right' }); }
        acum = [acum[0] + (sumas[p]?.[0] || 0), acum[1] + (sumas[p]?.[1] || 0)];
        if (p < np) { doc.setFont('helvetica', 'bolditalic').setFontSize(7.5).text('Suma y sigue', M + 20, H - 16); doc.text(n2(acum[0]), W - M - 29 - 1, H - 16, { align: 'right' }); doc.text(n2(acum[1]), W - M - 1, H - 16, { align: 'right' }); }
    }
    doc.setPage(np);
    const tot = doc.lastAutoTable.finalY + 3;
    if (tot > H - 38) { doc.addPage(); cab(); y = TOP; } else y = tot;
    doc.setLineWidth(MEDIA).line(M, y, W - M, y);
    doc.setFont('helvetica', 'bold').setFontSize(8.5).text('Totales del período', M + 20, y + 5);
    doc.text(n2(d.total), W - M - 29 - 1, y + 5, { align: 'right' }); doc.text(n2(d.total), W - M - 1, y + 5, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(7.5).text(`${d.filas.length} ${d.filas.length === 1 ? 'asiento' : 'asientos'} · el debe y el haber son iguales.`, M + 20, y + 9.5);
    firmas(doc, y + 12, cab, { contador, lugar: 'San Cristóbal' });
    pieHojas(doc);
    return doc;
}

/* ═════════════ LIBRO MAYOR ═════════════ */
export async function pdfLibroMayor(d, { folio = 1, contador } = {}) {
    const { doc, autoTable } = await cargar('portrait');
    const periodo = `${mesLargo(d.mes)} · del ${dmy(d.desde)} al ${dmy(d.hasta)}`;
    doc.setProperties({ title: `Libro mayor ${d.mes}`, subject: d.emisor.razon_social, creator: 'Repuestos' });
    const cab = nuevo(doc, { emisor: d.emisor, titulo: 'Libro mayor', periodo, unidad: 'Expresado en bolívares (Bs)', folio });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    cab(); let y = TOP;
    if (!d.cuentas.length) { doc.setFontSize(9).text('Sin movimientos en este período.', M, y); y += 8; }
    d.cuentas.forEach((c) => {
        if (y > H - 56) { doc.addPage(); cab(); y = TOP; }
        doc.setFont('helvetica', 'bold').setFontSize(9.5).text(`${c.codigo}  ${c.cuenta}`, M, y);
        doc.setFont('helvetica', 'normal').setFontSize(7.5).text(`${TIPO[c.tipo]} · naturaleza ${c.naturaleza === 'DEUDORA' ? 'deudora' : 'acreedora'}`, W - M, y, { align: 'right' });
        const body = [[{ content: 'Saldo inicial', colSpan: 5, styles: { fontStyle: 'italic' } }, n2(c.inicial)],
            ...c.movimientos.map((m) => [dmy(m.fecha), `N.º ${m.numero}`, m.concepto, cel(m.debe), cel(m.haber), n2(m.saldo)])];
        autoTable(doc, base(doc, cab, {
            startY: y + 2, head: [['Fecha', 'Asiento', 'Concepto', 'Debe', 'Haber', 'Saldo']], body,
            foot: [[{ content: 'Totales y saldo final', colSpan: 3 }, n2(c.debitos), n2(c.creditos), n2(c.final)]], showFoot: 'lastPage',
            footStyles: { fontStyle: 'bold', fillColor: false, textColor: 0, fontSize: 7.5 },
            columnStyles: { 0: { cellWidth: 19 }, 1: { cellWidth: 17 }, 3: { halign: 'right', cellWidth: 26 }, 4: { halign: 'right', cellWidth: 26 }, 5: { halign: 'right', cellWidth: 28 } },
            didParseCell: (x) => { if ((x.section === 'head' || x.section === 'foot') && x.column.index >= 3) x.cell.styles.halign = 'right'; if (x.section === 'body' && x.row.index === 0 && x.column.index === 5) x.cell.styles.halign = 'right'; },
        }));
        y = doc.lastAutoTable.finalY + 9;
    });
    doc.setPage(doc.getNumberOfPages());
    doc.setFont('helvetica', 'normal').setFontSize(7.5).text('El saldo de cada cuenta se expresa según su naturaleza: activos y gastos aumentan por el debe; pasivos, patrimonio e ingresos, por el haber.', M, y - 3, { maxWidth: W - M * 2 });
    firmas(doc, y + 3, cab, { contador });
    pieHojas(doc);
    return doc;
}

/* ═════════════ LIBRO DE INVENTARIOS ═════════════ */
export async function pdfLibroInventario(d, { folio = 1, contador } = {}) {
    const { doc, autoTable } = await cargar('portrait');
    const periodo = `Inventario al ${dmy(d.corte)}`;
    doc.setProperties({ title: `Libro de inventarios ${d.corte}`, subject: d.emisor.razon_social, creator: 'Repuestos' });
    const cab = nuevo(doc, { emisor: d.emisor, titulo: 'Libro de inventarios', periodo, unidad: d.tasa ? `Costos en US$ · valor en Bs a ${n2(d.tasa)} Bs por US$` : 'Costos en US$', folio });
    const W = doc.internal.pageSize.getWidth();
    const body = [], meta = []; let totU = 0, totV = 0, totB = 0, totEx = 0;
    const cats = [...new Set(d.filas.map((f) => f.categoria))];
    cats.forEach((cat) => {
        const fs = d.filas.filter((f) => f.categoria === cat);
        body.push([{ content: cat, colSpan: 7 }]); meta.push('cat');
        fs.forEach((f) => { body.push([f.sku, f.producto, f.unidad, n2(f.existencia), n2(f.costo), n2(f.valor_usd), f.valor_ves == null ? '—' : n2(f.valor_ves)]); meta.push('fila'); });
        const u = fs.reduce((s, f) => s + f.existencia, 0), v = fs.reduce((s, f) => s + f.valor_usd, 0), bs = fs.reduce((s, f) => s + (f.valor_ves || 0), 0);
        body.push([{ content: `Subtotal ${cat}`, colSpan: 3 }, n2(u), '', n2(v), d.sin_tasa ? '—' : n2(bs)]); meta.push('sub');
        totU += u; totV += v; totB += bs; totEx += fs.length;
    });
    if (!body.length) { body.push([{ content: 'Sin existencias a esa fecha', colSpan: 7 }]); meta.push('fila'); }
    cab();
    autoTable(doc, base(doc, cab, {
        head: [['Código', 'Descripción', 'Und', 'Existencia', 'Costo unit. US$', 'Valor US$', 'Valor Bs']], body,
        foot: [[{ content: `TOTAL GENERAL (${totEx} productos)`, colSpan: 3 }, n2(totU), '', n2(totV), d.sin_tasa ? '—' : n2(totB)]], showFoot: 'lastPage',
        footStyles: { fontStyle: 'bold', fillColor: false, textColor: 0, fontSize: 8 },
        styles: { ...estilosBase(doc, M).styles, fontSize: 7.2 },
        columnStyles: { 0: { cellWidth: 25 }, 2: { cellWidth: 10 }, 3: { halign: 'right', cellWidth: 20 }, 4: { halign: 'right', cellWidth: 22 }, 5: { halign: 'right', cellWidth: 24 }, 6: { halign: 'right', cellWidth: 28 } },
        didParseCell: (x) => {
            if ((x.section === 'head' || x.section === 'foot') && x.column.index >= 3) x.cell.styles.halign = 'right';
            if (x.section === 'body') { const m = meta[x.row.index]; if (m === 'cat') { x.cell.styles.fontStyle = 'bold'; x.cell.styles.fontSize = 8; } if (m === 'sub') { x.cell.styles.fontStyle = 'bold'; if (x.column.index >= 3) x.cell.styles.halign = 'right'; } }
        },
    }));
    let y = doc.lastAutoTable.finalY + 6;
    const notas = [`Existencias según el kardex al cierre del ${dmy(d.corte)}. Costo: el último registrado para cada producto hasta esa fecha.`,
        d.sin_tasa ? 'No había tasa de cambio cargada para esa fecha: el valor en bolívares no se calculó.' : `Valor en bolívares calculado a la tasa de cambio de esa fecha (${n2(d.tasa)} Bs por US$).`];
    doc.setFont('helvetica', 'normal').setFontSize(7.5);
    notas.forEach((t) => { const l = doc.splitTextToSize(t, W - M * 2); doc.text(l, M, y); y += l.length * 3.6; });
    firmas(doc, y, cab, { contador });
    pieHojas(doc);
    return doc;
}

/* ═════════════ ESTADOS FINANCIEROS ═════════════ */
export async function pdfEstados(d, { folio = 1, contador } = {}) {
    const { doc, autoTable } = await cargar('portrait');
    const W = doc.internal.pageSize.getWidth();
    doc.setProperties({ title: `Estados financieros ${d.mes}`, subject: d.emisor.razon_social, creator: 'Repuestos' });
    const R = { halign: 'right' };
    const cabDe = (titulo, periodo) => nuevo(doc, { emisor: d.emisor, titulo, periodo, unidad: 'Expresado en bolívares (Bs)', folio });
    const pagina = (titulo, periodo, primera) => { if (!primera) doc.addPage(); const cab = cabDe(titulo, periodo); cab(); return cab; };
    const sec = (t, y) => { doc.setFont('helvetica', 'bold').setFontSize(9.5).text(t, M, y); doc.setLineWidth(FINA).line(M, y + 1.8, W - M, y + 1.8); return y + 3.5; };

    /* 1 · Balance de comprobación */
    let cab = pagina('Balance de comprobación', `${mesLargo(d.mes)} · del ${dmy(d.desde)} al ${dmy(d.hasta)}`, true);
    const c = d.comprobacion.filter((x) => x.inicial || x.debitos || x.creditos);
    const t = c.reduce((a, x) => [a[0] + x.debitos, a[1] + x.creditos], [0, 0]);
    autoTable(doc, base(doc, cab, {
        head: [['Código', 'Cuenta', 'Tipo', 'Saldo inicial', 'Débitos', 'Créditos', 'Saldo final']],
        body: c.length ? c.map((x) => [x.codigo, x.cuenta, TIPO[x.tipo], n2(x.inicial), cel(x.debitos), cel(x.creditos), n2(x.final)]) : [['', 'Sin movimientos en este período', '', '', '', '', '']],
        foot: [[{ content: 'Totales del período', colSpan: 4 }, n2(t[0]), n2(t[1]), '']], showFoot: 'lastPage', footStyles: { fontStyle: 'bold', fillColor: false, textColor: 0, fontSize: 7.5 },
        columnStyles: { 0: { cellWidth: 16 }, 2: { cellWidth: 20 }, 3: { ...R, cellWidth: 26 }, 4: { ...R, cellWidth: 26 }, 5: { ...R, cellWidth: 26 }, 6: { ...R, cellWidth: 26 } },
        didParseCell: (x) => { if ((x.section === 'head' || x.section === 'foot') && x.column.index >= 3) x.cell.styles.halign = 'right'; },
    }));
    let y = doc.lastAutoTable.finalY + 6;
    doc.setFont('helvetica', 'normal').setFontSize(7.5).text(Math.abs(t[0] - t[1]) < 0.005 ? 'Los débitos y los créditos del período son iguales.' : 'Atención: los débitos y los créditos no coinciden.', M, y);

    /* 2 · Estado de resultados */
    cab = pagina('Estado de resultados', `Del ${dmy(d.desde)} al ${dmy(d.hasta)}`, false);
    y = sec('Ingresos', TOP);
    const r = d.resultados;
    const tabla = (items, total, etiqueta) => {
        autoTable(doc, base(doc, cab, { startY: y, body: items.length ? items.map((x) => [x.codigo, x.cuenta, n2(x.monto)]) : [['', 'Sin movimientos', '']],
            foot: [[{ content: etiqueta, colSpan: 2 }, n2(total)]], showFoot: 'lastPage', footStyles: { fontStyle: 'bold', fillColor: false, textColor: 0, fontSize: 8 },
            columnStyles: { 0: { cellWidth: 20 }, 2: { ...R, cellWidth: 36 } }, didParseCell: (x) => { if (x.section === 'foot' && x.column.index >= 2) x.cell.styles.halign = 'right'; } }));
        y = doc.lastAutoTable.finalY + 9;
    };
    tabla(r.ingresos, r.total_ingresos, 'Total de ingresos');
    y = sec('Costos y gastos', y); tabla(r.gastos, r.total_gastos, 'Total de costos y gastos');
    doc.setLineWidth(MEDIA).line(M, y - 2, W - M, y - 2);
    doc.setFont('helvetica', 'bold').setFontSize(10).text(r.resultado < 0 ? 'Pérdida del período' : 'Ganancia del período', M, y + 3.5); doc.text(`Bs ${n2(Math.abs(r.resultado))}`, W - M, y + 3.5, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(7.5).text('Ingresos por ventas sin IVA, menos el costo de la mercancía vendida y los gastos registrados en el período.', M, y + 9);

    /* 3 · Balance general */
    cab = pagina('Balance general', `Al ${dmy(d.hasta > d.corte ? d.corte : d.hasta)}`, false);
    const b = d.balance; y = TOP;
    const bloque = (titulo, items, total, etiqueta, extra) => {
        y = sec(titulo, y);
        const body = items.map((x) => [x.codigo, x.cuenta, n2(x.final)]); if (extra) body.push(['', extra[0], n2(extra[1])]);
        autoTable(doc, base(doc, cab, { startY: y, body: body.length ? body : [['', 'Sin saldo', '']], foot: [[{ content: etiqueta, colSpan: 2 }, n2(total)]], showFoot: 'lastPage', footStyles: { fontStyle: 'bold', fillColor: false, textColor: 0, fontSize: 8 },
            columnStyles: { 0: { cellWidth: 20 }, 2: { ...R, cellWidth: 36 } }, didParseCell: (x) => { if (x.section === 'foot' && x.column.index >= 2) x.cell.styles.halign = 'right'; } }));
        y = doc.lastAutoTable.finalY + 9;
    };
    const sum = (a) => Math.round(a.reduce((s, x) => s + x.final, 0) * 100) / 100;
    const tA = sum(b.activos), tP = sum(b.pasivos), tPat = Math.round((sum(b.patrimonio) + b.resultado_acumulado) * 100) / 100;
    bloque('Activo', b.activos, tA, 'Total del activo');
    bloque('Pasivo', b.pasivos, tP, 'Total del pasivo');
    bloque('Patrimonio', b.patrimonio, tPat, 'Total del patrimonio', ['Resultado acumulado (ingresos menos costos y gastos, sin cierre de ejercicio)', b.resultado_acumulado]);
    doc.setLineWidth(MEDIA).line(M, y - 2, W - M, y - 2);
    doc.setFont('helvetica', 'bold').setFontSize(9.5).text('Total pasivo + patrimonio', M, y + 3.5); doc.text(n2(tP + tPat), W - M, y + 3.5, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(7.5).text(Math.abs(tA - tP - tPat) < 0.005 ? 'El activo es igual al pasivo más el patrimonio.' : `Atención: el activo y el pasivo más el patrimonio difieren en Bs ${n2(tA - tP - tPat)}.`, M, y + 9);
    firmas(doc, y + 12, cab, { contador });
    pieHojas(doc);
    return doc;
}

export const PDF_CONTAB = { diario: pdfLibroDiario, mayor: pdfLibroMayor, inventario: pdfLibroInventario, estados: pdfEstados };
