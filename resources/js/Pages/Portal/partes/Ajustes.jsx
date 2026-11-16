import { useForm } from '@inertiajs/react';
import { Landmark, RefreshCw } from 'lucide-react';
import { Card, Titulo } from '../../../Components/kit';
import { Aviso } from '../../../Components/saas';
import { campo } from '../comun';

/* Tasa del día (para cobrar en bolívares) y cuentas donde los clientes pagan. */

export default function Ajustes({ tasa, cuentas, errors }) {
    const tasaForm = useForm({ tasa: tasa || '' });
    const cuenta = useForm({ banco: '', tipo_cuenta: 'pago móvil', numero: '', titular: '', rif_titular: '', moneda: 'BS', notas: '' });
    const Etiqueta = ({ t, children }) => <label className="block"><span className="mb-1.5 block text-[13.5px] font-medium">{t}</span>{children}</label>;
    return (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.3fr]">
            <Card className="p-5">
                <h2 className="text-[16px] font-semibold">Tasa del día (US$ a Bs)</h2>
                <p className="mt-1 text-[14px] leading-relaxed text-muted">Quien paga en bolívares ve el monto calculado con esta tasa. Publícala cada mañana.</p>
                <form onSubmit={(e) => { e.preventDefault(); tasaForm.post('/portal/tasa', { preserveScroll: true }); }} className="mt-4 flex gap-2">
                    <input value={tasaForm.data.tasa} onChange={(e) => tasaForm.setData('tasa', e.target.value)} inputMode="decimal" placeholder="Ej: 914,02" aria-label="Tasa del día en bolívares" className={`${campo} num !w-40`} />
                    <button disabled={tasaForm.processing} className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-5 text-[14.5px] font-semibold text-white hover:bg-brand-600 disabled:opacity-60"><RefreshCw aria-hidden className="size-4" />Publicar</button>
                </form>
                {(tasaForm.errors.tasa || errors?.general) && <Aviso tipo="error" className="mt-3">{tasaForm.errors.tasa || errors.general}</Aviso>}
            </Card>
            <Card>
                <Titulo>Cuentas de cobro</Titulo>
                <p className="px-5 pt-1 text-[14px] text-muted">Es lo que ven los clientes en su página de pago.</p>
                <ul className="mt-3 space-y-2 px-5">
                    {cuentas.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper/50 px-3.5 py-2.5 text-[14px]">
                            <span className="flex min-w-0 items-center gap-2.5"><Landmark aria-hidden className="size-4 shrink-0 text-muted" /><span className="min-w-0 truncate"><b className="font-semibold">{c.banco}</b> <span className="num text-muted">{c.numero}</span></span></span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold ${c.moneda === 'USD' ? 'bg-ok/10 text-ok' : 'bg-brand-50 text-brand'}`}>{c.moneda === 'USD' ? 'Dólares' : 'Bolívares'}</span>
                        </li>
                    ))}
                    {!cuentas.length && <li className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-[14px] text-muted">Todavía no hay cuentas. Agrega la primera abajo.</li>}
                </ul>
                <form onSubmit={(e) => { e.preventDefault(); cuenta.post('/portal/cuentas', { preserveScroll: true, onSuccess: () => cuenta.reset() }); }} className="mt-5 border-t border-line p-5">
                    <p className="text-[14.5px] font-semibold">Agregar una cuenta</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Etiqueta t="Banco"><input value={cuenta.data.banco} onChange={(e) => cuenta.setData('banco', e.target.value)} placeholder="Ej: Banesco" className={campo} /></Etiqueta>
                        <Etiqueta t="Cuenta o teléfono"><input value={cuenta.data.numero} onChange={(e) => cuenta.setData('numero', e.target.value)} className={`${campo} num`} /></Etiqueta>
                        <Etiqueta t="Titular"><input value={cuenta.data.titular} onChange={(e) => cuenta.setData('titular', e.target.value)} className={campo} /></Etiqueta>
                        <Etiqueta t="RIF del titular"><input value={cuenta.data.rif_titular} onChange={(e) => cuenta.setData('rif_titular', e.target.value)} placeholder="J-12345678-9" className={campo} /></Etiqueta>
                        <Etiqueta t="Tipo"><select value={cuenta.data.tipo_cuenta} onChange={(e) => cuenta.setData('tipo_cuenta', e.target.value)} className={campo}><option value="pago móvil">Pago móvil</option><option value="corriente">Cuenta corriente</option><option value="ahorros">Cuenta de ahorros</option></select></Etiqueta>
                        <Etiqueta t="Moneda"><select value={cuenta.data.moneda} onChange={(e) => cuenta.setData('moneda', e.target.value)} className={campo}><option value="BS">Bolívares</option><option value="USD">Dólares</option></select></Etiqueta>
                    </div>
                    {Object.values(cuenta.errors).length > 0 && <Aviso tipo="error" className="mt-3">Revisa los datos: {Object.values(cuenta.errors)[0]}</Aviso>}
                    <button disabled={cuenta.processing} className="mt-4 inline-flex h-11 items-center rounded-lg bg-brand px-5 text-[14.5px] font-semibold text-white hover:bg-brand-600 disabled:opacity-60">Guardar cuenta</button>
                </form>
            </Card>
        </div>
    );
}
