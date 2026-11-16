/** Columnas, filas y totales de cada libro fiscal para PDF y CSV. Lo comparten la pestaña y el paquete de declaración. */
import { n0, n2 } from './format';

const TIPO = { FACTURA: 'Factura', NOTA_CREDITO: 'Nota de crédito', NOTA_DEBITO: 'Nota de débito' };
const fechaCorta = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

export function configuracionLibro(vista, p, mes) {
    const nombre = (b) => `${b}-${mes}`;
    const A = { a: 'right' };
    let cfg = null;
            if (vista === 'ventas') {
                const { filas, totales: t } = p.libro;
                const doc1 = (f) => `${TIPO[f.tipo]} ${f.numero}${f.estado === 'ANULADA' ? ' (anulada)' : ''}${f.afecta && f.estado !== 'ANULADA' ? ` · afecta ${f.afecta}` : ''}`;
                cfg = { titulo: 'Libro de ventas', file: nombre('libro-de-ventas'),
                    columnas: [{ h: 'Op.', w: 9 }, { h: 'Fecha', w: 18 }, { h: 'Tipo', w: 10 }, { h: 'Documento' }, { h: 'Factura / control' }, { h: 'Cliente / RIF' }, { h: 'Base', ...A }, { h: 'Exento', ...A }, { h: 'IVA', ...A }, { h: 'IVA retenido / comprobante', ...A }, { h: 'Total', ...A }, { h: 'IGTF', ...A }],
                    filas: filas.map((f, i) => [String(i + 1), fechaCorta(f.fecha), f.tx, doc1(f), [f.factura, f.control && `Control ${f.control}`].filter(Boolean).join('\n'), [f.cliente, f.rif].filter(Boolean).join('\n'), n2(f.base), n2(f.exento + f.exonerado), n2(f.iva), f.ret ? `${n2(f.ret)}\n${f.comprobante}` : '', n2(f.total), n2(f.igtf)]),
                    totales: ['', 'Total del mes', '', `${t.facturas} facturas, ${t.notas} notas`, '', '', n2(t.base), n2(t.exento + t.exonerado), n2(t.iva), n2(t.retenido), n2(t.total), n2(t.igtf)],
                    csv: { columnas: [{ h: 'Op.' }, { h: 'Fecha' }, { h: 'Tipo de transacción' }, { h: 'Documento' }, { h: 'Factura afectada' }, { h: 'Factura fiscal' }, { h: 'Control' }, { h: 'Cliente' }, { h: 'RIF / cédula' }, { h: 'Base' }, { h: 'Exento' }, { h: 'IVA' }, { h: 'IVA retenido' }, { h: 'Comprobante de retención' }, { h: 'Total' }, { h: 'IGTF' }],
                        filas: filas.map((f, i) => [String(i + 1), fechaCorta(f.fecha), f.tx, `${TIPO[f.tipo]} ${f.numero}${f.estado === 'ANULADA' ? ' (anulada)' : ''}`, f.afecta || '', f.factura || '', f.control || '', f.cliente, f.rif || '', n2(f.base), n2(f.exento + f.exonerado), n2(f.iva), f.ret ? n2(f.ret) : '', f.comprobante || '', n2(f.total), n2(f.igtf)]),
                        totales: ['', 'Total del mes', '', '', '', '', '', '', '', n2(t.base), n2(t.exento + t.exonerado), n2(t.iva), n2(t.retenido), '', n2(t.total), n2(t.igtf)] },
                    anuladas: filas.map((f, i) => (f.estado === 'ANULADA' ? i : -1)).filter((i) => i >= 0), notas: ['Montos en bolívares a la tasa de cada operación. Los documentos anulados no suman en los totales. Las notas de crédito restan.', 'Tipo de transacción: 01 registro, 02 complemento (nota de débito), 03 anulación, 04 ajuste (nota de crédito).'] };
            } else if (vista === 'compras') {
                const { filas, totales: t } = p.libro;
                cfg = { titulo: 'Libro de compras', file: nombre('libro-de-compras'),
                    columnas: [{ h: 'Op.', w: 9 }, { h: 'Fecha', w: 18 }, { h: 'Tipo', w: 10 }, { h: 'RIF / proveedor' }, { h: 'Factura / control / planilla' }, { h: 'Base', ...A }, { h: 'Exento', ...A }, { h: 'IVA', ...A }, { h: 'Crédito fiscal', ...A }, { h: 'IVA retenido / comprobante', ...A }, { h: 'Total', ...A }],
                    filas: filas.map((f, i) => [String(i + 1), fechaCorta(f.fecha), f.tx, `${f.rif}\n${f.proveedor}`, [`${f.factura}${f.estado === 'ANULADA' ? ' (anulada)' : ''}${f.estado !== 'ANULADA' && !f.credito ? ' · IVA al costo' : ''}`, f.control && `Control ${f.control}`, f.planilla && `Planilla ${f.planilla}${f.aduana ? ` (${f.aduana})` : ''}`].filter(Boolean).join('\n'), n2(f.base), n2(f.exento), n2(f.iva), n2(f.cf), f.ret ? `${n2(f.ret)}\n${f.comprobante}` : '', n2(f.total)]),
                    totales: ['', 'Total del mes', '', `${t.facturas} factura${t.facturas === 1 ? '' : 's'}`, '', n2(t.base), n2(t.exento), n2(t.iva), n2(t.cf), n2(t.retenido), n2(t.total)],
                    csv: { columnas: [{ h: 'Op.' }, { h: 'Fecha' }, { h: 'Tipo de transacción' }, { h: 'RIF' }, { h: 'Proveedor' }, { h: 'Factura' }, { h: 'Control' }, { h: 'Planilla de importación' }, { h: 'Aduana' }, { h: 'Base' }, { h: 'Exento' }, { h: 'IVA' }, { h: 'Crédito fiscal' }, { h: 'IVA retenido' }, { h: 'Comprobante de retención' }, { h: 'Total' }],
                        filas: filas.map((f, i) => [String(i + 1), fechaCorta(f.fecha), f.tx, f.rif, f.proveedor, `${f.factura}${f.estado === 'ANULADA' ? ' (anulada)' : ''}`, f.control || '', f.planilla || '', f.aduana || '', n2(f.base), n2(f.exento), n2(f.iva), n2(f.cf), f.ret ? n2(f.ret) : '', f.comprobante || '', n2(f.total)]),
                        totales: ['', 'Total del mes', '', '', '', '', '', '', '', n2(t.base), n2(t.exento), n2(t.iva), n2(t.cf), n2(t.retenido), '', n2(t.total)] },
                    anuladas: filas.map((f, i) => (f.estado === 'ANULADA' ? i : -1)).filter((i) => i >= 0), notas: [`IVA de compras que pasó al costo: Bs ${n2(t.al_costo)}. Las facturas anuladas no suman.`] };
            } else if (vista === 'retenciones') {
                const { filas, totales: t } = p.retenciones;
                cfg = { titulo: 'Retenciones de IVA', file: nombre('retenciones-iva'),
                    columnas: [{ h: 'Fecha', w: 18 }, { h: 'Comprobante' }, { h: 'Sentido' }, { h: 'Tercero' }, { h: 'Factura' }, { h: '%', ...A }, { h: 'IVA de la factura', ...A }, { h: 'IVA retenido', ...A }],
                    filas: filas.map((x) => [fechaCorta(x.fecha), `${x.comprobante}${x.estado === 'ANULADA' ? ' (anulado)' : ''}`, x.sentido === 'COMPRA' ? 'Retenido a proveedor' : 'Retenido por cliente', x.tercero, x.documento, n0(x.pct), n2(x.iva), n2(x.retenido)]),
                    totales: ['Total activo', '', '', '', '', '', '', n2(t.sufrida + t.practicada)],
                    anuladas: filas.map((x, i) => (x.estado === 'ANULADA' ? i : -1)).filter((i) => i >= 0),
                    notas: [`Retenido por clientes (reduce el IVA a pagar): Bs ${n2(t.sufrida)}. Retenido a proveedores (por enterar): Bs ${n2(t.practicada)}.`] };
            } else if (vista === 'igtf') {
                const { dias, totales: t } = p.igtf;
                cfg = { titulo: 'IGTF por día', file: nombre('igtf'),
                    columnas: [{ h: 'Día' }, { h: 'Base en divisas (USD)', ...A }, { h: 'IGTF USD', ...A }, { h: 'IGTF Bs', ...A }, { h: 'De ventas anuladas (Bs)', ...A }],
                    filas: dias.map((x) => [fechaCorta(x.fecha), n2(x.base_usd), n2(x.igtf_usd), n2(x.igtf_ves), n2(x.anul_ves)]), totales: ['Total del mes', n2(t.base_usd), n2(t.igtf_usd), n2(t.igtf_ves), ''],
                    notas: [`IGTF devuelto a clientes por anulaciones (por reclamar): Bs ${n2(t.rev_ves)}.`] };
            } else if (vista === 'notas') {
                cfg = { titulo: 'Notas de crédito y débito', file: nombre('notas'),
                    columnas: [{ h: 'Fecha', w: 18 }, { h: 'Tipo' }, { h: 'Número' }, { h: 'Control' }, { h: 'Afecta a' }, { h: 'Cliente' }, { h: 'Motivo' }, { h: 'Base', ...A }, { h: 'IVA', ...A }, { h: 'Total', ...A }],
                    filas: p.notas.filas.map((n) => { const s = n.tipo === 'C' ? -1 : 1; return [fechaCorta(n.fecha), n.tipo === 'C' ? 'Crédito' : 'Débito', n.numero, n.control || '', n.afecta, n.cliente, n.motivo, n2(s * n.base), n2(s * n.iva), n2(s * n.total)]; }), totales: null };
            }
    return cfg;
}

