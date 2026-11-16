import { AlertCircle, CircleCheck } from 'lucide-react';

/* Piezas compartidas por las pantallas del SaaS (crear cuenta, suscripción, precios, portal).
   Mismo lenguaje que el resto del sistema: tinta, azul de marca, ámbar de señal. */

export const fecha = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
export const bs = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Un cuadrito por día: lo que ya pasó, el día de hoy y lo que queda. Es el dato real de la demo
   (15 días) o del mes pagado (30), dibujado como la hoja de control que se marca en un taller. */
export function Dias({ total = 15, usados = 0, oscuro, className = '' }) {
    const hoy = Math.min(usados, total - 1);
    const restan = Math.max(total - usados, 0);
    return (
        <div className={className}>
            <div role="img" aria-label={`Han pasado ${Math.min(usados, total)} de ${total} días. Quedan ${restan}.`} className="flex gap-[3px]">
                {Array.from({ length: total }, (_, i) => {
                    const actual = i === hoy && usados < total;
                    const pasado = i < usados && !actual;
                    const c = actual ? 'bg-signal' : pasado ? (oscuro ? 'bg-white/70' : 'bg-brand') : oscuro ? 'bg-white/15' : 'bg-line';
                    return <span key={i} className={`h-7 min-w-0 flex-1 rounded-[3px] ${c}`} />;
                })}
            </div>
            <div className={`mt-1.5 flex justify-between text-[12px] ${oscuro ? 'text-white/60' : 'text-muted'}`} aria-hidden>
                <span>Día 1</span><span>Día {total}</span>
            </div>
        </div>
    );
}

export const ESTADOS = {
    PRUEBA: { t: 'Demo gratis', cls: 'bg-brand-50 text-brand ring-brand/25', dot: 'bg-brand' },
    ACTIVO: { t: 'Al día', cls: 'bg-ok/10 text-ok ring-ok/25', dot: 'bg-ok' },
    MORA: { t: 'Pago pendiente', cls: 'bg-signal/15 text-[#7a5600] ring-signal/50', dot: 'bg-signal' },
    SUSPENDIDO: { t: 'Suspendida', cls: 'bg-danger/10 text-danger ring-danger/25', dot: 'bg-danger' },
    CANCELADO: { t: 'Cancelada', cls: 'bg-paper text-muted ring-line', dot: 'bg-[#9aa4af]' },
};

export function Estado({ estado, className = '' }) {
    const e = ESTADOS[estado] || ESTADOS.CANCELADO;
    return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold ring-1 ring-inset ${e.cls} ${className}`}>
            <span aria-hidden className={`size-1.5 rounded-full ${e.dot}`} />{e.t}
        </span>
    );
}

/* Aviso en línea: error, éxito o advertencia. Dice qué pasó y qué hacer. */
export function Aviso({ tipo = 'info', children, className = '' }) {
    const t = {
        error: ['border-danger/40 bg-danger/5 text-danger', AlertCircle],
        ok: ['border-ok/40 bg-ok/10 text-ok', CircleCheck],
        aviso: ['border-signal/50 bg-signal/10 text-[#6b4a00]', AlertCircle],
        info: ['border-brand/30 bg-brand-50/70 text-text', CircleCheck],
    }[tipo];
    const Ico = t[1];
    return (
        <p role={tipo === 'error' ? 'alert' : undefined} className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13.5px] leading-relaxed ${t[0]} ${className}`}>
            <Ico aria-hidden className="mt-0.5 size-4 shrink-0" /><span>{children}</span>
        </p>
    );
}
