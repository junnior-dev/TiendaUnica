import { router } from '@inertiajs/react';
import { useEffect, useMemo, useState } from 'react';
import { Barcode, Bike, Boxes, Calculator, CircleDollarSign, Hash, Loader2, MapPin, Minus, PackagePlus, Percent, Plus, Ruler, Tag, Trash2, Wrench, X } from 'lucide-react';
import { Button, Field } from '../../Components/ui';
import { n0, n2, usd } from '../../lib/format';

/* "4,20" o "4.20" → 4.2 ; "1.250,5" → 1250.5 */
const num = (s) => { const t = String(s ?? '').trim(); if (!t) return NaN; return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); };
const txt = (v) => (v == null || v === '' ? '' : String(v).replace('.', ','));
const redondea = (v) => Math.round(v * 100) / 100;
const fecha = (f) => f.split('-').reverse().join('/');
const MOTIVO = { CREACION: 'Creación', CAMBIO_MARGEN: 'Cambió el margen', COSTO_AUTOMATICO: 'Costo nuevo', ALERTA_APLICADA: 'Aceptaste el sugerido', RECALCULO: 'Recálculo', MANUAL: 'Cambio manual' };
const TIPO = { COMPRA: 'Compra', VENTA: 'Venta', ANULACION_VENTA: 'Venta anulada', ANULACION_COMPRA: 'Compra anulada', DEVOLUCION_CLIENTE: 'Devolución de cliente', AJUSTE_ENTRADA: 'Ajuste (entra)', AJUSTE_SALIDA: 'Ajuste (sale)', INVENTARIO_INICIAL: 'Inventario inicial' };
const VACIO = { sku: '', codigo_barras: '', referencia: '', nombre: '', descripcion: '', categoria_id: '', marca_id: '', unidad: 'UND', unidad_compra: '', piezas: '12', ubicacion: '', costo: '', margen_pct: '', margen_propio: false, precio_manual: false, precio: '', exento: false, exonerado: false, minimo: '0', stock_inicial: '', activo: true, compat: [] };

