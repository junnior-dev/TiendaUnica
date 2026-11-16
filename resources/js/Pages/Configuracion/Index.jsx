import { Head } from '@inertiajs/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Building2, CalendarClock, Check, CircleAlert, CircleCheck, Coins, History, Info, Percent, ReceiptText, Scale, Tags, X } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Modal, Toast } from '../../Components/kit';
import { Button, Choice, Field, Segmented } from '../../Components/ui';
import { http } from '../../lib/http';
import { n2 } from '../../lib/format';
import { normalizarRif, validarRif } from '../../lib/rif';

/* ───────── utilidades ───────── */
const dmy = (iso) => (iso ? String(iso).split('-').reverse().join('/') : '');
const num = (s) => { const t = String(s ?? '').trim(); if (!t) return NaN; return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); };
const txt = (x) => (x == null ? '' : String(x).replace('.', ','));
const pad8 = (n) => String(Math.max(1, Number(n) || 1)).padStart(8, '0');
const SECCIONES = [
    ['negocio', 'Mi negocio', Building2], ['regimen', 'Régimen fiscal', Scale], ['impuestos', 'IVA e IGTF', Percent],
    ['facturacion', 'Facturación', ReceiptText], ['precios', 'Precios y costos', Tags], ['cobros', 'Tasas y cobros', Coins],
];

/* Borrador editable de una sección: los números se editan como texto y se comparan con lo guardado para saber si hay cambios. */
function useSeccion(clave, servidor, numericos, alGuardar) {
    const aBorrador = (s) => Object.fromEntries(Object.entries(s).map(([k, x]) => [k, numericos.includes(k) ? txt(x) : x ?? '']));
    const base = useMemo(() => aBorrador(servidor), [JSON.stringify(servidor)]);
    const [v, setV] = useState(base);
    const [env, setEnv] = useState(false);
    const [err, setErr] = useState({ campos: {}, general: '' });
    useEffect(() => { setV(base); setErr({ campos: {}, general: '' }); }, [base]);
    const sucio = JSON.stringify(v) !== JSON.stringify(base);
    const set = (k, x) => { setV((s) => ({ ...s, [k]: x })); setErr((e) => ({ campos: { ...e.campos, [k]: undefined }, general: '' })); };
    const guardar = async (validar) => {
        const malos = validar ? validar(v) : {};
        if (Object.keys(malos).length) { setErr({ campos: malos, general: '' }); return false; }
        setEnv(true);
        try {
            const cuerpo = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, numericos.includes(k) ? num(x) : x]));
            const r = await http('POST', `/configuracion/${clave}`, cuerpo);
            alGuardar(r); return true;
        } catch (e) {
            const campos = Object.fromEntries(Object.entries(e.errors || {}).map(([k, m]) => [k, m[0]]));
            setErr({ campos, general: Object.keys(campos).length ? '' : e.message });
            return false;
        } finally { setEnv(false); }
    };
    return { v, set, sucio, env, err, guardar, descartar: () => { setV(base); setErr({ campos: {}, general: '' }); } };
}

/* Tarjeta de sección con su propia barra de guardado. */
function Seccion({ id, icon: Icon, titulo, texto, s, onGuardar, children, pie }) {
    return (
        <div id={id} className="scroll-mt-24"><Card className="overflow-hidden">
            <header className="flex items-start gap-4 border-b border-line px-6 py-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand"><Icon className="size-5" /></span>
                <div><h2 className="text-[17px] font-semibold tracking-[-0.01em]">{titulo}</h2><p className="mt-0.5 max-w-[62ch] text-[14px] leading-snug text-muted">{texto}</p></div>
            </header>
            <div className="space-y-5 px-6 py-6">{children}</div>
            {s && (
                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-paper/60 px-6 py-3.5">
                    <p className={`flex items-center gap-2 text-[13.5px] ${s.err.general ? 'font-medium text-danger' : 'text-muted'}`} role={s.err.general ? 'alert' : undefined}>
                        {s.err.general ? <><CircleAlert className="size-4 shrink-0" />{s.err.general}</> : s.sucio ? <><span className="size-2 rounded-full bg-signal" />Tienes cambios sin guardar</> : pie || 'Todo guardado'}
                    </p>
                    <div className="flex gap-2">
                        {s.sucio && <Button type="button" variant="ghost" className="h-10" onClick={s.descartar} disabled={s.env}>Descartar</Button>}
                        <Button type="button" className="h-10" onClick={onGuardar} disabled={!s.sucio || s.env}>{s.env ? 'Guardando…' : 'Guardar cambios'}</Button>
                    </div>
                </footer>
            )}
        </Card></div>
    );
}

