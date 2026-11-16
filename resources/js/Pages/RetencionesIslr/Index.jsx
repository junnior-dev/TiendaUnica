import { Head, router } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { Ban, CalendarCheck, ChevronLeft, ChevronRight, CircleAlert, Landmark, Plus, Printer, ReceiptText, Settings2, Wallet } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi, Modal, Toast, Vacio } from '../../Components/kit';
import { Field, Segmented } from '../../Components/ui';
import { n2 } from '../../lib/format';
import { http } from '../../lib/http';
import { normalizarRif, validarRif } from '../../lib/rif';
import { construirComprobanteIslr } from '../../lib/pdfComprobanteIslr';
import { imprimirTicketCorte } from '../../lib/pdfTicketCorte';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const bs = (v) => `Bs ${n2(v)}`;
const num = (t) => { const x = String(t ?? '').trim(); return x ? Number(x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x) : NaN; };
const Alerta = ({ children, tono = 'bad' }) => (
    <p role={tono === 'bad' ? 'alert' : undefined} className={`flex items-start gap-2 rounded-lg p-3 text-[13.5px] leading-snug ${tono === 'bad' ? 'bg-[#fdecec] text-danger' : tono === 'warn' ? 'bg-signal/15 text-[#7a4d00]' : 'bg-paper text-muted'}`}><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{children}</span></p>
);

async function imprimir(id) {
    const d = await http('GET', `/retenciones-islr/${id}/comprobante`);
    imprimirTicketCorte(await construirComprobanteIslr(d), `retencion-islr-${d.numero}.pdf`);
}

