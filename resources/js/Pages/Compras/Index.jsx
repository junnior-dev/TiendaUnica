import { Head, router } from '@inertiajs/react';
import { useFiscal } from '../../lib/plan';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Ban, CalendarDays, Check, ChevronLeft, ChevronRight, CircleAlert, Coins, FileText, Landmark, Plane, Plus, ReceiptText, Search, Truck, X } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi, Modal, Toast, Vacio } from '../../Components/kit';
import { Button, Field, Segmented } from '../../Components/ui';
import { http } from '../../lib/http';
import { n0, n2 } from '../../lib/format';

/* ───────── utilidades ───────── */
const bs = (v) => `Bs ${n2(v)}`;
const usd = (v) => `$ ${n2(v)}`;
const money = (m, v) => (m === 'VES' ? bs(v) : usd(v));
const dm = (iso) => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '');
const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const PERIODOS = [['mes', 'Este mes'], ['semana', 'Esta semana'], ['mespasado', 'Mes pasado'], ['anio', 'Este año'], ['rango', 'Elegir fechas']];
const subtituloDe = (f) => ({ mes: 'Facturas de tus proveedores de este mes', semana: 'Facturas de tus proveedores de esta semana', mespasado: 'Facturas de tus proveedores del mes pasado', anio: 'Facturas de tus proveedores de este año', rango: `Facturas de tus proveedores del ${dmy(f.desde)} al ${dmy(f.hasta)}` }[f.periodo]);