const Aviso = ({ tono = 'info', icon: Icon = Info, children }) => (
    <div className={`flex gap-3 rounded-xl border px-4 py-3 text-[14px] leading-snug ${tono === 'warn' ? 'border-[#f0d58a] bg-[#fff8e6] text-[#6f4b00]' : 'border-[#cfdcf8] bg-brand-50/60 text-[#233a74]'}`}>
        <Icon className="mt-0.5 size-[18px] shrink-0" /><div>{children}</div>
    </div>
);

/* ───────── Secciones ───────── */
function Negocio({ d, alGuardar }) {
    const s = useSeccion('negocio', d.datos, [], alGuardar);
    const { v, set, err } = s;
    const validar = (x) => {
        const e = {};
        if (x.razon_social.trim().length < 2) e.razon_social = 'Escribe la razón social.';
        const rif = validarRif(x.rif); if (rif) e.rif = rif;
        if (x.direccion_fiscal.trim().length < 5) e.direccion_fiscal = 'Escribe la dirección fiscal completa.';
        if (x.correo && !/^\S+@\S+\.\S+$/.test(x.correo)) e.correo = 'Ese correo no parece válido.';
        return e;
    };
    return (
        <Seccion id="negocio" icon={Building2} titulo="Mi negocio" texto="Estos datos salen impresos en tus facturas y notas de venta, así que revísalos con calma." s={s} onGuardar={() => s.guardar(validar)}>
            <div className="grid gap-4 md:grid-cols-2">
                <Field label="Razón social" value={v.razon_social} onChange={(e) => set('razon_social', e.target.value)} error={err.campos.razon_social} />
                <Field label="Nombre comercial (opcional)" value={v.nombre_comercial} onChange={(e) => set('nombre_comercial', e.target.value)} error={err.campos.nombre_comercial} />
                <Field label="RIF" value={v.rif} onChange={(e) => set('rif', e.target.value.toUpperCase())} onBlur={() => v.rif && set('rif', normalizarRif(v.rif))} error={err.campos.rif} hint="Ejemplo: J-12345678-4" />
                <Field label="Teléfono (opcional)" inputMode="tel" value={v.telefono} onChange={(e) => set('telefono', e.target.value)} error={err.campos.telefono} />
                <Field className="md:col-span-2" label="Dirección fiscal" value={v.direccion_fiscal} onChange={(e) => set('direccion_fiscal', e.target.value)} error={err.campos.direccion_fiscal} />
                <Field label="Correo (opcional)" type="email" value={v.correo} onChange={(e) => set('correo', e.target.value)} error={err.campos.correo} />
            </div>
        </Seccion>
    );
}

