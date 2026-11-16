import { Head, Link } from '@inertiajs/react';
import { ArrowRight, Check, Minus } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card } from '../../Components/kit';

/* Página que ve la tienda cuyo plan NO incluye los módulos fiscal, contable o
   ISLR (Plan Sistema, 60 USD). El middleware ModuloFiscal la muestra con código
   403 en las rutas fiscales; el menú ya las oculta para que sea difícil llegar. */

const INCLUIDO = ['Punto de venta y caja', 'Inventario y kardex', 'Compras y proveedores', 'Encargos y clientes'];
const FISCAL = ['Libros fiscales de ventas y compras', 'Retenciones de IVA e ISLR', 'Calendario fiscal del SENIAT', 'Contabilidad con asientos y cierres'];

const Lista = ({ items, si }) => (
    <ul className="mt-3 space-y-2.5">
        {items.map((t) => (
            <li key={t} className="flex items-start gap-2.5 text-[14.5px] leading-snug">
                {si ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={2.5} /> : <Minus aria-hidden className="mt-0.5 size-4 shrink-0 text-[#9aa4af]" />}
                <span>{t}<span className="sr-only">{si ? ' (incluido)' : ' (no incluido en tu plan)'}</span></span>
            </li>
        ))}
    </ul>
);

export default function PlanRequerido({ usuario, negocio, actual, plan }) {
    return (
        <AppLayout actual={actual || '/suscripcion'} titulo="No incluido en tu plan" usuario={usuario} negocio={negocio}>
            <Head title="Módulo no incluido en tu plan" />
            <Card className="mx-auto mt-4 max-w-[760px] p-6 sm:p-8">
                <h2 className="max-w-[24ch] text-[26px] font-semibold leading-[1.15] tracking-[-0.02em]">La parte fiscal va con el plan Contribuyente especial</h2>
                <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-muted">
                    Libros, retenciones, calendario del SENIAT y contabilidad están pensados para quienes declaran como
                    contribuyentes especiales. Tu plan {plan === 'SISTEMA' ? 'Sistema (60 US$ al mes)' : 'actual'} ya cubre todo lo operativo.
                </p>
                <div className="mt-7 grid gap-8 border-t border-line pt-6 sm:grid-cols-2">
                    <div>
                        <h3 className="text-[15px] font-semibold">Ya lo tienes</h3>
                        <Lista items={INCLUIDO} si />
                    </div>
                    <div>
                        <h3 className="text-[15px] font-semibold">Con el plan de 80 US$ al mes se suma</h3>
                        <Lista items={FISCAL} />
                    </div>
                </div>
                <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
                    <Link href="/suscripcion" className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-5 text-[15px] font-semibold text-white transition-colors hover:bg-brand-600">
                        Cambiar de plan <ArrowRight className="size-4" />
                    </Link>
                    <p className="text-[13.5px] text-muted">Al cambiar, los módulos aparecen solos. No reinstalas nada.</p>
                </div>
            </Card>
        </AppLayout>
    );
}
