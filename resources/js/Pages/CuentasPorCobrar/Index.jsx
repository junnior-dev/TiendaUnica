import { Head, router } from '@inertiajs/react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Ban, Banknote, CalendarClock, ChevronDown, HandCoins, Landmark, Printer, Search, TriangleAlert, Users } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi, Modal, Toast, Vacio } from '../../Components/kit';
import { Button, Field, Segmented } from '../../Components/ui';
import { n2 } from '../../lib/format';
import { http } from '../../lib/http';
import { construirComprobanteCobro } from '../../lib/pdfComprobanteCobro';
import { imprimirTicketCorte } from '../../lib/pdfTicketCorte';

/** Abre el recibo de cobro (con el IGTF desglosado si lo hubo) en el diálogo de impresión. Sirve para el cajero y el administrador. */
export async function imprimirRecibo(id) {
    const d = await http('GET', `/cuentas-por-cobrar/pagos/${id}/comprobante`);
    imprimirTicketCorte(await construirComprobanteCobro(d), `recibo-${String(id).padStart(6, '0')}.pdf`);
}

const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const ESTADO = { PENDIENTE: ['Pendiente', 'bg-brand-50 text-brand'], PAGADA: ['Pagada', 'bg-[#e7f6ee] text-ok'], ANULADA: ['Anulada', 'bg-paper text-muted'] };

export const Vence = ({ c }) => {
    if (c.estado !== 'PENDIENTE') return <span className="text-muted">{dmy(c.vence)}</span>;
    const t = c.dias < 0 ? `Vencida hace ${-c.dias} ${c.dias === -1 ? 'día' : 'días'}` : c.dias === 0 ? 'Vence hoy' : `En ${c.dias} ${c.dias === 1 ? 'día' : 'días'}`;
    return <span><span className="num">{dmy(c.vence)}</span><span className={`mt-0.5 block text-[12px] ${c.dias < 0 ? 'font-semibold text-danger' : c.dias <= 5 ? 'text-[#8a5d00]' : 'text-muted'}`}>{t}</span></span>;
};

