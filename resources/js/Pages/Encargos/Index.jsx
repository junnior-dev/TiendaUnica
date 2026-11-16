import { Head, router } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import { Bike, CalendarClock, Check, ClipboardList, Download, Phone, Plus, Printer, Search, Truck, Wallet } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi, Modal, Vacio } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { http } from '../../lib/http';
import { n0, n2, usd } from '../../lib/format';

const ESTADOS = {
    SOLICITADO: { t: 'Solicitado', c: 'bg-paper text-muted' },
    ORDENADO: { t: 'Pedido al proveedor', c: 'bg-brand-50 text-brand' },
    RECIBIDO: { t: 'Llegó la pieza', c: 'bg-[#e7f6ee] text-ok' },
    AVISADO: { t: 'Avisado al cliente', c: 'bg-signal/15 text-[#8a5a00]' },
    ENTREGADO: { t: 'Entregado', c: 'bg-brand text-white' },
    CANCELADO: { t: 'Cancelado', c: 'bg-[#fdecec] text-danger' },
    ANULADO: { t: 'Anulado', c: 'bg-[#fdecec] text-danger' },
};
const Pill = ({ e }) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADOS[e]?.c || 'bg-paper text-muted'}`}>{ESTADOS[e]?.t || e}</span>;

/* Buscador de cliente reutilizado del POS (/caja/clientes). */
function BuscarCliente({ elegir }) {
    const [q, setQ] = useState('');
    const [res, setRes] = useState([]);
    const [cargando, setCargando] = useState(false);
    useMemo(() => {}, []);
    const buscar = (texto) => {
        const t = texto.trim();
        setQ(texto);
        if (t.length < 2) { setRes([]); return; }
        setCargando(true);
        clearTimeout(buscar._t);
        buscar._t = setTimeout(async () => {
            try { setRes(await http('GET', `/caja/clientes?q=${encodeURIComponent(t)}`)); } catch { setRes([]); }
            setCargando(false);
        }, 250);
    };
    return (
        <div>
            <Field label="Buscar cliente por cédula, RIF o nombre" icon={Search} value={q} onChange={(e) => buscar(e.target.value)} autoFocus />
            <div className="mt-3 min-h-[60px]">
                {q.trim().length >= 2 && res.length > 0 && (
                    <ul className="max-h-[210px] overflow-y-auto rounded-xl border border-line">
                        {res.map((c) => (
                            <li key={c.id} className="border-b border-line last:border-0">
                                <button type="button" onClick={() => elegir(c)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-brand-50">
                                    <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-semibold">{c.nombre}</span>
                                        <span className="num block truncate text-[12.5px] text-muted">{c.tipo}-{c.documento}{c.telefono ? ` · ${c.telefono}` : ''}</span></span>
                                    <Check className="size-4 shrink-0 text-brand opacity-0 [&_button:hover_&]:opacity-100" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {q.trim().length >= 2 && !cargando && res.length === 0 && <p className="px-1 py-3 text-[13px] text-muted">No hay clientes con «{q.trim()}». Regístralo en Clientes o desde el punto de venta.</p>}
            </div>
        </div>
    );
}

/* Buscador de producto reutilizado del POS (/caja/buscar) para asociar la pieza al encargo. */
function BuscarProducto({ elegir, quitar, elegido }) {
    const [q, setQ] = useState('');
    const [res, setRes] = useState([]);
    const buscar = (texto) => {
        const t = texto.trim();
        setQ(texto);
        if (t.length < 2) { setRes([]); return; }
        clearTimeout(buscar._t);
        buscar._t = setTimeout(async () => {
            try { setRes(await http('GET', `/caja/buscar?q=${encodeURIComponent(t)}`)); } catch { setRes([]); }
        }, 250);
    };
    if (elegido) {
        return (
            <div className="flex items-center gap-3 rounded-xl border border-line px-4 py-3">
                <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-semibold">{elegido.nombre}</span>
                    <span className="num block truncate text-[12.5px] text-muted">{elegido.sku} · quedan {n0(elegido.stock)}</span></span>
                <button type="button" onClick={quitar} className="text-[13px] font-semibold text-muted hover:text-danger">Quitar</button>
            </div>
        );
    }
    return (
        <div>
            <Field label="Producto del catálogo (opcional, para poder entregarlo)" icon={Search} value={q} onChange={(e) => buscar(e.target.value)} />
            {q.trim().length >= 2 && res.length > 0 && (
                <ul className="mt-2 max-h-[200px] overflow-y-auto rounded-xl border border-line">
                    {res.map((p) => (
                        <li key={p.id} className="border-b border-line last:border-0">
                            <button type="button" onClick={() => elegir(p)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-brand-50">
                                <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{p.nombre}</span>
                                    <span className="num block text-[12px] text-muted">{p.sku}</span></span>
                                <span className={`shrink-0 text-[12.5px] ${p.stock > 0 ? 'text-muted' : 'font-semibold text-danger'}`}>{p.stock > 0 ? `${n0(p.stock)}` : 'sin stock'}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <p className="mt-1.5 text-[12.5px] leading-snug text-muted">Si la pieza no está en el catálogo, deja esto vacío y descríbela: al llegar la creas para poder entregarla.</p>
        </div>
    );
}

export default function Encargos(p) {
    const { negocio, usuario, fecha_larga, stock_bajo, tasa_usd, encargos, kpi, metodos, caja_abierta } = p;
    const [tab, setTab] = useState('abiertos');
    const [q, setQ] = useState('');
    const [modal, setModal] = useState(null);   // 'nuevo' | {tipo:'anticipo', e} | {tipo:'entregar', e}
    const [err, setErr] = useState('');

    const lista = useMemo(() => {
        const t = q.trim().toLowerCase();
        return encargos.filter((e) => !t || `${e.descripcion} ${e.cliente} ${e.sku || ''} ${e.producto || ''}`.toLowerCase().includes(t));
    }, [encargos, q]);

    const recargar = () => router.get('/encargos', { estado: tab }, { preserveScroll: true, preserveState: false });

    const cambiarEstado = async (e, estado, nota = null) => {
        setErr('');
        try { await http('POST', `/encargos/${e.id}/estado`, { estado, nota }); recargar(); }
        catch (ex) { setErr(ex.message); }
    };

    /* Ticket térmico de «Retiro de pieza»: se imprime al recibir el encargo y se reimprime al avisar. */
    const ticket = async (e, descargar) => {
        setErr('');
        try {
            const d = await http('GET', `/encargos/${e.id}`);
            const { construirPdfRetiro } = await import('../../lib/pdfRetiro');
            const { abrirPdf } = await import('../../lib/pdfVenta');
            abrirPdf(await construirPdfRetiro(d), { imprimir: !descargar, descargar, nombre: `encargo-ENC-${String(e.id).padStart(4, '0')}.pdf` });
        } catch (ex) { setErr(ex.message); }
    };

    return (
        <AppLayout actual="/encargos" titulo="Encargos de piezas" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Encargos de piezas" />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Encargos de piezas</h2>
                    <p className="mt-1 max-w-[62ch] text-[15px] text-muted">Lo que el cliente pidió y no había: cobra el anticipo, pídelo al proveedor, avísale cuando llegue y entrégalo con su venta.</p></div>
                <Button onClick={() => setModal('nuevo')}><Plus className="size-4" />Nuevo encargo</Button>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Kpi icon={Truck} titulo="Por pedir al proveedor" valor={n0(kpi.por_pedir)} detalle="Solicitados sin orden todavía" />
                <Kpi icon={ClipboardList} titulo="Llegaron por avisar" valor={n0(kpi.por_avisar)} detalle="Pídele al cliente que pase" tono={kpi.por_avisar > 0 ? 'warn' : undefined} />
                <Kpi icon={Wallet} titulo="Por entregar" valor={n0(kpi.por_entregar)} detalle="Ya avisados, esperando el cobro" tono={kpi.por_entregar > 0 ? 'warn' : undefined} />
                <Kpi icon={Phone} titulo="Anticipos pendientes" valor={usd(kpi.anticipos_pendientes)} detalle="Dinero de clientes por piezas" />
            </div>

            {!caja_abierta && <p className="mb-4 rounded-xl border border-signal/60 bg-signal/10 px-4 py-3 text-[13.5px] text-[#6b4a00]">No tienes caja abierta: puedes revisar y cambiar estados, pero el anticipo y la entrega se hacen con la caja abierta.</p>}
            {err && <p role="alert" className="mb-4 rounded-lg bg-[#fdecec] px-4 py-3 text-[13px] text-danger">{err}</p>}

            <Card>
                <div className="flex flex-wrap items-center gap-3 border-b border-line p-4 sm:p-5">
                    <label className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Buscar encargo" placeholder="Buscar por cliente, pieza o código" className="h-11 w-full rounded-lg border border-line bg-paper pl-10 pr-3 text-[15px] placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" /></label>
                    <div role="radiogroup" aria-label="Vista" className="inline-flex rounded-lg bg-[#e9ecf0] p-1 text-[13px]">
                        {[['abiertos', 'Abiertos'], ['historial', 'Historial']].map(([k, l]) => (
                            <button key={k} role="radio" aria-checked={tab === k} onClick={() => { setTab(k); router.get('/encargos', { estado: k }, { preserveScroll: true, preserveState: false }); }}
                                className={`rounded-md px-3 py-1.5 font-medium ${tab === k ? 'bg-white shadow-sm' : 'text-muted hover:text-text'}`}>{l}</button>
                        ))}
                    </div>
                </div>
                {lista.length === 0 ? (
                    <Vacio icon={ClipboardList} titulo={tab === 'abiertos' ? 'No hay encargos abiertos' : 'Nada en el historial'}
                        texto={tab === 'abiertos' ? 'Cuando un cliente pida una pieza que no tienes, regístrala aquí y no se te olvida ni se pierde el anticipo.' : 'Cambia a la pestaña «Abiertos» o registra un encargo nuevo.'}>
                        <Button onClick={() => setModal('nuevo')}><Plus className="size-4" />Nuevo encargo</Button>
                    </Vacio>
                ) : (
                    <ul>
                        {lista.map((e) => (
                            <li key={e.id} className="border-b border-line px-5 py-4 last:border-0">
                                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                                            Encargo {String(e.id).padStart(4, '0')} <Pill e={e.estado} />
                                            {tab === 'abiertos' && e.dias >= 3 && <span className="num rounded-full bg-signal/15 px-2 py-0.5 text-xs font-semibold text-[#8a5a00]">{e.dias} días</span>}
                                        </p>
                                        <p className="mt-0.5 text-[14px]">{e.descripcion}{e.cantidad !== 1 && <span className="num text-muted"> × {n0(e.cantidad)}</span>}</p>
                                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-muted">
                                            <span>{e.cliente} · {e.documento}{e.telefono ? ` · ${e.telefono}` : ''}</span>
                                            {e.producto && <span className="num">{e.sku} · stock {n0(e.stock)}</span>}
                                            {e.moto && <span className="flex items-center gap-1"><Bike className="size-3.5" />{e.moto}</span>}
                                            <span className="flex items-center gap-1"><CalendarClock className="size-3.5" />{e.creado}{e.por ? ` · ${e.por}` : ''}</span>
                                        </p>
                                        <p className="mt-1 text-[13px]">
                                            Anticipos: <b className="num">{usd(e.anticipado)}</b> ({e.n_anticipos})
                                            {e.precio_estimado !== null && <span className="text-muted"> · precio pactado {usd(e.precio_estimado)}</span>}
                                            {e.nota_proveedor && <span className="text-muted"> · proveedor: {e.nota_proveedor}</span>}
                                            {e.venta_id && <> · <a href={`/ventas/${e.venta_id}`} className="font-semibold text-brand hover:underline">venta {String(e.venta_id).padStart(6, '0')}</a></>}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button type="button" onClick={() => ticket(e, false)} title="Imprimir el ticket de retiro de la pieza"
                                            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line px-3.5 text-[13.5px] font-semibold hover:bg-paper"><Printer className="size-4" />Ticket</button>
                                        <button type="button" onClick={() => ticket(e, true)} title="Descargar el ticket en PDF" aria-label={`Descargar el ticket de retiro del encargo ${String(e.id).padStart(4, '0')}`}
                                            className="grid size-10 place-items-center rounded-lg border border-line hover:bg-paper"><Download className="size-4" /></button>
                                        {e.estado === 'SOLICITADO' && <>
                                            <Button onClick={() => setModal({ tipo: 'anticipo', e })} className="!h-10 !px-3.5 !text-[13.5px]"><Wallet className="size-4" />Anticipo</Button>
                                            <button type="button" onClick={() => cambiarEstado(e, 'ORDENADO')} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line px-3.5 text-[13.5px] font-semibold hover:bg-paper"><Truck className="size-4" />Pedir</button>
                                        </>}
                                        {e.estado === 'ORDENADO' && <>
                                            <Button onClick={() => setModal({ tipo: 'anticipo', e })} className="!h-10 !px-3.5 !text-[13.5px]"><Wallet className="size-4" />Anticipo</Button>
                                            <button type="button" onClick={() => cambiarEstado(e, 'RECIBIDO')} className="inline-flex h-10 items-center rounded-lg bg-brand px-3.5 text-[13.5px] font-semibold text-white hover:bg-brand-600">Llegó la pieza</button>
                                        </>}
                                        {(e.estado === 'RECIBIDO' || e.estado === 'AVISADO') && <>
                                            {e.estado === 'RECIBIDO' && <button type="button" onClick={() => cambiarEstado(e, 'AVISADO')} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line px-3.5 text-[13.5px] font-semibold hover:bg-paper"><Phone className="size-4" />Avisar</button>}
                                            <Button onClick={() => setModal({ tipo: 'entregar', e })} className="!h-10 !px-3.5 !text-[13.5px]"><Check className="size-4" />Entregar y cobrar</Button>
                                        </>}
                                        {['SOLICITADO', 'ORDENADO', 'RECIBIDO', 'AVISADO'].includes(e.estado) && (
                                            <button type="button" onClick={() => { const m = window.prompt(`¿Por qué se cancela el encargo ${String(e.id).padStart(4, '0')}?`); if (m && m.trim().length >= 3) cambiarEstado(e, 'CANCELADO', m.trim()); }} className="inline-flex h-10 items-center rounded-lg px-2.5 text-[13px] font-semibold text-muted hover:text-danger">Cancelar</button>
                                        )}
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {modal === 'nuevo' && <ModalNuevo cerrar={() => setModal(null)} hecho={recargar} />}
            {modal?.tipo === 'anticipo' && <ModalAnticipo e={modal.e} metodos={metodos} cerrar={() => setModal(null)} hecho={recargar} />}
            {modal?.tipo === 'entregar' && <ModalEntregar e={modal.e} metodos={metodos} cerrar={() => setModal(null)} hecho={recargar} />}
        </AppLayout>
    );
}

function ModalNuevo({ cerrar, hecho }) {
    const [cliente, setCliente] = useState(null);
    const [prod, setProd] = useState(null);
    const [f, setF] = useState({ descripcion: '', cantidad: '1', precio: '' });
    const [env, setEnv] = useState(false);
    const [err, setErr] = useState({});
    const guardar = async () => {
        const e = {};
        if (!cliente) e.cliente = 'Elige el cliente que encarga la pieza.';
        if (f.descripcion.trim().length < 3) e.descripcion = 'Describe la pieza (marca, medida, modelo…).';
        setErr(e);
        if (Object.keys(e).length) return;
        setEnv(true);
        try {
            await http('POST', '/encargos', { cliente_id: cliente.id, descripcion: f.descripcion.trim(), cantidad: f.cantidad || 1,
                producto_id: prod?.id ?? null, precio_estimado: f.precio === '' ? null : f.precio });
            hecho(); cerrar();
        } catch (ex) { setErr({ general: ex.message }); setEnv(false); }
    };
    return (
        <Modal titulo="Nuevo encargo" subtitulo="Registra la pieza que el cliente pidió y no tienes en el mostrador." cerrar={cerrar} onSubmit={guardar} enviando={env} ok="Registrar encargo" ancho="max-w-[560px]">
            <BuscarCliente elegir={setCliente} />
            {err.cliente && <p className="-mt-2 text-[13px] text-danger">{err.cliente}</p>}
            {cliente && <p className="rounded-lg bg-brand-50 px-3.5 py-2.5 text-[13.5px] font-semibold text-brand">{cliente.nombre} · {cliente.tipo}-{cliente.documento}</p>}
            <Field label="¿Qué encargó? (marca, medida, modelo…)" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} error={err.descripcion} />
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Cantidad" inputMode="decimal" value={f.cantidad} onChange={(e) => setF({ ...f, cantidad: e.target.value })} className="[&_input]:num" />
                <Field label="Precio pactado US$ (opcional)" inputMode="decimal" value={f.precio} onChange={(e) => setF({ ...f, precio: e.target.value })} className="[&_input]:num" />
            </div>
            <BuscarProducto elegido={prod} elegir={setProd} quitar={() => setProd(null)} />
            {err.general && <p className="text-[13px] text-danger">{err.general}</p>}
        </Modal>
    );
}

function ModalAnticipo({ e, metodos, cerrar, hecho }) {
    const [f, setF] = useState({ metodo: metodos[0]?.id || '', monto: '', ref: '' });
    const [env, setEnv] = useState(false);
    const [err, setErr] = useState('');
    const metodo = metodos.find((m) => m.id === Number(f.metodo));
    const guardar = async () => {
        setErr('');
        setEnv(true);
        try {
            await http('POST', `/encargos/${e.id}/anticipo`, { metodo_pago_id: Number(f.metodo), monto: f.monto, referencia: f.ref.trim() || null });
            hecho(); cerrar();
        } catch (ex) { setErr(ex.message); setEnv(false); }
    };
    return (
        <Modal titulo={`Anticipo del encargo ${String(e.id).padStart(4, '0')}`} subtitulo={`Cliente: ${e.cliente} · precio pactado ${e.precio_estimado !== null ? usd(e.precio_estimado) : 'sin definir'}. El dinero entra a tu caja como ingreso.`} cerrar={cerrar} onSubmit={guardar} enviando={env} ok="Cobrar anticipo">
            <div className="grid gap-4 sm:grid-cols-2">
                <Field select label="Método de pago" forceFloat value={f.metodo} onChange={(ev) => setF({ ...f, metodo: ev.target.value })}>
                    {metodos.map((m) => <option key={m.id} value={m.id}>{m.nombre} ({m.moneda})</option>)}
                </Field>
                <Field label="Monto del anticipo (en la moneda del método)" inputMode="decimal" value={f.monto} onChange={(ev) => setF({ ...f, monto: ev.target.value })} error={err} className="[&_input]:num" autoFocus />
            </div>
            {metodo?.referencia && <Field label="N.º de referencia" value={f.ref} onChange={(ev) => setF({ ...f, ref: ev.target.value })} />}
            <p className="text-[13px] leading-snug text-muted">Al entregar la pieza este anticipo se aplica a la venta automáticamente y no se vuelve a contar en la gaveta.</p>
        </Modal>
    );
}

function ModalEntregar({ e, metodos, cerrar, hecho }) {
    const resto = Math.max(0, (e.precio_estimado ?? 0) - e.anticipado);
    const [filas, setFilas] = useState(resto > 0 ? [{ metodo: metodos[0]?.id || '', monto: String(resto).replace('.', ','), ref: '' }] : []);
    const [desc, setDesc] = useState('');
    const [doc, setDoc] = useState(null);
    const [env, setEnv] = useState(false);
    const [err, setErr] = useState('');
    const totalUsd = Number(((e.precio_estimado ?? 0) * (1 - (Number(desc.replace(',', '.')) || 0) / 100)).toFixed(2));
    const faltanUsd = Math.max(0, Number((totalUsd - e.anticipado - filas.reduce((s, f) => s + (Number(f.monto.replace(',', '.')) || 0), 0)).toFixed(2)));
    const entregar = async () => {
        setErr('');
        setEnv(true);
        try {
            const r = await http('POST', `/encargos/${e.id}/entregar`, {
                pagos: filas.filter((f) => (Number(f.monto.replace(',', '.')) || 0) > 0).map((f) => ({ metodo_pago_id: Number(f.metodo), monto: f.monto, referencia: f.ref.trim() || null })),
                descuento_pct: desc === '' ? null : desc,
            });
            setDoc(r.documento);
        } catch (ex) { setErr(ex.message); }
        setEnv(false);
    };
    return (
        <Modal titulo={`Entregar encargo ${String(e.id).padStart(4, '0')}`} subtitulo={`Se registra la venta de la pieza con precio vigente. Anticipos aplicados: ${usd(e.anticipado)}.`} cerrar={() => { setDoc(null); cerrar(); }} onSubmit={entregar} enviando={env} ok={doc ? 'Listo' : 'Entregar y cobrar'} ancho="max-w-[620px]">
            {doc ? (
                <div className="rounded-xl bg-[#e8f5ee] p-4 text-[14px]">
                    <p className="flex items-center gap-2 font-semibold text-ok"><Check className="size-5" />Entregado y vendido.</p>
                    <p className="num mt-1 text-muted">Venta N.º {String(doc.numero).padStart(6, '0')} · total {usd(doc.totales.total_usd)}</p>
                    <a href={`/caja/venta/${doc.id}`} className="mt-2 inline-block text-[13px] font-semibold text-brand hover:underline">Abrir la venta para imprimir</a>
                </div>
            ) : <>
                <p className="rounded-lg bg-paper px-3.5 py-2.5 text-[13.5px] text-muted">Pieza: <b className="text-text">{e.producto || e.descripcion}</b>{e.precio_estimado !== null && <> · pactado {usd(e.precio_estimado)} · anticipos {usd(e.anticipado)}</>}</p>
                {filas.length === 0 && <p className="text-[13px] text-muted">Los anticipos cubren el total pactado; si el precio de hoy es mayor, agrega el pago del resto.</p>}
                {filas.map((f, i) => (
                    <div key={i} className="grid gap-4 sm:grid-cols-2">
                        <Field select label={`Método del pago ${filas.length > 1 ? i + 1 : ''}`} forceFloat value={f.metodo} onChange={(ev) => setFilas(filas.map((x, k) => (k === i ? { ...x, metodo: ev.target.value } : x)))}>
                            {metodos.map((m) => <option key={m.id} value={m.id}>{m.nombre} ({m.moneda})</option>)}
                        </Field>
                        <Field label="Monto (en la moneda del método)" inputMode="decimal" value={f.monto} onChange={(ev) => setFilas(filas.map((x, k) => (k === i ? { ...x, monto: ev.target.value } : x)))} className="[&_input]:num" />
                    </div>
                ))}
                {e.precio_estimado !== null && <p className="num text-[13.5px] text-muted">Faltarían {usd(faltanUsd)} con estos pagos (el sistema valida con el precio y el IVA vigentes).</p>}
                {e.precio_estimado !== null && <Field label="Descuento al precio pactado % (opcional)" inputMode="decimal" value={desc} onChange={(ev) => setDesc(ev.target.value)} className="[&_input]:num" />}
                <button type="button" onClick={() => setFilas([...filas, { metodo: metodos[0]?.id || '', monto: '', ref: '' }])} className="self-start text-[13.5px] font-semibold text-brand hover:underline">+ Agregar otro pago</button>
                {err && <p className="text-[13px] text-danger">{err}</p>}
            </>}
        </Modal>
    );
}