function Regimen({ d, alGuardar }) {
    const s = useSeccion('regimen', d.regimen, [], alGuardar);
    const { v, set } = s;
    const [confirmar, setConfirmar] = useState(false);
    const cambioRegimen = v.es_contribuyente_especial !== d.regimen.es_contribuyente_especial;
    const esp = v.es_contribuyente_especial;
    const intentar = () => (cambioRegimen && d.ventas_emitidas > 0 ? setConfirmar(true) : s.guardar());
    const efectos = esp
        ? ['En caja, el cliente (cédula o RIF) es obligatorio para cobrar.', 'Puedes cobrar el IGTF en los pagos hechos en divisas.', 'Actúas como agente de retención del IVA: las retenciones se llevan en Libros fiscales.', 'El Panel te muestra los vencimientos de tu calendario fiscal según el último dígito de tu RIF.']
        : ['En caja, el cliente es opcional: si no se identifica, queda como «Consumidor final».', 'No se cobra IGTF: esa opción se apaga y se bloquea.', 'No retienes IVA a tus proveedores.', 'El Panel no muestra el calendario de especiales (aún no están cargadas las fechas de ordinarios).'];
    return (
        <Seccion id="regimen" icon={Scale} titulo="Régimen fiscal" texto="Aquí le dices al sistema qué tipo de contribuyente eres. De esto dependen el IGTF, el cliente en caja y las retenciones." s={s} onGuardar={intentar}>
            <div>
                <p className="mb-2.5 text-[14.5px] font-medium">¿Tu negocio es contribuyente especial?</p>
                <Segmented name="Tipo de contribuyente" value={esp} onChange={(x) => { set('es_contribuyente_especial', x); if (!x) set('cobra_igtf', false); }} options={[
                    { value: false, label: 'No, soy ordinario', note: 'La mayoría de los negocios. Así empiezas si no te han notificado lo contrario.' },
                    { value: true, label: 'Sí, soy especial', note: 'El SENIAT te notificó que eres sujeto pasivo especial.' },
                ]} />
            </div>
            <div className="rounded-xl bg-paper px-4 py-3.5">
                <p className="text-[13.5px] font-semibold">Con esta opción, tu sistema funciona así:</p>
                <ul className="mt-2 space-y-1.5">{efectos.map((t) => <li key={t} className="flex gap-2.5 text-[14px] leading-snug"><Check className="mt-0.5 size-4 shrink-0 text-ok" />{t}</li>)}</ul>
            </div>
            <div className="space-y-2.5">
                <Choice checked={esp && v.cobra_igtf} disabled={!esp} onChange={(x) => set('cobra_igtf', x)} title="Cobrar el IGTF en pagos con divisas">
                    {esp ? 'Se suma automáticamente al total cuando el cliente paga en dólares, euros o pesos.' : 'Solo disponible para contribuyentes especiales.'}
                </Choice>
                {esp && v.cobra_igtf && (
                    <div className="rounded-xl border border-line p-4">
                        <p className="text-[14px] font-medium">¿Sobre qué monto se calcula el IGTF?</p>
                        <div className="mt-2.5 max-w-[420px]"><Segmented compact name="Base del IGTF" value={v.igtf_base} onChange={(x) => set('igtf_base', x)} options={[{ value: 'CON_IVA', label: 'Lo pagado (con IVA)' }, { value: 'SIN_IVA', label: 'Sin IVA' }]} /></div>
                        {v.igtf_base === 'SIN_IVA' && <div className="mt-3"><Aviso tono="warn" icon={AlertTriangle}>Lo habitual es calcularlo sobre lo que el cliente paga en divisas, IVA incluido. Usa «Sin IVA» solo si tu contador te lo confirma por escrito.</Aviso></div>}
                    </div>
                )}
                <Choice checked={v.reversa_igtf_en_anulacion} onChange={(x) => set('reversa_igtf_en_anulacion', x)} title="Dejar constancia al anular una venta con IGTF">
                    Al anular, el sistema registra la reversión del IGTF que se había cobrado.
                </Choice>
                <Choice checked={v.recupera_credito_fiscal} onChange={(x) => set('recupera_credito_fiscal', x)} title="Recuperas el IVA de tus compras (crédito fiscal)">
                    El IVA que pagas a tus proveedores se descuenta del que cobras a tus clientes.
                </Choice>
                <Choice checked={v.precios_incluyen_iva} onChange={(x) => set('precios_incluyen_iva', x)} title="Los precios de tus productos ya incluyen el IVA">
                    {v.precios_incluyen_iva ? 'El IVA se calcula hacia adentro: el precio que escribes es el que paga el cliente.' : 'El IVA se suma al precio al cobrar.'}
                </Choice>
            </div>
            {d.ventas_emitidas > 0 && <Aviso icon={Info}>Ya tienes {d.ventas_emitidas} ventas registradas. Los cambios de esta sección aplican desde la próxima venta; las anteriores no se modifican.</Aviso>}
            <Aviso icon={Info}>Si el SENIAT te revoca o te otorga el estatus de especial, cámbialo aquí el mismo día: cambian el IVA, la retención de IVA, el IGTF y los anticipos de ISLR. Confirma la fecha de efecto con tu contador.</Aviso>
            {d.regimen_historial?.length > 0 && (
                <div className="rounded-xl border border-line p-4">
                    <p className="text-[13.5px] font-semibold">Historial del régimen</p>
                    <ul className="mt-2 space-y-1.5">{d.regimen_historial.map((h, i) => <li key={i} className="flex flex-wrap justify-between gap-x-4 text-[13.5px]"><span>{h.nota}{h.usuario ? ` · ${h.usuario}` : ''}</span><span className="text-muted">{String(h.fecha).slice(0, 10).split('-').reverse().join('/')}</span></li>)}</ul>
                </div>
            )}
            {confirmar && (
                <Modal titulo="¿Cambiar el tipo de contribuyente?" subtitulo={`Pasarás a ser contribuyente ${esp ? 'especial' : 'ordinario'}.`} cerrar={() => setConfirmar(false)} ok="Sí, cambiar" enviando={s.env}
                    onSubmit={async () => { await s.guardar(); setConfirmar(false); }}>
                    <p className="text-[14.5px] leading-snug">{esp ? 'Desde la próxima venta, el cliente será obligatorio en caja y podrás cobrar IGTF.' : 'Desde la próxima venta, el cliente será opcional y se dejará de cobrar IGTF.'} Las ventas ya hechas no cambian.</p>
                    <p className="text-[13px] text-muted">Si tienes dudas sobre tu condición, confírmala con tu contador antes de cambiarla.</p>
                </Modal>
            )}
        </Seccion>
    );
}