export function CobroModal({ cuenta, metodos, hoy, cajaAbierta, cerrar, listo }) {
    // El método decide la moneda, si pide referencia, si es efectivo y si causa IGTF: el cajero ya no tiene que adivinarlo.
    const [f, setF] = useState({ fecha: hoy, metodo: metodos[0]?.id ?? '', monto: '', referencia: '' });
    const [err, setErr] = useState({}); const [env, setEnv] = useState(false);
    const m = metodos.find((x) => String(x.id) === String(f.metodo));
    const monto = Number(String(f.monto).replace(/\./g, '').replace(',', '.'));
    const igtf = m && m.igtf_pct > 0 && monto > 0 ? Math.round(monto * m.igtf_pct) / 100 : 0;
    const sinCaja = !!m?.efectivo && !cajaAbierta;
    const enviar = async () => {
        const er = {};
        if (!m) er.metodo = 'Elige cómo te pagó el cliente.';
        if (!(monto > 0)) er.monto = 'Escribe cuánto cobraste.';
        if (!f.fecha) er.fecha = 'Elige la fecha del cobro.';
        if (m?.referencia && !f.referencia.trim()) er.referencia = 'Este método necesita el número de referencia.';
        if (sinCaja) er.general = 'Para cobrar en efectivo abre tu caja. Si fue transferencia o pago móvil, elige ese método.';
        setErr(er); if (Object.keys(er).length) return;
        setEnv(true);
        try { listo(await http('POST', '/cuentas-por-cobrar/pagos', { cuenta_id: cuenta.id, fecha: f.fecha, metodo_pago_id: m.id, monto, referencia: m.referencia ? f.referencia.trim() : null })); }
        catch (e) { setErr({ general: Object.values(e.errors || {})[0]?.[0] || e.message }); setEnv(false); }
    };
    return (
        <Modal titulo="Registrar cobro" subtitulo={`${cuenta.cliente} · debe $ ${n2(cuenta.saldo_usd)} (Bs ${n2(cuenta.saldo_ves)})`} cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Registrar cobro" ancho="max-w-[500px]">
            {err.general && <p role="alert" className="rounded-lg bg-[#fdecec] p-3 text-[14px] text-danger">{err.general}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Fecha del cobro" type="date" value={f.fecha} max={hoy} onChange={(e) => setF({ ...f, fecha: e.target.value })} error={err.fecha} forceFloat />
                <Field select label="Método de cobro" value={f.metodo} onChange={(e) => setF({ ...f, metodo: e.target.value })} error={err.metodo}>{metodos.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Field>
            </div>
            <Field label={`Monto cobrado${m ? ` (${m.moneda})` : ''}`} icon={Banknote} value={f.monto} inputMode="decimal" autoFocus onChange={(e) => setF({ ...f, monto: e.target.value.replace(/[^\d.,]/g, '') })} error={err.monto} hint="Se convierte a la tasa del día del cobro." />
            {m?.referencia && <Field label="Número de referencia" icon={Landmark} value={f.referencia} onChange={(e) => setF({ ...f, referencia: e.target.value })} error={err.referencia} />}
            {igtf > 0 && (
                <div className="rounded-lg border border-line p-3 text-[13.5px] leading-snug">
                    <p className="flex justify-between"><span className="text-muted">Cobro a la deuda</span><span className="num">{m.moneda} {n2(monto)}</span></p>
                    <p className="flex justify-between"><span className="text-muted">IGTF ({String(m.igtf_pct).replace('.', ',')} %)</span><span className="num">{m.moneda} {n2(igtf)}</span></p>
                    <p className="mt-1 flex justify-between border-t border-line pt-1 font-semibold"><span>El cliente entrega</span><span className="num">{m.moneda} {n2(monto + igtf)}</span></p>
                </div>
            )}
            <p className={`rounded-lg p-3 text-[13px] leading-snug ${sinCaja ? 'bg-[#fdecec] text-danger' : 'bg-paper text-muted'}`}>
                {sinCaja ? 'No tienes caja abierta: un cobro en efectivo necesita un turno abierto para entrar a tu arqueo y a tu Corte Z.'
                    : m?.efectivo ? 'Entra como ingreso en tu caja abierta y suma al arqueo del Corte Z.' : 'Cobro por banco: no mueve el efectivo de tu caja.'}
                {igtf > 0 ? ' El IGTF queda en el libro de IGTF y en el asiento.' : ''} Si llevas contabilidad automática, también genera su asiento.
            </p>
        </Modal>
    );
}

function AnularModal({ pago, cerrar, listo }) {
    const [motivo, setMotivo] = useState(''); const [env, setEnv] = useState(false); const [err, setErr] = useState('');
    const enviar = async () => {
        if (motivo.trim().length < 3) { setErr('Escribe el motivo de la anulación.'); return; }
        setEnv(true);
        try { listo(await http('POST', `/cuentas-por-cobrar/pagos/${pago.id}/anular`, { motivo: motivo.trim() })); } catch (e) { setErr(e.errors?.motivo?.[0] || e.message); setEnv(false); }
    };
    return (
        <Modal titulo="Anular cobro" subtitulo={`${dmy(pago.fecha)} · ${pago.moneda} ${n2(pago.monto)} (US$ ${n2(pago.monto_usd)})`} cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Anular cobro" peligro>
            <p className="text-[14px] leading-snug text-muted">La deuda del cliente vuelve a subir por este monto. Si tienes caja abierta, se registra la salida del dinero devuelto.</p>
            <Field label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} error={err} autoFocus maxLength={300} />
        </Modal>
    );
}

function Pagos({ id, recarga, alAnular, alRecibo }) {
    const [d, setD] = useState(null); const [err, setErr] = useState('');
    useEffect(() => { setD(null); http('GET', `/cuentas-por-cobrar/${id}`).then(setD).catch((e) => setErr(e.message)); }, [id, recarga]);
    if (err) return <p className="px-4 py-3 text-[13.5px] text-danger">{err}</p>;
    if (!d) return <p className="px-4 py-3 text-[13.5px] text-muted">Cargando cobros…</p>;
    if (!d.pagos.length) return <p className="px-4 py-3 text-[13.5px] text-muted">Esta cuenta todavía no tiene cobros.</p>;
    return (
        <ul className="divide-y divide-line">
            {d.pagos.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13.5px]">
                    <span className="num w-[84px] text-muted">{dmy(p.fecha)}</span>
                    <span className={`num font-medium ${p.estado === 'ANULADO' ? 'text-muted line-through' : ''}`}>{p.moneda} {n2(p.monto)} <span className="font-normal text-muted">· US$ {n2(p.monto_usd)}</span></span>
                    <span className="text-muted">{p.efectivo ? 'Efectivo' : `Ref. ${p.referencia}`}{p.igtf > 0 ? ` · IGTF ${p.moneda} ${n2(p.igtf)}` : ''} · {p.por}</span>
                    <span className="ml-auto flex items-center gap-1">
                        <button type="button" onClick={() => alRecibo(p.id)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold text-brand hover:bg-brand-50"><Printer className="size-3.5" />{p.igtf > 0 ? 'Comprobante IGTF' : 'Recibo'}</button>
                        {p.estado === 'ANULADO' ? <span className="text-muted">Anulado: {p.motivo}</span> : alAnular && <button type="button" onClick={() => alAnular(p)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold text-danger hover:bg-[#fdecec]"><Ban className="size-3.5" />Anular</button>}
                    </span>
                </li>
            ))}
        </ul>
    );
}

export default function CuentasPorCobrar(p) {
    const { negocio, usuario, fecha_larga, stock_bajo, tasa_usd, filtros, totales, cuentas, clientes, metodos, hoy, caja_abierta } = p;
    const [q, setQ] = useState(filtros.q || '');
    const [abierta, setAbierta] = useState(null); const [recarga, setRecarga] = useState(0);
    const [cobro, setCobro] = useState(null); const [anular, setAnular] = useState(null); const [aviso, setAviso] = useState('');
    const primera = useRef(true);
    const esAdmin = usuario?.rol === 'Administrador';   // el cajero cobra y reimprime recibos; anular un cobro es del administrador
    const recibo = (id) => imprimirRecibo(id).catch((e) => setAviso(e.message || 'No se pudo abrir el recibo.'));

    const ir = (cambio) => router.get('/cuentas-por-cobrar', { ...filtros, ...cambio, vencidas: (cambio.vencidas ?? filtros.vencidas) ? 1 : undefined }, { preserveState: true, replace: true, preserveScroll: true });
    useEffect(() => { if (primera.current) { primera.current = false; return; } const t = setTimeout(() => ir({ q }), 300); return () => clearTimeout(t); }, [q]);

    const tras = (msg) => (r) => { setCobro(null); setAnular(null); setRecarga((x) => x + 1); if (r?.cuenta?.id && msg === 'Cobro registrado.') { setAbierta(r.cuenta.id); msg = 'Cobro registrado. Imprime su recibo en la lista de cobros.'; } setAviso(msg); router.reload({ only: ['cuentas', 'totales'], preserveScroll: true }); };

    return (
        <AppLayout actual="/cuentas-por-cobrar" titulo="Cuentas por cobrar" subtitulo="Lo que tus clientes te deben por ventas a crédito" {...{ usuario, negocio, stockBajo: stock_bajo, tasaUsd: tasa_usd }}>
            <Head title="Cuentas por cobrar" />
            <Toast texto={aviso} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi icon={HandCoins} titulo="Por cobrar (US$)" valor={n2(totales.saldo_usd)} detalle={`${totales.n} ${totales.n === 1 ? 'cuenta' : 'cuentas'} en este filtro`} />
                <Kpi icon={Landmark} titulo="Por cobrar (Bs)" valor={n2(totales.saldo_ves)} detalle="A la tasa de cada venta" />
                <Kpi icon={TriangleAlert} titulo="Vencido (US$)" valor={n2(totales.vencido_usd)} detalle={`${totales.n_vencidas} ${totales.n_vencidas === 1 ? 'cuenta vencida' : 'cuentas vencidas'}`} tono={totales.n_vencidas ? 'bad' : undefined} onClick={() => ir({ vencidas: !filtros.vencidas, estado: 'PENDIENTE' })} activo={filtros.vencidas} />
                <Kpi icon={Users} titulo="Clientes con deuda" valor={String(new Set(cuentas.filter((c) => c.estado === 'PENDIENTE').map((c) => c.cliente_id)).size)} detalle="En la lista de abajo" />
            </div>

            <Card className="mt-4">
                <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
                    <Segmented compact name="Estado" value={filtros.estado} onChange={(v) => ir({ estado: v })} options={[{ value: 'PENDIENTE', label: 'Pendientes' }, { value: 'PAGADA', label: 'Pagadas' }, { value: 'ANULADA', label: 'Anuladas' }, { value: 'TODAS', label: 'Todas' }]} />
                    <div className="w-full sm:w-[230px]"><Field select label="Cliente" value={filtros.cliente} onChange={(e) => ir({ cliente: e.target.value })} forceFloat><option value="">Todos</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Field></div>
                    <div className="w-full sm:ml-auto sm:w-[260px]"><Field label="Buscar cliente, cédula o venta" icon={Search} value={q} onChange={(e) => setQ(e.target.value)} /></div>
                </div>
                {cuentas.length === 0 ? (
                    <Vacio icon={CalendarClock} titulo={filtros.estado === 'PENDIENTE' && !filtros.q && !filtros.cliente ? 'Nadie te debe nada' : 'No hay cuentas con ese filtro'}
                        texto={filtros.estado === 'PENDIENTE' && !filtros.q && !filtros.cliente ? 'Cuando vendas a crédito desde el punto de venta, la deuda aparece aquí para cobrarla.' : 'Prueba con otro estado, otro cliente o quita la búsqueda.'} />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[860px] text-[14px]">
                            <thead><tr className="border-b border-line text-left text-[12.5px] text-muted"><th className="px-4 py-2.5 font-medium">Cliente</th><th className="px-3 py-2.5 font-medium">Venta</th><th className="px-3 py-2.5 text-right font-medium">Saldo USD</th><th className="px-3 py-2.5 text-right font-medium">Saldo Bs</th><th className="px-3 py-2.5 font-medium">Vence</th><th className="px-3 py-2.5 font-medium">Estado</th><th className="px-4 py-2.5" /></tr></thead>
                            <tbody>
                                {cuentas.map((c) => (
                                    <Fragment key={c.id}>
                                        <tr className="border-b border-line last:border-0 hover:bg-paper/60">
                                            <td className="px-4 py-3"><p className="font-medium">{c.cliente}</p><p className="num text-[12.5px] text-muted">{c.documento}</p></td>
                                            <td className="px-3 py-3"><p className="num">N.º {String(c.venta ?? '').padStart(6, '0')}</p><p className="text-[12.5px] text-muted">{c.factura ? `Factura ${c.factura}` : dmy(c.fecha_venta)}</p></td>
                                            <td className="num px-3 py-3 text-right font-semibold">{n2(c.saldo_usd)}<span className="block text-[12px] font-normal text-muted">de {n2(c.original_usd)}</span></td>
                                            <td className="num px-3 py-3 text-right">{n2(c.saldo_ves)}</td>
                                            <td className="px-3 py-3"><Vence c={c} /></td>
                                            <td className="px-3 py-3"><span className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${ESTADO[c.estado][1]}`}>{ESTADO[c.estado][0]}</span></td>
                                            <td className="px-4 py-3"><div className="flex justify-end gap-2">
                                                {c.estado === 'PENDIENTE' && <button type="button" onClick={() => setCobro(c)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13.5px] font-semibold text-white hover:bg-brand-600"><Banknote className="size-4" />Registrar pago</button>}
                                                <button type="button" onClick={() => setAbierta(abierta === c.id ? null : c.id)} aria-expanded={abierta === c.id} aria-label="Ver cobros" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-paper"><ChevronDown className={`size-4 transition-transform ${abierta === c.id ? 'rotate-180' : ''}`} /></button></div></td>
                                        </tr>
                                        {abierta === c.id && <tr className="border-b border-line bg-paper/50"><td colSpan={7} className="p-0"><Pagos id={c.id} recarga={recarga} alAnular={esAdmin ? setAnular : null} alRecibo={recibo} /></td></tr>}
                                    </Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
            {cuentas.length >= 300 && <p className="mt-2 text-[13px] text-muted">Se muestran las 300 cuentas más próximas a vencer. Filtra por cliente para ver el resto.</p>}

            {cobro && <CobroModal cuenta={cobro} metodos={metodos} hoy={hoy} cajaAbierta={caja_abierta} cerrar={() => setCobro(null)} listo={tras('Cobro registrado.')} />}
            {anular && <AnularModal pago={anular} cerrar={() => setAnular(null)} listo={tras('Cobro anulado.')} />}
        </AppLayout>
    );
}
