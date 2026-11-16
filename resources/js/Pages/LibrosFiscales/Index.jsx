import { Head, Link, router } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { CalendarRange, AlertTriangle, ArrowLeft, FileArchive, ShieldAlert, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, FileDown, FilePlus2, FileSpreadsheet, HandCoins, Landmark, Percent, Plus, Receipt, ShieldCheck, Ship, ShoppingBag, Stamp } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi, Modal, Vacio } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { n0, n2, tasa, usd } from '../../lib/format';
import { configuracionLibro } from '../../lib/configLibros';
import { http } from '../../lib/http';
import Quincenal from './Quincenal';
import DevolucionNota from '../../Components/DevolucionNota';
import DevolucionDinero from '../../Components/DevolucionDinero';
import { ModalCierre, PuntoCierre, Quincenas, useCierre } from './Cierre';

const bsf = (v) => `Bs ${n2(v)}`;
const num = (s) => { const t = String(s ?? '').trim(); return t ? Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) : NaN; };
const fechaCorta = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const mesLargo = (ym) => { const t = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T12:00:00Z`)); return t.charAt(0).toUpperCase() + t.slice(1); };
const mesCorto = (ym) => new Intl.DateTimeFormat('es-VE', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${ym}-01T12:00:00Z`)).replace('.', '');
const sumaMes = (ym, d) => { const [y, m] = ym.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + d, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };

const TABS = [
    ['resumen', 'Resumen de IVA', Receipt], ['ventas', 'Libro de ventas', BookOpen], ['compras', 'Libro de compras', ShoppingBag],
    ['quincenal', 'Resumen quincenal', CalendarRange], ['retenciones', 'Retenciones de IVA', HandCoins], ['igtf', 'IGTF', Landmark], ['notas', 'Notas de crédito y débito', FilePlus2], ['alicuotas', 'Alícuotas', Percent],
];
const TIPO = { FACTURA: 'Factura', NOTA_CREDITO: 'Nota de crédito', NOTA_DEBITO: 'Nota de débito' };

