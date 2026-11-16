import { n2 } from '../lib/format';

export const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const mesCorto = (ym) => MESES[Number(ym.slice(5, 7)) - 1];
export const dmy = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
export const dolares = (v) => `US$ ${n2(v)}`;
/* Iniciales para el monograma. Con `persona`, nombre + apellido: «José Gregorio Pérez» → JP. */
export const iniciales = (n, persona = false) => {
    const w = n.replace(/[.,]/g, '').split(/\s+/).filter((p) => p && !/^(c|a|s|ca|sa|de|del|y|la|los|las|el)$/i.test(p));
    const l = persona && w.length >= 3 ? [w[0], w[2]] : w.slice(0, 2);
    return l.map((p) => p[0]).join('').toUpperCase() || '?';
};

/* "hace 3 días", "hace 2 meses"… a partir de la fecha de hoy que manda el servidor. */
export function hace(fecha, hoy) {
    if (!fecha) return 'Sin compras';
    const d = Math.round((new Date(`${hoy}T00:00:00`) - new Date(`${fecha}T00:00:00`)) / 86400000);
    if (d <= 0) return 'Hoy';
    if (d === 1) return 'Ayer';
    if (d < 30) return `Hace ${d} días`;
    const m = Math.floor(d / 30);
    return m < 12 ? `Hace ${m} ${m === 1 ? 'mes' : 'meses'}` : `Hace ${Math.floor(m / 12)} ${m < 24 ? 'año' : 'años'}`;
}

/* Números móviles venezolanos (0414…) → enlace de WhatsApp con código de país. */
export function whatsapp(tel) {
    const d = (tel || '').replace(/\D/g, '');
    if (/^0(4(12|14|16|24|26))\d{7}$/.test(d)) return `https://wa.me/58${d.slice(1)}`;
    if (/^58(4(12|14|16|24|26))\d{7}$/.test(d)) return `https://wa.me/${d}`;
    return null;
}

/* Gráfico de barras de 12 meses, hecho a mano: sin librerías y con etiquetas legibles. */
export function Ritmo({ meses }) {
    const max = Math.max(...meses.map((m) => m.usd), 1);
    const H = 120, W = 480, bw = W / meses.length;
    return (
        <figure>
            <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full" role="img" aria-label={`Compras por mes en dólares, últimos 12 meses. Máximo ${dolares(max)}.`}>
                <line x1="0" x2={W} y1={H} y2={H} stroke="#d9dee4" />
                {meses.map((m, i) => {
                    const h = m.usd > 0 ? Math.max(4, (m.usd / max) * (H - 14)) : 0;
                    const ultimo = i === meses.length - 1;
                    return (
                        <g key={m.mes}>
                            <title>{`${mesCorto(m.mes)} ${m.mes.slice(0, 4)}: ${m.n} ${m.n === 1 ? 'compra' : 'compras'} · ${dolares(m.usd)}`}</title>
                            {h > 0 ? <rect x={i * bw + 5} y={H - h} width={bw - 10} height={h} rx="3" fill={ultimo ? '#1e4fd6' : '#9db6f0'} /> : <rect x={i * bw + 5} y={H - 2} width={bw - 10} height="2" rx="1" fill="#d9dee4" />}
                            <text x={i * bw + bw / 2} y={H + 15} textAnchor="middle" fontSize="10.5" fill="#5b6672">{mesCorto(m.mes)}</text>
                        </g>
                    );
                })}
            </svg>
        </figure>
    );
}

export const Dato = ({ icon: Icon, label, children, vacio }) => (
    <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-paper text-muted"><Icon className="size-4" /></span>
        <div className="min-w-0"><p className="text-[13px] text-muted">{label}</p>{children ? <div className="break-words text-[15px]">{children}</div> : <p className="text-[15px] text-[#8d97a2]">{vacio}</p>}</div>
    </div>
);

export const Cifra = ({ titulo, valor, detalle }) => (
    <div className="min-w-0 rounded-xl border border-line p-3.5">
        <p className="text-[13px] text-muted">{titulo}</p>
        <p className="num mt-1 text-[18px] font-semibold leading-tight tracking-[-0.02em] sm:text-[19px]">{valor}</p>
        {detalle && <p className="mt-1.5 text-[13px] leading-snug text-muted">{detalle}</p>}
    </div>
);

