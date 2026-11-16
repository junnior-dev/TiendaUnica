import { Head, router } from '@inertiajs/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Boxes, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, PackageX, Plus, Scale, Search, SlidersHorizontal, TriangleAlert, Wallet, X } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi, Toast, Vacio } from '../../Components/kit';
import { Button } from '../../Components/ui';
import { dmy, hace } from '../../Components/expediente';
import { n0, n2 } from '../../lib/format';
import { http } from '../../lib/http';
import Ajuste, { u } from './Ajuste';

const TIPOS = {
    COMPRA: 'Compra', VENTA: 'Venta', ANULACION_VENTA: 'Venta anulada', ANULACION_COMPRA: 'Compra anulada', AJUSTE_ENTRADA: 'Ajuste (entra)', AJUSTE_SALIDA: 'Ajuste (sale)',
    INVENTARIO_INICIAL: 'Inventario inicial', DEVOLUCION_CLIENTE: 'Devolución de cliente',
};
const ESTADO = { bien: ['Bien', 'bg-[#e7f6ee] text-ok'], bajo: ['Stock bajo', 'bg-signal/20 text-[#7a4d00]'], agotado: ['Agotado', 'bg-[#fdecec] text-danger'] };
const Estado = ({ e }) => <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${ESTADO[e][1]}`}>{ESTADO[e][0]}</span>;
const Tipo = ({ t, cant }) => <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[12.5px] font-medium ${cant > 0 ? 'bg-[#e7f6ee] text-ok' : 'bg-paper text-[#3b4651]'}`}>{TIPOS[t] || t}</span>;
const signo = (c) => `${c > 0 ? '+' : '−'}${u(Math.abs(c))}`;
const hora = (f) => `${dmy(f.slice(0, 10))} · ${f.slice(11)}`;
const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/* Evolución del stock de un producto: escalones, con la línea del mínimo si la tiene. */
function Evolucion({ serie, minimo }) {
    const pts = serie.filter((s) => s.stock != null);
    if (pts.length < 2) return <p className="text-[13px] text-muted">Todavía hay pocos movimientos para dibujar la evolución.</p>;
    const W = 320, H = 84, max = Math.max(...pts.map((p) => p.stock), minimo, 1), y = (v) => H - 8 - (v / max) * (H - 18), x = (i) => 6 + (i / (pts.length - 1)) * (W - 12);
    let d = `M${x(0)},${y(pts[0].stock)}`; pts.forEach((p, i) => { if (i) d += ` H${x(i)} V${y(p.stock)}`; });
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label="Evolución del stock en los últimos movimientos">
            <defs><linearGradient id="ev" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1e4fd6" stopOpacity=".18" /><stop offset="1" stopColor="#1e4fd6" stopOpacity="0" /></linearGradient></defs>
            {minimo > 0 && <><line x1="0" x2={W} y1={y(minimo)} y2={y(minimo)} stroke="#c4291f" strokeDasharray="4 4" strokeWidth="1" /><text x={W - 4} y={y(minimo) - 4} textAnchor="end" fontSize="9" fill="#c4291f">mínimo</text></>}
            <path d={`${d} V${H} H${x(0)} Z`} fill="url(#ev)" /><path d={d} fill="none" stroke="#1e4fd6" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].stock)} r="3.5" fill="#1e4fd6" />
        </svg>);
}

