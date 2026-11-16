import { Head, router } from '@inertiajs/react';
import { useFiscal } from '../../lib/plan';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BadgeCheck, BellRing, FileDown, FileSpreadsheet, Hash, Landmark, Mail, MapPin, MessageCircle, PackageOpen, Pencil, Phone, Plus, Power, Search, ShieldCheck, ShoppingBag, Trash2, TriangleAlert, UserPlus, UserRound, Users, Wallet } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi, Modal, Toast, Vacio } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { Cifra, Dato, Ritmo, dmy, dolares, hace, iniciales, whatsapp } from '../../Components/expediente';
import { n0, n2 } from '../../lib/format';
import { http } from '../../lib/http';
import { normalizarRif, validarRif } from '../../lib/rif';
import EstadoCuentaCliente from '../CuentasPorCobrar/Estado';

const TIPOS = [['V', 'Cédula venezolana (V)'], ['E', 'Cédula extranjera (E)'], ['J', 'RIF de empresa (J)'], ['G', 'RIF de gobierno (G)'], ['C', 'RIF de comuna (C)'], ['P', 'Pasaporte (P)']];
const esRif = (t) => ['J', 'G', 'C'].includes(t);
const persona = (t) => ['V', 'E', 'P'].includes(t);

/* Mismo criterio que el servidor: lo que escribe la persona → documento que se guarda. */
const limpiar = (t, v) => { let d = v.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (['V', 'E', 'J', 'G', 'C'].includes(t) && d.startsWith(t) && d.length > 1 && /^\d+$/.test(d.slice(1))) d = d.slice(1); return d; };
const rotulo = (t, d) => (esRif(t) && /^\d{9}$/.test(d) ? `${t}-${d.slice(0, 8)}-${d.slice(8)}` : `${t}-${d}`);
function errorDocumento(t, v) {
    const d = limpiar(t, v);
    if (!d) return 'Escribe la cédula, el RIF o el pasaporte.';
    if (t === 'V' || t === 'E') return /^\d{5,9}$/.test(d) ? null : 'La cédula tiene entre 5 y 9 números.';
    if (esRif(t)) return /^\d{9}$/.test(d) ? (t === 'C' ? null : validarRif(rotulo(t, d))) : 'El RIF lleva 9 números después de la letra. Ejemplo: J-12345678-4.';
    return /^[A-Z0-9]{5,20}$/.test(d) ? null : 'El pasaporte tiene entre 5 y 20 letras o números.';
}

