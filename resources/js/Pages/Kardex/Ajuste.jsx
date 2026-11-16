import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Modal } from '../../Components/kit';
import { Field, Segmented } from '../../Components/ui';
import { http } from '../../lib/http';
import { n2 } from '../../lib/format';

export const u = (v) => new Intl.NumberFormat('es-VE', { maximumFractionDigits: 3 }).format(v);
const num = (s) => { const t = String(s ?? '').trim(); return t ? Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) : NaN; };
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

const MODOS = [
    { value: 'ENTRADA', label: 'Entra', note: 'Suma unidades' },
    { value: 'SALIDA', label: 'Sale', note: 'Resta unidades' },
    { value: 'CONTEO', label: 'Conteo físico', note: 'Dices cuántas hay' },
    { value: 'INICIAL', label: 'Inventario inicial', note: 'Primer stock' },
];
const RAZONES = {
    ENTRADA: ['Hallazgo de mercancía', 'Reposición sin factura', 'Corrección de un error'],
    SALIDA: ['Merma o daño', 'Pérdida o robo', 'Uso interno del taller', 'Muestra o regalo', 'Corrección de un error'],
    CONTEO: ['Conteo físico', 'Inventario cíclico'],
    INICIAL: ['Inventario inicial'],
};

/**
 * Ajuste de existencias en una sola ventana. Muestra qué va a pasar (stock antes y después, y cuánto vale la diferencia)
 * antes de guardar. El servidor decide: si el conteo coincide o no alcanza el stock, responde con el motivo.
 */
