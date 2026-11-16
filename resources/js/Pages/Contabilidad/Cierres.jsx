import { useEffect, useState } from 'react';
import { CalendarClock, Check, CircleAlert, FileDown, Flag, Lock, LockOpen, RefreshCw, Scale } from 'lucide-react';
import { Card, Modal } from '../../Components/kit';
import { Field, Segmented } from '../../Components/ui';
import { http } from '../../lib/http';
import { n2 } from '../../lib/format';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const dmy = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const bs = (v) => `Bs ${n2(v)}`;
const Alerta = ({ children, tono = 'bad' }) => (
    <p role={tono === 'bad' ? 'alert' : undefined} className={`flex items-start gap-2 rounded-lg p-3 text-[13.5px] leading-snug ${tono === 'bad' ? 'bg-[#fdecec] text-danger' : tono === 'warn' ? 'bg-signal/15 text-[#7a4d00]' : 'bg-paper text-muted'}`}><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{children}</span></p>
);

/** Tres acciones de cierre, juntas, con el orden recomendado: ajuste cambiario → bloquear el mes → cerrar el ejercicio. */
export function PanelCierres({ mes, cerrado, abrir }) {
    const [a, m] = mes.split('-').map(Number);
    return (
        <Card className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-[16px] font-semibold">Cierres y ajustes {cerrado && <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-0.5 text-[12.5px] font-medium text-muted ring-1 ring-line"><Lock className="size-3" />{cap(MESES[m - 1])} {a} está cerrado</span>}</h3>
                    <p className="mt-0.5 max-w-[62ch] text-[13.5px] text-muted">Al terminar el mes: ajusta el inventario a la tasa del cierre, bloquea el período y, en enero, cierra el ejercicio del año anterior.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={() => abrir('apertura')} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[14px] font-semibold hover:bg-paper"><Flag className="size-4" />Asiento de apertura</button>
                    <button onClick={() => abrir('ajuste')} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[14px] font-semibold hover:bg-paper"><RefreshCw className="size-4" />Ajuste cambiario</button>
                    <button onClick={() => abrir('periodos')} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[14px] font-semibold hover:bg-paper"><Lock className="size-4" />Bloquear período</button>
                    <button onClick={() => abrir('ejercicio')} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[14px] font-semibold hover:bg-paper"><Scale className="size-4" />Cierre de ejercicio</button>
                </div>
            </div>
        </Card>
    );
}

export function AvisoCierreInstalar() {
    return <Card className="mb-6"><div className="p-5 text-[14px] text-muted"><p className="font-semibold text-text">Cierres y ajustes</p><p className="mt-1">Para bloquear períodos, cerrar el ejercicio y ajustar el diferencial cambiario, ejecuta el archivo 11_cierre_y_pagos.sql en tu base de datos (requiere el 10).</p></div></Card>;
}

