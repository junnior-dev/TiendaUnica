import { Head, Link, useForm } from '@inertiajs/react';
import { ArrowRight, Lock, User } from 'lucide-react';
import AuthLayout from '../../Layouts/AuthLayout';
import { Button, Field, PasswordField } from '../../Components/ui';
import Ticket from '../../Components/Ticket';

const MONEDAS = [['$', 'Dólar'], ['€', 'Euro'], ['COP', 'Peso colombiano'], ['Bs', 'Bolívar']];
const Aside = () => (
    <>
        <h2 className="max-w-[26ch] text-[26px] font-semibold leading-[1.15] tracking-[-0.02em]">Cobra en dólares, euros, pesos y bolívares, sin calculadora.</h2>
        <p className="mt-2 max-w-[48ch] text-[14px] leading-relaxed text-white/65">
            Una misma factura puede pagarse con varias monedas. El sistema suma el IVA y el IGTF y guarda la tasa de cada una.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
            {MONEDAS.map(([s, n]) => (
                <li key={n} className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] py-1 pl-1 pr-3 text-[13px] text-white/85">
                    <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white/10 px-1.5 text-[11px] font-semibold">{s}</span>{n}
                </li>
            ))}
        </ul>
        <div className="mt-5"><Ticket /></div>
    </>
);

export default function Login() {
    const { data, setData, post, processing, errors } = useForm({ username: '', password: '', remember: true });
    const submit = (e) => { e.preventDefault(); post('/login'); };

    return (
        <AuthLayout aside={<Aside />}>
            <Head title="Iniciar sesión" />
            <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Iniciar sesión</h1>
            <p className="mt-2 text-[15px] text-muted">Escribe tu usuario y tu contraseña para abrir la caja o revisar el inventario.</p>

            <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
                <Field label="Usuario" icon={User} value={data.username} onChange={(e) => setData('username', e.target.value)}
                    error={errors.username} autoComplete="username" autoFocus placeholder="Ej: admin" />
                <PasswordField label="Contraseña" icon={Lock} value={data.password} onChange={(e) => setData('password', e.target.value)}
                    error={errors.password} autoComplete="current-password"  />
                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                    <input type="checkbox" checked={data.remember} onChange={(e) => setData('remember', e.target.checked)} className="size-4 rounded border-line accent-brand" />
                    Recordarme en este equipo
                </label>
                <Button type="submit" disabled={processing} className="w-full">Iniciar sesión <ArrowRight className="size-4" /></Button>
            </form>

            <p className="mt-8 border-t border-line pt-6 text-sm text-muted">
                ¿Es la primera vez que usas el sistema?{' '}
                <Link href="/registro" className="font-semibold text-brand hover:underline">Crea tu cuenta</Link>
            </p>
        </AuthLayout>
    );
}
