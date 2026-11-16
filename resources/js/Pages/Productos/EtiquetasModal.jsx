import { useState } from 'react';
import { Barcode, Download, Loader2, Plus, Printer, Search, Trash2, X } from 'lucide-react';
import BarcodeSvg from '../../Components/Barcode';
import { Switch, Toast } from '../../Components/kit';
import { Field, Segmented } from '../../Components/ui';
import { http } from '../../lib/http';
import { n2 } from '../../lib/format';

/**
 * Generador de etiquetas con código de barras (desde la página Productos).
 * Los códigos EAN-13 internos los asigna el backend (app/Support/Ean13.php, rango 200–299);
 * lo impreso se escanea directo en el POS porque /caja/buscar ya busca por codigo_barras exacto.
 */
const MAX_ETIQUETAS = 500;

const eanDe = (p) => (p.barras && /^\d{13}$/.test(p.barras) ? p.barras : null);

export default function EtiquetasModal({ filas, cerrar }) {
    const [q, setQ] = useState('');
    const [res, setRes] = useState([]);
    const [sel, setSel] = useState([]);            // {id, nombre, sku, marca, ean, precio_ves, precio_usd, cantidad}
    const [o, setO] = useState({ formato: 'carta', precioBs: true, precioUsd: false, mostrarMarca: true });
    const [msg, setMsg] = useState('');
    const [env, setEnv] = useState(false);
    const avisar = (t) => { setMsg(''); setTimeout(() => setMsg(t), 30); };

    const total = sel.reduce((s, p) => s + p.cantidad, 0);

    /* Búsqueda con el mismo endpoint del POS y de Encargos: devuelve precio final y barras. */
    const buscar = (texto) => {
        const t = texto.trim();
        setQ(texto);
        if (t.length < 2) { setRes([]); return; }
        clearTimeout(buscar._t);
        buscar._t = setTimeout(async () => {
            try { setRes(await http('GET', `/caja/buscar?q=${encodeURIComponent(t)}`)); } catch { setRes([]); }
        }, 250);
    };

    const yaEsta = (id) => sel.some((p) => p.id === id);
    const agregar = (p) => {
        if (yaEsta(p.id)) return;
        setSel((s) => [...s, { id: p.id, nombre: p.nombre, sku: p.sku, marca: p.marca || '', barras: p.barras || '', ean: eanDe(p),
            precio_ves: p.final_ves ?? 0, precio_usd: p.final_usd ?? 0, cantidad: 1 }]);
    };

    /* Trae del backend las filas de la página actual (ean, precio final) y las agrega. */
    const agregarPagina = async () => {
        const ids = filas.filter((f) => f.activo).map((f) => f.id).filter((id) => !yaEsta(id));
        if (!ids.length) { avisar('Los productos de esta página ya están en la lista.'); return; }
        try {
            const r = await http('POST', '/productos/etiquetas', { ids });
            setSel((s) => [...s, ...r.productos.map((p) => ({ ...p, barras: p.barras || '', cantidad: 1 }))]);
            avisar(`${r.productos.length} productos de la página agregados.`);
        } catch (e) { avisar(e.message); }
    };

    /* Asigna EAN-13 interno (2000000000xx) a los seleccionados sin código y refresca la lista. */
    const asignar = async () => {
        const ids = sel.filter((p) => !p.ean).map((p) => p.id);
        if (!ids.length) { avisar('Ninguno necesita código: los seleccionados ya tienen EAN válido.'); return; }
        setEnv(true);
        try {
            const r = await http('POST', '/productos/barcodes', { ids });
            setSel((s) => s.map((p) => { const x = r.productos.find((n) => n.id === p.id); return x ? { ...p, barras: x.barras, ean: x.ean, precio_ves: x.precio_ves, precio_usd: x.precio_usd } : p; }));
            avisar(`${r.asignados} ${r.asignados === 1 ? 'código asignado' : 'códigos asignados'} (EAN-13 interno, único por producto).`);
        } catch (e) { avisar(e.message); }
        setEnv(false);
    };

    const conEan = sel.filter((p) => p.ean);
    const sinEan = sel.length - conEan.length;

    const generar = async (descargar) => {
        if (!total) return;
        setEnv(true);
        try {
            const items = sel.flatMap((p) => Array.from({ length: p.cantidad }, () => ({ nombre: p.nombre, sku: p.sku, marca: p.marca, ean: p.ean, precio_ves: p.precio_ves, precio_usd: p.precio_usd })));
            const { construirPdfEtiquetas } = await import('../../lib/pdfEtiquetas');
            const { abrirPdf } = await import('../../lib/pdfVenta');
            abrirPdf(await construirPdfEtiquetas(items, o), { imprimir: !descargar, descargar, nombre: `etiquetas-${o.formato}.pdf` });
        } catch (e) { avisar(e.message); }
        setEnv(false);
    };

    const previsual = sel.slice(0, 12);

    return (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Generador de etiquetas">
            <div className="absolute inset-0 bg-black/40" onClick={cerrar} />
            <aside className="absolute inset-y-0 right-0 flex w-[760px] max-w-full flex-col bg-white shadow-2xl">
                <header className="flex items-start justify-between gap-3 border-b border-line px-6 pb-4 pt-5">
                    <div><h2 className="text-lg font-semibold tracking-[-0.01em]">Etiquetas con código de barras</h2>
                        <p className="mt-1 text-[13px] text-muted">Imprime pegatinas con el EAN-13 del producto y escanéalas directo en el punto de venta.</p></div>
                    <button type="button" onClick={cerrar} aria-label="Cerrar" className="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-paper"><X className="size-5" /></button>
                </header>
                <Toast texto={msg} />

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                    <label className="relative block">
                        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                        <input value={q} onChange={(e) => buscar(e.target.value)} type="search" aria-label="Buscar productos para etiquetas"
                            placeholder="Busca y haz clic para agregar: nombre, SKU o código de barras"
                            className="h-11 w-full rounded-lg border border-line bg-paper pl-10 pr-3 text-[14px] placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" />
                    </label>
                    {q.trim().length >= 2 && res.length > 0 && (
                        <ul className="max-h-[190px] overflow-y-auto rounded-xl border border-line">
                            {res.map((p) => (
                                <li key={p.id} className="border-b border-line last:border-0">
                                    <button type="button" onClick={() => { agregar(p); setQ(''); setRes([]); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-brand-50">
                                        <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{p.nombre}</span>
                                            <span className="num block text-[12px] text-muted">{p.sku}{p.barras ? ` · ${p.barras}` : ' · sin código de barras'}</span></span>
                                        <Plus className="size-4 shrink-0 text-brand" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={agregarPagina} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-paper"><Plus className="size-4" />Agregar los productos de esta página</button>
                        <button type="button" onClick={asignar} disabled={env || sinEan === 0} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-40">{env ? <Loader2 className="size-4 animate-spin" /> : <Barcode className="size-4" />}Asignar códigos automáticos</button>
                        <p className="text-[12.5px] text-muted">Los internos salen en el rango EAN-13 200–299, único por producto.</p>
                    </div>

                    {sel.length === 0 ? (
                        <p className="rounded-xl bg-paper px-4 py-6 text-center text-[14px] text-muted">Aún no elegiste productos. Búscalos arriba o agrega los de esta página.</p>
                    ) : (
                        <table className="w-full text-sm">
                            <thead><tr className="border-b border-line text-left text-[12.5px] text-muted">
                                <th className="py-2 font-medium">Producto</th><th className="py-2 font-medium">EAN-13</th>
                                <th className="w-[110px] py-2 text-right font-medium">Etiquetas</th><th className="w-10 py-2"><span className="sr-only">Quitar</span></th>
                            </tr></thead>
                            <tbody>
                                {sel.map((p) => (
                                    <tr key={p.id} className="border-b border-line last:border-0">
                                        <td className="py-2 pr-3"><span className="block max-w-[300px] truncate font-medium">{p.nombre}</span><span className="num text-[12px] text-muted">{p.sku}</span></td>
                                        <td className="num py-2 pr-3 text-[12.5px]">{p.ean ? <span className="font-medium">{p.ean}</span> : <span className="text-[12.5px] text-[#8a5a00]">sin EAN</span>}</td>
                                        <td className="py-2 text-right"><input inputMode="numeric" value={p.cantidad} min={1} max={99} aria-label={`Cantidad de etiquetas de ${p.nombre}`}
                                            onChange={(e) => setSel((s) => s.map((x) => (x.id === p.id ? { ...x, cantidad: Math.min(99, Math.max(1, Math.round(Number(e.target.value.replace(/\D/g, '')) || 1))) } : x)))}
                                            className="num h-9 w-[70px] rounded-lg border border-line bg-white px-2 text-right text-[14px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" /></td>
                                        <td className="py-2 text-right"><button type="button" onClick={() => setSel((s) => s.filter((x) => x.id !== p.id))} aria-label={`Quitar ${p.nombre}`} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-[#fdecec] hover:text-danger"><Trash2 className="size-4" /></button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    <div className="rounded-xl border border-line p-4">
                        <p className="text-[13px] font-semibold">Opciones de la hoja</p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3">
                            <div className="w-[280px]"><Segmented name="formato-etiquetas" value={o.formato} onChange={(v) => setO({ ...o, formato: v })}
                                options={[{ value: 'carta', label: 'Hoja carta 3×10' }, { value: 'termico', label: 'Térmico 80 mm' }]} /></div>
                            <Switch on={o.precioBs} set={(v) => setO({ ...o, precioBs: v })} label="Precio en Bs" />
                            <Switch on={o.precioUsd} set={(v) => setO({ ...o, precioUsd: v })} label="Precio en US$" />
                            <Switch on={o.mostrarMarca} set={(v) => setO({ ...o, mostrarMarca: v })} label="Mostrar marca" />
                        </div>
                    </div>

                    {previsual.length > 0 && (
                        <div>
                            <p className="mb-3 text-[13px] font-semibold">Vista previa{sel.length > 12 ? ` (primeras 12 de ${sel.length})` : ''}</p>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                {previsual.map((p) => (
                                    <div key={p.id} className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-line px-2 py-2.5">
                                        <p className="line-clamp-2 min-h-[26px] text-center text-[11.5px] font-semibold leading-tight">{p.nombre}</p>
                                        <p className="text-[10px] text-muted">{[o.mostrarMarca && p.marca, p.sku].filter(Boolean).join(' · ')}</p>
                                        {(o.precioBs && p.precio_ves > 0) || (o.precioUsd && p.precio_usd > 0) ? (
                                            <p className="num text-[12px] font-bold">{[o.precioBs && p.precio_ves > 0 ? `Bs ${n2(p.precio_ves)}` : null, o.precioUsd && p.precio_usd > 0 ? `$ ${n2(p.precio_usd)}` : null].filter(Boolean).join(' · ')}</p>
                                        ) : null}
                                        {p.ean ? <BarcodeSvg codigo={p.ean} modulo={1.15} alto={26} className="mt-1 w-full max-w-[210px]" /> : <p className="mt-1 text-[10px] text-[#8a5a00]">Asigna un código EAN para imprimir las barras</p>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <footer className="space-y-2 border-t border-line bg-white px-6 py-4">
                    <div className="flex items-center justify-between gap-3">
                        <p className="num text-[13px] text-muted">{sel.length} {sel.length === 1 ? 'producto' : 'productos'} · {total} {total === 1 ? 'etiqueta' : 'etiquetas'}{sinEan > 0 ? ` · ${sinEan} sin EAN (salen sin barras)` : ''}</p>
                        {total > MAX_ETIQUETAS && <p className="text-[13px] font-semibold text-danger">Máximo {MAX_ETIQUETAS} etiquetas por tanda</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <button type="button" onClick={() => generar(false)} disabled={env || !total || total > MAX_ETIQUETAS} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-ink text-[15px] font-semibold text-white hover:bg-black disabled:opacity-60"><Printer className="size-[18px]" />{env ? 'Preparando…' : 'Imprimir'}</button>
                        <button type="button" onClick={() => generar(true)} disabled={env || !total || total > MAX_ETIQUETAS} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line text-[15px] font-semibold hover:bg-paper disabled:opacity-60"><Download className="size-[18px]" />Descargar PDF</button>
                    </div>
                </footer>
            </aside>
        </div>
    );
}
