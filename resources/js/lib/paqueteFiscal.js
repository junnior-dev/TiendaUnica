/** Paquete de declaración del mes: un ZIP con los cinco PDF que se le entregan al contador o se archivan. */
import { construirPdfLibro, construirPdfResumenIva } from './pdfLibro';
import { configuracionLibro } from './configLibros';
import { crearZip } from './zip';

const bytes = (doc) => new Uint8Array(doc.output('arraybuffer'));

export async function construirPaquete(paq, periodo) {
    const { mes, emisor, regimen } = paq;
    const libro = async (vista, datos, titulo) => {
        const cfg = configuracionLibro(vista, datos, mes);
        return bytes(await construirPdfLibro({ emisor, titulo, periodo, columnas: cfg.columnas, filas: cfg.filas, totales: cfg.totales, anuladas: cfg.anuladas, notas: cfg.notas }));
    };
    const serie = paq.resumen.serie;
    const resumen = bytes(await construirPdfResumenIva({ emisor, periodo, iva: paq.resumen.iva, igtf: paq.resumen.igtf, serie: serie.slice(Math.max(0, serie.findIndex((x) => x.debito || x.credito))), regimen }));
    const archivos = [
        { nombre: 'Resumen_IVA.pdf', datos: resumen },
        { nombre: 'Libro_Ventas.pdf', datos: await libro('ventas', { libro: paq.ventas }, 'Libro de ventas') },
        { nombre: 'Libro_Compras.pdf', datos: await libro('compras', { libro: paq.compras }, 'Libro de compras') },
        { nombre: 'Retenciones.pdf', datos: await libro('retenciones', { retenciones: paq.retenciones }, 'Retenciones de IVA') },
        { nombre: 'IGTF.pdf', datos: await libro('igtf', { igtf: paq.igtf }, 'IGTF por día') },
    ];
    const leeme = `Paquete de declaración — ${periodo}\r\n${emisor.razon_social} · RIF ${emisor.rif}\r\n\r\n` +
        'Contiene: Resumen_IVA.pdf, Libro_Ventas.pdf, Libro_Compras.pdf, Retenciones.pdf e IGTF.pdf.\r\n' +
        'Son documentos de apoyo generados a partir de los libros del sistema; no sustituyen la declaración en el Portal Fiscal del SENIAT.\r\n' +
        (regimen.cobra_igtf ? '' : 'Este negocio no cobra IGTF: ese archivo sale sin movimientos.\r\n') +
        'Confirma los montos y los plazos con tu contador antes de declarar.\r\n';
    archivos.push({ nombre: 'LEEME.txt', datos: leeme });
    return crearZip(archivos);
}
