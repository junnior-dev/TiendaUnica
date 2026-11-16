import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';

/* Impresora de tickets con la factura saliendo. Montos que cuadran:
   34,50 + IVA 16 % (5,52) + IGTF 3 % sobre los pagos en divisas (0,96) = 40,98 = 36.517,50 Bs.
   Tasas: US$ 891,11 · € 997,92 · COP 0,2800. Divisas: Zelle 20 US$ + 5 € + 20.000 COP = Bs 28.410,92; Pago móvil Bs 8.106,58. */
const mono = { fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace" };
const Raya = () => <div className="my-2 border-t border-dashed border-[#b4b4ae]" />;
const Fila = ({ a, b, bold, big }) => (
    <div className={`flex justify-between gap-3 ${bold ? 'font-bold text-[#0d0d0d]' : ''} ${big ? 'text-[13px]' : ''}`}><span>{a}</span><span className="shrink-0">{b}</span></div>
);

/* QR decorativo y estable (no codifica nada) */
function Qr() {
    const n = 21, cells = [];
    const finder = (x, y) => (x < 7 && y < 7) || (x > n - 8 && y < 7) || (x < 7 && y > n - 8);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let on;
        if (finder(x, y)) { const fx = x % (n - 7 > x ? 1 : 1); const lx = x < 7 ? x : x - (n - 7), ly = y < 7 ? y : y - (n - 7); on = lx === 0 || lx === 6 || ly === 0 || ly === 6 || (lx > 1 && lx < 5 && ly > 1 && ly < 5); }
        else on = ((x * 7 + y * 13 + x * y) % 5) < 2;
        if (on) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
    }
    return <svg viewBox={`0 0 ${n} ${n}`} className="size-16" fill="#111" shapeRendering="crispEdges" aria-hidden>{cells}</svg>;
}

export default function Ticket() {
    const [listo, setListo] = useState(false);
    useEffect(() => { const t = setTimeout(() => setListo(true), 4100); return () => clearTimeout(t); }, []);
    return (
        <div className="mx-auto w-full max-w-[440px]">
            {/* Cuerpo de la impresora */}
            <div className="relative z-10 rounded-2xl border border-white/10 bg-gradient-to-b from-[#3a424c] via-[#242a31] to-[#14181c] px-5 pb-4 pt-3 shadow-[0_24px_60px_-12px_rgba(0,0,0,.9),inset_0_1px_0_rgba(255,255,255,.16)]">
                <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[11px] font-medium text-white/50"><Printer className="size-3.5" />POS-80 · Impresora térmica</span>
                    <span className={`flex items-center gap-1.5 text-[11px] font-medium ${listo ? 'text-[#3ddc84]' : 'text-signal'}`}>
                        <span className={`size-1.5 rounded-full ${listo ? 'bg-[#3ddc84] shadow-[0_0_8px_#3ddc84]' : 'animate-pulse bg-signal shadow-[0_0_8px_#f2a900]'}`} />{listo ? 'Lista' : 'Imprimiendo…'}
                    </span>
                </div>
                <div className="mt-3 flex items-center gap-3">
                    <div className="h-3 flex-1 rounded-full bg-black shadow-[inset_0_3px_4px_rgba(0,0,0,.95),0_1px_0_rgba(255,255,255,.12)]" />
                    <span className="size-3.5 rounded-full border border-white/15 bg-gradient-to-b from-[#4a525c] to-[#20252b] shadow-inner" />
                </div>
            </div>
            {/* El ticket sale por la ranura */}
            <div className="relative mx-auto -mt-[7px] w-[88%] overflow-hidden pb-2 max-h-[calc(100vh-320px)]">
                <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-black/35 to-transparent" />
                <div className="print-out ticket-edge bg-gradient-to-b from-[#fdfdfb] to-[#f3f3ef] px-5 pb-7 pt-5 text-[10.5px] leading-[1.45] text-[#3a3a36]" style={mono}>
                    <div className="text-center">
                        <p className="text-[13px] font-bold tracking-wide text-[#0d0d0d]">MOTO REPUESTOS EL TÁCHIRA, C.A.</p>
                        <p>RIF J-12345678-4</p>
                        <p>Av. Principal, local 4, San Cristóbal, Táchira</p>
                    </div>
                    <Raya />
                    <div className="flex justify-between"><span className="font-bold text-[#0d0d0d]">FACTURA N° 00000184</span><span>Caja 1 · Luis R.</span></div>
                    <div className="flex justify-between"><span>Control 00-000184</span><span>03/11/2026 10:42</span></div>
                    <Raya />
                    <div className="flex justify-between"><span>Cliente: Carlos Mora</span><span>V-12.345.678</span></div>
                    
                    <Raya />
                    <div className="grid grid-cols-[22px_1fr_auto] gap-x-2 font-bold text-[#0d0d0d]"><span>Cant</span><span>Descripción</span><span className="text-right">Total $</span></div>
                    <div className="mt-1 space-y-0.5">
                        {[['1', 'Pastillas freno del. CG150', 'FR-0142', '8,50'], ['1', 'Cadena transmisión 428H', 'TR-0087', '14,00'], ['2', 'Aceite 20W-50 1 L × 6,00', 'LU-0031', '12,00']].map(([c, d, s, t]) => (
                            <div key={d} className="grid grid-cols-[22px_1fr_auto] gap-x-2"><span>{c}</span><span>{d} <span className="text-[#9a9a94]">{s}</span></span><span className="text-right">{t}</span></div>
                        ))}
                    </div>
                    <Raya />
                    <Fila a="Base imponible" b="34,50" />
                    <Fila a="IVA 16 %" b="5,52" />
                    <Fila a="IGTF 3 % (pagos en divisas)" b="0,96" />
                    <div className="mt-1.5 border-t border-[#0d0d0d] pt-1.5">
                        <Fila a="TOTAL USD" b="$ 40,98" bold big />
                        <Fila a="TOTAL Bs (tasa 891,11)" b="Bs 36.517,50" bold big />
                    </div>
                    <Raya />
                    <p className="font-bold text-[#0d0d0d]">FORMA DE PAGO</p>
                    <Fila a="Zelle" b="$ 20,00" />
                    <Fila a="Efectivo EUR" b="€ 5,00" />
                    <Fila a="Efectivo COP" b="COP 20.000" />
                    <Fila a="Pago móvil" b="Bs 8.106,58" />
                    <p className="mt-1 text-[10px] text-[#8a8a84]">Tasas Bs: US$ 891,11 · € 997,92 · COP 0,2800</p>
                    <Raya />
                    <div className="flex items-center gap-3">
                        <Qr />
                        <p className="text-[10px] leading-snug text-[#6a6a64]">La tasa de esta venta queda fija aunque el BCV la cambie mañana.<br /><span className="font-bold text-[#0d0d0d]">¡Gracias por su compra!</span></p>
                    </div>
                </div>
            </div>
        </div>
    );
}
