import { Head, router } from '@inertiajs/react';
import { useEffect, useMemo, useState } from 'react';
import { Bike, Copy, Gauge, Loader2, MousePointerClick, PackagePlus, PackageSearch, Pencil, Puzzle, Search, Sparkles, Trash2, Wrench } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import ArbolMotos from '../../Components/ArbolMotos';
import { Card, IconBtn, Kpi, Modal, Vacio } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { n0 } from '../../lib/format';

const anios = (d, h) => (!d && !h ? 'Todos los años' : `${d ?? '…'} – ${h ?? 'hoy'}`);

function Agregar({ moto, cerrar }) {
    const [q, setQ] = useState(''); const [lista, setLista] = useState(null); const [marcados, setMarcados] = useState(new Set());
    const [desde, setDesde] = useState(''); const [hasta, setHasta] = useState(''); const [enviando, setEnviando] = useState(false); const [error, setError] = useState('');
    useEffect(() => {
        const t = setTimeout(() => fetch(`/compatibilidad/${moto.id}/candidatos?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } }).then((r) => r.json()).then(setLista), q ? 250 : 0);
        return () => clearTimeout(t);
    }, [q]);
    const alternar = (id) => setMarcados((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const sugeridos = lista?.filter((p) => p.sugerido) ?? [], resto = lista?.filter((p) => !p.sugerido) ?? [];
    const enviar = () => {
        const d = desde === '' ? null : Number(desde), h = hasta === '' ? null : Number(hasta);
        if ((d !== null && (d < 1950 || d > 2100)) || (h !== null && (h < 1950 || h > 2100))) return setError('Escribe años entre 1950 y 2100.');
        if (d !== null && h !== null && h < d) return setError('El año final no puede ser menor que el inicial.');
        router.post(`/compatibilidad/${moto.id}/productos`, { producto_ids: [...marcados], anio_desde: d, anio_hasta: h }, { preserveScroll: true, onStart: () => setEnviando(true), onFinish: () => setEnviando(false), onSuccess: cerrar });
    };
    const Fila = ({ p }) => (
        <li><label className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-paper/70 ${marcados.has(p.id) ? 'bg-brand-50' : ''}`}>
            <input type="checkbox" checked={marcados.has(p.id)} onChange={() => alternar(p.id)} className="size-[18px] shrink-0 accent-[#1e4fd6]" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.nombre}</span><span className="block text-xs text-muted">{p.sku} · {p.categoria}{p.sugerido ? <span className="ml-2 text-brand">Sirve a {p.sugerido}</span> : null}</span></span></label></li>
    );
    return (
        <Modal titulo={`Agregar repuestos a ${moto.marca} ${moto.modelo}`} subtitulo="Marca los repuestos que le sirven. Puedes indicar los años en que encajan o dejarlos en blanco." cerrar={cerrar} onSubmit={enviar} enviando={enviando || marcados.size === 0} ok={marcados.size ? `Agregar ${marcados.size} ${marcados.size === 1 ? 'repuesto' : 'repuestos'}` : 'Agregar'} ancho="max-w-[620px]">
            <label className="relative block"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus type="search" aria-label="Buscar repuesto" placeholder="Busca por nombre, SKU o referencia" className="h-11 w-full rounded-lg border border-line bg-paper pl-10 pr-3 text-[15px] placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" /></label>
            <div className="max-h-[300px] overflow-y-auto rounded-xl border border-line">
                {!lista ? <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Buscando…</p>
                    : lista.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted">{q ? 'No hay repuestos con esa búsqueda que falten por asignar.' : 'Todos los repuestos activos ya le sirven a esta moto.'}</p> : (<>
                    {sugeridos.length > 0 && <><p className="sticky top-0 flex items-center gap-1.5 border-b border-line bg-white px-4 py-2 text-xs font-medium text-brand"><Sparkles className="size-3.5" />Sugeridos: le sirven a otras {moto.marca}</p><ul className="divide-y divide-line">{sugeridos.map((p) => <Fila key={p.id} p={p} />)}</ul></>}
                    {resto.length > 0 && <><p className="sticky top-0 border-y border-line bg-paper px-4 py-2 text-xs font-medium text-muted first:border-t-0">{sugeridos.length ? 'Otros repuestos' : 'Repuestos'}</p><ul className="divide-y divide-line">{resto.map((p) => <Fila key={p.id} p={p} />)}</ul></>}</>)}
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Desde el año (opcional)" value={desde} onChange={(e) => { setDesde(e.target.value); setError(''); }} inputMode="numeric" placeholder="2015" className="[&_input]:num" />
                <Field label="Hasta el año (opcional)" value={hasta} onChange={(e) => { setHasta(e.target.value); setError(''); }} inputMode="numeric" placeholder="2024" className="[&_input]:num" error={error} />
            </div>
        </Modal>
    );
}