/* ───────── piezas pequeñas ───────── */
const Th = ({ children, r, className = '' }) => <th className={`px-3 py-3 font-medium first:pl-5 last:pr-5 ${r ? 'text-right' : ''} ${className}`}>{children}</th>;
const Td = ({ children, r, className = '' }) => <td className={`px-3 py-3 first:pl-5 last:pr-5 ${r ? 'num text-right' : ''} ${className}`}>{children}</td>;
const Etiqueta = ({ children, tono }) => <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${tono === 'warn' ? 'bg-signal/15 text-[#8a5a00]' : tono === 'bad' ? 'bg-[#fdecec] text-danger' : tono === 'ok' ? 'bg-[#e6f4ec] text-ok' : 'bg-paper text-muted'}`}>{children}</span>;
const Linea = ({ t, v, fuerte, sub }) => (
    <div className={`flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0 ${fuerte ? 'font-semibold' : ''}`}>
        <dt className={fuerte ? '' : 'text-muted'}>{t}{sub && <span className="block text-[13px] font-normal text-muted">{sub}</span>}</dt><dd className="num shrink-0">{v}</dd>
    </div>
);
const Titulo = ({ t, d, aside }) => (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4 sm:p-5"><div className="min-w-0"><h3 className="text-[15px] font-semibold">{t}</h3>{d && <p className="mt-0.5 max-w-[68ch] text-[13px] text-muted">{d}</p>}</div>{aside}</div>
);

/* ───────── Régimen: en palabras sencillas ───────── */
function Regimen({ r }) {
    const items = [
        [ShieldCheck, r.especial ? 'Contribuyente especial' : 'Contribuyente ordinario', r.especial ? 'El SENIAT te califica como sujeto pasivo especial.' : 'Declaras el IVA cada mes con tus libros de ventas y compras.'],
        [Percent, `IVA ${n2(r.iva_pct)} %`, 'Se cobra en cada venta de productos gravados. Lo que no es gravado va como exento.'],
        [Landmark, r.cobra_igtf ? `Cobras IGTF ${n2(r.igtf_pct)} %` : 'No cobras IGTF', r.cobra_igtf ? 'Percibes el impuesto cuando te pagan en divisas y lo declaras por quincena, según el calendario del SENIAT.' : 'Solo lo cobran los contribuyentes especiales.'],
        [Receipt, r.recupera_credito ? 'Recuperas el IVA de tus compras' : 'El IVA de tus compras va al costo', r.recupera_credito ? 'Se resta del IVA de tus ventas como crédito fiscal.' : 'No se descuenta: se suma al costo del inventario.'],
    ];
    return (
        <Card className="mb-6"><ul className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
            {items.map(([I, t, d]) => <li key={t} className="flex min-w-0 items-start gap-3 p-4 sm:p-5"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-paper text-muted"><I className="size-[18px]" /></span><div className="min-w-0"><p className="text-sm font-semibold">{t}</p><p className="text-[13px] leading-snug text-muted">{d}</p></div></li>)}
        </ul>
        <p className="border-t border-line px-5 py-3 text-[13px] text-muted">Esto sale de la configuración de tu negocio. Para cambiarlo, ve a <Link href="/configuracion" className="font-medium text-brand hover:underline">Configuración</Link>.</p></Card>
    );
}

/* ───────── Resumen de IVA ───────── */
function Resumen({ d, regimen, mes, ir, retenciones_activas }) {
    const { iva, igtf, avisos, serie } = d; d = { ...d, retenciones_activas };
    const aPagar = iva.a_pagar > 0;
    const max = Math.max(...serie.map((s) => Math.max(s.debito, s.credito)), 1);
    const ok = !avisos.sin_factura && !avisos.huecos.length && !avisos.compras_sin_tasa && !avisos.sin_retencion;
    return (
        <>
            <Card className="mb-6 overflow-hidden">
                <Titulo t={`IVA de ${mesLargo(mes).toLowerCase()}`} d="Cuánto IVA cobraste a tus clientes, cuánto pagaste a tus proveedores y qué te toca declarar." />
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_auto_1.2fr]">
                    <div className="p-5"><p className="text-[13px] text-muted">Débito fiscal</p><p className="num mt-1 text-[26px] font-semibold tracking-[-0.02em]">{bsf(iva.debito)}</p><p className="mt-1 text-[13px] text-muted">IVA de tus ventas · {iva.facturas} factura{iva.facturas === 1 ? '' : 's'}{iva.notas ? ` y ${iva.notas} nota${iva.notas === 1 ? '' : 's'}` : ''}</p></div>
                    <div className="hidden place-items-center px-1 text-2xl text-muted lg:grid" aria-hidden>−</div>
                    <div className="border-t border-line p-5 lg:border-t-0"><p className="text-[13px] text-muted">Crédito fiscal</p><p className="num mt-1 text-[26px] font-semibold tracking-[-0.02em]">{bsf(iva.credito)}</p><p className="mt-1 text-[13px] text-muted">{regimen.recupera_credito ? `IVA de tus compras · ${iva.compras} factura${iva.compras === 1 ? '' : 's'}` : 'No aplica: el IVA de compras va al costo'}</p></div>
                    <div className="hidden place-items-center px-1 text-2xl text-muted lg:grid" aria-hidden>=</div>
                    <div className={`border-t border-line p-5 lg:border-t-0 ${aPagar ? 'bg-brand-50' : ''}`}>
                        <p className="text-[13px] text-muted">{aPagar ? 'IVA a pagar' : 'Excedente de crédito'}</p>
                        <p className="num mt-1 text-[26px] font-semibold tracking-[-0.02em]">{bsf(aPagar ? iva.a_pagar : iva.excedente)}</p>
                        <p className="mt-1 text-[13px] text-muted">{aPagar ? (iva.excedente_anterior ? `Ya descontando ${bsf(iva.excedente_anterior)} que traías del mes anterior.` : 'Es lo que declaras este mes.') : 'No pagas IVA este mes. Esta diferencia pasa al mes siguiente.'}{iva.ret_sufrida > 0 && <span className="block">Ya restando {bsf(iva.ret_sufrida)} que tus clientes te retuvieron.</span>}</p>
                    </div>
                </div>
                <p className="border-t border-line px-5 py-3 text-[13px] text-muted">Cálculo orientativo con tus libros. Confirma la declaración con tu contador.</p>
            </Card>

            <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
                <Card>
                    <Titulo t="De dónde sale" />
                    <dl className="px-5 py-1.5 text-sm">
                        <Linea t="Ventas gravadas (base)" v={bsf(iva.base)} />
                        <Linea t="Ventas exentas" v={bsf(iva.exento)} />
                        <Linea t="Ventas exoneradas" v={bsf(iva.exonerado)} />
                        <Linea t="IVA de notas de crédito" sub="Restan del débito" v={bsf(iva.iva_nc)} />
                        <Linea t="IVA de notas de débito" sub="Suman al débito" v={bsf(iva.iva_nd)} />
                        <Linea t="Compras con IVA" v={bsf(iva.compras_iva)} />
                        {d.retenciones_activas && <Linea t="IVA que tus clientes te retuvieron" sub="Se resta del IVA a pagar" v={bsf(iva.ret_sufrida)} />}
                        {d.retenciones_activas && <Linea t="IVA que retuviste a proveedores" sub="Se entera por quincena, según el calendario del SENIAT" v={bsf(iva.ret_practicada)} />}
                        {regimen.recupera_credito && <Linea t="IVA de compras que va al costo" sub={iva.compras_sin_credito ? `${iva.compras_sin_credito} factura${iva.compras_sin_credito === 1 ? '' : 's'} sin derecho a crédito` : 'Facturas sin derecho a crédito'} v={bsf(iva.al_costo)} />}
                    </dl>
                </Card>
                <Card>
                    <Titulo t="Avisos" d="Lo que conviene ordenar antes de declarar." />
                    {ok ? <p className="flex items-center gap-2 px-5 py-4 text-sm text-ok"><Check className="size-4" />Todo en orden este mes.</p> : (
                        <ul className="divide-y divide-line text-sm">
                            {avisos.sin_factura > 0 && <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#8a5a00]" />{avisos.sin_factura} venta{avisos.sin_factura === 1 ? '' : 's'} sin número de factura fiscal</span><button onClick={() => ir({ vista: 'ventas' })} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">Asignar <ArrowRight className="size-3.5" /></button></li>}
                            {avisos.huecos.length > 0 && <li className="px-5 py-3"><span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#8a5a00]" /><span>Faltan números de venta: {avisos.huecos.map((h) => <span key={h.numero} className="num font-medium">N.º {h.numero} </span>)}<span className="block text-[13px] text-muted">Son operaciones que no se completaron: el sistema no reutiliza el número. Guarda la explicación por si el SENIAT la pide.</span></span></span></li>}
                            {avisos.sin_retencion > 0 && <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#8a5a00]" />{avisos.sin_retencion} compra{avisos.sin_retencion === 1 ? '' : 's'} con IVA sin comprobante de retención</span><button onClick={() => ir({ vista: 'compras' })} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">Registrar <ArrowRight className="size-3.5" /></button></li>}
                            {avisos.compras_sin_tasa > 0 && <li className="flex items-start gap-2 px-5 py-3"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />{avisos.compras_sin_tasa} compra{avisos.compras_sin_tasa === 1 ? '' : 's'} sin tasa de cambio de esa fecha: aparece{avisos.compras_sin_tasa === 1 ? '' : 'n'} en 0 Bs. Registra la tasa en Tasas de cambio.</li>}
                        </ul>
                    )}
                </Card>
            </div>

            {regimen.cobra_igtf && (
                <Card className="mb-6">
                    <Titulo t="IGTF del mes" d="El impuesto que cobraste cuando te pagaron en divisas." aside={<button onClick={() => ir({ vista: 'igtf' })} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">Ver detalle <ArrowRight className="size-3.5" /></button>} />
                    <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                        <div className="p-5"><p className="text-[13px] text-muted">Cobrado a declarar</p><p className="num mt-1 text-xl font-semibold">{bsf(igtf.ves)}</p><p className="num text-[13px] text-muted">{usd(igtf.usd)}</p></div>
                        <div className="p-5"><p className="text-[13px] text-muted">De ventas luego anuladas</p><p className="num mt-1 text-xl font-semibold">{bsf(igtf.anuladas_ves)}</p></div>
                        <div className="p-5"><p className="text-[13px] text-muted">Devuelto a clientes (por reclamar)</p><p className="num mt-1 text-xl font-semibold">{bsf(igtf.revertido_ves)}</p><p className="text-[13px] text-muted">{igtf.reversiones} reversión{igtf.reversiones === 1 ? '' : 'es'}</p></div>
                    </div>
                </Card>
            )}

            <Card>
                <Titulo t="Últimos 12 meses" d="Débito y crédito de cada mes. Si un mes sobra crédito, el excedente se descuenta del siguiente." />
                <div className="relative overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
                    <thead><tr className="border-b border-line text-left text-[13px] text-muted"><Th>Mes</Th><Th r>Débito</Th><Th r>Crédito</Th>{d.retenciones_activas && <Th r>Retenido</Th>}<Th className="w-[22%]"><span className="sr-only">Proporción</span></Th><Th r>Excedente anterior</Th><Th r>A pagar</Th><Th r>Excedente</Th></tr></thead>
                    <tbody>{[...serie.slice(Math.max(0, serie.findIndex((x) => x.debito || x.credito)))].reverse().map((s) => (
                        <tr key={s.mes} className={`border-b border-line last:border-0 ${s.mes === mes ? 'bg-brand-50' : ''}`}>
                            <Td className="font-medium capitalize"><button onClick={() => ir({ mes: s.mes })} className="hover:underline">{mesCorto(s.mes)}</button></Td>
                            <Td r>{n2(s.debito)}</Td><Td r>{n2(s.credito)}</Td>{d.retenciones_activas && <Td r className="text-muted">{s.retenido ? n2(s.retenido) : '—'}</Td>}
                            <Td><div className="space-y-1" aria-hidden><div className="h-1 rounded-full bg-paper"><div className="h-full rounded-full bg-ink" style={{ width: `${(s.debito / max) * 100}%` }} /></div><div className="h-1 rounded-full bg-paper"><div className="h-full rounded-full bg-[#9aa4af]" style={{ width: `${(s.credito / max) * 100}%` }} /></div></div></Td>
                            <Td r className="text-muted">{s.arrastre ? n2(s.arrastre) : '—'}</Td><Td r className="font-semibold">{s.a_pagar ? n2(s.a_pagar) : '—'}</Td><Td r>{s.excedente ? n2(s.excedente) : '—'}</Td>
                        </tr>))}
                    </tbody>
                </table></div>
                <p className="flex items-center gap-4 border-t border-line px-5 py-3 text-[13px] text-muted"><span className="inline-flex items-center gap-1.5"><span className="h-1 w-4 rounded-full bg-ink" />Débito</span><span className="inline-flex items-center gap-1.5"><span className="h-1 w-4 rounded-full bg-[#9aa4af]" />Crédito</span><span className="ml-auto hidden sm:inline">El arrastre cuenta desde el primer mes de la lista.</span></p>
            </Card>
        </>
    );
}

/* ───────── Libro de ventas ───────── */
const TX = { '01': 'Registro', '02': 'Complemento', '03': 'Anulación', '04': 'Ajuste' };
const Tx = ({ v }) => <span title={TX[v]} className="num inline-flex h-6 min-w-7 items-center justify-center rounded border border-line px-1.5 text-xs text-muted">{v}</span>;

function LibroVentas({ libro, abrirFactura, abrirRet, anularRet, activas }) {
    const { filas, totales: t, sin_factura } = libro;
    return (
        <>
            {sin_factura > 0 && <div role="status" className="mb-4 flex items-start gap-3 rounded-2xl border border-line bg-white p-4"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#8a5a00]" /><div><p className="text-[15px] font-semibold">{sin_factura} venta{sin_factura === 1 ? '' : 's'} sin factura fiscal</p><p className="text-[13px] text-muted">Pulsa «Asignar» en la fila para escribir el número de factura y de control. Se fija una sola vez.</p></div></div>}
            <Card>
                <Titulo t="Libro de ventas" d="Facturas y notas del mes, en bolívares a la tasa de cada operación. Las anuladas se ven tachadas y no suman. El número gris bajo la fecha es un código de operación orientativo: 01 registro, 02 complemento (nota de débito), 03 anulación, 04 ajuste (nota de crédito). Las notas de crédito restan y las de débito suman." />
                {filas.length === 0 ? <Vacio icon={BookOpen} titulo="No hay ventas en este mes" texto="Elige otro mes con las flechas de arriba." /> : (
                    <div className="relative overflow-x-auto"><table className="w-full min-w-[1080px] text-sm">
                        <thead><tr className="border-b border-line text-left text-[13px] text-muted"><Th>Op.</Th><Th>Fecha y tipo</Th><Th>Documento</Th><Th>Factura fiscal</Th><Th>Cliente</Th><Th r>Base</Th><Th r>Exento</Th><Th r>IVA</Th><Th r>Retenido</Th><Th r>Total</Th><Th r>IGTF</Th></tr></thead>
                        <tbody>{filas.map((f, i) => {
                            const an = f.estado === 'ANULADA', sinF = f.tipo === 'FACTURA' && !an && !f.factura;
                            return (
                                <tr key={i} className={`border-b border-line last:border-0 ${an ? 'text-muted line-through decoration-[#9aa4af]' : ''}`}>
                                    <Td className="num text-muted">{i + 1}</Td>
                                    <Td className="num whitespace-nowrap">{fechaCorta(f.fecha)}<span className="mt-1 block no-underline"><Tx v={f.tx} /></span></Td>
                                    <Td><span className="font-medium">{TIPO[f.tipo]}</span> <span className="num text-muted">N.º {f.numero}</span>{an && <> <Etiqueta tono="bad">Anulada</Etiqueta></>}{f.afecta && !an && <span className="block text-[13px] text-muted">Afecta a la factura <span className="num">{f.afecta}</span></span>}</Td>
                                    <Td className="num">{f.factura ? <>{f.factura}{f.control && <span className="block text-[13px] text-muted">Control {f.control}</span>}</> : sinF ? <button onClick={() => abrirFactura(f)} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand no-underline hover:underline">Asignar</button> : <span className="text-muted">{f.control ? `Control ${f.control}` : '—'}</span>}</Td>
                                    <Td>{f.cliente}{f.rif && <span className="num block text-[13px] text-muted">{f.rif}</span>}</Td>
                                    <Td r>{n2(f.base)}</Td><Td r>{f.exento || f.exonerado ? n2(f.exento + f.exonerado) : '—'}</Td><Td r>{n2(f.iva)}</Td>
                                    <Td r className="no-underline">{f.ret ? <><span>{n2(f.ret)}</span><span className="block text-[13px] text-muted">Comp. {f.comprobante} {!an && <button onClick={() => anularRet({ id: f.ret_id, comprobante: f.comprobante })} className="font-medium text-brand hover:underline">Anular</button>}</span></> : activas && f.tipo === 'FACTURA' && !an && f.iva > 0 ? <button onClick={() => abrirRet({ sentido: 'VENTA', documento_id: f.venta_id, titulo: `Factura ${f.factura || `N.º ${f.numero}`}`, tercero: f.cliente, iva: f.iva, fecha: f.fecha })} className="text-[13px] font-medium text-brand hover:underline">Registrar</button> : <span className="text-muted">—</span>}</Td>
                                    <Td r className="font-semibold">{n2(f.total)}</Td><Td r className="text-muted">{f.igtf ? n2(f.igtf) : '—'}</Td>
                                </tr>);
                        })}</tbody>
                        <tfoot><tr className="border-t border-ink font-semibold"><Td /><Td className="whitespace-nowrap">Total del mes</Td><Td>{t.facturas} facturas · {t.notas} notas</Td><Td /><Td /><Td r>{n2(t.base)}</Td><Td r>{n2(t.exento + t.exonerado)}</Td><Td r>{n2(t.iva)}</Td><Td r>{n2(t.retenido)}</Td><Td r>{n2(t.total)}</Td><Td r>{n2(t.igtf)}</Td></tr></tfoot>
                    </table></div>
                )}
                {!activas && <p className="border-t border-line px-5 py-3 text-[13px] text-muted">Para anotar el IVA que te retienen tus clientes, ejecuta <span className="num">08_retenciones_iva.sql</span> en tu base de datos.</p>}
            </Card>
        </>
    );
}

/* ───────── Libro de compras ───────── */
function LibroCompras({ libro, regimen, activas, abrirRet, anularRet, abrirPlanilla }) {
    const { filas, totales: t } = libro;
    return (
        <Card>
            <Titulo t="Libro de compras" d={(regimen.recupera_credito ? 'Facturas de tus proveedores. El IVA marcado como crédito fiscal se resta del IVA de tus ventas; el que no, pasa al costo.' : 'Facturas de tus proveedores. En tu régimen el IVA de las compras pasa al costo del inventario.') + ' Las importaciones muestran su planilla de aduana.'} />
            {filas.length === 0 ? <Vacio icon={ShoppingBag} titulo="No hay compras en este mes" texto="Las facturas de proveedor se registran en el módulo Compras." /> : (
                <div className="relative overflow-x-auto"><table className="w-full min-w-[1040px] text-sm">
                    <thead><tr className="border-b border-line text-left text-[13px] text-muted"><Th>Op.</Th><Th>Fecha y tipo</Th><Th>Proveedor</Th><Th>Factura o planilla</Th><Th r>Base</Th><Th r>Exento</Th><Th r>IVA</Th><Th r>Crédito fiscal</Th><Th r>Retenido</Th><Th r>Total</Th></tr></thead>
                    <tbody>{filas.map((f, i) => {
                        const an = f.estado === 'ANULADA';
                        return (
                            <tr key={f.id} className={`border-b border-line last:border-0 ${an ? 'text-muted line-through decoration-[#9aa4af]' : ''}`}>
                                <Td className="num text-muted">{i + 1}</Td>
                                <Td className="num whitespace-nowrap">{fechaCorta(f.fecha)}<span className="mt-1 block no-underline"><Tx v={f.tx} /></span></Td>
                                <Td>{f.proveedor}<span className="num block text-[13px] text-muted">{f.rif}</span></Td>
                                <Td className="num">{f.factura}{f.control && <span className="block text-[13px] text-muted">Control {f.control}</span>}
                                    {f.planilla && <span className="block text-[13px] text-muted no-underline"><Ship className="mr-1 inline size-3.5" />Planilla {f.planilla}{f.aduana ? ` · ${f.aduana}` : ''}</span>}
                                    <span className="mt-0.5 flex flex-wrap items-center gap-1 no-underline">{an && <Etiqueta tono="bad">Anulada</Etiqueta>}{!an && !f.credito && <Etiqueta tono="warn">IVA al costo</Etiqueta>}{f.sin_tasa && <Etiqueta tono="bad">Sin tasa</Etiqueta>}{f.moneda !== 'VES' && <Etiqueta>{f.moneda}</Etiqueta>}
                                        {activas && !an && !f.planilla && f.moneda !== 'VES' && <button onClick={() => abrirPlanilla(f)} className="text-[13px] font-medium text-brand hover:underline">Agregar planilla</button>}</span></Td>
                                <Td r>{n2(f.base)}</Td><Td r>{f.exento ? n2(f.exento) : '—'}</Td><Td r>{n2(f.iva)}</Td><Td r className="font-semibold">{f.cf ? n2(f.cf) : '—'}</Td>
                                <Td r className="no-underline">{f.ret ? <><span>{n2(f.ret)}</span><span className="block text-[13px] text-muted">Comp. {f.comprobante} {!an && <button onClick={() => anularRet({ id: f.ret_id, comprobante: f.comprobante })} className="font-medium text-brand hover:underline">Anular</button>}</span></> : activas && regimen.especial && !an && !f.planilla && f.iva > 0 ? <button onClick={() => abrirRet({ sentido: 'COMPRA', documento_id: f.id, titulo: `Factura ${f.factura}`, tercero: f.proveedor, iva: f.iva, fecha: f.fecha })} className="text-[13px] font-medium text-brand hover:underline">Retener</button> : <span className="text-muted">—</span>}</Td>
                                <Td r>{n2(f.total)}</Td>
                            </tr>);
                    })}</tbody>
                    <tfoot><tr className="border-t border-ink font-semibold"><Td /><Td className="whitespace-nowrap">Total del mes</Td><Td>{t.facturas} factura{t.facturas === 1 ? '' : 's'}</Td><Td /><Td r>{n2(t.base)}</Td><Td r>{n2(t.exento)}</Td><Td r>{n2(t.iva)}</Td><Td r>{n2(t.cf)}</Td><Td r>{n2(t.retenido)}</Td><Td r>{n2(t.total)}</Td></tr></tfoot>
                </table></div>
            )}
            {t.al_costo > 0 && <p className="border-t border-line px-5 py-3 text-[13px] text-muted">{bsf(t.al_costo)} de IVA no se puede descontar este mes: se sumó al costo de esa mercancía.</p>}
            {!activas ? <p className="border-t border-line px-5 py-3 text-[13px] text-muted">Para registrar retenciones a proveedores y planillas de importación, ejecuta <span className="num">08_retenciones_iva.sql</span> en tu base de datos.</p>
                : !regimen.especial && <p className="border-t border-line px-5 py-3 text-[13px] text-muted">Solo los contribuyentes especiales retienen IVA a sus proveedores, por eso no ves el botón «Retener».</p>}
        </Card>
    );
}

/* ───────── Retenciones ───────── */
function Retenciones({ d, activas, anular, regimen, mes, hoy }) {
    if (!activas) return (
        <Card><Vacio icon={HandCoins} titulo="Falta activar las retenciones" texto="Ejecuta el archivo 08_retenciones_iva.sql en tu base de datos. Agrega las tablas para guardar el IVA retenido con su comprobante y la planilla de importación; no cambia nada de lo que ya tienes." /></Card>
    );
    const t = d.totales;
    return (
        <>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Kpi icon={HandCoins} titulo="Te retuvieron tus clientes" valor={bsf(t.sufrida)} detalle="Se resta del IVA que pagas" />
                <Kpi icon={Stamp} titulo="Retuviste a proveedores" valor={bsf(t.practicada)} detalle={regimen.especial ? 'Se enteran por quincena (1-15 y 16-fin de mes)' : 'Solo aplica a contribuyentes especiales'} />
                <Kpi icon={Receipt} titulo="Comprobantes del mes" valor={n0(t.cantidad)} detalle="Sin contar los anulados" />
            </div>
            {(regimen.especial || d.quincenas?.filas?.length > 0) && <Quincenas inicial={d.quincenas} mes={mes} hoy={hoy} />}
            <Card>
                <Titulo t="Comprobantes de retención" d="Se registran desde el libro de compras («Retener») o el de ventas («Registrar»). Un comprobante no se edita: si hay un error, anúlalo y registra otro." />
                {d.filas.length === 0 ? <Vacio icon={HandCoins} titulo="No hay retenciones en este mes" texto="Cuando retengas IVA a un proveedor, o un cliente te retenga a ti, el comprobante aparece aquí." /> : (
                    <div className="relative overflow-x-auto"><table className="w-full min-w-[860px] text-sm">
                        <thead><tr className="border-b border-line text-left text-[13px] text-muted"><Th>Fecha</Th><Th>Comprobante</Th><Th>Quién retiene</Th><Th>Factura</Th><Th r>%</Th><Th r>IVA de la factura</Th><Th r>IVA retenido</Th><Th><span className="sr-only">Acciones</span></Th></tr></thead>
                        <tbody>{d.filas.map((x) => {
                            const an = x.estado === 'ANULADA';
                            return (
                                <tr key={x.id} className={`border-b border-line last:border-0 ${an ? 'text-muted line-through decoration-[#9aa4af]' : ''}`}>
                                    <Td className="num whitespace-nowrap">{fechaCorta(x.fecha)}</Td>
                                    <Td className="num font-medium">{x.comprobante}{an && <> <Etiqueta tono="bad">Anulado</Etiqueta></>}</Td>
                                    <Td>{x.sentido === 'COMPRA' ? 'Tú retuviste a' : 'Te retuvo'}<span className="block text-[13px] text-muted">{x.tercero}</span></Td>
                                    <Td className="num">{x.documento}</Td><Td r>{n0(x.pct)}</Td><Td r>{n2(x.iva)}</Td><Td r className="font-semibold">{n2(x.retenido)}</Td>
                                    <Td r className="no-underline">{!an && <button onClick={() => anular({ id: x.id, comprobante: x.comprobante })} className="text-[13px] font-medium text-brand hover:underline">Anular</button>}</Td>
                                </tr>);
                        })}</tbody>
                        <tfoot><tr className="border-t border-ink font-semibold"><Td>Total activo</Td><Td /><Td /><Td /><Td /><Td /><Td r>{n2(t.sufrida + t.practicada)}</Td><Td /></tr></tfoot>
                    </table></div>)}
            </Card>
            <p className="mt-4 text-[13px] text-muted">Según la providencia SNAT/2025/000054: la retención es del 75 % del IVA, o del 100 % si el IVA no está discriminado, la factura no cumple los requisitos o el proveedor no tiene RIF. Entrega el comprobante en los 2 primeros días hábiles del período siguiente y entera por quincena (1 al 15 y 16 al fin de mes) tras declarar tus compras en el Portal Fiscal. Confirma el texto vigente con tu contador.</p>
        </>
    );
}

/* ───────── IGTF ───────── */
function Igtf({ d, regimen }) {
    if (!regimen.cobra_igtf) return (
        <Card><Vacio icon={Landmark} titulo="Tu negocio no cobra IGTF" texto={regimen.especial ? 'Tienes la opción apagada en Configuración. Si el SENIAT te designó agente de percepción, enciéndela allí para empezar a cobrarlo.' : 'El IGTF lo cobran los contribuyentes especiales cuando reciben pagos en divisas. Si tu negocio lo es, cambia el régimen en Configuración.'}><Link href="/configuracion" className="inline-flex h-11 items-center rounded-lg border border-line px-5 text-[15px] font-semibold hover:bg-paper">Ir a Configuración</Link></Vacio></Card>
    );
    const t = d.totales;
    return (
        <>
            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Kpi icon={Landmark} titulo="Pagos en divisas" valor={usd(t.base_usd)} detalle="Base sobre la que se cobró" />
                <Kpi icon={Percent} titulo={`IGTF cobrado (${n2(regimen.igtf_pct)} %)`} valor={bsf(t.igtf_ves)} detalle={usd(t.igtf_usd)} />
                <Kpi icon={Receipt} titulo="Devuelto por anulaciones" valor={bsf(t.rev_ves)} detalle={usd(t.rev_usd)} tono={t.rev_ves ? 'warn' : undefined} />
                <Kpi icon={Stamp} titulo="A declarar" valor={bsf(t.igtf_ves)} detalle="Todo lo cobrado, incluso lo devuelto" />
            </div>
            <Card className="mb-6">
                <Titulo t="IGTF por día" d="Lo cobrado en cada día en pagos con divisas, a la tasa del momento de cada pago." />
                {d.dias.length === 0 ? <Vacio icon={Landmark} titulo="No hubo pagos con IGTF este mes" texto="Cuando alguien pague en dólares, euros o pesos, el impuesto aparece aquí." /> : (
                    <div className="relative overflow-x-auto"><table className="w-full min-w-[620px] text-sm">
                        <thead><tr className="border-b border-line text-left text-[13px] text-muted"><Th>Día</Th><Th r>Base en divisas (USD)</Th><Th r>IGTF USD</Th><Th r>IGTF Bs</Th><Th r>De ventas anuladas (Bs)</Th></tr></thead>
                        <tbody>{d.dias.map((x) => <tr key={x.fecha} className="border-b border-line last:border-0"><Td className="num">{fechaCorta(x.fecha)}</Td><Td r>{n2(x.base_usd)}</Td><Td r>{n2(x.igtf_usd)}</Td><Td r className="font-semibold">{n2(x.igtf_ves)}</Td><Td r className="text-muted">{x.anul_ves ? n2(x.anul_ves) : '—'}</Td></tr>)}</tbody>
                        <tfoot><tr className="border-t border-ink font-semibold"><Td>Total del mes</Td><Td r>{n2(t.base_usd)}</Td><Td r>{n2(t.igtf_usd)}</Td><Td r>{n2(t.igtf_ves)}</Td><Td r /></tr></tfoot>
                    </table></div>)}
            </Card>
            {d.reversiones.length > 0 && (
                <Card className="mb-6">
                    <Titulo t="IGTF devuelto a clientes" d="Cuando se anula una venta pagada en divisas, el sistema deja constancia del IGTF devuelto. No reduce lo que declaras: se reclama aparte al SENIAT." />
                    <ul>{d.reversiones.map((x) => <li key={`${x.numero}-${x.igtf_ves}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-3 text-sm last:border-0"><div><p className="num font-medium">Venta N.º {x.numero} · {fechaCorta(x.fecha)}</p><p className="text-[13px] text-muted">{x.motivo}</p></div><span className="num">{bsf(x.igtf_ves)} <span className="text-muted">({usd(x.igtf_usd)})</span></span></li>)}</ul>
                </Card>
            )}
            <p className="text-[13px] text-muted">La base del IGTF es {regimen.igtf_base === 'CON_IVA' ? 'lo pagado en divisas, con el IVA incluido' : 'lo pagado en divisas sin IVA'}. Confirma esta regla con tu contador.</p>
        </>
    );
}

