import { Head, Link, useForm } from '@inertiajs/react';
import { useState } from 'react';
import { Banknote, Euro, ClipboardCheck, Pencil, History, Sigma, BellRing, RefreshCw, Pin, ReceiptText, ArrowLeft, ArrowRight, Building2, Check, CircleCheck, Circle, Coins, FileText, Lock, MapPin, Percent, Phone, Mail, Receipt, Store, User, UserCog, TrendingUp } from 'lucide-react';
import AuthLayout from '../../Layouts/AuthLayout';
import { Button, Choice, Field, PasswordField, Segmented } from '../../Components/ui';
import { normalizarRif, validarRif } from '../../lib/rif';
import Aside from '../../Components/Info';

const PASOS = [
    { id: 'admin', titulo: 'Administrador', icon: UserCog },
    { id: 'negocio', titulo: 'Negocio', icon: Store },
    { id: 'fiscal', titulo: 'Régimen fiscal', icon: Receipt },
    { id: 'precios', titulo: 'Precios y costos', icon: TrendingUp },
    { id: 'tasa', titulo: 'Tasa y monedas', icon: Coins },
    { id: 'confirmar', titulo: 'Confirmación', icon: ClipboardCheck },
];

const bytes = (s) => new TextEncoder().encode(s).length;
const money = (n) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Validación por paso: misma regla que la base (sp_guardar_configuracion_negocio, sp_primer_admin). */
function validar(paso, d) {
    const e = {};
    if (paso === 0) {
        if (d.nombre_completo.trim().length < 2) e.nombre_completo = 'Escribe tu nombre completo.';
        if (d.password.length < 8) e.password = 'Usa al menos 8 caracteres.';
        else if (bytes(d.password) > 72) e.password = 'Máximo 72 bytes: acórtala un poco.';
        if (d.password_confirmation !== d.password) e.password_confirmation = 'Las contraseñas no coinciden.';
    }
    if (paso === 1) {
        if (d.razon_social.trim().length < 2) e.razon_social = 'La razón social es obligatoria.';
        const r = validarRif(d.rif); if (r) e.rif = r;
        if (d.direccion_fiscal.trim().length < 5) e.direccion_fiscal = 'Escribe la dirección fiscal completa.';
        if (d.correo && !/^\S+@\S+\.\S+$/.test(d.correo)) e.correo = 'Revisa el correo.';
    }
    if (paso === 3) {
        const m = Number(d.margen_defecto_pct);
        if (d.margen_defecto_pct === '' || isNaN(m) || m < 0 || m > 1000) e.margen_defecto_pct = 'Un valor entre 0 y 1000.';
    }
    if (paso === 4) {
        const t = Number(String(d.tasa).replace(',', '.'));
        if (!t || t <= 0) e.tasa = 'Escribe la tasa del día (mayor que cero).';
        if (!d.fecha_tasa) e.fecha_tasa = 'Indica la fecha valor.';
        for (const k of ['tasa_eur', 'tasa_cop']) { const v = String(d[k]).trim(); if (v && !(Number(v.replace(',', '.')) > 0)) e[k] = 'Escribe un número mayor que cero, o déjalo vacío.'; }
    }
    return e;
}

