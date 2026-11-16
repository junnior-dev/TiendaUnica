/**
 * Hoja de etiquetas con código de barras EAN-13 — se genera en el navegador con jsPDF.
 *
 *   const doc = await construirPdfEtiquetas(items, { formato: 'carta' | 'termico', precioBs, precioUsd, mostrarMarca });
 *   abrirPdf(doc, { imprimir: true, nombre: 'etiquetas.pdf' });
 *
 * Dos salidas:
 *   · «carta»: hoja tamaño carta, 3 columnas × 10 filas (68,6 × 26,9 mm) con borde de corte,
 *     para pegatinas tipo AVERY 5160 o para recortar a tijera.
 *   · «termico»: una etiqueta por página de 80 × 42 mm, para impresora térmica de rollo.
 *
 * Las barras se dibujan módulo a módulo con la cadena de lib/barcode.js (misma que el SVG);
 * los códigos internos los asigna app/Support/Ean13.php en el rango 200–299.
 */
import { barrasEan13, esGuarda, ean13Valido, moduloSeguro, tramosDe } from './barcode';

const n2 = (v) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0));

/** Barras negras a partir de la cadena de 95 módulos; devuelve el alto total (guardas incluidas). */
function barras(doc, bits, x, y, modulo, alto) {
    const descenso = alto * 0.12;
    doc.setFillColor(0);
    tramosDe(bits).forEach(([ini, an]) => doc.rect(x + ini * modulo, y, an * modulo, esGuarda(ini, an) ? alto + descenso : alto, 'F'));
    return alto + descenso;
}

function dibujarEtiqueta(doc, it, o, x, y, w, h, termico) {
    const M = termico ? 4 : 2.2;
    const cx = x + w / 2;
    let yy = y + M;
    const anchoUtil = w - 2 * M;

    if (!termico) { doc.setDrawColor(150).setLineWidth(0.15); doc.rect(x, y, w, h); }

    // Nombre (máx. 2 líneas) y, si procede, marca · SKU
    doc.setTextColor(0).setFont('helvetica', 'bold').setFontSize(termico ? 9 : 7.2);
    let nom = doc.splitTextToSize(String(it.nombre ?? ''), anchoUtil);
    if (nom.length > 2) nom = [nom[0], `${nom[1].slice(0, Math.max(0, nom[1].length - 1))}…`].slice(0, 2);
    doc.text(nom, x + M, yy + 2.6);
    yy += nom.length * (termico ? 3.6 : 3.1);
    const meta = [o.mostrarMarca && it.marca, it.sku].filter(Boolean).join(' · ');
    if (meta) { doc.setFont('helvetica', 'normal').setFontSize(termico ? 6.8 : 5.8); doc.text(doc.splitTextToSize(meta, anchoUtil)[0], x + M, yy + 2.2); yy += termico ? 3 : 2.6; }

    // Precio
    const precio = [o.precioBs && Number(it.precio_ves) > 0 ? `Bs ${n2(it.precio_ves)}` : null, o.precioUsd && Number(it.precio_usd) > 0 ? `$ ${n2(it.precio_usd)}` : null].filter(Boolean).join(' · ');
    if (precio) { doc.setFont('helvetica', 'bold').setFontSize(termico ? 11.5 : 9.5); doc.text(precio, x + M, yy + (termico ? 5 : 3.8)); yy += termico ? 6.4 : 5; }

    // Código de barras (centrado) + número. El módulo sale de moduloSeguro: garantiza 11 módulos
    // de quiet zone a cada lado dentro del ancho útil de la etiqueta (estándar EAN-13).
    const altoNum = termico ? 3.4 : 2.6;
    const altoBarras = Math.min(termico ? 10 : 6.4, h - (yy - y) - altoNum - M);
    if (ean13Valido(it.ean)) {
        const bits = barrasEan13(it.ean);
        const modulo = moduloSeguro(anchoUtil, termico ? 0.55 : 0.5);
        const ancho = 95 * modulo;
        barras(doc, bits, cx - ancho / 2, yy + 0.6, modulo, Math.max(altoBarras, 4));
        doc.setFont('helvetica', 'normal').setFontSize(termico ? 7.5 : 6);
        doc.text(it.ean, cx, yy + 0.6 + altoBarras + altoNum, { align: 'center' });
    } else {
        doc.setFont('helvetica', 'normal').setFontSize(termico ? 7 : 5.8);
        doc.text(`SKU ${it.sku} — sin EAN (asigna un código)`, cx, yy + 3, { align: 'center' });
    }
}

export async function construirPdfEtiquetas(items, opciones = {}) {
    const o = { formato: 'carta', precioBs: true, precioUsd: false, mostrarMarca: true, ...opciones };
    const { jsPDF } = await import('jspdf');
    const termico = o.formato === 'termico';
    // jsPDF acomoda el formato al orientación dada: sin «landscape» intercambia [80,42] por 42×80.
    const doc = termico
        ? new jsPDF({ unit: 'mm', format: [80, 42], orientation: 'landscape', compress: true })
        : new jsPDF({ unit: 'mm', format: 'letter', compress: true });
    doc.setProperties({ title: 'Etiquetas de productos', creator: 'Repuestos' });

    if (termico) {
        items.forEach((it, i) => {
            if (i > 0) doc.addPage([80, 42], 'landscape');
            dibujarEtiqueta(doc, it, o, 0, 0, 80, 42, true);
        });
        return doc;
    }

    const M = 5, COLS = 3, FILAS = 10;
    const w = (215.9 - 2 * M) / COLS, h = (279.4 - 2 * M) / FILAS;
    items.forEach((it, i) => {
        const col = i % COLS, fila = Math.floor(i / COLS) % FILAS;
        if (i > 0 && i % (COLS * FILAS) === 0) doc.addPage('letter');
        dibujarEtiqueta(doc, it, o, M + col * w, M + fila * h, w, h, false);
    });
    return doc;
}
