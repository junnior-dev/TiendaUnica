import { Head, router } from '@inertiajs/react';
import { useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, CircleAlert, FileSpreadsheet, Percent, Plus, Printer, SlidersHorizontal, Trash2 } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Modal, Toast, Vacio } from '../../Components/kit';
import { Field } from '../../Components/ui';
import { n2 } from '../../lib/format';
import { http } from '../../lib/http';
import { normalizarRif, validarRif } from '../../lib/rif';
import { construirBorradorIslr } from '../../lib/pdfDeclaracionIslr';
import { imprimirTicketCorte } from '../../lib/pdfTicketCorte';

const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const bs = (v) => (v === null || v === undefined ? 'Sin calcular' : `Bs ${n2(v)}`);
const num = (t) => { const x = String(t ?? '').trim(); return x ? Number(x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x) : NaN; };
const txt = (v) => (v === null || v === undefined || v === 0 ? '' : String(v).replace('.', ','));
const Alerta = ({ children, tono = 'bad' }) => (
    <p role={tono === 'bad' ? 'alert' : undefined} className={`flex items-start gap-2 rounded-lg p-3 text-[13.5px] leading-snug ${tono === 'bad' ? 'bg-[#fdecec] text-danger' : 'bg-signal/15 text-[#7a4d00]'}`}>
        <CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{children}</span>
    </p>
);
const Pill = ({ c, children }) => <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${c}`}>{children}</span>;
const msg = (e) => Object.values(e.errors || {})[0]?.[0] || e.message;

/* ───── Cifras que aporta el contador ───── */
function ModalDatos({ d, cerrar, listo }) {
    const x = d.declaracion;
    const [f, setF] = useState({ desde: x.desde, hasta: x.hasta, costo: txt(x.costo_ventas), gastos: txt(x.gastos), otras: txt(x.otras), ajuste: txt(x.ajuste), rebajas: txt(x.rebajas), notas: x.notas || '' });
    const [err, setErr] = useState(''); const [env, setEnv] = useState(false);
    const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
    const enviar = async () => {
        const n = (k, vacio = 0) => (String(f[k]).trim() === '' ? vacio : num(f[k]));
        const cifras = { costo_ventas: n('costo', null), gastos: n('gastos'), otras: n('otras'), ajuste: n('ajuste'), rebajas: n('rebajas') };
        if (Object.values(cifras).some((v) => v !== null && Number.isNaN(v))) return setErr('Revisa los montos: solo números (por ejemplo 1.250,50).');
        setEnv(true);
        try { const r = await http('POST', '/declaracion-islr/datos', { ejercicio: d.ejercicio, desde: f.desde, hasta: f.hasta, ...cifras, notas: f.notas.trim() || null }); listo('Datos del ejercicio guardados', r); }
        catch (e) { setErr(msg(e)); setEnv(false); }
    };
    return (
        <Modal titulo="Datos del contador" subtitulo="Lo que el sistema no puede saber. Todo en bolívares y sin IVA." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Guardar" ancho="max-w-[560px]">
            {err && <Alerta>{err}</Alerta>}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field type="date" forceFloat label="El ejercicio empieza" value={f.desde} onChange={set('desde')} />
                <Field type="date" forceFloat label="El ejercicio termina" value={f.hasta} onChange={set('hasta')} />
            </div>
            <Field label="Costo de lo vendido (opcional)" inputMode="decimal" value={f.costo} onChange={set('costo')} hint={`Si lo dejas vacío se usa el del sistema: Bs ${n2(d.borrador.costo_sistema)}.`} />
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Gastos deducibles" inputMode="decimal" value={f.gastos} onChange={set('gastos')} />
                <Field label="Otras deducciones" inputMode="decimal" value={f.otras} onChange={set('otras')} />
                <Field label="Ajuste por inflación" inputMode="decimal" value={f.ajuste} onChange={set('ajuste')} hint="Con signo: negativo si resta." />
                <Field label="Rebajas de impuesto" inputMode="decimal" value={f.rebajas} onChange={set('rebajas')} />
            </div>
            <Field label="Notas (opcional)" value={f.notas} onChange={set('notas')} maxLength={300} />
        </Modal>
    );
}

/* ───── Tarifa por tramos en unidades tributarias ───── */
function ModalTramos({ d, cerrar, listo }) {
    const vacio = [{ desde_ut: '0', hasta_ut: '', pct: '', sustraendo_ut: '' }];
    const [filas, setFilas] = useState(d.tramos.length ? d.tramos.map((t) => ({ desde_ut: String(t.desde_ut), hasta_ut: t.hasta_ut === null ? '' : String(t.hasta_ut), pct: String(t.pct), sustraendo_ut: t.sustraendo_ut ? String(t.sustraendo_ut) : '' })) : vacio);
    const [err, setErr] = useState(''); const [env, setEnv] = useState(false);
    const set = (i, k) => (e) => setFilas((p) => p.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
    const agregar = () => setFilas((p) => [...p.map((x, j) => (j === p.length - 1 ? x : x)), { desde_ut: p[p.length - 1].hasta_ut, hasta_ut: '', pct: '', sustraendo_ut: '' }]);
    const quitar = (i) => setFilas((p) => (p.length === 1 ? p : p.filter((_, j) => j !== i)));
    const enviar = async () => {
        const tramos = filas.map((x) => ({ desde_ut: num(x.desde_ut), hasta_ut: String(x.hasta_ut).trim() === '' ? null : num(x.hasta_ut), pct: num(x.pct), sustraendo_ut: String(x.sustraendo_ut).trim() === '' ? 0 : num(x.sustraendo_ut) }));
        if (tramos.some((t) => Number.isNaN(t.desde_ut) || Number.isNaN(t.pct) || Number.isNaN(t.sustraendo_ut) || (t.hasta_ut !== null && Number.isNaN(t.hasta_ut)))) return setErr('Revisa los números de los tramos.');
        setEnv(true);
        try { const r = await http('POST', '/declaracion-islr/tramos', { ejercicio: d.ejercicio, tramos }); listo('Tarifa guardada', r); }
        catch (e) { setErr(msg(e)); setEnv(false); }
    };
    const vaciar = async () => {
        setEnv(true);
        try { const r = await http('POST', '/declaracion-islr/tramos', { ejercicio: d.ejercicio, tramos: [] }); listo('Tarifa eliminada', r); } catch (e) { setErr(msg(e)); setEnv(false); }
    };
    return (
        <Modal titulo={`Tarifa del ejercicio ${d.ejercicio}`} subtitulo="Tu contador te indica los tramos. Impuesto = renta en UT × porcentaje − sustraendo en UT. El primer tramo empieza en 0, cada uno empieza donde termina el anterior y el último queda sin tope (deja «Hasta» vacío). Desde, hasta y sustraendo van en UT." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Guardar tarifa" ancho="max-w-[620px]">
            {err && <Alerta>{err}</Alerta>}
            <div className="space-y-3">
                {filas.map((x, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_0.8fr_1fr_auto] items-start gap-2">
                        <Field label="Desde (UT)" inputMode="decimal" value={x.desde_ut} onChange={set(i, 'desde_ut')} readOnly={i === 0 || undefined} />
                        <Field label="Hasta (UT)" inputMode="decimal" value={x.hasta_ut} onChange={set(i, 'hasta_ut')} />
                        <Field label="%" inputMode="decimal" value={x.pct} onChange={set(i, 'pct')} />
                        <Field label="Sustraendo" inputMode="decimal" value={x.sustraendo_ut} onChange={set(i, 'sustraendo_ut')} />
                        <button type="button" onClick={() => quitar(i)} aria-label="Quitar tramo" className="mt-2 grid size-9 place-items-center rounded-md text-muted hover:bg-[#fdecec] hover:text-danger"><Trash2 className="size-4" /></button>
                    </div>
                ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={agregar} className="inline-flex h-9 items-center gap-1.5 text-[13.5px] font-semibold text-brand hover:underline"><Plus className="size-4" />Agregar tramo</button>
                {d.tramos.length > 0 && <button type="button" onClick={vaciar} disabled={env} className="text-[13.5px] font-semibold text-danger hover:underline disabled:opacity-50">Quitar toda la tarifa</button>}
            </div>
        </Modal>
    );
}

function ModalAnticipo({ d, cerrar, listo }) {
    const [f, setF] = useState({ fecha: d.hoy, periodo: '', monto: '', referencia: '' });
    const [err, setErr] = useState({}); const [env, setEnv] = useState(false);
    const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
    const enviar = async () => {
        const monto = num(f.monto);
        if (!(monto > 0)) return setErr({ monto: 'Escribe cuánto pagaste.' });
        setEnv(true);
        try { const r = await http('POST', '/declaracion-islr/anticipos', { ejercicio: d.ejercicio, fecha: f.fecha, periodo: f.periodo ? `${f.periodo}-01` : null, monto, referencia: f.referencia.trim() || null }); listo('Anticipo registrado', r); }
        catch (e) { setErr({ general: msg(e) }); setEnv(false); }
    };
    return (
        <Modal titulo="Registrar un anticipo" subtitulo="Un pago de la declaración estimada que ya hiciste en el portal. Con contabilidad automática se asienta: Anticipos de ISLR contra Bancos." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Registrar">
            {err.general && <Alerta>{err.general}</Alerta>}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field type="date" forceFloat label="Fecha del pago" value={f.fecha} onChange={set('fecha')} />
                <Field type="month" forceFloat label="Mes que cubre (opcional)" value={f.periodo} onChange={set('periodo')} />
            </div>
            <Field label="Monto pagado (Bs)" inputMode="decimal" value={f.monto} onChange={set('monto')} error={err.monto} />
            <Field label="Referencia o planilla (opcional)" value={f.referencia} onChange={set('referencia')} maxLength={60} />
        </Modal>
    );
}

function ModalRecibida({ d, cerrar, listo }) {
    const [f, setF] = useState({ fecha: d.hoy, agente: '', rif: '', comprobante: '', documento: '', base: '', retenido: '' });
    const [err, setErr] = useState({}); const [env, setEnv] = useState(false);
    const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
    const rifMal = f.rif.trim() ? validarRif(f.rif) : null;
    const enviar = async () => {
        const er = {}; const base = num(f.base), ret = num(f.retenido);
        if (f.agente.trim().length < 3) er.agente = 'Escribe el nombre de tu cliente.';
        if (!f.rif.trim() || rifMal) er.rif = rifMal || 'Escribe el RIF de tu cliente.';
        if (!(base > 0)) er.base = 'Escribe la base.';
        if (!(ret > 0)) er.retenido = 'Escribe lo que te retuvieron.'; else if (ret > base) er.retenido = 'No puede ser mayor que la base.';
        setErr(er); if (Object.keys(er).length) return;
        setEnv(true);
        try { const r = await http('POST', '/declaracion-islr/retenciones-recibidas', { ejercicio: d.ejercicio, fecha: f.fecha, agente: f.agente.trim(), rif: normalizarRif(f.rif), comprobante: f.comprobante.trim() || null, documento: f.documento.trim() || null, base, retenido: ret }); listo('Retención registrada', r); }
        catch (e) { setErr({ general: msg(e) }); setEnv(false); }
    };
    return (
        <Modal titulo="Retención que te practicaron" subtitulo="Cuando un cliente te retiene ISLR y te entrega su comprobante. Se descuenta del impuesto del ejercicio." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Registrar" ancho="max-w-[520px]">
            {err.general && <Alerta>{err.general}</Alerta>}
            <Field label="Nombre o razón social de tu cliente" value={f.agente} onChange={set('agente')} error={err.agente} />
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="RIF" value={f.rif} onChange={(e) => setF((p) => ({ ...p, rif: e.target.value.toUpperCase() }))} onBlur={() => setF((p) => ({ ...p, rif: normalizarRif(p.rif) }))} error={err.rif || rifMal} />
                <Field type="date" forceFloat label="Fecha del comprobante" value={f.fecha} onChange={set('fecha')} />
                <Field label="N.º de comprobante" value={f.comprobante} onChange={set('comprobante')} maxLength={40} />
                <Field label="Tu factura (opcional)" value={f.documento} onChange={set('documento')} maxLength={40} />
                <Field label="Base (Bs, sin IVA)" inputMode="decimal" value={f.base} onChange={set('base')} error={err.base} />
                <Field label="Monto retenido (Bs)" inputMode="decimal" value={f.retenido} onChange={set('retenido')} error={err.retenido} />
            </div>
        </Modal>
    );
}

function ModalPagar({ d, cerrar, listo }) {
    const [fecha, setFecha] = useState(d.hoy); const [err, setErr] = useState(''); const [env, setEnv] = useState(false);
    const enviar = async () => {
        setEnv(true);
        try { const r = await http('POST', '/declaracion-islr/pagar', { ejercicio: d.ejercicio, fecha }); listo('Pago registrado en la contabilidad', r); } catch (e) { setErr(msg(e)); setEnv(false); }
    };
    return (
        <Modal titulo="Registrar el pago del saldo" subtitulo="El pago ya hecho al SENIAT: ISLR del ejercicio por pagar contra Bancos." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Registrar pago">
            {err && <Alerta>{err}</Alerta>}
            <Field type="date" forceFloat label="Fecha del pago" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Modal>
    );
}

function Contabilidad({ p, abrir, accion }) {
    const c = p.contab; const b = p.borrador;
    if (!c?.disponible) return null;
    const neto = b.impuesto_neto;
    return (
        <Card className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold">Contabilidad del ISLR</h2>
                    <p className="mt-0.5 text-[13.5px] text-muted">
                        {!c.automatica ? 'La contabilidad automática está apagada: actívala para que el ISLR genere sus asientos.'
                            : c.pagada ? 'Liquidado y pagado: el gasto, los créditos y el pago ya están en el libro diario.'
                            : c.liquidada ? 'Liquidado en los libros. Falta registrar el pago del saldo al SENIAT.'
                            : neto === null || neto <= 0 ? 'Cuando el impuesto neto esté calculado podrás liquidarlo en los libros.'
                            : `Al cerrar el ejercicio, liquida el impuesto (${bs(neto)}) contra tus anticipos y retenciones recibidas.`}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {c.automatica && !c.liquidada && neto > 0 && <button type="button" onClick={() => accion('/declaracion-islr/liquidar', 'ISLR liquidado en la contabilidad')} className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-[14px] font-semibold text-white hover:bg-brand-600">Liquidar en la contabilidad</button>}
                    {c.liquidada && !c.pagada && <button type="button" onClick={() => abrir({ t: 'pagar' })} className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-[14px] font-semibold text-white hover:bg-brand-600">Registrar pago del saldo</button>}
                    {c.liquidada && !c.pagada && <button type="button" onClick={() => accion('/declaracion-islr/revertir', 'Liquidación revertida')} className="inline-flex h-10 items-center rounded-lg border border-line px-3.5 text-[14px] font-semibold hover:bg-paper">Revertir</button>}
                    {c.liquidada && c.pagada && <Pill c="bg-[#e3f4ea] text-ok">Liquidado y pagado</Pill>}
                </div>
            </div>
        </Card>
    );
}

function ModalAnular({ ej, cerrar, listo }) {
    const [motivo, setMotivo] = useState(''); const [err, setErr] = useState(''); const [env, setEnv] = useState(false);
    const enviar = async () => {
        if (motivo.trim().length < 3) return setErr('Escribe el motivo.');
        setEnv(true);
        try { const r = await http('POST', ej.url, { ejercicio: ej.ejercicio, motivo: motivo.trim() }); listo('Registro anulado', r); } catch (e) { setErr(msg(e)); setEnv(false); }
    };
    return (
        <Modal titulo="Anular registro" subtitulo={ej.texto} cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Anular" peligro>
            {err && <Alerta>{err}</Alerta>}
            <Field label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
        </Modal>
    );
}

const Linea = ({ a, v, b, sub, tono }) => (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${sub ? 'pl-4 text-[13.5px] text-muted' : 'text-[14.5px]'} ${b ? 'font-semibold' : ''}`}>
        <span>{a}</span><span className={`num whitespace-nowrap ${tono === 'bad' ? 'text-danger' : tono === 'ok' ? 'text-ok' : ''}`}>{v}</span>
    </div>
);