/* ───────── Notas ───────── */
function Notas({ d, nueva }) {
    return (
        <Card>
            <Titulo t="Notas de crédito y débito" d="Corrigen una factura ya emitida. La de crédito resta (devoluciones, descuentos) y la de débito suma (cobros adicionales). No mueven el inventario." aside={<Button onClick={nueva}><Plus className="size-4" />Nueva nota</Button>} />
            {d.filas.length === 0 ? <Vacio icon={FilePlus2} titulo="No hay notas en este mes" texto="Si te devuelven un repuesto o debes ajustar una factura, registra aquí la nota.">
                <Button onClick={nueva}><Plus className="size-4" />Nueva nota</Button></Vacio> : (
                <div className="relative overflow-x-auto"><table className="w-full min-w-[860px] text-sm">
                    <thead><tr className="border-b border-line text-left text-[13px] text-muted"><Th>Fecha</Th><Th>Nota</Th><Th>Afecta a</Th><Th>Motivo</Th><Th r>Base</Th><Th r>IVA</Th><Th r>Total</Th></tr></thead>
                    <tbody>{d.filas.map((n) => {
                        const c = n.tipo === 'C', s = c ? -1 : 1;
                        return <tr key={n.id} className="border-b border-line last:border-0"><Td className="num whitespace-nowrap">{fechaCorta(n.fecha)}</Td><Td><Etiqueta tono={c ? 'warn' : undefined}>{c ? 'Crédito' : 'Débito'}</Etiqueta> <span className="num font-medium">{n.numero}</span>{n.control && <span className="num block text-[13px] text-muted">Control {n.control}</span>}</Td>
                            <Td>Factura <span className="num">{n.afecta}</span><span className="block text-[13px] text-muted">{n.cliente}</span></Td><Td className="max-w-[260px] text-muted">{n.motivo}</Td>
                            <Td r>{n2(s * n.base)}</Td><Td r>{n2(s * n.iva)}</Td><Td r className="font-semibold">{n2(s * n.total)}</Td></tr>;
                    })}</tbody>
                </table></div>)}
        </Card>
    );
}