/* ───── Asiento de apertura (19_regimen_y_apertura.sql) ───── */
const numero = (t) => { const x = String(t ?? '').trim(); if (!x) return 0; const n = Number(x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x); return Number.isFinite(n) ? n : NaN; };
export function ModalApertura({ cerrar, cambiado }) {
    const [d, setD] = useState(null);
    const [fecha, setFecha] = useState('');
    const [f, setF] = useState({ caja_ves: '', caja_usd: '', bancos_ves: '', bancos_usd: '', activos_fijos_ves: '', otras_cxc_ves: '', deudas_ves: '' });
    const [err, setErr] = useState('');
    const [env, setEnv] = useState(false);
    const cargar = async (x) => { try { setErr(''); const r = await http('GET', `/contabilidad/apertura${x ? `?fecha=${x}` : ''}`); setD(r); setFecha(r.fecha); } catch (e) { setErr(e.message); } };
    useEffect(() => { cargar(''); }, []);
    const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
    const t = d?.tasa ? Number(d.tasa) : 0;
    const v = Object.fromEntries(Object.entries(f).map(([k, x]) => [k, numero(x)]));
    const mal = Object.values(v).some((x) => Number.isNaN(x) || x < 0);
    const caja = v.caja_ves + v.caja_usd * t, bancos = v.bancos_ves + v.bancos_usd * t, inv = Number(d?.inventario_ves || 0);
    const activos = caja + bancos + inv + v.activos_fijos_ves + v.otras_cxc_ves;
    const capital = activos - v.deudas_ves;
    const bloqueo = d?.existe ? `Ya existe el asiento de apertura (N.º ${d.numero_asiento}, del ${dmy(d.fecha_apertura)}). Si hay un error, corrígelo con un asiento manual.`
        : d && d.primer_asiento && d.primer_asiento < fecha ? `Ya hay asientos desde el ${dmy(d.primer_asiento)}: la apertura debe tener esa fecha o una anterior, o esos movimientos se contarían dos veces.`
        : d && !t ? `No hay tasa del dólar para el ${dmy(fecha)}: cárgala en Tasas de cambio.` : '';
    const puede = d && !bloqueo && !mal;
    const enviar = async () => {
        setEnv(true); setErr('');
        try { const r = await http('POST', '/contabilidad/apertura', { fecha, ...v }); cambiado(`Asiento de apertura registrado: N.º ${r.numero}.`); }
        catch (e) { setErr(e.message); } finally { setEnv(false); }
    };
    return (
        <Modal titulo="Asiento de apertura" subtitulo="La situación con la que arranca tu contabilidad. Se hace una sola vez." cerrar={cerrar} onSubmit={puede ? enviar : cerrar} enviando={env} ok={puede ? 'Registrar apertura' : 'Entendido'}>
            {!d && !err && <p className="py-8 text-center text-[14px] text-muted">Cargando…</p>}
            {d && (
                <>
                    {bloqueo && <Alerta tono="warn">{bloqueo}</Alerta>}
                    <Field forceFloat label="Fecha de la apertura (primer día de tu contabilidad)" type="date" max={d.hoy} value={fecha} onChange={(e) => { setFecha(e.target.value); cargar(e.target.value); }} />
                    <div className="rounded-xl bg-paper px-4 py-3 text-[14px]">
                        <div className="flex justify-between gap-4"><span className="text-muted">Inventario a costo (kardex al cierre del día anterior · {d.productos} productos)</span><b className="num">{bs(d.inventario_ves)}</b></div>
                        <p className="mt-1 text-[13px] text-muted">Sale del kardex, no se escribe. Dólar de ese día: Bs {t ? n2(t) : 'sin tasa'}.</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Efectivo en Bs" inputMode="decimal" value={f.caja_ves} onChange={set('caja_ves')} />
                        <Field label="Efectivo en USD" inputMode="decimal" value={f.caja_usd} onChange={set('caja_usd')} hint="Se convierte a la tasa de la fecha" />
                        <Field label="Bancos en Bs" inputMode="decimal" value={f.bancos_ves} onChange={set('bancos_ves')} />
                        <Field label="Bancos en USD" inputMode="decimal" value={f.bancos_usd} onChange={set('bancos_usd')} />
                        <Field label="Mobiliario y equipos (Bs)" inputMode="decimal" value={f.activos_fijos_ves} onChange={set('activos_fijos_ves')} hint="Valor con el que los registra tu contador" />
                        <Field label="Otras cuentas por cobrar (Bs)" inputMode="decimal" value={f.otras_cxc_ves} onChange={set('otras_cxc_ves')} />
                        <Field label="Deudas anteriores (Bs)" inputMode="decimal" value={f.deudas_ves} onChange={set('deudas_ves')} hint="Lo que debías antes de empezar" />
                    </div>
                    {mal && <Alerta>Revisa los montos: deben ser números mayores o iguales a cero.</Alerta>}
                    {!mal && (
                        <dl className="divide-y divide-line rounded-xl border border-line text-[14px]">
                            <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted">Total de lo que tienes</dt><dd className="num font-medium">{bs(activos)}</dd></div>
                            <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted">Lo que debes</dt><dd className="num font-medium">{bs(v.deudas_ves)}</dd></div>
                            <div className="flex justify-between gap-4 px-4 py-2.5 font-semibold"><dt>{capital >= 0 ? 'Capital' : 'Déficit inicial'}</dt><dd className={`num ${capital < 0 ? 'text-danger' : ''}`}>{bs(Math.abs(capital))}</dd></div>
                        </dl>
                    )}
                    <Alerta tono="info">Las deudas y cuentas por cobrar de ventas y compras hechas en el sistema no se cargan aquí: salen solas. Confirma estos montos con tu contador antes de registrar.</Alerta>
                </>
            )}
            {err && <Alerta>{err}</Alerta>}
        </Modal>
    );
}

