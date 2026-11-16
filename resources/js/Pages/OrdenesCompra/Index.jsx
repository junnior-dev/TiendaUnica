import { Head, router } from '@inertiajs/react';
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ClipboardCheck, FileSpreadsheet, Minus, Plus, Search, Send, Trash2, X } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi, Modal, Vacio } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { http } from '../../lib/http';
import { n0, n2, usd } from '../../lib/format';

const num = (s) => { const t = String(s ?? '').trim(); return t ? Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) : NaN; };
const ESTADOS = { BORRADOR: 'bg-paper text-muted', ENVIADA: 'bg-brand-50 text-brand', PARCIAL: 'bg-signal/15 text-[#8a5a00]', RECIBIDA: 'bg-[#e7f6ee] text-ok', CERRADA: 'bg-paper text-muted', ANULADA: 'bg-[#fdecec] text-danger' };
const Pill = ({ e }) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADOS[e]}`}>{e}</span>;
const presentacionDe = (l) => (l.unidad_compra ? `${l.unidad_compra} × ${n0(l.presentacion)}` : null);
const piezasTxt = (l, cajas) => (l.unidad_compra && !Number.isNaN(cajas) && cajas > 0 ? `${n0(cajas)} ${l.unidad_compra} = ${n0(cajas * l.presentacion)} ${l.unidad}` : `${n0(l.cantidad)} ${l.unidad}`);

/* Modal de creación: proveedor + sugerencia de compra + líneas a mano. */
function ModalNueva({ proveedores, cerrar, hecho }) {
    const [proveedor, setProveedor] = useState(proveedores[0]?.id || '');
    const [obs, setObs] = useState('');
    const [filas, setFilas] = useState([]);
    const [sugerencia, setSugerencia] = useState(null);
    const [cargSug, setCargSug] = useState(false);
    const [q, setQ] = useState('');
    const [res, setRes] = useState([]);
    const [env, setEnv] = useState(false);
    const [err, setErr] = useState({});
    const t = useRef(null);

    const cargarSugerencia = async () => {
        setCargSug(true);
        try { const r = await http('GET', '/ordenes-compra/sugerir'); setSugerencia(r.filas); } catch (e) { setErr({ general: e.message }); }
        setCargSug(false);
    };
    const addSugerido = (f) => {
        if (filas.some((x) => x.producto_id === f.producto_id)) return;
        setFilas([...filas, { producto_id: f.producto_id, sku: f.sku, nombre: f.nombre, unidad: f.unidad, unidad_compra: f.unidad_compra, presentacion: f.presentacion, cantidad: f.sugerido, costo: f.ultimo_costo || '' }]);
    };
    const buscar = (texto) => {
        setQ(texto);
        const s = texto.trim();
        if (s.length < 2) { setRes([]); return; }
        clearTimeout(t.current);
        t.current = setTimeout(async () => {
            try { setRes(await http('GET', `/compras/productos?q=${encodeURIComponent(s)}`)); } catch { setRes([]); }
        }, 250);
    };
    const guardar = async () => {
        const e = {};
        if (!proveedor) e.proveedor = 'Elige el proveedor.';
        if (!filas.some((f) => (num(f.cantidad) || 0) > 0)) e.items = 'Agrega al menos una pieza con cantidad.';
        setErr(e);
        if (Object.keys(e).length) return;
        setEnv(true);
        try {
            await http('POST', '/ordenes-compra', { proveedor_id: Number(proveedor), observaciones: obs.trim() || null,
                items: filas.filter((f) => (num(f.cantidad) || 0) > 0).map((f) => ({ producto_id: f.producto_id, cantidad: f.cantidad, costo_estimado: f.costo === '' ? null : f.costo })) });
            hecho(); cerrar();
        } catch (ex) { setErr({ general: ex.message }); setEnv(false); }
    };

    return (
        <Modal titulo="Nueva orden de compra" subtitulo="Es el pedido al proveedor, antes de la factura. Cuando llegue mercancía, se recibe aquí (parcial o completa)." cerrar={cerrar} onSubmit={guardar} enviando={env} ok="Crear orden" ancho="max-w-[760px]">
            <div className="grid gap-4 sm:grid-cols-2">
                <Field select label="Proveedor" forceFloat value={proveedor} onChange={(e) => setProveedor(e.target.value)} error={err.proveedor}>
                    {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </Field>
                <Field label="Nota (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} hint="Ej.: pedido por WhatsApp" />
            </div>
            <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold">Piezas pedidas</p>
                <button type="button" onClick={cargarSugerencia} disabled={cargSug} className="text-[13px] font-semibold text-brand hover:underline">{cargSug ? 'Calculando…' : 'Sugerir según stock y ventas'}</button>
            </div>
            {sugerencia && sugerencia.length > 0 && (
                <ul className="max-h-[170px] overflow-y-auto rounded-xl border border-line">
                    {sugerencia.map((f) => (
                        <li key={f.producto_id}>
                            <button type="button" disabled={filas.some((x) => x.producto_id === f.producto_id)} onClick={() => addSugerido(f)}
                                className="flex w-full items-center gap-3 border-b border-line px-3.5 py-2 text-left last:border-0 hover:bg-brand-50 disabled:opacity-40">
                                <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium">{f.nombre}</span>
                                    <span className="num block text-[12px] text-muted">stock {n0(f.stock)} · mínimo {n0(f.minimo)} · 30 días: {n0(f.consumo_30d)}{f.dias_para_agotar !== null ? ` · se agota en ${n0(f.dias_para_agotar)} días` : ''}</span></span>
                                <span className="num shrink-0 text-[13px] font-semibold text-brand">+{n0(f.sugerido)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {sugerencia && sugerencia.length === 0 && <p className="text-[12.5px] text-muted">No hay piezas por reponer según el mínimo y las ventas de los últimos 30 días.</p>}
            {filas.length > 0 && (
                <ul className="divide-y divide-line rounded-xl border border-line">
                    {filas.map((f, i) => (
                        <li key={f.producto_id} className="px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                                <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{f.nombre}</span>
                                    <span className="num block text-[12px] text-muted">{f.sku}{presentacionDe(f) ? ` · se compra en ${presentacionDe(f)}` : ''}</span></span>
                                <button type="button" aria-label="Quitar" onClick={() => setFilas(filas.filter((x, k) => k !== i))} className="grid size-8 place-items-center rounded-md text-muted hover:bg-[#fdecec] hover:text-danger"><X className="size-4" /></button>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-3">
                                <Field label={f.unidad_compra ? `Cantidad en ${f.unidad_compra}` : `Cantidad (${f.unidad})`} inputMode="decimal" value={f.cantidad} onChange={(e) => setFilas(filas.map((x, k) => (k === i ? { ...x, cantidad: e.target.value } : x)))} className="[&_input]:num"
                                    hint={piezasTxt({ ...f, cantidad: num(f.cantidad) }, num(f.cantidad))} />
                                <Field label="Costo estimado US$ c/u (opcional)" inputMode="decimal" value={String(f.costo ?? '')} onChange={(e) => setFilas(filas.map((x, k) => (k === i ? { ...x, costo: e.target.value } : x)))} className="[&_input]:num" />
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <Field label="Buscar pieza para agregar" icon={Search} value={q} onChange={(e) => buscar(e.target.value)} />
            {q.trim().length >= 2 && res.length > 0 && (
                <ul className="max-h-[160px] overflow-y-auto rounded-xl border border-line">
                    {res.map((p) => (
                        <li key={p.id} className="border-b border-line last:border-0">
                            <button type="button" onClick={() => { if (!filas.some((x) => x.producto_id === p.id)) setFilas([...filas, { producto_id: p.id, sku: p.sku, nombre: p.nombre, unidad: p.unidad, unidad_compra: null, presentacion: 1, cantidad: String(p.stock <= 0 ? 10 : Math.max(10, Math.round(p.stock / 2))), costo: p.costo_usd || '' }]); setQ(''); setRes([]); }} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-brand-50">
                                <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px]">{p.nombre}</span><span className="num block text-[12px] text-muted">{p.sku} · stock {n0(p.stock)}</span></span>
                                <span className="num shrink-0 text-[13px]">{usd(p.costo_usd)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {err.items && <p className="text-[13px] text-danger">{err.items}</p>}
            {err.general && <p className="text-[13px] text-danger">{err.general}</p>}
        </Modal>
    );
}

/* Recepción parcial: cantidad por pieza (en presentaciones si el producto se compra en caja) y costo real de la factura. */
function ModalRecibir({ orden, cerrar, hecho }) {
    const [f, setF] = useState({ factura: '', control: '', fecha: orden.fecha, moneda: 'USD', condicion: 'CONTADO', dias: '0' });
    const [rec, setRec] = useState(() => Object.fromEntries(orden.lineas.filter((l) => l.pendiente > 0).map((l) => [l.producto_id, { cant: String(l.pendiente).replace('.', ','), costo: l.costo_estimado ? String(l.costo_estimado).replace('.', ',') : '' }])));
    const [env, setEnv] = useState(false);
    const [err, setErr] = useState('');
    const lineas = orden.lineas.filter((l) => l.pendiente > 0 && (num(rec[l.producto_id]?.cant) || 0) > 0);
    const guardar = async () => {
        setErr('');
        if (!f.factura.trim()) { setErr('Escribe el número de la factura del proveedor.'); return; }
        if (!lineas.length) { setErr('Indica la cantidad que está llegando de al menos una pieza.'); return; }
        setEnv(true);
        try {
            const r = await http('POST', `/ordenes-compra/${orden.id}/recibir`, {
                numero_factura: f.factura.trim(), fecha_factura: f.fecha, moneda: f.moneda, numero_control: f.control.trim() || null,
                condicion: f.condicion, dias_credito: num(f.dias) || 0, observaciones: `Recepción de la orden OC-${orden.numero}`,
                items: lineas.map((l) => ({ producto_id: l.producto_id, cantidad: rec[l.producto_id].cant, costo_unitario: rec[l.producto_id].costo === '' ? 0 : rec[l.producto_id].costo })),
            });
            hecho(r.compra_id); cerrar();
        } catch (ex) { setErr(ex.message); setEnv(false); }
    };
    return (
        <Modal titulo={`Recibir orden OC-${orden.numero}`} subtitulo={`Proveedor: ${orden.proveedor}. Se registra la factura real en Compras y se abona a la orden; si falta, queda PARCIAL.`} cerrar={cerrar} onSubmit={guardar} enviando={env} ok="Registrar recepción" ancho="max-w-[760px]">
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="N.º de factura del proveedor" value={f.factura} onChange={(e) => setF({ ...f, factura: e.target.value })} autoFocus />
                <Field label="N.º de control (opcional)" value={f.control} onChange={(e) => setF({ ...f, control: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Fecha de factura" type="date" forceFloat value={f.fecha} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
                <Field select label="Moneda" forceFloat value={f.moneda} onChange={(e) => setF({ ...f, moneda: e.target.value })}><option value="USD">USD</option><option value="VES">Bs</option></Field>
                <Field select label="Condición" forceFloat value={f.condicion} onChange={(e) => setF({ ...f, condicion: e.target.value })}><option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option></Field>
                {f.condicion === 'CREDITO' && <Field label="Días de crédito" inputMode="numeric" value={f.dias} onChange={(e) => setF({ ...f, dias: e.target.value })} className="[&_input]:num" />}
            </div>
            <p className="mt-1 text-[13px] font-semibold">¿Qué llegó?</p>
            <ul className="divide-y divide-line rounded-xl border border-line">
                {orden.lineas.filter((l) => l.pendiente > 0).map((l) => (
                    <li key={l.producto_id} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                            <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{l.nombre}</span>
                                <span className="num block text-[12px] text-muted">{l.sku} · pedidas {n0(l.pedida)} · pendientes <b>{n0(l.pendiente)}</b>{presentacionDe(l) ? ` · se compra en ${presentacionDe(l)}` : ''}</span></span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                            <Field label={l.unidad_compra ? `Llegaron (${l.unidad_compra})` : `Llegaron (${l.unidad})`} inputMode="decimal" value={rec[l.producto_id].cant} onChange={(e) => setRec({ ...rec, [l.producto_id]: { ...rec[l.producto_id], cant: e.target.value } })} className="[&_input]:num"
                                hint={l.unidad_compra && !Number.isNaN(num(rec[l.producto_id].cant)) ? `= ${n0(num(rec[l.producto_id].cant) * l.presentacion)} ${l.unidad}` : undefined} />
                            <Field label={`Costo unitario (${f.moneda === 'USD' ? 'US$' : 'Bs'}) sin IVA`} inputMode="decimal" value={rec[l.producto_id].costo} onChange={(e) => setRec({ ...rec, [l.producto_id]: { ...rec[l.producto_id], costo: e.target.value } })} className="[&_input]:num" />
                        </div>
                    </li>
                ))}
            </ul>
            {err && <p className="text-[13px] text-danger">{err}</p>}
        </Modal>
    );
}

export default function OrdenesCompra(p) {
    const { negocio, usuario, fecha_larga, stock_bajo, tasa_usd, ordenes, kpi, proveedores } = p;
    const [ver, setVer] = useState(p.ver || 'pendientes');
    const [modal, setModal] = useState(null);   // 'nueva' | {tipo:'recibir'|'cerrar'|'anular', o}
    const [abierto, setAbierto] = useState(null);   // orden expandida
    const [err, setErr] = useState('');
    const recargar = () => router.get('/ordenes-compra', { ver }, { preserveScroll: true, preserveState: false });

    const accion = async (url, cuerpo, ok) => {
        setErr('');
        try { await http('POST', url, cuerpo); recargar(); } catch (e) { setErr(e.message); }
    };

    return (
        <AppLayout actual="/ordenes-compra" titulo="Órdenes de compra" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Órdenes de compra" />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Órdenes de compra</h2>
                    <p className="mt-1 max-w-[62ch] text-[15px] text-muted">Pide al proveedor antes de la factura y recibe en tandas: lo que falta queda como backorder abierto hasta que llegue o se cierre.</p></div>
                <Button onClick={() => setModal('nueva')}><Plus className="size-4" />Nueva orden</Button>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-3">
                <Kpi icon={ClipboardCheck} titulo="Órdenes abiertas" valor={n0(kpi.abiertas)} detalle="Enviadas o con recepción parcial" tono={kpi.abiertas > 0 ? 'warn' : undefined} />
                <Kpi icon={AlertTriangle} titulo="Piezas pendientes" valor={n0(kpi.pendiente_piezas)} detalle="Backorder por recibir" />
                <Kpi icon={FileSpreadsheet} titulo="Valor estimado" valor={usd(kpi.estimado_usd)} detalle="A los costos estimados del pedido" />
            </div>

            {err && <p role="alert" className="mb-4 rounded-lg bg-[#fdecec] px-4 py-3 text-[13px] text-danger">{err}</p>}

            <Card>
                <div className="flex items-center justify-between gap-3 border-b border-line p-4 sm:p-5">
                    <h2 className="text-[15px] font-semibold">{ver === 'pendientes' ? 'Órdenes pendientes' : 'Todas las órdenes'}</h2>
                    <div role="radiogroup" aria-label="Vista" className="inline-flex rounded-lg bg-[#e9ecf0] p-1 text-[13px]">
                        {[['pendientes', 'Pendientes'], ['todas', 'Historial']].map(([k, l]) => (
                            <button key={k} role="radio" aria-checked={ver === k} onClick={() => { setVer(k); router.get('/ordenes-compra', { ver: k }, { preserveScroll: true, preserveState: false }); }}
                                className={`rounded-md px-3 py-1.5 font-medium ${ver === k ? 'bg-white shadow-sm' : 'text-muted hover:text-text'}`}>{l}</button>
                        ))}
                    </div>
                </div>
                {ordenes.length === 0 ? (
                    <Vacio icon={ClipboardCheck} titulo="No hay órdenes" texto="Crea una orden, márcala como enviada y cuando llegue la mercancía registra la factura con «Recibir»." >
                        <Button onClick={() => setModal('nueva')}><Plus className="size-4" />Nueva orden</Button>
                    </Vacio>
                ) : (
                    <ul>
                        {ordenes.map((o) => (
                            <li key={o.id} className="border-b border-line last:border-0">
                                <button type="button" onClick={() => setAbierto(abierto === o.id ? null : o.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 text-left hover:bg-paper">
                                    <span className="num w-[92px] shrink-0 text-[14px] font-bold">OC-{String(o.numero).padStart(4, '0')}</span>
                                    <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-semibold">{o.proveedor}</span>
                                        <span className="block truncate text-[12.5px] text-muted">{o.fecha} · {o.n_lineas} piezas · {o.por}</span></span>
                                    <span className="num shrink-0 text-[13px] text-muted">{n0(o.recibido)}/{n0(o.pedido)} recibidas</span>
                                    <span className="shrink-0"><Pill e={o.estado} /></span>
                                    <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${abierto === o.id ? 'rotate-180' : ''}`} />
                                </button>
                                {abierto === o.id && (
                                    <div className="border-t border-line bg-paper/60 px-5 py-4">
                                        {o.observaciones && <p className="mb-2 text-[13px] text-muted">Nota: {o.observaciones}</p>}
                                        <table className="w-full text-[13px]">
                                            <thead><tr className="text-left text-[12px] text-muted"><th className="py-1.5">Pieza</th><th className="text-right">Pedida</th><th className="text-right">Recibida</th><th className="text-right">Pendiente</th><th className="text-right">Costo est.</th></tr></thead>
                                            <tbody>{o.lineas.map((l) => (
                                                <tr key={l.producto_id} className="border-t border-line">
                                                    <td className="py-1.5"><span className="font-medium">{l.nombre}</span><span className="num block text-[11.5px] text-muted">{l.sku}{presentacionDe(l) ? ` · ${presentacionDe(l)}` : ''}</span></td>
                                                    <td className="num py-1.5 text-right">{n0(l.pedida)}</td>
                                                    <td className="num py-1.5 text-right">{n0(l.recibida)}</td>
                                                    <td className={`num py-1.5 text-right font-semibold ${l.pendiente > 0 ? 'text-[#8a5a00]' : 'text-ok'}`}>{n0(l.pendiente)}</td>
                                                    <td className="num py-1.5 text-right">{l.costo_estimado !== null ? usd(l.costo_estimado) : '—'}</td>
                                                </tr>))}
                                            </tbody>
                                        </table>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {o.estado === 'BORRADOR' && <Button onClick={() => accion(`/ordenes-compra/${o.id}/enviar`)} className="!h-10 !px-3.5 !text-[13.5px]"><Send className="size-4" />Marcar como enviada</Button>}
                                            {['ENVIADA', 'PARCIAL'].includes(o.estado) && <Button onClick={() => setModal({ tipo: 'recibir', o })} className="!h-10 !px-3.5 !text-[13.5px]"><Check className="size-4" />Recibir mercancía</Button>}
                                            {['ENVIADA', 'PARCIAL'].includes(o.estado) && <button type="button" onClick={() => { const m = window.prompt('¿Por qué se cierra la orden? (ej.: el proveedor no tiene más)'); if (m && m.trim().length >= 3) accion(`/ordenes-compra/${o.id}/cerrar`, { motivo: m.trim() }); }} className="inline-flex h-10 items-center rounded-lg border border-line px-3.5 text-[13.5px] font-semibold hover:bg-white">Cerrar backorder</button>}
                                            {['BORRADOR', 'ENVIADA'].includes(o.estado) && <button type="button" onClick={() => { const m = window.prompt('¿Por qué se anula la orden?'); if (m && m.trim().length >= 3) accion(`/ordenes-compra/${o.id}/anular`, { motivo: m.trim() }); }} className="inline-flex h-10 items-center rounded-lg px-2.5 text-[13px] font-semibold text-muted hover:text-danger">Anular</button>}
                                        </div>
                                        {o.cerrada_motivo && <p className="mt-2 text-[12.5px] text-muted">Cerrada el {o.cerrada_en}: {o.cerrada_motivo}</p>}
                                        {o.anulada_motivo && <p className="mt-2 text-[12.5px] text-muted">Anulada: {o.anulada_motivo}</p>}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {modal === 'nueva' && <ModalNueva proveedores={proveedores} cerrar={() => setModal(null)} hecho={recargar} />}
            {modal?.tipo === 'recibir' && <ModalRecibir orden={modal.o} cerrar={() => setModal(null)} hecho={(compraId) => { recargar(); }} />}
        </AppLayout>
    );
}
