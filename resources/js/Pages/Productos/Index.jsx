import { Head, router } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Barcode, Bike, Check, ChevronLeft, ChevronRight, CircleDollarSign, Hash, MapPin, Package, PackageX, Plus, Search, Tag, TrendingUp, X } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi } from '../../Components/kit';
import { Button } from '../../Components/ui';
import EtiquetasModal from './EtiquetasModal';
import ProductoPanel from './ProductoPanel';
import { n0, n2, usd } from '../../lib/format';

const ESTADOS = [['todos', 'Todos'], ['bajo', 'Stock bajo'], ['sin_stock', 'Sin stock'], ['por_confirmar', 'Precio por confirmar'], ['inactivos', 'Inactivos']];

/* Barra de existencias: la raya marca el mínimo; el color dice si hay que reponer. */
function Existencia({ stock, minimo }) {
    const sin = stock <= 0, bajo = stock <= minimo;
    const max = Math.max(minimo * 2, stock, 1), w = Math.min(100, (stock / max) * 100), m = (minimo / max) * 100;
    return (
        <div className="w-[132px]">
            <p className="num flex items-baseline gap-1 text-sm"><span className={`font-semibold ${sin ? 'text-danger' : bajo ? 'text-[#a86a00]' : ''}`}>{n0(stock)}</span><span className="text-xs text-muted">/ mín. {n0(minimo)}</span></p>
            <div className="relative mt-1.5 h-1.5 rounded-full bg-[#e4e8ed]" role="img" aria-label={sin ? 'Sin existencias' : bajo ? 'Por debajo del mínimo' : 'Existencias suficientes'}>
                <span className={`absolute inset-y-0 left-0 rounded-full ${sin ? 'bg-danger' : bajo ? 'bg-signal' : 'bg-ok'}`} style={{ width: `${w}%` }} />
                <span className="absolute -top-0.5 h-2.5 w-0.5 bg-ink/60" style={{ left: `${m}%` }} />
            </div>
            <p className={`mt-1 text-xs ${sin ? 'text-danger' : bajo ? 'text-[#a86a00]' : 'text-muted'}`}>{sin ? 'Agotado' : bajo ? 'Por reponer' : 'Disponible'}</p>
        </div>
    );
}

