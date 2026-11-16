/**
 * Ticket térmico de «Retiro de pieza» para encargos (80 mm) — se genera en el navegador con jsPDF.
 *
 *   const { construirPdfRetiro, abrirPdf } = …
 *   abrirPdf(await construirPdfRetiro(doc), { imprimir: true, nombre: 'retiro-enc-0001.pdf' });
 *   // doc = respuesta de GET /encargos/{id}
 *
 * No es una factura ni una nota de venta: es el comprobante que se le da al cliente cuando ENCIENDE
 * el encargo (y se puede reimprimir cuando la pieza queda lista), con lo que acordaron, el anticipo
 * que ya pagó y el código del encargo en barras para encontrarlo rápido en el mostrador.
 */
import { barrasEan13, esGuarda, ean13Valido, moduloSeguro, tramosDe } from './barcode';

const ESTADO_TXT = { SOLICITADO: 'Solicitado', ORDENADO: 'Pedido al proveedor', RECIBIDO: 'Pieza en tienda', AVISADO: 'Listo para retirar', CANCELADO: 'Cancelado', ANULADO: 'Anulado' };
const ahora = () => new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Caracas', hour12: false }).format(new Date());
const enc4 = (id) => `ENC-${String(id).padStart(4, '0')}`;

function barras(doc, bits, x, y, modulo, alto) {
    const descenso = alto * 0.12;
    doc.setFillColor(0);
    tramosDe(bits).forEach(([ini, an]) => doc.rect(x + ini * modulo, y, an * modulo, esGuarda(ini, an) ? alto + descenso : alto, 'F'));
    return alto + descenso;
}