/* ───────── Alícuotas ───────── */
function Alicuotas({ d, regimen, cambiar }) {
    const grupos = [['IVA_GENERAL', 'IVA general', 'Se aplica a la venta de los productos gravados.'], ['IGTF_DIVISAS', 'IGTF en divisas', 'Se cobra sobre los pagos en dólares, euros o pesos.']];
    return (
        <>
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                {grupos.map(([cod, t, desc]) => {
                    const vig = d.filas.find((f) => f.codigo === cod && !f.hasta);
                    return (
                        <Card key={cod} className="p-5">
                            <div className="flex items-start justify-between gap-3"><div><p className="text-[13px] text-muted">{t}</p><p className="num mt-1 text-[32px] font-semibold leading-none tracking-[-0.02em]">{vig ? `${n2(vig.pct)} %` : '—'}</p></div><Button onClick={() => cambiar(cod, t, vig)} className="!h-10 !px-4 !text-sm">Cambiar</Button></div>
                            <p className="mt-3 text-[13px] text-muted">{desc}</p>{vig && <p className="mt-1 text-[13px] text-muted">Vigente desde {fechaCorta(vig.desde)}.</p>}
                        </Card>);
                })}
            </div>
            <Card className="mb-4">
                <Titulo t="Historial de cambios" d="Cada venta guarda la alícuota que tenía el día que se hizo, así que un cambio nuevo nunca altera facturas anteriores." />
                <div className="relative overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
                    <thead><tr className="border-b border-line text-left text-[13px] text-muted"><Th>Impuesto</Th><Th r>%</Th><Th>Desde</Th><Th>Hasta</Th><Th>Fuente o nota</Th></tr></thead>
                    <tbody>{d.filas.map((f) => <tr key={f.id} className="border-b border-line last:border-0"><Td className="font-medium">{f.codigo === 'IVA_GENERAL' ? 'IVA general' : 'IGTF en divisas'}</Td><Td r>{n2(f.pct)}</Td><Td className="num">{fechaCorta(f.desde)}</Td><Td className="num">{f.hasta ? fechaCorta(f.hasta) : <Etiqueta tono="ok">Vigente</Etiqueta>}</Td><Td className="text-muted">{f.nota}{f.por && <span className="block text-[13px]">Registró {f.por}</span>}</Td></tr>)}</tbody>
                </table></div>
            </Card>
            <p className="text-[13px] text-muted">Un cambio solo rige hacia adelante. Si el Ejecutivo publica una alícuota nueva, anota el decreto como fuente.</p>
        </>
    );
}