/* Precios por confirmar (política AVISAR): el sistema propone, el dueño decide. */
function Avisos({ alertas }) {
    const [abierto, setAbierto] = useState(false);
    if (!alertas.length) return null;
    const resolver = (id, accion) => router.post(`/alertas-precio/${id}`, { accion }, { preserveScroll: true });
    return (
        <Card className="mb-6 overflow-hidden border-[#f0d9a0] bg-[#fffaf0]">
            <div className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-signal/20 text-[#8a5a00]"><TrendingUp className="size-[18px]" /></span>
                <div className="min-w-[220px] flex-1">
                    <p className="text-[15px] font-semibold">{alertas.length} {alertas.length === 1 ? 'producto llegó' : 'productos llegaron'} con un costo distinto</p>
                    <p className="text-[13px] text-muted">Tu precio de venta sigue igual hasta que lo confirmes. Revisa el precio que sugiere el sistema.</p>
                </div>
                <button onClick={() => setAbierto(!abierto)} className="rounded-lg px-3 py-2 text-sm font-medium text-[#8a5a00] hover:bg-signal/15">{abierto ? 'Ocultar' : 'Revisar'}</button>
                <Button onClick={() => router.post('/alertas-precio/aplicar-todas', {}, { preserveScroll: true })}><Check className="size-4" />Aceptar todos</Button>
            </div>
            {abierto && (
                <ul className="border-t border-[#f0d9a0] bg-white">
                    {alertas.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-4 py-3 first:border-t-0 sm:px-5">
                            <div className="min-w-[200px] flex-1"><p className="text-sm font-medium">{a.nombre}</p><p className="text-xs text-muted">{a.sku} · costo nuevo {usd(a.costo)}</p></div>
                            <p className="num flex items-center gap-2 text-sm"><span className="text-muted line-through">{usd(a.precio_actual)}</span><ArrowRight className="size-3.5 text-muted" /><span className="font-semibold">{usd(a.precio_sugerido)}</span><span className="rounded-full bg-[#fdecec] px-2 py-0.5 text-xs font-medium text-danger">+{n2(a.variacion_pct)} %</span></p>
                            <div className="flex gap-2"><button onClick={() => resolver(a.id, 'DESCARTAR')} className="h-9 rounded-lg px-3 text-sm font-medium text-muted hover:bg-paper">Dejar igual</button><button onClick={() => resolver(a.id, 'APLICAR')} className="h-9 rounded-lg border border-line px-3 text-sm font-semibold hover:bg-paper">Aplicar</button></div>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}

export default function Productos({ negocio, usuario, fecha_larga, stock_bajo, tasa_usd, iva_pct, margen_defecto, kpis, catalogo, filtros, filas, meta, alertas }) {
    const [q, setQ] = useState(filtros.q ?? '');
    const [panel, setPanel] = useState(null);
    const [etiquetas, setEtiquetas] = useState(false);
    const primera = useRef(true);
    const ir = (cambios) => router.get('/productos', { ...filtros, pagina: 1, ...cambios }, { preserveState: true, preserveScroll: true, replace: true });
    useEffect(() => { // busca mientras escribe, sin disparar una consulta por cada letra
        if (primera.current) { primera.current = false; return; }
        const t = setTimeout(() => ir({ q: q || undefined }), 280);
        return () => clearTimeout(t);
    }, [q]);
    const hayFiltros = filtros.q || filtros.categoria || filtros.marca || filtros.moto || (filtros.estado && filtros.estado !== 'todos');
    const estado = filtros.estado ?? 'todos';
    const motoSel = catalogo.motos.find((m) => String(m.id) === String(filtros.moto));
    const Sel = ({ valor, onChange, titulo, opciones, ancho = '' }) => (
        <select value={valor ?? ''} onChange={(e) => onChange(e.target.value || undefined)} aria-label={titulo} className={`h-10 rounded-lg border border-line bg-white px-3 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand ${valor ? 'font-medium text-brand' : 'text-muted'} ${ancho}`}>
            <option value="">{titulo}</option>{opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
    );

    return (
        <AppLayout actual="/productos" titulo="Productos" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo} alertas={stock_bajo + alertas.length}>
            <Head title="Productos" />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Productos</h2><p className="mt-1 max-w-[62ch] text-[15px] text-muted">Tu catálogo de repuestos con existencias, precios en dólares y en bolívares, y las motos a las que sirve cada pieza.</p></div>
                <div className="flex flex-wrap gap-3">
                    <Button variant="ghost" onClick={() => setEtiquetas(true)}><Barcode className="size-4" />Etiquetas con código</Button>
                    <Button onClick={() => setPanel({ nuevo: true })}><Plus className="size-4" />Nuevo producto</Button>
                </div>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Kpi icon={Package} titulo="Productos activos" valor={n0(kpis.activos)} detalle="En tu catálogo de venta" />
                <Kpi icon={CircleDollarSign} titulo="Inventario a precio de venta" valor={usd(kpis.valor_venta)} detalle={`A costo: ${usd(kpis.valor_costo)}`} />
                <Kpi icon={AlertTriangle} tono="warn" titulo="Por reponer" valor={n0(kpis.stock_bajo)} detalle={kpis.sin_stock ? `${kpis.sin_stock} agotado${kpis.sin_stock > 1 ? 's' : ''}` : 'Ninguno agotado'} onClick={() => ir({ estado: 'bajo' })} activo={estado === 'bajo'} />
                <Kpi icon={Tag} tono={kpis.precios_pendientes ? 'bad' : undefined} titulo="Precios por confirmar" valor={n0(kpis.precios_pendientes)} detalle={kpis.precios_pendientes ? 'Cambió el costo de compra' : 'Todo al día'} onClick={() => ir({ estado: 'por_confirmar' })} activo={estado === 'por_confirmar'} />
            </div>

            <Avisos alertas={alertas} />

            <Card>
                <div className="space-y-3 border-b border-line p-4 sm:p-5">
                    <label className="relative block">
                        <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Buscar productos" placeholder="Busca por nombre, SKU, código de barras o moto: «pastillas bera sbr»"
                            className="h-12 w-full rounded-xl border border-line bg-paper pl-11 pr-4 text-[15px] placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" />
                    </label>
                    <div className="flex flex-wrap items-center gap-2.5">
                        <div role="radiogroup" aria-label="Estado" className="inline-flex max-w-full overflow-x-auto rounded-lg bg-[#e9ecf0] p-1 text-[13px]">
                            {ESTADOS.map(([k, l]) => <button key={k} role="radio" aria-checked={estado === k} onClick={() => ir({ estado: k === 'todos' ? undefined : k })} className={`whitespace-nowrap rounded-md px-3 py-1.5 font-medium ${estado === k ? 'bg-white shadow-sm' : 'text-muted hover:text-text'}`}>{l}</button>)}
                        </div>
                        <Sel valor={filtros.categoria} onChange={(v) => ir({ categoria: v })} titulo="Categoría" opciones={catalogo.categorias.map((c) => [c.id, c.nombre])} />
                        <Sel valor={filtros.marca} onChange={(v) => ir({ marca: v })} titulo="Marca" opciones={catalogo.marcas.map((c) => [c.id, c.nombre])} />
                        <Sel valor={filtros.moto} onChange={(v) => ir({ moto: v })} titulo="Sirve para la moto…" opciones={catalogo.motos.map((c) => [c.id, c.etiqueta])} ancho="min-w-[190px]" />
                        {hayFiltros && <button onClick={() => { setQ(''); router.get('/productos', {}, { preserveState: true, replace: true }); }} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-brand hover:bg-brand-50"><X className="size-4" />Quitar filtros</button>}
                    </div>
                    {motoSel && <p className="flex items-center gap-2 text-[13px] text-muted"><Bike className="size-4" />Mostrando solo repuestos que le sirven a la <strong className="font-medium text-text">{motoSel.etiqueta}</strong>.</p>}
                </div>

                {filas.length === 0 ? (
                    <div className="grid place-items-center px-6 py-16 text-center">
                        <span className="grid size-12 place-items-center rounded-full bg-paper text-muted"><PackageX className="size-6" /></span>
                        <p className="mt-4 text-[15px] font-semibold">No encontramos productos con esa búsqueda</p>
                        <p className="mt-1 max-w-[44ch] text-sm text-muted">Prueba con menos palabras o quita algún filtro. Si la pieza no está en el catálogo, puedes crearla ahora.</p>
                        <div className="mt-5 flex gap-3"><Button variant="ghost" onClick={() => { setQ(''); router.get('/productos', {}, { preserveState: true, replace: true }); }}>Quitar filtros</Button><Button onClick={() => setPanel({ nuevo: true })}><Plus className="size-4" />Nuevo producto</Button></div>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[920px] text-sm">
                            <thead><tr className="text-left text-[13px] text-muted">
                                <th className="px-5 py-3 font-medium">Producto</th><th className="px-3 py-3 font-medium">Existencias</th><th className="px-3 py-3 text-right font-medium">Costo</th>
                                <th className="px-3 py-3 text-right font-medium">Margen</th><th className="px-3 py-3 text-right font-medium">Precio US$</th><th className="px-5 py-3 text-right font-medium">Precio Bs</th>
                            </tr></thead>
                            <tbody>
                                {filas.map((p) => (
                                    <tr key={p.id} onClick={() => setPanel({ id: p.id })} className="cursor-pointer border-t border-line hover:bg-paper/70">
                                        <td className="px-5 py-3.5">
                                            <button className="text-left" onClick={(e) => { e.stopPropagation(); setPanel({ id: p.id }); }}>
                                                <span className={`block max-w-[340px] font-medium ${p.activo ? '' : 'text-muted line-through'}`}>{p.nombre}</span>
                                            </button>
                                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted">
                                                <span className="inline-flex items-center gap-1"><Hash className="size-3" />{p.sku}</span><span>{p.categoria}{p.marca ? ` · ${p.marca}` : ''}</span>
                                                {p.ubicacion && <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{p.ubicacion}</span>}
                                                <span className="inline-flex items-center gap-1"><Bike className="size-3" />{p.motos ? `${p.motos} ${p.motos === 1 ? 'moto' : 'motos'}` : 'Universal'}</span>
                                            </p>
                                        </td>
                                        <td className="px-3 py-3.5"><Existencia stock={p.stock} minimo={p.minimo} /></td>
                                        <td className="num px-3 py-3.5 text-right text-muted">{usd(p.costo)}</td>
                                        <td className="num px-3 py-3.5 text-right text-muted">{n0(p.margen)} %</td>
                                        <td className="px-3 py-3.5 text-right"><span className="num font-semibold">{usd(p.precio)}</span>{p.por_confirmar && <span className="ml-2 inline-block rounded-full bg-signal/20 px-2 py-0.5 text-[11px] font-semibold text-[#8a5a00]">Por confirmar</span>}</td>
                                        <td className="num px-5 py-3.5 text-right">Bs {n2(p.precio_ves)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {meta.total > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-muted">
                        <p>Mostrando {meta.desde}–{meta.hasta} de {meta.total} productos · precios en bolívares a Bs {n2(tasa_usd)} por dólar</p>
                        {meta.paginas > 1 && (
                            <div className="flex items-center gap-1">
                                <button disabled={meta.pagina <= 1} onClick={() => ir({ pagina: meta.pagina - 1 })} aria-label="Página anterior" className="grid size-9 place-items-center rounded-lg border border-line enabled:hover:bg-paper disabled:opacity-40"><ChevronLeft className="size-4" /></button>
                                <span className="px-2">Página {meta.pagina} de {meta.paginas}</span>
                                <button disabled={meta.pagina >= meta.paginas} onClick={() => ir({ pagina: meta.pagina + 1 })} aria-label="Página siguiente" className="grid size-9 place-items-center rounded-lg border border-line enabled:hover:bg-paper disabled:opacity-40"><ChevronRight className="size-4" /></button>
                            </div>
                        )}
                    </div>
                )}
            </Card>

            {etiquetas && <EtiquetasModal filas={filas} cerrar={() => setEtiquetas(false)} />}
            {panel && <ProductoPanel key={panel.id ?? 'nuevo'} id={panel.id} catalogo={catalogo} tasa={tasa_usd} iva={iva_pct} margenNegocio={margen_defecto} cerrar={() => setPanel(null)} />}
        </AppLayout>
    );
}
