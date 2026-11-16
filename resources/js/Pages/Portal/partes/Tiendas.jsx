import { router } from '@inertiajs/react';
import { useState } from 'react';
import { Ban, Play, SearchX, Store } from 'lucide-react';
import { Card, Modal, Vacio } from '../../../Components/kit';
import Paginador from '../../../Components/Paginador';
import { Estado, ESTADOS } from '../../../Components/saas';
import { Buscador, Cabeza, Chip, Plazo, bs, campo, fecha, ir, nombrePlan, useRetraso } from '../comun';

/* Todas las tiendas: busca por nombre o correo, filtra por estado y plan, ordena y pagina (todo en el servidor). */

const ORDENES = [['atencion', 'Primero las que piden atención'], ['vence', 'Vence pronto'], ['recientes', 'Más recientes'], ['nombre', 'Nombre (A–Z)']];

export default function Tiendas({ filtros, filas, meta, por_estado, planes, kpis }) {
    const [texto, setTexto] = useState(filtros.q || '');
    const [suspender, setSuspender] = useState(null);
    const [motivo, setMotivo] = useState('Suspensión manual desde el portal');
    const base = { vista: 'tiendas', q: texto, estado: filtros.estado, plan: filtros.plan, orden: filtros.orden, por: filtros.por };
    const nav = (c) => ir(base, c);
    useRetraso(texto, () => nav({ q: texto }));
    const hayFiltros = filtros.q || filtros.estado || filtros.plan;
    const accion = (t, a, extra = {}) => router.post(`/portal/tenants/${t.id}/estado`, { accion: a, ...extra }, { preserveScroll: true, onFinish: () => setSuspender(null) });

    return (
        <div className="space-y-4">
            <Card className="space-y-4 p-4">
                <div className="flex flex-wrap items-center gap-3">
                    <Buscador valor={texto} set={setTexto} etiqueta="Buscar tienda" placeholder="Buscar por nombre de tienda o correo" />
                    <label className="flex items-center gap-2 text-[13.5px] text-muted">Plan
                        <select value={filtros.plan || ''} onChange={(e) => nav({ plan: e.target.value })} className={`${campo} !w-auto min-w-[170px] text-text`}>
                            <option value="">Todos los planes</option>
                            {planes.map((p) => <option key={p.id} value={p.id}>{nombrePlan(p.nombre)} ({p.n})</option>)}
                        </select>
                    </label>
                    <label className="flex items-center gap-2 text-[13.5px] text-muted">Ordenar
                        <select value={filtros.orden} onChange={(e) => nav({ orden: e.target.value })} className={`${campo} !w-auto text-text`}>
                            {ORDENES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                        </select>
                    </label>
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
                    <Chip activo={!filtros.estado} onClick={() => nav({ estado: '' })} n={kpis.total}>Todas</Chip>
                    {Object.entries(ESTADOS).map(([k, e]) => <Chip key={k} activo={filtros.estado === k} onClick={() => nav({ estado: k })} n={por_estado[k] || 0}>{k === 'MORA' ? 'Pago pendiente' : e.t}</Chip>)}
                </div>
            </Card>

            <Card className="overflow-hidden">
                {filas.length ? (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[860px] text-[14px]">
                            <thead className="border-b border-line bg-paper/60"><tr><Cabeza>Tienda</Cabeza><Cabeza>Plan</Cabeza><Cabeza>Estado</Cabeza><Cabeza>Cubre hasta</Cabeza><Cabeza>Alta</Cabeza><Cabeza derecha>Acciones</Cabeza></tr></thead>
                            <tbody className="divide-y divide-line">
                                {filas.map((t) => (
                                    <tr key={t.id} className="hover:bg-paper/50">
                                        <td className="px-4 py-3"><span className="font-semibold">{t.subdominio}</span><span className="block text-[12.5px] text-muted">{t.correo_facturacion || 'Sin correo de facturación'}</span></td>
                                        <td className="px-4 py-3">{nombrePlan(t.plan)}<span className="num block text-[12.5px] text-muted">{bs(t.precio_usd)} US$ al mes</span></td>
                                        <td className="px-4 py-3"><Estado estado={t.estado} /></td>
                                        <td className="px-4 py-3"><span className="num">{fecha(t.vence_el)}</span><Plazo dias={t.estado === 'CANCELADO' || t.estado === 'SUSPENDIDO' ? null : t.dias} /></td>
                                        <td className="num px-4 py-3 text-muted">{fecha(t.creado_en)}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex justify-end">
                                                {t.estado === 'SUSPENDIDO'
                                                    ? <button onClick={() => accion(t, 'reactivar')} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ok/40 px-3 text-[13px] font-semibold text-ok hover:bg-ok/10"><Play aria-hidden className="size-3.5" />Reactivar</button>
                                                    : <button onClick={() => setSuspender(t)} disabled={t.estado === 'CANCELADO'} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium hover:bg-paper disabled:opacity-40"><Ban aria-hidden className="size-3.5" />Suspender</button>}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : hayFiltros
                    ? <Vacio icon={SearchX} titulo="Ninguna tienda coincide" texto="Prueba con otro nombre o quita algún filtro."><button onClick={() => { setTexto(''); ir({ vista: 'tiendas' }); }} className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper">Quitar filtros</button></Vacio>
                    : <Vacio icon={Store} titulo="Aún no hay tiendas" texto="Cuando alguien cree su cuenta desde la página pública, su tienda aparecerá aquí con su demo de 15 días." />}
                <Paginador meta={meta} mostrados={filas.length} ir={nav} />
            </Card>

            {suspender && (
                <Modal titulo={`Suspender ${suspender.subdominio}`} subtitulo="La tienda pierde el acceso desde su subdominio hasta que la reactives. No se borra nada." cerrar={() => setSuspender(null)}
                    onSubmit={() => accion(suspender, 'suspender', { motivo: motivo.trim() || 'Suspensión manual desde el portal' })} ok="Suspender tienda" peligro>
                    <label className="block"><span className="mb-1.5 block text-[14px] font-medium">Motivo (queda en la bitácora)</span>
                        <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} className={campo} /></label>
                </Modal>
            )}
        </div>
    );
}
