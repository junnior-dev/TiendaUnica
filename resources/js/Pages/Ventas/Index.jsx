import { Head, router } from '@inertiajs/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Ban, CalendarDays, Check, ChevronLeft, ChevronRight, Coins, Download, FilePlus2, FileText, Printer, Receipt, ReceiptText, Search, ShoppingCart, Stamp, X } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Chip, Kpi, Modal, Toast, Vacio } from '../../Components/kit';
import { Button, Field, Segmented } from '../../Components/ui';
import DevolucionNota from '../../Components/DevolucionNota';
import DevolucionDinero from '../../Components/DevolucionDinero';
import { http } from '../../lib/http';
import { n0, n2, tasa as fTasa, SIMBOLO, COLOR, NOMBRE } from '../../lib/format';

/* ───────── utilidades ───────── */
const bs = (v) => `Bs ${n2(v)}`;
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const num6 = (n) => String(n).padStart(6, '0');
const dm = (iso) => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '');
const dmy = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const num = (s) => { const t = String(s ?? '').trim(); if (!t) return NaN; return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); };
const dec = (m, v) => (m === 'COP' ? n0(v) : n2(v));
const monedaTxt = (m, v) => `${SIMBOLO[m] || m} ${dec(m, v)}`;
const ls = { leer: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, poner: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } } };
const PERIODOS = [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['rango', 'Elegir fechas']];

