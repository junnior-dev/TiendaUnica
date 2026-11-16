import { ClipboardCheck, Pencil, BadgeCheck, BellRing, BookOpen, Calculator, Coins, FileText, Landmark, ListChecks, Lock, Percent, Scale, ShieldCheck, UserCog, Users, Boxes } from 'lucide-react';

/* Columna informativa de crear cuenta: texto + iconos, sin mockups. */
const PASOS = [
    {
        titulo: 'Tú administras, tu equipo vende.',
        texto: 'Esta cuenta controla todo el sistema. Desde aquí configuras el negocio y después creas a tus cajeros.',
        items: [
            [UserCog, 'Un administrador, varios cajeros', 'Tú ves costos, compras y reportes. Cada cajero solo cobra y cierra su caja.'],
            [ShieldCheck, 'Tu contraseña va cifrada', 'Se guarda de forma que nadie, ni tú, pueda leerla después.'],
            [Users, 'Cada venta lleva un nombre', 'Queda registrado quién la hizo, para cuadrar la caja sin discusiones.'],
        ],
    },
    {
        titulo: 'Estos datos salen en cada factura.',
        texto: 'Escribe la razón social y el RIF tal como aparecen en el SENIAT, para que tus facturas salgan correctas desde la primera venta.',
        items: [
            [FileText, 'Encabezado de tus facturas', 'Razón social, RIF y dirección fiscal se imprimen en cada ticket.'],
            [BadgeCheck, 'RIF verificado al instante', 'Revisamos el último dígito para que un error de tipeo no llegue a tus facturas.'],
            [BookOpen, 'Libros de ventas y compras', 'Los mismos datos se usan en tus libros fiscales.'],
        ],
    },
    {
        titulo: 'Tus impuestos, calculados solos.',
        texto: 'Con estas opciones el sistema calcula el IVA y el IGTF en cada venta, sin que el cajero tenga que hacer cuentas.',
        items: [
            [Percent, 'IVA del 16 % en cada venta', 'Se suma solo a cada producto. Si tus precios ya lo incluyen, también lo respeta.'],
            [Landmark, 'IGTF para pagos en divisas', 'El 3 % se agrega cuando el cliente paga en dólares o euros. Solo lo cobran los contribuyentes especiales.'],
            [Scale, 'Crédito fiscal en tus libros', 'El IVA de tus compras queda registrado para restarlo del que cobras.'],
        ],
    },
    {
        titulo: 'Pon el costo, y el precio sale solo.',
        texto: 'Define tu ganancia una vez. Después, cada repuesto se calcula a partir de lo que te cuesta.',
        items: [
            [Calculator, 'Precio a partir del costo', 'Costo más tu porcentaje de ganancia, redondeado al centavo.'],
            [Boxes, 'Costo de la última compra o promedio', 'Tú eliges cuál refleja mejor lo que te cuesta cada repuesto.'],
            [BellRing, 'Avisos cuando sube el costo', 'Si un proveedor sube el precio, el sistema te avisa o ajusta el precio, como prefieras.'],
        ],
    },
    {
        titulo: 'Cobra en cuatro monedas.',
        texto: 'Dólares, bolívares, euros y pesos colombianos en una misma factura. Cada moneda necesita su tasa del día.',
        items: [
            [Coins, 'Pagos mixtos', 'Un cliente puede pagar parte en Zelle, parte en euros en efectivo y el resto en Pago móvil.'],
            [Lock, 'La tasa queda fija en cada venta', 'Aunque la tasa cambie mañana, la factura de hoy no se altera.'],
            [Landmark, 'Euros y pesos son opcionales', 'Si hoy solo cobras en dólares y bolívares, déjalos vacíos. Podrás agregarlos después.'],
        ],
    },
    {
        titulo: 'Un último vistazo antes de abrir las ventas.',
        texto: 'Revisa cada sección. Si algo no está bien, usa Editar o vuelve atrás: no se guarda nada hasta que confirmes.',
        items: [
            [ClipboardCheck, 'Todo en un solo lugar', 'Ves tus datos, tus impuestos, tus precios y tus tasas tal como quedarán.'],
            [Pencil, 'Corrige sin perder nada', 'Cada sección tiene su botón Editar y lo que ya escribiste se conserva.'],
            [ListChecks, 'Verificamos por ti', 'Al confirmar, el sistema comprueba que no falte ningún dato y abre las ventas.'],
        ],
    },
];

export default function Info({ paso, d }) {
    const p = PASOS[paso];
    return (
        <>
            <h2 className="max-w-[22ch] text-[32px] font-semibold leading-[1.12] tracking-[-0.02em]">{p.titulo}</h2>
            <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-white/65">{p.texto}</p>
            <ul className="mt-9 space-y-6">
                {p.items.map(([Icon, t, s]) => (
                    <li key={t} className="flex gap-4">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-white"><Icon className="size-5" /></span>
                        <span><span className="block text-[15px] font-medium">{t}</span><span className="mt-0.5 block max-w-[42ch] text-sm leading-relaxed text-white/55">{s}</span></span>
                    </li>
                ))}
            </ul>
            {paso === 2 && !d.es_contribuyente_especial && (
                <p className="mt-8 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-[13px] leading-relaxed text-white/60">Como no eres contribuyente especial, el IGTF queda apagado.</p>
            )}
        </>
    );
}
