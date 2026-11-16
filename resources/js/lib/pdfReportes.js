/**
 * Reportes de gestión en PDF (blanco y negro, carta/A4 vertical, folio y «hoja X de Y», «Suma y sigue» cuando pasan de una hoja).
 *   pdfRentabilidad(d) · pdfComprasGlobal(d) · pdfMovimientosCaja(d)      d = respuesta de /reportes/...
 * Reutiliza el encabezado y el pie de pdfContabilidad y la tabla con acumulado de pdfConciliacion.
 */
import { cargar, FINA } from './pdfLibro';
import { M, TOP, nuevo, pieHojas } from './pdfContabilidad';
import { espacio, neg, tabla } from './pdfConciliacion';
import { n2, n0 } from './format';

const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const rango = (d) => (d.desde === d.hasta ? dmy(d.desde) : `${dmy(d.desde)} al ${dmy(d.hasta)}`);
const R = (w) => ({ halign: 'right', cellWidth: w });

/** Arma la hoja: encabezado, tabla con suma y sigue, fila de totales y pie. */
async function armar(d, { titulo, periodo, unidad, head, filas, colMonto, columnStyles, totales, notas = [] }) {
    const { doc, autoTable } = await cargar('portrait');
    const W = doc.internal.pageSize.getWidth();
    doc.setProperties({ title: `${titulo} ${periodo}`, subject: d.emisor.razon_social, creator: 'Repuestos' });
    const cab = nuevo(doc, { emisor: d.emisor, titulo, periodo, unidad, folio: 1 });
    cab();
    let y = TOP;
    if (!filas.length) {
        doc.setFont('helvetica', 'normal').setFontSize(9).text('No hay movimientos en el período elegido.', M, y + 4); y += 12;
    } else {
        const t = tabla(doc, autoTable, cab, y, { head, filas, colMonto, columnStyles });
        y = t.y + 3;
    }
    // Totales
    y = espacio(doc, cab, y, 8 + totales.length * 5.2);
    doc.setLineWidth(FINA).line(M, y, W - M, y); y += 4.5;
    totales.forEach(([a, b, fuerte]) => {
        doc.setFont('helvetica', fuerte ? 'bold' : 'normal').setFontSize(fuerte ? 9.5 : 8.5);
        doc.text(a, W - M - 52, y, { align: 'right' }); doc.text(b, W - M, y, { align: 'right' }); y += 5.2;
    });
    y += 2;
    doc.setFont('helvetica', 'italic').setFontSize(7.5);
    notas.forEach((n) => { const l = doc.splitTextToSize(n, W - M * 2); y = espacio(doc, cab, y, l.length * 3.5 + 2); doc.text(l, M, y); y += l.length * 3.5 + 1; });
    doc.setFont('helvetica', 'normal').setFontSize(7.5).text(`Generado por ${d.generado_por || ''}`, M, y + 3);
    pieHojas(doc);
    return doc;
}

export async function pdfRentabilidad(d) {
    const t = d.totales;
    return armar(d, {
        titulo: 'Rentabilidad por producto', periodo: rango(d), unidad: 'Montos en dólares (US$), sin IVA',
        head: ['SKU', 'Producto', 'Unid.', 'Ingreso', 'Costo', 'Utilidad', 'Margen'],
        filas: d.filas.map((f) => ({ celdas: [f.sku, f.producto, n0(f.unidades), n2(f.ingreso_usd), n2(f.costo_usd), neg(f.utilidad_usd), f.margen_pct === null ? '—' : `${n2(f.margen_pct)} %`], monto: f.utilidad_usd })),
        colMonto: 5, columnStyles: { 0: { cellWidth: 26 }, 2: R(14), 3: R(25), 4: R(25), 5: R(25), 6: R(18) },
        totales: [['Unidades vendidas', n0(t.unidades)], ['Ingreso (base sin IVA)', `US$ ${n2(t.ingreso_usd)}`], ['Costo de lo vendido', `US$ ${n2(t.costo_usd)}`], ['Utilidad bruta', `US$ ${neg(t.utilidad_usd)}`, true], ['Margen', t.margen_pct === null ? '—' : `${n2(t.margen_pct)} %`, true]],
        notas: ['Ingreso = base imponible de cada línea vendida (sin IVA ni IGTF). Costo = cantidad × costo unitario congelado al momento de la venta. Las ventas anuladas no cuentan. Las notas de crédito del período restan (y las de débito suman): su base baja el ingreso y, si devolvieron mercancía, su costo baja el costo. Las notas sin producto aparecen en una fila aparte.'],
    });
}

