import { Head, router } from '@inertiajs/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, CalendarClock, CircleAlert, Info, Lock, Pencil, Plus, PlugZap, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Chip, Fuente, Modal as ModalKit, Sparkline, Titulo } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { http } from '../../lib/http';
import { NOMBRE, SIMBOLO, n2, pct, registrarMonedas, tasa as fTasa } from '../../lib/format';

/* Título de cada tarjeta: «Euro a bolívar», o «Dólar a peso colombiano» si la moneda vale menos de 1 Bs. */
const parInfo = (t) => (t.por_dolar != null
    ? { titulo: `Dólar a ${t.nombre.toLowerCase()}`, sub: `1 US$ en ${t.par}` }
    : { titulo: `${t.par === 'USD' ? 'Dólar' : t.nombre} a bolívar`, sub: `1 ${SIMBOLO[t.par]} en Bs` });
const fecha = (f) => f.split('-').reverse().join('/');

/* ── Tarjeta de una tasa ── */
function TasaCard({ t, onEditar }) {
    const p = parInfo(t);
    const valor = t.por_dolar != null ? { pre: t.par, v: n2(t.por_dolar) } : { pre: 'Bs', v: fTasa(t.tasa) };
    const sube = (t.variacion_pct ?? 0) >= 0;
    return (
        <Card className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3"><Chip m={t.par} /><div><p className="text-[15px] font-semibold">{p.titulo}</p><p className="text-[13px] text-muted">{p.sub}</p></div></div>
                <Fuente f={t.fuente} />
            </div>
            <p className="num mt-5 flex items-baseline gap-2 text-[34px] font-semibold leading-none tracking-[-0.02em]"><span className="text-lg font-medium text-muted">{valor.pre}</span>{valor.v}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                {t.variacion_pct != null && <span className={`inline-flex items-center gap-1 font-medium ${sube ? 'text-ok' : 'text-danger'}`}>{sube ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}{pct(t.variacion_pct, true)}</span>}
                <span className="inline-flex items-center gap-1.5 text-muted"><span className={`size-1.5 rounded-full ${t.vigente ? 'bg-ok' : 'bg-signal'}`} />{t.vigente ? 'Vigente' : 'Desactualizada'} · {fecha(t.fecha)}</span>
            </div>
            <div className="mt-3 min-h-14">
                {t.serie?.length > 1 ? (<><Sparkline serie={t.serie} light /><div className="flex justify-between text-[11px] text-muted"><span>{t.serie_desde}</span><span>{t.serie_hasta}</span></div></>)
                    : <p className="rounded-lg bg-paper px-3 py-2.5 text-[13px] text-muted">El historial de esta tasa empieza hoy.</p>}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-3.5 text-[13px]">
                <span className="text-muted">{t.por_dolar != null ? `Se guarda como 1 ${t.par} = Bs ${fTasa(t.tasa)}` : 'Se guarda tal cual'}</span>
                <button onClick={() => onEditar(t)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-brand hover:bg-brand-50"><Pencil className="size-3.5" />Editar</button>
            </div>
        </Card>
    );
}

/* ── Qué monedas usa el negocio ── */
function Monedas({ monedas, cambiar, agregar }) {
    return (
        <Card>
            <Titulo>Monedas con las que trabajas</Titulo>
            <p className="px-5 pt-1 text-[13px] leading-snug text-muted">Los precios y los totales se guardan en la moneda base. Activa las otras monedas en las que recibes pagos.</p>
            <ul className="px-5 pb-3 pt-3">
                {monedas.map((m) => (
                    <li key={m.codigo} className="flex items-center gap-3 border-t border-line py-3 first:border-t-0">
                        <Chip m={m.codigo} />
                        <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 text-sm font-medium">{m.nombre}{m.base && <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-medium text-white">Moneda base</span>}</p>
                            <p className="text-xs text-muted">{m.base ? 'Todos los precios se guardan en dólares.' : m.bloqueada ? 'Siempre activa: es la moneda del país.' : m.activa ? 'Aceptas pagos en esta moneda.' : 'No aceptas pagos en esta moneda.'}{m.sin_tasa && m.activa && <button type="button" onClick={() => agregar(m.codigo)} className="ml-1.5 font-medium text-brand hover:underline">Falta su tasa</button>}</p>
                        </div>
                        {m.bloqueada || m.base ? <Lock className="size-4 text-[#9aa4af]" aria-label="No se puede desactivar" />
                            : <button role="switch" aria-checked={m.activa} aria-label={`${m.activa ? 'Desactivar' : 'Activar'} ${m.nombre}`} onClick={() => cambiar(m.codigo, !m.activa)} className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${m.activa ? 'bg-brand' : 'bg-[#c5ccd4]'}`}><span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${m.activa ? 'left-[18px]' : 'left-0.5'}`} /></button>}
                    </li>
                ))}
            </ul>
        </Card>
    );
}

