import { useState } from 'react';
import { router } from '@inertiajs/react';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { Card } from '../../Components/kit';
import { bs } from '../../lib/format';

const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dmy = (iso) => iso.split('-').reverse().join('/');
const mesesAtras = (hoy, n = 18) => { const [y, m] = hoy.slice(0, 7).split('-').map(Number); return Array.from({ length: n }, (_, i) => { const t = new Date(Date.UTC(y, m - 1 - i, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; }); };
const nombreMes = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MES[m - 1].charAt(0).toUpperCase()}${MES[m - 1].slice(1)} ${y}`; };

const Linea = ({ t, v, sub, fuerte, azul, menos }) => (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${fuerte ? 'border-t border-line pt-3' : ''}`}>
        <span className={`text-[14.5px] ${fuerte ? 'font-semibold text-[#1f2933]' : 'text-[#4a5561]'}`}>{t}{sub && <span className="block text-[12.5px] font-normal text-muted">{sub}</span>}</span>
        <span className={`num shrink-0 text-right ${fuerte ? `text-[17px] font-semibold ${azul ? 'text-brand' : 'text-[#1f2933]'}` : 'text-[14.5px] text-[#1f2933]'}`}>{menos && v !== 0 ? '− ' : ''}{bs(menos ? Math.abs(v) : v)}</span>
    </div>
);
const Bloque = ({ titulo, nota, children }) => (
    <section className="px-6 py-5">
        <h3 className="text-[15px] font-semibold text-[#1f2933]">{titulo}</h3>
        {nota && <p className="mt-0.5 text-[13px] text-muted">{nota}</p>}
        <div className="mt-2 divide-y divide-line/60">{children}</div>
    </section>
);