/* ───── Bloquear período contable ───── */
export function ModalPeriodos({ mes, cerrar, cambiado }) {
    const [anio, setAnio] = useState(Number(mes.slice(0, 4)));
    const [d, setD] = useState(null);
    const [sel, setSel] = useState(null);           // { m, accion }
    const [texto, setTexto] = useState('');
    const [err, setErr] = useState('');
    const [env, setEnv] = useState(false);
    const cargar = async (y) => { try { setD(await http('GET', `/contabilidad/periodos?anio=${y}`)); } catch (e) { setErr(e.message); } };
    useEffect(() => { cargar(anio); }, [anio]);
    const enviar = async () => {
        setErr('');
        if (sel.accion === 'reabrir' && texto.trim().length < 5) return setErr('Cuéntanos por qué lo reabres (mínimo 5 letras). Queda registrado.');
        setEnv(true);
        try {
            const r = await http('POST', `/contabilidad/periodos/${sel.accion === 'cerrar' ? 'cerrar' : 'reabrir'}`, sel.accion === 'cerrar' ? { periodo: sel.m.periodo, nota: texto.trim() || null } : { periodo: sel.m.periodo, motivo: texto.trim() });
            setD(r); setSel(null); setTexto(''); cambiado(`${cap(MESES[sel.m.mes - 1])} ${anio} ${sel.accion === 'cerrar' ? 'cerrado' : 'reabierto'}.`);
        } catch (e) { setErr(e.message); } finally { setEnv(false); }
    };
    if (sel) return (
        <Modal titulo={`${sel.accion === 'cerrar' ? 'Cerrar' : 'Reabrir'} ${MESES[sel.m.mes - 1]} de ${anio}`} subtitulo={sel.accion === 'cerrar' ? 'Después de cerrarlo, ese mes ya no admite cambios.' : 'El mes vuelve a admitir cambios. Queda registrado quién y por qué.'} cerrar={() => { setSel(null); setErr(''); setTexto(''); }} onSubmit={enviar} enviando={env} ok={sel.accion === 'cerrar' ? 'Cerrar el mes' : 'Reabrir el mes'} peligro={sel.accion === 'reabrir'}>
            {sel.accion === 'cerrar' && (
                <ul className="space-y-1.5 rounded-xl bg-paper p-4 text-[13.5px] leading-snug text-muted">
                    <li>• No se podrán registrar asientos manuales en ese mes.</li>
                    <li>• No se podrán anular ventas ni compras de ese mes, ni registrar compras con fecha en él.</li>
                    <li>• Las notas de crédito, de débito y las retenciones no se bloquean: llevan la fecha en que se emiten.</li>
                    <li>• Antes de cerrar, haz el ajuste cambiario del mes si lo usas.</li>
                </ul>)}
            <Field label={sel.accion === 'cerrar' ? 'Nota (opcional)' : 'Motivo'} value={texto} autoFocus onChange={(e) => setTexto(e.target.value)} />
            {err && <Alerta>{err}</Alerta>}
        </Modal>
    );
    return (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label="Bloquear período contable">
            <div className="fixed inset-0 bg-black/50" onClick={cerrar} />
            <div className="relative my-auto w-full max-w-[640px] rounded-2xl bg-white p-6 shadow-2xl">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><h2 className="text-lg font-semibold tracking-[-0.01em]">Bloquear período contable</h2><p className="mt-1 max-w-[46ch] text-[13px] text-muted">Cierra los meses que ya declaraste para que nadie los modifique por error.</p></div>
                    {d && <Segmented compact name="Año" value={String(anio)} onChange={(v) => setAnio(Number(v))} options={d.anios.slice(0, 3).map((y) => ({ value: String(y), label: String(y) }))} />}
                </div>
                {err && <div className="mt-4"><Alerta>{err}</Alerta></div>}
                {!d ? <p className="py-10 text-center text-[14px] text-muted">Cargando…</p> : (
                    <ul className="mt-5 divide-y divide-line rounded-xl border border-line">
                        {d.meses.filter((x) => x.terminado || x.cerrado).map((x) => (
                            <li key={x.mes} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                                <span className={`grid size-8 shrink-0 place-items-center rounded-full ${x.cerrado ? 'bg-ink text-white' : 'bg-paper text-muted'}`}>{x.cerrado ? <Lock className="size-4" /> : <LockOpen className="size-4" />}</span>
                                <div className="min-w-[150px] flex-1"><p className="text-[14.5px] font-medium">{cap(MESES[x.mes - 1])}</p>
                                    <p className="text-[13px] text-muted">{x.cerrado ? `Cerrado el ${dmy(x.cerrado_en)}${x.nota ? ` · ${x.nota}` : ''}` : `${x.asientos} ${x.asientos === 1 ? 'asiento' : 'asientos'}${x.ajuste ? ' · ajuste cambiario hecho' : ''}`}</p></div>
                                {x.cerrado ? <button onClick={() => setSel({ m: x, accion: 'reabrir' })} className="rounded-md px-3 py-1.5 text-[13.5px] font-medium text-brand hover:bg-brand-50">Reabrir</button>
                                    : <button onClick={() => setSel({ m: x, accion: 'cerrar' })} className="rounded-md border border-line px-3 py-1.5 text-[13.5px] font-semibold hover:bg-paper">Cerrar mes</button>}
                            </li>))}
                        {d.meses.every((x) => !x.terminado && !x.cerrado) && <li className="px-4 py-6 text-center text-[14px] text-muted">Aún no ha terminado ningún mes de {anio}.</li>}
                    </ul>)}
                <p className="mt-3 text-[12.5px] leading-snug text-muted">Solo se pueden cerrar meses que ya terminaron.</p>
                <div className="mt-5 flex justify-end"><button type="button" onClick={cerrar} className="inline-flex h-11 items-center rounded-lg bg-brand px-5 text-[15px] font-semibold text-white hover:bg-brand-600">Listo</button></div>
            </div>
        </div>
    );
}

