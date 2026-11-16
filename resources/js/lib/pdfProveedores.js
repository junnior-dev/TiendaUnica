/** PDF del proveedor: estado de cuenta (qué se le debe y qué está vencido) y expediente. Blanco y negro, como los libros. */
import { cargar, construirPdfLibro, encabezado, estilosBase, pie, FINA, MEDIA } from './pdfLibro';
import { n0, n2 } from './format';

const dmy = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');

export function situacion(f) {
    if (f.situacion === 'anulada') return 'Anulada';
    if (f.situacion === 'contado') return 'Pagada de contado';
    if (f.situacion === 'pagada') return 'Pagada';
    if (f.dias < 0) return `Vencida hace ${-f.dias} ${f.dias === -1 ? 'día' : 'días'}`;
    if (f.dias === 0) return 'Vence hoy';
    return `Vence en ${f.dias} ${f.dias === 1 ? 'día' : 'días'}`;
}

export async function construirPdfEstadoCuenta(d) {
    const { proveedor: p, filas, totales: t, antiguedad: a, pagos, hoy, emisor } = d;
    const notas = [
        `Antigüedad del saldo pendiente (US$): por vencer ${n2(a.por_vencer)} · vencido de 1 a 30 días ${n2(a.d1_30)} · de 31 a 60 días ${n2(a.d31_60)} · de 61 a 90 días ${n2(a.d61_90)} · de más de 90 días ${n2(a.d90_mas)}.`,
    ];
    const vivos = pagos.filter((x) => x.estado === 'ACTIVO');
    if (vivos.length) {
        notas.push('Pagos registrados:');
        vivos.slice(0, 12).forEach((x) => notas.push(`  ${dmy(x.fecha)}  ·  ${x.moneda} ${n2(x.monto)}${x.moneda !== 'USD' ? ` (US$ ${n2(x.monto_usd)})` : ''}${x.referencia ? `  ·  Ref. ${x.referencia}` : ''}${x.aplicado ? `  ·  Aplicado a ${x.aplicado}` : ''}`));
        if (vivos.length > 12) notas.push(`  … y ${vivos.length - 12} pagos anteriores.`);
    }
    notas.push('Las facturas de contado se consideran pagadas. Los pagos anulados no se muestran ni restan del saldo.');
    return construirPdfLibro({
        emisor, titulo: 'Estado de cuenta del proveedor', periodo: `${p.nombre} · RIF ${p.rif} · al ${dmy(hoy)}`, unidad: 'Montos en dólares (US$)',
        columnas: [{ h: 'Factura', w: 36 }, { h: 'Fecha', w: 22 }, { h: 'Condición', w: 24 }, { h: 'Vence', w: 22 }, { h: 'Total', a: 'right', w: 28 }, { h: 'Pagado', a: 'right', w: 28 }, { h: 'Saldo', a: 'right', w: 28 }, { h: 'Situación' }],
        filas: filas.map((f) => [f.factura, dmy(f.fecha), f.condicion === 'CREDITO' ? `Crédito ${f.vence ? '' : ''}`.trim() : 'Contado', f.vence ? dmy(f.vence) : '—', n2(f.total_usd), f.situacion === 'anulada' ? '—' : n2(f.pagado_usd), f.situacion === 'anulada' ? '—' : n2(f.saldo_usd), situacion(f)]),
        totales: ['Totales (sin anuladas)', '', '', '', n2(t.facturado), n2(t.pagado), n2(t.saldo), t.saldo > 0 ? 'Por pagar' : 'Sin deuda'],
        anuladas: filas.map((f, i) => (f.situacion === 'anulada' ? i : -1)).filter((i) => i >= 0), notas,
    });
}

