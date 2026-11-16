import { Head, router } from '@inertiajs/react';
import { useFiscal } from '../../lib/plan';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Banknote, BadgeCheck, CalendarClock, ClipboardList, FileDown, FileSpreadsheet, Hash, Mail, MapPin, MessageCircle, PackageOpen, Pencil, Phone, Plus, Power, Receipt, Search, ShieldCheck, Store, Trash2, Truck, TriangleAlert } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, IconBtn, Kpi, Modal, Toast, Vacio } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { n0, n2 } from '../../lib/format';
import { http } from '../../lib/http';
import { normalizarRif, validarRif } from '../../lib/rif';
import { EstadoCuenta, PagoModal } from './Cuenta';
import { Dato, Cifra, Ritmo, dmy, dolares, hace, iniciales, whatsapp } from '../../Components/expediente';

function Expediente({ p, hoy, puedeEliminar, cxp, generando, onCuenta, onPago, onExpediente, onEditar, onEstado, onEliminar, onVolver }) {
    const fiscal = useFiscal();
    const wa = whatsapp(p.telefono);
    const tope = Math.max(...p.productos.map((x) => x.usd), 1);
    const compras = `/compras?periodo=anio&proveedor=${p.id}`;
    return (
        <div>
            {/* Portada del expediente */}
            <div className="rounded-t-2xl bg-ink px-5 pb-5 pt-4 text-white sm:px-7 sm:pb-6">
                <button onClick={onVolver} className="-ml-1.5 mb-3 inline-flex h-9 items-center gap-1.5 rounded-lg px-1.5 text-[14px] text-white/70 hover:bg-white/10 hover:text-white xl:hidden"><ArrowLeft className="size-4" />Volver al directorio</button>
                <div className="flex flex-wrap items-start gap-4">
                    <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white/10 text-[22px] font-semibold tracking-wide ring-1 ring-white/20">{iniciales(p.nombre)}</span>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] sm:text-[26px]">{p.nombre}</h3>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                            <span className="num inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 font-medium">{p.rif}</span>
                            {p.rif_valido ? <span className="inline-flex items-center gap-1 text-[#7be0a8]"><BadgeCheck className="size-4" />RIF válido</span> : <span className="inline-flex items-center gap-1 text-[#ffd166]"><TriangleAlert className="size-4" />Revisa el RIF</span>}
                            <span className={`rounded-full px-2.5 py-0.5 font-medium ${p.activo ? 'bg-[#14804a]/30 text-[#9cecc0]' : 'bg-white/10 text-white/70'}`}>{p.activo ? 'Activo' : 'Desactivado'}</span>
                        </div>
                        <p className="mt-2 text-[13px] text-white/60">En tu directorio desde el {dmy(p.desde)}</p>
                    </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                    <button onClick={onEditar} className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-[14px] font-semibold text-ink hover:bg-[#e9ecf0]"><Pencil className="size-4" />Editar datos</button>
                    <button onClick={onCuenta} className="inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-[14px] font-medium ring-1 ring-white/25 hover:bg-white/10"><CalendarClock className="size-4" />Estado de cuenta</button>
                    {cxp && <button onClick={onPago} className="inline-flex h-10 items-center gap-2 rounded-lg bg-signal px-4 text-[14px] font-semibold text-ink hover:brightness-95"><Banknote className="size-4" />Registrar pago</button>}
                    <button onClick={onExpediente} disabled={generando} className="inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-[14px] font-medium ring-1 ring-white/25 hover:bg-white/10 disabled:opacity-60"><ClipboardList className="size-4" />{generando ? 'Preparando…' : 'Expediente PDF'}</button>
                    {p.telefono && <a href={`tel:${p.telefono.replace(/[^\d+]/g, '')}`} className="inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-[14px] font-medium ring-1 ring-white/25 hover:bg-white/10"><Phone className="size-4" />Llamar</a>}
                    {wa && <a href={wa} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-[14px] font-medium ring-1 ring-white/25 hover:bg-white/10"><MessageCircle className="size-4" />WhatsApp</a>}
                    {p.correo && <a href={`mailto:${p.correo}`} className="inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-[14px] font-medium ring-1 ring-white/25 hover:bg-white/10"><Mail className="size-4" />Escribir</a>}
                </div>
            </div>

            <div className="space-y-7 p-5 sm:p-7">
                {p.compras === 0 ? (
                    <div className="flex items-start gap-3 rounded-xl bg-brand-50 p-4 text-[14px] leading-snug">
                        <Receipt className="mt-0.5 size-5 shrink-0 text-brand" /><p>Todavía no le has comprado nada. Cuando registres una factura de este proveedor en <a href="/compras" className="font-semibold text-brand hover:underline">Compras</a>, aquí verás su historial, lo que más le compras y cada cuánto.</p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <Cifra titulo="Compras" valor={n0(p.compras)} detalle={p.anuladas ? `${p.anuladas} anulada${p.anuladas === 1 ? '' : 's'} (no suman)` : 'Facturas registradas'} />
                            <Cifra titulo="Total comprado (US$)" valor={n2(p.usd)} detalle="Sin contar anuladas" />
                            <Cifra titulo="Promedio (US$)" valor={n2(p.promedio_usd)} detalle="Por factura" />
                            <Cifra titulo="Última compra" valor={hace(p.ultima, hoy)} detalle={p.cada_dias ? `Le compras cada ~${p.cada_dias} ${p.cada_dias === 1 ? "día" : "días"}` : dmy(p.ultima)} />
                        </div>

                        <section>
                            <div className="mb-2 flex items-baseline justify-between gap-3"><h4 className="text-[15px] font-semibold">Ritmo de compra</h4><p className="text-[13px] text-muted">Últimos 12 meses, en dólares</p></div>
                            <Ritmo meses={p.meses} />
                        </section>

                        <div className="grid gap-7 lg:grid-cols-2">
                            <section>
                                <div className="mb-2 flex items-baseline justify-between gap-3"><h4 className="text-[15px] font-semibold">Compras recientes</h4><a href={compras} className="text-[13px] font-medium text-brand hover:underline">Ver todas</a></div>
                                <ul className="divide-y divide-line rounded-xl border border-line">
                                    {p.recientes.map((c) => (
                                        <li key={c.id} className="flex items-center gap-3 px-3.5 py-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-[14px] font-medium"><span className="num">Factura {c.factura}</span></p>
                                                <p className="text-[13px] text-muted">{dmy(c.fecha)}{c.importacion && ' · Importación'}{c.ret_pct != null && ` · Ret. ${n0(c.ret_pct)} %`}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className={`num text-[14px] font-semibold ${c.estado === 'ANULADA' ? 'text-muted line-through' : ''}`}>{dolares(c.total_usd)}</p>
                                                {c.estado === 'ANULADA' && <p className="text-[12px] font-medium text-danger">Anulada</p>}
                                            </div>
                                        </li>))}
                                </ul>
                            </section>
                            <section>
                                <div className="mb-2 flex items-baseline justify-between gap-3"><h4 className="text-[15px] font-semibold">Lo que más le compras</h4><p className="text-[13px] text-muted">Por monto</p></div>
                                {p.productos.length === 0 ? <p className="rounded-xl border border-line p-4 text-[14px] text-muted">Aún no hay productos asociados a sus facturas.</p> : (
                                    <ul className="space-y-3 rounded-xl border border-line p-3.5">
                                        {p.productos.map((x) => (
                                            <li key={x.id}>
                                                <div className="flex items-baseline justify-between gap-3"><p className="min-w-0 truncate text-[14px] font-medium" title={x.nombre}>{x.nombre}</p><p className="num shrink-0 text-[13px] font-semibold">{dolares(x.usd)}</p></div>
                                                <div className="mt-1.5 flex items-center gap-2.5"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper"><span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(4, (x.usd / tope) * 100)}%` }} /></span><span className="num shrink-0 text-right text-[12px] text-muted">{n0(x.unidades)} und</span></div>
                                            </li>))}
                                    </ul>)}
                            </section>
                        </div>
                    </>
                )}

                {cxp && (
                    <section className={`rounded-xl border p-4 ${p.cxp?.vencido_usd > 0 ? 'border-[#f0b4af] bg-[#fdf3f2]' : 'border-line'}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div><h4 className="text-[15px] font-semibold">Lo que le debes</h4>
                                {p.cxp?.saldo_usd > 0 ? (
                                    <>
                                        <p className="num mt-1 text-[24px] font-semibold leading-tight">{dolares(p.cxp.saldo_usd)}</p>
                                        <p className="mt-1 text-[14px] text-muted">{p.cxp.pendientes} {p.cxp.pendientes === 1 ? 'factura pendiente' : 'facturas pendientes'}{p.cxp.vencido_usd > 0 && <> · <span className="font-semibold text-danger">{dolares(p.cxp.vencido_usd)} vencido</span></>}</p>
                                        {p.cxp.proxima && <p className="mt-0.5 text-[14px] text-muted">Próxima: factura <span className="num">{p.cxp.proxima.factura}</span> {p.cxp.proxima.dias < 0 ? `vencida hace ${-p.cxp.proxima.dias} ${p.cxp.proxima.dias === -1 ? 'día' : 'días'}` : p.cxp.proxima.dias === 0 ? 'vence hoy' : `vence en ${p.cxp.proxima.dias} ${p.cxp.proxima.dias === 1 ? 'día' : 'días'}`}.</p>}
                                    </>
                                ) : <p className="mt-1 text-[14px] text-muted">{p.cxp?.a_credito ? 'Estás al día: no tienes facturas pendientes.' : 'Todas sus facturas han sido de contado; no hay deuda.'}</p>}
                            </div>
                            <p className="rounded-lg bg-paper px-3 py-1.5 text-[13px] text-muted">Crédito que te da: <span className="font-semibold text-text">{p.dias_credito > 0 ? `${p.dias_credito} días` : 'de contado'}</span></p>
                        </div>
                    </section>)}

                <section>
                    <h4 className="mb-3 text-[15px] font-semibold">Datos de contacto</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Dato icon={Phone} label="Teléfono" vacio="Sin teléfono">{p.telefono}</Dato>
                        <Dato icon={Mail} label="Correo" vacio="Sin correo">{p.correo}</Dato>
                        <Dato icon={MapPin} label="Dirección" vacio="Sin dirección">{p.direccion}</Dato>
                    </div>
                </section>

                {fiscal && p.compras > 0 && (
                    <section className="rounded-xl bg-paper p-4">
                        <h4 className="flex items-center gap-2 text-[15px] font-semibold"><ShieldCheck className="size-4 text-muted" />Lo fiscal de este proveedor</h4>
                        <p className="mt-2 text-[14px] leading-snug">Crédito fiscal acumulado en sus facturas: <span className="num font-semibold">Bs {n2(p.credito_ves)}</span>.</p>
                        {p.retenciones_pendientes != null && (p.retenciones_pendientes > 0
                            ? <p className="mt-2 text-[14px] leading-snug"><span className="font-semibold text-[#8a5a00]">{p.retenciones_pendientes} {p.retenciones_pendientes === 1 ? 'factura sin retención de IVA' : 'facturas sin retención de IVA'}.</span> Como contribuyente especial debes retener y emitir el comprobante. <a href={`/compras?periodo=anio&proveedor=${p.id}&retencion=pendiente`} className="font-semibold text-brand hover:underline">Revisarlas</a></p>
                            : <p className="mt-2 text-[14px] leading-snug text-muted">No tienes retenciones de IVA pendientes con este proveedor.</p>)}
                        <p className="mt-2 text-[12.5px] text-muted">Cifras informativas tomadas de tu libro de compras; confirma los montos con tu contador.</p>
                    </section>)}

                <section className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
                    <p className="max-w-[52ch] text-[13px] leading-snug text-muted">{p.activo ? 'Si ya no le compras, desactívalo: deja de aparecer al registrar compras, pero conservas todo su historial.' : 'Está desactivado: no aparece al registrar compras. Actívalo para volver a usarlo.'}</p>
                    <div className="flex gap-2">
                        <button onClick={onEstado} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper"><Power className="size-4" />{p.activo ? 'Desactivar' : 'Activar'}</button>
                        {puedeEliminar && <button onClick={onEliminar} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold text-danger hover:bg-[#fdecec]"><Trash2 className="size-4" />Eliminar</button>}
                    </div>
                </section>
            </div>
        </div>
    );
}

export default function Proveedores({ negocio, usuario, fecha_larga, stock_bajo, tasa_usd, filtros, hoy, emisor, resumen, filas, cxp = false }) {
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
    const [cuenta, setCuenta] = useState(null);
    const [verCuenta, setVerCuenta] = useState(false);
    const [pagando, setPagando] = useState(false);
    const [anulando, setAnulando] = useState(null);
    const [motivo, setMotivo] = useState('');
    const [generando, setGenerando] = useState('');
    const primera = useRef(true);

    const ir = useCallback((extra) => router.get('/proveedores', { q: filtros.q, estado: filtros.estado, orden: filtros.orden, ...extra }, { preserveState: true, preserveScroll: true, replace: true, only: ['filtros', 'resumen', 'filas', 'hoy'] }), [filtros]);

    useEffect(() => {
        if (primera.current) { primera.current = false; return; }
        const t = setTimeout(() => { if (q.trim() !== (filtros.q || '')) ir({ q: q.trim() || undefined }); }, 300);
        return () => clearTimeout(t);
    }, [q]);

    const abrir = useCallback(async (id) => {
        setSelId(id); setMovil(true); setCargando(true); setFallo('');
        try { setDet(await http('GET', `/proveedores/${id}`)); } catch (e) { setDet(null); setFallo(e.message); } finally { setCargando(false); }
    }, []);

    // En pantallas anchas se abre el primero para que el panel nunca quede vacío.
    useEffect(() => {
        if (selId && filas.some((f) => f.id === selId)) return;
        if (filas.length && window.matchMedia('(min-width: 1280px)').matches) abrir(filas[0].id);
        else if (!filas.length) { setSelId(null); setDet(null); setMovil(false); }
    }, [filas]);

    const aviso = (t) => { setMsg(''); setTimeout(() => setMsg(t), 0); };
    const refrescar = () => router.reload({ only: ['resumen', 'filas'], preserveScroll: true });

    const nuevo = () => { setErrores({}); setForm({ id: null, rif: '', razon_social: '', telefono: '', correo: '', direccion: '', rifFijo: false, dias_credito: '' }); };
    const editar = () => { setErrores({}); setForm({ id: det.id, rif: det.rif, razon_social: det.nombre, telefono: det.telefono || '', correo: det.correo || '', direccion: det.direccion || '', rifFijo: det.compras + det.anuladas > 0, dias_credito: det.dias_credito ? String(det.dias_credito) : '' }); };
    const cerrar = () => { setForm(null); setBorrar(false); setErrores({}); };

    const rifMsg = form && form.rif.trim() && !form.rifFijo ? validarRif(form.rif) : null;

    const guardar = async () => {
        const er = {};
        if (!form.rifFijo) { const r = form.rif.trim() ? validarRif(form.rif) : 'Escribe el RIF del proveedor.'; if (r) er.rif = r; }
        if (form.razon_social.trim().length < 2) er.razon_social = 'Escribe el nombre o razón social.';
        if (form.correo.trim() && !/^\S+@\S+\.\S+$/.test(form.correo.trim())) er.correo = 'Ese correo no parece válido.';
        setErrores(er); if (Object.keys(er).length) return;
        setEnviando(true);
        try {
            const cuerpo = { rif: form.rif, razon_social: form.razon_social, telefono: form.telefono, correo: form.correo, direccion: form.direccion, ...(cxp ? { dias_credito: Number(form.dias_credito) || 0 } : {}) };
            const r = form.id ? await http('PUT', `/proveedores/${form.id}`, cuerpo) : await http('POST', '/proveedores', cuerpo);
            cerrar(); aviso(form.id ? 'Cambios guardados' : 'Proveedor creado');
            setSelId(r.id); setDet(r.detalle); setMovil(true); refrescar();
        } catch (e) { setErrores({ ...(e.errors ? Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k, v[0]])) : {}), general: e.errors && Object.keys(e.errors).length ? undefined : e.message }); }
        finally { setEnviando(false); }
    };

    const cambiarEstado = async () => {
        try { const r = await http('PATCH', `/proveedores/${det.id}/estado`, { activo: !det.activo }); setDet(r.detalle); aviso(r.detalle.activo ? 'Proveedor activado' : 'Proveedor desactivado'); refrescar(); }
        catch (e) { aviso(e.message); }
    };
    const eliminar = async () => {
        setEnviando(true);
        try { await http('DELETE', `/proveedores/${det.id}`); cerrar(); setDet(null); setSelId(null); setMovil(false); aviso('Proveedor eliminado'); refrescar(); }
        catch (e) { cerrar(); aviso(e.message); } finally { setEnviando(false); }
    };

    const datosExport = useMemo(() => ({
        columnas: [{ h: 'RIF', w: 30 }, { h: 'Razón social' }, { h: 'Teléfono', w: 34 }, { h: 'Correo', w: 52 }, { h: 'Compras', a: 'right', w: 20 }, { h: 'Total comprado US$', a: 'right', w: 36 }, { h: 'Última compra', w: 28 }, { h: 'Estado', w: 22 }],
        filas: filas.map((f) => [f.rif, f.nombre, f.telefono || '', f.correo || '', n0(f.compras), n2(f.usd), dmy(f.ultima), f.activo ? 'Activo' : 'Desactivado']),
    }), [filas]);
    const exportar = async (tipo) => {
        setExportando(tipo);
        try {
            const lib = await import('../../lib/pdfLibro');
            if (tipo === 'csv') return lib.csv(`proveedores-${hoy}.csv`, datosExport.columnas, datosExport.filas);
            const doc = await lib.construirPdfLibro({ emisor, titulo: 'Directorio de proveedores', periodo: `al ${dmy(hoy)}`, columnas: datosExport.columnas, filas: datosExport.filas, notas: ['Total comprado en dólares, sin contar facturas anuladas. Listado informativo; no sustituye el Libro de Compras.'] });
            doc.save(`proveedores-${hoy}.pdf`);
        } catch { aviso('No se pudo preparar el archivo. Inténtalo de nuevo.'); } finally { setExportando(''); }
    };

    const cargarCuenta = async () => { const c = await http('GET', `/proveedores/${det.id}/cuenta`); setCuenta(c); return c; };
    const abrirCuenta = async () => { try { await cargarCuenta(); setVerCuenta(true); } catch (e) { aviso(e.message); } };
    const abrirPago = async () => { try { const c = await cargarCuenta(); if (c.totales.saldo <= 0) { setVerCuenta(true); aviso('No le debes nada a este proveedor.'); return; } setPagando(true); } catch (e) { aviso(e.message); } };
    const pagoListo = (r) => { setPagando(false); setCuenta(r.cuenta); setDet(r.detalle); setVerCuenta(true); aviso(r.con_asiento ? 'Pago registrado con su asiento contable' : 'Pago registrado'); refrescar(); };
    const anularPago = async () => {
        if (motivo.trim().length < 3) return;
        setEnviando(true);
        try { const r = await http('POST', `/proveedores/${det.id}/pagos/${anulando.id}/anular`, { motivo: motivo.trim() }); setCuenta(r.cuenta); setDet(r.detalle); setAnulando(null); setMotivo(''); aviso('Pago anulado: la deuda volvió a su saldo'); refrescar(); }
        catch (e) { setAnulando(null); aviso(e.message); } finally { setEnviando(false); }
    };
    const pdfCuenta = async () => {
        setGenerando('cuenta');
        try { const m = await import('../../lib/pdfProveedores'); (await m.construirPdfEstadoCuenta(cuenta)).save(`estado-de-cuenta-${cuenta.proveedor.rif.replace(/[^A-Z0-9]/gi, '')}-${hoy}.pdf`); }
        catch { aviso('No se pudo preparar el PDF. Inténtalo de nuevo.'); } finally { setGenerando(''); }
    };
    const pdfExpediente = async () => {
        setGenerando('exp');
        try { const d = await http('GET', `/proveedores/${det.id}/expediente`); const m = await import('../../lib/pdfProveedores'); (await m.construirPdfExpediente(d)).save(`expediente-${det.rif.replace(/[^A-Z0-9]/gi, '')}-${hoy}.pdf`); }
        catch { aviso('No se pudo preparar el expediente. Inténtalo de nuevo.'); } finally { setGenerando(''); }
    };

    const filtrosActivos = !!(filtros.q || filtros.estado !== 'activos');
    const total = resumen.activos + resumen.inactivos;

    return (
        <AppLayout actual="/proveedores" titulo="Proveedores" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Proveedores" />
            <Toast texto={msg} />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Proveedores</h2><p className="mt-1 max-w-[62ch] text-[15px] text-muted">A quién le compras, cuánto y cada cuánto. Abre un proveedor para ver su expediente completo.</p></div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={() => exportar('pdf')} disabled={!filas.length || !!exportando} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper disabled:opacity-50"><FileDown className="size-4" />{exportando === 'pdf' ? 'Preparando…' : 'Directorio PDF'}</button>
                    <button onClick={() => exportar('csv')} disabled={!filas.length || !!exportando} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper disabled:opacity-50"><FileSpreadsheet className="size-4" />Excel (CSV)</button>
                    <Button onClick={nuevo}><Plus className="size-4" />Nuevo proveedor</Button>
                </div>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-3">
                <Kpi icon={Truck} titulo="Proveedores activos" valor={n0(resumen.activos)} detalle={`${resumen.inactivos} desactivado${resumen.inactivos === 1 ? '' : 's'} · ${resumen.sin_compras} sin compras`} />
                <Kpi icon={Receipt} titulo="Comprado en 12 meses" valor={dolares(resumen.usd_12m)} detalle={`${n0(resumen.compras_12m)} ${resumen.compras_12m === 1 ? 'factura' : 'facturas'} registradas`} />
                <div className="col-span-2 xl:col-span-1">
                    <Kpi icon={Store} tono={resumen.principal && resumen.principal.pct >= 60 ? 'warn' : undefined} titulo="Tu proveedor principal" valor={resumen.principal ? `${n0(resumen.principal.pct)} %` : '—'}
                        detalle={resumen.principal ? (resumen.principal.pct >= 60 ? `Dependes mucho de ${resumen.principal.nombre}` : resumen.principal.nombre) : 'Aún no hay compras en 12 meses'} />
                </div>
            </div>

            <div className="grid items-start gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
                {/* Directorio */}
                <Card className={movil ? 'hidden xl:block' : ''}>
                    <div className="space-y-3 border-b border-line p-4">
                        <label className="relative block"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Buscar proveedor" placeholder="Buscar por nombre, RIF o teléfono" className="h-11 w-full rounded-lg border border-line bg-paper pl-10 pr-3 text-[15px] placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" /></label>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div role="radiogroup" aria-label="Estado" className="inline-flex rounded-lg bg-[#e9ecf0] p-1 text-[13px]">
                                {[['activos', 'Activos'], ['inactivos', 'Desactivados'], ['todos', 'Todos']].map(([k, l]) => <button key={k} role="radio" aria-checked={filtros.estado === k} onClick={() => ir({ estado: k })} className={`rounded-md px-2.5 py-1.5 font-medium ${filtros.estado === k ? 'bg-white shadow-sm' : 'text-muted hover:text-text'}`}>{l}</button>)}
                            </div>
                            <label className="flex items-center gap-1.5 text-[13px] text-muted">Orden
                                <select value={filtros.orden} onChange={(e) => ir({ orden: e.target.value })} className="h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-text focus:border-brand focus:outline-none">
                                    <option value="nombre">Nombre</option><option value="compras">Más comprado</option><option value="reciente">Compra reciente</option>
                                </select></label>
                        </div>
                    </div>
                    {filas.length === 0 ? (
                        total === 0
                            ? <Vacio icon={Truck} titulo="Aún no tienes proveedores" texto="Agrega a quienes te surten repuestos para registrar tus compras y llevar el crédito fiscal al día."><Button onClick={nuevo}><Plus className="size-4" />Nuevo proveedor</Button></Vacio>
                            : <Vacio icon={Search} titulo="Ningún proveedor coincide" texto="Prueba con otro nombre o RIF, o cambia el filtro de estado.">{filtrosActivos && <button onClick={() => { setQ(''); ir({ q: undefined, estado: 'activos' }); }} className="inline-flex h-11 items-center rounded-lg border border-line px-5 text-[15px] font-semibold hover:bg-paper">Quitar filtros</button>}</Vacio>
                    ) : (
                        <ul className="max-h-[640px] divide-y divide-line overflow-y-auto">
                            {filas.map((f) => (
                                <li key={f.id}>
                                    <button onClick={() => abrir(f.id)} aria-current={selId === f.id} className={`relative flex w-full items-center gap-3.5 px-4 py-3.5 text-left hover:bg-paper ${selId === f.id ? 'bg-brand-50/60' : ''}`}>
                                        {selId === f.id && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brand" />}
                                        <span aria-hidden className={`grid size-11 shrink-0 place-items-center rounded-xl text-[14px] font-semibold ${f.activo ? 'bg-ink text-white' : 'bg-paper text-muted'}`}>{iniciales(f.nombre)}</span>
                                        <span className="min-w-0 flex-1">
                                            <span className={`block truncate text-[15px] font-semibold ${f.activo ? '' : 'text-muted'}`}>{f.nombre}</span>
                                            <span className="num block truncate text-[13px] text-muted">{f.rif}{f.telefono && ` · ${f.telefono}`}</span>
                                        </span>
                                        <span className="shrink-0 text-right">
                                            <span className="num block text-[14px] font-semibold">{f.compras ? dolares(f.usd) : '—'}</span>
                                            <span className="block text-[12.5px] text-muted">{f.activo ? hace(f.ultima, hoy) : 'Desactivado'}</span>
                                        </span>
                                    </button>
                                </li>))}
                        </ul>)}
                    {filas.length > 0 && <p className="border-t border-line px-4 py-3 text-[13px] text-muted">{filas.length} {filas.length === 1 ? 'proveedor' : 'proveedores'}{filtros.q && ` para «${filtros.q}»`}. El monto es todo el historial, sin contar facturas anuladas.</p>}
                </Card>

                {/* Expediente */}
                <Card className={`min-h-[420px] ${movil ? '' : 'hidden xl:block'}`}>
                    {cargando && !det ? (
                        <div className="grid place-items-center p-20 text-[14px] text-muted" role="status">Abriendo expediente…</div>
                    ) : fallo ? (
                        <Vacio icon={TriangleAlert} titulo="No se pudo abrir el expediente" texto={fallo}><button onClick={() => abrir(selId)} className="inline-flex h-11 items-center rounded-lg border border-line px-5 text-[15px] font-semibold hover:bg-paper">Reintentar</button></Vacio>
                    ) : det ? (
                        <div className={cargando ? 'opacity-60 transition-opacity' : ''}>
                            <Expediente p={det} hoy={hoy} cxp={cxp} generando={generando === 'exp'} onCuenta={abrirCuenta} onPago={abrirPago} onExpediente={pdfExpediente} puedeEliminar={det.puede_eliminar} onEditar={editar} onEstado={cambiarEstado} onEliminar={() => setBorrar(true)} onVolver={() => setMovil(false)} />
                        </div>
                    ) : (
                        <Vacio icon={PackageOpen} titulo="Elige un proveedor" texto="Al abrirlo verás su historial de compras, lo que más le compras, sus datos de contacto y lo fiscal." />
                    )}
                </Card>
            </div>

            {form && (
                <Modal titulo={form.id ? 'Editar proveedor' : 'Nuevo proveedor'} subtitulo={form.id ? 'Actualiza sus datos de contacto o su razón social.' : 'Con el RIF y el nombre ya puedes registrarle compras. Lo demás es opcional.'} cerrar={cerrar} onSubmit={guardar} enviando={enviando} ok={form.id ? 'Guardar cambios' : 'Crear proveedor'} ancho="max-w-[520px]">
                    {errores.general && <p role="alert" className="rounded-lg bg-[#fdecec] p-3 text-[14px] text-danger">{errores.general}</p>}
                    <Field label="RIF" icon={Hash} value={form.rif} readOnly={form.rifFijo} autoFocus={!form.rifFijo} inputMode="text" autoComplete="off"
                        onChange={(e) => setForm({ ...form, rif: e.target.value.toUpperCase() })} onBlur={() => !form.rifFijo && setForm((f) => ({ ...f, rif: normalizarRif(f.rif) }))}
                        error={errores.rif || (rifMsg && form.rif.replace(/[^A-Z0-9]/gi, '').length >= 10 ? rifMsg : undefined)}
                        hint={form.rifFijo ? 'No se puede cambiar: ya tiene compras y aparece en tus libros fiscales.' : 'Ejemplo: J-12345678-4. Revisamos el dígito verificador por ti.'} />
                    <Field label="Nombre o razón social" icon={Store} value={form.razon_social} onChange={(e) => setForm({ ...form, razon_social: e.target.value })} error={errores.razon_social} autoFocus={form.rifFijo} />
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Teléfono (opcional)" icon={Phone} value={form.telefono} inputMode="tel" onChange={(e) => setForm({ ...form, telefono: e.target.value })} error={errores.telefono} />
                        <Field label="Correo (opcional)" icon={Mail} value={form.correo} inputMode="email" onChange={(e) => setForm({ ...form, correo: e.target.value })} error={errores.correo} />
                    </div>
                    <Field label="Dirección (opcional)" icon={MapPin} value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} error={errores.direccion} />
                    {cxp && <Field label="Días de crédito que te da (opcional)" icon={CalendarClock} value={form.dias_credito} inputMode="numeric" onChange={(e) => setForm({ ...form, dias_credito: e.target.value.replace(/\D/g, '').slice(0, 3) })} error={errores.dias_credito} hint="Déjalo vacío si siempre le pagas de contado. Se propone al registrar una compra." />}
                </Modal>)}

            {verCuenta && cuenta && !pagando && !anulando && <EstadoCuenta cuenta={cuenta} cerrar={() => setVerCuenta(false)} generando={generando === 'cuenta'} onPdf={pdfCuenta} puedePagar={cxp && cuenta.totales.saldo > 0} onPagar={() => setPagando(true)} onAnular={(x) => { setMotivo(''); setAnulando(x); }} />}
            {pagando && cuenta && det && <PagoModal proveedor={det} cuenta={cuenta} cerrar={() => setPagando(false)} listo={pagoListo} />}
            {anulando && (
                <Modal titulo="Anular pago" subtitulo={`Pago del ${dmy(anulando.fecha)} por ${anulando.moneda} ${n2(anulando.monto)}`} peligro cerrar={() => setAnulando(null)} enviando={enviando} ok="Anular pago" onSubmit={anularPago}>
                    <p className="text-sm">La deuda vuelve a subir por ese monto. Si el pago tenía asiento contable, se registra su contra-asiento; el original no se borra.</p>
                    <Field label="¿Por qué lo anulas?" value={motivo} autoFocus onChange={(e) => setMotivo(e.target.value)} />
                </Modal>)}

            {borrar && det && (
                <Modal titulo={`Eliminar ${det.nombre}`} subtitulo="No tiene compras, así que se puede quitar sin afectar tus libros." peligro cerrar={cerrar} enviando={enviando} ok="Eliminar proveedor" onSubmit={eliminar}>
                    <p className="text-sm">Esta acción no se puede deshacer. Si prefieres conservarlo, puedes desactivarlo.</p>
                </Modal>)}
        </AppLayout>
    );
}