/* ───── Cierre de ejercicio ───── */
export function ModalEjercicio({ hoy, cerrar, cambiado }) {
    const anioHoy = Number(hoy.slice(0, 4));
    const [anio, setAnio] = useState(anioHoy - 1);
    const [d, setD] = useState(null);
    const [err, setErr] = useState('');
    const [env, setEnv] = useState(false);
    useEffect(() => { setD(null); setErr(''); http('GET', `/contabilidad/cierre-ejercicio?anio=${anio}`).then(setD).catch((e) => setErr(e.message)); }, [anio]);
    const enviar = async () => {
        setEnv(true); setErr('');
        try { const r = await http('POST', '/contabilidad/cierre-ejercicio', { anio }); setD(r.cierre); cambiado(`Ejercicio ${anio} cerrado: asiento N.º ${r.numero}.`); }
        catch (e) { setErr(e.message); } finally { setEnv(false); }
    };
    const puede = d && !d.bloqueo;
    return (
        <Modal titulo="Cierre de ejercicio" subtitulo="Deja en cero los ingresos y gastos del año y lleva el resultado a Resultados acumulados." cerrar={cerrar} onSubmit={puede ? enviar : cerrar} enviando={env} ok={puede ? `Cerrar el ejercicio ${anio}` : 'Entendido'} ancho="max-w-[680px]">
            <div className="flex items-center gap-3"><span className="shrink-0 whitespace-nowrap text-[14px] font-medium">Año a cerrar</span>
                <Segmented compact name="Ejercicio" value={String(anio)} onChange={(v) => setAnio(Number(v))} options={[anioHoy - 2, anioHoy - 1, anioHoy].map((y) => ({ value: String(y), label: String(y) }))} /></div>
            {!d && !err && <p className="py-8 text-center text-[14px] text-muted">Calculando…</p>}
            {d && (
                <>
                    {d.cerrado ? <Alerta tono="info"><Check className="hidden" />El ejercicio {anio} ya fue cerrado con el asiento N.º {d.numero}. Lo puedes ver en el libro diario de diciembre.</Alerta> : d.bloqueo && <Alerta tono="warn">{d.bloqueo}</Alerta>}
                    {d.lineas.length > 0 && !d.cerrado && (
                        <div className="overflow-hidden rounded-xl border border-line">
                            <p className="border-b border-line bg-paper px-4 py-2 text-[13px] text-muted">Asiento de cierre al {dmy(d.fecha)}</p>
                            <table className="w-full text-[14px]"><thead><tr className="text-left text-[12.5px] text-muted"><th className="px-4 py-2 font-medium">Cuenta</th><th className="px-4 py-2 text-right font-medium">Debe</th><th className="px-4 py-2 text-right font-medium">Haber</th></tr></thead>
                                <tbody>
                                    {d.lineas.map((l) => <tr key={l.codigo} className="border-t border-line/70"><td className="px-4 py-2"><span className="num mr-2 text-muted">{l.codigo}</span>{l.cuenta}</td><td className="num px-4 py-2 text-right">{l.debe ? n2(l.debe) : ''}</td><td className="num px-4 py-2 text-right">{l.haber ? n2(l.haber) : ''}</td></tr>)}
                                    {d.resumen.tipo !== 'nulo' && d.destino && <tr className="border-t border-line/70 bg-brand-50/50 font-medium"><td className="px-4 py-2"><span className="num mr-2 text-muted">{d.destino.codigo}</span>{d.destino.nombre}<span className="ml-2 text-[12.5px] font-normal text-muted">{d.resumen.tipo === 'utilidad' ? 'utilidad del año' : 'pérdida del año'}</span></td><td className="num px-4 py-2 text-right">{d.resumen.tipo === 'perdida' ? n2(-d.resumen.resultado) : ''}</td><td className="num px-4 py-2 text-right">{d.resumen.tipo === 'utilidad' ? n2(d.resumen.resultado) : ''}</td></tr>}
                                </tbody></table>
                        </div>)}
                    {puede && <>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            {[['Ingresos', d.resumen.ingresos], ['Gastos', d.resumen.gastos], [d.resumen.tipo === 'perdida' ? 'Pérdida' : 'Utilidad', Math.abs(d.resumen.resultado)]].map(([t, v]) => <div key={t} className="rounded-xl border border-line p-3"><p className="text-[12.5px] text-muted">{t}</p><p className="num mt-0.5 text-[15px] font-semibold">{bs(v)}</p></div>)}
                        </div>
                        {d.meses_abiertos > 0 && <Alerta tono="warn">Todavía hay {d.meses_abiertos} {d.meses_abiertos === 1 ? 'mes' : 'meses'} de {anio} sin bloquear. Conviene bloquearlos antes de cerrar el año.</Alerta>}
                        <Alerta tono="info">El asiento no se puede borrar ni editar: si algo cambia, se corrige con otro asiento. Revisa los números con tu contador antes de cerrar.</Alerta>
                    </>}
                </>)}
            {err && <Alerta>{err}</Alerta>}
        </Modal>
    );
}