export default function Ajuste({ producto, tasa, cerrar, hecho }) {
    const [prod, setProd] = useState(producto || null);
    const [q, setQ] = useState(''); const [res, setRes] = useState([]);
    const [modo, setModo] = useState('CONTEO'); const [cant, setCant] = useState(''); const [razon, setRazon] = useState('Conteo físico'); const [detalle, setDetalle] = useState('');
    const [err, setErr] = useState({}); const [msg, setMsg] = useState(''); const [env, setEnv] = useState(false);

    useEffect(() => {
        if (prod) return;
        const t = setTimeout(() => fetch(`/kardex/buscar?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } }).then((r) => r.json()).then(setRes).catch(() => setRes([])), 200);
        return () => clearTimeout(t);
    }, [q, prod]);
    useEffect(() => { setRazon(RAZONES[modo][0]); setErr({}); }, [modo]);

    const c = num(cant);
    const cOk = !isNaN(c) && c >= 0 && (modo === 'CONTEO' || c > 0);
    const stock = prod ? prod.stock : 0;
    const delta = !prod || !cOk ? null : modo === 'CONTEO' ? Math.round((c - stock) * 1000) / 1000 : modo === 'SALIDA' ? -c : c;
    const despues = delta == null ? null : Math.round((stock + delta) * 1000) / 1000;
    const valor = delta == null ? 0 : r2(delta * prod.costo_usd);
    const otro = razon === 'Otro';
    const motivo = (otro ? detalle.trim() : `${razon}${detalle.trim() ? `: ${detalle.trim()}` : ''}`);
    const lista = useMemo(() => [...RAZONES[modo], 'Otro'], [modo]);

    const enviar = async () => {
        const e = {};
        if (!prod) e.producto_id = 'Elige el producto.';
        if (!cOk) e.cantidad = modo === 'CONTEO' ? 'Escribe cuántas unidades contaste.' : 'Escribe una cantidad mayor que cero.';
        if (otro && detalle.trim().length < 3) e.motivo = 'Cuéntanos el motivo.';
        if (despues != null && despues < 0) e.cantidad = `No alcanza: hay ${u(stock)} unidades.`;
        setErr(e); setMsg(''); if (Object.keys(e).length) return;
        setEnv(true);
        try { const r = await http('POST', '/kardex/ajustar', { producto_id: prod.id, modo, cantidad: c, motivo }); hecho(r); }
        catch (x) { setErr(Object.fromEntries(Object.entries(x.errors || {}).map(([k, v]) => [k, v[0]]))); setMsg(Object.keys(x.errors || {}).length ? '' : x.message); setEnv(false); }
    };

    return (
        <Modal titulo="Ajustar existencias" subtitulo="Todo ajuste queda en el kardex con su motivo y quién lo hizo." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Guardar ajuste" ancho="max-w-[560px]">
            {prod ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3">
                    <div className="min-w-0"><p className="truncate text-[15px] font-semibold">{prod.nombre}</p><p className="text-[13px] text-muted">{prod.sku} · hay <span className="num font-semibold text-text">{u(prod.stock)}</span> {prod.unidad === 'UND' ? 'unidades' : prod.unidad}</p></div>
                    {!producto && <button type="button" onClick={() => { setProd(null); setQ(''); }} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-white hover:text-text" aria-label="Cambiar producto"><X className="size-4" /></button>}
                </div>
            ) : (
                <div>
                    <label className="relative block"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Buscar producto" placeholder="Buscar por nombre, SKU o código de barras" className={`h-12 w-full rounded-lg border bg-white pl-10 pr-3 text-[15px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand ${err.producto_id ? 'border-danger' : 'border-line'}`} /></label>
                    {err.producto_id && <p className="mt-1 text-[13px] text-danger">{err.producto_id}</p>}
                    <ul className="mt-2 max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                        {res.length === 0 ? <li className="px-3 py-3 text-[13px] text-muted">No se encontraron productos.</li> : res.map((x) => (
                            <li key={x.id}><button type="button" onClick={() => { setProd(x); setErr({}); }} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-paper">
                                <span className="min-w-0"><span className="block truncate text-[14px] font-medium">{x.nombre}</span><span className="text-[12.5px] text-muted">{x.sku}</span></span>
                                <span className="num shrink-0 text-[13px] text-muted">{u(x.stock)} en stock</span></button></li>))}
                    </ul>
                </div>
            )}

            <Segmented name="Tipo de ajuste" value={modo} onChange={setModo} options={MODOS} />

            <div className="grid gap-4 sm:grid-cols-2">
                <Field label={modo === 'CONTEO' ? 'Unidades que contaste' : modo === 'SALIDA' ? 'Unidades que salen' : 'Unidades que entran'} inputMode="decimal" value={cant} onChange={(e) => setCant(e.target.value)} error={err.cantidad} autoFocus={!!producto} />
                <Field select label="Motivo" value={razon} onChange={(e) => setRazon(e.target.value)}>{lista.map((r) => <option key={r} value={r}>{r}</option>)}</Field>
            </div>
            <Field label={otro ? 'Cuéntanos el motivo' : 'Detalle (opcional)'} value={detalle} onChange={(e) => setDetalle(e.target.value)} error={err.motivo} />

            {delta != null && (
                <div className={`rounded-xl px-4 py-3 text-[14px] ${despues < 0 ? 'bg-[#fdecec] text-danger' : 'bg-brand-50 text-[#1f2933]'}`} role="status">
                    {despues < 0 ? <>No alcanza: hay {u(stock)} y quieres sacar {u(-delta)}.</> : delta === 0 ? <>El conteo coincide con el sistema: no hay nada que ajustar.</> : (
                        <><span className="font-semibold">Al guardar:</span> el stock pasará de <span className="num font-semibold">{u(stock)}</span> a <span className="num font-semibold">{u(despues)}</span> ({delta > 0 ? '+' : '−'}{u(Math.abs(delta))}). Diferencia a costo: <span className="num font-semibold">{valor < 0 ? '−' : '+'}US$ {n2(Math.abs(valor))}</span>{tasa ? <> · <span className="num">Bs {n2(Math.abs(valor) * tasa)}</span></> : null}.</>)}
                </div>)}
            {msg && <p role="alert" className="text-[13px] text-danger">{msg}</p>}
            <p className="text-[12.5px] text-muted">El ajuste cambia el inventario físico. Todavía no genera asiento contable: si llevas contabilidad, regístralo con tu contador.</p>
        </Modal>
    );
}
