import { Head, Link, useForm } from '@inertiajs/react';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, Globe, Lock, Rocket, User } from 'lucide-react';
import AuthLayout from '../../Layouts/AuthLayout';
import { Button, Field, PasswordField } from '../../Components/ui';
import { Aviso, Dias } from '../../Components/saas';
import { normalizarRif, validarRif } from '../../lib/rif';

/* Registro self-service del SaaS: tres pasos cortos y al terminar la tienda
   queda creada con 15 días de demo. La validación replica las reglas de la
   base (fn_provisionar_negocio) para que nada falle a mitad de camino. */

const bytes = (s) => new TextEncoder().encode(s).length;
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const PASOS = ['Tu negocio', 'Tu usuario', 'Confirmar'];

/* Progreso: tres tramos y el nombre del paso actual. Los pasos ya hechos se pueden reabrir. */
function Progreso({ actual, ir }) {
    return (
        <nav aria-label="Pasos del registro">
            <ol className="grid grid-cols-3 gap-2">
                {PASOS.map((t, i) => {
                    const hecho = i < actual, activo = i === actual;
                    return (
                        <li key={t}>
                            <button type="button" disabled={!hecho} onClick={() => ir(i)} aria-current={activo ? 'step' : undefined}
                                className="group block w-full text-left disabled:cursor-default">
                                <span className={`block h-1.5 rounded-full transition-colors ${hecho ? 'bg-brand group-hover:bg-brand-600' : activo ? 'bg-brand' : 'bg-line'}`} />
                                <span className={`mt-2 block text-[13px] ${activo ? 'font-semibold text-text' : hecho ? 'font-medium text-brand' : 'text-muted'}`}>
                                    <span className="num">{i + 1}.</span> {t}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}

const Aside = () => (
    <>
        <h2 className="max-w-[24ch] text-[28px] font-semibold leading-[1.12] tracking-[-0.02em]">Vende hoy y decide en 15 días si te quedas.</h2>
        <p className="mt-3 max-w-[46ch] text-[14.5px] leading-relaxed text-white/70">
            Tu tienda se crea al terminar el registro, con todos los módulos abiertos. Nadie te pide
            tarjeta; el cobro empieza cuando tú reportas el primer pago.
        </p>
        <div className="mt-6 max-w-[440px]">
            <p className="mb-2 text-[13px] font-medium text-white/80">Tu demo: 15 días, uno por cuadro</p>
            <Dias total={15} usados={0} oscuro />
        </div>
        <dl className="mt-7 max-w-[440px] divide-y divide-white/12 border-y border-white/12 text-[14px]">
            <div className="flex items-baseline justify-between gap-4 py-3">
                <dt><span className="font-semibold text-white">Sistema</span><span className="block text-[13px] text-white/60">Ventas, caja, inventario, compras y encargos</span></dt>
                <dd className="num shrink-0 font-semibold text-white">60 US$<span className="font-normal text-white/60"> /mes</span></dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-3">
                <dt><span className="font-semibold text-white">Contribuyente especial</span><span className="block text-[13px] text-white/60">Suma libros fiscales, retenciones, calendario y contabilidad</span></dt>
                <dd className="num shrink-0 font-semibold text-white">80 US$<span className="font-normal text-white/60"> /mes</span></dd>
            </div>
        </dl>
        <p className="mt-4 max-w-[46ch] text-[13px] leading-relaxed text-white/60">
            Pagas por pago móvil o transferencia, en bolívares o dólares. Los datos de tu tienda
            quedan separados de los de cualquier otra.
        </p>
    </>
);

function Resumen({ titulo, filas, editar }) {
    return (
        <section className="rounded-xl border border-line bg-white">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <h2 className="text-[14px] font-semibold">{titulo}</h2>
                <button type="button" onClick={editar} className="rounded text-[13px] font-semibold text-brand hover:underline">Cambiar</button>
            </div>
            <dl className="divide-y divide-line px-4 text-[14px]">
                {filas.map(([k, v]) => (
                    <div key={k} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-4">
                        <dt className="shrink-0 text-muted sm:w-40">{k}</dt>
                        <dd className="num min-w-0 break-words font-medium !whitespace-normal">{v}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}

export default function CrearCuenta({ base = '' }) {
    const [paso, setPaso] = useState(0);
    const [loc, setLoc] = useState({});
    const { data, setData, post, processing, errors } = useForm({
        razon_social: '', rif: '', nombre_comercial: '', telefono: '', correo: '',
        direccion_fiscal: '', admin_nombre: '', admin_username: '', password: '',
        password_confirmation: '', subdominio: '',
    });
    const err = (k) => loc[k] || errors[k];
    const dominio = data.subdominio ? `${data.subdominio}.${base || 'misitiolibre.com.ve'}` : null;

    const errorDe = (paso, d) => {
        const e = {};
        if (paso === 0) {
            if (d.razon_social.trim().length < 2) e.razon_social = 'Escribe la razón social tal como aparece en tu registro.';
            const r = validarRif(d.rif); if (r) e.rif = r;
            if (d.nombre_comercial.trim().length < 2) e.nombre_comercial = 'Con el nombre comercial creamos el enlace de tu tienda.';
            const s = slug(d.subdominio || d.nombre_comercial);
            if (!s || s.length < 3) e.subdominio = 'Elige un enlace de al menos 3 letras o números.';
        }
        if (paso === 1) {
            if (d.admin_nombre.trim().length < 2) e.admin_nombre = '¿A nombre de quién queda la cuenta?';
            if (!/^[a-z0-9_.]{3,30}$/.test(d.admin_username)) e.admin_username = 'De 3 a 30 letras minúsculas, números, punto o guion bajo.';
            if (d.password.length < 8) e.password = 'Usa al menos 8 caracteres.';
            else if (bytes(d.password) > 72) e.password = 'Máximo 72 bytes: acórtala un poco.';
            if (d.password_confirmation !== d.password) e.password_confirmation = 'Las contraseñas no coinciden.';
        }
        return e;
    };

    const siguiente = () => {
        const e = errorDe(paso, data);
        setLoc(e);
        if (!Object.keys(e).length) setPaso(paso + 1);
    };

    const submit = (e) => {
        e.preventDefault();
        const e1 = errorDe(0, data), e2 = errorDe(1, data);
        if (Object.keys(e1).length || Object.keys(e2).length) { setLoc({ ...e1, ...e2 }); setPaso(Object.keys(e1).length ? 0 : 1); return; }
        post('/crear-cuenta');
    };

    const setNombreComercial = (v) => {
        setData('nombre_comercial', v);
        if (!data.subdominio) setData('subdominio', slug(v));
    };

    const Titulo = ({ t, p }) => (
        <div>
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">{t}</h1>
            <p className="mt-2 max-w-[52ch] text-[15px] text-muted">{p}</p>
        </div>
    );

    return (
        <AuthLayout aside={<Aside />} wide>
            <Head title="Crear tu cuenta" />
            <Progreso actual={paso} ir={(i) => { setLoc({}); setPaso(i); }} />
            {errors.general && <Aviso tipo="error" className="mt-6">{errors.general}</Aviso>}

            {paso === 0 && (
                <form className="mt-8 space-y-5" onSubmit={(e) => { e.preventDefault(); siguiente(); }} noValidate>
                    <Titulo t="Cuéntanos de tu negocio" p="Son los datos que saldrán en tus facturas. Puedes cambiarlos después en Configuración." />
                    <Field label="Razón social" icon={Building2} value={data.razon_social} onChange={(e) => setData('razon_social', e.target.value)} error={err('razon_social')} placeholder="Ej: La Cava de Repuestos C.A." autoFocus />
                    <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="RIF" value={data.rif} onChange={(e) => setData('rif', normalizarRif(e.target.value))} error={err('rif')} hint="Se verifica con su dígito de control." placeholder="J-40123456-9" />
                        <Field label="Nombre comercial" value={data.nombre_comercial} onChange={(e) => setNombreComercial(e.target.value)} error={err('nombre_comercial')} placeholder="Ej: La Cava" />
                    </div>
                    <Field label="Enlace de tu tienda" icon={Globe} value={data.subdominio} onChange={(e) => setData('subdominio', slug(e.target.value))} error={err('subdominio')}
                        hint={dominio ? <>Tu tienda quedará en <span className="font-semibold text-text">{dominio}</span></> : 'Se completa con el nombre comercial; puedes editarlo.'} placeholder="la-cava" />
                    <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Teléfono (opcional)" value={data.telefono} onChange={(e) => setData('telefono', e.target.value)} error={err('telefono')} placeholder="0251-5550000" inputMode="tel" />
                        <Field label="Correo (opcional)" type="email" value={data.correo} onChange={(e) => setData('correo', e.target.value)} error={err('correo')} placeholder="Para los recibos de tu plan" />
                    </div>
                    <Button type="submit" className="w-full">Continuar <ArrowRight className="size-4" /></Button>
                </form>
            )}

            {paso === 1 && (
                <form className="mt-8 space-y-5" onSubmit={(e) => { e.preventDefault(); siguiente(); }} noValidate>
                    <Titulo t="Tu usuario administrador" p="Con este usuario entras a tu tienda y das de alta a tus cajeros. Guárdalo bien: es la llave del negocio." />
                    <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Tu nombre" icon={User} value={data.admin_nombre} onChange={(e) => setData('admin_nombre', e.target.value)} error={err('admin_nombre')} placeholder="Ej: María Pérez" autoFocus autoComplete="name" />
                        <Field label="Usuario" value={data.admin_username} onChange={(e) => setData('admin_username', e.target.value.toLowerCase())} error={err('admin_username')} hint="Único en toda la plataforma." placeholder="maria" autoComplete="username" />
                    </div>
                    <PasswordField label="Contraseña" icon={Lock} value={data.password} onChange={(e) => setData('password', e.target.value)} error={err('password')} hint="Mínimo 8 caracteres." autoComplete="new-password" />
                    <PasswordField label="Repite la contraseña" icon={Lock} value={data.password_confirmation} onChange={(e) => setData('password_confirmation', e.target.value)} error={err('password_confirmation')} autoComplete="new-password" />
                    <div className="flex gap-3">
                        <Button type="button" variant="ghost" onClick={() => setPaso(0)}><ArrowLeft className="size-4" /> Atrás</Button>
                        <Button type="submit" className="flex-1">Revisar datos <ArrowRight className="size-4" /></Button>
                    </div>
                </form>
            )}

            {paso === 2 && (
                <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
                    <Titulo t="Revisa y abre tu tienda" p="Si algo no está bien, cámbialo aquí mismo. Al confirmar creamos tu negocio y entras directo." />
                    <Resumen titulo="Negocio" editar={() => setPaso(0)} filas={[['Razón social', data.razon_social], ['RIF', data.rif], ['Nombre comercial', data.nombre_comercial], ['Tu tienda', dominio]]} />
                    <Resumen titulo="Administrador" editar={() => setPaso(1)} filas={[['Nombre', data.admin_nombre], ['Usuario', data.admin_username], ['Contraseña', '•'.repeat(Math.min(Math.max(data.password.length, 8), 16))]]} />
                    <Aviso tipo="info">Tu demo dura <b>15 días</b> con todos los módulos abiertos. No se cobra nada hasta que tú reportes un pago.</Aviso>
                    <div className="flex gap-3">
                        <Button type="button" variant="ghost" onClick={() => setPaso(1)}><ArrowLeft className="size-4" /> Atrás</Button>
                        <Button type="submit" disabled={processing} className="flex-1">{processing ? 'Creando tu tienda…' : 'Crear mi tienda gratis'} <Rocket className="size-4" /></Button>
                    </div>
                </form>
            )}

            <p className="mt-8 border-t border-line pt-6 text-sm text-muted">
                ¿Ya tienes cuenta? <Link href="/login" className="font-semibold text-brand hover:underline">Inicia sesión</Link>
                <span className="mx-2 text-line" aria-hidden>|</span>
                <Link href="/precios" className="font-semibold text-brand hover:underline">Ver planes y precios</Link>
            </p>
        </AuthLayout>
    );
}
