/**
 * PDF de la conciliación (blanco y negro, listo para imprimir, firmar y foliar). Reutiliza el encabezado, el folio y las firmas de pdfContabilidad.
 *  · Acta de conciliación bancaria  (saldo libros ajustado = saldo banco ajustado, partidas en tránsito, ajustes por registrar, anexo de conciliados)
 *  · Reporte de conciliación fiscal (sistema vs. declarado en el portal del SENIAT, con semáforo)
 * Requisitos formales que cumple cada hoja: razón social, RIF, domicilio fiscal, período, número de folio y «hoja X de Y».
 * Las tablas que ocupan más de una hoja llevan «Suma y sigue» al pie y «Suman y vienen» al inicio de la hoja siguiente.
 */
import { cargar, estilosBase, FINA, MEDIA } from './pdfLibro';
import { M, TOP, base, firmas, nuevo, pieHojas } from './pdfContabilidad';
import { n2 } from './format';

const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const mesLargo = (ym) => { const t = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T12:00:00Z`)); return t.charAt(0).toUpperCase() + t.slice(1); };
const fechaLarga = (d = new Date()) => new Intl.DateTimeFormat('es-VE', { dateStyle: 'long', timeZone: 'America/Caracas' }).format(d);
export const neg = (v) => (v < 0 ? `(${n2(Math.abs(v))})` : n2(v));                 // los negativos van entre paréntesis, como en los estados contables
const SEMAFORO = { CUADRA: ['Cuadra', [20, 128, 74]], REDONDEO: ['Redondeo', [242, 169, 0]], NO_CUADRA: ['No cuadra', [196, 41, 31]], SIN_DECLARAR: ['Sin declarar', [140, 148, 158]] };

/**
 * Dibuja una tabla y, si pasa a otra hoja, «Suma y sigue» / «Suman y vienen» sobre la columna de montos.
 * filas: [{ celdas: [...], monto: número|null, estilo?: 'titulo'|'sub' }]. colMonto: índice de la columna que se suma.
 */
export function tabla(doc, autoTable, cab, y, { head, filas, colMonto, columnStyles, etiquetaCol = 0, didDrawCell }) {
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const porHoja = {};
    const body = filas.map((f) => f.celdas);
    autoTable(doc, base(doc, cab, {
        head: head ? [head] : undefined, body, startY: y, columnStyles,
        didParseCell: (x) => {
            if (x.section === 'head' && columnStyles?.[x.column.index]?.halign === 'right') x.cell.styles.halign = 'right';
            const f = filas[x.row.index]; if (x.section !== 'body' || !f) return;
            if (f.estilo === 'titulo') { x.cell.styles.fontStyle = 'bold'; x.cell.styles.fontSize = 8; }
            if (f.estilo === 'sub') { x.cell.styles.fontStyle = 'italic'; }
        },
        didDrawCell: (x) => {
            estilosBase(doc, M).didDrawCell(x);
            if (x.section === 'body' && x.column.index === 0) { const pg = doc.internal.getCurrentPageInfo().pageNumber; porHoja[pg] = (porHoja[pg] || 0) + (filas[x.row.index]?.monto || 0); }
            didDrawCell?.(x, filas[x.row.index]);
        },
    }));
    const paginas = Object.keys(porHoja).map(Number).sort((a, b) => a - b);
    const xMonto = (() => { let acc = W - M; const cs = columnStyles || {}; const ult = Math.max(...Object.keys(cs).map(Number), colMonto); for (let i = ult; i > colMonto; i--) acc -= cs[i]?.cellWidth || 0; return acc - 1; })();
    let acum = 0;
    paginas.forEach((p, i) => {
        doc.setPage(p);
        if (i > 0) { doc.setFont('helvetica', 'bolditalic').setFontSize(7.5).text('Suman y vienen', xMonto - 40, TOP - 2.5, { align: 'right' }); doc.text(neg(acum), xMonto, TOP - 2.5, { align: 'right' }); }
        acum += porHoja[p];
        if (i < paginas.length - 1) { doc.setFont('helvetica', 'bolditalic').setFontSize(7.5).text('Suma y sigue', xMonto - 40, H - 16, { align: 'right' }); doc.text(neg(acum), xMonto, H - 16, { align: 'right' }); }
    });
    doc.setPage(doc.getNumberOfPages());
    return { y: doc.lastAutoTable.finalY, total: acum };
}

/** Si no cabe un bloque de `alto` mm, salta de hoja (con su encabezado y folio). */
export function espacio(doc, cab, y, alto) {
    const H = doc.internal.pageSize.getHeight();
    if (y + alto > H - 24) { doc.addPage(); cab(); return TOP; }
    return y;
}

const subtitulo = (doc, texto, y) => { doc.setFont('helvetica', 'bold').setFontSize(9).text(texto, M, y); return y + 2; };

/* ═════════════ ACTA DE CONCILIACIÓN BANCARIA ═════════════ */
export async function pdfActaBancaria(d, { folio, contador, lugar = 'San Cristóbal' } = {}) {
    const { doc, autoTable } = await cargar('portrait');
    const c = d.conciliacion, r = d.resumen, W = doc.internal.pageSize.getWidth();
    const f0 = folio || c.folio_inicial || 1;
    doc.setProperties({ title: `Acta de conciliación bancaria ${c.banco} ${c.hasta}`, subject: d.emisor.razon_social, creator: 'Repuestos' });
    const cab = nuevo(doc, { emisor: d.emisor, titulo: 'Acta de conciliación bancaria', periodo: `Del ${dmy(c.desde)} al ${dmy(c.hasta)}`, unidad: 'Expresado en bolívares (Bs)', folio: f0 });
    cab();
    let y = TOP;
    doc.setFont('helvetica', 'normal').setFontSize(9);
    const cuadra = Math.abs(r.diferencia ?? 1) < 0.005 && r.lineas_pendientes === 0;
    const texto = `En ${lugar}, a ${fechaLarga()}, se concilió la cuenta ${c.cuenta} del libro mayor de ${d.emisor.razon_social}${d.emisor.rif ? `, RIF ${d.emisor.rif}` : ''}, con el estado de cuenta de ${c.banco}${c.cuenta_bancaria ? ` (cuenta ${c.cuenta_bancaria})` : ''} correspondiente al período del ${dmy(c.desde)} al ${dmy(c.hasta)}, con el siguiente resultado:`;
    const lin = doc.splitTextToSize(texto, W - M * 2); doc.text(lin, M, y); y += lin.length * 4.2 + 3;
    doc.setFont('helvetica', 'bold').setFontSize(9).text(d.cerrada ? 'Estado del acta: CERRADA' : 'Estado del acta: BORRADOR — no es válida hasta cerrarse', M, y);
    doc.text(cuadra ? 'CONCILIADO' : 'NO CONCILIADO', W - M, y, { align: 'right' }); y += 5;

    // Cuadro de conciliación (dos lados)
    const fila = (t, v, o = {}) => ({ celdas: [{ content: t, styles: o.neg ? { fontStyle: 'bold' } : {} }, { content: v === null ? '' : neg(v), styles: { halign: 'right', fontStyle: o.neg ? 'bold' : 'normal' } }], monto: 0, estilo: o.estilo });
    const sinSaldo = r.saldo_banco === null;
    const cuadro = [
        { celdas: [{ content: 'A. Según el libro mayor', colSpan: 2 }], monto: 0, estilo: 'titulo' },
        fila(`Saldo de la cuenta al ${dmy(c.hasta)}`, r.saldo_libros),
        fila('(+) Abonos del banco aún no registrados en libros (notas de crédito, intereses)', r.ajustes_abonos),
        fila('(-) Cargos del banco aún no registrados en libros (comisiones, notas de débito)', r.ajustes_cargos),
        fila('Saldo según libros ajustado', r.saldo_libros_ajustado, { neg: true }),
        { celdas: [{ content: 'B. Según el estado de cuenta del banco', colSpan: 2 }], monto: 0, estilo: 'titulo' },
        fila(`Saldo final del estado de cuenta al ${dmy(c.hasta)}`, r.saldo_banco),
        fila('(+) Depósitos en tránsito (registrados en libros, aún no acreditados por el banco)', r.depositos_transito),
        fila('(-) Pagos y cheques en tránsito (registrados en libros, aún no debitados por el banco)', r.pagos_transito),
        fila('Saldo según banco ajustado', sinSaldo ? null : r.saldo_banco_ajustado, { neg: true }),
        fila('Diferencia (A - B)', sinSaldo ? null : r.diferencia, { neg: true }),
    ];
    autoTable(doc, base(doc, cab, { body: cuadro.map((x) => x.celdas), startY: y, columnStyles: { 1: { halign: 'right', cellWidth: 34 } },
        didParseCell: (x) => { const f = cuadro[x.row.index]; if (f?.estilo === 'titulo') x.cell.styles.fontStyle = 'bold'; },
        didDrawCell: (x) => { estilosBase(doc, M).didDrawCell(x); } }));
    y = doc.lastAutoTable.finalY + 2;
    if (r.lineas_pendientes > 0) { doc.setFont('helvetica', 'italic').setFontSize(8).text(`Quedan ${r.lineas_pendientes} movimiento(s) del banco por Bs ${neg(r.monto_pendiente)} sin cruzar ni clasificar.`, M, y + 3); y += 6; }
    y += 6;

    // Detalle por partida (cada tabla con suma y sigue)
    const bloques = [
        ['Ajustes por registrar en libros (movimientos del banco sin asiento)', d.ajustes.map((a) => ({ celdas: [dmy(a.fecha), a.referencia || '', `${a.clase}${a.nota ? ' — ' + a.nota : (a.descripcion ? ' — ' + a.descripcion : '')}`, neg(a.monto)], monto: a.monto })), ['Fecha', 'Referencia', 'Concepto', 'Monto']],
        ['Depósitos en tránsito', d.depositos_transito.map((t) => ({ celdas: [dmy(t.fecha), `Asiento ${t.asiento}`, t.concepto, neg(t.monto)], monto: t.monto })), ['Fecha', 'Asiento', 'Concepto', 'Monto']],
        ['Pagos y cheques en tránsito', d.pagos_transito.map((t) => ({ celdas: [dmy(t.fecha), `Asiento ${t.asiento}`, t.concepto, neg(t.monto)], monto: t.monto })), ['Fecha', 'Asiento', 'Concepto', 'Monto']],
    ];
    for (const [titulo, filas, head] of bloques) {
        if (!filas.length) continue;
        y = espacio(doc, cab, y, 24); y = subtitulo(doc, titulo, y + 1);
        const t = tabla(doc, autoTable, cab, y + 1, { head, filas, colMonto: 3, columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 26 }, 3: { halign: 'right', cellWidth: 30 } } });
        doc.setFont('helvetica', 'bold').setFontSize(8.5); y = t.y + 5; doc.text(`Total ${titulo.split(' (')[0].toLowerCase()}`, M + 46, y); doc.text(neg(t.total), W - M - 1, y, { align: 'right' }); y += 8;
    }

    // Anexo: lo conciliado, línea del banco contra sus asientos
    if (d.conciliados.length) {
        y = espacio(doc, cab, y, 28); y = subtitulo(doc, 'Anexo: movimientos conciliados (banco contra libros)', y + 1);
        const filas = d.conciliados.map((k) => ({ celdas: [dmy(k.fecha), k.referencia || '', (k.descripcion || '').slice(0, 40), k.asientos.map((a) => `N.º ${a.asiento}`).join(', ') + (k.metodo === 'MANUAL' ? ' (manual)' : ''), neg(k.monto)], monto: k.monto }));
        const t = tabla(doc, autoTable, cab, y + 1, { head: ['Fecha', 'Referencia', 'Descripción del banco', 'Asientos', 'Monto'], filas, colMonto: 4, columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 24 }, 3: { cellWidth: 38 }, 4: { halign: 'right', cellWidth: 28 } } });
        doc.setFont('helvetica', 'bold').setFontSize(8.5); y = t.y + 5; doc.text('Total conciliado', M + 46, y); doc.text(neg(t.total), W - M - 1, y, { align: 'right' }); y += 6;
        if (d.anteriores) { doc.setFont('helvetica', 'italic').setFontSize(8).text(`Además, ${d.anteriores} asiento(s) se dieron por conciliados en períodos anteriores a este sistema.`, M, y); y += 5; }
    }
    if (c.observaciones) { y = espacio(doc, cab, y + 2, 20); doc.setFont('helvetica', 'bold').setFontSize(8.5).text('Observaciones', M, y); doc.setFont('helvetica', 'normal'); const o = doc.splitTextToSize(c.observaciones, W - M * 2); doc.text(o, M, y + 4); y += o.length * 4 + 4; }
    firmas(doc, y, cab, { contador, lugar });
    pieHojas(doc);
    return doc;
}

/* ═════════════ REPORTE DE CONCILIACIÓN FISCAL ═════════════ */
export async function pdfReporteFiscal(d, { folio = 1, contador, lugar = 'San Cristóbal' } = {}) {
    const { doc, autoTable } = await cargar('portrait');
    const W = doc.internal.pageSize.getWidth();
    const rango = d.desde_mes === d.hasta_mes ? mesLargo(d.desde_mes) : `${mesLargo(d.desde_mes)} a ${mesLargo(d.hasta_mes)}`;
    doc.setProperties({ title: `Conciliación fiscal ${d.desde_mes} ${d.hasta_mes}`, subject: d.emisor.razon_social, creator: 'Repuestos' });
    const cab = nuevo(doc, { emisor: d.emisor, titulo: 'Conciliación fiscal', periodo: `${rango} · declaración ${d.periodicidad === 'QUINCENAL' ? 'quincenal' : 'mensual'}`, unidad: 'Expresado en bolívares (Bs) salvo indicación', folio });
    cab();
    let y = TOP;
    doc.setFont('helvetica', 'normal').setFontSize(8.5);
    const intro = doc.splitTextToSize('Compara lo que calcula el sistema con los libros de ventas y de compras, las retenciones de IVA y el IGTF (columna «Sistema») contra los montos que el contribuyente declaró en el portal del SENIAT (columna «Declarado», transcritos de las planillas presentadas). El sistema no consulta el portal: la columna «Declarado» es la que se anotó a mano. Diferencia = Declarado - Sistema.', W - M * 2);
    doc.text(intro, M, y); y += intro.length * 3.9 + 3;

    const filas = [];
    d.periodos.forEach((p) => {
        const pr = p.periodo;
        filas.push({ celdas: [{ content: `${pr.quincena ? `Quincena ${pr.quincena} de ${mesLargo(pr.mes)}` : mesLargo(pr.mes)}  ·  del ${dmy(pr.desde)} al ${dmy(pr.hasta)}`, colSpan: 4 }, { content: '', colSpan: 1 }, ''], monto: 0, estilo: 'titulo' });
        p.tipos.forEach((t) => {
            const det = t.declaracion ? `Planilla ${t.declaracion.numero_planilla ? 'N.º ' + t.declaracion.numero_planilla : 'sin número'}${t.declaracion.fecha_presentacion ? `, presentada el ${dmy(t.declaracion.fecha_presentacion)}` : ''}` : 'Sin declaración registrada';
            // Sin planilla registrada solo se listan los conceptos en que el sistema calcula algo (lo que debió declararse).
            const fs = t.declaracion ? t.filas : t.filas.filter((f) => Math.abs(f.sistema) > 0.004);
            filas.push({ celdas: [{ content: `${t.titulo} — ${det}${!t.declaracion && !fs.length ? ' (el sistema no calcula movimientos)' : ''}`, colSpan: 6 }], monto: 0, estilo: 'sub' });
            fs.forEach((f) => {
                const usd = f.unidad === 'USD';
                filas.push({ celdas: ['', f.etiqueta + (usd ? ' (US$)' : ''), n2(f.sistema), f.declarado === null ? '—' : n2(f.declarado), f.diferencia === null ? '—' : neg(f.diferencia), SEMAFORO[f.semaforo][0]],
                    monto: f.diferencia !== null && !usd ? Math.abs(f.diferencia) : 0, sem: f.semaforo });
            });
        });
    });
    if (!filas.length) filas.push({ celdas: [{ content: 'Todavía no hay períodos terminados en ese rango.', colSpan: 6 }], monto: 0 });
    const t = tabla(doc, autoTable, cab, y, {
        head: ['', 'Concepto', 'Sistema', 'Declarado', 'Diferencia', 'Estado'], filas, colMonto: 4,
        columnStyles: { 0: { cellWidth: 2 }, 2: { halign: 'right', cellWidth: 29 }, 3: { halign: 'right', cellWidth: 29 }, 4: { halign: 'right', cellWidth: 29 }, 5: { cellWidth: 27, cellPadding: { left: 6, right: 1, top: 1.6, bottom: 1.6 } } },
        didDrawCell: (x, f) => {                                              // semáforo: punto de color + texto (el texto basta si se imprime en blanco y negro)
            if (x.section !== 'body' || x.column.index !== 5 || !f?.sem) return;
            doc.setFillColor(...SEMAFORO[f.sem][1]).circle(x.cell.x + 3, x.cell.y + x.cell.height / 2, 1.1, 'F'); doc.setFillColor(255);
        },
    });
    y = t.y + 3;
    doc.setFont('helvetica', 'bolditalic').setFontSize(7.5).text('Suma de diferencias en Bs, en valor absoluto (no incluye la base en US$).', M, y + 2);
    doc.setFont('helvetica', 'bold').setFontSize(8.5).text(n2(t.total), W - M - 29 - 29 - 1, y + 2, { align: 'right' }); y += 9;

    // Resumen con semáforo
    y = espacio(doc, cab, y, 40); y = subtitulo(doc, 'Resumen del semáforo (por declaración)', y);
    const orden = ['CUADRA', 'REDONDEO', 'NO_CUADRA', 'SIN_DECLARAR'];
    const nota = { CUADRA: 'Diferencia de hasta Bs 0,01', REDONDEO: 'Diferencia de hasta Bs 1,00: normalmente redondeo', NO_CUADRA: 'Diferencia mayor: revisar antes de firmar o presentar sustitutiva', SIN_DECLARAR: 'No se registró la planilla de ese período' };
    autoTable(doc, base(doc, cab, { body: orden.map((k) => [SEMAFORO[k][0], String(d.resumen[k] || 0), nota[k]]), startY: y + 1, columnStyles: { 0: { cellWidth: 30, cellPadding: { left: 6, right: 1, top: 1.6, bottom: 1.6 } }, 1: { halign: 'right', cellWidth: 14 } },
        didDrawCell: (x) => { estilosBase(doc, M).didDrawCell(x); if (x.section === 'body' && x.column.index === 0) { doc.setFillColor(...SEMAFORO[orden[x.row.index]][1]).circle(x.cell.x + 3, x.cell.y + x.cell.height / 2, 1.1, 'F'); doc.setFillColor(255); } } }));
    y = doc.lastAutoTable.finalY + 4;
    doc.setFont('helvetica', 'italic').setFontSize(7.5);
    const notas = doc.splitTextToSize('Este reporte es un apoyo de control interno; no sustituye la declaración ni el criterio del contador. El IGTF se compara contra lo percibido en divisas incluyendo ventas luego anuladas (el reintegro se reclama aparte). Confirma el tratamiento con tu contador.', W - M * 2);
    doc.text(notas, M, y); y += notas.length * 3.4;
    firmas(doc, y, cab, { contador, lugar });
    pieHojas(doc);
    return doc;
}
