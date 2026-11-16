import { router } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { Modal } from '../../Components/kit';
import { bs, fecha } from '../../Components/saas';

export { bs, fecha };
export const DEFECTO = { orden: 'atencion', por: 10 };
export const campo = 'h-11 w-full rounded-lg border border-line bg-white px-3 text-[14.5px] placeholder:text-[#8d97a2] hover:border-[#b9c1ca] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand';
export const NOMBRE_PLAN = { SISTEMA: 'Sistema', ESPECIAL: 'Contribuyente especial', DEMO: 'Demo' };
export const nombrePlan = (p) => NOMBRE_PLAN[String(p).toUpperCase()] || p;

/** Navega a /portal con los filtros de la vista. Lo vacío y lo que ya es el valor por defecto no ensucian la URL. */
export function ir(base, cambios = {}) {
    const x = { ...base, ...cambios };
    if (!('pagina' in cambios)) x.pagina = 1;           // cambiar un filtro vuelve a la primera página
    const lim = {};
    for (const [k, v] of Object.entries(x)) {
        if (v === '' || v == null || v === 0 || v === '0') continue;
        if (k in DEFECTO && String(v) === String(DEFECTO[k])) continue;
        if (k === 'pagina' && Number(v) <= 1) continue;
        if (k === 'vista' && v === 'resumen') continue;
        if (k === 'seg' && v === 'pendientes') continue;
        lim[k] = v;
    }
    router.get('/portal', lim, { preserveState: true, preserveScroll: true, replace: true });
}

/** Ejecuta `f` 350 ms después de que `valor` deje de cambiar (no la dispara al montar). */
export function useRetraso(valor, f) {
    const primera = useRef(true);
    useEffect(() => {
        if (primera.current) { primera.current = false; return undefined; }
        const id = setTimeout(f, 350);
        return () => clearTimeout(id);
    }, [valor]);
}

export function Buscador({ valor, set, placeholder, etiqueta }) {
    return (
        <label className="relative block min-w-[220px] flex-1">
            <span className="sr-only">{etiqueta}</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input type="search" value={valor} onChange={(e) => set(e.target.value)} placeholder={placeholder} className={`${campo} pl-9`} />
        </label>
    );
}

/** Botón-filtro con contador: «Todas 47», «En mora 4»… */
export function Chip({ activo, onClick, children, n }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={activo}
            className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors ${activo ? 'border-brand bg-brand-50 text-brand' : 'border-line bg-white text-text hover:bg-paper'}`}>
            {children}{n != null && <span className={`num rounded-full px-1.5 text-[12px] ${activo ? 'bg-brand/15' : 'bg-paper text-muted'}`}>{n}</span>}
        </button>
    );
}

/** «en 5 días», «hoy», «hace 3 días» con color según urgencia. */
export function Plazo({ dias }) {
    if (dias == null) return null;
    const t = dias === 0 ? 'vence hoy' : dias > 0 ? `en ${dias} ${dias === 1 ? 'día' : 'días'}` : `hace ${-dias} ${dias === -1 ? 'día' : 'días'}`;
    return <span className={`block text-[12.5px] ${dias < 0 ? 'font-medium text-danger' : dias <= 7 ? 'font-medium text-[#8a5a00]' : 'text-muted'}`}>{t}</span>;
}

export const Cabeza = ({ children, derecha }) => <th scope="col" className={`px-4 py-3 text-[13px] font-medium text-muted ${derecha ? 'text-right' : 'text-left'}`}>{children}</th>;

/** Reporte de pago esperando verificación: aprobar en un clic; rechazar pide el motivo (lo ve el cliente). */
export function PagoPendiente({ s }) {
    const [rechazando, setRechazando] = useState(false);
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(false);
    const enviar = (aprobar) => {
        setEnviando(true);
        router.post(`/portal/pagos/${s.id}/verificar`, { aprobar, motivo: aprobar ? '' : motivo.trim() }, { preserveScroll: true, onFinish: () => { setEnviando(false); setRechazando(false); } });
    };
    return (
        <article className="rounded-2xl border border-line bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[16px] font-semibold">{s.subdominio}<span className="rounded-md bg-paper px-2 py-0.5 text-[12px] font-medium text-muted">{nombrePlan(s.plan)}</span></p>
                    <p className="num mt-1.5 text-[19px] font-semibold">
                        {s.moneda === 'BS' ? <>Bs {bs(s.monto_bs)} <span className="text-[13.5px] font-normal text-muted">(≈ {bs(s.monto_usd)} US$ a {s.tasa_aplicada})</span></> : <>{bs(s.monto_usd)} US$</>}
                    </p>
                    <p className="mt-1 text-[13.5px] text-muted">{s.banco_origen} · referencia <b className="num font-semibold text-text">{s.referencia}</b> · pagado el <span className="num">{fecha(s.pagado_el)}</span></p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setRechazando(true)} className="inline-flex h-11 items-center gap-2 rounded-lg border border-danger/50 px-4 text-[14.5px] font-semibold text-danger hover:bg-danger/5"><X aria-hidden className="size-4" strokeWidth={3} />Rechazar</button>
                    <button onClick={() => enviar(true)} disabled={enviando} className="inline-flex h-11 items-center gap-2 rounded-lg bg-ok px-5 text-[14.5px] font-semibold text-white hover:bg-[#10703f] disabled:opacity-60"><Check aria-hidden className="size-4" strokeWidth={3} />Verificar y activar</button>
                </div>
            </div>
            {rechazando && (
                <Modal titulo={`Rechazar el pago de ${s.subdominio}`} subtitulo="El cliente verá este motivo en su pantalla de suscripción, así que dile qué revisar." cerrar={() => setRechazando(false)}
                    onSubmit={() => motivo.trim().length >= 5 && enviar(false)} enviando={enviando} ok="Rechazar pago" peligro>
                    <label className="block"><span className="mb-1.5 block text-[14px] font-medium">Motivo</span>
                        <textarea autoFocus rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: la referencia no aparece en el estado de cuenta"
                            className="w-full rounded-lg border border-line px-3 py-2 text-[14.5px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" /></label>
                    {motivo.trim().length < 5 && <p className="text-[12.5px] text-muted">Escribe al menos 5 letras.</p>}
                </Modal>
            )}
        </article>
    );
}

