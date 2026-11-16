import { Head, router } from '@inertiajs/react';
import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Ban, CalendarDays, Landmark, Plus, Scale, WalletCards } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi, Modal, Toast, Vacio } from '../../Components/kit';
import { Field, Segmented } from '../../Components/ui';
import { n0, n2 } from '../../lib/format';
import { http } from '../../lib/http';

const dec = (m, v) => (m === 'COP' ? n0(v) : n2(v));
const ORIGEN = { MANUAL: 'Manual', COBRO_CXC: 'Cobro de cuenta', ANULACION_COBRO: 'Anulación de cobro', NOTA_CREDITO: 'Devolución por nota de crédito' };

function NuevoModal({ monedas, cerrar, listo }) {
    const [f, setF] = useState({ tipo: 'EGRESO', concepto: '', monto: '', moneda: 'USD', referencia: '' });
    const [err, setErr] = useState({}); const [env, setEnv] = useState(false);
    const enviar = async () => {
        const monto = Number(String(f.monto).replace(/\./g, '').replace(',', '.'));
        const er = {};
        if (f.concepto.trim().length < 3) er.concepto = 'Escribe el concepto (por ejemplo: flete, retiro).';
        if (!(monto > 0)) er.monto = 'Escribe el monto.';
        setErr(er); if (Object.keys(er).length) return;
        setEnv(true);
        try { await http('POST', '/movimientos-caja', { ...f, monto, referencia: f.referencia.trim() || null }); listo(); }
        catch (e) { setErr({ general: Object.values(e.errors || {})[0]?.[0] || e.message }); setEnv(false); }
    };
    return (
        <Modal titulo={f.tipo === 'EGRESO' ? 'Registrar egreso' : 'Registrar ingreso'} subtitulo="Queda en tu caja abierta y entra en el arqueo del Corte Z." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Registrar" ancho="max-w-[480px]">
            {err.general && <p role="alert" className="rounded-lg bg-[#fdecec] p-3 text-[14px] text-danger">{err.general}</p>}
            <Segmented compact name="Tipo de movimiento" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} options={[{ value: 'EGRESO', label: 'Egreso (sale dinero)' }, { value: 'INGRESO', label: 'Ingreso (entra dinero)' }]} />
            <Field label="Concepto" value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} error={err.concepto} autoFocus maxLength={200} hint="Por ejemplo: flete de mercancía, retiro para banco, compra de bolsas." />
            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                <Field label="Monto" inputMode="decimal" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value.replace(/[^\d.,]/g, '') })} error={err.monto} />
                <Field select label="Moneda" value={f.moneda} onChange={(e) => setF({ ...f, moneda: e.target.value })}>{monedas.map((m) => <option key={m}>{m}</option>)}</Field>
            </div>
            <Field label="Referencia o recibo (opcional)" icon={Landmark} value={f.referencia} onChange={(e) => setF({ ...f, referencia: e.target.value })} maxLength={60} />
        </Modal>
    );
}

function AnularModal({ m, cerrar, listo }) {
    const [motivo, setMotivo] = useState(''); const [err, setErr] = useState(''); const [env, setEnv] = useState(false);
    const enviar = async () => {
        if (motivo.trim().length < 3) { setErr('Escribe el motivo de la anulación.'); return; }
        setEnv(true);
        try { await http('POST', `/movimientos-caja/${m.id}/anular`, { motivo: motivo.trim() }); listo(); } catch (e) { setErr(e.errors?.motivo?.[0] || e.message); setEnv(false); }
    };
    return (
        <Modal titulo="Anular movimiento" subtitulo={`${m.concepto} · ${m.moneda} ${dec(m.moneda, m.monto)}`} cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Anular movimiento" peligro>
            <p className="text-[14px] leading-snug text-muted">El movimiento deja de contar en el arqueo de la caja. Solo se puede anular mientras el turno siga abierto.</p>
            <Field label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} error={err} autoFocus maxLength={300} />
        </Modal>
    );
}