export async function construirPdfExpediente(d) {
    const { detalle: p, emisor, hoy, anio, usd_anio: usdAnio, compras_anio: nAnio, ultimas } = d;
    const M = 14;
    const { doc, autoTable } = await cargar('portrait');
    doc.setProperties({ title: `Expediente ${p.nombre}`, subject: emisor.comercial || emisor.razon_social, creator: 'Repuestos' });
    let y = encabezado(doc, emisor, 'Expediente de proveedor', `al ${dmy(hoy)}`, M, 'Montos en dólares (US$)');
    const W = doc.internal.pageSize.getWidth();

    doc.setFont('helvetica', 'bold').setFontSize(13).text(p.nombre, M, y + 3);
    doc.setFont('helvetica', 'normal').setFontSize(9).text(`RIF ${p.rif}${p.rif_valido ? '' : ' (revisar)'}  ·  ${p.activo ? 'Proveedor activo' : 'Proveedor desactivado'}  ·  En el directorio desde el ${dmy(p.desde)}`, M, y + 8.5);
    y += 14;
    const contacto = [['Teléfono', p.telefono], ['Correo', p.correo], ['Dirección', p.direccion], ['Crédito que otorga', p.dias_credito == null ? null : p.dias_credito > 0 ? `${p.dias_credito} días` : 'De contado']].filter(([, v]) => v);
    contacto.forEach(([k, v]) => { doc.setFont('helvetica', 'bold').setFontSize(8.5).text(k, M, y); doc.setFont('helvetica', 'normal').text(doc.splitTextToSize(String(v), W - M * 2 - 38), M + 38, y); y += 5; });

    y += 3; doc.setLineWidth(FINA).line(M, y, W - M, y); y += 6;
    doc.setFont('helvetica', 'bold').setFontSize(10).text('Resumen de compras', M, y); y += 2;
    const resumen = [
        [`Compras de ${anio}`, `${n0(nAnio)} ${nAnio === 1 ? 'factura' : 'facturas'}`, `US$ ${n2(usdAnio)}`],
        ['Historial completo', `${n0(p.compras)} ${p.compras === 1 ? 'factura' : 'facturas'}${p.anuladas ? ` (+${p.anuladas} anulada${p.anuladas === 1 ? '' : 's'})` : ''}`, `US$ ${n2(p.usd)}`],
        ['Compra promedio', '', p.compras ? `US$ ${n2(p.promedio_usd)}` : '—'],
        ['Primera / última compra', `${dmy(p.primera)}  /  ${dmy(p.ultima)}`, p.cada_dias ? `cada ~${p.cada_dias} días` : ''],
        ['Crédito fiscal acumulado', '', `Bs ${n2(p.credito_ves)}`],
    ];
    if (p.cxp) resumen.push(['Saldo por pagar', p.cxp.pendientes ? `${p.cxp.pendientes} ${p.cxp.pendientes === 1 ? 'factura' : 'facturas'}` : 'Sin deuda', p.cxp.saldo_usd > 0 ? `US$ ${n2(p.cxp.saldo_usd)}${p.cxp.vencido_usd > 0 ? `  (vencido ${n2(p.cxp.vencido_usd)})` : ''}` : '']);
    autoTable(doc, { ...estilosBase(doc, M), startY: y, body: resumen, columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold' }, 2: { halign: 'right' } }, styles: { ...estilosBase(doc, M).styles, fontSize: 8.5 } });
    y = doc.lastAutoTable.finalY + 8;

    doc.setFont('helvetica', 'bold').setFontSize(10).text(`Últimas ${ultimas.length} compras`, M, y);
    autoTable(doc, {
        ...estilosBase(doc, M), startY: y + 2,
        head: [['Fecha', 'Factura', 'N.º de control', 'Moneda', 'Total factura', 'Total US$', 'Estado']],
        body: ultimas.length ? ultimas.map((c) => [dmy(c.fecha), c.factura, c.control || '—', c.moneda, n2(c.total), n2(c.total_usd), c.estado === 'ANULADA' ? 'Anulada' : 'Registrada']) : [['Sin compras registradas', '', '', '', '', '', '']],
        columnStyles: { 0: { cellWidth: 22 }, 3: { cellWidth: 16 }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { cellWidth: 22 } },
        didParseCell: (h) => { if (h.section === 'head' && [4, 5].includes(h.column.index)) h.cell.styles.halign = 'right'; if (h.section === 'body' && ultimas[h.row.index]?.estado === 'ANULADA') h.cell.styles.fontStyle = 'italic'; },
    });
    doc.setFont('helvetica', 'normal').setFontSize(7.5).text('Las facturas anuladas aparecen en cursiva y no suman en los totales. Documento informativo; no sustituye el Libro de Compras.', M, doc.lastAutoTable.finalY + 6);
    doc.setLineWidth(MEDIA);
    pie(doc, M);
    return doc;
}
