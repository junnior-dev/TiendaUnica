import { Head, useForm } from '@inertiajs/react';
import { ArrowRight, Banknote, Lock, ShieldCheck, Store } from 'lucide-react';
import AuthLayout from '../../Layouts/AuthLayout';
import { Button, PasswordField } from '../../Components/ui';

/* Puerta del super administrador del portal. No es un login de usuario: es una única contraseña de operador
   (PORTAL_ADMIN_PASSWORD en el .env del servidor) porque desde aquí se ven TODAS las tiendas y sus pagos. */

const Aside = () => (
    <>
        <h2 className="max-w-[24ch] text-[26px] font-semibold leading-[1.15] tracking-[-0.02em]">Todas tus tiendas, en un solo lugar.</h2>
        <p className="mt-2 max-w-[48ch] text-[14px] leading-relaxed text-white/65">Desde aquí manejas el negocio de la plataforma: quién está al día, quién debe y qué pagos esperan.</p>
        <ul className="mt-5 space-y-3 text-[14px] text-white/85">
            {[[Store, 'Estado de cada tienda: al día, en demo, pago pendiente o suspendida.'], [Banknote, 'Verifica los pagos móviles y transferencias que reportan los clientes.'], [ShieldCheck, 'Suspende o reactiva una tienda con un clic; no se borra nada.']].map(([I, t]) => (
                <li key={t} className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/10"><I aria-hidden className="size-4" /></span><span className="pt-1 leading-snug">{t}</span></li>
            ))}
        </ul>
    </>
);

export default function PortalLogin() {
    const { data, setData, post, processing, errors } = useForm({ password: '' });
    return (
        <AuthLayout aside={<Aside />}>
            <Head title="Portal · Administración" />
            <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Administración del portal</h1>
            <p className="mt-2 text-[15px] text-muted">Aquí ves todas las tiendas, sus pagos y los reportes que esperan verificación. Es solo para el operador de la plataforma.</p>
            <form onSubmit={(e) => { e.preventDefault(); post('/portal/login'); }} className="mt-8 space-y-5" noValidate>
                <PasswordField label="Contraseña del operador" icon={Lock} value={data.password} onChange={(e) => setData('password', e.target.value)}
                    error={errors.password} autoComplete="current-password" autoFocus />
                <Button type="submit" disabled={processing} className="w-full">{processing ? 'Entrando…' : 'Entrar al portal'} <ArrowRight className="size-4" /></Button>
            </form>
            <p className="mt-8 flex items-start gap-2 border-t border-line pt-6 text-[13px] leading-relaxed text-muted">
                <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>La contraseña vive solo en el servidor (<code className="text-text">PORTAL_ADMIN_PASSWORD</code>). Si no está configurada, el portal queda cerrado.</span>
            </p>
        </AuthLayout>
    );
}
