import { Head, router } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import { BadgeCheck, Info, Package, Pencil, Plus, Power, Search, Tag, Trash2, Trophy } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, IconBtn, Kpi, Modal, Vacio } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { n0 } from '../../lib/format';

const iniciales = (n) => n.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export default function Marcas({ negocio, usuario, fecha_larga, stock_bajo, tasa_usd, marcas, sin_marca }) {
    const [q, setQ] = useState(''); const [ver, setVer] = useState('activas');
    const [edit, setEdit] = useState(null); const [borrar, setBorrar] = useState(null);
    const [enviando, setEnviando] = useState(false); const [errores, setErrores] = useState({});
    const lista = useMemo(() => marcas.filter((m) => (ver === 'todas' || (ver === 'activas') === m.activa) && m.nombre.toLowerCase().includes(q.toLowerCase().trim())), [marcas, q, ver]);
    const activas = marcas.filter((m) => m.activa), top = [...marcas].sort((a, b) => b.productos - a.productos)[0];
    const opts = { preserveScroll: true, onStart: () => setEnviando(true), onFinish: () => setEnviando(false) };
    const cerrar = () => { setEdit(null); setBorrar(null); setErrores({}); };
    const guardar = () => {
        if (!edit.nombre.trim()) return setErrores({ nombre: 'Escribe el nombre de la marca.' });
        const o = { ...opts, onSuccess: cerrar, onError: (er) => setErrores(er) };
        edit.id ? router.put(`/marcas/${edit.id}`, { nombre: edit.nombre.trim() }, o) : router.post('/marcas', { nombre: edit.nombre.trim() }, o);
    };

    return (
        <AppLayout actual="/marcas" titulo="Marcas" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Marcas" />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Marcas</h2><p className="mt-1 max-w-[62ch] text-[15px] text-muted">Los fabricantes de tus repuestos. Sirven para buscar, comparar y reponer por marca.</p></div>
                <Button onClick={() => setEdit({ nombre: '' })}><Plus className="size-4" />Nueva marca</Button>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-3">
                <Kpi icon={BadgeCheck} titulo="Marcas activas" valor={n0(activas.length)} detalle={`${marcas.length - activas.length} desactivada${marcas.length - activas.length === 1 ? '' : 's'}`} />
                <Kpi icon={Trophy} titulo="Marca con más repuestos" valor={top?.nombre ?? '—'} detalle={top ? `${n0(top.productos)} productos` : 'Aún no hay productos'} />
                <Kpi icon={Package} tono={sin_marca ? 'warn' : undefined} titulo="Productos sin marca" valor={n0(sin_marca)} detalle={sin_marca ? 'Puedes asignarles una al editarlos' : 'Todos tienen marca'} />
            </div>

            <p className="mb-6 flex items-start gap-2 px-1 text-[13px] leading-snug text-muted"><Info className="mt-0.5 size-4 shrink-0" />La marca es quien fabrica el repuesto (NGK, Bendix, Motul), no la de la moto. Las motos se registran en «Modelos de moto».</p>

            <Card>
                <div className="flex flex-wrap items-center gap-3 border-b border-line p-4 sm:p-5">
                    <label className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Buscar marca" placeholder="Buscar marca" className="h-11 w-full rounded-lg border border-line bg-paper pl-10 pr-3 text-[15px] placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" /></label>
                    <div role="radiogroup" aria-label="Estado" className="inline-flex rounded-lg bg-[#e9ecf0] p-1 text-[13px]">
                        {[['activas', 'Activas'], ['inactivas', 'Desactivadas'], ['todas', 'Todas']].map(([k, l]) => <button key={k} role="radio" aria-checked={ver === k} onClick={() => setVer(k)} className={`rounded-md px-3 py-1.5 font-medium ${ver === k ? 'bg-white shadow-sm' : 'text-muted hover:text-text'}`}>{l}</button>)}
                    </div>
                </div>
                {lista.length === 0 ? <Vacio icon={BadgeCheck} titulo="No hay marcas que mostrar" texto="Prueba con otra búsqueda o agrega la marca que te falta."><Button onClick={() => setEdit({ nombre: q })}><Plus className="size-4" />Nueva marca</Button></Vacio> : (
                    <div className="overflow-hidden"><ul className="-ml-px -mt-px grid sm:grid-cols-2 xl:grid-cols-3">
                        {lista.map((m) => (
                            <li key={m.id} className="flex items-center gap-3.5 border-l border-t border-line bg-white p-4 sm:p-5">
                                <span className={`grid size-11 shrink-0 place-items-center rounded-xl text-sm font-semibold ${m.activa ? 'bg-ink text-white' : 'bg-paper text-muted'}`} aria-hidden>{iniciales(m.nombre)}</span>
                                <div className="min-w-0 flex-1">
                                    <p className={`truncate text-[15px] font-semibold ${m.activa ? '' : 'text-muted'}`}>{m.nombre}</p>
                                    <p className="text-[13px] text-muted">{m.productos > 0 ? <a href={`/productos?marca=${m.id}`} className="font-medium text-brand hover:underline">{n0(m.productos)} {m.productos === 1 ? 'producto' : 'productos'}</a> : 'Sin productos'}{!m.activa && ' · Desactivada'}</p>
                                </div>
                                <div className="flex shrink-0">
                                    <IconBtn icon={Pencil} label={`Editar ${m.nombre}`} onClick={() => setEdit({ id: m.id, nombre: m.nombre })} />
                                    <IconBtn icon={Power} label={m.activa ? `Desactivar ${m.nombre}` : `Activar ${m.nombre}`} onClick={() => router.patch(`/marcas/${m.id}/estado`, { activa: !m.activa }, { preserveScroll: true })} />
                                    <IconBtn icon={Trash2} tone="danger" label={m.productos ? 'No se puede eliminar: tiene productos' : `Eliminar ${m.nombre}`} onClick={() => setBorrar(m)} disabled={m.productos > 0} />
                                </div>
                            </li>))}
                    </ul></div>)}
                <p className="border-t border-line px-5 py-3 text-[13px] text-muted">{lista.length} de {marcas.length} marcas. Una marca desactivada deja de ofrecerse al crear productos, pero no se pierde su historial.</p>
            </Card>

            {edit && (
                <Modal titulo={edit.id ? 'Editar marca' : 'Nueva marca'} subtitulo="Escribe el nombre como lo reconocen tus clientes y proveedores." cerrar={cerrar} onSubmit={guardar} enviando={enviando} ok={edit.id ? 'Guardar cambios' : 'Crear marca'}>
                    <Field label="Nombre de la marca" icon={Tag} value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} error={errores.nombre} autoFocus />
                </Modal>)}
            {borrar && (
                <Modal titulo={`Eliminar ${borrar.nombre}`} subtitulo="Esta marca no tiene productos, así que se puede quitar sin afectar nada." peligro cerrar={cerrar} enviando={enviando} ok="Eliminar" onSubmit={() => router.delete(`/marcas/${borrar.id}`, { ...opts, onSuccess: cerrar })}>
                    <p className="text-sm">¿Quieres eliminarla? Si prefieres conservarla, puedes desactivarla.</p>
                </Modal>)}
        </AppLayout>
    );
}