/* ───────── Indicador de pasos ───────── */
function Pasos({ actual, max, ir }) {
    return (
        <ol className="flex items-center gap-1.5" aria-label="Pasos de la configuración">
            {PASOS.map((p, i) => {
                const hecho = i < actual, activo = i === actual, alcanzable = i <= max;
                return (
                    <li key={p.id} className={`flex items-center gap-1.5 ${i < PASOS.length - 1 ? 'flex-1' : ''}`}>
                        <button type="button" disabled={!alcanzable} onClick={() => ir(i)} aria-current={activo ? 'step' : undefined}
                            className={`flex items-center gap-2 rounded-full py-1 pr-3 text-[13px] font-medium transition-colors ${activo ? 'pl-1 text-text' : 'pl-1 text-muted'} ${alcanzable ? 'hover:text-text' : 'cursor-default'}`}>
                            <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${hecho ? 'bg-brand text-white' : activo ? 'border-2 border-brand text-brand' : 'border border-line text-muted'}`}>
                                {hecho ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                            </span>
                            <span className={activo ? 'inline whitespace-nowrap' : 'sr-only'}>{p.titulo}</span>
                        </button>
                        {i < PASOS.length - 1 && <span aria-hidden className={`h-px flex-1 ${hecho ? 'bg-brand' : 'bg-line'}`} />}
                    </li>
                );
            })}
        </ol>
    );
}

const SINO = (v) => (v ? 'Sí' : 'No');
function Revision({ d, ir }) {
    const secciones = [
        { paso: 0, titulo: 'Administrador', icon: UserCog, filas: [['Nombre', d.nombre_completo], ['Usuario', 'admin'], ['Contraseña', '••••••••']] },
        { paso: 1, titulo: 'Negocio', icon: Store, filas: [['Razón social', d.razon_social], d.nombre_comercial && ['Nombre comercial', d.nombre_comercial], ['RIF', d.rif], ['Dirección fiscal', d.direccion_fiscal], d.telefono && ['Teléfono', d.telefono], d.correo && ['Correo', d.correo]] },
        { paso: 2, titulo: 'Régimen fiscal', icon: Receipt, filas: [['Contribuyente especial', SINO(d.es_contribuyente_especial)], ['IGTF en pagos con divisas', d.cobra_igtf ? `Sí, 3 % ${d.igtf_base === 'CON_IVA' ? 'con IVA' : 'sin IVA'}` : 'No'], ['Descuenta el IVA de sus compras', SINO(d.recupera_credito_fiscal)]] },
        { paso: 3, titulo: 'Precios y costos', icon: TrendingUp, filas: [['Ganancia sobre el costo', `${d.margen_defecto_pct} %`], ['Precios con IVA incluido', SINO(d.precios_incluyen_iva)], ['Costo de cada repuesto', d.metodo_costo === 'ULTIMO' ? 'Última compra' : 'Promedio de compras'], ['Si sube el costo', { AVISAR: 'Te avisa', AUTOMATICO: 'Actualiza el precio solo', NINGUNA: 'No cambia el precio' }[d.politica_costo_nuevo]]] },
        { paso: 4, titulo: 'Tasa y monedas', icon: Coins, filas: [['Dólar (USD)', `Bs ${d.tasa} · ${d.fecha_tasa.split('-').reverse().join('/')} · ${d.fuente_tasa === 'BCV' ? 'BCV' : 'manual'}`], ['Euro (EUR)', d.tasa_eur ? `Bs ${d.tasa_eur}` : 'Sin tasa: no podrás cobrar en euros'], ['Peso colombiano (COP)', d.tasa_cop ? `Bs ${d.tasa_cop}` : 'Sin tasa: no podrás cobrar en pesos']] },
    ];
    return (
        <div className="space-y-3">
            {secciones.map(({ paso, titulo, icon: Icon, filas }) => (
                <section key={paso} className="rounded-xl border border-line">
                    <header className="flex items-center justify-between border-b border-line px-4 py-2">
                        <h2 className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-muted" />{titulo}</h2>
                        <button type="button" onClick={() => ir(paso)} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-brand hover:bg-brand-50"><Pencil className="size-3.5" />Editar</button>
                    </header>
                    <dl className="grid grid-cols-[minmax(0,10.5rem)_1fr] gap-x-4 gap-y-1 px-4 py-2.5 text-[13.5px]">
                        {filas.filter(Boolean).map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words font-medium">{v}</dd></div>))}
                    </dl>
                </section>
            ))}
        </div>
    );
}

export default function Register() {
    const hoy = new Date().toLocaleDateString('en-CA');
    const form = useForm({
        nombre_completo: '', password: '', password_confirmation: '',
        razon_social: '', nombre_comercial: '', rif: '', direccion_fiscal: '', telefono: '', correo: '',
        es_contribuyente_especial: false, cobra_igtf: false, recupera_credito_fiscal: true, igtf_base: 'CON_IVA',
        precios_incluyen_iva: false, margen_defecto_pct: '30', metodo_costo: 'ULTIMO', politica_costo_nuevo: 'AVISAR',
        tasa: '', tasa_eur: '', tasa_cop: '', fecha_tasa: hoy, fuente_tasa: 'BCV',
    });
    const { data, setData } = form;
    const [paso, setPaso] = useState(0);
    const [max, setMax] = useState(0);
    const [err, setErr] = useState({});
    const set = (k) => (e) => { setData(k, e.target.value); if (err[k]) setErr({ ...err, [k]: undefined }); };
    const errores = { ...form.errors, ...err };

    const siguiente = () => {
        const e = validar(paso, data);
        setErr(e);
        if (Object.keys(e).length) return;
        const n = paso + 1; setPaso(n); setMax(Math.max(max, n));
    };
    const enviar = (ev) => {
        ev.preventDefault();
        if (paso < PASOS.length - 1) return siguiente();
        for (let i = 0; i < PASOS.length - 1; i++) {
            const e = validar(i, data);
            if (Object.keys(e).length) { setErr(e); setPaso(i); return; }
        }
        form.post('/registro');
    };
    const toggleEspecial = (v) => { setData((d) => ({ ...d, es_contribuyente_especial: v, cobra_igtf: v ? d.cobra_igtf : false })); };

    const Icon = PASOS[paso].icon;
    return (
        <AuthLayout wide aside={<Aside paso={paso} d={data} />}>
            <Head title="Crear cuenta" />
            <div className="mb-8"><Pasos actual={paso} max={max} ir={(i) => { setErr({}); setPaso(i); }} /></div>

            <h1 className="text-[28px] font-semibold tracking-[-0.02em]">
                {['Empecemos con tu cuenta', 'Cuéntanos de tu negocio', '¿Cómo declaras tus impuestos?', '¿Cómo quieres fijar tus precios?', 'Tasa del día y monedas', 'Revisa y confirma'][paso]}
            </h1>
            <p className="mt-2 text-[15px] text-muted">
                {['Serás el administrador: desde aquí configuras el negocio y luego creas a tus cajeros.', 'Estos datos salen impresos en tus facturas y en los libros de ventas y compras.', 'Si tienes dudas con alguna opción, consúltala con tu contador.', 'Con esto el sistema calcula el precio de venta de cada repuesto a partir de lo que te cuesta.', 'La tasa del dólar es obligatoria. Si también recibes euros o pesos colombianos, agrega su tasa.', 'Así quedará todo. Si algo no está bien, vuelve atrás y corrígelo antes de confirmar.'][paso]}
            </p>

            <form onSubmit={enviar} className="mt-7 space-y-5" noValidate>
                {paso === 0 && (<>
                    <Field label="Tu nombre completo" icon={User} value={data.nombre_completo} onChange={set('nombre_completo')} error={errores.nombre_completo} autoComplete="name" autoFocus placeholder="Ej: María Pérez" />
                    <Field label="Usuario" icon={UserCog} value="admin" readOnly hint="Tu usuario será admin; solo falta tu contraseña." className="[&_input]:text-muted" />
                    <div className="grid gap-5 sm:grid-cols-2">
                        <PasswordField label="Contraseña" icon={Lock} value={data.password} onChange={set('password')} error={errores.password} autoComplete="new-password" hint="Usa al menos 8 caracteres." />
                        <PasswordField label="Repite la contraseña" icon={Lock} value={data.password_confirmation} onChange={set('password_confirmation')} error={errores.password_confirmation} autoComplete="new-password" />
                    </div>
                </>)}

                {paso === 1 && (<>
                    <Field label="Razón social" icon={Building2} value={data.razon_social} onChange={set('razon_social')} error={errores.razon_social} autoFocus placeholder="Inversiones Moto Táchira, C.A." />
                    <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="RIF" icon={FileText} value={data.rif} onChange={(e) => { setData('rif', normalizarRif(e.target.value)); setErr({ ...err, rif: undefined }); }} error={errores.rif} placeholder="J-12345678-4" maxLength={12} className="[&_input]:num" />
                        <Field label="Nombre comercial (opcional)" icon={Store} value={data.nombre_comercial} onChange={set('nombre_comercial')} placeholder="Ej: Moto Repuestos Centro" />
                    </div>
                    <Field label="Dirección fiscal" icon={MapPin} value={data.direccion_fiscal} onChange={set('direccion_fiscal')} error={errores.direccion_fiscal} placeholder="Av. Principal, local 4, San Cristóbal, Táchira" />
                    <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Teléfono (opcional)" icon={Phone} value={data.telefono} onChange={set('telefono')} placeholder="0276-5551234" autoComplete="tel" />
                        <Field label="Correo (opcional)" icon={Mail} value={data.correo} onChange={set('correo')} error={errores.correo} placeholder="ventas@tunegocio.com" autoComplete="email" />
                    </div>
                </>)}

                {paso === 2 && (<>
                    <Choice checked={data.es_contribuyente_especial} onChange={toggleEspecial} title="Soy contribuyente especial">El SENIAT me designó como contribuyente especial. Lo necesitas para cobrar IGTF.</Choice>
                    <Choice checked={data.cobra_igtf} onChange={(v) => setData('cobra_igtf', v)} disabled={!data.es_contribuyente_especial} title="Cobrar IGTF (3 %) a quien paga en divisas">Si el cliente paga en dólares o euros, se suma el 3 % a ese pago.</Choice>
                    {data.cobra_igtf && (
                        <div>
                            <p className="mb-2 text-sm font-medium">¿Sobre qué monto se calcula el IGTF?</p>
                            <Segmented name="Base del IGTF" value={data.igtf_base} onChange={(v) => setData('igtf_base', v)} options={[
                                { value: 'CON_IVA', icon: ReceiptText, label: 'Con IVA', note: 'Sobre el pago completo, con el IVA incluido.' },
                                { value: 'SIN_IVA', icon: Receipt, label: 'Sin IVA', note: 'Sin contar el IVA. Confirma con tu contador.' },
                            ]} />
                        </div>
                    )}
                    <Choice checked={data.recupera_credito_fiscal} onChange={(v) => setData('recupera_credito_fiscal', v)} title="Descuento el IVA de mis compras">El IVA que pagas a tus proveedores se resta del IVA que cobras, en tus libros.</Choice>
                </>)}

                {paso === 3 && (<>
                    <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Ganancia sobre el costo (%)" icon={Percent} value={data.margen_defecto_pct} onChange={set('margen_defecto_pct')} error={errores.margen_defecto_pct} inputMode="decimal" hint="Con 30, ganas 30 % encima de lo que te cuesta." className="[&_input]:num" />
                        <div>
                            <p className="mb-2 text-sm font-medium">¿Tus precios ya incluyen IVA?</p>
                            <Segmented compact name="Precios con IVA" value={data.precios_incluyen_iva ? 'si' : 'no'} onChange={(v) => setData('precios_incluyen_iva', v === 'si')} options={[{ value: 'no', label: 'No' }, { value: 'si', label: 'Sí' }]} />
                        </div>
                    </div>
                    <div>
                        <p className="mb-2 text-sm font-medium">¿Cómo calculamos lo que te cuesta cada repuesto?</p>
                        <Segmented name="Método de costo" value={data.metodo_costo} onChange={(v) => setData('metodo_costo', v)} options={[
                            { value: 'ULTIMO', icon: History, label: 'Última compra', note: 'Usa lo último que pagaste.' },
                            { value: 'PROMEDIO', icon: Sigma, label: 'Promedio', note: 'Promedia todas tus compras.' },
                        ]} />
                    </div>
                    <div>
                        <p className="mb-2 text-sm font-medium">Si un proveedor te sube el costo</p>
                        <Segmented name="Política de costo nuevo" value={data.politica_costo_nuevo} onChange={(v) => setData('politica_costo_nuevo', v)} options={[
                            { value: 'AVISAR', icon: BellRing, label: 'Avisarme', note: 'Tú decides si cambias el precio.' },
                            { value: 'AUTOMATICO', icon: RefreshCw, label: 'Actualizar', note: 'El precio sube solo.' },
                            { value: 'NINGUNA', icon: Pin, label: 'Dejarlo igual', note: 'El precio no cambia.' },
                        ]} />
                    </div>
                </>)}

                {paso === 4 && (<>
                    <div className="grid gap-5 sm:grid-cols-[1fr_1fr]">
                        <Field label="Bolívares por cada dólar" icon={Coins} value={data.tasa} onChange={set('tasa')} error={errores.tasa} inputMode="decimal" placeholder="Ej: 891,10" autoFocus className="[&_input]:num" />
                        <Field label="Fecha de la tasa" forceFloat value={data.fecha_tasa} onChange={set('fecha_tasa')} error={errores.fecha_tasa} type="date" />
                    </div>
                    <Field select label="¿De dónde sale esta tasa?" value={data.fuente_tasa} onChange={set('fuente_tasa')}>
                        <option value="BCV">Banco Central de Venezuela (oficial)</option><option value="MANUAL">La escribí yo</option>
                    </Field>
                    <div className="rounded-xl border border-line p-4">
                        <p className="text-sm font-medium">¿Recibes también euros o pesos colombianos?</p>
                        <p className="mt-0.5 text-[13px] text-muted">Es opcional. Sin la tasa de una moneda, no podrás cobrar con ella.</p>
                        <div className="mt-4 grid gap-5 sm:grid-cols-2">
                            <Field label="Bolívares por cada euro" icon={Euro} value={data.tasa_eur} onChange={set('tasa_eur')} error={errores.tasa_eur} inputMode="decimal" placeholder="Ej: 997,92" className="[&_input]:num" />
                            <Field label="Bolívares por cada peso" icon={Banknote} value={data.tasa_cop} onChange={set('tasa_cop')} error={errores.tasa_cop} inputMode="decimal" placeholder="Ej: 0,28" hint="Es un número pequeño, por ejemplo 0,28." className="[&_input]:num" />
                        </div>
                    </div>
                </>)}

                {paso === 5 && <Revision d={data} ir={(i) => { setErr({}); setPaso(i); }} />}

                {form.errors.general && <p className="rounded-lg bg-red-50 p-3 text-sm text-danger">{form.errors.general}</p>}

                <div className="flex items-center justify-between gap-3 border-t border-line pt-6">
                    {paso > 0 ? <Button type="button" variant="ghost" onClick={() => { setErr({}); setPaso(paso - 1); }}><ArrowLeft className="size-4" />Atrás</Button>
                        : <Link href="/login" className="text-sm font-semibold text-brand hover:underline">Ya tengo cuenta</Link>}
                    <Button type="submit" disabled={form.processing}>
                        {paso < PASOS.length - 1 ? <>Continuar <ArrowRight className="size-4" /></> : <>Confirmar y crear cuenta <Check className="size-4" /></>}
                    </Button>
                </div>
            </form>
        </AuthLayout>
    );
}