/* ───── Ajuste por diferencial cambiario ───── */
export function ModalAjuste({ mes, cerrar, cambiado }) {
    const [d, setD] = useState(null);
    const [err, setErr] = useState('');
    const [env, setEnv] = useState(false);
    useEffect(() => { http('GET', `/contabilidad/ajuste-cambiario?mes=${mes}`).then(setD).catch((e) => setErr(e.message)); }, [mes]);
    const enviar = async () => {
        setEnv(true); setErr('');
        try { const r = await http('POST', '/contabilidad/ajuste-cambiario', { mes }); setD(r.ajuste); cambiado(`Ajuste cambiario registrado: asiento N.º ${r.numero}.`); }
        catch (e) { setErr(e.message); } finally { setEnv(false); }
    };
    const puede = d && !d.bloqueo;
    const [a, m] = mes.split('-').map(Number);
    return (
        <Modal titulo="Ajuste por diferencial cambiario" subtitulo={`Inventario de ${MESES[m - 1]} de ${a} a la tasa de cierre${d ? ` (${dmy(d.fecha)})` : ''}.`} cerrar={cerrar} onSubmit={puede ? enviar : cerrar} enviando={env} ok={puede ? 'Registrar ajuste' : 'Entendido'}>
            {!d && !err && <p className="py-8 text-center text-[14px] text-muted">Calculando…</p>}
            {d && (
                <>
                    {d.bloqueo && <Alerta tono={d.registrado ? 'info' : 'warn'}>{d.bloqueo}</Alerta>}
                    <dl className="divide-y divide-line rounded-xl border border-line text-[14px]">
                        <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted">Inventario real a la tasa de cierre{d.tasa ? ` (${n2(d.tasa)})` : ''}</dt><dd className="num font-medium">{bs(d.fisico_ves)}</dd></div>
                        <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted">Inventario según tu contabilidad</dt><dd className="num font-medium">{bs(d.contable_ves)}</dd></div>
                        <div className="flex justify-between gap-4 px-4 py-2.5 font-semibold"><dt>Diferencia</dt><dd className={`num ${d.sentido === 'perdida' ? 'text-danger' : d.sentido === 'ganancia' ? 'text-ok' : ''}`}>{d.diferencia_ves > 0 ? '+' : ''}{bs(d.diferencia_ves)}</dd></div>
                    </dl>
                    {puede && (
                        <div className="overflow-hidden rounded-xl border border-line text-[14px]">
                            <p className="border-b border-line bg-paper px-4 py-2 text-[13px] text-muted">El asiento que se registra</p>
                            <table className="w-full"><tbody>
                                <tr><td className="px-4 py-2">{d.sentido === 'ganancia' ? 'Inventario de mercancía' : 'Diferencial cambiario'}</td><td className="num w-36 whitespace-nowrap px-4 py-2 text-right">{n2(Math.abs(d.diferencia_ves))}</td><td className="w-36" /></tr>
                                <tr className="border-t border-line/70"><td className="px-4 py-2 pl-10">{d.sentido === 'ganancia' ? 'Diferencial cambiario' : 'Inventario de mercancía'}</td><td /><td className="num w-36 whitespace-nowrap px-4 py-2 text-right">{n2(Math.abs(d.diferencia_ves))}</td></tr>
                            </tbody></table>
                        </div>)}
                    {puede && d.aviso_apertura && <Alerta tono="warn">La diferencia es muy grande. Si empezaste la contabilidad con mercancía que ya estaba en el estante, registra primero el asiento de apertura; si no, este ajuste mezclaría ese saldo inicial con el diferencial.</Alerta>}
                    {puede && <Alerta tono="info">Es una revaluación de un activo no monetario: la forma de reconocerla (y su efecto en el ISLR) depende de la política de tu contador. Confírmala antes de registrarlo. Se hace un ajuste por mes y el asiento no se borra.</Alerta>}
                </>)}
            {err && <Alerta>{err}</Alerta>}
        </Modal>
    );
}