/* ── Convertidor ── */
function Convertidor({ tasas }) {
    const r = { VES: 1, ...Object.fromEntries(tasas.map((t) => [t.par, t.tasa])) };
    const codigos = ['VES', ...tasas.map((t) => t.par)];
    const [monto, setMonto] = useState('100'); const [de, setDe] = useState('USD'); const [a, setA] = useState('VES');
    const v = Number(String(monto).replace(/\./g, '').replace(',', '.')) || 0;
    const res = (v * r[de]) / r[a], unit = r[de] / r[a];
    const fmt = (x) => (x >= 1 ? n2(x) : fTasa(x));
    const Sel = ({ label, value, set }) => (
        <Field select label={label} value={value} onChange={(e) => set(e.target.value)}>{codigos.map((c) => <option key={c} value={c}>{c} · {NOMBRE[c]}</option>)}</Field>
    );
    return (
        <Card>
            <Titulo>Convertidor</Titulo>
            <p className="px-5 pt-1 text-[13px] text-muted">Con las tasas de hoy. Útil para cotizar al cliente sin sacar la calculadora.</p>
            <div className="space-y-4 px-5 pb-5 pt-4">
                <Field label="Monto" icon={SlidersHorizontal} value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="decimal" className="[&_input]:num" />
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <Sel label="De" value={de} set={setDe} />
                    <button onClick={() => { setDe(a); setA(de); }} aria-label="Intercambiar monedas" className="grid size-10 place-items-center rounded-full border border-line hover:bg-paper"><ArrowLeftRight className="size-4" /></button>
                    <Sel label="A" value={a} set={setA} />
                </div>
                <div className="rounded-xl bg-ink p-4 text-white">
                    <p className="text-[13px] text-white/60">{fmt(v)} {de} equivalen a</p>
                    <p className="num mt-1 text-[30px] font-semibold leading-none tracking-[-0.02em]">{a === 'VES' ? 'Bs' : SIMBOLO[a]} {fmt(res)}</p>
                    <p className="num mt-2 text-xs text-white/50">1 {de} = {fmt(unit)} {a}</p>
                </div>
            </div>
        </Card>
    );
}

