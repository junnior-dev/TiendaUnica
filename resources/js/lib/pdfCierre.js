/**
 * Informe de cierre de caja en PDF — blanco y negro, líneas finas, sin rellenos ni colores.
 * Se genera en el navegador con jsPDF (+ autoTable); no sale ningún dato del equipo.
 *
 *   const doc = await construirPdfCierre({ fecha, informe, emisor, cajeroNombre, conteo, cierre, generadoPor });
 *   doc.save('cierre-caja-2026-11-05.pdf');
 */
import { n2, n0, tasa } from './format';

const M = 18; // margen
const W = 210;
const ANCHO = W - M * 2;
const FINA = 0.15;
const MEDIA = 0.35;

const num = (m, v) => (m === 'COP' ? n0(v) : n2(v));
const con = (m, v) => `${m} ${num(m, v)}`;
const largo = (iso) =>
    new Intl.DateTimeFormat('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const marca = () =>
    new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Caracas', hour12: false }).format(new Date());

export async function construirPdfCierre({ fecha, informe, emisor, cajeroNombre, conteo = {}, cierre = null, generadoPor, periodo = null, cortes = [] }) {
    const esDia = !periodo || periodo.tipo === 'dia';
    const { jsPDF } = await import('jspdf');
    const at = await import('jspdf-autotable');
    const autoTable = at.autoTable || at.default?.default || at.default;

    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    doc.setProperties({ title: `${esDia ? 'Cierre de caja' : 'Informe de caja'} ${fecha}`, subject: emisor.comercial || emisor.razon_social, creator: 'Repuestos' });
    doc.setTextColor(0);
    doc.setDrawColor(0);
    doc.setFillColor(255);

    const r = informe.resumen;
    let y = M;

    /* ───── Encabezado ───── */
    doc.setFont('helvetica', 'bold').setFontSize(13);
    doc.text(emisor.comercial || emisor.razon_social || '', M, y + 4);
    doc.setFont('helvetica', 'normal').setFontSize(8);
    const linea2 = [emisor.rif && `RIF ${emisor.rif}`, emisor.razon_social !== emisor.comercial && emisor.razon_social].filter(Boolean).join('  ·  ');
    if (linea2) doc.text(linea2, M, y + 9);
    if (emisor.direccion) doc.text(doc.splitTextToSize(emisor.direccion, 95), M, y + 13);

    doc.setFont('helvetica', 'bold').setFontSize(17);
    doc.text(cierre ? `Corte Z N.º ${String(cierre.id).padStart(6, '0')}` : esDia ? 'Cierre de caja' : 'Informe de caja', W - M, y + 5, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(9);
    const f = esDia ? largo(fecha) : periodo.etiqueta;
    doc.text(f.charAt(0).toUpperCase() + f.slice(1), W - M, y + 10.5, { align: 'right' });
    doc.setFontSize(8);
    doc.text(cajeroNombre ? `Caja: ${cajeroNombre}` : 'Todas las cajas', W - M, y + 15, { align: 'right' });

    y += 21;
    doc.setLineWidth(MEDIA).line(M, y, W - M, y);
    y += 7;

    const titulo = (t, nota) => {
        if (y > 262) { doc.addPage(); y = M; }
        doc.setFont('helvetica', 'bold').setFontSize(9.5).text(t, M, y);
        if (nota) doc.setFont('helvetica', 'normal').setFontSize(7.5).text(nota, W - M, y, { align: 'right' });
        y += 1.8;
        doc.setLineWidth(FINA).line(M, y, W - M, y);
        y += 1.5;
    };
    const fin = () => (y = doc.lastAutoTable.finalY + 8);

    const base = {
        theme: 'plain',
        margin: { left: M, right: M },
        styles: { font: 'helvetica', fontSize: 8, textColor: 0, lineColor: 0, cellPadding: { top: 1.7, bottom: 1.7, left: 0.8, right: 0.8 }, overflow: 'linebreak' },
        headStyles: { fontStyle: 'bold', fillColor: false, textColor: 0, fontSize: 7.5 },
        bodyStyles: { fillColor: false },
        alternateRowStyles: { fillColor: false },
        // Una línea muy fina bajo cada fila; la del encabezado y la de totales, algo más marcada.
        didDrawCell: (d) => {
            const { x, y: cy, width, height } = d.cell;
            const marcada = d.section === 'head' || d.row.raw?.__tot;
            doc.setDrawColor(0).setLineWidth(marcada ? MEDIA : FINA);
            if (d.section === 'head') doc.line(x, cy + height, x + width, cy + height);
            else if (d.section === 'body') {
                doc.line(x, cy + height, x + width, cy + height);
                if (d.row.raw?.__tot) doc.line(x, cy, x + width, cy);
            }
        },
    };
    const R = { halign: 'right' };

    /* ───── Resumen ───── */
    titulo(esDia ? 'Resumen del día' : 'Resumen del período');
    const claves = [
        ['Ventas completadas', String(r.ventas)],
        ['Ventas anuladas', String(r.anuladas)],
        ['Base imponible y exento', `USD ${n2(r.base_usd)}`],
        ['IVA', `USD ${n2(r.iva_usd)}`],
        ['IGTF cobrado', `USD ${n2(r.igtf_usd)}`],
        ['Total cobrado en USD', `USD ${n2(r.total_usd)}`],
        ['Total cobrado en Bs', `Bs ${n2(r.total_ves)}`],
        ['Tasa USD en Bs', r.tasa_min == null ? '—' : r.tasa_min === r.tasa_max ? tasa(r.tasa_min) : `${tasa(r.tasa_min)} – ${tasa(r.tasa_max)}`],
    ];
    const mitad = Math.ceil(claves.length / 2);
    const filasRes = Array.from({ length: mitad }, (_, i) => [claves[i][0], claves[i][1], claves[i + mitad]?.[0] ?? '', claves[i + mitad]?.[1] ?? '']);
    autoTable(doc, {
        ...base, startY: y, body: filasRes,
        didDrawCell: base.didDrawCell,
        columnStyles: { 0: { cellWidth: 48 }, 1: { cellWidth: 36, halign: 'right', fontStyle: 'bold' }, 2: { cellWidth: 54, cellPadding: { top: 1.7, bottom: 1.7, left: 8, right: 0.8 } }, 3: { cellWidth: 36, halign: 'right', fontStyle: 'bold' } },
    });
    fin();

    /* ───── Cobros por método y moneda ───── */
    titulo('Cobros por método y moneda', 'Cada pago con la tasa congelada al venderse · el IGTF va incluido en lo cobrado');
    const filas = [];
    const orden = ['USD', 'EUR', 'COP', 'VES'];
    for (const mon of orden) {
        const ms = informe.metodos.filter((m) => m.moneda === mon);
        if (!ms.length) continue;
        ms.forEach((m) =>
            filas.push([
                m.metodo, mon, String(m.n), num(mon, m.cobrado),
                mon === 'USD' ? '—' : m.tasa_min === m.tasa_max ? tasa(m.tasa_min) : `${tasa(m.tasa_min)}–${tasa(m.tasa_max)}`,
                n2(m.usd), n2(m.ves),
            ]),
        );
        if (ms.length > 1) {
            const t = informe.monedas.find((x) => x.moneda === mon);
            const o = Object.assign(['Subtotal ' + mon, '', String(ms.reduce((a, m) => a + m.n, 0)), num(mon, t.cobrado), '', n2(t.usd), n2(t.ves)], { __tot: true });
            filas.push(o);
        }
    }
    filas.push(Object.assign([esDia ? 'Total del día' : 'Total del período', '', String(informe.metodos.reduce((a, m) => a + m.n, 0)), '', '', n2(r.total_usd), n2(r.total_ves)], { __tot: true }));
    autoTable(doc, {
        ...base, startY: y,
        head: [['Método', 'Moneda', 'Pagos', 'Cobrado', 'Tasa Bs', 'Equiv. USD', 'Equiv. Bs']],
        body: filas,
        columnStyles: { 2: R, 3: R, 4: R, 5: R, 6: R },
        didParseCell: (d) => {
            if (d.section === 'head' && d.column.index >= 2) d.cell.styles.halign = 'right';
            if (d.section === 'body' && d.row.raw?.__tot) d.cell.styles.fontStyle = 'bold';
        },
    });
    fin();

    /* ───── Efectivo en caja ───── */
    const ef = informe.monedas.filter((m) => m.tiene_efectivo);
    if (ef.length) {
        const hayConteo = ef.some((m) => conteo[m.moneda] !== undefined && conteo[m.moneda] !== '' && conteo[m.moneda] !== null);
        titulo(esDia ? 'Efectivo en caja' : 'Efectivo del período', !esDia ? undefined : cierre ? 'Corte Z hecho' : hayConteo ? 'Conteo sin firmar' : 'Sin conteo');
        let dTot = 0;
        const fe = ef.map((m) => {
            const c = conteo[m.moneda];
            const tiene = c !== undefined && c !== '' && c !== null;
            const d = tiene ? (m.moneda === 'COP' ? Math.round(Number(c) - m.efectivo_esperado) : Math.round((Number(c) - m.efectivo_esperado) * 100) / 100) : null;
            if (d) dTot += 1;
            return [m.moneda, num(m.moneda, m.efectivo_recibido), m.vuelto ? '-' + num(m.moneda, m.vuelto) : '—', num(m.moneda, m.efectivo_esperado), tiene ? num(m.moneda, Number(c)) : '________', d === null ? '' : (d > 0 ? '+' : d < 0 ? '-' : '') + num(m.moneda, Math.abs(d))];
        });
        autoTable(doc, {
            ...base, startY: y,
            head: [esDia ? ['Moneda', 'Recibido', 'Vuelto entregado', 'Debe haber', 'Contado', 'Diferencia'] : ['Moneda', 'Recibido', 'Vuelto entregado', 'Debe haber']],
            body: esDia ? fe : fe.map((f) => f.slice(0, 4)), columnStyles: { 1: R, 2: R, 3: R, 4: R, 5: { halign: 'right', fontStyle: 'bold' } },
            didParseCell: (d) => { if (d.section === 'head' && d.column.index >= 1) d.cell.styles.halign = 'right'; },
        });
        fin();
        doc.setFont('helvetica', 'normal').setFontSize(7.5);
        const nota = 'Recibido = efectivo entregado por el cliente. Debe haber = recibido - vuelto. Efectivo = métodos que no piden referencia.';
        doc.text(doc.splitTextToSize(nota, ANCHO), M, y - 4.5);
        y += 5;
        if (cierre?.observaciones) {
            doc.setFont('helvetica', 'bold').setFontSize(8).text('Observaciones', M, y);
            doc.setFont('helvetica', 'normal').text(doc.splitTextToSize(cierre.observaciones, ANCHO - 28), M + 28, y);
            y += 9;
        }
    }

    /* ───── Desglose del período ───── */
    if (!esDia && informe.desglose?.filas.length) {
        const mes = informe.desglose.por === 'mes';
        const nom = (k) => (mes ? new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${k}-01T12:00:00Z`)) : new Intl.DateTimeFormat('es-VE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${k}T12:00:00Z`)));
        titulo(`Ventas por ${mes ? 'mes' : 'día'}`);
        autoTable(doc, {
            ...base, startY: y, head: [[mes ? 'Mes' : 'Día', 'Ventas', 'Total USD', 'Total Bs']],
            body: informe.desglose.filas.map((d) => [nom(d.clave), String(d.ventas), n2(d.total_usd), n2(d.total_ves)]),
            columnStyles: { 1: R, 2: R, 3: R }, didParseCell: (d) => { if (d.section === 'head' && d.column.index >= 1) d.cell.styles.halign = 'right'; },
        });
        fin();
    }

    /* ───── Cortes Z del período ───── */
    if (!esDia && cortes.length) {
        titulo('Cortes Z del período');
        autoTable(doc, {
            ...base, startY: y, head: [['N.º', 'Fecha', 'Caja', 'Hecho por', 'Total USD', 'Resultado']],
            body: cortes.map((c) => ['Z-' + String(c.id).padStart(6, '0'), c.fecha, c.caja, c.por, n2(c.total_usd), c.con_diferencia ? 'Con diferencia' : 'Cuadró']),
            columnStyles: { 4: R }, didParseCell: (d) => { if (d.section === 'head' && d.column.index === 4) d.cell.styles.halign = 'right'; },
        });
        fin();
    }

    /* ───── Cajeros ───── */
    if (informe.cajeros.length > 1) {
        titulo('Ventas por cajero');
        autoTable(doc, {
            ...base, startY: y, head: [['Cajero', 'Ventas', 'Total USD']],
            body: informe.cajeros.map((c) => [c.nombre, String(c.ventas), n2(c.total_usd)]),
            columnStyles: { 1: R, 2: R }, didParseCell: (d) => { if (d.section === 'head' && d.column.index >= 1) d.cell.styles.halign = 'right'; },
        });
        fin();
    }

    /* ───── Anuladas ───── */
    if (informe.anuladas.length) {
        titulo('Ventas anuladas', 'No suman en los totales');
        autoTable(doc, {
            ...base, startY: y, head: [['N.º', 'Hora', 'Cajero', 'Motivo', 'Total USD']],
            body: informe.anuladas.map((a) => [String(a.numero).padStart(6, '0'), a.hora, a.cajero, a.motivo || '—', n2(a.total_usd)]),
            columnStyles: { 4: R }, didParseCell: (d) => { if (d.section === 'head' && d.column.index === 4) d.cell.styles.halign = 'right'; },
        });
        fin();
    }

    /* ───── Operaciones ───── */
    if (informe.operaciones.length) {
        titulo('Detalle de operaciones', `${informe.operaciones.length} ventas`);
        autoTable(doc, {
            ...base, startY: y, head: [['N.º', 'Hora', 'Cajero', 'Pagos recibidos', 'Total USD']],
            body: informe.operaciones.map((o) => [
                String(o.numero).padStart(6, '0'), o.hora, o.cajero,
                o.pagos.map((p) => (p.metodo.includes(p.moneda) ? `${p.metodo} ${num(p.moneda, p.monto)}` : `${p.metodo} ${con(p.moneda === 'VES' ? 'Bs' : p.moneda, p.monto)}`)).join('  +  '), n2(o.total_usd),
            ]),
            columnStyles: { 0: { cellWidth: 16 }, 1: { cellWidth: 13 }, 2: { cellWidth: 34 }, 4: { cellWidth: 22, halign: 'right' } },
            didParseCell: (d) => { if (d.section === 'head' && d.column.index === 4) d.cell.styles.halign = 'right'; },
        });
        fin();
    }

    /* ───── Firmas ───── */
    if (esDia) {
    if (y > 252) { doc.addPage(); y = M; }
    y = Math.max(y + 10, 250);
    if (y > 262) { doc.addPage(); y = 250; }
    doc.setLineWidth(FINA);
    const col = (x, etq, sub) => {
        doc.line(x, y, x + 70, y);
        doc.setFont('helvetica', 'normal').setFontSize(8).text(etq, x, y + 4.2);
        if (sub) doc.setFontSize(7.5).text(sub, x, y + 8);
    };
    col(M, 'Cajero', cierre ? undefined : cajeroNombre || undefined);
    col(W - M - 70, 'Supervisor', cierre ? `Corte hecho por ${cierre.por}` : undefined);
    }

    /* ───── Pie de página ───── */
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
        doc.setPage(i);
        doc.setLineWidth(FINA).line(M, 284, W - M, 284);
        doc.setFont('helvetica', 'normal').setFontSize(7);
        doc.text(`Generado ${marca()}${generadoPor ? ` por ${generadoPor}` : ''}`, M, 288);
        doc.text(`Página ${i} de ${n}`, W - M, 288, { align: 'right' });
    }
    return doc;
}
