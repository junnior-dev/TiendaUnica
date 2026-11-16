/**
 * Comprobante de retención de ISLR (hoja carta). Se entrega al beneficiario del pago. Lleva el agente de retención, el beneficiario,
 * el concepto, la base, el porcentaje, el sustraendo (si lo hubo) y el monto retenido.
 *   const pdf = await construirComprobanteIslr(datos);   // datos = GET /retenciones-islr/{id}/comprobante
 *   imprimirTicketCorte(pdf, 'retencion-islr.pdf');       // (lib/pdfTicketCorte.js) abre el diálogo de impresión
 * Es el comprobante INTERNO del sistema: el formato que exija el SENIAT para tu caso confírmalo con tu contador. Solo Latin-1.
 */
import { n2 } from './format';

const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const bs = (v) => `Bs ${n2(v)}`;
const TIPO = { N: 'Persona natural residente', J: 'Persona jurídica domiciliada' };

export async function construirComprobanteIslr(d) {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'letter', compress: true });
    const W = 215.9, M = 18;
    let y = 22;
    const t = (txt, x, yy, o = {}) => doc.text(String(txt ?? ''), x, yy, o);
    const fila = (a, v, b = false) => { doc.setFont('helvetica', 'normal'); doc.setTextColor(90); t(a, M, y); doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setTextColor(0); t(v, W - M, y, { align: 'right' }); y += 6.5; };
    const linea = () => { doc.setDrawColor(200); doc.line(M, y - 3.5, W - M, y - 3.5); };

    doc.setTextColor(0).setFont('helvetica', 'bold').setFontSize(15);
    t('COMPROBANTE DE RETENCION DE IMPUESTO SOBRE LA RENTA', W / 2, y, { align: 'center' }); y += 7;
    doc.setFontSize(11); t(`N.o ${d.numero}`, W / 2, y, { align: 'center' }); y += 6;
    if (d.estado === 'ANULADA') { doc.setTextColor(196, 41, 31); doc.setFontSize(13); t('*** RETENCION ANULADA ***', W / 2, y, { align: 'center' }); y += 6; if (d.motivo_anulacion) { doc.setFontSize(9.5); t(`Motivo: ${d.motivo_anulacion}`, W / 2, y, { align: 'center' }); y += 5; } doc.setTextColor(0); }
    y += 4; doc.setFontSize(10);

    doc.setFont('helvetica', 'bold'); t('AGENTE DE RETENCION', M, y); y += 6;
    fila('Razon social', d.agente.comercial && d.agente.comercial !== d.agente.razon_social ? `${d.agente.razon_social} (${d.agente.comercial})` : d.agente.razon_social);
    fila('RIF', d.agente.rif);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(90); t('Direccion fiscal', M, y); doc.setTextColor(0);
    const dir = doc.splitTextToSize(d.agente.direccion || '', W - 2 * M - 40); t(dir, W - M, y, { align: 'right' }); y += 6.5 * Math.max(dir.length, 1);
    y += 3; linea(); y += 3;

    doc.setFont('helvetica', 'bold'); t('BENEFICIARIO DEL PAGO', M, y); y += 6;
    fila('Nombre o razon social', d.beneficiario);
    fila('RIF', d.rif);
    fila('Tipo', TIPO[d.tipo] || '');
    y += 3; linea(); y += 3;

    doc.setFont('helvetica', 'bold'); t('OPERACION', M, y); y += 6;
    fila('Fecha del pago', dmy(d.fecha));
    fila('Concepto', d.concepto);
    if (d.documento) fila('Factura o documento', d.documento);
    if (d.moneda !== 'VES') { fila('Monto pagado', `${d.moneda} ${n2(d.monto)}`); fila('Tasa del dia', `Bs ${n2(d.tasa)}`); }
    y += 3; linea(); y += 3;

    doc.setFont('helvetica', 'bold'); t('CALCULO DE LA RETENCION', M, y); y += 6;
    fila('Base de la retencion (sin IVA)', bs(d.base_ves));
    fila('Porcentaje de retencion', `${String(d.porcentaje).replace('.', ',')} %`);
    fila('Retencion antes del sustraendo', bs(Math.round(d.base_ves * d.porcentaje) / 100));
    if (d.sustraendo_ves > 0) { fila('Sustraendo', `- ${bs(d.sustraendo_ves)}`); if (d.ut) fila('Unidad tributaria usada', bs(d.ut)); }
    y += 1; doc.setFontSize(11.5); fila('IMPUESTO RETENIDO', bs(d.retenido_ves), true); doc.setFontSize(10);
    fila('Neto pagado al beneficiario', bs(d.neto_ves), true);

    y += 22;
    doc.setDrawColor(0); doc.line(M, y, M + 70, y); doc.line(W - M - 70, y, W - M, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); t('Agente de retencion', M + 35, y, { align: 'center' }); t('Recibi conforme (beneficiario)', W - M - 35, y, { align: 'center' });
    y += 14; doc.setFontSize(8.5); doc.setTextColor(110);
    const pie = doc.splitTextToSize('Comprobante interno emitido por el sistema. El impuesto retenido debe enterarse al SENIAT en los lapsos que corresponden a tu calendario. Confirma el formato y los porcentajes con tu contador.', W - 2 * M);
    t(pie, M, y);
    return doc;
}
