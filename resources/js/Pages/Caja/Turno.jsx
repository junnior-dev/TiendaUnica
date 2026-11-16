import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, LockKeyhole, Printer, Receipt, ScissorsLineDashed, X } from 'lucide-react';
import { Button, Field } from '../../Components/ui';
import { http } from '../../lib/http';
import { n0, n2, SIMBOLO } from '../../lib/format';

/* Turno de caja del POS: apertura con fondo inicial (pantalla que bloquea la venta), Corte X (parcial) y Corte Z (cierre con conteo y ticket). */

const num = (s) => { const t = String(s ?? '').trim(); if (!t) return NaN; return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); };
const dec = (m, v) => (m === 'COP' ? n0(v) : n2(v));
const mon = (m, v) => `${SIMBOLO[m] || m} ${dec(m, v)}`;
const hora = (iso) => (iso ? new Intl.DateTimeFormat('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Caracas' }).format(new Date(iso)) : '');

export function Ventana({ titulo, subtitulo, cerrar, ancho = 'max-w-[560px]', children, pie, sinCerrar }) {
    useEffect(() => { const k = (e) => e.key === 'Escape' && !sinCerrar && cerrar(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [cerrar, sinCerrar]);
    return (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label={titulo}>
            <div className="fixed inset-0 bg-black/50" onClick={sinCerrar ? undefined : cerrar} />
            <div className={`relative my-auto w-full ${ancho} rounded-2xl bg-white shadow-2xl`}>
                <div className="flex items-start justify-between gap-3 px-6 pt-6">
                    <div className="min-w-0"><h2 className="text-lg font-semibold tracking-[-0.01em]">{titulo}</h2>{subtitulo && <p className="mt-1 text-[13px] leading-snug text-muted">{subtitulo}</p>}</div>
                    {!sinCerrar && <button type="button" onClick={cerrar} aria-label="Cerrar" className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-paper"><X className="size-4" /></button>}
                </div>
                <div className="px-6 py-5">{children}</div>
                {pie && <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-6 py-4">{pie}</div>}
            </div>
        </div>
    );
}

/* ───────── Apertura: pantalla completa que impide vender hasta abrir la caja ───────── */
export function ModalApertura({ usuario, alAbrir }) {
    const [f, setF] = useState({ usd: '', ves: '' });
    const [err, setErr] = useState({}); const [msg, setMsg] = useState(''); const [env, setEnv] = useState(false);
    const abrir = async (e) => {
        e.preventDefault();
        const usd = f.usd.trim() ? num(f.usd) : 0; const ves = f.ves.trim() ? num(f.ves) : 0;
        const er = {};
        if (Number.isNaN(usd) || usd < 0) er.usd = 'Escribe un monto válido (0 si no hay fondo).';
        if (Number.isNaN(ves) || ves < 0) er.ves = 'Escribe un monto válido (0 si no hay fondo).';
        setErr(er); setMsg('');
        if (Object.keys(er).length) return;
        setEnv(true);
        try { const r = await http('POST', '/caja/apertura', { fondo_inicial_usd: usd, fondo_inicial_ves: ves }); alAbrir(r.apertura); }
        catch (x) { setMsg(x.message); setErr(x.errors ? Object.fromEntries(Object.entries(x.errors).map(([k, v]) => [k.endsWith('usd') ? 'usd' : 'ves', v[0]])) : {}); setEnv(false); }
    };
    return (
        <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-ink/85 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Abrir caja">
            <form onSubmit={abrir} className="my-auto w-full max-w-[440px] rounded-2xl bg-white p-6 shadow-2xl">
                <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand"><LockKeyhole className="size-5" /></span>
                <h2 className="mt-4 text-xl font-semibold tracking-[-0.01em]">Abre tu caja para empezar a vender</h2>
                <p className="mt-1.5 text-[14px] leading-snug text-muted">{usuario?.nombre ? `${usuario.nombre}, ` : ''}cuenta el efectivo con el que arrancas el turno. Al cerrar la caja se compara contra este fondo.</p>
                <div className="mt-5 grid gap-4">
                    <Field label="Fondo inicial en dólares (USD)" inputMode="decimal" value={f.usd} onChange={(e) => setF({ ...f, usd: e.target.value })} error={err.usd} autoFocus hint="Déjalo en blanco si no hay dólares en caja." />
                    <Field label="Fondo inicial en bolívares (Bs)" inputMode="decimal" value={f.ves} onChange={(e) => setF({ ...f, ves: e.target.value })} error={err.ves} hint="Déjalo en blanco si no hay bolívares en caja." />
                </div>
                {msg && <p className="mt-3 flex items-start gap-2 text-[13.5px] text-danger"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{msg}</p>}
                <Button type="submit" disabled={env} className="mt-5 h-12 w-full">{env ? 'Abriendo…' : 'Abrir caja'}</Button>
            </form>
        </div>
    );
}

/* ───────── Barra del turno ───────── */
export function BarraTurno({ apertura, corteX, cerrarZ }) {
    return (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-white px-4 py-2.5">
            <span className="flex min-w-0 items-center gap-2 text-[13.5px]"><span className="size-2 shrink-0 rounded-full bg-ok" aria-hidden /><span className="font-semibold">Caja abierta</span><span className="num text-muted">desde las {hora(apertura.fecha_apertura)} · fondo $ {n2(apertura.fondo_usd)} y Bs {n2(apertura.fondo_ves)}</span></span>
            <span className="ml-auto flex gap-2">
                <button type="button" onClick={corteX} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[13.5px] font-semibold hover:bg-paper"><Receipt className="size-4 text-brand" />Corte X</button>
                <button type="button" onClick={cerrarZ} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[13.5px] font-semibold hover:bg-paper"><ScissorsLineDashed className="size-4 text-danger" />Cerrar caja (Z)</button>
            </span>
        </div>
    );
}

const Fila = ({ a, b, fuerte, tono }) => <div className="flex items-baseline justify-between gap-3 py-0.5 text-[14px]"><dt className={fuerte ? 'font-semibold' : 'text-muted'}>{a}</dt><dd className={`num ${fuerte ? 'font-semibold' : 'font-medium'} ${tono || ''}`}>{b}</dd></div>;
const Sub = ({ children }) => <h3 className="mb-1.5 mt-5 text-[13px] font-semibold">{children}</h3>;

function Resumen({ r }) {
    return (
        <div>
            <div className="grid gap-x-8 sm:grid-cols-2">
                <dl><Fila a="Ventas del turno" b={`${r.ventas}${r.ventas_credito ? ` (${r.ventas_credito} a crédito)` : ''}`} /><Fila a="Cobrado en dólares" b={mon('USD', r.total_usd)} /><Fila a="Cobrado en bolívares" b={mon('VES', r.total_ves)} /></dl>
                <dl><Fila a="IGTF cobrado" b={`${mon('USD', r.igtf_usd)} · ${mon('VES', r.igtf_ves)}`} />{r.a_credito_usd > 0 && <Fila a="Quedó a crédito" b={mon('USD', r.a_credito_usd)} />}<Fila a="Fondo inicial" b={`${mon('USD', r.apertura.fondo_usd)} · ${mon('VES', r.apertura.fondo_ves)}`} /></dl>
            </div>
            <Sub>Ventas por método de pago</Sub>
            {r.metodos.length === 0 ? <p className="text-[13.5px] text-muted">Todavía no hay cobros en este turno.</p> : (
                <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full text-[13.5px]"><thead><tr className="bg-paper text-left text-[12px] text-muted"><th className="px-3 py-2 font-medium">Método</th><th className="px-3 py-2 text-right font-medium">Ops.</th><th className="px-3 py-2 text-right font-medium">Cobrado</th><th className="px-3 py-2 text-right font-medium">Equiv. USD</th></tr></thead>
                    <tbody>{r.metodos.map((m, i) => <tr key={i} className="border-t border-line"><td className="px-3 py-2">{m.metodo}{!m.efectivo && <span className="ml-1.5 text-[11.5px] text-muted">no efectivo</span>}</td><td className="num px-3 py-2 text-right">{m.n}</td><td className="num px-3 py-2 text-right">{mon(m.moneda, m.cobrado)}</td><td className="num px-3 py-2 text-right">{mon('USD', m.usd)}</td></tr>)}</tbody></table></div>
            )}
            {[['Ingresos de caja', r.ingresos, '+'], ['Egresos de caja', r.egresos, '-']].map(([t, lista, s]) => (
                <div key={t}><Sub>{t}</Sub>{lista.length === 0 ? <p className="text-[13.5px] text-muted">Ninguno.</p> : <ul className="space-y-1">{lista.map((m) => <li key={m.id} className="flex items-baseline justify-between gap-3 text-[13.5px]"><span className="min-w-0 truncate"><span className="num text-muted">{m.hora}</span> {m.concepto}{!m.es_efectivo && <span className="text-muted"> (no efectivo)</span>}</span><span className="num shrink-0 font-medium">{s}{mon(m.moneda, m.monto)}</span></li>)}</ul>}</div>
            ))}
            <Sub>Efectivo esperado en caja</Sub>
            <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full text-[13.5px]"><thead><tr className="bg-paper text-right text-[12px] text-muted"><th className="px-3 py-2 text-left font-medium">Moneda</th><th className="px-3 py-2 font-medium">Fondo</th><th className="px-3 py-2 font-medium">+ Ventas</th><th className="px-3 py-2 font-medium">- Vueltos</th><th className="px-3 py-2 font-medium">+ Ingresos</th><th className="px-3 py-2 font-medium">- Egresos</th><th className="px-3 py-2 font-semibold text-text">Esperado</th></tr></thead>
                <tbody>{r.monedas.map((m) => <tr key={m.moneda} className="num border-t border-line text-right"><td className="px-3 py-2 text-left font-semibold">{m.moneda}</td><td className="px-3 py-2">{dec(m.moneda, m.fondo)}</td><td className="px-3 py-2">{dec(m.moneda, m.efectivo_recibido)}</td><td className="px-3 py-2">{dec(m.moneda, m.vuelto)}</td><td className="px-3 py-2">{dec(m.moneda, m.ingresos)}</td><td className="px-3 py-2">{dec(m.moneda, m.egresos)}</td><td className="px-3 py-2 font-semibold">{dec(m.moneda, m.esperado)}</td></tr>)}</tbody></table></div>
        </div>
    );
}

async function imprimir(datos, nombre) {
    const m = await import('../../lib/pdfTicketCorte');
    m.imprimirTicketCorte(await m.construirTicketCorte(datos), nombre);
}

/* ───────── Corte X: resumen parcial, no cierra nada ───────── */
export function ModalCorteX({ cerrar }) {
    const [r, setR] = useState(null); const [err, setErr] = useState(''); const [gen, setGen] = useState(false);
    useEffect(() => { http('GET', '/caja/corte-x').then(setR).catch((e) => setErr(e.message)); }, []);
    const tick = async () => { setGen(true); try { await imprimir({ tipo: 'X', resumen: r }, 'corte-x.pdf'); } catch { setErr('No se pudo generar el ticket.'); } finally { setGen(false); } };
    return (
        <Ventana titulo="Corte X" subtitulo="Resumen parcial de tu turno. No cierra la caja ni borra nada." cerrar={cerrar} ancho="max-w-[760px]"
            pie={<><button type="button" onClick={cerrar} className="inline-flex h-11 items-center rounded-lg border border-line px-5 text-[14.5px] font-semibold hover:bg-paper">Cerrar</button>
                <Button type="button" onClick={tick} disabled={!r || gen} className="h-11"><Printer className="mr-2 size-4" />{gen ? 'Generando…' : 'Imprimir ticket'}</Button></>}>
            {err && <p className="mb-3 text-[13.5px] text-danger">{err}</p>}
            {!r && !err ? <p className="py-8 text-center text-[14px] text-muted">Calculando el turno…</p> : r && <Resumen r={r} />}
        </Ventana>
    );
}

/* ───────── Corte Z: cuenta el efectivo, cierra el turno e imprime el ticket ───────── */
export function ModalCierreZ({ apertura, carritoLleno, cerrar, alCerrado }) {
    const [r, setR] = useState(null); const [err, setErr] = useState(''); const [cuenta, setCuenta] = useState({}); const [obs, setObs] = useState('');
    const [env, setEnv] = useState(false); const [hecho, setHecho] = useState(null);
    useEffect(() => { http('GET', '/caja/corte-x').then(setR).catch((e) => setErr(e.message)); }, []);
    const monedas = useMemo(() => (r ? r.monedas.filter((m) => ['USD', 'VES'].includes(m.moneda) || Math.abs(m.esperado) > 0.004 || m.efectivo_recibido > 0) : []), [r]);
    const val = (m) => { const v = num(cuenta[m]); return Number.isNaN(v) ? null : v; };
    const completo = monedas.length > 0 && monedas.every((m) => val(m.moneda) !== null && val(m.moneda) >= 0);

    const cerrarCaja = async (e) => {
        e.preventDefault();
        if (!completo || env) return;
        setEnv(true); setErr('');
        try {
            const conteo = Object.fromEntries(monedas.map((m) => [m.moneda, val(m.moneda)]));
            const z = await http('POST', '/cierre-caja', { apertura_id: apertura.id, conteo, observaciones: obs.trim() || undefined });
            const datos = { tipo: 'Z', numero: z.numero, resumen: z.resumen, conteo: z.conteo, diferencia: z.diferencia, cerrado_por: z.cerrado_por, cerrado_en: z.cerrado_en, observaciones: obs.trim() };
            setHecho(datos);
            try { await imprimir(datos, `corte-z-${String(z.numero).padStart(6, '0')}.pdf`); } catch { setErr('El turno se cerró, pero no se pudo abrir el ticket. Usa «Reimprimir ticket».'); }
        } catch (x) { setErr(x.errors?.conteo?.[0] || x.message); setEnv(false); }
    };

    if (hecho) {
        const difs = Object.entries(hecho.diferencia);
        const cuadra = difs.every(([, v]) => Math.abs(v) < 0.005);
        return (
            <Ventana titulo="Caja cerrada" subtitulo={`Corte Z N.º ${String(hecho.numero).padStart(6, '0')}`} sinCerrar cerrar={() => {}} ancho="max-w-[480px]"
                pie={<><button type="button" onClick={() => imprimir(hecho, `corte-z-${String(hecho.numero).padStart(6, '0')}.pdf`)} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line px-4 text-[14.5px] font-semibold hover:bg-paper"><Printer className="size-4" />Reimprimir ticket</button>
                    <Button type="button" onClick={alCerrado} className="h-11">Listo</Button></>}>
                <p className={`flex items-start gap-2 text-[14.5px] font-medium ${cuadra ? 'text-ok' : 'text-[#8a5d00]'}`}>{cuadra ? <Check className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}{cuadra ? 'El efectivo cuadra con lo esperado.' : 'Hay diferencias en el efectivo contado.'}</p>
                <dl className="mt-3">{difs.map(([m, v]) => <Fila key={m} a={`Diferencia ${m}`} b={Math.abs(v) < 0.005 ? 'Cuadra' : `${v > 0 ? 'Sobra' : 'Falta'} ${mon(m, Math.abs(v))}`} fuerte tono={Math.abs(v) < 0.005 ? 'text-ok' : 'text-danger'} />)}</dl>
                {err && <p className="mt-3 text-[13.5px] text-danger">{err}</p>}
            </Ventana>
        );
    }

    return (
        <Ventana titulo="Cerrar caja (Corte Z)" subtitulo="Cuenta el efectivo que hay en la caja. Al confirmar se cierra tu turno y se imprime el ticket." cerrar={cerrar} ancho="max-w-[760px]"
            pie={<><button type="button" onClick={cerrar} className="inline-flex h-11 items-center rounded-lg border border-line px-5 text-[14.5px] font-semibold hover:bg-paper">Volver</button>
                <Button type="submit" form="form-z" disabled={!completo || env} className="h-11">{env ? 'Cerrando…' : 'Cerrar caja e imprimir'}</Button></>}>
            {err && <p className="mb-3 flex items-start gap-2 text-[13.5px] text-danger"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{err}</p>}
            {carritoLleno && <p className="mb-3 flex items-start gap-2 rounded-lg bg-signal/15 px-3 py-2 text-[13.5px] text-[#6b4a00]"><AlertTriangle className="mt-0.5 size-4 shrink-0" />Tienes una venta a medias en pantalla. Termínala antes de cerrar, o vacíala.</p>}
            {!r && !err ? <p className="py-8 text-center text-[14px] text-muted">Calculando el turno…</p> : r && (
                <form id="form-z" onSubmit={cerrarCaja}>
                    <Resumen r={r} />
                    <Sub>Efectivo contado</Sub>
                    <div className="grid gap-4 sm:grid-cols-2">
                        {monedas.map((m) => {
                            const v = val(m.moneda); const dif = v === null ? null : Math.round((v - m.esperado) * 100) / 100;
                            return <Field key={m.moneda} label={`Contado en ${m.moneda}`} inputMode="decimal" value={cuenta[m.moneda] ?? ''} onChange={(e) => setCuenta({ ...cuenta, [m.moneda]: e.target.value })}
                                hint={dif === null ? `Esperado: ${mon(m.moneda, m.esperado)}` : Math.abs(dif) < 0.005 ? `Cuadra con lo esperado (${mon(m.moneda, m.esperado)})` : `${dif > 0 ? 'Sobra' : 'Falta'} ${mon(m.moneda, Math.abs(dif))} · esperado ${mon(m.moneda, m.esperado)}`} />;
                        })}
                    </div>
                    <Field className="mt-4" label="Observaciones (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} />
                </form>
            )}
        </Ventana>
    );
}