export default function MovimientosCaja(p) {
    const { negocio, usuario, stock_bajo, tasa_usd, modo, desde, hasta, hoy, apertura, totales, movimientos, monedas } = p;
    const [rango, setRango] = useState({ desde: desde || hoy, hasta: hasta || hoy });
    const [nuevo, setNuevo] = useState(false); const [anular, setAnular] = useState(null); const [aviso, setAviso] = useState('');
    const recargar = (msg) => { setNuevo(false); setAnular(null); setAviso(msg); router.reload({ preserveScroll: true }); };
    const verRango = () => router.get('/movimientos-caja', rango, { preserveState: true });

    return (
        <AppLayout actual="/movimientos-caja" titulo="Movimientos de caja" subtitulo="Egresos, retiros y cobros que no son ventas" {...{ usuario, negocio, stockBajo: stock_bajo, tasaUsd: tasa_usd }}>
            <Head title="Movimientos de caja" />
            <Toast texto={aviso} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi icon={ArrowDownToLine} titulo="Ingresos (US$)" valor={n2(totales.ingresos_usd)} detalle={`Bs ${n2(totales.ingresos_ves)}`} />
                <Kpi icon={ArrowUpFromLine} titulo="Egresos (US$)" valor={n2(totales.egresos_usd)} detalle={`Bs ${n2(totales.egresos_ves)}`} />
                <Kpi icon={Scale} titulo="Neto (US$)" valor={n2(totales.ingresos_usd - totales.egresos_usd)} detalle="Ingresos menos egresos" tono={totales.egresos_usd > totales.ingresos_usd ? 'warn' : undefined} />
                <Kpi icon={WalletCards} titulo={modo === 'turno' ? 'Tu caja' : 'Rango'} valor={modo === 'turno' ? (apertura ? 'Abierta' : 'Cerrada') : `${movimientos.length}`} detalle={modo === 'turno' ? (apertura ? `Fondo $ ${n2(apertura.fondo_usd)} · Bs ${n2(apertura.fondo_ves)}` : 'Ábrela en el punto de venta') : 'movimientos listados'} />
            </div>

            <Card className="mt-4">
                <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
                    <Segmented compact name="Vista" value={modo} onChange={(v) => (v === 'turno' ? router.get('/movimientos-caja') : verRango())} options={[{ value: 'turno', label: 'Mi turno abierto' }, { value: 'rango', label: 'Por fechas' }]} />
                    {modo === 'rango' && <>
                        <div className="w-[160px]"><Field label="Desde" type="date" forceFloat value={rango.desde} max={hoy} onChange={(e) => setRango({ ...rango, desde: e.target.value })} /></div>
                        <div className="w-[160px]"><Field label="Hasta" type="date" forceFloat value={rango.hasta} max={hoy} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} /></div>
                        <button type="button" onClick={verRango} className="inline-flex h-12 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper"><CalendarDays className="size-4" />Ver</button></>}
                    <button type="button" disabled={!apertura} onClick={() => setNuevo(true)} title={apertura ? '' : 'Abre tu caja en el punto de venta para registrar movimientos'} className="ml-auto inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-4 text-[14.5px] font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-[#c5cdd6]"><Plus className="size-4" />Registrar egreso</button>
                </div>
                {movimientos.length === 0 ? (
                    modo === 'turno' && !apertura
                        ? <Vacio icon={WalletCards} titulo="No tienes una caja abierta" texto="Los movimientos se atan al turno abierto. Abre la caja en el punto de venta o consulta un rango de fechas."><a href="/caja" className="inline-flex h-11 items-center rounded-lg bg-brand px-5 text-[15px] font-semibold text-white hover:bg-brand-600">Ir al punto de venta</a></Vacio>
                        : <Vacio icon={ArrowUpFromLine} titulo="Sin movimientos" texto={modo === 'turno' ? 'Todavía no has registrado egresos ni cobros en este turno.' : 'No hay movimientos en esas fechas.'} />
                ) : (
                    <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-[14px]">
                        <thead><tr className="border-b border-line text-left text-[12.5px] text-muted"><th className="px-4 py-2.5 font-medium">Fecha</th><th className="px-3 py-2.5 font-medium">Tipo</th><th className="px-3 py-2.5 font-medium">Concepto</th><th className="px-3 py-2.5 text-right font-medium">Monto</th><th className="px-3 py-2.5 text-right font-medium">US$</th><th className="px-3 py-2.5 text-right font-medium">Bs</th><th className="px-4 py-2.5" /></tr></thead>
                        <tbody>{movimientos.map((m) => (
                            <tr key={m.id} className={`border-b border-line last:border-0 ${m.estado === 'ANULADO' ? 'text-muted' : ''}`}>
                                <td className="num px-4 py-3 text-[13px]">{m.cuando}<span className="block text-[12px] text-muted">{m.por}</span></td>
                                <td className="px-3 py-3"><span className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${m.tipo === 'INGRESO' ? 'bg-[#e7f6ee] text-ok' : 'bg-[#fdecec] text-danger'}`}>{m.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'}</span></td>
                                <td className="px-3 py-3"><span className={m.estado === 'ANULADO' ? 'line-through' : 'font-medium'}>{m.concepto}</span><span className="block text-[12.5px] text-muted">{ORIGEN[m.origen]}{m.referencia ? ` · ${m.referencia}` : ''}{!m.efectivo ? ' · no efectivo' : ''}{m.estado === 'ANULADO' ? ` · anulado: ${m.motivo}` : ''}</span></td>
                                <td className="num px-3 py-3 text-right">{m.moneda} {dec(m.moneda, m.monto)}</td>
                                <td className="num px-3 py-3 text-right">{n2(m.usd)}</td><td className="num px-3 py-3 text-right">{n2(m.ves)}</td>
                                <td className="px-4 py-3 text-right">{m.origen === 'MANUAL' && m.estado === 'ACTIVO' && modo === 'turno' && <button type="button" onClick={() => setAnular(m)} aria-label="Anular movimiento" title="Anular" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-[#fdecec] hover:text-danger"><Ban className="size-4" /></button>}</td>
                            </tr>))}</tbody></table></div>
                )}
            </Card>
            {nuevo && <NuevoModal monedas={monedas} cerrar={() => setNuevo(false)} listo={() => recargar('Movimiento registrado.')} />}
            {anular && <AnularModal m={anular} cerrar={() => setAnular(null)} listo={() => recargar('Movimiento anulado.')} />}
        </AppLayout>
    );
}