/** Filas del resumen quincenal: Sección, Concepto, Monto (Bs). Las usan la pantalla, el PDF y el CSV. */
export function filasQuincenal(d) {
    const v = d.ventas, c = d.compras, r = d.retenciones, g = d.igtf, x = d.resultado;
    const f = (s, t, m) => [s, t, n2(m)];
    return [
        f('Ventas', 'Base imponible gravada (facturas)', v.facturas.base),
        f('Ventas', 'Base imponible de notas de crédito (restan)', v.notas_credito.base),
        f('Ventas', 'Base imponible de notas de débito (suman)', v.notas_debito.base),
        f('Ventas', 'Base imponible gravada neta', v.base_gravada),
        f('Ventas', 'Base exenta', v.base_exenta),
        f('Ventas', 'Base exonerada', v.base_exonerada),
        f('Ventas', 'IVA de las facturas', v.facturas.iva),
        f('Ventas', 'IVA de notas de crédito (restan)', v.notas_credito.iva),
        f('Ventas', 'IVA de notas de débito (suman)', v.notas_debito.iva),
        f('Ventas', 'IVA débito fiscal', v.iva_debito),
        f('Compras', 'Base imponible', c.base),
        f('Compras', 'IVA de las compras registradas', c.iva),
        f('Compras', 'IVA crédito fiscal (recuperable)', c.iva_credito),
        f('Compras', 'IVA al costo (no recuperable)', c.iva_al_costo),
        f('Retenciones de IVA', 'Retenido a tus proveedores (por enterar al SENIAT)', r.practicadas),
        f('Retenciones de IVA', 'Que te retuvieron tus clientes', r.sufridas),
        f('IGTF', 'IGTF cobrado en divisas', g.igtf_ves),
        f('IGTF', 'Devuelto por anulaciones (revertido)', -g.revertido_ves),
        f('IGTF', 'IGTF neto del período', g.neto_ves),
        f('Resultado de IVA', 'IVA débito fiscal', x.iva_debito),
        f('Resultado de IVA', 'IVA crédito fiscal', -x.iva_credito),
        f('Resultado de IVA', 'Retenciones que te practicaron', -x.retenciones_sufridas),
        f('Resultado de IVA', x.excedente > 0 ? 'Excedente de crédito fiscal del período' : 'IVA a pagar del período', x.excedente > 0 ? x.excedente : x.iva_a_pagar),
    ];
}
