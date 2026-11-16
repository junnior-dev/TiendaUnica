import { Head, Link, useForm } from '@inertiajs/react';
import { ArrowRight, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import AuthLayout from '../../Layouts/AuthLayout';
import { Button, PasswordField } from '../../Components/ui';

const Aside = ({ obligatorio }) => (
    <>
        <span className="grid size-12 place-items-center rounded-xl bg-white/10"><ShieldCheck className="size-6" /></span>
        <h2 className="mt-5 max-w-[24ch] text-[26px] font-semibold leading-[1.15] tracking-[-0.02em]">{obligatorio ? 'Tu contraseña es solo tuya.' : 'Cuida el acceso a tu caja.'}</h2>
        <p className="mt-2 max-w-[48ch] text-[14px] leading-relaxed text-white/65">Lo que se registra con tu usuario (ventas, cobros, ajustes) queda a tu nombre. Por eso nadie más debería conocer tu contraseña, ni siquiera quien te creó el usuario.</p>
        <ul className="mt-5 space-y-2 text-[14px] text-white/80">
            {['Mínimo 8 caracteres.', 'Mezcla letras y números; evita tu cédula o tu fecha de nacimiento.', 'No la compartas ni la dejes escrita junto a la caja.'].map((t) => <li key={t} className="flex gap-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-white/50" />{t}</li>)}
        </ul>
    </>
);

export default function CambiarPassword({ obligatorio, nombre, inicio }) {
    const { data, setData, post, processing, errors, reset } = useForm({ actual: '', nueva: '', nueva_confirmation: '' });
    const submit = (e) => { e.preventDefault(); post('/cuenta/contrasena', { onError: () => reset('nueva', 'nueva_confirmation') }); };
    const primer = (nombre || '').split(/\s+/)[0];
    return (
        <AuthLayout aside={<Aside obligatorio={obligatorio} />}>
            <Head title="Cambiar contraseña" />
            <h1 className="text-[28px] font-semibold tracking-[-0.02em]">{obligatorio ? `Hola, ${primer}. Crea tu contraseña` : 'Cambiar mi contraseña'}</h1>
            <p className="mt-2 text-[15px] text-muted">{obligatorio ? 'Entraste con una contraseña temporal. Elige la tuya para continuar; es un paso de una sola vez.' : 'Escribe la actual y la nueva. Tu sesión sigue abierta al terminar.'}</p>
            <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
                <PasswordField label={obligatorio ? 'Contraseña temporal' : 'Contraseña actual'} icon={Lock} value={data.actual} onChange={(e) => setData('actual', e.target.value)} error={errors.actual} autoComplete="current-password" autoFocus />
                <PasswordField label="Contraseña nueva" icon={KeyRound} value={data.nueva} onChange={(e) => setData('nueva', e.target.value)} error={errors.nueva} autoComplete="new-password" hint="Al menos 8 caracteres." />
                <PasswordField label="Repite la contraseña nueva" icon={KeyRound} value={data.nueva_confirmation} onChange={(e) => setData('nueva_confirmation', e.target.value)} autoComplete="new-password" />
                <Button type="submit" disabled={processing} className="w-full">Guardar contraseña <ArrowRight className="size-4" /></Button>
            </form>
            <div className="mt-8 border-t border-line pt-6 text-sm text-muted">
                {obligatorio ? <button onClick={() => post('/logout')} className="font-semibold text-brand hover:underline">Salir y entrar con otro usuario</button> : <Link href={inicio} className="font-semibold text-brand hover:underline">Volver</Link>}
            </div>
        </AuthLayout>
    );
}