function dibujarTicket(doc, d) {
    const e = d.encargo;
    const W = 80, M = 4, C = W / 2, X2 = W - M;
    let y = 6;
    const t = (s, x, o = {}) => doc.text(String(s), x, y, o);
    const linea = (puntos = true) => { doc.setLineWidth(0.15); if (puntos) doc.setLineDash([0.6, 0.8], 0); doc.line(M, y, X2, y); doc.setLineDash([], 0); y += 3.4; };
    const envuelto = (s, x, ancho) => { const l = doc.splitTextToSize(String(s), ancho); doc.text(l, x, y); y += l.length * 3.3; };
    const fila = (a, b, negrita) => { doc.setFont('helvetica', negrita ? 'bold' : 'normal'); t(a, M); t(b, X2, { align: 'right' }); y += 3.5; };

    doc.setTextColor(0); doc.setDrawColor(0);
    // Emisor
    doc.setFont('helvetica', 'bold').setFontSize(9.5);
    doc.splitTextToSize(d.emisor.nombre_comercial || d.emisor.razon_social, W - 2 * M).forEach((l) => { t(l, C, { align: 'center' }); y += 4; });
    doc.setFont('helvetica', 'normal').setFontSize(7);
    if (d.emisor.nombre_comercial && d.emisor.razon_social !== d.emisor.nombre_comercial) { t(d.emisor.razon_social, C, { align: 'center' }); y += 3.2; }
    t(`RIF ${d.emisor.rif}`, C, { align: 'center' }); y += 3.2;
    if (d.emisor.direccion) doc.splitTextToSize(d.emisor.direccion, W - 2 * M).forEach((l) => { t(l, C, { align: 'center' }); y += 3.1; });
    if (d.emisor.telefono) { t(`Tel. ${d.emisor.telefono}`, C, { align: 'center' }); y += 3.2; }
    y += 1; linea();

    // Título y número del encargo
    doc.setFont('helvetica', 'bold').setFontSize(10.5); t('RETIRO DE PIEZA', C, { align: 'center' }); y += 4.4;
    doc.setFont('helvetica', 'normal').setFontSize(7.5); t('Comprobante de pieza encargada', C, { align: 'center' }); y += 3.6;
    doc.setFont('helvetica', 'bold').setFontSize(9); t(enc4(e.id), C, { align: 'center' }); y += 3.8;
    doc.setFont('helvetica', 'normal').setFontSize(7.5);
    t(`Estado: ${ESTADO_TXT[e.estado] || e.estado}`, C, { align: 'center' }); y += 3.4;
    t(`Impreso: ${ahora()}`, C, { align: 'center' }); y += 3.4;
    if (e.por) { t(`Atendió: ${e.por}`, C, { align: 'center' }); y += 3.4; }
    if (e.estado === 'AVISADO') {
        doc.setFont('helvetica', 'bold').setFontSize(9.5); t('*** LISTO PARA RETIRAR ***', C, { align: 'center' }); y += 4.2;
        doc.setFont('helvetica', 'normal').setFontSize(7.5);
    }
    linea();

    // Cliente
    doc.setFont('helvetica', 'bold').setFontSize(8.5); t(e.cliente, M); y += 3.5;
    doc.setFont('helvetica', 'normal').setFontSize(7.5);
    if (e.documento) { t(`CI/RIF ${e.documento}`, M); y += 3.2; }
    if (e.telefono) { t(`Tel. ${e.telefono}`, M); y += 3.2; }
    linea();

    // Pieza encargada
    doc.setFont('helvetica', 'bold').setFontSize(7.5); t('Pieza encargada', M); y += 3.4; doc.setFont('helvetica', 'normal');
    envuelto(e.descripcion, M, W - 2 * M);
    fila('Cantidad', `× ${Number(e.cantidad) % 1 === 0 ? Math.round(e.cantidad) : e.cantidad}`);
    doc.setFontSize(7);
    const envuelto7 = (s, sangria) => { const l = doc.splitTextToSize(String(s), W - 2 * M - sangria).slice(0, 2); doc.text(l, M + sangria, y); y += l.length * 3.1; };
    if (e.producto) envuelto7(`${e.sku} · ${e.producto}`, 1.5);
    if (e.moto) envuelto7(`Sirve a: ${e.moto}`, 1.5);
    if (e.nota_proveedor) envuelto7(`Nota proveedor: ${e.nota_proveedor}`, 1.5);
    doc.setFontSize(7.5);
    linea();

    // Montos acordados (en US$, como se pactan los encargos)
    if (e.precio_estimado !== null) {
        fila('Precio pactado', `$ ${Number(e.precio_estimado).toFixed(2)}`);
        fila(`Anticipos recibidos (${e.n_anticipos})`, `$ ${Number(e.anticipado).toFixed(2)}`);
        doc.setFont('helvetica', 'bold'); fila('Saldo al retirar', `$ ${Math.max(0, e.precio_estimado - e.anticipado).toFixed(2)}`); doc.setFont('helvetica', 'normal');
    } else {
        fila(`Anticipos recibidos (${e.n_anticipos})`, `$ ${Number(e.anticipado).toFixed(2)}`);
        doc.setFontSize(6.8); t('Precio por acordar al llegar la pieza', C, { align: 'center' }); y += 3.1; doc.setFontSize(7.5);
    }
    linea();

    // Código del encargo en barras (EAN-13 interno 2100000000xx)
    if (ean13Valido(e.ean)) {
        doc.setFont('helvetica', 'bold').setFontSize(8); t(enc4(e.id), C, { align: 'center' }); y += 3.6;
        // Ticket de 80 mm: 72 mm útiles → moduloSeguro da 0,33 mm (magnificación 100 %) y deja
        // ~20 mm de quiet zone a cada lado, muy por encima de los 11 módulos (3,63 mm) del estándar.
        const modulo = moduloSeguro(W - 2 * M, 0.33), ancho = 95 * modulo;
        const alto = barras(doc, barrasEan13(e.ean), C - ancho / 2, y + 0.4, modulo, 8);
        y += 0.4 + alto + 1;
        doc.setFont('helvetica', 'normal').setFontSize(6.5); t(e.ean, C, { align: 'center' }); y += 3.1;
    }
    y += 0.4; linea();

    // Pie
    doc.setFont('helvetica', 'normal').setFontSize(7);
    t('Presente este comprobante al retirar la pieza.', C, { align: 'center' }); y += 3.3;
    if (e.estado === 'SOLICITADO') { doc.splitTextToSize('El precio final se confirma cuando la pieza llegue a la tienda.', W - 2 * M).forEach((l) => { t(l, C, { align: 'center' }); y += 3; }); }
    t(`Generado ${ahora()}`, C, { align: 'center' }); y += 3.3;
    return y + 3;
}

export async function construirPdfRetiro(d) {
    const { jsPDF } = await import('jspdf');
    const medir = new jsPDF({ unit: 'mm', format: [80, 1200], compress: true });
    const alto = dibujarTicket(medir, d);
    // jsPDF acomoda el formato a la orientación: si el ticket queda más corto que los 80 mm de
    // ancho, hay que pedir «landscape» para que no lo intercambie por una página de 60×80.
    const orientacion = alto >= 80 ? 'portrait' : 'landscape';
    const doc = new jsPDF({ unit: 'mm', format: [80, Math.max(alto, 60)], orientation: orientacion, compress: true });
    doc.setProperties({ title: `Retiro de pieza ${enc4(d.encargo.id)}`, subject: d.emisor.razon_social, creator: 'Repuestos' });
    dibujarTicket(doc, d);
    return doc;
}