/* ───── Nueva retención, con el cálculo en vivo (lo calcula la base de datos: lo que ves es lo que se guarda) ───── */
function ModalNueva({ d, cerrar, listo }) {
    const [f, setF] = useState({ fecha: d.hoy, proveedor: '', beneficiario: '', rif: '', tipo: 'J', concepto: d.conceptos[0]?.codigo ?? '', documento: '', monto: '', moneda: 'VES', fondos: 'BANCOS', observaciones: '' });
    const [calc, setCalc] = useState(null); const [errCalc, setErrCalc] = useState('');
    const [err, setErr] = useState({}); const [env, setEnv] = useState(false);
    const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
    const monto = num(f.monto);
    const rifMal = f.rif.trim() ? validarRif(f.rif) : null;

    const elegirProveedor = (e) => {
        const p = d.proveedores.find((x) => String(x.id) === e.target.value);
        setF((x) => p ? { ...x, proveedor: e.target.value, beneficiario: p.nombre, rif: p.rif, tipo: 'JGC'.includes(p.rif[0].toUpperCase()) ? 'J' : 'N' } : { ...x, proveedor: '' });
    };
    const cambiarRif = (e) => { const v = e.target.value.toUpperCase(); setF((x) => ({ ...x, rif: v, tipo: /^[VEP]/.test(v) ? 'N' : /^[JGC]/.test(v) ? 'J' : x.tipo })); };

    useEffect(() => {
        setCalc(null); setErrCalc('');
        if (!(monto > 0) || !f.concepto) return;
        const t = setTimeout(async () => {
            try { setCalc(await http('POST', '/retenciones-islr/simular', { fecha: f.fecha, tipo: f.tipo, concepto: f.concepto, monto, moneda: f.moneda, rif: f.rif.trim() && !rifMal ? f.rif : null })); }
            catch (e) { setErrCalc(e.message); }
        }, 350);
        return () => clearTimeout(t);
    }, [f.fecha, f.tipo, f.concepto, f.monto, f.moneda, f.rif]);

    const enviar = async () => {
        const er = {};
        if (f.beneficiario.trim().length < 3) er.beneficiario = 'Escribe el nombre del beneficiario.';
        if (!f.rif.trim() || rifMal) er.rif = rifMal || 'Escribe el RIF del beneficiario.';
        if (!(monto > 0)) er.monto = 'Escribe cuánto se pagó (sin IVA).';
        if (calc && !calc.corresponde) er.general = 'Con este monto no corresponde retener.';
        setErr(er); if (Object.keys(er).length) return;
        setEnv(true);
        try { await http('POST', '/retenciones-islr', { fecha: f.fecha, beneficiario: f.beneficiario.trim(), rif: normalizarRif(f.rif), tipo: f.tipo, concepto: f.concepto, documento: f.documento.trim() || null, monto, moneda: f.moneda, fondos: f.fondos, proveedor_id: f.proveedor ? Number(f.proveedor) : null, observaciones: f.observaciones.trim() || null }); listo(); }
        catch (e) { setErr({ general: Object.values(e.errors || {})[0]?.[0] || e.message }); setEnv(false); }
    };
    const c = d.conceptos.find((x) => x.codigo === f.concepto);
    return (
        <Modal titulo="Nueva retención de ISLR" subtitulo="Para pagos de servicios: honorarios, comisiones, fletes, alquileres, contratistas. La compra de mercancía no se retiene." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Registrar retención" ancho="max-w-[620px]">
            {err.general && <Alerta>{err.general}</Alerta>}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field forceFloat label="Fecha del pago" type="date" max={d.hoy} value={f.fecha} onChange={set('fecha')} />
                <Field select label="Concepto del pago" value={f.concepto} onChange={set('concepto')}>{d.conceptos.map((x) => <option key={x.codigo} value={x.codigo}>{x.nombre}</option>)}</Field>
            </div>
            {d.proveedores.length > 0 && (
                <Field select label="Proveedor registrado (opcional)" value={f.proveedor} onChange={elegirProveedor}><option value="">Otro beneficiario</option>{d.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre o razón social" value={f.beneficiario} onChange={set('beneficiario')} error={err.beneficiario} />
                <Field label="RIF del beneficiario" value={f.rif} onChange={cambiarRif} onBlur={() => setF((x) => ({ ...x, rif: normalizarRif(x.rif) }))} error={err.rif || rifMal} />
            </div>
            <div>
                <p className="mb-2 text-[14px] font-medium">El beneficiario es</p>
                <Segmented compact name="Tipo de beneficiario" value={f.tipo} onChange={(x) => setF((p) => ({ ...p, tipo: x }))} options={[{ value: 'J', label: 'Persona jurídica' }, { value: 'N', label: 'Persona natural' }]} />
                {c && <p className="mt-1.5 text-[13px] text-muted">Porcentaje para este concepto: {String(f.tipo === 'N' ? c.pct_natural : c.pct_juridica).replace('.', ',')} %{f.tipo === 'N' ? ' menos el sustraendo' : ''}.</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_120px_1fr]">
                <Field label="Monto pagado (sin IVA)" inputMode="decimal" value={f.monto} onChange={set('monto')} error={err.monto} />
                <Field select label="Moneda" value={f.moneda} onChange={set('moneda')}>{d.monedas.map((m) => <option key={m} value={m}>{m}</option>)}</Field>
                <Field label="N.º de factura (opcional)" value={f.documento} onChange={set('documento')} />
            </div>
            <div>
                <p className="mb-2 text-[14px] font-medium">El pago salió de</p>
                <Segmented compact name="Origen del pago" value={f.fondos} onChange={(x) => setF((p) => ({ ...p, fondos: x }))} options={[{ value: 'BANCOS', label: 'Banco' }, { value: 'CAJA', label: 'Caja (efectivo)' }]} />
            </div>
            {errCalc && <Alerta tono="warn">{errCalc}</Alerta>}
            {calc && (
                <dl className="divide-y divide-line rounded-xl border border-line text-[14px]">
                    {f.moneda !== 'VES' && <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted">Base en bolívares (tasa Bs {n2(calc.tasa)})</dt><dd className="num font-medium">{bs(calc.base_ves)}</dd></div>}
                    <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted">Porcentaje</dt><dd className="num font-medium">{String(calc.porcentaje).replace('.', ',')} %</dd></div>
                    {calc.sustraendo > 0 && <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted">Sustraendo (UT Bs {n2(calc.ut)})</dt><dd className="num font-medium">− {bs(calc.sustraendo)}</dd></div>}
                    {calc.sustraendo_ya_aplicado_en_el_mes && <div className="px-4 py-2.5 text-[13px] text-muted">El sustraendo ya se aplicó a este beneficiario y concepto este mes.</div>}
                    {calc.corresponde
                        ? <><div className="flex justify-between gap-4 px-4 py-2.5 font-semibold"><dt>Retención de ISLR</dt><dd className="num text-brand">{bs(calc.retenido)}</dd></div>
                            <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted">Neto que le pagas</dt><dd className="num font-medium">{bs(calc.neto)}</dd></div></>
                        : <div className="px-4 py-3 text-[14px] font-semibold text-danger">No corresponde retener: el monto no supera el mínimo.</div>}
                </dl>
            )}
            {d.contabilidad_automatica
                ? <Alerta tono="info">Se registra el gasto, el pago neto y el ISLR retenido por pagar. Si la factura lleva IVA, el IVA no se carga aquí.</Alerta>
                : <Alerta tono="warn">La contabilidad automática está apagada: la retención queda registrada pero sin asiento contable.</Alerta>}
        </Modal>
    );
}

/* ───── Unidad tributaria y regla del sustraendo ───── */
function ModalParametros({ d, cerrar, listo }) {
    const [ut, setUt] = useState({ desde: d.hoy, valor: '', nota: '' });
    const [una, setUna] = useState(d.config.sustraendo_una_vez_mes);
    const [err, setErr] = useState(''); const [env, setEnv] = useState(false);
    const enviar = async () => {
        setErr(''); setEnv(true);
        try {
            if (una !== d.config.sustraendo_una_vez_mes) await http('POST', '/retenciones-islr/configuracion', { sustraendo_una_vez_mes: una });
            if (ut.valor.trim()) { const v = num(ut.valor); if (!(v > 0)) throw { message: 'Escribe la unidad tributaria en bolívares.' }; await http('POST', '/retenciones-islr/unidad-tributaria', { desde: ut.desde, valor: v, nota: ut.nota.trim() || null }); }
            listo();
        } catch (e) { setErr(e.message); setEnv(false); }
    };
    return (
        <Modal titulo="Parámetros de ISLR" subtitulo="La unidad tributaria cambia con el tiempo: regístrala con su fecha de vigencia." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Guardar" ancho="max-w-[520px]">
            {err && <Alerta>{err}</Alerta>}
            <div className="rounded-xl bg-paper px-4 py-3 text-[14px]">
                <p className="font-semibold">Unidad tributaria vigente hoy: {d.ut.vigente ? bs(d.ut.vigente) : 'sin registrar'}</p>
                {d.ut.historial.map((u) => <p key={u.desde} className="text-[13px] text-muted">Desde {dmy(u.desde)}: {bs(u.valor)}{u.nota ? ` · ${u.nota}` : ''}</p>)}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nueva UT en bolívares" inputMode="decimal" value={ut.valor} onChange={(e) => setUt({ ...ut, valor: e.target.value })} hint="Déjala vacía si no cambia" />
                <Field forceFloat label="Rige desde" type="date" max={d.hoy} value={ut.desde} onChange={(e) => setUt({ ...ut, desde: e.target.value })} />
            </div>
            <Field label="Fuente (Gaceta u otra)" value={ut.nota} onChange={(e) => setUt({ ...ut, nota: e.target.value })} />
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-4">
                <input type="checkbox" checked={una} onChange={(e) => setUna(e.target.checked)} className="mt-1 size-4" />
                <span className="text-[14px] leading-snug"><b>Aplicar el sustraendo una sola vez al mes</b> por beneficiario y concepto (persona natural). Déjalo apagado si tu contador lo aplica en cada pago.</span>
            </label>
            <Alerta tono="info">La UT solo se usa para personas naturales. Los porcentajes del catálogo son los del Decreto 1.808: confírmalos con tu contador.</Alerta>
        </Modal>
    );
}

/* ───── Marcar como enterado al SENIAT ───── */
function ModalEnterar({ d, cerrar, listo }) {
    const [f, setF] = useState({ desde: String(d.resumen.mas_antigua || `${d.mes}-01`).slice(0, 10), hasta: d.hoy, fecha_pago: d.hoy, referencia: '' });
    const [err, setErr] = useState(''); const [env, setEnv] = useState(false);
    const enviar = async () => { setErr(''); setEnv(true); try { await http('POST', '/retenciones-islr/enterar', { ...f, referencia: f.referencia.trim() || null }); listo(); } catch (e) { setErr(e.message); setEnv(false); } };
    return (
        <Modal titulo="Registrar el pago al SENIAT" subtitulo={`Tienes ${bs(d.resumen.por_enterar)} retenidos por enterar (${d.resumen.por_enterar_n}).`} cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Marcar como enterado">
            {err && <Alerta>{err}</Alerta>}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field forceFloat label="Retenciones desde" type="date" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} />
                <Field forceFloat label="hasta" type="date" max={d.hoy} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field forceFloat label="Fecha en que pagaste" type="date" max={d.hoy} value={f.fecha_pago} onChange={(e) => setF({ ...f, fecha_pago: e.target.value })} />
                <Field label="Referencia del pago" value={f.referencia} onChange={(e) => setF({ ...f, referencia: e.target.value })} />
            </div>
            <Alerta tono="info">Esto solo lleva el control y el asiento (ISLR retenido por pagar contra Bancos). El pago y la declaración se hacen en el portal del SENIAT.</Alerta>
        </Modal>
    );
}

function ModalMotivo({ titulo, texto, ok, cerrar, enviar }) {
    const [m, setM] = useState(''); const [err, setErr] = useState(''); const [env, setEnv] = useState(false);
    const ir = async () => { if (m.trim().length < 3) return setErr('Cuéntanos el motivo (mínimo 3 letras).'); setEnv(true); try { await enviar(m.trim()); } catch (e) { setErr(e.message); setEnv(false); } };
    return (
        <Modal titulo={titulo} subtitulo={texto} cerrar={cerrar} onSubmit={ir} enviando={env} ok={ok} peligro>
            {err && <Alerta>{err}</Alerta>}
            <Field label="Motivo" value={m} onChange={(e) => setM(e.target.value)} autoFocus />
        </Modal>
    );
}

export default function Index(p) {
    const { usuario, negocio, stock_bajo, tasa_usd, instalado, mes } = p;
    const [modal, setModal] = useState(null);
    const [aviso, setAviso] = useState('');
    const [a, m] = mes.split('-').map(Number);
    const ir = (nuevo) => router.get('/retenciones-islr', { mes: nuevo }, { preserveState: true, replace: true });
    const mover = (d) => { const x = new Date(a, m - 1 + d, 1); ir(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); };
    const hecho = (t) => { setModal(null); setAviso(t); router.reload({ preserveScroll: true }); };
    const layout = { actual: '/retenciones-islr', titulo: 'Retenciones de ISLR', subtitulo: 'Lo que retienes a quienes te prestan servicios y debes enterar al SENIAT', usuario, negocio, stockBajo: stock_bajo, tasaUsd: tasa_usd };

    if (!instalado) return (
        <AppLayout {...layout}><Head title="Retenciones de ISLR" />
            <Card><Vacio icon={ReceiptText} titulo="Falta instalar este módulo" texto="Ejecuta 20_retenciones_islr.sql (requiere el 19) en tu base de datos y recarga la página." /></Card>
        </AppLayout>
    );

    const { retenciones, resumen, enteros, ut } = p;
    const sinUt = !ut.vigente;
    const estado = (r) => r.estado === 'ANULADA' ? ['Anulada', 'bg-paper text-muted'] : r.entero_id ? ['Enterada', 'bg-[#e7f6ee] text-ok'] : ['Por enterar', 'bg-brand-50 text-brand'];
    return (
        <AppLayout {...layout}>
            <Head title="Retenciones de ISLR" />
            <Toast texto={aviso} />
            {(p.alertas || []).length > 0 && (
                <div className="mb-4 space-y-2">{p.alertas.map((a, i) => <Alerta key={i} tono={a.gravedad === 'VENCIDO' ? 'bad' : 'warn'}>{a.mensaje}</Alerta>)}</div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-white p-1">
                    <button onClick={() => mover(-1)} aria-label="Mes anterior" className="grid size-9 place-items-center rounded-lg hover:bg-paper"><ChevronLeft className="size-4" /></button>
                    <span className="min-w-[150px] text-center text-[14.5px] font-semibold capitalize">{MESES[m - 1]} {a}</span>
                    <button onClick={() => mover(1)} aria-label="Mes siguiente" className="grid size-9 place-items-center rounded-lg hover:bg-paper"><ChevronRight className="size-4" /></button>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={() => setModal('ut')} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[14px] font-semibold hover:bg-paper"><Settings2 className="size-4" />Parámetros</button>
                    <button onClick={() => setModal('enterar')} disabled={!resumen.por_enterar_n} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[14px] font-semibold hover:bg-paper disabled:opacity-50"><Landmark className="size-4" />Registrar pago al SENIAT</button>
                    <button onClick={() => setModal('nueva')} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-[14px] font-semibold text-white hover:bg-brand-600"><Plus className="size-4" />Nueva retención</button>
                </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi icon={ReceiptText} titulo="Retenido en el mes" valor={bs(resumen.mes_retenido)} detalle={`${resumen.mes_n} ${resumen.mes_n === 1 ? 'comprobante' : 'comprobantes'}`} />
                <Kpi icon={Wallet} titulo="Base pagada en el mes" valor={bs(resumen.mes_base)} detalle="Sin IVA" />
                <Kpi icon={Landmark} titulo="Por enterar al SENIAT" valor={bs(resumen.por_enterar)} detalle={resumen.mas_antigua ? `Desde el ${dmy(resumen.mas_antigua)}` : 'Nada pendiente'} tono={resumen.por_enterar_n ? 'bad' : undefined} />
                <Kpi icon={CalendarCheck} titulo="Unidad tributaria" valor={ut.vigente ? bs(ut.vigente) : 'Sin registrar'} detalle={sinUt ? 'Hace falta para personas naturales' : 'Vigente hoy'} tono={sinUt ? 'bad' : undefined} onClick={() => setModal('ut')} />
            </div>

            <Card className="mt-5">
                {retenciones.length === 0
                    ? <Vacio icon={ReceiptText} titulo={`Sin retenciones en ${MESES[m - 1]}`} texto="Cuando pagues un servicio sujeto a retención (honorarios, fletes, alquileres, comisiones, contratistas), regístralo aquí para emitir el comprobante." />
                    : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[860px] text-left text-[14px]">
                                <thead className="border-b border-line text-[12.5px] text-muted"><tr><th className="px-5 py-3 font-medium">Comprobante</th><th className="px-3 py-3 font-medium">Beneficiario</th><th className="px-3 py-3 font-medium">Concepto</th><th className="px-3 py-3 text-right font-medium">Base</th><th className="px-3 py-3 text-right font-medium">%</th><th className="px-3 py-3 text-right font-medium">Retenido</th><th className="px-3 py-3 font-medium">Estado</th><th className="px-5 py-3" /></tr></thead>
                                <tbody className="divide-y divide-line">
                                    {retenciones.map((r) => {
                                        const [t, c] = estado(r);
                                        return (
                                            <tr key={r.id} className={r.estado === 'ANULADA' ? 'text-muted' : ''}>
                                                <td className="px-5 py-3"><span className="num font-medium">{r.numero}</span><span className="block text-[12.5px] text-muted">{dmy(r.fecha)}</span></td>
                                                <td className="px-3 py-3"><span className="font-medium">{r.beneficiario}</span><span className="block text-[12.5px] text-muted">{r.rif}{r.documento ? ` · ${r.documento}` : ''}</span></td>
                                                <td className="px-3 py-3">{r.concepto}<span className="block text-[12.5px] text-muted">{r.tipo === 'N' ? 'Persona natural' : 'Persona jurídica'}</span></td>
                                                <td className="num px-3 py-3 text-right">{bs(r.base_ves)}{r.moneda !== 'VES' && <span className="block text-[12.5px] text-muted">{r.moneda} {n2(r.monto)}</span>}</td>
                                                <td className="num px-3 py-3 text-right">{String(r.porcentaje).replace('.', ',')}{r.sustraendo_ves > 0 && <span className="block text-[12.5px] text-muted">− {n2(r.sustraendo_ves)}</span>}</td>
                                                <td className="num px-3 py-3 text-right font-semibold">{bs(r.retenido_ves)}</td>
                                                <td className="px-3 py-3"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${c}`}>{t}</span></td>
                                                <td className="px-5 py-3"><div className="flex justify-end gap-1">
                                                    <button onClick={() => imprimir(r.id).catch((e) => setAviso(e.message))} aria-label={`Imprimir comprobante ${r.numero}`} title="Imprimir comprobante" className="grid size-8 place-items-center rounded-md text-muted hover:bg-paper hover:text-ink"><Printer className="size-4" /></button>
                                                    {r.estado === 'ACTIVA' && !r.entero_id && <button onClick={() => setModal({ anular: r })} aria-label={`Anular ${r.numero}`} title="Anular" className="grid size-8 place-items-center rounded-md text-muted hover:bg-[#fdecec] hover:text-danger"><Ban className="size-4" /></button>}
                                                </div></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
            </Card>

            {enteros.length > 0 && (
                <Card className="mt-5">
                    <h3 className="px-5 pt-5 text-[15px] font-semibold">Pagos al SENIAT registrados</h3>
                    <ul className="divide-y divide-line px-5 pb-2 pt-1">
                        {enteros.map((e) => (
                            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[14px]">
                                <span><b className="num">{bs(e.monto)}</b> · retenciones del {dmy(e.desde)} al {dmy(e.hasta)}<span className="block text-[12.5px] text-muted">Pagado el {dmy(e.fecha_pago)}{e.referencia ? ` · ref. ${e.referencia}` : ''}{e.estado === 'ANULADO' ? ' · desmarcado' : ''}</span></span>
                                {e.estado === 'ACTIVO' && <button onClick={() => setModal({ desmarcar: e })} className="text-[13px] font-semibold text-brand hover:underline">Desmarcar</button>}
                            </li>
                        ))}
                    </ul>
                </Card>
            )}

            <div className="mt-5 space-y-2">
                {sinUt && <Alerta tono="warn">Registra la unidad tributaria en «Parámetros»: sin ella no se pueden retener pagos a personas naturales (el sustraendo depende de ella). Para personas jurídicas no hace falta.</Alerta>}
                <Alerta tono="info">La compra de mercancía a tus proveedores normalmente no se retiene: solo los pagos por servicios de la tabla (honorarios, comisiones, fletes, alquileres, contratistas). Los porcentajes son los del Decreto 1.808; confírmalos con tu contador, y la fecha para enterar con tu calendario del SENIAT.</Alerta>
            </div>

            {modal === 'nueva' && <ModalNueva d={p} cerrar={() => setModal(null)} listo={() => hecho('Retención registrada. Imprime su comprobante en la lista.')} />}
            {modal === 'ut' && <ModalParametros d={p} cerrar={() => setModal(null)} listo={() => hecho('Parámetros guardados.')} />}
            {modal === 'enterar' && <ModalEnterar d={p} cerrar={() => setModal(null)} listo={() => hecho('Pago al SENIAT registrado.')} />}
            {modal?.anular && <ModalMotivo titulo={`Anular la retención ${modal.anular.numero}`} texto="Queda anulada y su asiento se revierte. Entrega al beneficiario el comprobante corregido." ok="Anular" cerrar={() => setModal(null)} enviar={async (motivo) => { await http('POST', `/retenciones-islr/${modal.anular.id}/anular`, { motivo }); hecho('Retención anulada.'); }} />}
            {modal?.desmarcar && <ModalMotivo titulo="Desmarcar el pago al SENIAT" texto="Las retenciones vuelven a «por enterar» y el asiento del pago se revierte." ok="Desmarcar" cerrar={() => setModal(null)} enviar={async (motivo) => { await http('POST', `/retenciones-islr/enteros/${modal.desmarcar.id}/desmarcar`, { motivo }); hecho('Pago desmarcado.'); }} />}
        </AppLayout>
    );
}