export async function pdfComprasGlobal(d) {
    const t = d.totales;
    return armar(d, {
        titulo: 'Compras por proveedor', periodo: rango(d), unidad: 'Total en dólares (US$) y en bolívares (Bs)',
        head: ['RIF', 'Proveedor', 'Facturas', 'Total US$', 'Total Bs'],
        filas: d.filas.map((f) => ({ celdas: [f.rif, f.proveedor + (f.sin_tasa ? ' *' : ''), n0(f.facturas), n2(f.total_usd), n2(f.total_ves)], monto: f.total_usd })),
        colMonto: 3, columnStyles: { 0: { cellWidth: 30 }, 2: R(18), 3: R(30), 4: R(36) },
        totales: [['Facturas', n0(t.facturas)], ['Total comprado US$', n2(t.total_usd), true], ['Total comprado Bs', n2(t.total_ves), true]],
        notas: ['Solo facturas registradas (las anuladas no cuentan), por fecha de la factura. El total en Bs es el del libro de compras, a la tasa de la fecha de cada factura.', ...(t.sin_tasa ? [`* ${t.sin_tasa} factura(s) sin tasa de cambio para esa fecha: no suman en Bs.`] : [])],
    });
}

export async function pdfMovimientosCaja(d) {
    const t = d.totales;
    return armar(d, {
        titulo: 'Movimientos de caja', periodo: d.apertura ? d.etiqueta : rango(d), unidad: 'Equivalentes en dólares (US$) y bolívares (Bs)',
        head: ['Fecha', 'Tipo', 'Concepto', 'Monto original', 'Equiv. US$', 'Equiv. Bs'],
        filas: d.filas.map((f) => ({ celdas: [dmy(f.fecha.slice(0, 10)) + ' ' + f.fecha.slice(11, 16), f.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso', f.concepto, `${f.moneda} ${f.moneda === 'COP' ? n0(f.monto) : n2(f.monto)}`, (f.tipo === 'EGRESO' ? '-' : '') + n2(f.usd), (f.tipo === 'EGRESO' ? '-' : '') + n2(f.ves)], monto: f.tipo === 'EGRESO' ? -f.usd : f.usd })),
        colMonto: 4, columnStyles: { 0: { cellWidth: 27 }, 1: { cellWidth: 15 }, 3: R(27), 4: R(22), 5: R(28) },
        totales: [['Ingresos US$', n2(t.ingresos_usd)], ['Egresos US$', n2(t.egresos_usd)], ['Neto US$', neg(t.neto_usd), true], ['Ingresos Bs', n2(t.ingresos_ves)], ['Egresos Bs', n2(t.egresos_ves)], ['Neto Bs', neg(t.neto_ves), true]],
        notas: ['Ingresos: cobros de ventas (con IGTF), cobros de cuentas por cobrar y movimientos manuales de entrada. Egresos: movimientos manuales de salida. Los registros anulados no se listan y los vueltos ya vienen descontados de cada cobro.'],
    });
}

export async function pdfAbc(d) {
    const t = d.totales;
    return armar(d, {
        titulo: 'Análisis ABC de lo vendido', periodo: rango(d), unidad: `Clasificado por ${d.por === 'UNIDADES' ? 'unidades vendidas' : 'ingreso (US$)'}`,
        head: ['Clase', 'SKU', 'Producto', 'Ingreso', '% del total', '% acumulado', 'Margen'],
        filas: d.filas.map((f) => ({ celdas: [f.clase, f.sku, f.producto, n2(f.ingreso_usd), `${n2(f.participacion_pct)} %`, `${n2(f.acumulado_pct)} %`, f.margen_pct === null ? '—' : `${n2(f.margen_pct)} %`], monto: f.ingreso_usd })),
        colMonto: 3, columnStyles: { 0: { cellWidth: 14 }, 1: { cellWidth: 24 }, 4: R(20), 5: R(22), 6: R(18) },
        totales: [['Piezas clase A', n0(t.clase_a)], ['Piezas clase B', n0(t.clase_b)], ['Piezas clase C', n0(t.clase_c)], ['Ingreso del período', `US$ ${n2(t.ingreso_usd)}`, true], ['Utilidad del período', `US$ ${n2(t.utilidad_usd)}`, true]],
        notas: ['Regla 80/15/5 sobre lo vendido del período: A = piezas que juntas aportan el 80 % del valor (o de las unidades), B = hasta el 95 %, C = el resto. Las piezas C con mucho stock son candidatas a liquidación; las A nunca deberían faltar.'],
    });
}

export async function pdfRotacion(d) {
    const t = d.totales;
    return armar(d, {
        titulo: 'Rotación de inventario', periodo: rango(d), unidad: 'Valores en dólares (US$) a costo',
        head: ['SKU', 'Producto', 'Stock', 'Valor US$', 'Vendidas', 'Días p/ agotar', 'Estado'],
        filas: d.filas.map((f) => ({ celdas: [f.sku, f.producto, n0(f.stock), n2(f.valor_stock_usd), n0(f.unidades_vendidas), f.dias_para_agotar === null ? '—' : n0(f.dias_para_agotar), f.estado], monto: f.valor_stock_usd })),
        colMonto: 3, columnStyles: { 0: { cellWidth: 24 }, 2: R(14), 3: R(22), 4: R(18), 5: R(22) },
        totales: [['Productos', n0(t.productos)], ['Valor parado a costo', `US$ ${n2(t.valor_parado_usd)}`, true], ['Piezas muertas', `${n0(t.muertos)} (US$ ${n2(t.valor_muerto_usd)})`, true]],
        notas: ['Días para agotar = stock actual ÷ venta diaria del período. MUERTO = sin ventas en el período y con stock: liquídate, ofrécele al cliente o revisa el precio. AGOTADO = se vendió y no hay: venta perdida.'],
    });
}

export async function pdfRentabilidadCategoria(d) {
    const t = d.totales;
    return armar(d, {
        titulo: 'Rentabilidad por categoría', periodo: rango(d), unidad: 'Montos en dólares (US$), sin IVA',
        head: ['Categoría', 'Ingreso', 'Costo', 'Utilidad', 'Margen', '% del total'],
        filas: d.filas.map((f) => ({ celdas: [f.categoria, n2(f.ingreso_usd), n2(f.costo_usd), neg(f.utilidad_usd), f.margen_pct === null ? '—' : `${n2(f.margen_pct)} %`, `${n2(f.participacion_pct)} %`], monto: f.utilidad_usd })),
        colMonto: 3, columnStyles: { 1: R(25), 2: R(25), 3: R(25), 4: R(18), 5: R(20) },
        totales: [['Categorías', n0(t.categorias)], ['Ingreso (base sin IVA)', `US$ ${n2(t.ingreso_usd)}`], ['Costo de lo vendido', `US$ ${n2(t.costo_usd)}`], ['Utilidad bruta', `US$ ${neg(t.utilidad_usd)}`, true], ['Margen', t.margen_pct === null ? '—' : `${n2(t.margen_pct)} %`, true]],
        notas: ['Las notas de crédito con productos del período restan la categoría de cada pieza devuelta (ingreso y costo), igual que en el reporte por producto.'],
    });
}

export async function pdfRentabilidadCliente(d) {
    const t = d.totales;
    return armar(d, {
        titulo: 'Rentabilidad por cliente', periodo: rango(d), unidad: 'Montos en dólares (US$), sin IVA',
        head: ['Cliente', 'Ventas', 'Ingreso', 'Utilidad', 'Margen', 'Ticket prom.', 'Días sin comprar'],
        filas: d.filas.map((f) => ({ celdas: [f.cliente + (f.documento ? ` (${f.documento})` : ''), n0(f.ventas), n2(f.ingreso_usd), neg(f.utilidad_usd), f.margen_pct === null ? '—' : `${n2(f.margen_pct)} %`, f.ticket_promedio_usd === null ? '—' : n2(f.ticket_promedio_usd), f.dias_sin_comprar === null ? '—' : n0(f.dias_sin_comprar)], monto: f.ingreso_usd })),
        colMonto: 2, columnStyles: { 1: R(14), 2: R(25), 3: R(25), 4: R(16), 5: R(18), 6: R(24) },
        totales: [['Clientes con compras', n0(t.clientes)], ['Ventas', n0(t.ventas)], ['Ingreso (base sin IVA)', `US$ ${n2(t.ingreso_usd)}`], ['Utilidad bruta', `US$ ${neg(t.utilidad_usd)}`, true], ['Margen', t.margen_pct === null ? '—' : `${n2(t.margen_pct)} %`, true]],
        notas: ['Incluye «Consumidor final» como grupo (ventas sin cliente identificado). Las notas sin producto (descuentos y ajustes) restan al ingreso del cliente de su venta.'],
    });
}

export const PDF_REPORTE = { rentabilidad: pdfRentabilidad, abc: pdfAbc, rotacion: pdfRotacion, 'rentabilidad-categoria': pdfRentabilidadCategoria, 'rentabilidad-cliente': pdfRentabilidadCliente, compras: pdfComprasGlobal, caja: pdfMovimientosCaja };
