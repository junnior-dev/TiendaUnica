import { Head, Link, router } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import { Bike, Gauge, Layers, Loader2, MousePointerClick, PackagePlus, PackageSearch, Pencil, Plus, Puzzle, Trash2, Wrench } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import ArbolMotos from '../../Components/ArbolMotos';
import { Card, Kpi, Modal } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { n0 } from '../../lib/format';

function Detalle({ modelo, onEditar, onEliminar }) {
    const [d, setD] = useState(null);
    useEffect(() => { setD(null); fetch(`/modelos/${modelo.id}`, { headers: { Accept: 'application/json' } }).then((r) => r.json()).then(setD); }, [modelo.id, modelo.productos]);
    const sin = modelo.productos === 0;
    return (
        <Card className="overflow-hidden">
            <div className="flex flex-wrap items-start gap-4 border-b border-line p-5 sm:p-6">
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-ink text-white"><Bike className="size-7" /></span>
                <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-muted">{modelo.marca}</p>
                    <h3 className="text-[24px] font-semibold leading-tight tracking-[-0.02em]">{modelo.modelo}</h3>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                        {modelo.cilindrada ? <span className="inline-flex items-center gap-1.5"><Gauge className="size-4" />{modelo.cilindrada} cc</span> : <span>Sin cilindrada anotada</span>}
                        <span className={`inline-flex items-center gap-1.5 ${sin ? 'text-[#a86a00]' : ''}`}><Wrench className="size-4" />{sin ? 'Sin repuestos asignados' : `${n0(modelo.productos)} ${modelo.productos === 1 ? 'repuesto compatible' : 'repuestos compatibles'}`}</span>
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" onClick={onEditar}><Pencil className="size-4" />Editar</Button>
                    <button onClick={onEliminar} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line px-4 text-[15px] font-semibold text-danger hover:bg-[#fdecec]"><Trash2 className="size-4" />Eliminar</button>
                </div>
            </div>

            <div className="p-5 sm:p-6">
                {sin ? (
                    <div className="rounded-xl border border-dashed border-[#e3c987] bg-[#fffaf0] p-5">
                        <p className="flex items-center gap-2 text-[15px] font-semibold"><PackageSearch className="size-[18px] text-[#a86a00]" />Esta moto todavía no tiene repuestos</p>
                        <p className="mt-1 max-w-[56ch] text-sm text-muted">Mientras no le asignes piezas, nadie la encontrará al buscar «qué le sirve a esta moto». Puedes asignarlas en pocos clics o copiarlas de una moto parecida.</p>
                        <Link href={`/compatibilidad?moto=${modelo.id}`} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-600"><PackagePlus className="size-4" />Asignar repuestos</Link>
                    </div>
                ) : !d ? <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Cargando repuestos…</p> : (<>
                    <h4 className="text-sm font-semibold">Qué categorías cubre</h4>
                    <div className="mt-2.5 flex flex-wrap gap-2">{d.categorias.map((c) => <span key={c.nombre} className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1 text-[13px]">{c.nombre}<span className="num font-semibold">{c.n}</span></span>)}</div>
                    <h4 className="mb-2.5 mt-6 text-sm font-semibold">Algunos repuestos compatibles</h4>
                    <ul className="divide-y divide-line rounded-xl border border-line">
                        {d.productos.map((p) => (
                            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                                <div className="min-w-0 flex-1"><p className="truncate font-medium">{p.nombre}</p><p className="text-xs text-muted">{p.sku} · {p.categoria}</p></div>
                                <span className={`num text-xs ${p.stock <= 0 ? 'font-semibold text-danger' : p.stock <= p.minimo ? 'font-semibold text-[#a86a00]' : 'text-muted'}`}>{p.stock <= 0 ? 'Agotado' : `${n0(p.stock)} en stock`}</span>
                            </li>))}
                    </ul>
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                        <Link href={`/compatibilidad?moto=${modelo.id}`} className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline"><Puzzle className="size-4" />Administrar compatibilidad</Link>
                        <Link href={`/productos?moto=${modelo.id}`} className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline"><Wrench className="size-4" />Ver en productos{d.total > d.productos.length ? ` (${n0(d.total)})` : ''}</Link>
                    </div></>)}
            </div>
        </Card>
    );
}

function DetalleMarca({ marca, modelos, onModelo, onNuevo, onRenombrar }) {
    const con = modelos.filter((m) => m.productos > 0).length;
    return (
        <Card className="overflow-hidden">
            <div className="flex flex-wrap items-start gap-4 border-b border-line p-5 sm:p-6">
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-ink text-white"><Layers className="size-7" /></span>
                <div className="min-w-0 flex-1"><p className="text-[13px] text-muted">Marca de moto</p><h3 className="text-[24px] font-semibold leading-tight tracking-[-0.02em]">{marca}</h3>
                    <p className="mt-1.5 text-sm text-muted">{modelos.length} {modelos.length === 1 ? 'modelo' : 'modelos'} · {con} con repuestos asignados</p></div>
                <div className="flex gap-2"><Button variant="ghost" onClick={onRenombrar}><Pencil className="size-4" />Cambiar nombre</Button><Button onClick={onNuevo}><Plus className="size-4" />Nuevo modelo</Button></div>
            </div>
            <div className="p-5 sm:p-6"><h4 className="mb-2.5 text-sm font-semibold">Modelos de {marca}</h4>
                <ul className="divide-y divide-line rounded-xl border border-line">{modelos.map((m) => (
                    <li key={m.id}><button onClick={() => onModelo(m)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-paper/70"><span className="min-w-0 flex-1 font-medium">{m.modelo}{m.cilindrada ? <span className="ml-2 font-normal text-muted">{m.cilindrada} cc</span> : null}</span>
                        {m.productos > 0 ? <span className="num text-muted">{n0(m.productos)} repuestos</span> : <span className="text-[#a86a00]">Sin repuestos</span>}</button></li>))}</ul>
                <p className="mt-3 text-[13px] text-muted">Elige un modelo para ver sus repuestos, editarlo o eliminarlo.</p></div>
        </Card>
    );
}

export default function Modelos({ negocio, usuario, fecha_larga, stock_bajo, tasa_usd, modelos }) {
    const [sel, setSel] = useState({ marca: null, id: null });
    const [edit, setEdit] = useState(null); const [borrar, setBorrar] = useState(null); const [renombrar, setRenombrar] = useState(null);
    const [enviando, setEnviando] = useState(false); const [errores, setErrores] = useState({});
    const detalle = useRef(null);
    const marcas = [...new Set(modelos.map((m) => m.marca))].sort();
    const modelo = modelos.find((m) => m.id === sel.id);
    const sin = modelos.filter((m) => m.productos === 0).length;
    const opts = { preserveScroll: true, onStart: () => setEnviando(true), onFinish: () => setEnviando(false) };
    const cerrar = () => { setEdit(null); setBorrar(null); setRenombrar(null); setErrores({}); };
    const elegir = (m) => { setSel({ marca: m.marca, id: m.id }); if (window.innerWidth < 1024) setTimeout(() => detalle.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };

    const guardar = () => {
        const e = {}, cc = edit.cilindrada === '' ? null : Number(edit.cilindrada);
        if (!edit.marca.trim()) e.marca = 'Escribe la marca de la moto.';
        if (!edit.modelo.trim()) e.modelo = 'Escribe el modelo.';
        if (cc !== null && (!Number.isInteger(cc) || cc <= 0)) e.cilindrada = 'Usa un número entero, por ejemplo 150.';
        setErrores(e); if (Object.keys(e).length) return;
        const datos = { marca: edit.marca.trim(), modelo: edit.modelo.trim(), cilindrada: cc };
        const o = { ...opts, onSuccess: () => { setSel({ marca: datos.marca, id: edit.id ?? null }); cerrar(); }, onError: (er) => setErrores(er) };
        edit.id ? router.put(`/modelos/${edit.id}`, datos, o) : router.post('/modelos', datos, o);
    };

    return (
        <AppLayout actual="/modelos" titulo="Modelos de moto" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Modelos de moto" />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Modelos de moto</h2><p className="mt-1 max-w-[62ch] text-[15px] text-muted">Las motos que atiendes. Elige una en el árbol para ver sus repuestos, editarla o eliminarla.</p></div>
                <Button onClick={() => setEdit({ marca: sel.marca ?? '', modelo: '', cilindrada: '' })}><Plus className="size-4" />Nuevo modelo</Button>
            </div>
            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-3">
                <Kpi icon={Bike} titulo="Modelos registrados" valor={n0(modelos.length)} detalle="Motos que atiendes" />
                <Kpi icon={Layers} titulo="Marcas de moto" valor={n0(marcas.length)} detalle={marcas.slice(0, 3).join(', ') + (marcas.length > 3 ? '…' : '')} />
                <Kpi icon={PackageSearch} tono={sin ? 'warn' : undefined} titulo="Sin repuestos asignados" valor={n0(sin)} detalle={sin ? 'Nadie los encontrará al buscar por moto' : 'Todos tienen repuestos'} />
            </div>

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
                <div className="lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-112px)] [&>div]:max-h-[inherit]">
                    <ArbolMotos modelos={modelos} marca={sel.marca} modeloId={sel.id} onMarca={(m) => setSel({ marca: m, id: null })} onModelo={elegir}
                        cabecera={<div className="flex items-center justify-between border-b border-line px-4 py-3"><h3 className="text-[15px] font-semibold">Marcas y modelos</h3><button onClick={() => setEdit({ marca: sel.marca ?? '', modelo: '', cilindrada: '' })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-brand hover:bg-brand-50"><Plus className="size-3.5" />Modelo</button></div>} />
                </div>
                <div ref={detalle} className="min-w-0 scroll-mt-24">
                    {modelo ? <Detalle modelo={modelo} onEditar={() => setEdit({ id: modelo.id, marca: modelo.marca, modelo: modelo.modelo, cilindrada: modelo.cilindrada ?? '' })} onEliminar={() => setBorrar(modelo)} />
                        : sel.marca ? <DetalleMarca marca={sel.marca} modelos={modelos.filter((m) => m.marca === sel.marca)} onModelo={elegir} onNuevo={() => setEdit({ marca: sel.marca, modelo: '', cilindrada: '' })} onRenombrar={() => setRenombrar({ actual: sel.marca, nuevo: sel.marca })} />
                        : (<Card className="grid place-items-center px-6 py-24 text-center"><span className="grid size-14 place-items-center rounded-full bg-paper text-muted"><MousePointerClick className="size-6" /></span>
                            <p className="mt-4 text-[17px] font-semibold">Elige una moto del árbol</p><p className="mt-1.5 max-w-[42ch] text-sm text-muted">Aquí verás sus repuestos compatibles y podrás editarla o eliminarla.</p></Card>)}
                </div>
            </div>

            {edit && (
                <Modal titulo={edit.id ? 'Editar modelo' : 'Nuevo modelo'} subtitulo="Registra la moto una sola vez; después la asignas a los repuestos que le sirven." cerrar={cerrar} onSubmit={guardar} enviando={enviando} ok={edit.id ? 'Guardar cambios' : 'Crear modelo'}>
                    <div><Field label="Marca de la moto" icon={Layers} value={edit.marca} onChange={(e) => setEdit({ ...edit, marca: e.target.value })} error={errores.marca} autoFocus={!edit.marca} list="marcas-moto" autoComplete="off" />
                        <datalist id="marcas-moto">{marcas.map((m) => <option key={m} value={m} />)}</datalist></div>
                    <Field label="Modelo" icon={Bike} value={edit.modelo} onChange={(e) => setEdit({ ...edit, modelo: e.target.value })} error={errores.modelo} autoFocus={!!edit.marca} hint="Como lo dice el cliente: SBR 150, Horse, FZ 16." />
                    <Field label="Cilindrada (cc), si la quieres anotar" icon={Gauge} value={edit.cilindrada} onChange={(e) => setEdit({ ...edit, cilindrada: e.target.value })} error={errores.cilindrada} inputMode="numeric" className="[&_input]:num" />
                </Modal>)}
            {renombrar && (
                <Modal titulo={`Cambiar nombre de ${renombrar.actual}`} subtitulo="Se actualiza en todos sus modelos a la vez. Útil para corregir una letra o unificar «Empire» y «Empire Keeway»." cerrar={cerrar} enviando={enviando} ok="Cambiar nombre"
                    onSubmit={() => !renombrar.nuevo.trim() ? setErrores({ nuevo: 'Escribe el nombre nuevo.' }) : router.patch('/modelos/marca', renombrar, { ...opts, onSuccess: () => { setSel({ marca: renombrar.nuevo.trim(), id: null }); cerrar(); }, onError: (er) => setErrores(er) })}>
                    <Field label="Nombre nuevo de la marca" icon={Layers} value={renombrar.nuevo} onChange={(e) => setRenombrar({ ...renombrar, nuevo: e.target.value })} error={errores.nuevo} autoFocus />
                </Modal>)}
            {borrar && (
                <Modal titulo={`Eliminar ${borrar.marca} ${borrar.modelo}`} peligro cerrar={cerrar} enviando={enviando} ok="Eliminar modelo" onSubmit={() => router.delete(`/modelos/${borrar.id}`, { ...opts, onSuccess: () => { setSel({ marca: borrar.marca, id: null }); cerrar(); } })}>
                    {borrar.productos > 0
                        ? <p className="text-sm leading-relaxed">Se quitará esta moto de la compatibilidad de <strong>{n0(borrar.productos)} {borrar.productos === 1 ? 'repuesto' : 'repuestos'}</strong>. Los productos no se borran, pero dejarán de aparecer al buscar por esta moto.</p>
                        : <p className="text-sm">Este modelo no está asignado a ningún repuesto, así que no se afecta nada.</p>}
                </Modal>)}
        </AppLayout>
    );
}