function Interruptor({ on, set, titulo, ayuda }) {
    return (
        <div className="flex items-start gap-3 py-2.5">
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">{titulo}</p>{ayuda && <p className="text-[13px] text-muted">{ayuda}</p>}</div>
            <button type="button" role="switch" aria-checked={on} aria-label={titulo} onClick={() => set(!on)} className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors ${on ? 'bg-brand' : 'bg-[#c5ccd4]'}`}><span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} /></button>
        </div>
    );
}

export default function ProductoPanel({ id, catalogo, tasa, iva, margenNegocio, cerrar }) {
    const nuevo = !id;
    const [f, setF] = useState(VACIO);
    const [det, setDet] = useState(null);
    const [cargando, setCargando] = useState(!nuevo);
    const [tab, setTab] = useState('datos');
    const [errores, setErrores] = useState({});
    const [guardando, setGuardando] = useState(false);
    const [ajuste, setAjuste] = useState({ signo: 1, cantidad: '', motivo: '' });
    const [moto, setMoto] = useState({ id: '', desde: '', hasta: '' });
    const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
    const on = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

    const cargar = () => fetch(`/productos/${id}`, { headers: { Accept: 'application/json' } }).then((r) => r.json()).then((d) => {
        setDet(d);
        setF({ ...VACIO, sku: d.sku, codigo_barras: d.codigo_barras ?? '', referencia: d.referencia ?? '', nombre: d.nombre, descripcion: d.descripcion ?? '', categoria_id: d.categoria_id ?? '', marca_id: d.marca_id ?? '',
            unidad: d.unidad, unidad_compra: d.unidad_compra ?? '', piezas: d.piezas_por_presentacion != null ? String(d.piezas_por_presentacion) : '12', ubicacion: d.ubicacion ?? '', costo: txt(d.costo), margen_propio: d.margen_pct != null, margen_pct: txt(d.margen_pct), precio_manual: false, precio: txt(d.precio),
            exento: d.exento, exonerado: d.exonerado, minimo: txt(d.minimo), activo: d.activo, compat: d.compat });
        setCargando(false);
    });
    useEffect(() => { if (!nuevo) cargar(); }, [id]);
    useEffect(() => { const k = (e) => e.key === 'Escape' && cerrar(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);

    /* ── Precio calculado en vivo con la misma fórmula del esquema: costo × (1 + margen), margen del producto → categoría → negocio ── */
    const cat = catalogo.categorias.find((c) => String(c.id) === String(f.categoria_id));
    const heredado = cat?.margen_pct ?? margenNegocio;
    const origenHeredado = cat?.margen_pct != null ? `de la categoría ${cat.nombre}` : 'del negocio';
    const costo = num(f.costo), margenProp = num(f.margen_pct);
    const margen = f.margen_propio && !isNaN(margenProp) ? margenProp : heredado;
    const calculado = isNaN(costo) ? null : redondea(costo * (1 + margen / 100));
    const precioManual = num(f.precio);
    // Mientras no toques costo, margen, categoría ni IVA, el precio vigente se respeta (el sugerido por una compra se confirma desde la lista).
    const sinCambios = !nuevo && det && costo === det.costo && f.exento === det.exento && f.exonerado === det.exonerado && String(f.categoria_id) === String(det.categoria_id ?? '')
        && (f.margen_propio ? margenProp : null) === (det.margen_pct ?? null);
    const precio = f.precio_manual && !isNaN(precioManual) ? precioManual : sinCambios ? det.precio : calculado ?? (nuevo ? null : det?.precio);
    const sinIva = f.exento || f.exonerado;
    const final = precio == null ? null : sinIva ? precio : redondea(precio * (1 + iva / 100));
    const ganancia = precio != null && !isNaN(costo) ? precio - costo : null;
    const margenReal = ganancia != null && costo > 0 ? (ganancia / costo) * 100 : null;
    const bajoCosto = ganancia != null && ganancia < 0;

    const dif = useMemo(() => (!nuevo && det && precio != null && Math.abs(precio - det.precio) > 0.004 ? { antes: det.precio, ahora: precio } : null), [det, precio, nuevo]);

    const guardar = () => {
        const e = {};
        if (!f.nombre.trim()) e.nombre = 'Escribe cómo se llama el repuesto.';
        if (!f.sku.trim()) e.sku = 'Cada producto necesita un SKU único.';
        if (isNaN(costo) || costo < 0) e.costo = 'Escribe el costo en dólares (puede ser 0).';
        if (f.margen_propio && (isNaN(margenProp) || margenProp < 0 || margenProp > 1000)) e.margen_pct = 'Usa un número entre 0 y 1000.';
        setErrores(e);
        if (Object.keys(e).length) { setTab(e.nombre || e.sku ? 'datos' : 'precio'); return; }
        const datos = { ...f, costo, categoria_id: f.categoria_id || null, marca_id: f.marca_id || null, margen_pct: f.margen_propio ? margenProp : null, precio: f.precio_manual ? precioManual : null,
            unidad_compra: f.unidad_compra || null, piezas_por_presentacion: f.unidad_compra ? (num(f.piezas) || 1) : 1,
            minimo: num(f.minimo) || 0, stock_inicial: nuevo ? num(f.stock_inicial) || 0 : undefined };
        const opciones = { preserveScroll: true, onStart: () => setGuardando(true), onFinish: () => setGuardando(false), onSuccess: cerrar, onError: (er) => { setErrores(er); setTab(er.sku || er.nombre ? 'datos' : 'precio'); } };
        nuevo ? router.post('/productos', datos, opciones) : router.put(`/productos/${id}`, datos, opciones);
    };
    const ajustar = () => {
        const q = num(ajuste.cantidad);
        if (isNaN(q) || q <= 0) return setErrores({ ajuste: 'Escribe cuántas unidades entran o salen.' });
        if (ajuste.motivo.trim().length < 3) return setErrores({ ajuste: 'Cuéntanos el motivo (por ejemplo: «conteo físico»).' });
        router.post(`/productos/${id}/ajustar`, { cantidad: q * ajuste.signo, motivo: ajuste.motivo }, { preserveScroll: true, onError: (er) => setErrores({ ajuste: er.ajuste ?? 'No se pudo ajustar.' }),
            onSuccess: () => { setAjuste({ signo: 1, cantidad: '', motivo: '' }); setErrores({}); cargar(); } });
    };
    const agregarMoto = () => {
        if (!moto.id || f.compat.some((c) => String(c.moto_id) === String(moto.id))) return;
        setF((x) => ({ ...x, compat: [...x.compat, { moto_id: Number(moto.id), desde: Number(moto.desde) || null, hasta: Number(moto.hasta) || null }] })); setMoto({ id: '', desde: '', hasta: '' });
    };
    const disponibles = catalogo.motos.filter((m) => !f.compat.some((c) => c.moto_id === m.id));
    const TABS = [['datos', 'Datos', Wrench], ['precio', 'Precio', CircleDollarSign], ['stock', 'Existencias', Boxes], ['ventas', `Cómo se vende${det?.presentaciones?.length ? ` · ${det.presentaciones.length + 1}` : ''}`, Tag], ['motos', `Motos${f.compat.length ? ` · ${f.compat.length}` : ''}`, Bike]];
    const selec = 'h-12 w-full appearance-none rounded-lg border border-line bg-white px-3.5 text-[15px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand';

    return (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={nuevo ? 'Nuevo producto' : 'Editar producto'}>
            <div className="absolute inset-0 bg-black/45" onClick={cerrar} />
            <aside className="absolute inset-y-0 right-0 flex w-full max-w-[720px] flex-col bg-white shadow-2xl">
                <header className="flex items-start gap-3 border-b border-line px-5 pb-0 pt-5 sm:px-6">
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate text-lg font-semibold tracking-[-0.01em]">{nuevo ? 'Nuevo producto' : (f.nombre || 'Producto')}</h2>
                        <p className="mt-0.5 text-[13px] text-muted">{nuevo ? 'Llena lo básico; el precio se calcula solo desde el costo.' : `${f.sku} · ${cat?.nombre ?? 'Sin categoría'}`}</p>
                    </div>
                    <button onClick={cerrar} aria-label="Cerrar" className="grid size-9 place-items-center rounded-lg hover:bg-paper"><X className="size-5" /></button>
                </header>
                <nav className="flex gap-1 overflow-x-auto border-b border-line px-4 sm:px-5" aria-label="Secciones">
                    {TABS.filter(([k]) => !(nuevo && false)).map(([k, l, I]) => (
                        <button key={k} onClick={() => setTab(k)} aria-current={tab === k} className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${tab === k ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-text'}`}><I className="size-4" />{l}</button>
                    ))}
                </nav>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-6">
                    {cargando ? <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Cargando producto…</p> : <>

                    {tab === 'datos' && (
                        <div className="space-y-4">
                            <Field label="Nombre del repuesto" icon={Wrench} value={f.nombre} onChange={set('nombre')} error={errores.nombre} autoFocus={nuevo} hint="Incluye la pieza y la moto o medida: «Pastillas de freno delanteras CG 150»." />
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="SKU" icon={Hash} value={f.sku} onChange={set('sku')} error={errores.sku} className="[&_input]:uppercase" />
                                <Field label="Código de barras" icon={Barcode} value={f.codigo_barras} onChange={set('codigo_barras')} error={errores.codigo_barras} inputMode="numeric" hint="El número que teclea el escáner en el punto de venta." />
                            </div>
                            {!f.codigo_barras.trim() && (
                                <p role="status" className="rounded-lg bg-[#fffaf0] px-3.5 py-2.5 text-[13px] leading-snug text-[#8a5a00]">
                                    <strong>Sin código de barras:</strong> el POS lo encuentra igual por su SKU, pero un escáner no lo leerá. Puedes asignarle un EAN-13 interno desde <strong>«Etiquetas con código»</strong> en la lista de productos.
                                </p>
                            )}
                            <Field label="Referencia del fabricante" icon={Tag} value={f.referencia} onChange={set('referencia')} hint="El número de parte que usa el proveedor; ayuda a buscar la pieza." />
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field select label="Categoría" value={f.categoria_id} onChange={set('categoria_id')}><option value="">Sin categoría</option>{catalogo.categorias.filter((c) => c.activa !== false || c.id === f.categoria_id).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Field>
                                <Field select label="Marca" value={f.marca_id} onChange={set('marca_id')}><option value="">Sin marca</option>{catalogo.marcas.filter((c) => c.activa !== false || c.id === f.marca_id).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Field>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field select label="Se vende por (unidad de venta)" value={f.unidad} onChange={set('unidad')} hint={(catalogo.unidades || []).find((u) => u.codigo === f.unidad)?.permite_fraccion ? 'Admite fracciones (0.5 litro, 1.5 metros…).' : 'Piezas enteras.'}>
                                    {(catalogo.unidades || []).map((u) => <option key={u.codigo} value={u.codigo}>{u.codigo} · {u.nombre}</option>)}
                                </Field>
                                <Field label="Ubicación en el almacén" icon={MapPin} value={f.ubicacion} onChange={set('ubicacion')} hint="Pasillo, estante y nivel: A-02-1." />
                            </div>
                            <div className="rounded-xl border border-line p-4">
                                <p className="text-sm font-medium">Cómo llega del proveedor (opcional)</p>
                                <p className="mt-0.5 text-[13px] leading-snug text-muted">Si compras cajas o juegos y vendes la pieza suelta, indícalo: en Compras y Órdenes de compra tecleas «2 cajas» y el inventario suma las piezas.</p>
                                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                                    <Field select label="Se compra en" value={f.unidad_compra || ''} onChange={set('unidad_compra')}>
                                        <option value="">Misma unidad de venta</option>
                                        {(catalogo.unidades || []).map((u) => <option key={u.codigo} value={u.codigo}>{u.codigo} · {u.nombre}</option>)}
                                    </Field>
                                    {f.unidad_compra && <Field label="Piezas por presentación" inputMode="decimal" value={f.piezas ?? ''} onChange={set('piezas')} error={errores.piezas} hint="Ej.: caja de 12 → 12" className="[&_input]:num" />}
                                </div>
                            </div>
                            <label className="block"><span className="mb-1.5 block text-sm font-medium">Descripción <span className="font-normal text-muted">(opcional)</span></span>
                                <textarea value={f.descripcion} onChange={set('descripcion')} rows={3} className="w-full rounded-lg border border-line px-3.5 py-3 text-[15px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" placeholder="Medidas, material, advertencias para el mostrador…" /></label>
                            {!nuevo && <div className="border-t border-line pt-2"><Interruptor on={f.activo} set={on('activo')} titulo="Producto activo" ayuda="Si lo desactivas, deja de aparecer en el punto de venta pero conserva su historial." /></div>}
                        </div>
                    )}

                    {tab === 'precio' && (
                        <div className="space-y-6">
                            <div className="rounded-2xl p-5 text-white" style={{ background: 'linear-gradient(160deg,#1b2229 0%,#0b0e12 100%)' }}>
                                <p className="text-[13px] text-white/60">Precio de venta</p>
                                {precio == null ? <p className="mt-2 text-sm text-white/70">Escribe el costo y el sistema calcula el precio.</p> : <>
                                    <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                                        <p className="num text-[34px] font-semibold leading-none tracking-[-0.02em]">{usd(precio)}</p>
                                        <p className="num text-lg text-white/70">Bs {n2(precio * tasa)}</p>
                                    </div>
                                    {!nuevo && det?.por_confirmar && sinCambios && <p className="mt-2 text-[13px] text-[#ffd479]">Con el costo nuevo el sistema sugiere {usd(det.sugerido)}. Confírmalo desde el aviso de la lista.</p>}
                                    {dif && <p className="num mt-2 text-[13px] text-[#ffd479]">Antes {usd(dif.antes)} → ahora {usd(dif.ahora)}</p>}
                                    <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/10 pt-4 text-[13px]">
                                        <div><dt className="text-white/55">Ganas por unidad</dt><dd className={`num mt-0.5 text-[15px] font-semibold ${bajoCosto ? 'text-[#ff8a80]' : ''}`}>{ganancia == null ? '—' : usd(ganancia)}</dd></div>
                                        <div><dt className="text-white/55">Margen sobre el costo</dt><dd className="num mt-0.5 text-[15px] font-semibold">{margenReal == null ? '—' : `${n2(margenReal)} %`}</dd></div>
                                        <div><dt className="text-white/55">{sinIva ? 'Sin IVA' : `Cliente paga con IVA ${n0(iva)} %`}</dt><dd className="num mt-0.5 text-[15px] font-semibold">{usd(final)}</dd></div>
                                    </dl>
                                    {!sinIva && <p className="num mt-2 text-xs text-white/50">En bolívares con IVA: Bs {n2(final * tasa)} · tasa {n2(tasa)}</p>}
                                </>}
                            </div>
                            {bajoCosto && <p role="alert" className="rounded-lg bg-[#fdecec] px-3.5 py-2.5 text-[13px] text-danger">Este precio queda por debajo del costo: vender cada unidad te haría perder {usd(-ganancia)}.</p>}

                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Costo en dólares" icon={CircleDollarSign} value={f.costo} onChange={set('costo')} error={errores.costo} inputMode="decimal" className="[&_input]:num" hint={!nuevo ? 'Normalmente cambia solo cuando registras una compra.' : 'Lo que te cuesta cada unidad.'} />
                                <Field label="Margen propio (%)" icon={Percent} value={f.margen_propio ? f.margen_pct : String(heredado).replace('.', ',')} onChange={set('margen_pct')} error={errores.margen_pct} inputMode="decimal" readOnly={!f.margen_propio} className="[&_input]:num" hint={f.margen_propio ? 'Ganancia sobre el costo: 30 % significa costo × 1,30.' : `Usa ${n0(heredado)} % ${origenHeredado}.`} />
                            </div>
                            <div className="divide-y divide-line rounded-xl border border-line px-4">
                                <Interruptor on={f.margen_propio} set={(v) => setF((x) => ({ ...x, margen_propio: v, margen_pct: v && !x.margen_pct ? String(heredado).replace('.', ',') : x.margen_pct }))} titulo="Poner un margen solo para este producto" ayuda="Si lo apagas, el producto sigue el margen de su categoría y el precio se actualiza solo." />
                                <Interruptor on={f.precio_manual} set={(v) => setF((x) => ({ ...x, precio_manual: v, precio: v && calculado != null ? txt(calculado) : x.precio }))} titulo="Escribir el precio a mano" ayuda="Útil para precios «redondos». El margen se muestra como referencia." />
                                {f.precio_manual && <div className="py-4"><Field label="Precio de venta en dólares" icon={CircleDollarSign} value={f.precio} onChange={set('precio')} inputMode="decimal" className="[&_input]:num" /></div>}
                                <Interruptor on={f.exento} set={on('exento')} titulo="Exento de IVA" ayuda="Productos que por ley no causan IVA." />
                                <Interruptor on={f.exonerado} set={on('exonerado')} titulo="Exonerado de IVA por decreto" ayuda="Temporal: distinto de exento. Se anota aparte para el libro de ventas." />
                            </div>

                            {!nuevo && det?.historial_precios?.length > 0 && (
                                <section><h3 className="mb-2 text-sm font-semibold">Cambios de precio</h3>
                                    <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                                        {det.historial_precios.map((h, i) => (
                                            <li key={i} className="flex items-center gap-3 px-4 py-2.5"><span className="w-[84px] text-muted">{fecha(h.fecha)}</span><span className="flex-1">{MOTIVO[h.motivo]}</span>
                                                <span className="num text-muted">{h.anterior > 0 ? usd(h.anterior) : '—'}</span><span className="text-muted">→</span><span className="num font-semibold">{usd(h.nuevo)}</span></li>
                                        ))}
                                    </ul></section>
                            )}
                        </div>
                    )}

                    {tab === 'stock' && (
                        <div className="space-y-6">
                            {nuevo ? (
                                <div className="space-y-4">
                                    <p className="text-sm text-muted">Cuántas piezas tienes hoy y con cuántas quieres que el sistema te avise para reponer.</p>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <Field label="Cantidad que tienes hoy" icon={Boxes} value={f.stock_inicial} onChange={set('stock_inicial')} inputMode="decimal" className="[&_input]:num" hint="Queda registrada como inventario inicial." />
                                        <Field label="Avisarme cuando queden" icon={Ruler} value={f.minimo} onChange={set('minimo')} inputMode="decimal" className="[&_input]:num" hint="Stock mínimo." />
                                    </div>
                                </div>
                            ) : (<>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="rounded-xl border border-line p-4"><p className="text-[13px] text-muted">Existencias ahora</p><p className={`num mt-1 text-[30px] font-semibold leading-none ${det.stock <= det.minimo ? 'text-[#a86a00]' : ''}`}>{n0(det.stock)} <span className="text-sm font-normal text-muted">{det.unidad}</span></p></div>
                                    <div className="rounded-xl border border-line p-4"><Field label="Avisarme cuando queden" value={f.minimo} onChange={set('minimo')} inputMode="decimal" className="[&_input]:num" /></div>
                                </div>
                                <section className="rounded-xl border border-line p-4">
                                    <h3 className="text-sm font-semibold">Ajustar existencias</h3>
                                    <p className="mt-0.5 text-[13px] text-muted">Para conteos físicos, mermas o mercancía dañada. Las compras y ventas ya suman o restan solas.</p>
                                    <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr]">
                                        <div role="radiogroup" aria-label="Tipo de ajuste" className="inline-flex h-12 rounded-lg bg-[#e9ecf0] p-1 text-sm">
                                            {[[1, 'Entran', Plus], [-1, 'Salen', Minus]].map(([v, l, I]) => <button key={v} type="button" role="radio" aria-checked={ajuste.signo === v} onClick={() => setAjuste({ ...ajuste, signo: v })} className={`inline-flex items-center gap-1.5 rounded-md px-4 font-medium ${ajuste.signo === v ? 'bg-white shadow-sm' : 'text-muted'}`}><I className="size-4" />{l}</button>)}
                                        </div>
                                        <Field label="Cantidad" value={ajuste.cantidad} onChange={(e) => setAjuste({ ...ajuste, cantidad: e.target.value })} inputMode="decimal" className="[&_input]:num" />
                                    </div>
                                    <div className="mt-3"><Field label="Motivo" value={ajuste.motivo} onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })} error={errores.ajuste} placeholder="Ej: conteo físico de noviembre" /></div>
                                    <Button type="button" variant="ghost" className="mt-3" onClick={ajustar}><PackagePlus className="size-4" />Registrar ajuste</Button>
                                </section>
                                <section><h3 className="mb-2 text-sm font-semibold">Últimos movimientos</h3>
                                    <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                                        {det.kardex.map((k, i) => (<li key={i} className="flex items-center gap-3 px-4 py-2.5"><span className="w-[84px] text-muted">{fecha(k.fecha)}</span><span className="flex-1">{TIPO[k.tipo]}</span>
                                            <span className={`num w-14 text-right font-semibold ${k.cantidad > 0 ? 'text-ok' : ''}`}>{k.cantidad > 0 ? '+' : ''}{n0(k.cantidad)}</span><span className="num w-20 text-right text-muted">quedan {n0(k.resultante)}</span></li>))}
                                    </ul></section>
                            </>)}
                        </div>
                    )}

                    {tab === 'ventas' && nuevo && (
                        <div className="space-y-4">
                            <p className="text-sm text-muted">La pieza suelta se vende siempre. Si además la vendes por caja, docena o juego, guarda primero el producto: aquí mismo agregas esas presentaciones y el cajero elige cómo venderlo al agregarlo en el punto de venta.</p>
                            {f.unidad_compra && num(f.piezas) > 1 && <p className="rounded-lg bg-brand-50 px-3.5 py-2.5 text-[13.5px] text-brand">Indicaste que se compra en {f.unidad_compra} de {n0(num(f.piezas))} piezas: al guardar podrás ofrecerla también como forma de venta con un clic.</p>}
                        </div>
                    )}
                    {tab === 'ventas' && !nuevo && det && <Presentaciones id={id} det={det} compra={f.unidad_compra && num(f.piezas) > 1 ? { nombre: (catalogo.unidades || []).find((u) => u.codigo === f.unidad_compra)?.nombre ?? f.unidad_compra, codigo: f.unidad_compra, factor: num(f.piezas) } : null} alCambiar={() => fetch(`/productos/${id}`, { headers: { Accept: 'application/json' } }).then((r) => r.json()).then((d) => setDet((x) => ({ ...x, presentaciones: d.presentaciones })))} />}

                    {tab === 'motos' && (
                        <div className="space-y-5">
                            <p className="text-sm text-muted">Dile al sistema a qué motos les sirve esta pieza. Así tu cajero busca «para mi Bera SBR» y encuentra solo lo que encaja. Si no marcas ninguna, se trata como pieza universal.</p>
                            <div className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-[1fr_96px_96px_auto]">
                                <Field select label="Moto" value={moto.id} onChange={(e) => setMoto({ ...moto, id: e.target.value })}><option value="">Elige un modelo</option>{disponibles.map((m) => <option key={m.id} value={m.id}>{m.etiqueta} · {m.cc} cc</option>)}</Field>
                                <Field label="Desde" value={moto.desde} onChange={(e) => setMoto({ ...moto, desde: e.target.value })} inputMode="numeric" placeholder="2015" className="[&_input]:num" />
                                <Field label="Hasta" value={moto.hasta} onChange={(e) => setMoto({ ...moto, hasta: e.target.value })} inputMode="numeric" placeholder="2024" className="[&_input]:num" />
                                <Button type="button" onClick={agregarMoto} disabled={!moto.id} className="sm:h-12"><Plus className="size-4" />Agregar</Button>
                            </div>
                            {f.compat.length === 0 ? (
                                <p className="rounded-xl bg-paper px-4 py-6 text-center text-sm text-muted">Pieza universal: aparece para cualquier moto.</p>
                            ) : (
                                <ul className="divide-y divide-line rounded-xl border border-line">
                                    {f.compat.map((c) => { const m = catalogo.motos.find((x) => x.id === c.moto_id); return (
                                        <li key={c.moto_id} className="flex items-center gap-3 px-4 py-3"><span className="grid size-9 place-items-center rounded-lg bg-paper text-muted"><Bike className="size-[18px]" /></span>
                                            <div className="min-w-0 flex-1"><p className="text-sm font-medium">{m.etiqueta}</p><p className="text-xs text-muted">{m.cc} cc{c.desde || c.hasta ? ` · años ${c.desde ?? '…'} a ${c.hasta ?? 'hoy'}` : ' · todos los años'}</p></div>
                                            <button onClick={() => setF((x) => ({ ...x, compat: x.compat.filter((y) => y.moto_id !== c.moto_id) }))} aria-label={`Quitar ${m.etiqueta}`} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-[#fdecec] hover:text-danger"><Trash2 className="size-4" /></button></li>); })}
                                </ul>
                            )}
                        </div>
                    )}
                    </>}
                </div>

                <footer className="flex items-center gap-3 border-t border-line bg-white px-5 py-4 sm:px-6">
                    <p className="num min-w-0 flex-1 truncate text-sm text-muted">{precio != null ? <>Precio <strong className="font-semibold text-text">{usd(precio)}</strong> · Bs {n2(precio * tasa)}</> : 'Aún sin precio'}</p>
                    <Button variant="ghost" type="button" onClick={cerrar}>Cancelar</Button>
                    <Button type="button" onClick={guardar} disabled={guardando || cargando}>{guardando ? 'Guardando…' : nuevo ? 'Crear producto' : 'Guardar cambios'}</Button>
                </footer>
            </aside>
        </div>
    );
}

/* Cómo se vende el producto: la pieza suelta siempre existe; aquí se agregan caja, docena, juego… Al agregar el producto en el POS el cajero elige. */
function Presentaciones({ id, det, compra, alCambiar }) {
    const VACIA = { id: null, nombre: '', codigo: '', factor: '', precio: '', barras: '' };
    const [p, setP] = useState(VACIA);
    const [error, setError] = useState('');
    const [env, setEnv] = useState(false);
    const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.value }));
    const factor = num(p.factor), precio = num(p.precio);
    const derivado = !isNaN(factor) && factor > 0 ? redondea(det.precio * factor) : null;
    const guardar = () => {
        if (p.nombre.trim().length < 2) return setError('Ponle un nombre, por ejemplo «Caja × 12».');
        if (isNaN(factor) || factor <= 0 || factor === 1) return setError('Escribe cuántas piezas trae (mayor que cero y distinto de 1).');
        if (p.precio.trim() && (isNaN(precio) || precio <= 0)) return setError('El precio debe ser mayor que cero, o déjalo vacío.');
        const codigo = (p.codigo.trim() || p.nombre).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
        setError('');
        router.post(`/productos/${id}/presentaciones`, { presentacion_id: p.id, nombre: p.nombre.trim(), codigo, factor, precio: p.precio.trim() ? precio : null, barras: p.barras.trim() || null },
            { preserveScroll: true, onStart: () => setEnv(true), onFinish: () => setEnv(false), onError: (er) => setError(er.presentacion ?? 'No se pudo guardar.'), onSuccess: () => { setP(VACIA); alCambiar(); } });
    };
    const quitar = (x) => router.delete(`/productos/${id}/presentaciones/${x.id}`, { preserveScroll: true, onError: (er) => setError(er.presentacion ?? 'No se pudo quitar.'), onSuccess: alCambiar });
    return (
        <div className="space-y-5">
            <p className="text-sm text-muted">La pieza suelta siempre se puede vender. Agrega aquí las otras formas (caja, docena, juego) y el cajero elegirá cómo venderlo al agregar el producto. El inventario sigue contando piezas.</p>
            {compra && !det.presentaciones.some((x) => x.factor === compra.factor) && !p.id && (
                <button type="button" onClick={() => setP({ id: null, nombre: `${compra.nombre} × ${n0(compra.factor)}`, codigo: compra.codigo, factor: txt(compra.factor), precio: '', barras: '' })}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-brand px-4 py-3 text-left hover:bg-brand-50">
                    <span><span className="block text-sm font-semibold text-brand">Vender también por {compra.nombre} × {n0(compra.factor)}</span><span className="block text-[13px] text-muted">Es la presentación en que compras este producto. Revisa el precio y guarda.</span></span>
                    <Plus className="size-4 shrink-0 text-brand" />
                </button>
            )}
            <ul className="divide-y divide-line rounded-xl border border-line">
                <li className="flex items-center gap-3 px-4 py-3"><span className="min-w-0 flex-1"><span className="block text-sm font-medium">Unidad ({det.unidad})</span><span className="block text-[13px] text-muted">Venta normal, 1 pieza</span></span><span className="num text-sm font-semibold">{usd(det.precio)}</span></li>
                {det.presentaciones.map((x) => (
                    <li key={x.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{x.nombre}</span><span className="block text-[13px] text-muted">{n0(x.factor)} piezas{x.barras && ` · código ${x.barras}`}{x.precio == null && ' · precio de la pieza × piezas'}</span></span>
                        <span className="num text-sm font-semibold">{usd(x.precio ?? redondea(det.precio * x.factor))}</span>
                        <button type="button" onClick={() => setP({ id: x.id, nombre: x.nombre, codigo: x.codigo, factor: txt(x.factor), precio: x.precio == null ? '' : txt(x.precio), barras: x.barras ?? '' })} className="text-[13px] font-semibold text-brand hover:underline">Editar</button>
                        <button type="button" onClick={() => quitar(x)} aria-label={`Quitar ${x.nombre}`} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-[#fdecec] hover:text-danger"><Trash2 className="size-4" /></button>
                    </li>
                ))}
            </ul>
            <section className="rounded-xl border border-line p-4">
                <h3 className="text-sm font-semibold">{p.id ? 'Editar presentación' : 'Agregar presentación'}</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <Field label="Nombre" value={p.nombre} onChange={set('nombre')} placeholder="Caja × 12" />
                    <Field label="Piezas que trae" value={p.factor} onChange={set('factor')} inputMode="decimal" className="[&_input]:num" placeholder="12" />
                    <Field label="Precio de la presentación (US$, opcional)" value={p.precio} onChange={set('precio')} inputMode="decimal" className="[&_input]:num" hint={derivado != null ? `Vacío = ${usd(derivado)} (precio de la pieza × ${n0(factor)}). Escríbelo si la caja tiene descuento.` : 'Vacío = precio de la pieza × piezas.'} />
                    <Field label="Código de barras de la caja (opcional)" icon={Barcode} value={p.barras} onChange={set('barras')} hint="Si lo escaneas en caja, se vende esta presentación sin preguntar." />
                </div>
                {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
                <div className="mt-4 flex gap-2">
                    <Button type="button" onClick={guardar} disabled={env}>{env ? 'Guardando…' : p.id ? 'Guardar cambios' : 'Agregar presentación'}</Button>
                    {p.id && <Button type="button" variant="ghost" onClick={() => { setP(VACIA); setError(''); }}>Cancelar</Button>}
                </div>
            </section>
        </div>
    );
}