/* ───────── Ventanas ───────── */
function ModalFactura({ f, cerrar }) {
    const [factura, setFactura] = useState(''); const [control, setControl] = useState(''); const [er, setEr] = useState({}); const [env, setEnv] = useState(false);
    const guardar = () => {
        if (!factura.trim()) return setEr({ factura: 'Escribe el número de factura.' });
        router.post(`/libros-fiscales/ventas/${f.venta_id}/factura`, { factura: factura.trim(), control: control.trim() || null }, { preserveScroll: true, onStart: () => setEnv(true), onFinish: () => setEnv(false), onSuccess: cerrar, onError: setEr });
    };
    return (
        <Modal titulo="Asignar factura fiscal" subtitulo={`Venta N.º ${f.numero} · ${f.cliente}. Se fija una sola vez y luego no se puede cambiar.`} cerrar={cerrar} onSubmit={guardar} enviando={env} ok="Asignar factura">
            <Field label="Número de factura" value={factura} onChange={(e) => setFactura(e.target.value)} error={er.factura} autoFocus />
            <Field label="Número de control (opcional)" value={control} onChange={(e) => setControl(e.target.value)} error={er.control} />
        </Modal>
    );
}

function ModalRetencion({ r, hoy, especial, cerrar }) {
    const compra = r.sentido === 'COMPRA';
    const [comprobante, setComprobante] = useState(''); const [fecha, setFecha] = useState(hoy); const [pct, setPct] = useState(75);
    const [er, setEr] = useState({}); const [env, setEnv] = useState(false);
    const retenido = Math.round(r.iva * pct) / 100;
    const guardar = () => {
        const e = {}; const c = comprobante.trim();
        if (!compra && !c) e.comprobante = 'Escribe el número que te dio el cliente.';
        if (compra && c && !/^\d{4}(0[1-9]|1[0-2])\d{8}$/.test(c)) e.comprobante = 'Son 14 dígitos: año, mes y 8 de secuencial. Ejemplo: 20261100000001.';
        if (!fecha || fecha < r.fecha) e.fecha = 'No puede ser anterior a la factura.';
        setEr(e); if (Object.keys(e).length) return;
        router.post('/libros-fiscales/retenciones', { sentido: r.sentido, documento_id: r.documento_id, comprobante: c || null, fecha, porcentaje: pct }, { preserveScroll: true, onStart: () => setEnv(true), onFinish: () => setEnv(false), onSuccess: cerrar, onError: setEr });
    };
    return (
        <Modal titulo={compra ? 'Retener IVA a un proveedor' : 'Registrar IVA que te retuvieron'} subtitulo={`${r.titulo} · ${r.tercero.replace(/\.$/, '')}. IVA de la factura: ${bsf(r.iva)}`} cerrar={cerrar} onSubmit={guardar} enviando={env} ok="Registrar retención">
            <Field label={compra ? 'Número de tu comprobante (opcional)' : 'Número del comprobante que te dio el cliente'} hint={compra ? 'Si lo dejas vacío, el sistema asigna el siguiente: año, mes y secuencial de 8 dígitos.' : undefined} value={comprobante} onChange={(e) => setComprobante(e.target.value)} error={er.comprobante} autoFocus />
            <Field label="Fecha del comprobante" type="date" min={r.fecha} max={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} error={er.fecha} forceFloat />
            <div role="radiogroup" aria-label="Porcentaje retenido" className="grid grid-cols-2 gap-2">
                {[[75, 'Regla general'], [100, 'IVA sin discriminar, factura incompleta o proveedor sin RIF']].map(([v, t]) => <button type="button" key={v} role="radio" aria-checked={pct === v} onClick={() => setPct(v)} className={`rounded-xl border p-3 text-left ${pct === v ? 'border-brand bg-brand-50 ring-1 ring-brand' : 'border-line hover:border-[#b9c1ca]'}`}><p className="text-sm font-semibold">{v} % del IVA</p><p className="text-[13px] text-muted">{t}</p></button>)}
            </div>
            <p className="num rounded-lg bg-paper px-3 py-2 text-[13px] text-muted">IVA retenido: <span className="font-semibold text-text">{bsf(retenido)}</span></p>
            {compra && <p className="text-[13px] text-muted">El comprobante se entrega al proveedor a más tardar en los 2 primeros días hábiles del período siguiente.</p>}
            {!compra && especial && <p role="note" className="rounded-lg border border-line px-3 py-2 text-[13px] text-[#8a5a00]">Los agentes de retención retienen a contribuyentes ordinarios. Tu negocio figura como contribuyente especial: confirma que este cliente sí debía retenerte.</p>}
            {er.documento_id && <p role="alert" className="text-[13px] text-danger">{er.documento_id}</p>}
        </Modal>
    );
}

