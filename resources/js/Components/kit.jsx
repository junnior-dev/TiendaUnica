import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { COLOR, SIMBOLO } from '../lib/format';

export const Card = ({ className = '', children }) => <section className={`min-w-0 rounded-2xl border border-line bg-white ${className}`}>{children}</section>;
export const Titulo = ({ children, aside }) => (
    <div className="flex items-center justify-between gap-3 px-5 pt-5"><h2 className="text-[15px] font-semibold">{children}</h2>{aside}</div>
);
export const Chip = ({ m, size = 'md' }) => (
    <span className={`inline-grid shrink-0 place-items-center rounded-md font-semibold text-white ${size === 'sm' ? 'h-5 min-w-5 px-1 text-[10px]' : 'h-7 min-w-7 px-1.5 text-xs'}`} style={{ background: COLOR[m] }}>{SIMBOLO[m]}</span>
);

/* Etiqueta de dónde salió una tasa. El esquema solo admite estas tres fuentes. */
export const FUENTES = {
    BCV: { t: 'Oficial BCV', c: 'bg-brand-50 text-brand' },
    EXCHANGERATE_API: { t: 'ExchangeRate-API', c: 'bg-[#e7f6ee] text-ok' },
    MANUAL: { t: 'Manual', c: 'bg-paper text-muted' },
};
export const Fuente = ({ f }) => <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${FUENTES[f].c}`}>{FUENTES[f].t}</span>;

export function Sparkline({ serie, light }) {
    if (!serie || serie.length === 0) return null;   // F-1: sin datos no se dibuja nada
    const w = 220, h = 56, min = Math.min(...serie), max = Math.max(...serie), r = max - min || 1;
    // F-1: con UN solo punto el denominador sería 0 (i/0 = NaN → path SVG inválido
    // y errores en la consola del navegador); el máximo lo evita.
    const pts = serie.map((v, i) => [(i / Math.max(serie.length - 1, 1)) * w, h - 6 - ((v - min) / r) * (h - 14)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const col = light ? '#1e4fd6' : '#fff', id = light ? 'spl' : 'spd';
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" preserveAspectRatio="none" role="img" aria-label="Evolución de la tasa">
            <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={col} stopOpacity=".25" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
            <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
            <path d={d} fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <circle cx={pts.at(-1)[0] - 1} cy={pts.at(-1)[1]} r="3.5" fill={col} stroke={light ? '#fff' : '#10141a'} strokeWidth="2" />
        </svg>
    );
}

/* ── Piezas compartidas por los módulos de catálogo ── */
export function Kpi({ icon: Icon, titulo, valor, detalle, tono, onClick, activo }) {
    const T = onClick ? 'button' : 'div';
    return (
        <T onClick={onClick} className={`min-w-0 rounded-2xl border bg-white p-4 text-left ${onClick ? 'hover:border-[#b9c1ca]' : ''} ${activo ? 'border-brand ring-1 ring-brand' : 'border-line'}`}>
            <div className="flex items-center justify-between gap-2"><p className="text-[13px] text-muted">{titulo}</p><span className={`grid size-8 shrink-0 place-items-center rounded-lg ${tono === 'warn' ? 'bg-signal/15 text-[#8a5a00]' : tono === 'bad' ? 'bg-[#fdecec] text-danger' : 'bg-paper text-muted'}`}><Icon className="size-4" /></span></div>
            <p className="num mt-1.5 truncate text-[26px] font-semibold leading-none tracking-[-0.02em]">{valor}</p>
            <p className="mt-1.5 text-[13px] text-muted sm:truncate">{detalle}</p>
        </T>
    );
}

export function Switch({ on, set, label }) {
    return (
        <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)} className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? 'bg-brand' : 'bg-[#c5ccd4]'}`}>
            <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
    );
}

/* Ventana centrada con formulario. Escape y clic fuera la cierran. */
export function Modal({ titulo, subtitulo, cerrar, onSubmit, enviando, ok = 'Guardar', peligro, ancho = 'max-w-[460px]', children }) {
    useEffect(() => { const k = (e) => e.key === 'Escape' && cerrar(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
    return (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label={titulo}>
            <div className="fixed inset-0 bg-black/50" onClick={cerrar} />
            <form onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }} className={`relative my-auto w-full ${ancho} rounded-2xl bg-white p-6 shadow-2xl`}>
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold tracking-[-0.01em]">{titulo}</h2>{subtitulo && <p className="mt-1 text-[13px] leading-snug text-muted">{subtitulo}</p>}</div>
                    <button type="button" onClick={cerrar} aria-label="Cerrar" className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-paper"><X className="size-4" /></button></div>
                <div className="mt-5 space-y-4">{children}</div>
                <div className="mt-6 flex justify-end gap-3">
                    <button type="button" onClick={cerrar} className="inline-flex h-11 items-center rounded-lg border border-line px-5 text-[15px] font-semibold hover:bg-paper">Cancelar</button>
                    <button type="submit" disabled={enviando} className={`inline-flex h-11 items-center rounded-lg px-5 text-[15px] font-semibold text-white disabled:opacity-60 ${peligro ? 'bg-danger hover:bg-[#a3221a]' : 'bg-brand hover:bg-brand-600'}`}>{enviando ? 'Un momento…' : ok}</button>
                </div>
            </form>
        </div>
    );
}

export function Vacio({ icon: Icon, titulo, texto, children }) {
    return (
        <div className="grid place-items-center px-6 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-paper text-muted"><Icon className="size-6" /></span>
            <p className="mt-4 text-[15px] font-semibold">{titulo}</p>
            <p className="mt-1 max-w-[46ch] text-sm text-muted">{texto}</p>
            {children && <div className="mt-5 flex flex-wrap justify-center gap-3">{children}</div>}
        </div>
    );
}

/* Botón de icono para acciones de fila: siempre con nombre accesible. */
export const IconBtn = ({ icon: Icon, label, onClick, tone, disabled }) => (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} disabled={disabled} title={label} aria-label={label}
        className={`grid size-9 place-items-center rounded-lg text-muted disabled:cursor-not-allowed disabled:opacity-30 ${tone === 'danger' ? 'enabled:hover:bg-[#fdecec] enabled:hover:text-danger' : 'enabled:hover:bg-paper enabled:hover:text-text'}`}><Icon className="size-[17px]" /></button>
);

/* Aviso breve tras guardar. Lee `flash.ok` que comparte Laravel (ver LEEME). */
export function Toast({ texto }) {
    const [ver, setVer] = useState(!!texto);
    useEffect(() => { setVer(!!texto); if (!texto) return; const t = setTimeout(() => setVer(false), 4200); return () => clearTimeout(t); }, [texto]);
    if (!ver) return null;
    return <div role="status" className="fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2.5 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white shadow-2xl"><Check className="size-4 text-[#3ddc84]" />{texto}</div>;
}