function Expediente({ c, hoy, dias, admin, onEditar, onEstado, onEliminar, onVolver }) {
    const [cuenta, setCuenta] = useState(false);
    const fiscal = useFiscal();
    const wa = whatsapp(c.telefono);
    const tope = Math.max(...c.productos.map((x) => x.usd), 1);
    const primerNombre = c.nombre.split(/\s+/)[0];
    const msj = encodeURIComponent(`Hola ${primerNombre}, te escribimos de ${'nuestra tienda'}. Hace tiempo que no te vemos por aquí; si necesitas repuestos para tu moto, con gusto te atendemos.`);
    const ventas = `/ventas?periodo=rango&desde=${c.primera || hoy}&hasta=${hoy}&q=${c.documento}`;
    return (
        <div>
            <div className="rounded-t-2xl bg-ink px-5 pb-5 pt-4 text-white sm:px-7 sm:pb-6">
                <button onClick={onVolver} className="-ml-1.5 mb-3 inline-flex h-9 items-center gap-1.5 rounded-lg px-1.5 text-[14px] text-white/70 hover:bg-white/10 hover:text-white xl:hidden"><ArrowLeft className="size-4" />Volver al directorio</button>
                <div className="flex flex-wrap items-start gap-4">
                    <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-full bg-white/10 text-[22px] font-semibold tracking-wide ring-1 ring-white/20">{iniciales(c.nombre, persona(c.tipo))}</span>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] sm:text-[26px]">{c.nombre}</h3>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                            <span className="num inline-flex items-center rounded-md bg-white/10 px-2 py-1 font-medium">{c.doc}</span>
                            <span className="text-white/70">{persona(c.tipo) ? 'Persona natural' : 'Empresa u organización'}</span>
                            <span className={`rounded-full px-2.5 py-0.5 font-medium ${c.activo ? 'bg-[#14804a]/30 text-[#9cecc0]' : 'bg-white/10 text-white/70'}`}>{c.activo ? 'Activo' : 'Desactivado'}</span>
                            {c.compras >= 5 && c.activo && !c.dormido && <span className="inline-flex items-center gap-1 rounded-full bg-signal/25 px-2.5 py-0.5 font-medium text-[#ffd166]"><BadgeCheck className="size-3.5" />Cliente frecuente</span>}
                        </div>
                        <p className="mt-2 text-[13px] text-white/60">En tu lista desde el {dmy(c.desde)}</p>
                    </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                    <button onClick={onEditar} className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-[14px] font-semibold text-ink hover:bg-[#e9ecf0]"><Pencil className="size-4" />Editar datos</button>
                    {admin && <button onClick={() => setCuenta(true)} className="inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-[14px] font-medium ring-1 ring-white/25 hover:bg-white/10"><Wallet className="size-4" />Estado de cuenta</button>}
                    {c.telefono && <a href={`tel:${c.telefono.replace(/[^\d+]/g, '')}`} className="inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-[14px] font-medium ring-1 ring-white/25 hover:bg-white/10"><Phone className="size-4" />Llamar</a>}
                    {wa && <a href={wa} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-[14px] font-medium ring-1 ring-white/25 hover:bg-white/10"><MessageCircle className="size-4" />WhatsApp</a>}
                    {c.correo && <a href={`mailto:${c.correo}`} className="inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-[14px] font-medium ring-1 ring-white/25 hover:bg-white/10"><Mail className="size-4" />Escribir</a>}
                </div>
            </div>

            <div className="space-y-7 p-5 sm:p-7">
                {c.dormido && (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-signal/15 p-4 text-[14px] leading-snug">
                        <BellRing className="size-5 shrink-0 text-[#8a5a00]" />
                        <p className="min-w-0 flex-1"><span className="font-semibold">Hace {c.dias_sin_comprar} días que no compra.</span> {c.cada_dias ? `Lo normal en él es cada ~${c.cada_dias} días.` : 'Puede ser buen momento para escribirle.'}</p>
                        {wa && <a href={`${wa}?text=${msj}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 font-semibold text-white hover:bg-[#2a3139]"><MessageCircle className="size-4" />Escribirle ahora</a>}
                    </div>)}

                {c.compras === 0 ? (
                    <div className="flex items-start gap-3 rounded-xl bg-brand-50 p-4 text-[14px] leading-snug">
                        <ShoppingBag className="mt-0.5 size-5 shrink-0 text-brand" /><p>Todavía no te ha comprado. Cuando lo elijas en el <a href="/caja" className="font-semibold text-brand hover:underline">punto de venta</a>, aquí verás su historial, lo que más compra y cómo suele pagar.</p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <Cifra titulo="Compras" valor={n0(c.compras)} detalle={c.anuladas ? `${c.anuladas} anulada${c.anuladas === 1 ? '' : 's'} (no suman)` : 'Ventas completadas'} />
                            <Cifra titulo="Total comprado (US$)" valor={n2(c.usd)} detalle="Sin contar anuladas" />
                            <Cifra titulo="Ticket promedio (US$)" valor={n2(c.promedio_usd)} detalle="Por venta" />
                            <Cifra titulo="Última compra" valor={hace(c.ultima, hoy)} detalle={c.cada_dias ? `Compra cada ~${c.cada_dias} ${c.cada_dias === 1 ? 'día' : 'días'}` : dmy(c.ultima)} />
                        </div>
                        <section>
                            <div className="mb-2 flex items-baseline justify-between gap-3"><h4 className="text-[15px] font-semibold">Ritmo de compra</h4><p className="text-[13px] text-muted">Últimos 12 meses, en dólares</p></div>
                            <Ritmo meses={c.meses} />
                        </section>
                        <div className="grid gap-7 lg:grid-cols-2">
                            <section>
                                <div className="mb-2 flex items-baseline justify-between gap-3"><h4 className="text-[15px] font-semibold">Compras recientes</h4><a href={ventas} className="text-[13px] font-medium text-brand hover:underline">Ver en Ventas</a></div>
                                <ul className="divide-y divide-line rounded-xl border border-line">
                                    {c.recientes.map((v) => (
                                        <li key={v.id} className="flex items-center gap-3 px-3.5 py-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="num truncate text-[14px] font-medium">Venta N.º {v.numero}</p>
                                                <p className="truncate text-[13px] text-muted">{dmy(v.fecha)}{v.factura ? ` · ${v.factura}` : ' · Sin factura'}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className={`num text-[14px] font-semibold ${v.estado === 'ANULADA' ? 'text-muted line-through' : ''}`}>{dolares(v.total_usd)}</p>
                                                {v.estado === 'ANULADA' && <p className="text-[12px] font-medium text-danger">Anulada</p>}
                                            </div>
                                        </li>))}
                                </ul>
                            </section>
                            <section>
                                <div className="mb-2 flex items-baseline justify-between gap-3"><h4 className="text-[15px] font-semibold">Lo que más compra</h4><p className="text-[13px] text-muted">Por monto</p></div>
                                {c.productos.length === 0 ? <p className="rounded-xl border border-line p-4 text-[14px] text-muted">Aún no hay productos en sus ventas.</p> : (
                                    <ul className="space-y-3 rounded-xl border border-line p-3.5">
                                        {c.productos.map((x) => (
                                            <li key={x.id}>
                                                <div className="flex items-baseline justify-between gap-3"><p className="min-w-0 truncate text-[14px] font-medium" title={x.nombre}>{x.nombre}</p><p className="num shrink-0 text-[13px] font-semibold">{dolares(x.usd)}</p></div>
                                                <div className="mt-1.5 flex items-center gap-2.5"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper"><span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(4, (x.usd / tope) * 100)}%` }} /></span><span className="num shrink-0 text-right text-[12px] text-muted">{n0(x.unidades)} und</span></div>
                                            </li>))}
                                    </ul>)}
                            </section>
                        </div>
                        {c.paga_con.length > 0 && (
                            <section>
                                <h4 className="mb-2 flex items-center gap-2 text-[15px] font-semibold"><Wallet className="size-4 text-muted" />Cómo suele pagar</h4>
                                <div className="flex flex-wrap gap-2">{c.paga_con.map((m) => <span key={m.nombre} className="rounded-full bg-paper px-3 py-1.5 text-[14px]"><span className="font-medium">{m.nombre}</span> <span className="num text-muted">{m.pct} %</span></span>)}</div>
                            </section>)}
                    </>
                )}

                <section>
                    <h4 className="mb-3 text-[15px] font-semibold">Datos de contacto</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Dato icon={Phone} label="Teléfono" vacio="Sin teléfono">{c.telefono}</Dato>
                        <Dato icon={Mail} label="Correo" vacio="Sin correo">{c.correo}</Dato>
                        <Dato icon={MapPin} label="Dirección" vacio="Sin dirección">{c.direccion}</Dato>
                    </div>
                </section>

                <section className="rounded-xl bg-paper p-4">
                    <h4 className="flex items-center gap-2 text-[15px] font-semibold"><ShieldCheck className="size-4 text-muted" />Lo fiscal de este cliente</h4>
                    <p className="mt-2 text-[14px] leading-snug">Sus facturas salen con {esRif(c.tipo) ? 'el RIF' : c.tipo === 'P' ? 'el pasaporte' : 'la cédula'} <span className="num font-semibold">{c.doc}</span>{c.tipo === 'P' ? '' : ' y su razón social tal como aparece aquí'}. Revisa que coincidan con su documento antes de facturar.</p>
                    {fiscal && c.retenciones && c.retenciones.n > 0 && <p className="mt-2 text-[14px] leading-snug">Te ha practicado <span className="font-semibold">{c.retenciones.n} {c.retenciones.n === 1 ? 'retención' : 'retenciones'} de IVA</span> por <span className="num font-semibold">Bs {n2(c.retenciones.ves)}</span>.</p>}
                    <p className="mt-2 text-[12.5px] text-muted">Informativo; confirma con tu contador cómo tratar cada caso.</p>
                </section>

                <section className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
                    <p className="max-w-[52ch] text-[13px] leading-snug text-muted">{c.activo ? 'Si ya no lo vas a atender, desactívalo: deja de aparecer en el punto de venta, pero conservas su historial.' : 'Está desactivado: no aparece en el punto de venta. Actívalo para volver a usarlo.'}</p>
                    <div className="flex gap-2">
                        <button onClick={onEstado} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper"><Power className="size-4" />{c.activo ? 'Desactivar' : 'Activar'}</button>
                        {c.puede_eliminar && <button onClick={onEliminar} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold text-danger hover:bg-[#fdecec]"><Trash2 className="size-4" />Eliminar</button>}
                    </div>
                </section>
            </div>
            {cuenta && <EstadoCuentaCliente clienteId={c.id} cerrar={() => setCuenta(false)} />}
        </div>
    );
}