function ModalAnularRet({ r, cerrar }) {
    const [motivo, setMotivo] = useState(''); const [er, setEr] = useState({}); const [env, setEnv] = useState(false);
    const guardar = () => {
        if (motivo.trim().length < 3) return setEr({ motivo: 'Cuenta brevemente el motivo.' });
        router.post(`/libros-fiscales/retenciones/${r.id}/anular`, { motivo: motivo.trim() }, { preserveScroll: true, onStart: () => setEnv(true), onFinish: () => setEnv(false), onSuccess: cerrar, onError: setEr });
    };
    return (
        <Modal titulo="Anular retención" subtitulo={`Comprobante ${r.comprobante}. Queda en el historial como anulado y deja de restar. Después puedes registrar otro.`} cerrar={cerrar} onSubmit={guardar} enviando={env} ok="Anular retención" peligro>
            <Field label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} error={er.motivo} autoFocus />
        </Modal>
    );
}

function ModalPlanilla({ c, hoy, cerrar }) {
    const [planilla, setPlanilla] = useState(''); const [fecha, setFecha] = useState(hoy < c.fecha ? c.fecha : hoy); const [aduana, setAduana] = useState(''); const [er, setEr] = useState({}); const [env, setEnv] = useState(false);
    const guardar = () => {
        if (!planilla.trim()) return setEr({ planilla: 'Escribe el número de la planilla.' });
        router.post(`/libros-fiscales/compras/${c.id}/importacion`, { planilla: planilla.trim(), fecha, aduana: aduana.trim() || null }, { preserveScroll: true, onStart: () => setEnv(true), onFinish: () => setEnv(false), onSuccess: cerrar, onError: setEr });
    };
    return (
        <Modal titulo="Planilla de importación" subtitulo={`${c.proveedor} · factura ${c.factura}. Se guarda una sola vez y el libro de compras la muestra junto a la factura.`} cerrar={cerrar} onSubmit={guardar} enviando={env} ok="Guardar planilla">
            <Field label="Número de planilla" value={planilla} onChange={(e) => setPlanilla(e.target.value)} error={er.planilla} autoFocus />
            <div className="grid grid-cols-2 gap-3"><Field label="Fecha de la planilla" type="date" max={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} forceFloat /><Field label="Aduana (opcional)" value={aduana} onChange={(e) => setAduana(e.target.value)} /></div>
        </Modal>
    );
}

