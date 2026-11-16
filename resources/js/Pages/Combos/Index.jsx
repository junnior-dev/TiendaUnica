import { Head, router } from '@inertiajs/react';
import { useMemo, useRef, useState } from 'react';
import { Minus, PackageSearch, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Modal, Vacio } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { http } from '../../lib/http';
import { n0, n2, usd } from '../../lib/format';

const num = (s) => { const t = String(s ?? '').trim(); return t ? Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) : NaN; };

/* Editor del kit: nombre, precio y sus piezas con cantidad. La suma de piezas se calcula sola. */
function Editor({ edit, setEdit, cerrar, hecho }) {
    const [q, setQ] = useState('');
    const [res, setRes] = useState([]);
    const [env, setEnv] = useState(false);
    const [err, setErr] = useState({});
    const t = useRef(null);
    const buscar = (texto) => {
        setQ(texto);
        const s = texto.trim();
        if (s.length < 2) { setRes([]); return; }
        clearTimeout(t.current);
        t.current = setTimeout(async () => {
            try { setRes(await http('GET', `/caja/buscar?q=${encodeURIComponent(s)}`)); } catch { setRes([]); }
        }, 250);
    };
    const componentes = edit.componentes || [];
    const suma = componentes.reduce((s, c) => s + (c.precio || 0) * c.cantidad, 0);
    const precio = edit.precio === '' || edit.precio == null ? null : num(edit.precio);
    const agregar = (p) => {
        if (componentes.some((c) => c.producto_id === p.id)) return;
        setEdit({ ...edit, componentes: [...componentes, { producto_id: p.id, sku: p.sku, nombre: p.nombre, precio: p.precio_usd, stock: p.stock, cantidad: 1 }] });
        setQ(''); setRes([]);
    };
    const guardar = async () => {
        const e = {};
        if (!edit.sku.trim()) e.sku = 'Escribe el código del kit (KIT-ACE…).';
        if (edit.nombre.trim().length < 3) e.nombre = 'Escribe el nombre del kit.';
        if (!componentes.length) e.componentes = 'Agrega al menos una pieza al kit.';
        if (precio !== null && precio > suma + 0.01) e.precio = 'El kit no puede valer más que sus piezas sueltas.';
        setErr(e);
        if (Object.keys(e).length) return;
        setEnv(true);
        try {
            const datos = { sku: edit.sku.trim(), nombre: edit.nombre.trim(), descripcion: edit.descripcion || null,
                precio: precio === null ? null : precio, componentes: componentes.map((c) => ({ producto_id: c.producto_id, cantidad: c.cantidad })) };
            if (edit.id) await http('PUT', `/combos/${edit.id}`, datos); else await http('POST', '/combos', datos);
            hecho(); cerrar();
        } catch (ex) { setErr({ general: ex.message }); setEnv(false); }
    };
    return (
        <Modal titulo={edit.id ? 'Editar combo' : 'Nuevo combo'} subtitulo="El kit se vende con sus piezas reales: cada línea lleva su IVA, su costo y su kardex." cerrar={cerrar} onSubmit={guardar} enviando={env} ok="Guardar combo" ancho="max-w-[680px]">
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Código del kit" value={edit.sku} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} error={err.sku} hint="Ej.: KIT-ACE-CG125" />
                <Field label="Nombre del kit" value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} error={err.nombre} hint="Ej.: Kit cambio de aceite CG 125" />
            </div>
            <Field label="Precio del kit US$ (opcional)" icon={undefined} inputMode="decimal" value={edit.precio ?? ''} onChange={(e) => setEdit({ ...edit, precio: e.target.value })} error={err.precio}
                hint={suma > 0 ? `Las piezas sueltas suman ${usd(suma)}${precio !== null && precio < suma ? ` · el cliente ahorra ${n2((1 - precio / suma) * 100)} %` : ''}. Vacío = vale la suma.` : undefined} className="[&_input]:num" />
            <div>
                <p className="mb-2 text-[13px] font-semibold">Piezas del kit</p>
                {componentes.length > 0 && (
                    <ul className="mb-3 divide-y divide-line rounded-xl border border-line">
                        {componentes.map((c) => (
                            <li key={c.producto_id} className="flex items-center gap-3 px-4 py-2.5">
                                <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{c.nombre}</span><span className="num block text-[12px] text-muted">{c.sku} · {usd(c.precio || 0)} c/u</span></span>
                                <span className="flex items-center rounded-lg border border-line">
                                    <button type="button" aria-label="Menos" onClick={() => setEdit({ ...edit, componentes: componentes.map((x) => (x.producto_id === c.producto_id ? { ...x, cantidad: Math.max(0.5, x.cantidad - 1) } : x)) })} className="grid size-8 place-items-center hover:bg-paper"><Minus className="size-3.5" /></button>
                                    <input aria-label={`Cantidad de ${c.nombre}`} inputMode="decimal" value={c.cantidad} onChange={(e) => { const v = num(e.target.value); if (!Number.isNaN(v) && v > 0) setEdit({ ...edit, componentes: componentes.map((x) => (x.producto_id === c.producto_id ? { ...x, cantidad: v } : x)) }); }} className="num h-8 w-12 border-x border-line text-center text-[14px] font-semibold" />
                                    <button type="button" aria-label="Más" onClick={() => setEdit({ ...edit, componentes: componentes.map((x) => (x.producto_id === c.producto_id ? { ...x, cantidad: x.cantidad + 1 } : x)) })} className="grid size-8 place-items-center hover:bg-paper"><Plus className="size-3.5" /></button>
                                </span>
                                <button type="button" aria-label="Quitar pieza" onClick={() => setEdit({ ...edit, componentes: componentes.filter((x) => x.producto_id !== c.producto_id) })} className="grid size-8 place-items-center rounded-md text-muted hover:bg-[#fdecec] hover:text-danger"><Trash2 className="size-4" /></button>
                            </li>
                        ))}
                    </ul>
                )}
                <Field label="Buscar pieza para el kit" icon={Search} value={q} onChange={(e) => buscar(e.target.value)} />
                {q.trim().length >= 2 && res.length > 0 && (
                    <ul className="mt-2 max-h-[180px] overflow-y-auto rounded-xl border border-line">
                        {res.map((p) => (
                            <li key={p.id} className="border-b border-line last:border-0">
                                <button type="button" onClick={() => agregar(p)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-brand-50">
                                    <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px]">{p.nombre}</span><span className="num block text-[12px] text-muted">{p.sku}</span></span>
                                    <span className="num shrink-0 text-[13px]">{usd(p.precio_usd)}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {err.componentes && <p className="mt-1 text-[13px] text-danger">{err.componentes}</p>}
            </div>
            {err.general && <p className="text-[13px] text-danger">{err.general}</p>}
        </Modal>
    );
}

export default function Combos(p) {
    const { negocio, usuario, fecha_larga, stock_bajo, tasa_usd, combos } = p;
    const [edit, setEdit] = useState(null);
    const [q, setQ] = useState('');
    const lista = useMemo(() => combos.filter((c) => !q.trim() || `${c.sku} ${c.nombre}`.toLowerCase().includes(q.trim().toLowerCase())), [combos, q]);
    const hecho = () => router.get('/combos', {}, { preserveScroll: true, preserveState: false });

    return (
        <AppLayout actual="/combos" titulo="Combos y kits" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Combos y kits" />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Combos y kits</h2>
                    <p className="mt-1 max-w-[62ch] text-[15px] text-muted">Kit de mantenimiento (aceite + filtro + bujías…): en el punto de venta se agrega de una vez y la venta sale pieza por pieza, con el descuento repartido para dar el precio del kit.</p></div>
                <Button onClick={() => setEdit({ sku: '', nombre: '', precio: '', componentes: [] })}><Plus className="size-4" />Nuevo combo</Button>
            </div>

            <Card>
                <div className="flex flex-wrap items-center gap-3 border-b border-line p-4 sm:p-5">
                    <label className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Buscar combo" placeholder="Buscar combo por nombre o código" className="h-11 w-full rounded-lg border border-line bg-paper pl-10 pr-3 text-[15px] placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" /></label>
                </div>
                {lista.length === 0 ? (
                    <Vacio icon={PackageSearch} titulo="No hay combos" texto="Crea el primer kit: por ejemplo aceite + filtro + bujía a un precio menor que las piezas sueltas.">
                        <Button onClick={() => setEdit({ sku: '', nombre: '', precio: '', componentes: [] })}><Plus className="size-4" />Nuevo combo</Button>
                    </Vacio>
                ) : (
                    <ul>
                        {lista.map((c) => (
                            <li key={c.id} className="border-b border-line px-5 py-4 last:border-0">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">{c.nombre}
                                            <span className="num rounded-full bg-paper px-2 py-0.5 text-xs font-medium text-muted">{c.sku}</span>
                                            {!c.activo && <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-medium text-muted">Inactivo</span>}
                                            {c.hay_stock && c.activo && <span className="rounded-full bg-[#e7f6ee] px-2 py-0.5 text-xs font-semibold text-ok">Hay stock</span>}
                                        </p>
                                        <p className="mt-1 text-[13px] text-muted">{(c.componentes || []).map((x) => `${x.nombre} × ${n0(x.cantidad)}`).join(' · ')}</p>
                                        <p className="num mt-1 text-[13px]">Kit: <b>{c.precio !== null ? usd(c.precio) : 'suma de piezas'}</b>
                                            <span className="text-muted"> · piezas sueltas {usd(c.suma_piezas)}{c.ahorro_pct > 0 ? ` · ahorro ${n2(c.ahorro_pct)} %` : ''}</span></p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button type="button" aria-label={`Editar ${c.nombre}`} onClick={() => setEdit({ ...c, precio: c.precio === null ? '' : String(c.precio).replace('.', ',') })} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-paper hover:text-text"><Pencil className="size-[17px]" /></button>
                                        <button type="button" aria-label={c.activo ? `Desactivar ${c.nombre}` : `Activar ${c.nombre}`} onClick={() => router.patch(`/combos/${c.id}/estado`, { activo: !c.activo }, { preserveScroll: true })} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-paper hover:text-text"><Power className="size-[17px]" /></button>
                                        <button type="button" aria-label={`Eliminar ${c.nombre}`} onClick={() => { if (window.confirm(`¿Eliminar el combo «${c.nombre}»?`)) router.delete(`/combos/${c.id}`, { preserveScroll: true }); }} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-[#fdecec] hover:text-danger"><Trash2 className="size-[17px]" /></button>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {edit && <Editor edit={edit} setEdit={setEdit} cerrar={() => setEdit(null)} hecho={hecho} />}
        </AppLayout>
    );
}