const Etiqueta = ({ tono = 'gris', children }) => (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${tono === 'ok' ? 'bg-[#e3f3ea] text-ok' : tono === 'bad' ? 'bg-[#fdecec] text-danger' : tono === 'warn' ? 'bg-[#fff4d6] text-[#8a5d00]' : 'bg-paper text-muted'}`}>{children}</span>
);

function subtituloDe(f) {
    if (f.periodo === 'hoy') return 'Las ventas de hoy';
    if (f.periodo === 'ayer') return 'Las ventas de ayer';
    if (f.periodo === 'semana') return `Desde el lunes ${dm(f.desde)} hasta hoy`;
    if (f.periodo === 'mes') return 'Desde el primer día del mes hasta hoy';
    return f.desde === f.hasta ? `Ventas del ${dmy(f.desde)}` : `Del ${dmy(f.desde)} al ${dmy(f.hasta)}`;
}

/* ═══════════════════════════ Pantalla ═══════════════════════════ */
export default function Ventas(p) {
    const { negocio, usuario, fecha_larga, stock_bajo, tasa_usd, filtros: f, resumen: R, filas, meta, cajeros, es_admin, regimen } = p;
    const [q, setQ] = useState(f.q);
    const [abierta, setAbierta] = useState(null);
    const [toast, setToast] = useState('');
    const avisar = (t) => { setToast(''); setTimeout(() => setToast(t), 30); };

    const ir = useCallback((c) => {
        const x = { ...f, ...c }; if (!('pagina' in c)) x.pagina = 1;
        const lim = {};
        if (x.periodo && x.periodo !== 'hoy') lim.periodo = x.periodo;
        if (x.periodo === 'rango') { lim.desde = x.desde; lim.hasta = x.hasta; }
        ['q', 'estado', 'factura', 'cajero'].forEach((k) => { if (x[k]) lim[k] = x[k]; });
        if (x.pagina > 1) lim.pagina = x.pagina;
        router.get('/ventas', lim, { preserveScroll: true, preserveState: true, replace: true });
    }, [f]);

    useEffect(() => { if (q === f.q) return undefined; const t = setTimeout(() => ir({ q }), 350); return () => clearTimeout(t); }, [q]);
    useEffect(() => { setQ(f.q); }, [f.q]);
    const hayFiltros = !!(f.q || f.estado || f.factura || f.cajero);
    const quitarFiltros = () => { setQ(''); ir({ q: '', estado: '', factura: '', cajero: null }); };
    const recargar = () => router.reload({ preserveScroll: true, preserveState: true });
    const unDia = f.desde === f.hasta;

    const estadoActual = f.factura === 'sin' ? 'sin' : f.estado || 'todas';
    const pills = [['todas', 'Todas', null], ['COMPLETADA', 'Completadas', null], ['ANULADA', 'Anuladas', R.anuladas], ['sin', 'Sin factura', R.sin_factura]];
    const elegirPill = (v) => ir(v === 'todas' ? { estado: '', factura: '' } : v === 'sin' ? { estado: '', factura: 'sin' } : { estado: v, factura: '' });

    const totalMon = R.monedas.reduce((s, m) => s + m.usd, 0);
    const divisas = R.monedas.filter((m) => m.moneda !== 'VES').reduce((s, m) => s + m.usd, 0);

    return (
        <AppLayout actual="/ventas" titulo="Ventas" subtitulo={subtituloDe(f)} {...{ usuario, negocio, stockBajo: stock_bajo, tasaUsd: tasa_usd }}>
            <Head title="Ventas" />
            <Toast texto={toast} />

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
                        <span className="sr-only">Buscar venta</span>
                        <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente, cédula, N.º de venta o factura" className="h-11 w-full rounded-lg border border-line bg-paper pl-10 pr-3 text-[14px] placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" />
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
                            {t}{n > 0 && <span className={`num rounded-full px-1.5 text-[12px] font-semibold ${v === 'sin' ? 'bg-signal/25 text-[#8a5d00]' : 'bg-paper text-muted'}`}>{n}</span>}
                        </button>
                    ))}
                    {es_admin && cajeros.length > 1 && (
                        <label className="ml-auto flex items-center gap-2 text-[13px] text-muted">Cajero
                            <select value={f.cajero || ''} onChange={(e) => ir({ cajero: e.target.value || null })} className="h-9 rounded-lg border border-line bg-white px-2.5 text-[13.5px] font-medium text-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
                                <option value="">Todos</option>{cajeros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                            </select>
                        </label>
                    )}
                </div>
            </Card>

            {/* Resumen */}
            <section aria-label="Resumen del período" className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi icon={Coins} titulo="Vendido" valor={bs(R.total_ves)} detalle={`$ ${n2(R.total_usd)} al cambio de cada venta`} />
                <Kpi icon={ShoppingCart} titulo="Ventas realizadas" valor={n0(R.ventas)} detalle={R.ventas ? `Promedio ${bs(R.total_ves / R.ventas)} por venta` : 'Aún no hay ventas en este período'} />
                {regimen.cobra_igtf
                    ? <Kpi icon={Receipt} titulo="IGTF cobrado" valor={bs(R.igtf_ves)} detalle={`$ ${n2(R.igtf_usd)} por pagos en divisas`} />
                    : <Kpi icon={Receipt} titulo="Pagado en divisas" valor={totalMon ? `${Math.round((divisas / totalMon) * 100)} %` : '—'} detalle="Del total cobrado en el período" />}
                <Kpi icon={FileText} titulo="Sin factura" valor={n0(R.sin_factura)} tono={R.sin_factura ? 'warn' : undefined} detalle={R.sin_factura ? 'Toca para verlas y emitirlas' : 'Todas tienen su factura'} onClick={R.sin_factura ? () => elegirPill('sin') : undefined} activo={estadoActual === 'sin'} />
            </section>

            {R.monedas.length > 0 && (
                <Card className="mt-4 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-[15px] font-semibold">Cómo pagaron tus clientes</h2><p className="text-[13px] text-muted">Parte del total cobrado según la moneda de cada pago</p></div>
                    <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-paper" role="img" aria-label={R.monedas.map((m) => `${NOMBRE[m.moneda] || m.moneda}: ${Math.round((m.usd / totalMon) * 100)} %`).join(', ')}>
                        {R.monedas.map((m) => <span key={m.moneda} style={{ width: `${(m.usd / totalMon) * 100}%`, background: COLOR[m.moneda] }} />)}
                    </div>
                    <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[13.5px]">
                        {R.monedas.map((m) => <li key={m.moneda} className="flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-full" style={{ background: COLOR[m.moneda] }} /><span className="font-medium">{m.moneda === 'VES' ? 'Bolívares' : NOMBRE[m.moneda]}</span><span className="num text-muted">{Math.round((m.usd / totalMon) * 100)} % · $ {n2(m.usd)}</span></li>)}
                    </ul>
                </Card>
            )}

            {/* Lista */}
            <Card className="mt-4">
                {filas.length === 0 ? (
                    hayFiltros || estadoActual !== 'todas'
                        ? <Vacio icon={Search} titulo="No encontramos ventas con esos filtros" texto="Prueba con otra palabra, otro período o quita los filtros para ver todo."><Button variant="ghost" onClick={quitarFiltros}>Quitar filtros</Button></Vacio>
                        : <Vacio icon={ReceiptText} titulo={f.periodo === 'hoy' ? 'Todavía no hay ventas hoy' : 'No hay ventas en este período'} texto={f.periodo === 'hoy' ? 'Cuando registres la primera venta aparecerá aquí con su factura, sus pagos y todo el detalle.' : 'Elige otro período para ver ventas anteriores.'}>
                            <a href="/caja" className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-5 text-[15px] font-semibold text-white hover:bg-brand-600">Ir al punto de venta<ArrowRight className="size-4" /></a>
                            {f.periodo === 'hoy' && <Button variant="ghost" onClick={() => ir({ periodo: 'mes' })}>Ver todo el mes</Button>}</Vacio>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[860px] text-sm">
                                <thead><tr className="border-b border-line text-left text-[13px] text-muted">
                                    <th className="px-5 py-3 font-medium">Venta</th><th className="px-3 py-3 font-medium">Cliente</th><th className="px-3 py-3 font-medium">Factura</th><th className="px-3 py-3 font-medium">Pagó con</th><th className="px-3 py-3 text-right font-medium">Total cobrado</th><th className="px-5 py-3 font-medium"><span className="sr-only">Estado</span></th>
                                </tr></thead>
                                <tbody>
                                    {filas.map((v) => {
                                        const an = v.estado === 'ANULADA';
                                        return (
                                            <tr key={v.id} tabIndex={0} role="button" aria-label={`Ver la venta ${num6(v.numero)} de ${v.cliente}`} onClick={() => setAbierta(v.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setAbierta(v.id))}
                                                className="cursor-pointer border-b border-line last:border-0 hover:bg-paper focus:bg-brand-50 focus:outline-none">
                                                <td className="whitespace-nowrap px-5 py-3.5"><span className="num font-semibold">N.º {num6(v.numero)}</span><span className="num mt-0.5 block text-[12.5px] text-muted">{unDia ? v.hora : `${dm(v.fecha)} · ${v.hora}`}</span></td>
                                                <td className="px-3 py-3.5"><span className={`block max-w-[240px] truncate font-medium ${an ? 'text-muted' : ''}`}>{v.cliente}</span>{v.documento && <span className="num block text-[12.5px] text-muted">{v.documento}</span>}</td>
                                                <td className="whitespace-nowrap px-3 py-3.5">{v.factura ? <span className="num">{v.factura}</span> : an ? <span className="text-muted">—</span> : <Etiqueta tono="warn">Sin factura</Etiqueta>}{v.notas > 0 && <span className="mt-0.5 block text-[12.5px] text-muted">{v.notas} {v.notas === 1 ? 'nota' : 'notas'}</span>}</td>
                                                <td className="px-3 py-3.5"><div className="flex flex-wrap gap-1.5">{v.pagos.slice(0, 2).map((m) => <span key={m} className="rounded-md bg-paper px-2 py-0.5 text-[12.5px] text-muted">{m}</span>)}{v.pagos.length > 2 && <span className="rounded-md bg-paper px-2 py-0.5 text-[12.5px] text-muted">+{v.pagos.length - 2}</span>}</div></td>
                                                <td className="whitespace-nowrap px-3 py-3.5 text-right"><span className={`num block font-semibold ${an ? 'text-muted line-through decoration-[#9aa4af]' : ''}`}>{bs(v.total_ves)}</span><span className="num block text-[12.5px] text-muted">$ {n2(v.total_usd)}</span></td>
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

            {abierta && <Detalle id={abierta} cerrar={() => setAbierta(null)} esAdmin={es_admin} cambio={(t) => { recargar(); if (t) avisar(t); }} />}
        </AppLayout>
    );
}

/* ═══════════════════════════ Detalle de una venta ═══════════════════════════ */
function Seccion({ titulo, aside, children }) {
    return <section className="border-t border-line px-6 py-5"><div className="flex items-center justify-between gap-3"><h3 className="text-[14px] font-semibold">{titulo}</h3>{aside}</div><div className="mt-3">{children}</div></section>;
}
const Fila = ({ a, b, fuerte, muted }) => <div className={`flex items-baseline justify-between gap-3 py-1 ${fuerte ? 'text-[15px] font-semibold' : 'text-[14px]'}`}><dt className={muted ? 'text-muted' : fuerte ? '' : 'text-muted'}>{a}</dt><dd className="num text-right">{b}</dd></div>;

function Detalle({ id, cerrar, esAdmin, cambio }) {
    const [d, setD] = useState(null); const [error, setError] = useState('');
    const [formato, setFormato] = useState(() => ls.leer('pos.formato', 'ticket'));
    const [modal, setModal] = useState(null); // 'anular' | 'nota'
    const [env, setEnv] = useState(false); const [errF, setErrF] = useState(''); const [gen, setGen] = useState(false);
    const [fact, setFact] = useState(''); const [ctrl, setCtrl] = useState('');
    const cargar = useCallback(async () => { try { setD(await http('GET', `/ventas/${id}`)); setError(''); } catch (e) { setError(e.message); } }, [id]);
    useEffect(() => { setD(null); cargar(); }, [cargar]);
    useEffect(() => { ls.poner('pos.formato', formato); }, [formato]);
    useEffect(() => { const k = (e) => e.key === 'Escape' && !modal && cerrar(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [modal, cerrar]);

    const generar = async (descargar) => {
        setGen(true);
        try {
            const { construirPdfVenta, abrirPdf } = await import('../../lib/pdfVenta');
            abrirPdf(await construirPdfVenta(d, formato), { imprimir: !descargar, descargar, nombre: `${d.factura ? 'factura' : 'nota-de-venta'}-${d.factura || num6(d.numero)}.pdf` });
        } finally { setGen(false); }
    };
    const emitir = async (manual) => {
        setEnv(true); setErrF('');
        try {
            if (manual) await http('POST', `/caja/venta/${id}/factura`, { factura: fact.trim(), control: ctrl.trim() || null });
            else await http('POST', `/caja/venta/${id}/emitir`, {});
            await cargar(); cambio(manual ? 'Número de factura guardado.' : 'Factura emitida.');
        } catch (e) { setErrF(e.errors?.factura?.[0] || e.message); } finally { setEnv(false); }
    };

    const an = d?.estado === 'ANULADA';
    return (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Detalle de la venta">
            <div className="absolute inset-0 bg-black/40" onClick={cerrar} />
            <aside className="absolute inset-y-0 right-0 flex w-[580px] max-w-full flex-col bg-white shadow-2xl">
                <header className="flex items-start justify-between gap-3 px-6 pb-4 pt-5">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2.5"><h2 className="text-lg font-semibold tracking-[-0.01em]">{d ? `Venta N.º ${num6(d.numero)}` : 'Cargando venta…'}</h2>{d && (an ? <Etiqueta tono="bad">Anulada</Etiqueta> : d.factura ? <Etiqueta tono="ok">Con factura</Etiqueta> : <Etiqueta tono="warn">Sin factura</Etiqueta>)}</div>
                        {d && <p className="mt-1 text-[13px] text-muted">{d.fecha} · {d.hora} · Atendió {d.cajero || '—'}</p>}
                    </div>
                    <button type="button" onClick={cerrar} aria-label="Cerrar" className="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-paper"><X className="size-5" /></button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {error && <p className="mx-6 mb-4 rounded-lg bg-[#fdecec] px-4 py-3 text-[14px] text-danger">{error}</p>}
                    {!d && !error && <div className="space-y-3 px-6 py-4" aria-busy="true">{[70, 50, 90, 60].map((w, i) => <div key={i} className="h-5 animate-pulse rounded bg-paper" style={{ width: `${w}%` }} />)}</div>}
                    {d && (
                        <>
                            {an && d.anulacion && (
                                <div className="mx-6 mb-4 rounded-xl border border-[#f1c5c1] bg-[#fdecec] p-4 text-[14px]">
                                    <p className="flex items-center gap-2 font-semibold text-danger"><Ban className="size-4" />Esta venta fue anulada</p>
                                    <p className="mt-1 text-[#7a2a24]">{d.anulacion.fecha}{d.anulacion.por ? ` · por ${d.anulacion.por}` : ''}</p>
                                    <p className="mt-1 text-[#7a2a24]">Motivo: {d.anulacion.motivo}</p>
                                    <p className="mt-2 text-[13px] text-[#7a2a24]">Lo vendido volvió al inventario y la venta ya no suma en los totales ni en el libro de ventas.</p>
                                </div>
                            )}

                            <Seccion titulo="Cliente">
                                {d.cliente ? <div><p className="text-[15px] font-medium">{d.cliente.nombre}</p><p className="num text-[13.5px] text-muted">{d.cliente.tipo}-{d.cliente.documento}{d.cliente.telefono ? ` · ${d.cliente.telefono}` : ''}</p>{d.cliente.direccion && <p className="text-[13.5px] text-muted">{d.cliente.direccion}</p>}</div> : <p className="text-[14px] text-muted">Consumidor final (sin datos de cliente)</p>}
                            </Seccion>

                            <Seccion titulo={`Productos (${d.lineas.length})`}>
                                <ul className="divide-y divide-line">
                                    {d.lineas.map((l, i) => (
                                        <li key={i} className="flex items-start justify-between gap-4 py-2.5">
                                            <div className="min-w-0"><p className="text-[14.5px] font-medium">{l.descripcion}</p><p className="num text-[12.5px] text-muted">{l.sku} · {n0(l.cantidad)} × $ {n2(l.precio_usd)}{l.descuento_pct > 0 ? ` · ${n2(l.descuento_pct)} % de descuento` : ''}{l.alicuota !== 'G' ? ' · exento' : ''}</p></div>
                                            <p className="num shrink-0 text-[14.5px] font-semibold">{bs(l.total_ves)}</p>
                                        </li>
                                    ))}
                                </ul>
                                <dl className="mt-3 border-t border-line pt-3">
                                    {d.totales.base_ves > 0 && <Fila a="Base imponible" b={bs(d.totales.base_ves)} />}
                                    {d.totales.exento_ves > 0 && <Fila a="Exento" b={bs(d.totales.exento_ves)} />}
                                    <Fila a={`IVA ${n2(d.regimen.iva_pct)} %`} b={bs(d.totales.iva_ves)} />
                                    <Fila a="Total de la venta" b={bs(d.totales.total_ves)} fuerte />
                                    {d.totales.igtf_ves > 0 && <Fila a={`IGTF ${n2(d.regimen.igtf_pct)} % por pagos en divisas`} b={bs(d.totales.igtf_ves)} />}
                                    {d.totales.igtf_ves > 0 && <Fila a="Total cobrado" b={bs(d.totales.total_cobrar_ves)} fuerte />}
                                    <p className="num mt-1 text-right text-[12.5px] text-muted">$ {n2(d.totales.total_cobrar_usd)} · tasa Bs {fTasa(d.tasas.USD)} ({dmy(d.tasa_fecha)})</p>
                                </dl>
                            </Seccion>

                            <Seccion titulo="Cómo pagó">
                                <ul className="space-y-2.5">
                                    {d.pagos.map((pg, i) => (
                                        <li key={i} className="flex items-start gap-3">
                                            <Chip m={pg.moneda} />
                                            <div className="min-w-0 flex-1"><p className="text-[14.5px] font-medium">{pg.metodo}</p><p className="num text-[12.5px] text-muted">{pg.referencia ? `Ref. ${pg.referencia}` : ''}{pg.igtf > 0 ? `${pg.referencia ? ' · ' : ''}IGTF ${monedaTxt(pg.moneda, pg.igtf)}` : ''}{pg.vuelto > 0 ? ` · Recibió ${monedaTxt(pg.moneda, pg.entregado)} y dio vuelto de ${monedaTxt(pg.vuelto_moneda || pg.moneda, pg.vuelto)}` : ''}</p></div>
                                            <p className="num shrink-0 text-[14.5px] font-semibold">{monedaTxt(pg.moneda, pg.cobrado ?? pg.monto)}</p>
                                        </li>
                                    ))}
                                </ul>
                            </Seccion>

                            <Seccion titulo="Factura">
                                {d.factura ? (
                                    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-[14px]">
                                        <div className="bg-white px-4 py-3"><dt className="text-[12.5px] text-muted">N.º de factura</dt><dd className="num mt-0.5 font-semibold">{d.factura}</dd></div>
                                        <div className="bg-white px-4 py-3"><dt className="text-[12.5px] text-muted">N.º de control</dt><dd className="num mt-0.5 font-semibold">{d.control || '—'}</dd></div>
                                    </dl>
                                ) : an ? <p className="text-[14px] text-muted">La venta se anuló antes de emitir su factura.</p> : d.factura_automatica ? (
                                    <div className="rounded-xl border border-[#f0d58a] bg-[#fff8e6] p-4">
                                        <p className="text-[14px] font-semibold text-[#8a5d00]">Esta venta todavía no tiene factura</p>
                                        {errF && <p className="mt-1 text-[13px] text-[#8a5d00]">{errF}</p>}
                                        <Button type="button" className="mt-3 h-10" onClick={() => emitir(false)} disabled={env}><Stamp className="size-4" />{env ? 'Emitiendo…' : 'Emitir factura ahora'}</Button>
                                    </div>
                                ) : (
                                    <form className="rounded-xl border border-line p-4" onSubmit={(e) => { e.preventDefault(); emitir(true); }}>
                                        <p className="text-[13.5px] leading-snug text-muted">Escribe el número que te dio tu máquina fiscal o tu sistema de facturación digital.</p>
                                        <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="N.º de factura" value={fact} onChange={(e) => setFact(e.target.value)} error={errF} /><Field label="N.º de control (opcional)" value={ctrl} onChange={(e) => setCtrl(e.target.value)} /></div>
                                        <div className="mt-3 flex justify-end"><Button type="submit" disabled={env || !fact.trim()}>{env ? 'Un momento…' : 'Guardar número'}</Button></div>
                                    </form>
                                )}
                            </Seccion>

                            {d.notas.length > 0 && (
                                <Seccion titulo="Notas de crédito y débito">
                                    <ul className="divide-y divide-line">
                                        {d.notas.map((n) => (
                                            <li key={n.numero} className="flex items-start justify-between gap-4 py-2.5">
                                                <div className="min-w-0"><p className="text-[14.5px] font-medium"><span className="num">{n.numero}</span> · {n.tipo === 'C' ? 'Nota de crédito' : 'Nota de débito'}</p><p className="text-[12.5px] text-muted">{n.fecha} · {n.motivo}</p></div>
                                                <p className={`num shrink-0 text-[14.5px] font-semibold ${n.tipo === 'C' ? 'text-danger' : ''}`}>{n.tipo === 'C' ? '−' : '+'} {bs(n.total_ves)}</p>
                                            </li>
                                        ))}
                                    </ul>
                                </Seccion>
                            )}
                            {d.observaciones && <Seccion titulo="Observaciones"><p className="text-[14px]">{d.observaciones}</p></Seccion>}
                        </>
                    )}
                </div>

                {d && (
                    <footer className="space-y-3 border-t border-line bg-white px-6 py-4">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-[13px] text-muted">{d.factura ? 'Imprimir la factura' : 'Imprimir la nota de venta'}</p>
                            <div className="w-[230px]"><Segmented name="formato" compact value={formato} onChange={setFormato} options={[{ value: 'ticket', label: 'Ticket' }, { value: 'carta', label: 'Hoja carta' }]} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <button type="button" onClick={() => generar(false)} disabled={gen} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-ink text-[15px] font-semibold text-white hover:bg-black disabled:opacity-60"><Printer className="size-[18px]" />{gen ? 'Preparando…' : 'Imprimir'}</button>
                            <button type="button" onClick={() => generar(true)} disabled={gen} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line text-[15px] font-semibold hover:bg-paper disabled:opacity-60"><Download className="size-[18px]" />Descargar PDF</button>
                        </div>
                        {(d.puede.nota || d.puede.anular) && (
                            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                                {d.puede.nota ? <button type="button" onClick={() => setModal('nota')} className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-[14px] font-semibold text-brand hover:bg-brand-50"><FilePlus2 className="size-4" />Nota de crédito o débito</button> : <span />}
                                {d.puede.anular && <button type="button" onClick={() => setModal('anular')} className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-[14px] font-semibold text-danger hover:bg-[#fdecec]"><Ban className="size-4" />Anular venta</button>}
                            </div>
                        )}
                    </footer>
                )}
            </aside>

            {modal === 'anular' && d && <ModalAnular d={d} cerrar={() => setModal(null)} hecho={(nd) => { setD(nd); setModal(null); cambio('Venta anulada. El inventario ya se actualizó.'); }} />}
            {modal === 'nota' && d && <ModalNota d={d} cerrar={() => setModal(null)} hecho={(nd, t) => { setD(nd); setModal(null); cambio(t); }} />}
        </div>
    );
}

/* ───────── Anular ───────── */
function ModalAnular({ d, cerrar, hecho }) {
    const [motivo, setMotivo] = useState(''); const [err, setErr] = useState(''); const [env, setEnv] = useState(false);
    const enviar = async () => {
        setEnv(true); setErr('');
        try { hecho(await http('POST', `/ventas/${d.id}/anular`, { motivo })); }
        catch (e) { setErr(e.errors?.motivo?.[0] || e.message); setEnv(false); }
    };
    return (
        <Modal titulo={`Anular la venta N.º ${num6(d.numero)}`} subtitulo="Esto no se puede deshacer. La venta se conserva en el historial, nunca se borra." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Sí, anular venta" peligro ancho="max-w-[520px]">
            <ul className="space-y-2 rounded-xl bg-paper p-4 text-[14px]">
                <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-ok" />Lo vendido vuelve al inventario.</li>
                {d.totales.igtf_ves > 0 && <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-ok" />Queda constancia de la reversión del IGTF ({bs(d.totales.igtf_ves)}).</li>}
                <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-ok" />Deja de sumar en los totales y en el libro de ventas.</li>
                <li className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#8a5d00]" />Anular no devuelve el dinero ni lo saca de tu caja: si hay que reintegrarlo, hazlo con una nota de crédito (que sí lo anota) o regístralo en Movimientos de caja.</li>
                {d.factura && <li className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#8a5d00]" />Esta venta ya tiene la factura {d.factura}. Si ya se la entregaste al cliente, lo habitual es emitir una nota de crédito; confírmalo con tu contador.</li>}
            </ul>
            <Field label="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} error={err} autoFocus hint="Por ejemplo: «El cliente se arrepintió» o «Error al cobrar»." />
        </Modal>
    );
}

/* ───────── Nota de crédito / débito ───────── */
function ModalNota({ d, cerrar, hecho }) {
    const [tipo, setTipo] = useState('C');
    const [base, setBase] = useState(''); const [motivo, setMotivo] = useState(''); const [numero, setNumero] = useState(d.siguiente_nota.C);
    const [err, setErr] = useState({}); const [msg, setMsg] = useState(''); const [env, setEnv] = useState(false);
    const [tocoNumero, setTocoNumero] = useState(false); const [dev, setDev] = useState({ devuelve: false, productos: [], error: null });
    const [din, setDin] = useState({ devuelve: false, devolucion: null, error: null });
    useEffect(() => { if (!tocoNumero) setNumero(d.siguiente_nota[tipo]); }, [tipo]);
    const b = num(base); const baseOk = !Number.isNaN(b) && b > 0;
    const iva = baseOk ? r2((b * d.regimen.iva_pct) / 100) : 0;
    const maxC = d.acreditable_ves;
    const enviar = async () => {
        if (dev.devuelve && dev.error) { setErr({ productos: dev.error }); return; }
        if (din.devuelve && din.error) { setErr({ dinero: din.error }); return; }
        setEnv(true); setErr({}); setMsg('');
        try { const nd = await http('POST', `/ventas/${d.id}/nota`, { tipo, base_ves: b, motivo, numero, devuelve_inventario: dev.devuelve, productos: dev.devuelve ? dev.productos : [], devolucion: din.devuelve ? din.devolucion : null }); hecho(nd, `${tipo === 'C' ? 'Nota de crédito' : 'Nota de débito'} registrada${dev.devuelve ? ' y mercancía devuelta al inventario' : ''}${din.devuelve ? '; el dinero devuelto quedó anotado en tu caja' : ''}.`); }
        catch (e) { setErr(Object.fromEntries(Object.entries(e.errors || {}).map(([k, v]) => [k, v[0]]))); setMsg(Object.keys(e.errors || {}).length ? '' : e.message); setEnv(false); }
    };
    return (
        <Modal titulo="Nota de crédito o débito" subtitulo={`Sobre la venta N.º ${num6(d.numero)}${d.factura ? ` (factura ${d.factura})` : ''}. El IVA se calcula con la alícuota de esa venta.`} cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Registrar nota" ancho="max-w-[520px]">
            <Segmented name="tipo-nota" value={tipo} onChange={setTipo} options={[{ value: 'C', label: 'Nota de crédito', note: 'Devolución o descuento posterior. Resta del libro.' }, { value: 'D', label: 'Nota de débito', note: 'Cobro adicional. Suma al libro.' }]} />
            <Field label="Monto sin IVA, en bolívares" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} error={err.base_ves} autoFocus
                hint={tipo === 'C' ? (maxC > 0 ? `Puedes acreditar hasta ${bs(maxC)}.` : 'Esta venta ya no tiene monto disponible para acreditar.') : undefined}
                trailing={tipo === 'C' && maxC > 0 ? <button type="button" onClick={() => setBase(String(maxC).replace('.', ','))} className="absolute right-1.5 top-1/2 z-10 h-8 -translate-y-1/2 rounded-md px-2 text-[12px] font-semibold text-brand hover:bg-brand-50">Todo</button> : null} />
            {baseOk && <dl className="rounded-xl bg-paper px-4 py-3"><Fila a="Monto" b={bs(b)} /><Fila a={`IVA ${n2(d.regimen.iva_pct)} %`} b={bs(iva)} /><Fila a={`Total de la nota ${tipo === 'C' ? '(se resta)' : '(se suma)'}`} b={bs(r2(b + iva))} fuerte /></dl>}
            {tipo === 'C' && d.deuda && baseOk && (() => {
                const total = r2(b + iva); const aplica = Math.min(total, d.deuda.saldo_ves); const resto = r2(total - aplica);
                return <p className="rounded-lg bg-brand-50 p-3 text-[13px] leading-snug text-brand">Esta venta está a crédito y el cliente aún debe {bs(d.deuda.saldo_ves)}. La nota baja su deuda en {bs(aplica)}{resto > 0 ? ` y los ${bs(resto)} restantes se devuelven en dinero.` : '. No hay dinero que devolver.'}</p>;
            })()}
            <DevolucionNota ventaId={d.id} tipo={tipo} base={base} ivaPct={d.regimen.iva_pct} onChange={setDev} />
            {err.productos && <p role="alert" className="text-[13px] text-danger">{err.productos}</p>}
            <DevolucionDinero tipo={tipo} onChange={setDin} aviso={d.deuda ? 'Esta venta está a crédito: solo se puede devolver lo que exceda la deuda del cliente.' : undefined} />
            {err.dinero && <p role="alert" className="text-[13px] text-danger">{err.dinero}</p>}
            <Field label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} error={err.motivo} hint="Por ejemplo: «Devolución de pastillas de freno»." />
            <Field label="N.º de la nota" value={numero} onChange={(e) => { setNumero(e.target.value); setTocoNumero(true); }} error={err.numero} hint="Lo asignamos nosotros en orden. Cámbialo solo si usas otra numeración." />
            {msg && <p className="text-[13px] text-danger">{msg}</p>}
        </Modal>
    );
}