export default function Index(p) {
    const { usuario, negocio, stock_bajo, tasa_usd, instalado, ejercicio } = p;
    const [modal, setModal] = useState(null);
    const [aviso, setAviso] = useState('');
    const layout = { actual: '/declaracion-islr', titulo: 'Declaración de ISLR', subtitulo: 'Borrador de trabajo del ejercicio: ingresos, retenciones y anticipos', usuario, negocio, stockBajo: stock_bajo, tasaUsd: tasa_usd };
    const accion = async (url, texto) => {
        try { await http('POST', url, { ejercicio }); hecho(texto); } catch (e) { setAviso(msg(e)); }
    };
    const hecho = (t) => { setModal(null); setAviso(t); router.reload({ preserveScroll: true }); };

    if (!instalado) return (
        <AppLayout {...layout}><Head title="Declaración de ISLR" />
            <Card><Vacio icon={FileSpreadsheet} titulo="Falta instalar este módulo" texto="Ejecuta 36_islr_declaracion.sql (requiere el 20, el 21 o 22 y el 31) en tu base de datos y recarga la página." /></Card>
        </AppLayout>
    );

    const { borrador: b, tramos, anticipos, sufridas } = p;
    const ir = (e) => router.get('/declaracion-islr', { ejercicio: e }, { preserveState: true, replace: true });
    const imprimir = async () => imprimirTicketCorte(await construirBorradorIslr({ borrador: b, tramos, anticipos, sufridas, contribuyente: p.contribuyente }), `borrador-islr-${b.ejercicio}.pdf`);
    const perdida = b.renta_neta < 0;
    const tabla = (cols, filas) => (
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-[14px]">
            <thead><tr className="border-b border-line text-[12.5px] text-muted">{cols.map((c, i) => <th key={i} className={`px-5 py-2.5 font-medium ${i >= cols.length - 2 ? 'text-right' : ''}`}>{c}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{filas}</tbody></table></div>
    );
    return (
        <AppLayout {...layout}>
            <Head title="Declaración de ISLR" />
            <Toast texto={aviso} />
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-white p-1">
                    <button type="button" onClick={() => ir(ejercicio - 1)} aria-label="Ejercicio anterior" className="grid size-9 place-items-center rounded-lg hover:bg-paper"><ChevronLeft className="size-4" /></button>
                    <span className="min-w-[110px] text-center text-[14.5px] font-semibold tabular-nums">Ejercicio {ejercicio}</span>
                    <button type="button" onClick={() => ir(ejercicio + 1)} aria-label="Ejercicio siguiente" className="grid size-9 place-items-center rounded-lg hover:bg-paper"><ChevronRight className="size-4" /></button>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setModal({ t: 'tramos' })} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[14px] font-semibold hover:bg-paper"><Percent className="size-4" />Tarifa</button>
                    <button type="button" onClick={() => setModal({ t: 'datos' })} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[14px] font-semibold hover:bg-paper"><SlidersHorizontal className="size-4" />Datos del contador</button>
                    <button type="button" onClick={imprimir} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-[14px] font-semibold text-white hover:bg-brand-600"><Printer className="size-4" />Imprimir borrador</button>
                </div>
            </div>

            {b.avisos.length > 0 && <div className="mt-5 space-y-2">{b.avisos.map((a, i) => <Alerta key={i} tono="warn">{a}</Alerta>)}</div>}

            <Card className="mt-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
                    <h2 className="text-[15px] font-semibold">Del {dmy(b.desde)} al {dmy(b.hasta)}</h2>
                    <span className="text-[13px] text-muted">{b.ut ? `Unidad tributaria: Bs ${n2(b.ut)}` : 'Sin unidad tributaria registrada'}</span>
                </div>
                <div className="divide-y divide-line px-5">
                    <div>
                        <Linea a={`Ingresos brutos (libro de ventas, sin IVA · ${b.documentos} documentos)`} v={bs(b.ingresos)} />
                        <Linea a={b.costo_manual ? 'Costo de lo vendido (cifra del contador)' : 'Costo de lo vendido (costo congelado en cada venta)'} v={`− ${bs(b.costo)}`} />
                        <Linea a="Renta bruta" v={bs(b.renta_bruta)} b />
                    </div>
                    <div>
                        <Linea a="Gastos deducibles" v={`− ${bs(b.gastos)}`} />
                        <Linea a="Otras deducciones" v={`− ${bs(b.otras_deducciones)}`} />
                        <Linea a="Ajuste por inflación" v={bs(b.ajuste_inflacion)} />
                        <Linea a={perdida ? 'Resultado del ejercicio (pérdida)' : 'Renta neta'} v={bs(b.renta_neta)} b tono={perdida ? 'bad' : undefined} />
                        {b.renta_neta_ut !== null && <Linea sub a="Renta neta en unidades tributarias" v={`${n2(b.renta_neta_ut)} UT`} />}
                    </div>
                    <div>
                        {b.tramo && <Linea sub a={b.tramo.hasta_ut === null ? `Tramo: más de ${b.tramo.desde_ut} UT` : `Tramo: de ${b.tramo.desde_ut} a ${b.tramo.hasta_ut} UT`} v={`${String(b.tramo.pct).replace('.', ',')} % − sustraendo ${n2(b.tramo.sustraendo_ut)} UT`} />}
                        <Linea a="Impuesto estimado" v={bs(b.impuesto)} b />
                        <Linea a="Rebajas" v={`− ${bs(b.rebajas)}`} />
                        <Linea a="Impuesto neto" v={bs(b.impuesto_neto)} b />
                        <Linea a="Retenciones que te practicaron" v={`− ${bs(b.retenciones_sufridas)}`} />
                        <Linea a="Anticipos pagados" v={`− ${bs(b.anticipos)}`} />
                    </div>
                    <div className="py-1">
                        <Linea a={b.saldo === null ? 'Saldo' : b.saldo >= 0 ? 'Saldo a pagar' : 'Saldo a favor'} v={b.saldo === null ? 'Sin calcular' : bs(Math.abs(b.saldo))} b tono={b.saldo === null ? undefined : b.saldo >= 0 ? 'bad' : 'ok'} />
                    </div>
                </div>
                <p className="border-t border-line px-5 py-3 text-[12.5px] leading-snug text-muted">Es una hoja de trabajo: la declaración se presenta en el portal del SENIAT. La renta neta fiscal, las deducciones, el ajuste por inflación y la tarifa los confirma tu contador. ISLR retenido a tus proveedores en el ejercicio: {bs(b.retenido_practicado)} (por enterar: {bs(b.retenido_por_enterar)}).</p>
            </Card>

            <Contabilidad p={p} abrir={setModal} accion={accion} />

            <div className="mt-5 grid gap-5 xl:grid-cols-2">
                <Card>
                    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                        <div><h2 className="text-[15px] font-semibold">Anticipos pagados</h2><p className="text-[13px] text-muted">Declaración estimada ya pagada</p></div>
                        <button type="button" onClick={() => setModal({ t: 'anticipo' })} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13.5px] font-semibold hover:bg-paper"><Plus className="size-4" />Registrar</button>
                    </div>
                    {anticipos.length === 0 ? <Vacio icon={FileSpreadsheet} titulo="Sin anticipos en este ejercicio" texto="Registra cada pago de la declaración estimada para que se descuente del saldo." /> : tabla(['Fecha', 'Mes', 'Monto', ''], anticipos.map((x) => (
                        <tr key={x.id} className={x.estado === 'ANULADO' ? 'text-muted' : ''}>
                            <td className="whitespace-nowrap px-5 py-2.5">{dmy(x.fecha)}</td><td className="px-5 py-2.5">{x.periodo ? `${x.periodo.slice(5, 7)}/${x.periodo.slice(0, 4)}` : '—'}</td>
                            <td className="num px-5 py-2.5 text-right">{x.estado === 'ANULADO' ? <Pill c="bg-paper text-muted">Anulado</Pill> : bs(x.monto)}</td>
                            <td className="px-5 py-2.5 text-right">{x.estado === 'ACTIVO' && <button type="button" onClick={() => setModal({ t: 'anular', url: `/declaracion-islr/anticipos/${x.id}/anular`, texto: `Anticipo del ${dmy(x.fecha)} por ${bs(x.monto)}.` })} aria-label="Anular" className="grid size-8 place-items-center rounded-md text-muted hover:bg-[#fdecec] hover:text-danger"><Ban className="size-4" /></button>}</td>
                        </tr>
                    )))}
                </Card>
                <Card>
                    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                        <div><h2 className="text-[15px] font-semibold">Retenciones que te practicaron</h2><p className="text-[13px] text-muted">Comprobantes que te entregan tus clientes</p></div>
                        <button type="button" onClick={() => setModal({ t: 'recibida' })} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13.5px] font-semibold hover:bg-paper"><Plus className="size-4" />Registrar</button>
                    </div>
                    {sufridas.length === 0 ? <Vacio icon={FileSpreadsheet} titulo="Sin retenciones en este ejercicio" texto="Cuando un cliente te retenga ISLR, registra su comprobante para descontarlo del impuesto." /> : tabla(['Fecha', 'Cliente', 'Retenido', ''], sufridas.map((x) => (
                        <tr key={x.id} className={x.estado === 'ANULADO' ? 'text-muted' : ''}>
                            <td className="whitespace-nowrap px-5 py-2.5">{dmy(x.fecha)}</td>
                            <td className="px-5 py-2.5"><p className="font-medium text-ink">{x.agente}</p><p className="text-[12.5px] text-muted">{x.rif}{x.comprobante ? ` · comp. ${x.comprobante}` : ''}</p></td>
                            <td className="num px-5 py-2.5 text-right">{x.estado === 'ANULADO' ? <Pill c="bg-paper text-muted">Anulada</Pill> : bs(x.retenido)}</td>
                            <td className="px-5 py-2.5 text-right">{x.estado === 'ACTIVO' && <button type="button" onClick={() => setModal({ t: 'anular', url: `/declaracion-islr/retenciones-recibidas/${x.id}/anular`, texto: `Retención de ${x.agente} por ${bs(x.retenido)}.` })} aria-label="Anular" className="grid size-8 place-items-center rounded-md text-muted hover:bg-[#fdecec] hover:text-danger"><Ban className="size-4" /></button>}</td>
                        </tr>
                    )))}
                </Card>
            </div>

            {modal?.t === 'datos' && <ModalDatos d={p} cerrar={() => setModal(null)} listo={hecho} />}
            {modal?.t === 'tramos' && <ModalTramos d={p} cerrar={() => setModal(null)} listo={hecho} />}
            {modal?.t === 'anticipo' && <ModalAnticipo d={p} cerrar={() => setModal(null)} listo={hecho} />}
            {modal?.t === 'recibida' && <ModalRecibida d={p} cerrar={() => setModal(null)} listo={hecho} />}
            {modal?.t === 'pagar' && <ModalPagar d={p} cerrar={() => setModal(null)} listo={hecho} />}
            {modal?.t === 'anular' && <ModalAnular ej={{ ...modal, ejercicio }} cerrar={() => setModal(null)} listo={hecho} />}
        </AppLayout>
    );
}