function Ficha({ f, hoy, tasa, cargando, onAjustar, onVerTodo, onPdf, cerrar }) {
    const p = f.producto;
    const cob = f.cobertura_dias;
    return (
        <div className={cargando ? 'opacity-60 transition-opacity' : ''}>
            <div className="bg-ink px-6 pb-6 pt-5 text-white">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="num text-[13px] text-white/60">{p.sku}{p.ubicacion ? ` · ${p.ubicacion}` : ''}</p>
                        <h3 className="mt-0.5 text-[21px] font-semibold leading-tight tracking-[-0.02em]">{p.nombre}</h3>
                        <p className="mt-1 text-[13px] text-white/60">{[p.categoria, p.marca].filter(Boolean).join(' · ') || 'Sin categoría'}</p></div>
                    <button onClick={cerrar} aria-label="Cerrar ficha" className="grid size-10 shrink-0 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"><X className="size-5" /></button>
                </div>
                <div className="mt-5 flex items-end justify-between gap-4">
                    <div><p className="text-[13px] text-white/60">En existencia</p><p className="num text-[40px] font-semibold leading-none tracking-[-0.03em]">{u(p.stock)}<span className="ml-1.5 text-[15px] font-normal text-white/60">{p.unidad === 'UND' ? 'unid.' : p.unidad.toLowerCase()}</span></p></div>
                    <span className="rounded-full bg-white p-0.5"><Estado e={p.estado} /></span>
                </div>
            </div>
            <div className="space-y-6 p-6">
                <div className="grid grid-cols-3 gap-3">
                    {[['Valor a costo', `US$ ${n2(p.valor_usd)}`, tasa ? `Bs ${n2(p.valor_usd * tasa)}` : ''], ['Costo unitario', `US$ ${n2(p.costo_usd)}`, ''], ['Mínimo', p.minimo > 0 ? u(p.minimo) : 'Sin mínimo', p.minimo > 0 && p.stock <= p.minimo ? 'Toca reponer' : '']].map(([t, v, d]) => (
                        <div key={t} className="min-w-0 rounded-xl border border-line p-3"><p className="text-[12.5px] text-muted">{t}</p><p className="num mt-0.5 truncate text-[15px] font-semibold">{v}</p>{d && <p className={`num truncate text-[12px] ${d === 'Toca reponer' ? 'text-danger' : 'text-muted'}`}>{d}</p>}</div>))}
                </div>
                <div className="rounded-xl bg-brand-50 px-4 py-3.5 text-[14px] leading-snug text-[#1f2933]">
                    {f.ultimos_30.vendidas > 0
                        ? <>En los últimos 30 días vendiste <span className="num font-semibold">{u(f.ultimos_30.vendidas)}</span>. {p.stock <= 0 ? <span className="font-semibold text-danger">Ya no queda stock.</span> : cob != null && cob > 365 ? <>Al ritmo actual, te alcanza para <span className="font-semibold">más de un año</span>.</> : <>Al ritmo actual, te alcanza para unos <span className="num font-semibold">{cob}</span> {cob === 1 ? 'día' : 'días'}.</>}</>
                        : <>No se ha vendido en los últimos 30 días{p.ult_salida ? <>; la última salida fue {hace(p.ult_salida, hoy).toLowerCase()}</> : ''}.</>}
                </div>
                <div><h4 className="mb-1 text-[14px] font-semibold">Cómo ha cambiado el stock</h4><Evolucion serie={f.serie} minimo={p.minimo} />
                    <div className="mt-1 flex justify-between text-[12.5px] text-muted"><span>{f.serie[0] ? dmy(f.serie[0].fecha.slice(0, 10)) : ''}</span><span>{f.serie.length ? dmy(f.serie[f.serie.length - 1].fecha.slice(0, 10)) : ''}</span></div></div>
                <div className="flex flex-wrap gap-2">
                    <Button onClick={onAjustar}><SlidersHorizontal className="size-4" />Ajustar existencias</Button>
                    <button onClick={onPdf} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper"><FileDown className="size-4" />Kardex (PDF)</button>
                </div>
                <div>
                    <div className="mb-2 flex items-center justify-between"><h4 className="text-[14px] font-semibold">Últimos movimientos</h4>{p.movimientos_total > f.movimientos.length && <button onClick={onVerTodo} className="text-[13px] font-semibold text-brand hover:underline">Ver los {p.movimientos_total}</button>}</div>
                    <ul className="divide-y divide-line rounded-xl border border-line">
                        {f.movimientos.slice(0, 12).map((m) => (
                            <li key={m.id} className="flex items-center gap-3 px-3.5 py-2.5">
                                <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-full ${m.cantidad > 0 ? 'bg-[#e7f6ee] text-ok' : 'bg-paper text-muted'}`}>{m.cantidad > 0 ? <ArrowDownToLine className="size-4" /> : <ArrowUpFromLine className="size-4" />}</span>
                                <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{TIPOS[m.tipo] || m.tipo}{m.origen ? ` · ${m.origen}` : ''}</span><span className="block truncate text-[12.5px] text-muted">{hora(m.fecha)}{m.motivo ? ` · ${m.motivo}` : ''}</span></span>
                                <span className="shrink-0 text-right"><span className={`num block text-[14px] font-semibold ${m.cantidad > 0 ? 'text-ok' : ''}`}>{signo(m.cantidad)}</span><span className="num block text-[12.5px] text-muted">quedan {m.stock != null ? u(m.stock) : '—'}</span></span>
                            </li>))}
                    </ul>
                </div>
            </div>
        </div>);
}

const Chips = ({ valor, onChange, opciones, nombre }) => (
    <div role="radiogroup" aria-label={nombre} className="inline-flex flex-wrap rounded-lg bg-[#e9ecf0] p-1 text-[13px]">
        {opciones.map(([k, l]) => <button key={k} role="radio" aria-checked={valor === k} onClick={() => onChange(k)} className={`rounded-md px-3 py-1.5 font-medium transition-colors ${valor === k ? 'bg-white text-text shadow-sm' : 'text-muted hover:text-text'}`}>{l}</button>)}
    </div>);

export default function KardexIndex({ negocio, usuario, fecha_larga, stock_bajo, tasa_usd, vista, hoy, emisor, tasa, resumen, categorias, filtros, total, filas, periodo, pagina, por_pagina }) {
    const [q, setQ] = useState(filtros.q || '');
    const [msg, setMsg] = useState('');
    const [selId, setSelId] = useState(null); const [ficha, setFicha] = useState(null); const [cargando, setCargando] = useState(false);
    const [ajuste, setAjuste] = useState(null);       // null | {producto?}
    const [exportando, setExportando] = useState('');
    const primera = useRef(true);
    const esMov = vista === 'movimientos';

    const ir = (extra = {}) => {
        const base = esMov ? { vista, desde: filtros.desde, hasta: filtros.hasta, tipo: filtros.tipo, producto: filtros.producto, q: filtros.q }
            : { vista, q: filtros.q, estado: filtros.estado, categoria: filtros.categoria, orden: filtros.orden };
        const p = Object.fromEntries(Object.entries({ ...base, ...extra }).filter(([, v]) => v !== undefined && v !== null && v !== ''));
        router.get('/kardex', p, { preserveState: true, preserveScroll: true, replace: true });
    };
    const cambiarVista = (v) => { setQ(''); router.get('/kardex', { vista: v }, { preserveScroll: true }); };

    useEffect(() => {
        if (primera.current) { primera.current = false; return; }
        const t = setTimeout(() => { if (q.trim() !== (filtros.q || '')) ir({ q: q.trim() || undefined, pagina: undefined }); }, 300);
        return () => clearTimeout(t);
    }, [q]);

    const aviso = (t) => { setMsg(''); setTimeout(() => setMsg(t), 0); };
    const abrir = async (id) => {
        setSelId(id); setCargando(true);
        try { setFicha(await http('GET', `/kardex/producto/${id}`)); } catch (e) { setFicha(null); setSelId(null); aviso(e.message); } finally { setCargando(false); }
    };
    const cerrarFicha = () => { setSelId(null); setFicha(null); };
    useEffect(() => { const k = (e) => e.key === 'Escape' && !ajuste && cerrarFicha(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [ajuste]);

    const hecho = (r) => {
        const d = r.delta; setAjuste(null);
        aviso(`Ajuste guardado: ${signo(d)} (quedan ${u(r.stock_despues)})`);
        if (selId) setFicha(r.ficha);
        router.reload({ preserveScroll: true });
    };

    /* ─── Exportar lo que se está viendo (PDF o Excel/CSV), sin paginar ─── */
    const exportar = async (tipo, extra = null) => {
        setExportando(tipo);
        try {
            const params = new URLSearchParams(extra || Object.fromEntries(Object.entries(esMov ? { vista, desde: filtros.desde, hasta: filtros.hasta, tipo: filtros.tipo, producto: filtros.producto, q: filtros.q } : { vista, q: filtros.q, estado: filtros.estado, categoria: filtros.categoria, orden: filtros.orden }).filter(([, v]) => v)));
            const rep = await http('GET', `/kardex/reporte?${params}`);
            const lib = await import('../../lib/pdfLibro');
            const mov = rep.vista === 'movimientos';
            const columnas = mov
                ? [{ h: 'Fecha', w: 30 }, { h: 'SKU', w: 30 }, { h: 'Producto' }, { h: 'Tipo', w: 32 }, { h: 'Cantidad', a: 'right', w: 20 }, { h: 'Stock', a: 'right', w: 20 }, { h: 'Origen', w: 34 }, { h: 'Motivo', w: 44 }, { h: 'Usuario', w: 30 }]
                : [{ h: 'SKU', w: 30 }, { h: 'Producto' }, { h: 'Categoría', w: 34 }, { h: 'Ubicación', w: 24 }, { h: 'Stock', a: 'right', w: 18 }, { h: 'Mínimo', a: 'right', w: 18 }, { h: 'Costo US$', a: 'right', w: 24 }, { h: 'Valor US$', a: 'right', w: 26 }, { h: 'Valor Bs', a: 'right', w: 30 }, { h: 'Estado', w: 22 }];
            const filasX = mov
                ? rep.filas.map((m) => [m.fecha, m.sku, m.nombre, TIPOS[m.tipo] || m.tipo, signo(m.cantidad), m.stock != null ? u(m.stock) : '', m.origen || '', m.motivo || '', m.usuario || ''])
                : rep.filas.map((p) => [p.sku, p.nombre, p.categoria || '', p.ubicacion || '', u(p.stock), u(p.minimo), n2(p.costo_usd), n2(p.valor_usd), n2(p.valor_usd * rep.tasa), ESTADO[p.estado][0]]);
            const totales = mov ? null : ['', 'Total del inventario filtrado', '', '', '', '', '', n2(rep.filas.reduce((s, p) => s + p.valor_usd, 0)), n2(rep.filas.reduce((s, p) => s + p.valor_usd * rep.tasa, 0)), ''];
            const nombre = mov ? `kardex-${hoy}` : `existencias-${hoy}`;
            if (tipo === 'csv') return lib.csv(`${nombre}.csv`, columnas, filasX, totales);
            const per = mov ? `${dmy(rep.filtros.desde)} al ${dmy(rep.filtros.hasta)}` : `al ${dmy(hoy)}`;
            const doc = await lib.construirPdfLibro({ emisor, titulo: mov ? 'Kardex de inventario' : 'Existencias valoradas', periodo: per, columnas, filas: filasX, totales, unidad: 'Cantidades en unidades; valores a costo en dólares (US$) y bolívares (Bs) a la tasa de hoy',
                notas: mov ? ['Cada fila es un movimiento: las entradas suman y las salidas restan; «Stock» es lo que quedó después de cada uno.'] : ['Valor a costo = existencia × costo unitario en dólares. Los productos desactivados no se incluyen.'] });
            doc.save(`${nombre}.pdf`);
        } catch { aviso('No se pudo preparar el archivo. Inténtalo de nuevo.'); } finally { setExportando(''); }
    };

    const periodos = useMemo(() => [['hoy', 'Hoy', hoy, hoy], ['7', '7 días', sumarDias(hoy, -6), hoy], ['30', '30 días', sumarDias(hoy, -29), hoy], ['mes', 'Este mes', `${hoy.slice(0, 8)}01`, hoy]], [hoy]);
    const periodoActual = esMov ? (periodos.find(([, , d, h]) => d === filtros.desde && h === filtros.hasta)?.[0] || 'otro') : null;
    const desde = (pagina - 1) * por_pagina + 1, hasta = Math.min(pagina * por_pagina, total);
    const hayFiltro = esMov ? !!(filtros.q || filtros.tipo !== 'todos' || filtros.producto) : !!(filtros.q || filtros.estado !== 'todos' || filtros.categoria);
    const valorBs = resumen.valor_costo_usd * tasa;

    return (
        <AppLayout actual="/kardex" titulo="Existencias y kardex" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Existencias y kardex" />
            <Toast texto={msg} />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Existencias y kardex</h2><p className="mt-1 max-w-[64ch] text-[15px] text-muted">Qué tienes, cuánto vale y cómo se ha movido. Abre un producto para ver su historial y para cuántos días te alcanza.</p></div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={() => exportar('pdf')} disabled={!total || !!exportando} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper disabled:opacity-50"><FileDown className="size-4" />{exportando === 'pdf' ? 'Preparando…' : 'PDF'}</button>
                    <button onClick={() => exportar('csv')} disabled={!total || !!exportando} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper disabled:opacity-50"><FileSpreadsheet className="size-4" />Excel (CSV)</button>
                    <Button onClick={() => setAjuste({})}><Plus className="size-4" />Ajustar existencias</Button>
                </div>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Kpi icon={Wallet} titulo="Valor del inventario" valor={`US$ ${n0(resumen.valor_costo_usd)}`} detalle={`Bs ${n0(valorBs)} a costo`} />
                <Kpi icon={Boxes} titulo="Unidades en existencia" valor={u(resumen.unidades)} detalle={`En ${resumen.con_stock} de ${resumen.total} productos`} />
                <Kpi icon={TriangleAlert} tono={resumen.bajo ? 'warn' : undefined} titulo="Stock bajo" valor={n0(resumen.bajo)} activo={!esMov && filtros.estado === 'bajo'}
                    onClick={resumen.bajo || filtros.estado === 'bajo' ? () => (esMov ? router.get('/kardex', { vista: 'existencias', estado: 'bajo' }) : ir({ estado: filtros.estado === 'bajo' ? 'todos' : 'bajo', pagina: undefined })) : undefined}
                    detalle={resumen.bajo ? 'Bajo su mínimo. Toca para verlos' : 'Nada por reponer'} />
                <Kpi icon={PackageX} tono={resumen.agotados ? 'bad' : undefined} titulo="Agotados" valor={n0(resumen.agotados)} activo={!esMov && filtros.estado === 'agotado'}
                    onClick={resumen.agotados || filtros.estado === 'agotado' ? () => (esMov ? router.get('/kardex', { vista: 'existencias', estado: 'agotado' }) : ir({ estado: filtros.estado === 'agotado' ? 'todos' : 'agotado', pagina: undefined })) : undefined}
                    detalle={resumen.agotados ? 'Sin unidades. Toca para verlos' : 'Todo tiene existencia'} />
            </div>

            <Card>
                <div className="space-y-3 border-b border-line p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <Chips nombre="Vista" valor={vista} onChange={cambiarVista} opciones={[['existencias', 'Existencias'], ['movimientos', 'Movimientos (kardex)']]} />
                        {esMov ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <Chips nombre="Período" valor={periodoActual} onChange={(k) => { const p = periodos.find((x) => x[0] === k); if (p) ir({ desde: p[2], hasta: p[3], pagina: undefined }); }} opciones={[...periodos.map(([k, l]) => [k, l]), ...(periodoActual === 'otro' ? [['otro', 'Otro']] : [])]} />
                                <label className="flex items-center gap-1.5 text-[13px] text-muted">Del<input type="date" value={filtros.desde} max={filtros.hasta} onChange={(e) => e.target.value && ir({ desde: e.target.value, pagina: undefined })} className="num h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-text focus:border-brand focus:outline-none" /></label>
                                <label className="flex items-center gap-1.5 text-[13px] text-muted">al<input type="date" value={filtros.hasta} min={filtros.desde} onChange={(e) => e.target.value && ir({ hasta: e.target.value, pagina: undefined })} className="num h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-text focus:border-brand focus:outline-none" /></label>
                            </div>
                        ) : (
                            <Chips nombre="Estado" valor={filtros.estado} onChange={(k) => ir({ estado: k, pagina: undefined })} opciones={[['todos', 'Todos'], ['con_stock', 'Con stock'], ['bajo', 'Stock bajo'], ['agotado', 'Agotados']]} />
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <label className="relative block min-w-[240px] flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Buscar" placeholder={esMov ? 'Buscar por producto, SKU o motivo' : 'Buscar por nombre, SKU, código de barras o ubicación'} className="h-11 w-full rounded-lg border border-line bg-paper pl-10 pr-3 text-[15px] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" /></label>
                        {esMov ? (
                            <>
                                <Chips nombre="Tipo" valor={['todos', 'entradas', 'salidas'].includes(filtros.tipo) ? filtros.tipo : 'otro'} onChange={(k) => ir({ tipo: k, pagina: undefined })} opciones={[['todos', 'Todo'], ['entradas', 'Entradas'], ['salidas', 'Salidas']]} />
                                <select aria-label="Tipo exacto" value={filtros.tipo} onChange={(e) => ir({ tipo: e.target.value, pagina: undefined })} className="h-10 rounded-lg border border-line bg-white px-2 text-[13px] focus:border-brand focus:outline-none">
                                    <option value="todos">Todos los tipos</option><option value="entradas">Solo entradas</option><option value="salidas">Solo salidas</option>
                                    {Object.entries(TIPOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                            </>
                        ) : (
                            <>
                                <select aria-label="Categoría" value={filtros.categoria || ''} onChange={(e) => ir({ categoria: e.target.value || undefined, pagina: undefined })} className="h-11 rounded-lg border border-line bg-white px-3 text-[14px] focus:border-brand focus:outline-none">
                                    <option value="">Todas las categorías</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
                                <label className="flex items-center gap-1.5 text-[13px] text-muted">Orden
                                    <select value={filtros.orden} onChange={(e) => ir({ orden: e.target.value, pagina: undefined })} className="h-11 rounded-lg border border-line bg-white px-2 text-[14px] text-text focus:border-brand focus:outline-none">
                                        <option value="nombre">Nombre</option><option value="stock">Menos stock primero</option><option value="faltante">Más urgente de reponer</option><option value="valor">Mayor valor</option></select></label>
                            </>
                        )}
                    </div>
                    {esMov && filtros.producto && (
                        <p className="flex items-center gap-2 text-[13.5px]"><span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 font-medium text-brand">{filtros.producto_nombre}<button onClick={() => ir({ producto: undefined, pagina: undefined })} aria-label="Quitar el filtro de producto"><X className="size-3.5" /></button></span></p>)}
                </div>

                {esMov && (
                    <div className="grid grid-cols-2 gap-px border-b border-line bg-line text-[14px] sm:grid-cols-4">
                        {[['Entradas', `+${u(periodo.entradas)}`, 'text-ok'], ['Salidas', `−${u(periodo.salidas)}`, ''], ['Neto', `${periodo.neto > 0 ? '+' : periodo.neto < 0 ? '−' : ''}${u(Math.abs(periodo.neto))}`, ''], ['Movimientos', n0(total), '']].map(([t, v, c]) => (
                            <div key={t} className="bg-white px-4 py-3"><p className="text-[12.5px] text-muted">{t} en el período</p><p className={`num text-[19px] font-semibold ${c}`}>{v}</p></div>))}
                    </div>)}

                {filas.length === 0 ? (
                    <Vacio icon={esMov ? Scale : Boxes} titulo={hayFiltro ? 'Nada coincide con lo que buscas' : esMov ? 'Sin movimientos en este período' : 'Aún no hay productos'}
                        texto={hayFiltro ? 'Prueba con otro nombre o quita algún filtro.' : esMov ? 'Cambia el período para ver otros movimientos.' : 'Cuando registres productos y compras, aquí verás sus existencias.'}>
                        {hayFiltro && <button onClick={() => { setQ(''); router.get('/kardex', { vista }); }} className="inline-flex h-11 items-center rounded-lg border border-line px-5 text-[15px] font-semibold hover:bg-paper">Quitar filtros</button>}
                    </Vacio>
                ) : (
                    <div className="overflow-x-auto">
                        {esMov ? (
                            <table className="w-full min-w-[860px] text-[14px]">
                                <thead className="text-left text-[12.5px] text-muted"><tr className="border-b border-line"><th className="px-4 py-2.5 font-medium">Fecha</th><th className="px-2 py-2.5 font-medium">Producto</th><th className="px-2 py-2.5 font-medium">Movimiento</th><th className="px-2 py-2.5 text-right font-medium">Cantidad</th><th className="px-2 py-2.5 text-right font-medium">Quedó en</th><th className="px-2 py-2.5 font-medium">Detalle</th><th className="px-4 py-2.5 font-medium">Usuario</th></tr></thead>
                                <tbody className="divide-y divide-line">
                                    {filas.map((m) => (
                                        <tr key={m.id} className="hover:bg-paper/70">
                                            <td className="num whitespace-nowrap px-4 py-3 text-muted">{hora(m.fecha)}</td>
                                            <td className="max-w-[260px] px-2 py-3"><button onClick={() => abrir(m.producto_id)} className="block max-w-full truncate text-left font-medium hover:text-brand hover:underline">{m.nombre}</button><span className="num text-[12.5px] text-muted">{m.sku}</span></td>
                                            <td className="px-2 py-3"><Tipo t={m.tipo} cant={m.cantidad} /></td>
                                            <td className={`num whitespace-nowrap px-2 py-3 text-right font-semibold ${m.cantidad > 0 ? 'text-ok' : ''}`}>{signo(m.cantidad)}</td>
                                            <td className="num px-2 py-3 text-right text-muted">{m.stock != null ? u(m.stock) : '—'}</td>
                                            <td className="max-w-[220px] px-2 py-3 text-[13px] text-muted"><span className="block truncate" title={[m.origen, m.motivo].filter(Boolean).join(' · ')}>{[m.origen, m.motivo].filter(Boolean).join(' · ') || '—'}</span></td>
                                            <td className="max-w-[130px] px-4 py-3 text-[13px] text-muted"><span className="block truncate">{m.usuario || 'Sistema'}</span></td>
                                        </tr>))}
                                </tbody>
                            </table>
                        ) : (
                            <table className="w-full min-w-[860px] text-[14px]">
                                <thead className="text-left text-[12.5px] text-muted"><tr className="border-b border-line"><th className="px-4 py-2.5 font-medium">Producto</th><th className="px-2 py-2.5 font-medium">Estado</th><th className="px-2 py-2.5 font-medium">Existencia</th><th className="px-2 py-2.5 text-right font-medium">Costo</th><th className="px-2 py-2.5 text-right font-medium">Valor a costo</th><th className="px-4 py-2.5 font-medium">Última salida</th></tr></thead>
                                <tbody className="divide-y divide-line">
                                    {filas.map((p) => {
                                        const esc = p.minimo > 0 ? Math.max(p.minimo * 2, p.stock) : 0;
                                        return (
                                            <tr key={p.id} onClick={() => abrir(p.id)} className={`cursor-pointer hover:bg-paper/70 ${selId === p.id ? 'bg-brand-50/60' : ''}`}>
                                                <td className="max-w-[320px] px-4 py-3"><button className="block max-w-full truncate text-left font-medium hover:text-brand">{p.nombre}</button><span className="num text-[12.5px] text-muted">{p.sku}{p.ubicacion ? ` · ${p.ubicacion}` : ''}{p.categoria ? ` · ${p.categoria}` : ''}</span></td>
                                                <td className="px-2 py-3"><Estado e={p.estado} /></td>
                                                <td className="min-w-[150px] px-2 py-3"><span className="num font-semibold">{u(p.stock)}</span>{p.minimo > 0 && <span className="num text-[12.5px] text-muted"> / mín. {u(p.minimo)}</span>}
                                                    {esc > 0 && <span className="mt-1.5 block h-1.5 w-full max-w-[140px] overflow-hidden rounded-full bg-[#e9ecf0]"><span className={`block h-full rounded-full ${p.estado === 'bien' ? 'bg-ok' : p.estado === 'bajo' ? 'bg-signal' : 'bg-danger'}`} style={{ width: `${Math.max(Math.min((p.stock / esc) * 100, 100), p.stock > 0 ? 4 : 0)}%` }} /></span>}</td>
                                                <td className="num px-2 py-3 text-right text-muted">US$ {n2(p.costo_usd)}</td>
                                                <td className="num px-2 py-3 text-right font-semibold">US$ {n2(p.valor_usd)}<span className="block text-[12.5px] font-normal text-muted">Bs {n0(p.valor_usd * tasa)}</span></td>
                                                <td className="whitespace-nowrap px-4 py-3 text-[13px] text-muted">{p.ult_salida ? hace(p.ult_salida, hoy) : 'Sin salidas'}</td>
                                            </tr>);
                                    })}
                                </tbody>
                            </table>)}
                    </div>)}

                {total > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-muted">
                        <span>{desde}–{hasta} de {n0(total)} {esMov ? (total === 1 ? 'movimiento' : 'movimientos') : (total === 1 ? 'producto' : 'productos')}{filtros.q && ` para «${filtros.q}»`}</span>
                        <div className="flex items-center gap-1.5">
                            <button disabled={pagina <= 1} onClick={() => ir({ pagina: pagina - 1 })} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-white px-3 font-medium text-text hover:bg-paper disabled:opacity-40"><ChevronLeft className="size-4" />Anterior</button>
                            <button disabled={hasta >= total} onClick={() => ir({ pagina: pagina + 1 })} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-white px-3 font-medium text-text hover:bg-paper disabled:opacity-40">Siguiente<ChevronRight className="size-4" /></button>
                        </div>
                    </div>)}
            </Card>

            {selId && (
                <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-label="Ficha del producto">
                    <button aria-label="Cerrar ficha" onClick={cerrarFicha} className="absolute inset-0 bg-ink/40" />
                    <aside className="relative h-full w-full max-w-[540px] overflow-y-auto bg-white shadow-2xl">
                        {ficha ? <Ficha f={ficha} hoy={hoy} tasa={tasa} cargando={cargando} cerrar={cerrarFicha}
                            onAjustar={() => setAjuste({ producto: { id: ficha.producto.id, nombre: ficha.producto.nombre, sku: ficha.producto.sku, unidad: ficha.producto.unidad, stock: ficha.producto.stock, costo_usd: ficha.producto.costo_usd } })}
                            onVerTodo={() => { cerrarFicha(); router.get('/kardex', { vista: 'movimientos', producto: ficha.producto.id, desde: '2000-01-01', hasta: hoy }); }}
                            onPdf={() => exportar('pdf', new URLSearchParams({ vista: 'movimientos', producto: ficha.producto.id, desde: '2000-01-01', hasta: hoy }))} />
                            : <div className="grid h-full place-items-center text-[14px] text-muted" role="status">Abriendo ficha…</div>}
                    </aside>
                </div>)}

            {ajuste && <Ajuste producto={ajuste.producto} tasa={tasa} cerrar={() => setAjuste(null)} hecho={hecho} />}
        </AppLayout>
    );
}