function Alicuota({ a, titulo, nota, apagado, hoy, onCambiar, onCancelar }) {
    const [ver, setVer] = useState(false);
    return (
        <div className={`rounded-xl border border-line p-5 ${apagado ? 'bg-paper/70' : 'bg-white'}`}>
            <div className="flex items-start justify-between gap-3">
                <div><p className="text-[14.5px] font-semibold">{titulo}</p><p className="mt-0.5 text-[13px] text-muted">{nota}</p></div>
                {apagado && <span className="shrink-0 whitespace-nowrap rounded-full bg-[#e9ecf0] px-2.5 py-0.5 text-[12px] font-semibold text-muted">No se aplica</span>}
            </div>
            <p className="num mt-4 text-[34px] font-semibold leading-none tracking-[-0.02em]">{a.vigente ? n2(a.vigente.pct) : '—'}<span className="ml-1 text-[18px] text-muted">%</span></p>
            <p className="mt-1.5 text-[13px] text-muted">{a.vigente ? `Vigente desde el ${dmy(a.vigente.desde)}` : 'No hay una alícuota vigente hoy'}</p>
            {a.programada && (
                <div className="mt-4 flex items-start gap-3 rounded-lg bg-[#fff8e6] px-3.5 py-3 text-[13.5px] text-[#6f4b00]">
                    <CalendarClock className="mt-0.5 size-4 shrink-0" />
                    <p className="min-w-0 flex-1 leading-snug"><b>Cambio programado:</b> pasará a {n2(a.programada.pct)} % el {dmy(a.programada.desde)}.<span className="block text-[12.5px] opacity-80">{a.programada.nota}</span></p>
                    <button type="button" onClick={onCancelar} className="shrink-0 font-semibold underline underline-offset-2">Cancelar</button>
                </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
                {!a.programada && <Button type="button" variant="ghost" className="h-10" onClick={onCambiar}>Programar un cambio</Button>}
                <button type="button" onClick={() => setVer(!ver)} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-[14px] font-medium text-brand hover:bg-brand-50" aria-expanded={ver}><History className="size-4" />{ver ? 'Ocultar historial' : 'Ver historial'}</button>
            </div>
            {ver && (
                <ul className="mt-2 divide-y divide-line rounded-lg border border-line text-[13.5px]">
                    {a.historial.map((h, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                            <span><b className="num">{n2(h.pct)} %</b><span className="ml-2 text-muted">{dmy(h.desde)} → {h.hasta ? dmy(h.hasta) : 'sin fecha de fin'}{h.desde > hoy && <span className="ml-2 rounded-full bg-[#fff1cc] px-2 py-0.5 text-[11.5px] font-semibold text-[#6f4b00]">programado</span>}</span></span>
                            <span className="max-w-[40%] truncate text-right text-[12.5px] text-muted" title={h.nota}>{h.nota}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function Impuestos({ d, alGuardar, avisar }) {
    const [modal, setModal] = useState(null);
    const [f, setF] = useState({ porcentaje: '', desde: '', nota: '' });
    const [err, setErr] = useState({ campos: {}, general: '' });
    const [env, setEnv] = useState(false);
    const abrir = (codigo) => { setF({ porcentaje: '', desde: d.hoy, nota: '' }); setErr({ campos: {}, general: '' }); setModal(codigo); };
    const enviar = async () => {
        const p = num(f.porcentaje); const campos = {};
        if (!Number.isFinite(p) || p < 0 || p > 100) campos.porcentaje = 'Escribe un porcentaje entre 0 y 100.';
        if (!f.desde) campos.desde = 'Elige desde qué fecha rige.'; else if (f.desde < d.hoy) campos.desde = 'No puede empezar en una fecha pasada: las ventas ya hechas conservan su alícuota.';
        if (f.nota.trim().length < 3) campos.nota = 'Anota el decreto o la fuente del cambio.';
        if (Object.keys(campos).length) return setErr({ campos, general: '' });
        setEnv(true);
        try { alGuardar(await http('POST', '/configuracion/alicuota', { codigo: modal, porcentaje: p, desde: f.desde, nota: f.nota })); setModal(null); avisar('Cambio de alícuota programado.'); }
        catch (e) { setErr({ campos: Object.fromEntries(Object.entries(e.errors || {}).map(([k, m]) => [k, m[0]])), general: e.errors && Object.keys(e.errors).length ? '' : e.message }); }
        finally { setEnv(false); }
    };
    const cancelar = async (codigo) => { try { alGuardar(await http('DELETE', `/configuracion/alicuota/${codigo}`)); avisar('Cambio cancelado.'); } catch (e) { avisar(e.message); } };
    return (
        <Seccion id="impuestos" icon={Percent} titulo="IVA e IGTF" texto="Los porcentajes tienen fechas de vigencia: si cambia la ley, programas el cambio y el sistema lo aplica solo ese día, sin tocar las ventas anteriores.">
            <div className="grid gap-4 md:grid-cols-2">
                <Alicuota a={d.alicuotas.iva} titulo="IVA general" nota="Se aplica a los productos que no son exentos." hoy={d.hoy} onCambiar={() => abrir('IVA_GENERAL')} onCancelar={() => cancelar('IVA_GENERAL')} />
                <Alicuota a={d.alicuotas.igtf} titulo="IGTF en divisas" nota={d.regimen.cobra_igtf ? 'Se suma a los pagos hechos en divisas.' : 'Tu negocio no lo cobra (ver Régimen fiscal).'} apagado={!d.regimen.cobra_igtf} hoy={d.hoy} onCambiar={() => abrir('IGTF_DIVISAS')} onCancelar={() => cancelar('IGTF_DIVISAS')} />
            </div>
            <Aviso icon={Info}>Verifica las alícuotas vigentes con tu contador o en la Gaceta Oficial. Al programar un cambio anotarás el decreto, para que quede constancia.</Aviso>
            {modal && (
                <Modal titulo={modal === 'IVA_GENERAL' ? 'Programar cambio del IVA' : 'Programar cambio del IGTF'} subtitulo={`Hoy rige ${n2((modal === 'IVA_GENERAL' ? d.alicuotas.iva : d.alicuotas.igtf).vigente?.pct ?? 0)} %. El nuevo porcentaje empezará solo en la fecha que elijas.`} cerrar={() => setModal(null)} ok="Programar cambio" enviando={env} onSubmit={enviar}>
                    <Field label="Nuevo porcentaje (%)" inputMode="decimal" autoFocus value={f.porcentaje} onChange={(e) => setF({ ...f, porcentaje: e.target.value })} error={err.campos.porcentaje} />
                    <Field label="Rige desde" type="date" forceFloat min={d.hoy} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} error={err.campos.desde} />
                    <Field label="Decreto o fuente" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} error={err.campos.nota} hint="Por ejemplo: «Gaceta Oficial N.º 6.952»." />
                    {err.general && <p role="alert" className="flex items-start gap-1.5 text-[13px] text-danger"><CircleAlert className="mt-px size-3.5 shrink-0" />{err.general}</p>}
                </Modal>
            )}
        </Seccion>
    );
}

function Facturacion({ d, alGuardar }) {
    const n = d.numeracion;
    const s = useSeccion('numeracion', n.disponible ? { automatica: n.automatica, prefijo_factura: n.prefijo_factura, siguiente_factura: n.siguiente_factura, prefijo_control: n.prefijo_control, siguiente_control: n.siguiente_control } : { automatica: true, prefijo_factura: '', siguiente_factura: 1, prefijo_control: '', siguiente_control: 1 }, ['siguiente_factura', 'siguiente_control'], alGuardar);
    const { v, set, err } = s;
    const validar = (x) => {
        const e = {};
        if (x.automatica) {
            if (!x.prefijo_factura.trim()) e.prefijo_factura = 'Escribe un prefijo, por ejemplo FAC-.';
            if (!x.prefijo_control.trim()) e.prefijo_control = 'Escribe un prefijo, por ejemplo 00-.';
            if (!(num(x.siguiente_factura) >= 1)) e.siguiente_factura = 'Debe ser 1 o más.';
            if (!(num(x.siguiente_control) >= 1)) e.siguiente_control = 'Debe ser 1 o más.';
        }
        return e;
    };
    if (!n.disponible) {
        return (
            <Seccion id="facturacion" icon={ReceiptText} titulo="Numeración de facturas" texto="Cómo se asignan los números de factura y de control al cobrar.">
                <Aviso tono="warn" icon={AlertTriangle}>La numeración automática no está instalada todavía. Ejecuta <b>database/sql/09_numeracion_fiscal.sql</b> en tu base de datos y vuelve a esta pantalla. Mientras tanto, el número de factura se escribe a mano en cada venta.</Aviso>
            </Seccion>
        );
    }
    return (
        <Seccion id="facturacion" icon={ReceiptText} titulo="Numeración de facturas" texto="Decide si el sistema pone solo el número de factura y de control al cobrar, o si tú los escribes a mano." s={s} onGuardar={() => s.guardar(validar)}>
            <Segmented name="Cómo se numeran las facturas" value={v.automatica} onChange={(x) => set('automatica', x)} options={[
                { value: true, label: 'Automática', note: 'El sistema asigna el siguiente número en cada venta, sin saltos ni repetidos.' },
                { value: false, label: 'A mano', note: 'Tú escribes el número que te da tu máquina fiscal o tu sistema de facturación autorizado.' },
            ]} />
            {v.automatica ? (
                <>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-4 rounded-xl border border-line p-4">
                            <p className="text-[14px] font-semibold">Número de factura</p>
                            <Field label="Prefijo" value={v.prefijo_factura} maxLength={10} onChange={(e) => set('prefijo_factura', e.target.value)} error={err.campos.prefijo_factura} />
                            <Field label="Siguiente número" inputMode="numeric" value={v.siguiente_factura} onChange={(e) => set('siguiente_factura', e.target.value.replace(/\D/g, ''))} error={err.campos.siguiente_factura} hint="Si pones uno ya usado, el sistema lo salta solo." />
                        </div>
                        <div className="space-y-4 rounded-xl border border-line p-4">
                            <p className="text-[14px] font-semibold">Número de control</p>
                            <Field label="Prefijo" value={v.prefijo_control} maxLength={10} onChange={(e) => set('prefijo_control', e.target.value)} error={err.campos.prefijo_control} />
                            <Field label="Siguiente número" inputMode="numeric" value={v.siguiente_control} onChange={(e) => set('siguiente_control', e.target.value.replace(/\D/g, ''))} error={err.campos.siguiente_control} />
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-paper px-4 py-3.5 text-[14px]">
                        <span className="text-muted">Así saldrá la próxima factura:</span>
                        <b className="num">{v.prefijo_factura}{pad8(v.siguiente_factura)}</b><ArrowRight className="size-4 text-muted" /><span className="text-muted">control</span><b className="num">{v.prefijo_control}{pad8(v.siguiente_control)}</b>
                    </div>
                    <Aviso tono="warn" icon={AlertTriangle}>Es una numeración interna del sistema. Para que la factura sea válida ante el SENIAT debe emitirse con una imprenta digital o máquina fiscal autorizada. Confírmalo con tu contador; si usas un medio externo, elige «A mano».</Aviso>
                </>
            ) : <Aviso icon={Info}>En caja, después de cobrar, el sistema te pedirá el número de factura y de control. También puedes cargarlos después desde Ventas.</Aviso>}
        </Seccion>
    );
}

function Precios({ d, alGuardar }) {
    const s = useSeccion('precios', d.precios, ['margen_defecto_pct', 'redondeo_precio_usd'], alGuardar);
    const { v, set, err } = s;
    const REDONDEOS = ['0,01', '0,05', '0,10', '0,50', '1'];
    const validar = (x) => { const e = {}; const m = num(x.margen_defecto_pct); if (!(m >= 0 && m <= 1000)) e.margen_defecto_pct = 'Escribe un margen entre 0 y 1000 %.'; return e; };
    return (
        <Seccion id="precios" icon={Tags} titulo="Precios y costos" texto="Cómo se calcula el precio de venta cuando compras mercancía y cómo se redondea." s={s} onGuardar={() => s.guardar(validar)}>
            <div className="grid gap-4 md:grid-cols-2">
                <Field label="Margen de ganancia habitual (%)" inputMode="decimal" value={v.margen_defecto_pct} onChange={(e) => set('margen_defecto_pct', e.target.value)} error={err.campos.margen_defecto_pct} hint="Se sugiere en productos nuevos. Siempre puedes cambiarlo en cada uno." />
                <Field label="Redondear los precios en dólares a" select value={REDONDEOS.includes(v.redondeo_precio_usd) ? v.redondeo_precio_usd : v.redondeo_precio_usd} onChange={(e) => set('redondeo_precio_usd', e.target.value)} error={err.campos.redondeo_precio_usd} hint="Ejemplo: con 0,05, un precio de $3,47 queda en $3,45.">
                    {[...new Set([...REDONDEOS, v.redondeo_precio_usd])].map((r) => <option key={r} value={r}>$ {r}</option>)}
                </Field>
            </div>
            <div>
                <p className="mb-2.5 text-[14.5px] font-medium">¿Qué costo usas para calcular tu ganancia?</p>
                <Segmented name="Método de costo" value={v.metodo_costo} onChange={(x) => set('metodo_costo', x)} options={[
                    { value: 'ULTIMO', label: 'El último costo', note: 'El de la compra más reciente. Se ajusta rápido cuando suben los precios.' },
                    { value: 'PROMEDIO', label: 'Costo promedio', note: 'Promedio ponderado de lo que hay en existencia. Más estable.' },
                ]} />
            </div>
            <div>
                <p className="mb-2.5 text-[14.5px] font-medium">Cuando compras un producto a un costo distinto…</p>
                <Segmented name="Costo nuevo" value={v.politica_costo_nuevo} onChange={(x) => set('politica_costo_nuevo', x)} options={[
                    { value: 'AVISAR', label: 'Avisarme', note: 'Te muestra la diferencia y tú decides si cambias el precio.' },
                    { value: 'AUTOMATICO', label: 'Actualizar el precio', note: 'Recalcula el precio solo, con tu margen.' },
                    { value: 'NINGUNA', label: 'No tocar nada', note: 'Los precios solo cambian cuando tú los cambias.' },
                ]} />
            </div>
        </Seccion>
    );
}

function Cobros({ d, alGuardar }) {
    const s = useSeccion('cobros', d.cobros, ['tolerancia_pago_usd'], alGuardar);
    const { v, set, err } = s;
    const validar = (x) => {
        const e = {}; const a = Number(x.dias_max_tasa_antigua), f = Number(x.dias_max_tasa_futura), t = num(x.tolerancia_pago_usd);
        if (!Number.isInteger(a) || a < 0 || a > 60) e.dias_max_tasa_antigua = 'Entre 0 y 60 días.';
        if (!Number.isInteger(f) || f < 0 || f > 15) e.dias_max_tasa_futura = 'Entre 0 y 15 días.';
        if (!(t >= 0 && t <= 5)) e.tolerancia_pago_usd = 'Entre 0 y 5 dólares.';
        return e;
    };
    return (
        <Seccion id="cobros" icon={Coins} titulo="Tasas y cobros" texto="Reglas para usar la tasa de cambio y para cuadrar los pagos en caja." s={s} onGuardar={() => s.guardar(validar)}>
            <div>
                <p className="mb-2.5 text-[14.5px] font-medium">Si un día no hay tasa publicada (fines de semana, feriados)…</p>
                <Segmented name="Día sin tasa" value={v.regla_tasa_sin_publicacion} onChange={(x) => set('regla_tasa_sin_publicacion', x)} options={[
                    { value: 'ANTERIOR', label: 'Usar la última publicada', note: 'Mantienes la tasa del último día hábil.' },
                    { value: 'SIGUIENTE', label: 'Usar la próxima publicada', note: 'Tomas la tasa del siguiente día hábil, si ya existe.' },
                ]} />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
                <Field label="Avisar si la tasa tiene más de (días)" inputMode="numeric" value={v.dias_max_tasa_antigua} onChange={(e) => set('dias_max_tasa_antigua', e.target.value.replace(/\D/g, ''))} error={err.campos.dias_max_tasa_antigua} hint="Para que no vendas con una tasa vieja." />
                <Field label="Aceptar tasas que rigen dentro de (días)" inputMode="numeric" value={v.dias_max_tasa_futura} onChange={(e) => set('dias_max_tasa_futura', e.target.value.replace(/\D/g, ''))} error={err.campos.dias_max_tasa_futura} hint="Por si cargas la del lunes el viernes. Máximo 15." />
                <Field label="Diferencia aceptada al cobrar (US$)" inputMode="decimal" value={v.tolerancia_pago_usd} onChange={(e) => set('tolerancia_pago_usd', e.target.value)} error={err.campos.tolerancia_pago_usd} hint="Un pago que se queda corto por esto o menos, se da por cuadrado." />
            </div>
            <Choice checked={v.permitir_stock_negativo} onChange={(x) => set('permitir_stock_negativo', x)} title="Permitir vender aunque el inventario diga cero">
                {v.permitir_stock_negativo ? 'La caja deja vender sin existencia; el inventario quedará en negativo hasta que registres la compra.' : 'Recomendado: la caja no deja vender más de lo que hay en existencia.'}
            </Choice>
        </Seccion>
    );
}

/* ───────── Estado general ───────── */
function Estado({ lista }) {
    const faltan = lista.filter((c) => !c.completo);
    const AYUDA = { 'Tasa de cambio': ['Tasas de cambio', '/tasas'] };
    return (
        <Card className={`px-6 py-5 ${faltan.length ? 'border-[#f0d58a] bg-[#fffdf6]' : ''}`}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className={`grid size-9 place-items-center rounded-full ${faltan.length ? 'bg-[#fff1cc] text-[#8a5d00]' : 'bg-[#e3f3ea] text-ok'}`}>{faltan.length ? <AlertTriangle className="size-[18px]" /> : <CircleCheck className="size-5" />}</span>
                <div><h2 className="text-[16px] font-semibold">{faltan.length ? `Te falta${faltan.length > 1 ? 'n' : ''} ${faltan.length} ${faltan.length > 1 ? 'cosas' : 'cosa'} para vender sin problemas` : 'Tu negocio está listo para vender'}</h2>
                    <p className="text-[13.5px] text-muted">{faltan.length ? 'Completa lo que está en amarillo.' : 'Todo lo necesario está configurado. Puedes ajustar lo que quieras más abajo.'}</p></div>
            </div>
            <ul className="mt-4 flex flex-wrap gap-2">
                {lista.map((c) => (
                    <li key={c.paso} title={c.detalle} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium ${c.completo ? 'border-line bg-white text-text' : 'border-[#f0d58a] bg-[#fff1cc] text-[#6f4b00]'}`}>
                        {c.completo ? <Check className="size-3.5 text-ok" /> : <CircleAlert className="size-3.5" />}{c.paso}
                        {!c.completo && AYUDA[c.paso] && <a href={AYUDA[c.paso][1]} className="ml-1 underline underline-offset-2">Ir a {AYUDA[c.paso][0]}</a>}
                    </li>
                ))}
            </ul>
        </Card>
    );
}

export default function Configuracion(p) {
    const { usuario, fecha_larga, stock_bajo, tasa_usd } = p;
    const [d, setD] = useState(p);
    const [toast, setToast] = useState('');
    const [activa, setActiva] = useState('negocio');
    const avisar = (t) => { setToast(''); setTimeout(() => setToast(t), 30); };
    const alGuardar = (r) => { setD((x) => ({ ...x, ...r })); avisar('Cambios guardados.'); };
    const refs = useRef({});

    useEffect(() => {
        const o = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setActiva(v.target.dataset.id); }, { rootMargin: '-20% 0px -65% 0px' });
        SECCIONES.forEach(([id]) => { const el = document.getElementById(id); if (el) { el.dataset.id = id; o.observe(el); } });
        return () => o.disconnect();
    }, []);
    const ir = (id) => { setActiva(id); document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); };

    return (
        <AppLayout actual="/configuracion" titulo="Configuración" subtitulo="Los datos y reglas de tu negocio, en un solo lugar" {...{ usuario, negocio: d.negocio, stockBajo: stock_bajo, tasaUsd: tasa_usd }}>
            <Head title="Configuración" />
            <div className="mx-auto max-w-[1120px]">
                <Estado lista={d.checklist} />
                <div className="mt-6 grid items-start gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
                    <nav aria-label="Secciones de la configuración" className="sticky top-[88px] z-10 -mx-4 flex gap-1 overflow-x-auto bg-paper/95 px-4 py-2 backdrop-blur lg:mx-0 lg:flex-col lg:overflow-visible lg:bg-transparent lg:p-0">
                        {SECCIONES.map(([id, t, Icon]) => (
                            <button key={id} type="button" onClick={() => ir(id)} aria-current={activa === id ? 'true' : undefined}
                                className={`flex h-10 shrink-0 items-center gap-2.5 rounded-lg px-3 text-left text-[14px] font-medium transition-colors ${activa === id ? 'bg-white text-brand shadow-sm ring-1 ring-line' : 'text-muted hover:bg-white/70 hover:text-text'}`}>
                                <Icon className="size-[17px]" />{t}
                            </button>
                        ))}
                    </nav>
                    <div className="min-w-0 space-y-6 pb-10">
                        <Negocio d={d} alGuardar={alGuardar} />
                        <Regimen d={d} alGuardar={alGuardar} />
                        <Impuestos d={d} alGuardar={setD2(setD)} avisar={avisar} />
                        <Facturacion d={d} alGuardar={alGuardar} />
                        <Precios d={d} alGuardar={alGuardar} />
                        <Cobros d={d} alGuardar={alGuardar} />
                    </div>
                </div>
            </div>
            <Toast texto={toast} />
        </AppLayout>
    );
}
const setD2 = (setD) => (r) => setD((x) => ({ ...x, ...r }));