export default function Compatibilidad({ negocio, usuario, fecha_larga, stock_bajo, tasa_usd, modelos, seleccion }) {
    const moto = seleccion?.moto ?? null;
    const [q, setQ] = useState(''); const [marcados, setMarcados] = useState(new Set());
    const [agregar, setAgregar] = useState(false); const [copiar, setCopiar] = useState(null); const [anio, setAnio] = useState(null); const [quitar, setQuitar] = useState(null);
    const [enviando, setEnviando] = useState(false); const [error, setError] = useState('');
    useEffect(() => { setQ(''); setMarcados(new Set()); }, [moto?.id]);
    const sin = modelos.filter((m) => m.productos === 0).length;
    const lista = useMemo(() => (seleccion?.productos ?? []).filter((p) => !q.trim() || `${p.nombre} ${p.sku} ${p.categoria}`.toLowerCase().includes(q.toLowerCase().trim())), [seleccion, q]);
    const opts = { preserveScroll: true, onStart: () => setEnviando(true), onFinish: () => setEnviando(false) };
    const cerrar = () => { setAgregar(false); setCopiar(null); setAnio(null); setQuitar(null); setError(''); };
    const elegir = (m) => router.get('/compatibilidad', { moto: m.id }, { preserveState: true, preserveScroll: true, replace: true, only: ['seleccion'] });
    const todos = lista.length > 0 && lista.every((p) => marcados.has(p.id));
    const alternar = (id) => setMarcados((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const otras = modelos.filter((m) => m.id !== moto?.id && m.productos > 0);

    return (
        <AppLayout actual="/compatibilidad" titulo="Compatibilidad" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Compatibilidad" />
            <div className="mb-6"><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Compatibilidad</h2>
                <p className="mt-1 max-w-[68ch] text-[15px] text-muted">Define qué repuestos le sirven a cada moto. Así tu cajero busca «para mi Bera SBR» y encuentra solo lo que encaja.</p></div>
            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-3">
                <Kpi icon={Bike} titulo="Motos registradas" valor={n0(modelos.length)} detalle={`${n0(modelos.length - sin)} con repuestos asignados`} />
                <Kpi icon={Puzzle} titulo="Relaciones moto–repuesto" valor={n0(modelos.reduce((a, m) => a + m.productos, 0))} detalle="Cada repuesto cuenta una vez por moto" />
                <Kpi icon={PackageSearch} tono={sin ? 'warn' : undefined} titulo="Motos sin repuestos" valor={n0(sin)} detalle={sin ? 'Ábrelas en el árbol para asignarles piezas' : 'Todas tienen repuestos'} />
            </div>

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
                <div className="lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-112px)] [&>div]:max-h-[inherit]">
                    <ArbolMotos modelos={modelos} marca={moto?.marca} modeloId={moto?.id} onMarca={() => {}} onModelo={elegir} cabecera={<div className="border-b border-line px-4 py-3"><h3 className="text-[15px] font-semibold">1. Elige la moto</h3></div>} />
                </div>

                <div className="min-w-0">
                    {!moto ? (
                        <Card className="grid place-items-center px-6 py-24 text-center"><span className="grid size-14 place-items-center rounded-full bg-paper text-muted"><MousePointerClick className="size-6" /></span>
                            <p className="mt-4 text-[17px] font-semibold">Elige una moto del árbol</p><p className="mt-1.5 max-w-[44ch] text-sm text-muted">Verás los repuestos que ya le sirven y podrás agregar más, copiarlos de otra moto o quitar los que sobran.</p></Card>
                    ) : (
                        <Card>
                            <div className="flex flex-wrap items-start gap-4 border-b border-line p-5 sm:p-6">
                                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-ink text-white"><Bike className="size-6" /></span>
                                <div className="min-w-[300px] flex-1"><p className="text-[13px] text-muted">2. Repuestos que le sirven a</p><h3 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">{moto.marca} {moto.modelo}</h3>
                                    <p className="mt-1 flex flex-wrap items-center gap-x-4 text-sm text-muted">{moto.cilindrada && <span className="inline-flex items-center gap-1.5"><Gauge className="size-4" />{moto.cilindrada} cc</span>}<span className="inline-flex items-center gap-1.5"><Wrench className="size-4" />{n0(seleccion.productos.length)} {seleccion.productos.length === 1 ? 'repuesto' : 'repuestos'}</span></p></div>
                                <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setCopiar({ desde: '' })} disabled={otras.length === 0}><Copy className="size-4" />Copiar de otra moto</Button><Button onClick={() => setAgregar(true)}><PackagePlus className="size-4" />Agregar repuestos</Button></div>
                            </div>

                            {seleccion.productos.length === 0 ? (
                                <Vacio icon={PackageSearch} titulo="Esta moto aún no tiene repuestos" texto="Agrégalos uno por uno, o copia los de una moto parecida para empezar más rápido (por ejemplo, de la Bera SBR 150 a la Socialista 150).">
                                    <Button onClick={() => setAgregar(true)}><PackagePlus className="size-4" />Agregar repuestos</Button>{otras.length > 0 && <Button variant="ghost" onClick={() => setCopiar({ desde: '' })}><Copy className="size-4" />Copiar de otra moto</Button>}</Vacio>
                            ) : (<>
                                <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 sm:px-6">
                                    <label className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                                        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Buscar en esta moto" placeholder="Buscar en estos repuestos" className="h-10 w-full rounded-lg border border-line bg-paper pl-9 pr-3 text-sm placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" /></label>
                                    {marcados.size > 0 && <button onClick={() => setQuitar([...marcados])} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-sm font-semibold text-danger hover:bg-[#fdecec]"><Trash2 className="size-4" />Quitar {marcados.size} {marcados.size === 1 ? 'repuesto' : 'repuestos'}</button>}
                                </div>
                                <div className="relative overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
                                    <thead><tr className="text-left text-[13px] text-muted"><th className="w-12 py-3 pl-5 sm:pl-6"><input type="checkbox" aria-label="Marcar todos" checked={todos} onChange={() => setMarcados(todos ? new Set() : new Set(lista.map((p) => p.id)))} className="size-[18px] accent-[#1e4fd6]" /></th>
                                        <th className="px-3 py-3 font-medium">Repuesto</th><th className="px-3 py-3 font-medium">Años</th><th className="px-3 py-3 text-right font-medium">Existencias</th><th className="px-5 py-3 text-right font-medium"><span className="sr-only">Acciones</span></th></tr></thead>
                                    <tbody>{lista.map((p) => (
                                        <tr key={p.id} className={`border-t border-line ${marcados.has(p.id) ? 'bg-brand-50' : ''}`}>
                                            <td className="py-3 pl-5 sm:pl-6"><input type="checkbox" aria-label={`Marcar ${p.nombre}`} checked={marcados.has(p.id)} onChange={() => alternar(p.id)} className="size-[18px] accent-[#1e4fd6]" /></td>
                                            <td className="px-3 py-3"><p className="font-medium">{p.nombre}</p><p className="text-xs text-muted">{p.sku} · {p.categoria}</p></td>
                                            <td className="num px-3 py-3 text-muted">{anios(p.desde, p.hasta)}</td>
                                            <td className={`num px-3 py-3 text-right ${p.stock <= 0 ? 'font-semibold text-danger' : p.stock <= p.minimo ? 'font-semibold text-[#a86a00]' : 'text-muted'}`}>{p.stock <= 0 ? 'Agotado' : n0(p.stock)}</td>
                                            <td className="px-3 py-2"><div className="flex justify-end"><IconBtn icon={Pencil} label={`Cambiar años de ${p.nombre}`} onClick={() => setAnio({ id: p.id, nombre: p.nombre, desde: p.desde ?? '', hasta: p.hasta ?? '' })} /><IconBtn icon={Trash2} tone="danger" label={`Quitar ${p.nombre}`} onClick={() => setQuitar([p.id])} /></div></td>
                                        </tr>))}</tbody></table></div>
                                {lista.length === 0 && <p className="px-6 py-10 text-center text-sm text-muted">Ningún repuesto coincide con «{q}».</p>}
                                <p className="border-t border-line px-5 py-3 text-[13px] text-muted sm:px-6">Quitar un repuesto de aquí no lo borra del catálogo: solo deja de aparecer al buscar por esta moto.</p></>)}
                        </Card>)}
                </div>
            </div>

            {agregar && <Agregar moto={moto} cerrar={cerrar} />}
            {copiar && (
                <Modal titulo={`Copiar repuestos a ${moto.marca} ${moto.modelo}`} subtitulo="Se agregan los repuestos de la otra moto. Los que esta ya tiene se omiten y nada se borra." cerrar={cerrar} enviando={enviando} ok="Copiar repuestos"
                    onSubmit={() => !copiar.desde ? setError('Elige de cuál moto copiar.') : router.post(`/compatibilidad/${moto.id}/copiar`, { desde_moto: Number(copiar.desde) }, { ...opts, onSuccess: cerrar })}>
                    <Field select label="Copiar desde" value={copiar.desde} onChange={(e) => { setCopiar({ desde: e.target.value }); setError(''); }} error={error}><option value="">Elige una moto</option>
                        {otras.map((m) => <option key={m.id} value={m.id}>{m.marca} {m.modelo} · {m.productos} {m.productos === 1 ? 'repuesto' : 'repuestos'}</option>)}</Field>
                </Modal>)}
            {anio && (
                <Modal titulo="Años en que encaja" subtitulo={anio.nombre} cerrar={cerrar} enviando={enviando} ok="Guardar años" onSubmit={() => {
                    const d = anio.desde === '' ? null : Number(anio.desde), h = anio.hasta === '' ? null : Number(anio.hasta);
                    if ((d !== null && (d < 1950 || d > 2100)) || (h !== null && (h < 1950 || h > 2100))) return setError('Escribe años entre 1950 y 2100.');
                    if (d !== null && h !== null && h < d) return setError('El año final no puede ser menor que el inicial.');
                    router.patch(`/compatibilidad/${moto.id}/productos/${anio.id}`, { anio_desde: d, anio_hasta: h }, { ...opts, onSuccess: cerrar }); }}>
                    <div className="grid grid-cols-2 gap-3"><Field label="Desde el año" value={anio.desde} onChange={(e) => { setAnio({ ...anio, desde: e.target.value }); setError(''); }} inputMode="numeric" autoFocus className="[&_input]:num" /><Field label="Hasta el año" value={anio.hasta} onChange={(e) => { setAnio({ ...anio, hasta: e.target.value }); setError(''); }} inputMode="numeric" error={error} className="[&_input]:num" /></div>
                    <p className="text-[13px] text-muted">Déjalos en blanco si encaja en todos los años.</p>
                </Modal>)}
            {quitar && (
                <Modal titulo={quitar.length === 1 ? 'Quitar repuesto de esta moto' : `Quitar ${quitar.length} repuestos de esta moto`} peligro cerrar={cerrar} enviando={enviando} ok="Quitar" onSubmit={() => router.post(`/compatibilidad/${moto.id}/quitar`, { producto_ids: quitar }, { ...opts, onSuccess: () => { setMarcados(new Set()); cerrar(); } })}>
                    <p className="text-sm leading-relaxed">Dejarán de aparecer al buscar por la <strong>{moto.marca} {moto.modelo}</strong>. Los productos siguen en tu catálogo y puedes volver a agregarlos cuando quieras.</p>
                </Modal>)}
        </AppLayout>
    );
}