export default function Quincenal({ d, mes, hoy, emisor, regimen }) {
    const [gen, setGen] = useState('');
    const ir = (c) => router.get('/libros-fiscales', { vista: 'quincenal', mes, quincena: d.quincena, ...c }, { preserveScroll: true, preserveState: false });
    const v = d.ventas, c = d.compras, r = d.retenciones, g = d.igtf, x = d.resultado;
    const periodo = `${d.quincena === 1 ? '1.ª' : '2.ª'} quincena de ${MES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)} (${dmy(d.desde)} al ${dmy(d.hasta)})`;

    const exportar = async (tipo) => {
        setGen(tipo);
        try {
            const lib = await import('../../lib/pdfLibro'); const cfg = await import('../../lib/configLibros');
            const filas = cfg.filasQuincenal(d);
            const columnas = [{ h: 'Sección', w: 55 }, { h: 'Concepto' }, { h: 'Monto (Bs)', a: 'right', w: 42 }];
            const nombre = `resumen-quincenal-${mes}-Q${d.quincena}`;
            if (tipo === 'csv') return lib.csv(`${nombre}.csv`, columnas, filas, null);
            const doc = await lib.construirPdfLibro({ emisor, titulo: 'Resumen quincenal de IVA y retenciones', periodo, columnas, filas,
                notas: ['Montos en bolívares con las tasas de cada operación; las facturas anuladas no suman. Las notas de crédito restan y las de débito suman.', 'Es un apoyo para preparar la declaración de IVA (Forma 30) y enterar las retenciones: no incluye excedentes de períodos anteriores ni otros ajustes. Confírmalo con tu contador.'] });
            doc.save(`${nombre}.pdf`);
        } finally { setGen(''); }
    };

    const sel = 'h-11 rounded-lg border border-line bg-white px-3 text-[15px] font-medium text-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand';
    return (
        <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-wrap items-end gap-3">
                    <label className="block"><span className="mb-1 block text-[13px] text-muted">Mes</span>
                        <select value={mes} onChange={(e) => ir({ mes: e.target.value })} className={sel}>{mesesAtras(hoy).map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}</select></label>
                    <label className="block"><span className="mb-1 block text-[13px] text-muted">Quincena</span>
                        <select value={d.quincena} onChange={(e) => ir({ quincena: Number(e.target.value) })} className={sel}>
                            <option value={1}>1.ª quincena: 01 al 15</option><option value={2}>2.ª quincena: 16 al fin de mes</option></select></label>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={() => exportar('pdf')} disabled={!!gen} className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-4 text-[15px] font-semibold text-white hover:bg-brand-600 disabled:opacity-60"><FileDown className="size-4" />{gen === 'pdf' ? 'Preparando…' : 'Descargar Resumen Quincenal (PDF)'}</button>
                    <button onClick={() => exportar('csv')} disabled={!!gen} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper"><FileSpreadsheet className="size-4" />Excel (CSV)</button>
                </div>
            </div>

            <Card className="overflow-hidden bg-white">
                <div className="border-b border-line px-6 py-5">
                    <p className="text-[13px] text-muted">Resumen para declarar</p>
                    <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[#1f2933]">{periodo}</h2>
                    <p className="mt-1 text-[13px] text-muted">Todo en bolívares, con los montos de cada operación (no se recalcula con la tasa de hoy). Las facturas anuladas no suman.</p>
                </div>
                {c.sin_tasa > 0 && <p role="alert" className="mx-6 mt-5 rounded-lg bg-signal/15 px-4 py-3 text-[13.5px] text-[#7a4d00]">Hay {c.sin_tasa} {c.sin_tasa === 1 ? 'compra' : 'compras'} en dólares sin tasa registrada para su fecha: no suman en Bs. Registra la tasa en Tasas de cambio.</p>}

                <div className="divide-y divide-line">
                    <Bloque titulo="Ventas" nota={`${v.facturas.cantidad} ${v.facturas.cantidad === 1 ? 'factura' : 'facturas'}${v.notas_credito.cantidad + v.notas_debito.cantidad ? ` y ${v.notas_credito.cantidad + v.notas_debito.cantidad} notas` : ''}`}>
                        <Linea t="Base imponible gravada" sub="Facturas, menos notas de crédito, más notas de débito" v={v.base_gravada} />
                        <Linea t="Base exenta" v={v.base_exenta} />
                        <Linea t="Base exonerada" v={v.base_exonerada} />
                        {v.notas_credito.cantidad > 0 && <Linea t="Notas de crédito" sub={`${v.notas_credito.cantidad} · IVA que restan`} v={v.notas_credito.iva} menos />}
                        {v.notas_debito.cantidad > 0 && <Linea t="Notas de débito" sub={`${v.notas_debito.cantidad} · IVA que suman`} v={v.notas_debito.iva} />}
                        <Linea fuerte azul t="IVA débito fiscal" sub="IVA cobrado en ventas, ya con las notas" v={v.iva_debito} />
                    </Bloque>
                    <Bloque titulo="Compras" nota={`${c.cantidad} ${c.cantidad === 1 ? 'factura registrada' : 'facturas registradas'}`}>
                        <Linea t="Base imponible" v={c.base} />
                        <Linea t="IVA al costo" sub="No recuperable: pasa al costo de la mercancía" v={c.iva_al_costo} />
                        <Linea fuerte azul t="IVA crédito fiscal" sub="IVA de compras que puedes recuperar" v={c.iva_credito} />
                    </Bloque>
                    <Bloque titulo="Retenciones de IVA" nota={r.activas ? undefined : 'Falta activar las retenciones (08_retenciones_iva.sql).'}>
                        <Linea fuerte azul t="Retenido a tus proveedores" sub={`${r.comprobantes_practicados} ${r.comprobantes_practicados === 1 ? 'comprobante' : 'comprobantes'} · lo que debes enterar al SENIAT${r.enterada === true ? ` · enterada el ${dmy(r.fecha_pago)}` : r.enterada === false && r.practicadas > 0 ? ' · aún sin marcar como enterada' : ''}`} v={r.practicadas} />
                        <Linea t="Que te retuvieron tus clientes" sub={`${r.comprobantes_sufridos} ${r.comprobantes_sufridos === 1 ? 'comprobante' : 'comprobantes'} · se resta del IVA que pagas`} v={r.sufridas} />
                    </Bloque>
                    <Bloque titulo="IGTF" nota={regimen.cobra_igtf ? undefined : 'Tu negocio no cobra IGTF.'}>
                        <Linea t="IGTF cobrado en divisas" sub={`Sobre US$ ${new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2 }).format(g.base_divisas_usd)} cobrados en divisas`} v={g.igtf_ves} />
                        {g.revertido_ves > 0 && <Linea t="Devuelto por anulaciones" v={g.revertido_ves} menos />}
                        <Linea fuerte azul t="IGTF neto del período" v={g.neto_ves} />
                    </Bloque>
                    <Bloque titulo="Resultado de la quincena" nota="IVA débito − IVA crédito − retenciones que te practicaron">
                        <Linea fuerte azul t={x.excedente > 0 ? 'Excedente de crédito fiscal' : 'IVA a pagar'} sub={x.excedente > 0 ? 'No pagas IVA en esta quincena; el excedente se traslada según tu contador' : undefined} v={x.excedente > 0 ? x.excedente : x.iva_a_pagar} />
                    </Bloque>
                </div>
            </Card>
            <p className="mt-4 max-w-[80ch] text-[13px] text-muted">Es un apoyo para preparar tu declaración de IVA (Forma 30) y enterar las retenciones. No incluye excedentes de períodos anteriores ni otros ajustes, y el plazo de cada quincena lo fija el calendario del SENIAT: confírmalo con tu contador.</p>
        </>
    );
}
