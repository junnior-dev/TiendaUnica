import { Head, router } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import { ArrowRight, Boxes, Package, Pencil, Percent, Plus, Power, RefreshCw, Search, Tag, Tags, Trash2 } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, IconBtn, Kpi, Modal, Vacio } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { n0, n2, usd } from '../../lib/format';

const num = (s) => { const t = String(s ?? '').trim(); return t ? Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) : NaN; };

/* La cadena que decide el margen de un producto. Se explica una vez, arriba, con los números reales del negocio. */
function Cadena({ margen }) {
    const Paso = ({ n, t, d, on }) => (
        <li className={`flex min-w-0 flex-1 items-start gap-3 rounded-xl border p-3.5 ${on ? 'border-brand bg-brand-50' : 'border-line bg-white'}`}>
            <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${on ? 'bg-brand text-white' : 'bg-paper text-muted'}`}>{n}</span>
            <div className="min-w-0"><p className="text-sm font-semibold">{t}</p><p className="text-[13px] leading-snug text-muted">{d}</p></div>
        </li>
    );
    return (
        <Card className="mb-6 p-5">
            <h3 className="text-[15px] font-semibold">¿Con qué margen se calcula el precio?</h3>
            <p className="mt-1 max-w-[72ch] text-[13px] text-muted">El sistema busca el margen en este orden y usa el primero que encuentre. Así cambias el precio de muchos repuestos tocando un solo número.</p>
            <ol className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-stretch">
                <Paso n="1" t="El del producto" d="Si el repuesto tiene su propio margen, manda ese." />
                <ArrowRight className="hidden size-4 shrink-0 self-center text-muted lg:block" />
                <Paso n="2" t="El de la categoría" d="Lo que configuras en esta pantalla." on />
                <ArrowRight className="hidden size-4 shrink-0 self-center text-muted lg:block" />
                <Paso n="3" t={`El del negocio: ${n0(margen)} %`} d="Se usa cuando la categoría no tiene margen propio." />
            </ol>
        </Card>
    );
}

export default function Categorias({ negocio, usuario, fecha_larga, stock_bajo, tasa_usd, margen_negocio, categorias, sin_categoria }) {
    const [q, setQ] = useState(''); const [ver, setVer] = useState('activas');
    const [edit, setEdit] = useState(null); const [recalc, setRecalc] = useState(null); const [borrar, setBorrar] = useState(null);
    const [enviando, setEnviando] = useState(false); const [errores, setErrores] = useState({});
    const lista = useMemo(() => categorias.filter((c) => (ver === 'todas' || (ver === 'activas') === c.activa) && c.nombre.toLowerCase().includes(q.toLowerCase().trim())), [categorias, q, ver]);
    const activas = categorias.filter((c) => c.activa), propios = activas.filter((c) => c.margen_pct != null).length;
    const opts = { preserveScroll: true, onStart: () => setEnviando(true), onFinish: () => setEnviando(false) };
    const cerrar = () => { setEdit(null); setRecalc(null); setBorrar(null); setErrores({}); };

    const guardar = () => {
        const e = {}; const m = num(edit.margen);
        if (!edit.nombre.trim()) e.nombre = 'Escribe el nombre de la categoría.';
        if (edit.propio && (isNaN(m) || m < 0 || m > 1000)) e.margen = 'Usa un número entre 0 y 1000.';
        setErrores(e); if (Object.keys(e).length) return;
        const datos = { nombre: edit.nombre.trim(), margen_pct: edit.propio ? m : null };
        const o = { ...opts, onSuccess: cerrar, onError: (er) => setErrores(er) };
        edit.id ? router.put(`/categorias/${edit.id}`, datos, o) : router.post('/categorias', datos, o);
    };
    const m = num(edit?.margen), ejemplo = edit ? 10 * (1 + ((edit.propio && !isNaN(m) ? m : margen_negocio) / 100)) : 0;

    return (
        <AppLayout actual="/categorias" titulo="Categorías" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Categorías" />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Categorías</h2><p className="mt-1 max-w-[62ch] text-[15px] text-muted">Agrupa tus repuestos (frenos, motor, eléctrico…) y define cuánto ganas en cada grupo.</p></div>
                <Button onClick={() => setEdit({ nombre: '', propio: false, margen: '' })}><Plus className="size-4" />Nueva categoría</Button>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-3">
                <Kpi icon={Tags} titulo="Categorías activas" valor={n0(activas.length)} detalle={`${categorias.length - activas.length} desactivada${categorias.length - activas.length === 1 ? '' : 's'}`} />
                <Kpi icon={Percent} titulo="Con margen propio" valor={n0(propios)} detalle={`El resto usa ${n0(margen_negocio)} % del negocio`} />
                <Kpi icon={Package} tono={sin_categoria ? 'warn' : undefined} titulo="Productos sin categoría" valor={n0(sin_categoria)} detalle={sin_categoria ? 'Asígnales una para ordenar el inventario' : 'Todos tienen categoría'} />
            </div>

            <Cadena margen={margen_negocio} />

            <Card>
                <div className="flex flex-wrap items-center gap-3 border-b border-line p-4 sm:p-5">
                    <label className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Buscar categoría" placeholder="Buscar categoría" className="h-11 w-full rounded-lg border border-line bg-paper pl-10 pr-3 text-[15px] placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" /></label>
                    <div role="radiogroup" aria-label="Estado" className="inline-flex rounded-lg bg-[#e9ecf0] p-1 text-[13px]">
                        {[['activas', 'Activas'], ['inactivas', 'Desactivadas'], ['todas', 'Todas']].map(([k, l]) => <button key={k} role="radio" aria-checked={ver === k} onClick={() => setVer(k)} className={`rounded-md px-3 py-1.5 font-medium ${ver === k ? 'bg-white shadow-sm' : 'text-muted hover:text-text'}`}>{l}</button>)}
                    </div>
                </div>
                {lista.length === 0 ? <Vacio icon={Tags} titulo="No hay categorías que mostrar" texto="Prueba con otra búsqueda o crea una categoría nueva para ordenar tus repuestos.">
                    <Button onClick={() => setEdit({ nombre: '', propio: false, margen: '' })}><Plus className="size-4" />Nueva categoría</Button></Vacio> : (
                    <div className="relative overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
                        <thead><tr className="text-left text-[13px] text-muted"><th className="px-5 py-3 font-medium">Categoría</th><th className="px-3 py-3 font-medium">Margen</th><th className="px-3 py-3 text-right font-medium">Productos</th><th className="px-3 py-3 text-right font-medium">Inventario a precio de venta</th><th className="px-5 py-3 text-right font-medium"><span className="sr-only">Acciones</span></th></tr></thead>
                        <tbody>{lista.map((c) => (
                            <tr key={c.id} className="border-t border-line">
                                <td className="px-5 py-3.5"><p className={`font-medium ${c.activa ? '' : 'text-muted'}`}>{c.nombre}{!c.activa && <span className="ml-2 rounded-full bg-paper px-2 py-0.5 text-xs font-medium text-muted">Desactivada</span>}</p></td>
                                <td className="px-3 py-3.5"><span className="num font-semibold">{n0(c.margen_pct ?? margen_negocio)} %</span><span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${c.margen_pct != null ? 'bg-brand-50 text-brand' : 'bg-paper text-muted'}`}>{c.margen_pct != null ? 'Propio' : 'Del negocio'}</span></td>
                                <td className="num px-3 py-3.5 text-right">{c.productos > 0 ? <a href={`/productos?categoria=${c.id}`} className="font-medium text-brand hover:underline">{n0(c.productos)}</a> : <span className="text-muted">0</span>}</td>
                                <td className="num px-3 py-3.5 text-right">{c.valor_venta > 0 ? usd(c.valor_venta) : <span className="text-muted">—</span>}</td>
                                <td className="px-3 py-2"><div className="flex justify-end">
                                    <IconBtn icon={Pencil} label={`Editar ${c.nombre}`} onClick={() => setEdit({ id: c.id, nombre: c.nombre, propio: c.margen_pct != null, margen: c.margen_pct != null ? String(c.margen_pct).replace('.', ',') : '' })} />
                                    <IconBtn icon={RefreshCw} label={`Recalcular precios de ${c.nombre}`} onClick={() => setRecalc(c)} disabled={!c.productos} />
                                    <IconBtn icon={Power} label={c.activa ? `Desactivar ${c.nombre}` : `Activar ${c.nombre}`} onClick={() => router.patch(`/categorias/${c.id}/estado`, { activa: !c.activa }, { preserveScroll: true })} />
                                    <IconBtn icon={Trash2} tone="danger" label={c.productos ? 'No se puede eliminar: tiene productos' : `Eliminar ${c.nombre}`} onClick={() => setBorrar(c)} disabled={c.productos > 0} />
                                </div></td>
                            </tr>))}</tbody></table></div>)}
            </Card>

            {edit && (
                <Modal titulo={edit.id ? 'Editar categoría' : 'Nueva categoría'} subtitulo="Una categoría agrupa repuestos parecidos y puede tener su propio margen de ganancia." cerrar={cerrar} onSubmit={guardar} enviando={enviando} ok={edit.id ? 'Guardar cambios' : 'Crear categoría'}>
                    <Field label="Nombre de la categoría" icon={Tag} value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} error={errores.nombre} autoFocus />
                    <div className="rounded-xl border border-line p-4">
                        <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium">Margen propio para esta categoría</p><p className="text-[13px] text-muted">Apagado, usa el {n0(margen_negocio)} % del negocio.</p></div>
                            <button type="button" role="switch" aria-checked={edit.propio} aria-label="Margen propio" onClick={() => setEdit({ ...edit, propio: !edit.propio, margen: edit.margen || String(margen_negocio) })} className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors ${edit.propio ? 'bg-brand' : 'bg-[#c5ccd4]'}`}><span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${edit.propio ? 'left-[18px]' : 'left-0.5'}`} /></button></div>
                        {edit.propio && <div className="mt-4"><Field label="Margen sobre el costo (%)" icon={Percent} value={edit.margen} onChange={(e) => setEdit({ ...edit, margen: e.target.value })} error={errores.margen} inputMode="decimal" className="[&_input]:num" /></div>}
                        <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-[13px] text-muted">Ejemplo: un repuesto que te cuesta {usd(10)} se vendería a <strong className="font-semibold text-text">{usd(ejemplo)}</strong>.</p>
                    </div>
                    {edit.id && <p className="text-[13px] leading-snug text-muted">Cambiar el margen no modifica los precios que ya tienes. Después usa «Recalcular precios» para aplicarlo.</p>}
                </Modal>)}
            {recalc && (
                <Modal titulo={`Recalcular precios de ${recalc.nombre}`} cerrar={cerrar} enviando={enviando} ok="Recalcular precios" onSubmit={() => router.post(`/categorias/${recalc.id}/recalcular`, {}, { ...opts, onSuccess: cerrar })}>
                    <p className="text-sm leading-relaxed">Se calculará de nuevo el precio de los <strong>{n0(recalc.productos)} productos activos</strong> de esta categoría con su costo y su margen actual ({n0(recalc.margen_pct ?? margen_negocio)} % salvo los que tienen margen propio).</p>
                    <ul className="space-y-1.5 rounded-lg bg-paper p-3.5 text-[13px] text-muted"><li>· Los precios que escribiste a mano también se reemplazan.</li><li>· Cada cambio queda en el historial de precios del producto.</li><li>· Se cierran los avisos de precio pendientes de estos productos.</li></ul>
                </Modal>)}
            {borrar && (
                <Modal titulo={`Eliminar ${borrar.nombre}`} subtitulo="Esta categoría no tiene productos, así que se puede quitar sin afectar nada." peligro cerrar={cerrar} enviando={enviando} ok="Eliminar" onSubmit={() => router.delete(`/categorias/${borrar.id}`, { ...opts, onSuccess: cerrar })}>
                    <p className="text-sm">Si más adelante la necesitas, podrás crearla de nuevo. ¿Quieres eliminarla?</p>
                </Modal>)}
        </AppLayout>
    );
}