/* ───── Exportar libro diario para el contador ───── */
export function ModalExportar({ desde, hasta, hoy, cerrar }) {
    const [f, setF] = useState({ desde, hasta, formato: 'csv' });
    const [err, setErr] = useState('');
    const enviar = () => {
        if (!f.desde || !f.hasta || f.hasta < f.desde) return setErr('El rango de fechas no es válido.');
        const a = document.createElement('a'); a.href = `/contabilidad/exportar?desde=${f.desde}&hasta=${f.hasta}&formato=${f.formato}`; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); cerrar();
    };
    return (
        <Modal titulo="Exportar al contador" subtitulo="El libro diario línea por línea, para importar en el programa de tu contador." cerrar={cerrar} onSubmit={enviar} ok="Descargar">
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Desde" type="date" forceFloat max={hoy} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} />
                <Field label="Hasta" type="date" forceFloat max={hoy} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} />
            </div>
            <div>
                <p className="mb-1.5 text-[13px] font-medium text-muted">Formato</p>
                <Segmented compact name="Formato" value={f.formato} onChange={(v) => setF({ ...f, formato: v })} options={[{ value: 'csv', label: 'Excel (CSV)' }, { value: 'txt', label: 'Texto (TXT)' }]} />
                <p className="mt-2 text-[13px] leading-snug text-muted">{f.formato === 'csv' ? 'Se abre directo en Excel: columnas separadas por punto y coma, decimales con coma y fecha día/mes/año.' : 'Columnas separadas por tabulador, decimales con punto y fecha año-mes-día, para importar a otros programas.'}</p>
            </div>
            <p className="rounded-lg bg-paper p-3 text-[13px] text-muted">Columnas: Fecha, Asiento, Código de Cuenta, Debe y Haber.</p>
            {err && <Alerta>{err}</Alerta>}
        </Modal>
    );
}
