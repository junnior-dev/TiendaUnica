import { Head, Link } from '@inertiajs/react';
import { ArrowRight, Check, Minus } from 'lucide-react';
import { Brand } from '../Layouts/AuthLayout';

/* Página pública de precios: la ve cualquiera que evalúe el SaaS, sin login.
   Los planes y sus reglas viven en portal.planes (34_portal_pagos.sql).
   Es una sola tabla de comparación: lo que cambia entre planes es justo la parte fiscal. */

const GRUPOS = [
    { titulo: 'Operación diaria', sistema: true, especial: true, filas: [
        'Punto de venta en dólares, bolívares, euros y pesos',
        'Inventario con kardex y conteos físicos',
        'Ventas, encargos y clientes',
        'Caja: aperturas, cierres y movimientos',
        'Compras, proveedores y órdenes de compra',
        'Compatibilidad de repuestos por modelo de moto',
        'Usuarios y permisos por rol',
    ] },
    { titulo: 'Parte fiscal y contable', sistema: false, especial: true, filas: [
        'Libros fiscales de ventas y compras',
        'Retenciones de IVA e ISLR',
        'Calendario fiscal con los vencimientos del SENIAT',
        'IGTF y crédito fiscal calculados por el sistema',
        'Contabilidad con asientos y cierres',
    ] },
];

const PREGUNTAS = [
    ['¿La demo es gratis de verdad?', 'Sí. Son 15 días con todo abierto, incluida la parte fiscal, para que decidas viendo cómo trabaja con tus repuestos. No pedimos tarjeta ni datos bancarios.'],
    ['¿Cómo pago cada mes?', 'Por pago móvil o transferencia, en bolívares (a la tasa del día que publicamos) o en dólares. Reportas tu pago en el sistema, lo verificamos contra el estado de cuenta y tu plan se activa.'],
    ['¿Qué pasa si un mes no pago?', 'Te avisamos con días de antelación y tienes 3 días de gracia. Después la tienda se pausa, sin borrar nada; cuando confirmamos tu pago, vuelve todo como estaba.'],
];

const Marca = ({ si }) => si
    ? <><Check className="mx-auto size-5 text-ok" strokeWidth={2.5} aria-hidden /><span className="sr-only">Incluido</span></>
    : <><Minus className="mx-auto size-5 text-[#b3bbc4]" aria-hidden /><span className="sr-only">No incluido</span></>;

export default function Precios() {
    return (
        <div className="min-h-screen bg-white">
            <Head title="Planes y precios" />
            <header className="border-b border-line">
                <div className="mx-auto flex max-w-[1040px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
                    <Brand />
                    <nav className="flex items-center gap-2 text-[14px]">
                        <Link href="/login" className="rounded-lg px-3 py-2 font-semibold text-text hover:bg-paper">Iniciar sesión</Link>
                        <Link href="/crear-cuenta" className="hidden h-10 items-center rounded-lg bg-brand px-4 font-semibold text-white hover:bg-brand-600 sm:inline-flex">Crear cuenta</Link>
                    </nav>
                </div>
            </header>

            <main className="mx-auto max-w-[1040px] px-5 sm:px-8">
                <section className="grid gap-8 py-12 sm:py-16 lg:grid-cols-[1.15fr_1fr] lg:items-end">
                    <div>
                        <h1 className="max-w-[18ch] text-[36px] font-semibold leading-[1.08] tracking-[-0.025em] sm:text-[44px]">El mismo sistema. Pagas la parte fiscal solo si la necesitas.</h1>
                        <p className="mt-4 max-w-[54ch] text-[16px] leading-relaxed text-muted">
                            Si tu negocio declara como <b className="font-semibold text-text">contribuyente especial</b>, el plan de 80 US$ agrega libros,
                            retenciones, calendario y contabilidad. Si no, el de 60 US$ ya trae todo lo demás. Mes a mes, sin contrato anual.
                        </p>
                    </div>
                    <div className="rounded-xl border border-line bg-paper p-5">
                        <p className="text-[15px] font-semibold">Empieza con 15 días gratis</p>
                        <p className="mt-1 text-[14px] leading-relaxed text-muted">Tu tienda queda creada en minutos, con todos los módulos abiertos y sin tarjeta.</p>
                        <Link href="/crear-cuenta" className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-5 text-[15px] font-semibold text-white hover:bg-brand-600">
                            Crear mi cuenta <ArrowRight className="size-4" />
                        </Link>
                    </div>
                </section>

                <section aria-labelledby="comparar" className="pb-4">
                    <h2 id="comparar" className="sr-only">Qué incluye cada plan</h2>
                    <table className="w-full border-collapse text-left">
                        <thead>
                            <tr className="border-b border-ink align-bottom">
                                <th scope="col" className="pb-4 pr-4 text-[14px] font-medium text-muted"><span className="sr-only">Función</span></th>
                                <th scope="col" className="w-[84px] px-1 pb-4 text-center sm:w-[170px]">
                                    <span className="block text-[14px] font-semibold sm:text-[15px]">Sistema</span>
                                    <span className="num block text-[22px] font-semibold sm:text-[28px]">60 US$</span>
                                    <span className="block text-[12.5px] font-normal text-muted">al mes</span>
                                </th>
                                <th scope="col" className="w-[100px] rounded-t-xl bg-brand-50 px-1 pb-4 pt-3 text-center sm:w-[190px]">
                                    <span className="block text-[14px] font-semibold text-brand sm:text-[15px]">Contribuyente especial</span>
                                    <span className="num block text-[22px] font-semibold sm:text-[28px]">80 US$</span>
                                    <span className="block text-[12.5px] font-normal text-muted">al mes</span>
                                </th>
                            </tr>
                        </thead>
                        {GRUPOS.map((g) => (
                            <tbody key={g.titulo}>
                                <tr><th scope="colgroup" colSpan={3} className="pb-2 pt-8 text-[15px] font-semibold">{g.titulo}</th></tr>
                                {g.filas.map((f) => (
                                    <tr key={f} className="border-t border-line">
                                        <th scope="row" className="py-3 pr-4 text-[14.5px] font-normal leading-snug">{f}</th>
                                        <td className="px-1 py-3"><Marca si={g.sistema} /></td>
                                        <td className="bg-brand-50 px-1 py-3"><Marca si={g.especial} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        ))}
                        <tfoot>
                            <tr className="border-t border-ink">
                                <td />
                                <td className="px-1 pt-5 text-center align-top">
                                    <Link href="/crear-cuenta" className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-line bg-white px-2 text-[14px] font-semibold hover:bg-paper sm:text-[15px]">Probar gratis</Link>
                                </td>
                                <td className="rounded-b-xl bg-brand-50 px-1 pb-4 pt-5 text-center align-top">
                                    <Link href="/crear-cuenta" className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand px-2 text-[14px] font-semibold text-white hover:bg-brand-600 sm:text-[15px]">Probar gratis</Link>
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </section>

                <section className="mt-16 grid gap-x-10 gap-y-8 border-t border-line py-12 md:grid-cols-3" aria-label="Preguntas frecuentes">
                    {PREGUNTAS.map(([q, a]) => (
                        <div key={q}>
                            <h3 className="text-[16px] font-semibold">{q}</h3>
                            <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{a}</p>
                        </div>
                    ))}
                </section>
            </main>

            <footer className="border-t border-line bg-paper py-6 text-center text-[13px] text-muted">
                © {new Date().getFullYear()} Repuestos de motos POS · Venezuela
            </footer>
        </div>
    );
}