export default function Clientes({ negocio, usuario, fecha_larga, stock_bajo, tasa_usd, filtros, hoy, dormido_dias, emisor, resumen, filas }) {
    const [q, setQ] = useState(filtros.q || '');
    const [selId, setSelId] = useState(null);
    const [det, setDet] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [fallo, setFallo] = useState('');
    const [movil, setMovil] = useState(false);
    const [form, setForm] = useState(null);
    const [errores, setErrores] = useState({});
    const [msg, setMsg] = useState('');
    const [borrar, setBorrar] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [exportando, setExportando] = useState('');
    const primera = useRef(true);

    const ir = useCallback((extra) => router.get('/clientes', { q: filtros.q, estado: filtros.estado, orden: filtros.orden, ver: filtros.ver, ...extra }, { preserveState: true, preserveScroll: true, replace: true, only: ['filtros', 'resumen', 'filas', 'hoy'] }), [filtros]);

    useEffect(() => {
        if (primera.current) { primera.current = false; return; }
        const t = setTimeout(() => { if (q.trim() !== (filtros.q || '')) ir({ q: q.trim() || undefined }); }, 300);
        return () => clearTimeout(t);
    }, [q]);

    const abrir = useCallback(async (id) => {
        setSelId(id); setMovil(true); setCargando(true); setFallo('');
        try { setDet(await http('GET', `/clientes/${id}`)); } catch (e) { setDet(null); setFallo(e.message); } finally { setCargando(false); }
    }, []);

    useEffect(() => {
        if (selId && filas.some((f) => f.id === selId)) return;
        if (filas.length && window.matchMedia('(min-width: 1280px)').matches) abrir(filas[0].id);
        else if (!filas.length) { setSelId(null); setDet(null); setMovil(false); }
    }, [filas]);

    const aviso = (t) => { setMsg(''); setTimeout(() => setMsg(t), 0); };
    const refrescar = () => router.reload({ only: ['resumen', 'filas'], preserveScroll: true });

    const nuevo = () => { setErrores({}); setForm({ id: null, tipo: 'V', documento: '', nombre: '', telefono: '', correo: '', direccion: '', fijo: false }); };
    const editar = () => { setErrores({}); setForm({ id: det.id, tipo: det.tipo, documento: det.doc.slice(det.tipo.length + 1), nombre: det.nombre, telefono: det.telefono || '', correo: det.correo || '', direccion: det.direccion || '', fijo: det.compras + det.anuladas > 0 }); };
    const cerrar = () => { setForm(null); setBorrar(false); setErrores({}); };

    const docMsg = form && !form.fijo && limpiar(form.tipo, form.documento).length >= (esRif(form.tipo) ? 9 : 5) ? errorDocumento(form.tipo, form.documento) : null;

    const guardar = async () => {
        const er = {};
        if (!form.fijo) { const r = errorDocumento(form.tipo, form.documento); if (r) er.documento = r; }
        if (form.nombre.trim().length < 2) er.nombre = 'Escribe el nombre o la razón social.';
        if (form.correo.trim() && !/^\S+@\S+\.\S+$/.test(form.correo.trim())) er.correo = 'Ese correo no parece válido.';
        setErrores(er); if (Object.keys(er).length) return;
        setEnviando(true);
        try {
            const cuerpo = { tipo: form.tipo, documento: form.documento, nombre: form.nombre, telefono: form.telefono, correo: form.correo, direccion: form.direccion };
            const r = form.id ? await http('PUT', `/clientes/${form.id}`, cuerpo) : await http('POST', '/clientes', cuerpo);
            const nuevoCli = !form.id; cerrar(); aviso(nuevoCli ? 'Cliente creado' : 'Cambios guardados');
            setSelId(r.id); setDet(r.detalle); setMovil(true); refrescar();
        } catch (e) { setErrores({ ...(e.errors ? Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k, v[0]])) : {}), general: e.errors && Object.keys(e.errors).length ? undefined : e.message }); }
        finally { setEnviando(false); }
    };

    const cambiarEstado = async () => {
        try { const r = await http('PATCH', `/clientes/${det.id}/estado`, { activo: !det.activo }); setDet(r.detalle); aviso(r.detalle.activo ? 'Cliente activado' : 'Cliente desactivado'); refrescar(); }
        catch (e) { aviso(e.message); }
    };
    const eliminar = async () => {
        setEnviando(true);
        try { await http('DELETE', `/clientes/${det.id}`); cerrar(); setDet(null); setSelId(null); setMovil(false); aviso('Cliente eliminado'); refrescar(); }
        catch (e) { cerrar(); aviso(e.message); } finally { setEnviando(false); }
    };

    const datosExport = useMemo(() => ({
        columnas: [{ h: 'Documento', w: 36 }, { h: 'Nombre o razón social' }, { h: 'Teléfono', w: 34 }, { h: 'Correo', w: 52 }, { h: 'Compras', a: 'right', w: 20 }, { h: 'Total comprado US$', a: 'right', w: 36 }, { h: 'Última compra', w: 28 }, { h: 'Estado', w: 22 }],
        filas: filas.map((f) => [f.doc, f.nombre, f.telefono || '', f.correo || '', n0(f.compras), n2(f.usd), dmy(f.ultima), f.activo ? 'Activo' : 'Desactivado']),
    }), [filas]);
    const exportar = async (tipo) => {
        setExportando(tipo);
        try {
            const lib = await import('../../lib/pdfLibro');
            if (tipo === 'csv') return lib.csv(`clientes-${hoy}.csv`, datosExport.columnas, datosExport.filas);
            const doc = await lib.construirPdfLibro({ emisor, titulo: 'Directorio de clientes', periodo: `al ${dmy(hoy)}`, columnas: datosExport.columnas, filas: datosExport.filas, notas: ['Total comprado en dólares, sin contar ventas anuladas. Listado informativo; no sustituye el Libro de Ventas.'] });
            doc.save(`clientes-${hoy}.pdf`);
        } catch { aviso('No se pudo preparar el archivo. Inténtalo de nuevo.'); } finally { setExportando(''); }
    };

    const filtrosActivos = !!(filtros.q || filtros.estado !== 'activos' || filtros.ver);
    const total = resumen.activos + resumen.inactivos;

    return (
        <AppLayout actual="/clientes" titulo="Clientes" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Clientes" />
            <Toast texto={msg} />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Clientes</h2><p className="mt-1 max-w-[62ch] text-[15px] text-muted">Quién te compra, cuánto y cada cuánto. Abre un cliente para ver su ficha y saber cuándo escribirle.</p></div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={() => exportar('pdf')} disabled={!filas.length || !!exportando} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper disabled:opacity-50"><FileDown className="size-4" />{exportando === 'pdf' ? 'Preparando…' : 'Directorio PDF'}</button>
                    <button onClick={() => exportar('csv')} disabled={!filas.length || !!exportando} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper disabled:opacity-50"><FileSpreadsheet className="size-4" />Excel (CSV)</button>
                    <Button onClick={nuevo}><Plus className="size-4" />Nuevo cliente</Button>
                </div>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-3">
                <Kpi icon={Users} titulo="Clientes activos" valor={n0(resumen.activos)} detalle={`${resumen.nuevos_mes} ${resumen.nuevos_mes === 1 ? 'nuevo' : 'nuevos'} este mes · ${resumen.inactivos} desactivado${resumen.inactivos === 1 ? '' : 's'}`} />
                <Kpi icon={ShoppingBag} titulo="Vendido a clientes (12 meses)" valor={dolares(resumen.usd_12m)} detalle={resumen.pct_identificados != null ? `${n0(resumen.pct_identificados)} % de tus ventas; el resto, consumidor final` : 'Aún sin ventas'} />
                <div className="col-span-2 xl:col-span-1">
                    <Kpi icon={BellRing} tono={resumen.dormidos ? 'warn' : undefined} titulo="Para reactivar" valor={n0(resumen.dormidos)} activo={filtros.ver === 'dormidos'}
                        onClick={resumen.dormidos || filtros.ver ? () => ir({ ver: filtros.ver ? undefined : 'dormidos', estado: 'activos' }) : undefined}
                        detalle={filtros.ver === 'dormidos' ? 'Mostrando solo estos. Toca para quitar el filtro' : resumen.dormidos ? `Llevan más de ${dormido_dias} días sin comprar. Toca para verlos` : `Nadie lleva más de ${dormido_dias} días sin comprar`} />
                </div>
            </div>

            <div className="grid items-start gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
                <Card className={movil ? 'hidden xl:block' : ''}>
                    <div className="space-y-3 border-b border-line p-4">
                        <label className="relative block"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Buscar cliente" placeholder="Buscar por nombre, cédula, RIF o teléfono" className="h-11 w-full rounded-lg border border-line bg-paper pl-10 pr-3 text-[15px] placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" /></label>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div role="radiogroup" aria-label="Estado" className="inline-flex rounded-lg bg-[#e9ecf0] p-1 text-[13px]">
                                {[['activos', 'Activos'], ['inactivos', 'Desactivados'], ['todos', 'Todos']].map(([k, l]) => <button key={k} role="radio" aria-checked={filtros.estado === k} onClick={() => ir({ estado: k, ver: undefined })} className={`rounded-md px-2.5 py-1.5 font-medium ${filtros.estado === k && !filtros.ver ? 'bg-white shadow-sm' : 'text-muted hover:text-text'}`}>{l}</button>)}
                            </div>
                            <label className="flex items-center gap-1.5 text-[13px] text-muted">Orden
                                <select value={filtros.orden} onChange={(e) => ir({ orden: e.target.value })} className="h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-text focus:border-brand focus:outline-none">
                                    <option value="nombre">Nombre</option><option value="compras">Más comprado</option><option value="reciente">Compra reciente</option>
                                </select></label>
                        </div>
                    </div>
                    {filas.length === 0 ? (
                        total === 0
                            ? <Vacio icon={Users} titulo="Aún no tienes clientes" texto="Agrega a quienes te compran con frecuencia. En el punto de venta podrás elegirlos y sus facturas saldrán con sus datos."><Button onClick={nuevo}><UserPlus className="size-4" />Nuevo cliente</Button></Vacio>
                            : <Vacio icon={Search} titulo="Ningún cliente coincide" texto="Prueba con otro nombre o documento, o cambia el filtro.">{filtrosActivos && <button onClick={() => { setQ(''); ir({ q: undefined, estado: 'activos', ver: undefined }); }} className="inline-flex h-11 items-center rounded-lg border border-line px-5 text-[15px] font-semibold hover:bg-paper">Quitar filtros</button>}</Vacio>
                    ) : (
                        <ul className="max-h-[640px] divide-y divide-line overflow-y-auto">
                            {filas.map((f) => (
                                <li key={f.id}>
                                    <button onClick={() => abrir(f.id)} aria-current={selId === f.id} className={`relative flex w-full items-center gap-3.5 px-4 py-3.5 text-left hover:bg-paper ${selId === f.id ? 'bg-brand-50/60' : ''}`}>
                                        {selId === f.id && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brand" />}
                                        <span aria-hidden className={`grid size-11 shrink-0 place-items-center rounded-full text-[14px] font-semibold ${f.activo ? 'bg-ink text-white' : 'bg-paper text-muted'}`}>{iniciales(f.nombre, persona(f.tipo))}</span>
                                        <span className="min-w-0 flex-1">
                                            <span className={`block truncate text-[15px] font-semibold ${f.activo ? '' : 'text-muted'}`}>{f.nombre}</span>
                                            <span className="num block truncate text-[13px] text-muted">{f.doc}{f.telefono && ` · ${f.telefono}`}</span>
                                        </span>
                                        <span className="shrink-0 text-right">
                                            <span className="num block text-[14px] font-semibold">{f.compras ? dolares(f.usd) : '—'}</span>
                                            <span className={`block text-[12.5px] ${f.dormido ? 'font-medium text-[#8a5a00]' : 'text-muted'}`}>{f.activo ? hace(f.ultima, hoy) : 'Desactivado'}</span>
                                        </span>
                                    </button>
                                </li>))}
                        </ul>)}
                    {filas.length > 0 && <p className="border-t border-line px-4 py-3 text-[13px] text-muted">{filas.length} {filas.length === 1 ? 'cliente' : 'clientes'}{filtros.q && ` para «${filtros.q}»`}. El monto es todo el historial, sin contar ventas anuladas.</p>}
                </Card>

                <Card className={`min-h-[420px] ${movil ? '' : 'hidden xl:block'}`}>
                    {cargando && !det ? (
                        <div className="grid place-items-center p-20 text-[14px] text-muted" role="status">Abriendo ficha…</div>
                    ) : fallo ? (
                        <Vacio icon={TriangleAlert} titulo="No se pudo abrir la ficha" texto={fallo}><button onClick={() => abrir(selId)} className="inline-flex h-11 items-center rounded-lg border border-line px-5 text-[15px] font-semibold hover:bg-paper">Reintentar</button></Vacio>
                    ) : det ? (
                        <div className={cargando ? 'opacity-60 transition-opacity' : ''}>
                            <Expediente c={det} hoy={hoy} dias={dormido_dias} admin={/admin/i.test(usuario?.rol || '')} onEditar={editar} onEstado={cambiarEstado} onEliminar={() => setBorrar(true)} onVolver={() => setMovil(false)} />
                        </div>
                    ) : (
                        <Vacio icon={PackageOpen} titulo="Elige un cliente" texto="Al abrirlo verás su historial de compras, lo que más compra, cómo paga y sus datos de contacto." />
                    )}
                </Card>
            </div>

            {form && (
                <Modal titulo={form.id ? 'Editar cliente' : 'Nuevo cliente'} subtitulo={form.id ? 'Actualiza sus datos de contacto o su nombre.' : 'Con el documento y el nombre ya puedes venderle. Lo demás es opcional.'} cerrar={cerrar} onSubmit={guardar} enviando={enviando} ok={form.id ? 'Guardar cambios' : 'Crear cliente'} ancho="max-w-[520px]">
                    {errores.general && <p role="alert" className="rounded-lg bg-[#fdecec] p-3 text-[14px] text-danger">{errores.general}</p>}
                    <Field select label="Tipo de documento" value={form.tipo} disabled={form.fijo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                        {TIPOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </Field>
                    <Field label={esRif(form.tipo) ? 'RIF' : form.tipo === 'P' ? 'Pasaporte' : 'Cédula'} icon={Hash} value={form.documento} readOnly={form.fijo} autoFocus={!form.fijo} autoComplete="off"
                        inputMode={form.tipo === 'P' ? 'text' : esRif(form.tipo) ? 'text' : 'numeric'}
                        onChange={(e) => setForm({ ...form, documento: e.target.value.toUpperCase() })}
                        onBlur={() => !form.fijo && esRif(form.tipo) && setForm((f) => ({ ...f, documento: normalizarRif(`${f.tipo}${limpiar(f.tipo, f.documento)}`).slice(2) || f.documento }))}
                        error={errores.documento || docMsg || undefined}
                        hint={form.fijo ? 'No se puede cambiar: ya tiene ventas y aparece en tus libros fiscales.' : esRif(form.tipo) ? 'Ejemplo: 12345678-4. Revisamos el dígito verificador por ti.' : form.tipo === 'P' ? 'Letras y números, sin espacios.' : 'Solo números, sin puntos. Ejemplo: 12345678.'} />
                    <Field label="Nombre o razón social" icon={UserRound} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} error={errores.nombre} autoFocus={form.fijo} />
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Teléfono (opcional)" icon={Phone} value={form.telefono} inputMode="tel" onChange={(e) => setForm({ ...form, telefono: e.target.value })} error={errores.telefono} />
                        <Field label="Correo (opcional)" icon={Mail} value={form.correo} inputMode="email" onChange={(e) => setForm({ ...form, correo: e.target.value })} error={errores.correo} />
                    </div>
                    <Field label="Dirección (opcional)" icon={MapPin} value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} error={errores.direccion} />
                </Modal>)}

            {borrar && det && (
                <Modal titulo={`Eliminar a ${det.nombre}`} subtitulo="No tiene ventas, así que se puede quitar sin afectar tus libros." peligro cerrar={cerrar} enviando={enviando} ok="Eliminar cliente" onSubmit={eliminar}>
                    <p className="text-sm">Esta acción no se puede deshacer. Si prefieres conservarlo, puedes desactivarlo.</p>
                </Modal>)}
        </AppLayout>
    );
}
