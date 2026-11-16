/**
 * Borrador de la declaración anual de ISLR (hoja carta). Es una HOJA DE TRABAJO con las cifras del sistema y las que aportó el contador:
 * NO es el formulario del SENIAT (la declaración se presenta en el portal). Solo Latin-1.
 *   const pdf = await construirBorradorIslr({ borrador, tramos, anticipos, sufridas, contribuyente });
 *   imprimirTicketCorte(pdf, 'borrador-islr-2026.pdf');     // (lib/pdfTicketCorte.js)
 */
import { n2 } from './format';

const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const bs = (v) => (v === null || v === undefined ? 'Sin calcular' : `Bs ${n2(v)}`);
const pct = (v) => `${String(v).replace('.', ',')} %`;

export async function construirBorradorIslr({ borrador: b, tramos, anticipos, sufridas, contribuyente: c }) {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'letter', compress: true });
    const W = 215.9, H = 279.4, M = 18;
    let y = 20;
    const t = (txt, x, yy, o = {}) => doc.text(String(txt ?? ''), x, yy, o);
    const salto = (alto = 8) => { if (y + alto > H - 22) { doc.addPage(); y = 20; } };
    const fila = (a, v, { b: neg = false, sub = false, color } = {}) => {
        salto(); doc.setFont('helvetica', neg ? 'bold' : 'normal'); doc.setTextColor(sub ? 110 : 0); t(a, M + (sub ? 5 : 0), y);
        if (color) doc.setTextColor(...color); else doc.setTextColor(0); t(v, W - M, y, { align: 'right' }); y += 6;
    };
    const titulo = (s) => { salto(14); y += 2; doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(30); t(s, M, y); y += 2; doc.setDrawColor(200); doc.line(M, y, W - M, y); y += 5.5; doc.setFontSize(10); };

    doc.setTextColor(0).setFont('helvetica', 'bold').setFontSize(15);
    t(`BORRADOR DE DECLARACION DE ISLR - EJERCICIO ${b.ejercicio}`, W / 2, y, { align: 'center' }); y += 6;
    doc.setFontSize(9.5).setFont('helvetica', 'normal').setTextColor(196, 41, 31);
    t('Hoja de trabajo. No es el formulario del SENIAT.', W / 2, y, { align: 'center' }); y += 8;
    doc.setTextColor(0).setFontSize(10);

    titulo('CONTRIBUYENTE');
    fila('Razon social', c.razon_social || ''); fila('RIF', c.rif || '');
    fila('Ejercicio', `${dmy(b.desde)} al ${dmy(b.hasta)}`);
    if (b.ut) fila('Unidad tributaria al cierre', bs(b.ut));

    titulo('RENTA DEL EJERCICIO');
    fila(`Ingresos brutos (libro de ventas, sin IVA; ${b.documentos} documentos)`, bs(b.ingresos));
    fila(b.costo_manual ? 'Costo de lo vendido (cifra del contador)' : 'Costo de lo vendido (costo congelado en cada venta)', `- ${bs(b.costo)}`);
    fila('Renta bruta', bs(b.renta_bruta), { b: true });
    fila('Gastos deducibles', `- ${bs(b.gastos)}`);
    fila('Otras deducciones', `- ${bs(b.otras_deducciones)}`);
    fila('Ajuste por inflacion (con signo)', bs(b.ajuste_inflacion));
    fila(b.renta_neta < 0 ? 'RESULTADO DEL EJERCICIO (PERDIDA)' : 'RENTA NETA', bs(b.renta_neta), { b: true });
    if (b.renta_neta_ut !== null && b.renta_neta_ut !== undefined) fila('Renta neta en unidades tributarias', `${n2(b.renta_neta_ut)} UT`, { sub: true });

    titulo('IMPUESTO');
    if (b.tramo) fila(b.tramo.hasta_ut === null ? `Tramo aplicado: mas de ${b.tramo.desde_ut} UT` : `Tramo aplicado: de ${b.tramo.desde_ut} a ${b.tramo.hasta_ut} UT`, `${pct(b.tramo.pct)}  -  sustraendo ${n2(b.tramo.sustraendo_ut)} UT`, { sub: true });
    fila('Impuesto estimado', bs(b.impuesto), { b: true });
    fila('Rebajas', `- ${bs(b.rebajas)}`);
    fila('Impuesto neto', bs(b.impuesto_neto), { b: true });
    fila('Retenciones que te practicaron', `- ${bs(b.retenciones_sufridas)}`);
    fila('Anticipos pagados (declaracion estimada)', `- ${bs(b.anticipos)}`);
    y += 1;
    if (b.saldo === null || b.saldo === undefined) fila('SALDO', 'Sin calcular', { b: true });
    else fila(b.saldo >= 0 ? 'SALDO A PAGAR' : 'SALDO A FAVOR', bs(Math.abs(b.saldo)), { b: true, color: b.saldo >= 0 ? [196, 41, 31] : [20, 128, 74] });

    if (tramos.length) {
        titulo('TARIFA DEL EJERCICIO (indicada por el contador)');
        tramos.forEach((x) => fila(x.hasta_ut === null ? `Mas de ${x.desde_ut} UT` : `De ${x.desde_ut} a ${x.hasta_ut} UT`, `${pct(x.pct)}  -  sustraendo ${n2(x.sustraendo_ut)} UT`, { sub: true }));
    }
    const sa = anticipos.filter((x) => x.estado === 'ACTIVO');
    if (sa.length) { titulo('ANTICIPOS PAGADOS'); sa.forEach((x) => fila(`${dmy(x.fecha)}${x.periodo ? ` - mes ${x.periodo.slice(5, 7)}/${x.periodo.slice(0, 4)}` : ''}${x.referencia ? ` - ref. ${x.referencia}` : ''}`, bs(x.monto), { sub: true })); }
    const ss = sufridas.filter((x) => x.estado === 'ACTIVO');
    if (ss.length) { titulo('RETENCIONES QUE TE PRACTICARON'); ss.forEach((x) => fila(`${dmy(x.fecha)} - ${x.agente} (${x.rif})${x.comprobante ? ` - comp. ${x.comprobante}` : ''}`, bs(x.retenido), { sub: true })); }

    titulo('INFORMACION ADICIONAL');
    fila('ISLR retenido a proveedores en el ejercicio', bs(b.retenido_practicado), { sub: true });
    fila('De ese monto, por enterar al SENIAT', bs(b.retenido_por_enterar), { sub: true });
    if (b.notas) { salto(10); doc.setFont('helvetica', 'normal').setTextColor(90); const n = doc.splitTextToSize(`Notas: ${b.notas}`, W - 2 * M); t(n, M, y); y += 5 * n.length + 2; }

    if (b.avisos.length) {
        titulo('PENDIENTES POR REVISAR CON EL CONTADOR');
        doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(70);
        b.avisos.forEach((a) => { const l = doc.splitTextToSize(`- ${a}`, W - 2 * M); salto(5 * l.length + 1); t(l, M, y); y += 4.6 * l.length + 1; });
    }
    const pie = doc.splitTextToSize('Cifras de referencia generadas por el sistema a partir de las ventas registradas y de los datos que cargo el contador. La renta neta fiscal, las deducciones, el ajuste por inflacion y la tarifa deben ser confirmados por tu contador antes de presentar la declaracion en el portal del SENIAT.', W - 2 * M);
    doc.setFontSize(8).setTextColor(110); salto(5 * pie.length + 6); y += 4; t(pie, M, y);
    return doc;
}