function ModalNota({ hoy, cerrar }) {
    const [tipo, setTipo] = useState('C'); const [q, setQ] = useState(''); const [res, setRes] = useState([]); const [venta, setVenta] = useState(null);
    const [numero, setNumero] = useState(''); const [control, setControl] = useState(''); const [fecha, setFecha] = useState(hoy); const [base, setBase] = useState(''); const [motivo, setMotivo] = useState(''); const [dev, setDev] = useState({ devuelve: false, productos: [], error: null });
    const [din, setDin] = useState({ devuelve: false, devolucion: null, error: null });
    const [er, setEr] = useState({}); const [env, setEnv] = useState(false);
    useEffect(() => { if (venta) return; const t = setTimeout(() => fetch(`/libros-fiscales/ventas?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } }).then((r) => r.json()).then(setRes).catch(() => setRes([])), 200); return () => clearTimeout(t); }, [q, venta]);
    const b = num(base), iva = venta && !isNaN(b) ? Math.round(b * venta.iva_pct) / 100 : 0;
    const guardar = () => {
        const e = {};
        if (!venta) e.venta = 'Elige la venta a la que corresponde la nota.';
        if (!numero.trim()) e.numero = 'Escribe el número de la nota.';
        if (isNaN(b) || b <= 0) e.base = 'Escribe un monto mayor que cero.';
        if (motivo.trim().length < 3) e.motivo = 'Cuenta brevemente el motivo.';
        if (dev.devuelve && dev.error) e.productos = dev.error;
        if (din.devuelve && din.error) e.dinero = din.error;
        setEr(e); if (Object.keys(e).length) return;
        router.post('/libros-fiscales/notas', { tipo, venta_id: venta.id, numero: numero.trim(), control: control.trim() || null, fecha, base: b, motivo: motivo.trim(), devuelve_inventario: dev.devuelve, productos: dev.devuelve ? dev.productos : [], devolucion: din.devuelve ? din.devolucion : null }, { preserveScroll: true, onStart: () => setEnv(true), onFinish: () => setEnv(false), onSuccess: cerrar, onError: setEr });
    };
    return (
        <Modal titulo="Nueva nota" subtitulo="Corrige una factura ya emitida. El IVA se calcula con la alícuota que tenía esa venta." cerrar={cerrar} onSubmit={guardar} enviando={env} ok="Registrar nota" ancho="max-w-[520px]">
            <div role="radiogroup" aria-label="Tipo de nota" className="grid grid-cols-2 gap-2">
                {[['C', 'Nota de crédito', 'Resta: devolución o descuento'], ['D', 'Nota de débito', 'Suma: cobro adicional']].map(([k, t, d]) => <button type="button" key={k} role="radio" aria-checked={tipo === k} onClick={() => setTipo(k)} className={`rounded-xl border p-3 text-left ${tipo === k ? 'border-brand bg-brand-50 ring-1 ring-brand' : 'border-line hover:border-[#b9c1ca]'}`}><p className="text-sm font-semibold">{t}</p><p className="text-[13px] text-muted">{d}</p></button>)}
            </div>
            {venta ? (
                <div className="flex items-start justify-between gap-3 rounded-lg border border-line bg-paper p-3 text-sm"><div><p className="font-semibold">Venta N.º {venta.numero}{venta.factura ? ` · Factura ${venta.factura}` : ''}</p><p className="text-[13px] text-muted">{venta.cliente} · {fechaCorta(venta.fecha)} · IVA {n2(venta.iva_pct)} %</p></div><button type="button" onClick={() => { setVenta(null); setQ(''); }} className="text-[13px] font-medium text-brand hover:underline">Cambiar</button></div>
            ) : (
                <div><Field label="Buscar venta (número, factura o cliente)" value={q} onChange={(e) => setQ(e.target.value)} error={er.venta} />
                    <ul className="mt-2 max-h-44 divide-y divide-line overflow-y-auto rounded-lg border border-line text-sm">{res.length === 0 ? <li className="px-3 py-3 text-[13px] text-muted">No se encontraron ventas.</li> : res.map((x) => <li key={x.id}><button type="button" onClick={() => { setVenta(x); setEr({}); }} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-paper"><span><span className="num font-medium">N.º {x.numero}</span>{x.factura && <span className="num text-muted"> · {x.factura}</span>}<span className="block text-[13px] text-muted">{x.cliente} · {fechaCorta(x.fecha)}</span></span><span className="num text-[13px] text-muted">{bsf(x.total_ves)}</span></button></li>)}</ul></div>
            )}
            <div className="grid grid-cols-2 gap-3"><Field label="Número de la nota" value={numero} onChange={(e) => setNumero(e.target.value)} error={er.numero} /><Field label="Número de control (opcional)" value={control} onChange={(e) => setControl(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3"><Field label="Fecha" type="date" max={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} forceFloat /><Field label="Monto sin IVA (Bs)" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} error={er.base} /></div>
            {venta && !isNaN(b) && b > 0 && <p className="num rounded-lg bg-paper px-3 py-2 text-[13px] text-muted">IVA {n2(venta.iva_pct)} %: {bsf(iva)} · Total de la nota: <span className="font-semibold text-text">{bsf(b + iva)}</span></p>}
            {venta && <DevolucionNota ventaId={venta.id} tipo={tipo} base={base} ivaPct={venta.iva_pct} onChange={setDev} />}
            {venta && <DevolucionDinero tipo={tipo} onChange={setDin} />}
            {er.dinero && <p role="alert" className="text-[13px] text-danger">{er.dinero}</p>}
            {er.productos && <p role="alert" className="text-[13px] text-danger">{er.productos}</p>}
            <Field label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} error={er.motivo} />
            {er.general && <p role="alert" className="text-[13px] text-danger">{er.general}</p>}
        </Modal>
    );
}

function ModalAlicuota({ a, hoy, cerrar }) {
    const [pct, setPct] = useState(''); const [desde, setDesde] = useState(hoy); const [nota, setNota] = useState(''); const [er, setEr] = useState({}); const [env, setEnv] = useState(false);
    const guardar = () => {
        const p = num(pct), e = {};
        if (isNaN(p) || p < 0 || p > 100) e.pct = 'Escribe un porcentaje entre 0 y 100.';
        if (!desde || desde < hoy) e.desde = 'La fecha no puede ser anterior a hoy.';
        if (nota.trim().length < 3) e.nota = 'Indica el decreto o la fuente del cambio.';
        setEr(e); if (Object.keys(e).length) return;
        router.put('/libros-fiscales/alicuotas', { codigo: a.cod, pct: p, desde, nota: nota.trim() }, { preserveScroll: true, onStart: () => setEnv(true), onFinish: () => setEnv(false), onSuccess: cerrar, onError: setEr });
    };
    return (
        <Modal titulo={`Cambiar ${a.t}`} subtitulo={a.vig ? `Hoy es ${n2(a.vig.pct)} % desde ${fechaCorta(a.vig.desde)}. El cambio rige hacia adelante: las ventas ya hechas conservan la alícuota con la que se emitieron.` : ''} cerrar={cerrar} onSubmit={guardar} enviando={env} ok="Guardar cambio">
            <div className="grid grid-cols-2 gap-3"><Field label="Nuevo porcentaje" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} error={er.pct} autoFocus /><Field label="Rige desde" type="date" min={hoy} value={desde} onChange={(e) => setDesde(e.target.value)} error={er.desde} forceFloat /></div>
            <Field label="Decreto o fuente" value={nota} onChange={(e) => setNota(e.target.value)} error={er.nota} hint="Ejemplo: Gaceta Oficial N.º …" />
        </Modal>
    );
}

/* ───────── Página ───────── */
export default function LibrosFiscales(p) {
    const { negocio, usuario, fecha_larga, stock_bajo, tasa_usd, vista, mes, hoy, regimen, emisor } = p;
    const [factura, setFactura] = useState(null); const [ret, setRet] = useState(null); const [anRet, setAnRet] = useState(null); const [plan, setPlan] = useState(null); const [nota, setNota] = useState(false); const [alic, setAlic] = useState(null); const [pdf, setPdf] = useState(false);
    const [zip, setZip] = useState(false); const [errZip, setErrZip] = useState(''); const [verCierre, setVerCierre] = useState(false);
    const [cierre, cargandoCierre, recargarCierre] = useCierre(mes, vista !== 'alicuotas');
    const paquete = async () => {
        setZip(true); setErrZip('');
        try {
            const paq = await http('GET', `/libros-fiscales/paquete?mes=${mes}`);
            const m = await import('../../lib/paqueteFiscal'); const z = await import('../../lib/zip');
            z.descargar(await m.construirPaquete(paq, mesLargo(mes)), `Declaracion_${mes}.zip`);
        } catch (e) { setErrZip('No se pudo preparar el paquete. Inténtalo de nuevo.'); } finally { setZip(false); }
    };
    const ir = (c) => router.get('/libros-fiscales', { vista, mes, ...c }, { preserveScroll: true, preserveState: false });
    const actual = vista === 'igtf' ? '/libros-fiscales?vista=igtf' : '/libros-fiscales';
    const periodo = mesLargo(mes);
    const exportable = ['resumen', 'ventas', 'compras', 'retenciones', 'igtf', 'notas'].includes(vista) && !(vista === 'igtf' && !regimen.cobra_igtf) && !(vista === 'retenciones' && !p.retenciones_activas);

    /* Columnas del libro: las usan la tabla de exportación (PDF y CSV). */
    const exportar = async (tipo) => {
        setPdf(true);
        try {
            const lib = await import('../../lib/pdfLibro');
            const nombre = (b) => `${b}-${mes}`;
            const cfg = configuracionLibro(vista, p, mes);
            if (tipo === 'csv') return cfg.csv ? lib.csv(`${cfg.file}.csv`, cfg.csv.columnas, cfg.csv.filas, cfg.csv.totales) : lib.csv(`${cfg.file}.csv`, cfg.columnas, cfg.filas, cfg.totales);
            const doc = await lib.construirPdfLibro({ emisor, titulo: cfg.titulo, periodo, columnas: cfg.columnas, filas: cfg.filas, totales: cfg.totales, anuladas: cfg.anuladas, notas: cfg.notas });
            doc.save(`${cfg.file}.pdf`);
        } finally { setPdf(false); }
    };

    return (
        <AppLayout actual={actual} titulo="Libros fiscales" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Libros fiscales" />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Libros fiscales</h2><p className="mt-1 max-w-[62ch] text-[15px] text-muted">Tus libros de ventas y compras, el IVA que debes declarar y el IGTF, listos mes a mes.</p></div>
                <div className="flex flex-wrap items-center gap-3">
                    {vista !== 'alicuotas' && vista !== 'quincenal' && (
                        <div className="inline-flex items-center rounded-lg border border-line bg-white">
                            <button onClick={() => ir({ mes: sumaMes(mes, -1) })} aria-label="Mes anterior" className="grid size-11 place-items-center rounded-l-lg hover:bg-paper"><ChevronLeft className="size-4" /></button>
                            <span className="w-[150px] text-center text-[15px] font-semibold">{periodo}</span>
                            <button onClick={() => ir({ mes: sumaMes(mes, 1) })} disabled={mes >= hoy.slice(0, 7)} aria-label="Mes siguiente" className="grid size-11 place-items-center rounded-r-lg hover:bg-paper disabled:opacity-40"><ChevronRight className="size-4" /></button>
                        </div>)}
                    {vista !== 'alicuotas' && <>
                        <button onClick={() => setVerCierre(true)} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper"><ShieldAlert className="size-4" />Validar cierre<PuntoCierre c={cierre} /></button>
                        <button onClick={paquete} disabled={zip} className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-4 text-[15px] font-semibold text-white hover:bg-brand-600 disabled:opacity-60"><FileArchive className="size-4" />{zip ? 'Preparando…' : 'Paquete de declaración (ZIP)'}</button>
                    </>}
                    {exportable && <>
                        <button onClick={() => exportar('pdf')} disabled={pdf} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper disabled:opacity-50"><FileDown className="size-4" />{pdf ? 'Preparando…' : 'PDF'}</button>
                        {vista !== 'resumen' && <button onClick={() => exportar('csv')} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper"><FileSpreadsheet className="size-4" />Excel (CSV)</button>}
                    </>}
                </div>
            </div>

            {errZip && <p role="alert" className="mb-4 rounded-lg bg-[#fdecec] p-3 text-[14px] text-danger">{errZip}</p>}
            {verCierre && <ModalCierre c={cierre} cargando={cargandoCierre} recargar={recargarCierre} cerrar={() => setVerCierre(false)} periodo={periodo} />}
            <Regimen r={regimen} />

            <nav aria-label="Libros fiscales" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
                {TABS.map(([k, t, I]) => <button key={k} onClick={() => router.get('/libros-fiscales', { vista: k, mes }, { preserveScroll: true, preserveState: false })} aria-current={vista === k ? 'page' : undefined} className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-3 text-sm font-medium ${vista === k ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-text'}`}><I className="size-4" />{t}</button>)}
            </nav>

            {vista === 'resumen' && <Resumen d={p.resumen} regimen={regimen} mes={mes} ir={ir} retenciones_activas={p.retenciones_activas} />}
            {vista === 'quincenal' && <Quincenal d={p.quincenal} mes={mes} hoy={hoy} emisor={emisor} regimen={regimen} />}
            {vista === 'ventas' && <LibroVentas libro={p.libro} abrirFactura={setFactura} abrirRet={setRet} anularRet={setAnRet} activas={p.retenciones_activas} />}
            {vista === 'compras' && <LibroCompras libro={p.libro} regimen={regimen} activas={p.retenciones_activas} abrirRet={setRet} anularRet={setAnRet} abrirPlanilla={setPlan} />}
            {vista === 'retenciones' && <Retenciones d={p.retenciones} activas={p.retenciones_activas} anular={setAnRet} regimen={regimen} mes={mes} hoy={hoy} />}
            {vista === 'igtf' && <Igtf d={p.igtf} regimen={regimen} />}
            {vista === 'notas' && <Notas d={p.notas} nueva={() => setNota(true)} />}
            {vista === 'alicuotas' && <Alicuotas d={p.alicuotas} regimen={regimen} cambiar={(cod, t, vig) => setAlic({ cod, t, vig })} />}

            {factura && <ModalFactura f={factura} cerrar={() => setFactura(null)} />}
            {ret && <ModalRetencion r={ret} hoy={hoy} especial={regimen.especial} cerrar={() => setRet(null)} />}
            {anRet && <ModalAnularRet r={anRet} cerrar={() => setAnRet(null)} />}
            {plan && <ModalPlanilla c={plan} hoy={hoy} cerrar={() => setPlan(null)} />}
            {nota && <ModalNota hoy={hoy} cerrar={() => setNota(false)} />}
            {alic && <ModalAlicuota a={alic} hoy={hoy} cerrar={() => setAlic(null)} />}
        </AppLayout>
    );
}