/* ── Historial ── */
function Historial({ filas }) {
    const [f, setF] = useState('TODAS');
    const opciones = [['TODAS', 'Todas'], ...[...new Set(filas.map((x) => x.origen))].map((c) => [c, c])];
    const vis = useMemo(() => filas.filter((x) => f === 'TODAS' || x.origen === f), [f, filas]);
    return (
        <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
                <h2 className="text-[15px] font-semibold">Historial de tasas</h2>
                <div role="radiogroup" aria-label="Filtrar por moneda" className="inline-flex rounded-lg bg-[#e9ecf0] p-1 text-[13px]">
                    {opciones.map(([k, l]) => <button key={k} role="radio" aria-checked={f === k} onClick={() => setF(k)} className={`rounded-md px-3 py-1 font-medium ${f === k ? 'bg-white shadow-sm' : 'text-muted hover:text-text'}`}>{l}</button>)}
                </div>
            </div>
            <div className="overflow-x-auto px-2 pb-2 pt-2">
                <table className="w-full min-w-[620px] text-sm">
                    <thead><tr className="text-left text-[13px] text-muted"><th className="px-3 py-2 font-medium">Fecha valor</th><th className="px-3 py-2 font-medium">Par</th><th className="px-3 py-2 text-right font-medium">Tasa (Bs)</th><th className="px-3 py-2 font-medium">Fuente</th><th className="px-3 py-2 font-medium">Registrada</th><th className="px-3 py-2 font-medium">Estado</th></tr></thead>
                    <tbody>
                        {vis.map((x) => (
                            <tr key={`${x.origen}${x.fecha}`} className="border-t border-line">
                                <td className="num px-3 py-3">{fecha(x.fecha)}</td>
                                <td className="px-3 py-3"><span className="inline-flex items-center gap-2"><Chip m={x.origen} size="sm" />{x.origen} → VES</span></td>
                                <td className="num px-3 py-3 text-right font-medium">{fTasa(x.tasa)}</td>
                                <td className="px-3 py-3"><Fuente f={x.fuente} /></td>
                                <td className="px-3 py-3 text-muted">{x.registrada}</td>
                                <td className="px-3 py-3">{x.vigente ? <span className="inline-flex items-center gap-1.5 text-ok"><span className="size-1.5 rounded-full bg-ok" />En uso</span> : <span className="text-muted">Anterior</span>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

/* ── Edición manual ── */
function Modal({ t, cerrar, error }) {
    const [valor, setValor] = useState(String(t.por_dolar != null ? t.por_dolar : t.tasa).replace('.', ','));
    const [f, setF] = useState(t.fecha); const [fuente, setFuente] = useState('MANUAL');
    const enviar = (e) => { e.preventDefault(); router.post('/tasas/manual', { par: t.par, valor, fecha_valor: f, fuente }, { onSuccess: cerrar }); };
    return (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Editar tasa">
            <div className="absolute inset-0 bg-black/50" onClick={cerrar} />
            <form onSubmit={enviar} className="relative w-full max-w-[440px] rounded-2xl bg-white p-6 shadow-2xl">
                <div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">Editar {parInfo(t).titulo.toLowerCase()}</h2><p className="mt-1 text-[13px] text-muted">La tasa nueva se usa en las ventas siguientes. Las ventas ya hechas conservan la suya.</p></div><button type="button" onClick={cerrar} aria-label="Cerrar" className="grid size-8 place-items-center rounded-md hover:bg-paper"><X className="size-4" /></button></div>
                <div className="mt-5 space-y-4">
                    <Field label={t.por_dolar != null ? `${t.nombre} por 1 dólar` : 'Bolívares por unidad'} value={valor} onChange={(e) => setValor(e.target.value)} error={error} inputMode="decimal" autoFocus className="[&_input]:num" />
                    <Field label="Fecha valor" forceFloat type="date" value={f} onChange={(e) => setF(e.target.value)} />
                    <Field select label="¿De dónde sale?" value={fuente} onChange={(e) => setFuente(e.target.value)}><option value="MANUAL">La escribí yo</option><option value="BCV">Banco Central de Venezuela (oficial)</option></Field>
                </div>
                <div className="mt-6 flex justify-end gap-3"><Button type="button" variant="ghost" onClick={cerrar}>Cancelar</Button><Button type="submit">Guardar tasa</Button></div>
            </form>
        </div>
    );
}

/* ── Agregar una tasa: se elige el par y, al elegirlo, se muestra la cotización de ExchangeRate-API ── */
const aTexto = (v) => { const t = v >= 1 ? v.toFixed(4) : v.toFixed(8); return t.replace(/0+$/, '').replace(/\.$/, '').replace('.', ','); };
const cotiz = (v) => (v >= 1 ? n2(v) : new Intl.NumberFormat('es-VE', { maximumFractionDigits: 8 }).format(v));

function ModalAgregar({ catalogo, inicial, hoy, cerrar, errors }) {
    const [de, setDe] = useState(inicial?.de || 'EUR'); const [a, setA] = useState(inicial?.a || 'VES');
    const [valor, setValor] = useState(''); const [f, setF] = useState(hoy); const [fuente, setFuente] = useState('MANUAL');
    const [cot, setCot] = useState({ estado: 'idle' }); const [env, setEnv] = useState(false);
    const tocado = useRef(false);
    useEffect(() => {
        if (!de || !a || de === a) { setCot({ estado: de === a ? 'igual' : 'idle' }); return undefined; }
        const ctl = new AbortController(); setCot({ estado: 'cargando' });
        const t = setTimeout(async () => {
            try {
                const r = await http('GET', `/tasas/consulta?de=${de}&a=${a}`, undefined, ctl.signal);
                setCot({ estado: 'listo', ...r });
                if (r.api && !tocado.current) { setValor(aTexto(r.api.valor)); setFuente('EXCHANGERATE_API'); if (r.api.fecha <= hoy) setF(r.api.fecha); }
                if (!r.api && fuente === 'EXCHANGERATE_API') setFuente('MANUAL');
            } catch (e) { if (e.name !== 'AbortError') setCot({ estado: 'error', message: e.message }); }
        }, 250);
        return () => { clearTimeout(t); ctl.abort(); };
    }, [de, a]);                                                   // eslint-disable-line react-hooks/exhaustive-deps
    const api = cot.estado === 'listo' ? cot.api : null;
    const cambiarPar = (d, x) => { tocado.current = false; setValor(''); setFuente('MANUAL'); setDe(d); setA(x); };
    const usar = () => { tocado.current = false; setValor(aTexto(api.valor)); setFuente('EXCHANGERATE_API'); if (api.fecha <= hoy) setF(api.fecha); };
    const escribir = (e) => { tocado.current = true; setValor(e.target.value); if (fuente === 'EXCHANGERATE_API') setFuente('MANUAL'); };
    const cruzada = de !== 'VES' && a !== 'VES' && de !== a;
    const enviar = () => router.post('/tasas/par', { de, a, valor, fecha_valor: f, fuente }, { preserveScroll: true, onStart: () => setEnv(true), onFinish: () => setEnv(false), onSuccess: cerrar });
    const Sel = ({ label, value, set }) => (
        <Field select label={label} value={value} onChange={(e) => set(e.target.value)}>{catalogo.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}</Field>
    );
    return (
        <ModalKit titulo="Agregar tasa de cambio" subtitulo="Elige las dos monedas. Te mostramos cuánto vale cada una hoy según ExchangeRate-API." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Guardar tasa" ancho="max-w-[520px]">
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                <Sel label="Moneda" value={de} set={(v) => cambiarPar(v, a)} />
                <button type="button" onClick={() => cambiarPar(a, de)} aria-label="Intercambiar monedas" className="mb-0.5 grid size-10 place-items-center rounded-full border border-line hover:bg-paper"><ArrowLeftRight className="size-4" /></button>
                <Sel label="Equivale a" value={a} set={(v) => cambiarPar(de, v)} />
            </div>

            <div className="rounded-xl border border-line bg-paper/60 p-4" aria-live="polite">
                {cot.estado === 'igual' && <p className="text-[13.5px] text-muted">Elige dos monedas distintas.</p>}
                {cot.estado === 'cargando' && <div><p className="text-[13px] text-muted">Consultando ExchangeRate-API…</p><div className="mt-2 h-7 w-56 animate-pulse rounded bg-line" /></div>}
                {cot.estado === 'error' && <p className="flex items-start gap-2 text-[13.5px] text-danger"><CircleAlert className="mt-0.5 size-4 shrink-0" />{cot.message}</p>}
                {cot.estado === 'listo' && api && (<>
                    <p className="text-[12.5px] text-muted">Hoy, según ExchangeRate-API</p>
                    <p className="num mt-0.5 text-[24px] font-semibold leading-tight tracking-[-0.01em]">1 {de} = {cotiz(api.valor)} {a}</p>
                    <p className="num mt-0.5 text-[13px] text-muted">1 {a} = {cotiz(1 / api.valor)} {de}</p>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[12.5px] text-muted">
                        <span>Actualizada el {api.actualizada}{cot.guardada ? <> · Tu tasa actual: <b className="num font-medium text-text">{cotiz(cot.guardada)}</b></> : null}</span>
                        {fuente !== 'EXCHANGERATE_API' && <button type="button" onClick={usar} className="rounded-md px-2 py-1 text-[13px] font-medium text-brand hover:bg-brand-50">Usar este valor</button>}
                    </div>
                </>)}
                {cot.estado === 'listo' && !api && (<>
                    <p className="flex items-start gap-2 text-[13.5px] text-muted"><Info className="mt-0.5 size-4 shrink-0" />{cot.aviso || 'No hay cotización disponible. Escribe la tasa a mano.'}</p>
                    {cot.guardada ? <p className="mt-2 text-[12.5px] text-muted">Tu tasa actual: <b className="num font-medium text-text">1 {de} = {cotiz(cot.guardada)} {a}</b></p> : null}
                </>)}
            </div>

            <Field label={`Cuántos ${a} vale 1 ${de}`} value={valor} onChange={escribir} error={errors.valor} inputMode="decimal" className="[&_input]:num" hint="Usa coma para los decimales, por ejemplo 1.050,25." />
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Fecha valor" forceFloat type="date" value={f} onChange={(e) => setF(e.target.value)} />
                <Field select label="¿De dónde sale?" value={fuente} onChange={(e) => setFuente(e.target.value)}>
                    <option value="EXCHANGERATE_API" disabled={!api}>ExchangeRate-API</option><option value="BCV">Banco Central de Venezuela (oficial)</option><option value="MANUAL">La escribí yo</option>
                </Field>
            </div>
            <p className="flex items-start gap-2 text-[12.5px] leading-snug text-muted"><Info className="mt-0.5 size-3.5 shrink-0" />{cruzada ? 'El sistema guarda todo contra el bolívar: la tasa en bolívares de la moneda que aún no tenga se calcula a partir de la otra.' : 'Se guarda en bolívares por unidad de moneda, que es lo que usan la caja, las ventas y las compras.'} Las ventas ya hechas conservan la tasa de su momento.</p>
        </ModalKit>
    );
}

export default function Tasas({ errors = {}, negocio, usuario, fecha_larga, stock_bajo, tasas, sync, monedas, historial, reglas, catalogo = [] }) {
    registrarMonedas(catalogo); registrarMonedas(monedas);
    const [edit, setEdit] = useState(null); const [cargando, setCargando] = useState(false); const [agregar, setAgregar] = useState(null);
    const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Caracas' })).toLocaleDateString('en-CA');
    const usd = tasas.find((t) => t.par === 'USD');
    const sincronizar = () => router.post('/tasas/sincronizar', {}, { onStart: () => setCargando(true), onFinish: () => setCargando(false) });
    const cambiar = (codigo, activa) => router.patch(`/monedas/${codigo}`, { activa }, { preserveScroll: true });
    return (
        <AppLayout actual="/tasas" titulo="Tasas de cambio" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={usd.tasa} stockBajo={stock_bajo} alertas={0}>
            <Head title="Tasas de cambio" />
            <div className="mb-6">
                <h2 className="text-[26px] font-semibold tracking-[-0.02em]">Tasas de cambio</h2>
                <p className="mt-1 max-w-[70ch] text-[15px] text-muted">Con estas tasas el sistema cobra en bolívares, dólares, euros y las demás monedas que agregues. Cada venta guarda la tasa del momento y no cambia después.</p>
            </div>

            <Card className="mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-ink text-white"><PlugZap className="size-5" /></span>
                <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">Actualización automática con ExchangeRate-API</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                        <span className="inline-flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${sync.clave ? 'bg-ok' : 'bg-danger'}`} />{sync.clave ? 'Clave configurada' : 'Falta la clave en el archivo .env'}</span>
                        <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-3.5" />{sync.ultima ? `Última consulta: ${sync.ultima}` : 'Aún no se ha consultado hoy'}</span>
                    </p>
                </div>
                <Button variant="ghost" onClick={() => setAgregar({})}><Plus className="size-4" />Agregar tasa</Button>
                <Button onClick={sincronizar} disabled={cargando || !sync.clave}><RefreshCw className={`size-4 ${cargando ? 'animate-spin' : ''}`} />{cargando ? 'Consultando…' : 'Actualizar tasas'}</Button>
            </Card>
            {errors.sync && <p role="alert" className="-mt-3 mb-4 flex items-start gap-2 rounded-lg bg-[#fdecec] px-3.5 py-2.5 text-[13px] text-danger"><Info className="mt-0.5 size-4 shrink-0" />{errors.sync}</p>}
            <p className="-mt-3 mb-6 flex items-start gap-2 px-1 text-[13px] leading-snug text-muted"><Info className="mt-0.5 size-4 shrink-0" />ExchangeRate-API publica tasas de mercado. Si tu negocio factura con la tasa oficial del BCV, edita la tasa y márcala como oficial.</p>

            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">{tasas.map((t) => <TasaCard key={t.par} t={t} onEditar={setEdit} />)}</div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <div className="grid min-w-0 content-start gap-6">
                    <Monedas monedas={monedas} cambiar={cambiar} agregar={(c) => setAgregar({ de: c, a: 'VES' })} />
                    <Card>
                        <Titulo>Reglas de la tasa</Titulo>
                        <dl className="space-y-3 px-5 pb-5 pt-3 text-sm">
                            <div className="flex justify-between gap-4"><dt className="text-muted">Si hoy no hay tasa publicada</dt><dd className="text-right font-medium">Usa la {reglas.sin_publicacion === 'SIGUIENTE' ? 'siguiente' : 'anterior'}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-muted">Antigüedad máxima</dt><dd className="font-medium">{reglas.dias_antigua} días</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-muted">Se puede cargar con hasta</dt><dd className="font-medium">{reglas.dias_futura} días de adelanto</dd></div>
                        </dl>
                    </Card>
                </div>
                <Convertidor tasas={tasas} />
            </div>

            <div className="mt-6"><Historial filas={historial} /></div>
            {agregar && <ModalAgregar catalogo={catalogo} inicial={agregar} hoy={hoy} cerrar={() => setAgregar(null)} errors={errors} />}
            {edit && <Modal t={edit} cerrar={() => setEdit(null)} error={errors.valor} />}
        </AppLayout>
    );
}