const Etiqueta = ({ tono = 'gris', children }) => (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${tono === 'ok' ? 'bg-[#e3f3ea] text-ok' : tono === 'bad' ? 'bg-[#fdecec] text-danger' : tono === 'warn' ? 'bg-[#fff1cc] text-[#8a5d00]' : tono === 'azul' ? 'bg-brand-50 text-brand' : 'bg-paper text-muted'}`}>{children}</span>
);

/** Estado de la retención de IVA de una compra, tal como se ve en la lista. */
function EstadoRetencion({ c, especial, activas }) {
    if (c.estado === 'ANULADA') return <span className="text-muted">—</span>;
    if (c.importacion) return <Etiqueta tono="azul"><Plane className="size-3" />Importación</Etiqueta>;
    if (c.retencion_pct) return <Etiqueta tono="ok"><Check className="size-3" />Retenido {n0(c.retencion_pct)} %</Etiqueta>;
    if (c.iva > 0 && especial && activas) return <Etiqueta tono="warn">Pendiente</Etiqueta>;
    return <span className="text-muted">—</span>;
}

export default function Compras(p) {
    const { negocio, usuario, stock_bajo, tasa_usd, filtros: f, resumen: R, filas, meta, proveedores, especial, retenciones_activas } = p;
    const fiscal = useFiscal();
    const [bajando, setBajando] = useState(false);
    const reportePdf = async () => {
        setBajando(true);
        try {
            const sp = new URLSearchParams({ periodo: f.periodo }); ['desde', 'hasta'].forEach((k) => f.periodo === 'rango' && sp.set(k, f[k])); ['q', 'estado', 'proveedor', 'retencion'].forEach((k) => f[k] && sp.set(k, f[k]));
            const lib = await import('../../lib/pdfCompras');
            lib.abrirPdf(await lib.construirPdfReporteCompras(await http('GET', `/compras/reporte?${sp}`)), { nombre: `reporte-compras-${f.desde}-${f.hasta}.pdf` });
        } catch (e) { avisar(e.message || 'No se pudo preparar el reporte.'); } finally { setBajando(false); }
    };
    const [q, setQ] = useState(f.q);
    const [abierta, setAbierta] = useState(() => { try { const v = new URLSearchParams(window.location.search).get('ver'); return v && /^\d+$/.test(v) ? Number(v) : null; } catch { return null; } });
    const [toast, setToast] = useState('');
    const avisar = (t) => { setToast(''); setTimeout(() => setToast(t), 30); };

    const ir = useCallback((c) => {
        const x = { ...f, ...c }; if (!('pagina' in c)) x.pagina = 1;
        const lim = {};
        if (x.periodo && x.periodo !== 'mes') lim.periodo = x.periodo;
        if (x.periodo === 'rango') { lim.desde = x.desde; lim.hasta = x.hasta; }
        ['q', 'estado', 'proveedor', 'retencion'].forEach((k) => { if (x[k]) lim[k] = x[k]; });
        if (x.pagina > 1) lim.pagina = x.pagina;
        router.get('/compras', lim, { preserveScroll: true, preserveState: true, replace: true });
    }, [f]);

    useEffect(() => { if (q === f.q) return undefined; const t = setTimeout(() => ir({ q }), 350); return () => clearTimeout(t); }, [q]);
    useEffect(() => { setQ(f.q); }, [f.q]);
    const hayFiltros = !!(f.q || f.estado || f.proveedor || f.retencion);
    const quitarFiltros = () => { setQ(''); ir({ q: '', estado: '', proveedor: '', retencion: '' }); };
    const recargar = () => router.reload({ preserveScroll: true, preserveState: true });
    const verRetenciones = especial && retenciones_activas;

    const estadoActual = f.retencion === 'pendiente' ? 'pend' : f.estado || 'todas';
    const pills = [['todas', 'Todas', null], ['REGISTRADA', 'Registradas', null], ['ANULADA', 'Anuladas', R.anuladas], ...(verRetenciones ? [['pend', 'Sin retención', R.pendientes]] : [])];
    const elegirPill = (v) => ir(v === 'todas' ? { estado: '', retencion: '' } : v === 'pend' ? { estado: '', retencion: 'pendiente' } : { estado: v, retencion: '' });

    return (
        <AppLayout actual="/compras" titulo="Compras" subtitulo={subtituloDe(f)} {...{ usuario, negocio, stockBajo: stock_bajo, tasaUsd: tasa_usd }}>
            <Head title="Compras" />
            <Toast texto={toast} />

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-[60ch] text-[14px] text-muted">Aquí registras la mercancía que te llega. Cada compra suma al inventario y actualiza tus costos.</p>
                <div className="flex items-center gap-2">
                    <Button type="button" variant="ghost" className="h-11" onClick={reportePdf} disabled={bajando}><FileText className="size-[18px]" />{bajando ? 'Preparando…' : 'Reporte PDF'}</Button>
                <a href="/compras/nueva" className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-5 text-[15px] font-semibold text-white transition-colors hover:bg-brand-600"><Plus className="size-[18px]" />Nueva compra</a>
                </div>
            </div>

            {/* Filtros */}
            <Card className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div role="radiogroup" aria-label="Período" className="inline-flex flex-wrap rounded-lg bg-[#e9ecf0] p-1">
                        {PERIODOS.map(([v, t]) => (
                            <button key={v} type="button" role="radio" aria-checked={f.periodo === v} onClick={() => ir({ periodo: v })}
                                className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-[14px] font-medium transition-all ${f.periodo === v ? 'bg-white text-text shadow-sm' : 'text-muted hover:text-text'}`}>{v === 'rango' && <CalendarDays className="size-4" />}{t}</button>
                        ))}
                    </div>
                    <label className="relative ml-auto block w-full sm:w-[320px]">
                        <span className="sr-only">Buscar compra</span>
                        <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Proveedor, RIF o N.º de factura" className="h-11 w-full rounded-lg border border-line bg-paper pl-10 pr-3 text-[14px] placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" />
                    </label>
                </div>
                {f.periodo === 'rango' && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-[13px] text-muted">Desde<input type="date" value={f.desde} max={f.hoy} onChange={(e) => e.target.value && ir({ desde: e.target.value })} className="h-10 rounded-lg border border-line bg-white px-3 text-[14px] text-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" /></label>
                        <label className="flex items-center gap-2 text-[13px] text-muted">Hasta<input type="date" value={f.hasta} max={f.hoy} onChange={(e) => e.target.value && ir({ hasta: e.target.value })} className="h-10 rounded-lg border border-line bg-white px-3 text-[14px] text-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" /></label>
                    </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {pills.map(([v, t, n]) => (
                        <button key={v} type="button" aria-pressed={estadoActual === v} onClick={() => elegirPill(v)}
                            className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors ${estadoActual === v ? 'border-brand bg-brand-50 text-brand' : 'border-line bg-white text-text hover:border-[#b9c1ca]'}`}>
                            {t}{n > 0 && <span className={`num rounded-full px-1.5 text-[12px] font-semibold ${v === 'pend' ? 'bg-signal/25 text-[#8a5d00]' : 'bg-paper text-muted'}`}>{n}</span>}
                        </button>
                    ))}
                    {proveedores.length > 1 && (
                        <label className="ml-auto flex items-center gap-2 text-[13px] text-muted">Proveedor
                            <select value={f.proveedor || ''} onChange={(e) => ir({ proveedor: e.target.value || null })} className="h-9 max-w-[240px] rounded-lg border border-line bg-white px-2.5 text-[13.5px] font-medium text-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
                                <option value="">Todos</option>{proveedores.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                            </select>
                        </label>
                    )}
                </div>
            </Card>

            {/* Resumen */}
            <section aria-label="Resumen del período" className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi icon={Truck} titulo="Comprado" valor={usd(R.total_usd)} detalle={R.compras ? `Al cambio de cada factura` : 'Aún no hay compras en este período'} />
                <Kpi icon={ReceiptText} titulo="Facturas registradas" valor={n0(R.compras)} detalle={R.compras ? `Promedio ${usd(R.total_usd / R.compras)} por factura` : 'Registra tu primera compra'} />
                {fiscal && <Kpi icon={Coins} titulo="Crédito fiscal" valor={bs(R.credito_ves)} detalle="IVA de tus compras que puedes descontar" />}
                {verRetenciones
                    ? <Kpi icon={Landmark} titulo="Retenciones pendientes" valor={n0(R.pendientes)} tono={R.pendientes ? 'warn' : undefined} detalle={R.pendientes ? 'Toca para ver las facturas por retener' : 'Todas tus facturas están al día'} onClick={R.pendientes ? () => elegirPill('pend') : undefined} activo={estadoActual === 'pend'} />
                    : <Kpi icon={Ban} titulo="Anuladas" valor={n0(R.anuladas)} detalle={R.anuladas ? 'Su mercancía ya salió del inventario' : 'Ninguna en este período'} onClick={R.anuladas ? () => elegirPill('ANULADA') : undefined} activo={estadoActual === 'ANULADA'} />}
            </section>

            {/* Lista */}
            <Card className="mt-4">
                {filas.length === 0 ? (
                    hayFiltros
                        ? <Vacio icon={Search} titulo="No encontramos compras con esos filtros" texto="Prueba con otra palabra, otro período o quita los filtros para ver todo."><Button variant="ghost" onClick={quitarFiltros}>Quitar filtros</Button></Vacio>
                        : <Vacio icon={Truck} titulo="Todavía no hay compras en este período" texto="Cuando registres la factura de un proveedor aparecerá aquí, y la mercancía se sumará a tu inventario.">
                            <a href="/compras/nueva" className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-5 text-[15px] font-semibold text-white hover:bg-brand-600">Registrar una compra<ArrowRight className="size-4" /></a>
                            {f.periodo !== 'anio' && <Button variant="ghost" onClick={() => ir({ periodo: 'anio' })}>Ver todo el año</Button>}</Vacio>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[900px] text-sm">
                                <thead><tr className="border-b border-line text-left text-[13px] text-muted">
                                    <th className="px-5 py-3 font-medium">Fecha</th><th className="px-3 py-3 font-medium">Proveedor</th><th className="px-3 py-3 font-medium">Factura</th><th className="px-3 py-3 text-right font-medium">Productos</th><th className="px-3 py-3 text-right font-medium">Total</th>{(verRetenciones || R.pendientes > 0 || filas.some((x) => x.retencion_pct || x.importacion)) && <th className="px-3 py-3 font-medium">Retención de IVA</th>}<th className="px-5 py-3"><span className="sr-only">Estado</span></th>
                                </tr></thead>
                                <tbody>
                                    {filas.map((c) => {
                                        const an = c.estado === 'ANULADA';
                                        return (
                                            <tr key={c.id} tabIndex={0} role="button" aria-label={`Ver la factura ${c.factura} de ${c.proveedor}`} onClick={() => setAbierta(c.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setAbierta(c.id))}
                                                className="cursor-pointer border-b border-line last:border-0 hover:bg-paper focus:bg-brand-50 focus:outline-none">
                                                <td className="num whitespace-nowrap px-5 py-3.5 text-muted">{dmy(c.fecha)}</td>
                                                <td className="px-3 py-3.5"><span className={`block max-w-[280px] truncate font-medium ${an ? 'text-muted' : ''}`}>{c.proveedor}</span><span className="num block text-[12.5px] text-muted">{c.rif}</span></td>
                                                <td className="whitespace-nowrap px-3 py-3.5"><span className="num font-semibold">{c.factura}</span>{c.control && <span className="num block text-[12.5px] text-muted">Control {c.control}</span>}</td>
                                                <td className="num whitespace-nowrap px-3 py-3.5 text-right text-muted">{n0(c.lineas)}</td>
                                                <td className="whitespace-nowrap px-3 py-3.5 text-right"><span className={`num block font-semibold ${an ? 'text-muted line-through decoration-[#9aa4af]' : ''}`}>{money(c.moneda, c.total)}</span>{c.moneda === 'VES' && <span className="num block text-[12.5px] text-muted">{usd(c.total_usd)}</span>}</td>
                                                {(verRetenciones || R.pendientes > 0 || filas.some((x) => x.retencion_pct || x.importacion)) && <td className="px-3 py-3.5"><EstadoRetencion c={c} especial={especial} activas={retenciones_activas} /></td>}
                                                <td className="whitespace-nowrap px-5 py-3.5 text-right">{an ? <Etiqueta tono="bad">Anulada</Etiqueta> : <ChevronRight className="ml-auto size-4 text-muted" />}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-muted">
                            <span>Mostrando {(meta.pagina - 1) * meta.por_pagina + 1}–{(meta.pagina - 1) * meta.por_pagina + filas.length} de {meta.total}</span>
                            {meta.paginas > 1 && (
                                <div className="flex items-center gap-2">
                                    <button type="button" disabled={meta.pagina <= 1} onClick={() => ir({ pagina: meta.pagina - 1 })} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line px-3 font-semibold text-text hover:bg-paper disabled:opacity-40"><ChevronLeft className="size-4" />Anterior</button>
                                    <span className="num">Página {meta.pagina} de {meta.paginas}</span>
                                    <button type="button" disabled={meta.pagina >= meta.paginas} onClick={() => ir({ pagina: meta.pagina + 1 })} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line px-3 font-semibold text-text hover:bg-paper disabled:opacity-40">Siguiente<ChevronRight className="size-4" /></button>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </Card>

            {abierta && <Detalle id={abierta} cerrar={() => setAbierta(null)} cambio={(t) => { recargar(); if (t) avisar(t); }} />}
        </AppLayout>
    );
}

/* ═══════════════════════════ Detalle de una compra ═══════════════════════════ */
function Seccion({ titulo, aside, children }) {
    return <section className="border-t border-line px-6 py-5"><div className="flex items-center justify-between gap-3"><h3 className="text-[14px] font-semibold">{titulo}</h3>{aside}</div><div className="mt-3">{children}</div></section>;
}
const Fila = ({ a, b, fuerte }) => <div className={`flex items-baseline justify-between gap-3 py-1 ${fuerte ? 'text-[15px] font-semibold' : 'text-[14px]'}`}><dt className={fuerte ? '' : 'text-muted'}>{a}</dt><dd className="num text-right">{b}</dd></div>;

function Detalle({ id, cerrar, cambio }) {
    const [d, setD] = useState(null); const [error, setError] = useState('');
    const [modal, setModal] = useState(null); // 'anular' | 'retencion-anular'
    const [form, setForm] = useState(null);   // 'retencion' | 'planilla'
    const cargar = useCallback(async () => { try { setD(await http('GET', `/compras/${id}`)); setError(''); } catch (e) { setError(e.message); } }, [id]);
    useEffect(() => { setD(null); setForm(null); cargar(); }, [cargar]);
    const pdf = async (cual) => {
        try {
            const lib = await import('../../lib/pdfCompras');
            if (cual === 'retencion') lib.abrirPdf(await lib.construirPdfRetencion(d), { nombre: `retencion-iva-${d.retencion.comprobante}.pdf` });
            else lib.abrirPdf(await lib.construirPdfCompra(d), { nombre: `compra-${d.factura}.pdf` });
        } catch (e) { setError(e.message || 'No se pudo preparar el PDF.'); }
    };
    useEffect(() => { const k = (e) => e.key === 'Escape' && !modal && cerrar(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [modal, cerrar]);
    const tras = (nuevo, texto) => { setD(nuevo); setModal(null); setForm(null); cambio(texto); };

    const an = d?.estado === 'ANULADA';
    const unidades = d ? d.items.reduce((s, i) => s + i.cantidad, 0) : 0;
    return (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Detalle de la compra">
            <div className="absolute inset-0 bg-black/40" onClick={cerrar} />
            <aside className="absolute inset-y-0 right-0 flex w-[600px] max-w-full flex-col bg-white shadow-2xl">
                <header className="flex items-start justify-between gap-3 px-6 pb-4 pt-5">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2.5"><h2 className="text-lg font-semibold tracking-[-0.01em]">{d ? `Factura ${d.factura}` : 'Cargando compra…'}</h2>{d && (an ? <Etiqueta tono="bad">Anulada</Etiqueta> : <Etiqueta tono="ok"><Check className="size-3" />Registrada</Etiqueta>)}</div>
                        {d && <p className="mt-1 text-[13px] text-muted">{d.proveedor.nombre} · {dmy(d.fecha)}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        {d && <button type="button" onClick={() => pdf('compra')} title="Ver o imprimir la compra en PDF" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13.5px] font-semibold text-brand hover:bg-brand-50"><FileText className="size-4" />PDF</button>}
                    <button type="button" onClick={cerrar} aria-label="Cerrar" className="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-paper"><X className="size-5" /></button>
                    </div>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {error && <p className="mx-6 mb-4 rounded-lg bg-[#fdecec] px-4 py-3 text-[14px] text-danger">{error}</p>}
                    {!d && !error && <div className="space-y-3 px-6 py-4" aria-busy="true">{[70, 50, 90, 60].map((w, i) => <div key={i} className="h-5 animate-pulse rounded bg-paper" style={{ width: `${w}%` }} />)}</div>}
                    {d && (
                        <>
                            {an && d.anulacion && (
                                <div className="mx-6 mb-4 rounded-xl border border-[#f1c5c1] bg-[#fdecec] p-4 text-[14px]">
                                    <p className="flex items-center gap-2 font-semibold text-danger"><Ban className="size-4" />Esta compra fue anulada</p>
                                    <p className="mt-1 text-[#7a2a24]">{dmy(d.anulacion.fecha)}{d.anulacion.por ? ` · por ${d.anulacion.por}` : ''}</p>
                                    <p className="mt-1 text-[#7a2a24]">Motivo: {d.anulacion.motivo}</p>
                                    <p className="mt-2 text-[13px] text-[#7a2a24]">La mercancía salió del inventario y la factura ya no suma en tus totales.</p>
                                </div>
                            )}

                            <Seccion titulo="Proveedor">
                                <p className="text-[15px] font-medium">{d.proveedor.nombre}</p>
                                <p className="num text-[13.5px] text-muted">{d.proveedor.rif}{d.proveedor.telefono ? ` · ${d.proveedor.telefono}` : ''}{d.proveedor.correo ? ` · ${d.proveedor.correo}` : ''}</p>
                                <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-[14px]">
                                    <div className="bg-white px-4 py-3"><dt className="text-[12.5px] text-muted">N.º de factura</dt><dd className="num mt-0.5 font-semibold">{d.factura}</dd></div>
                                    <div className="bg-white px-4 py-3"><dt className="text-[12.5px] text-muted">N.º de control</dt><dd className="num mt-0.5 font-semibold">{d.control || '—'}</dd></div>
                                </dl>
                                {d.observaciones && <p className="mt-3 text-[13.5px] text-muted">Nota: {d.observaciones}</p>}
                            </Seccion>

                            <Seccion titulo={`Productos (${d.items.length})`} aside={<span className="num text-[13px] text-muted">{n0(unidades)} unidades</span>}>
                                <ul className="divide-y divide-line">
                                    {d.items.map((l, i) => (
                                        <li key={i} className="flex items-start justify-between gap-4 py-2.5">
                                            <div className="min-w-0"><p className="text-[14.5px] font-medium">{l.nombre}</p><p className="num text-[12.5px] text-muted">{l.sku} · {n0(l.cantidad)} × {money(d.moneda, l.costo)}{l.exento ? ' · Exento' : ` · IVA ${n0(l.iva_pct)} %`}</p></div>
                                            <p className="num shrink-0 text-[14.5px] font-semibold">{money(d.moneda, l.base)}</p>
                                        </li>
                                    ))}
                                </ul>
                                <dl className="mt-3 border-t border-line pt-3">
                                    {d.base > 0 && <Fila a="Base imponible" b={money(d.moneda, d.base)} />}
                                    {d.exento > 0 && <Fila a="Exento" b={money(d.moneda, d.exento)} />}
                                    <Fila a="IVA" b={money(d.moneda, d.iva)} />
                                    <Fila a="Total de la factura" b={money(d.moneda, d.total)} fuerte />
                                    <p className="num mt-1 text-right text-[12.5px] text-muted">{d.moneda === 'VES' ? `${usd(d.total_usd)} · tasa Bs ${n2(d.tasa)} (${dmy(d.tasa_fecha)})` : d.iva_ves > 0 ? `IVA en bolívares para tus libros: ${bs(d.iva_ves)}` : ''}</p>
                                </dl>
                                <p className="mt-3 rounded-lg bg-paper px-3.5 py-2.5 text-[13px] leading-snug text-muted">{d.credito ? 'El IVA de esta factura es crédito fiscal: se descuenta del IVA que cobras, y no encarece el costo de tus productos.' : 'El IVA de esta factura no es crédito fiscal: se sumó al costo de cada producto.'}</p>
                            </Seccion>

                            {d.retenciones_activas && d.especial && !an && (
                                <Seccion titulo="Retención de IVA">
                                    {d.retencion ? (
                                        <div className="rounded-xl border border-line p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div><p className="flex items-center gap-2 text-[14.5px] font-semibold"><Check className="size-4 text-ok" />Retenido {n0(d.retencion.porcentaje)} % del IVA</p><p className="num mt-1 text-[13.5px] text-muted">Comprobante {d.retencion.comprobante} · {dmy(d.retencion.fecha)}</p></div>
                                                <p className="num text-right text-[15px] font-semibold">{bs(d.retencion.iva_retenido_ves)}</p>
                                            </div>
                                            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                                                <button type="button" onClick={() => pdf('retencion')} className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand hover:underline"><FileText className="size-4" />Comprobante en PDF</button>
                                                <button type="button" onClick={() => setModal('retencion-anular')} className="text-[13.5px] font-semibold text-danger underline underline-offset-2">Anular esta retención</button>
                                            </div>
                                        </div>
                                    ) : d.importacion ? <p className="text-[14px] text-muted">Es una importación: se respalda con la planilla de aduanas y no lleva retención.</p>
                                    : d.iva_ves <= 0 ? <p className="text-[14px] text-muted">Esta factura no tiene IVA, así que no hay nada que retener.</p>
                                    : form === 'retencion' ? <FormRetencion d={d} id={id} fin={tras} cancelar={() => setForm(null)} />
                                    : (
                                        <div className="rounded-xl border border-[#f0d58a] bg-[#fff8e6] p-4">
                                            <p className="text-[14px] font-semibold text-[#8a5d00]">Falta retener el IVA de esta factura</p>
                                            <p className="mt-1 text-[13.5px] leading-snug text-[#6f4b00]">Como contribuyente especial debes retener entre el 75 % y el 100 % del IVA ({bs(d.iva_ves)}) y entregarle el comprobante al proveedor.</p>
                                            <Button type="button" className="mt-3 h-10" onClick={() => setForm('retencion')}><Landmark className="size-4" />Registrar retención</Button>
                                        </div>
                                    )}
                                </Seccion>
                            )}

                            {d.retenciones_activas && !an && (d.importacion || d.puede.planilla) && (
                                <Seccion titulo="Importación">
                                    {d.importacion ? (
                                        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-[14px]">
                                            <div className="bg-white px-4 py-3"><dt className="text-[12.5px] text-muted">Planilla de importación</dt><dd className="num mt-0.5 font-semibold">{d.importacion.planilla}</dd></div>
                                            <div className="bg-white px-4 py-3"><dt className="text-[12.5px] text-muted">Fecha{d.importacion.aduana ? ' · Aduana' : ''}</dt><dd className="mt-0.5 font-semibold"><span className="num">{dmy(d.importacion.fecha)}</span>{d.importacion.aduana ? ` · ${d.importacion.aduana}` : ''}</dd></div>
                                        </dl>
                                    ) : form === 'planilla' ? <FormPlanilla d={d} id={id} fin={tras} cancelar={() => setForm(null)} /> : (
                                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
                                            <p className="max-w-[40ch] text-[13.5px] leading-snug text-muted">¿Esta mercancía llegó importada? Registra su planilla de aduanas para respaldarla en tus libros.</p>
                                            <Button type="button" variant="ghost" className="h-10" onClick={() => setForm('planilla')}><Plane className="size-4" />Registrar planilla</Button>
                                        </div>
                                    )}
                                </Seccion>
                            )}

                            {d.alertas.length > 0 && (
                                <Seccion titulo="Precios por revisar">
                                    <p className="mb-2 text-[13.5px] text-muted">El costo de estos productos cambió con esta compra. Revisa si quieres ajustar su precio de venta.</p>
                                    <ul className="divide-y divide-line rounded-xl border border-line">
                                        {d.alertas.map((a, i) => (
                                            <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[14px]">
                                                <span className="min-w-0 truncate font-medium">{a.nombre}</span>
                                                <span className="num shrink-0 text-[13.5px]"><span className="text-muted">{usd(a.precio_actual_usd)}</span> → <b>{usd(a.precio_sugerido_usd)}</b></span>
                                            </li>
                                        ))}
                                    </ul>
                                    <a href="/productos" className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand hover:underline">Ir a Productos<ArrowRight className="size-4" /></a>
                                </Seccion>
                            )}
                            <div className="h-4" />
                        </>
                    )}
                </div>

                {d && !an && (
                    <footer className="flex items-center justify-between gap-3 border-t border-line px-6 py-3.5">
                        <p className="text-[12.5px] text-muted">Registrada por {d.registrada_por || '—'}</p>
                        <Button type="button" variant="ghost" className="h-10 text-danger" onClick={() => setModal('anular')}><Ban className="size-4" />Anular compra</Button>
                    </footer>
                )}
            </aside>

            {modal === 'anular' && d && <ModalAnular d={d} unidades={unidades} id={id} cerrar={() => setModal(null)} fin={tras} />}
            {modal === 'retencion-anular' && d && <ModalAnularRetencion d={d} id={id} cerrar={() => setModal(null)} fin={tras} />}
        </div>
    );
}

function FormRetencion({ d, id, fin, cancelar }) {
    const hoy = new Date(); const ymd = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    const [fecha, setFecha] = useState(ymd < d.fecha ? d.fecha : ymd); const [pct, setPct] = useState(75); const [comp, setComp] = useState(''); const [env, setEnv] = useState(false); const [err, setErr] = useState('');
    const retenido = Math.round(d.iva_ves * pct) / 100;
    const enviar = async (e) => {
        e.preventDefault(); setEnv(true); setErr('');
        try { fin(await http('POST', `/compras/${id}/retencion`, { fecha, porcentaje: pct, comprobante: comp.trim() || null }), 'Retención registrada.'); } catch (x) { setErr(x.errors?.comprobante?.[0] || x.message); } finally { setEnv(false); }
    };
    return (
        <form onSubmit={enviar} className="space-y-4 rounded-xl border border-line p-4">
            <div><p className="mb-2 text-[13.5px] font-medium">¿Qué porcentaje del IVA retienes?</p><Segmented compact name="Porcentaje de retención" value={pct} onChange={setPct} options={[{ value: 75, label: '75 %' }, { value: 100, label: '100 %' }]} /></div>
            <Field label="Fecha del comprobante" type="date" forceFloat min={d.fecha} value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <Field label="N.º de comprobante (opcional)" value={comp} onChange={(e) => setComp(e.target.value)} hint="Si lo dejas vacío, el sistema le asigna el siguiente número." />
            <p className="rounded-lg bg-paper px-3.5 py-2.5 text-[13.5px]">Se retienen <b className="num">{bs(retenido)}</b> de <span className="num">{bs(d.iva_ves)}</span> de IVA.</p>
            {err && <p role="alert" className="flex items-start gap-1.5 text-[13px] text-danger"><CircleAlert className="mt-px size-3.5 shrink-0" />{err}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" className="h-10" onClick={cancelar}>Cancelar</Button><Button type="submit" className="h-10" disabled={env}>{env ? 'Guardando…' : 'Guardar retención'}</Button></div>
        </form>
    );
}

function FormPlanilla({ d, id, fin, cancelar }) {
    const [planilla, setPlanilla] = useState(''); const [fecha, setFecha] = useState(d.fecha); const [aduana, setAduana] = useState(''); const [env, setEnv] = useState(false); const [err, setErr] = useState('');
    const enviar = async (e) => {
        e.preventDefault(); if (!planilla.trim()) return setErr('Escribe el número de la planilla.');
        setEnv(true); setErr('');
        try { fin(await http('POST', `/compras/${id}/importacion`, { planilla: planilla.trim(), fecha, aduana: aduana.trim() || null }), 'Planilla registrada.'); } catch (x) { setErr(x.message); } finally { setEnv(false); }
    };
    return (
        <form onSubmit={enviar} className="space-y-4 rounded-xl border border-line p-4">
            <Field label="N.º de planilla de importación" value={planilla} onChange={(e) => { setPlanilla(e.target.value); setErr(''); }} error={err} autoFocus />
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Fecha de la planilla" type="date" forceFloat value={fecha} onChange={(e) => setFecha(e.target.value)} /><Field label="Aduana (opcional)" value={aduana} onChange={(e) => setAduana(e.target.value)} /></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" className="h-10" onClick={cancelar}>Cancelar</Button><Button type="submit" className="h-10" disabled={env}>{env ? 'Guardando…' : 'Guardar planilla'}</Button></div>
        </form>
    );
}

function ModalAnular({ d, unidades, id, cerrar, fin }) {
    const [motivo, setMotivo] = useState(''); const [env, setEnv] = useState(false); const [err, setErr] = useState('');
    const enviar = async () => {
        if (motivo.trim().length < 3) return setErr('Cuéntanos el motivo de la anulación.');
        setEnv(true); setErr('');
        try { fin(await http('POST', `/compras/${id}/anular`, { motivo: motivo.trim() }), 'Compra anulada.'); } catch (x) { setErr(x.message); } finally { setEnv(false); }
    };
    return (
        <Modal titulo="¿Anular esta compra?" subtitulo={`Factura ${d.factura} de ${d.proveedor.nombre}`} cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Sí, anular compra" peligro ancho="max-w-[500px]">
            <div className="rounded-xl bg-paper px-4 py-3.5 text-[14px] leading-snug">
                <p className="font-semibold">Esto es lo que va a pasar:</p>
                <ul className="mt-2 space-y-1.5">
                    <li className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-ok" />Se descuentan del inventario {n0(unidades)} unidades de {d.items.length} {d.items.length === 1 ? 'producto' : 'productos'}.</li>
                    <li className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-ok" />La factura sale de tus totales y del libro de compras.</li>
                    <li className="flex gap-2.5"><CircleAlert className="mt-0.5 size-4 shrink-0 text-[#8a5d00]" />Si ya vendiste parte de esta mercancía, no se podrá anular: te diremos cuál producto no alcanza.</li>
                </ul>
            </div>
            {d.retencion && <p className="flex gap-2 rounded-lg bg-[#fff8e6] px-3.5 py-2.5 text-[13.5px] text-[#6f4b00]"><AlertTriangle className="mt-0.5 size-4 shrink-0" />Esta factura tiene una retención registrada. Anula primero la retención.</p>}
            <Field label="Motivo de la anulación" value={motivo} onChange={(e) => { setMotivo(e.target.value); setErr(''); }} error={err} autoFocus hint="Por ejemplo: factura duplicada o mercancía devuelta al proveedor." />
        </Modal>
    );
}

function ModalAnularRetencion({ d, id, cerrar, fin }) {
    const [motivo, setMotivo] = useState(''); const [env, setEnv] = useState(false); const [err, setErr] = useState('');
    const enviar = async () => {
        if (motivo.trim().length < 3) return setErr('Cuéntanos el motivo.');
        setEnv(true); setErr('');
        try { fin(await http('POST', `/compras/${id}/retencion/anular`, { motivo: motivo.trim() }), 'Retención anulada.'); } catch (x) { setErr(x.message); } finally { setEnv(false); }
    };
    return (
        <Modal titulo="¿Anular la retención?" subtitulo={`Comprobante ${d.retencion.comprobante}`} cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Sí, anular retención" peligro>
            <p className="text-[14px] leading-snug text-muted">La factura volverá a quedar pendiente de retención y podrás registrarla de nuevo. El comprobante anulado queda guardado como constancia.</p>
            <Field label="Motivo" value={motivo} onChange={(e) => { setMotivo(e.target.value); setErr(''); }} error={err} autoFocus />
        </Modal>
    );
}
