import { Head, router } from '@inertiajs/react';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ClipboardCheck, ListChecks, Plus, Trash2, Undo2 } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi, Modal, Vacio } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { http } from '../../lib/http';
import { n0, n2, usd } from '../../lib/format';

const num = (s) => { const t = String(s ?? '').trim(); return t ? Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) : NaN; };
const ALCANCES = { CATEGORIA: 'Categoría', LISTA: 'Lista de piezas', STOCK_BAJO: 'Solo stock bajo', TODO: 'Todo el catálogo' };

/* Contar: una fila por pieza con el sistema vs lo contado (el ajuste sale de la diferencia). */
function PanelConteo({ activo, setActivo, hecho }) {
    const [borrador, setBorrador] = useState(() => Object.fromEntries((activo.filas || []).map((f) => [f.producto_id, f.contado === null ? '' : String(f.contado).replace('.', ',' || '')])));
    const [env, setEnv] = useState(false);
    const [err, setErr] = useState('');
    const [verDif, setVerDif] = useState(false);
    const filas = activo.filas || [];
    const contadas = filas.filter((f) => (borrador[f.producto_id] ?? '').trim() !== '').length;
    const conDif = filas.filter((f) => { const v = borrador[f.producto_id]; return v !== undefined && v.trim() !== '' && (num(v) || 0) !== f.stock_sistema; }).length;

    const guardar = async () => {
        setErr('');
        const items = filas.filter((f) => (borrador[f.producto_id] ?? '').trim() !== '').map((f) => ({ producto_id: f.producto_id, contado: borrador[f.producto_id] }));
        if (!items.length) { setErr('Escribe al menos una cantidad contada.'); return; }
        setEnv(true);
        try { await http('POST', `/conteos/${activo.id}/contar`, { items }); hecho(); } catch (e) { setErr(e.message); }
        setEnv(false);
    };
    const aplicar = async () => {
        setErr('');
        setEnv(true);
        try { const r = await http('POST', `/conteos/${activo.id}/aplicar`); window.alert(`Conteo aplicado: ${r.ajustes} ajuste(s) de inventario registrados en el kardex.`); hecho(); }
        catch (e) { setErr(e.message); }
        setEnv(false);
    };
    const quitar = async (productoId) => {
        try { await http('POST', `/conteos/${activo.id}/quitar`, { producto_id: productoId }); hecho(); } catch (e) { setErr(e.message); }
    };
    const visibles = verDif ? filas : filas.filter((f) => (borrador[f.producto_id] ?? '').trim() !== '' || true);
    return (
        <Card className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:p-5">
                <div><h3 className="text-[15px] font-semibold">Conteo {String(activo.numero).padStart(4, '0')} · {ALCANCES[activo.alcance]}{activo.categoria ? ` · ${activo.categoria}` : ''}</h3>
                    <p className="mt-0.5 text-[13px] text-muted">{activo.descripcion || 'Sin nota'} · {contadas}/{activo.lineas} contadas · {conDif} con diferencia</p></div>
                <div className="flex items-center gap-2">
                    {activo.estado === 'ABIERTO' && <Button onClick={guardar} disabled={env} className="!h-10 !px-3.5 !text-[13.5px]">{env ? 'Guardando…' : 'Guardar conteo'}</Button>}
                    {activo.estado === 'ABIERTO' && <Button onClick={aplicar} disabled={env || contadas < filas.length} className="!h-10 !px-3.5 !text-[13.5px]"><Check className="size-4" />Aplicar ajustes</Button>}
                    {activo.estado === 'ABIERTO' && <button type="button" onClick={() => { const m = window.prompt('¿Por qué se anula el conteo?'); if (m && m.trim().length >= 3) http('POST', `/conteos/${activo.id}/anular`, { motivo: m.trim() }).then(hecho).catch((e) => setErr(e.message)); }} className="inline-flex h-10 items-center rounded-lg px-2.5 text-[13px] font-semibold text-muted hover:text-danger">Anular</button>}
                </div>
            </div>
            {activo.estado !== 'ABIERTO' && <p className="border-b border-line px-5 py-2.5 text-[13px] text-muted">Este conteo está {activo.estado === 'APLICADO' ? 'aplicado: los ajustes ya están en el kardex' : 'anulado'} y solo se consulta.</p>}
            {err && <p className="border-b border-line px-5 py-2.5 text-[13px] text-danger">{err}</p>}
            <div className="relative overflow-x-auto"><table className="w-full min-w-[680px] text-[13.5px]">
                <thead><tr className="bg-paper text-left text-[12px] text-muted"><th className="px-5 py-2 font-medium">Pieza</th><th className="px-3 py-2 text-right font-medium">Sistema</th><th className="px-3 py-2 text-center font-medium">Contado</th><th className="px-3 py-2 text-right font-medium">Diferencia</th><th className="px-3 py-2 text-right font-medium">Valor a costo</th><th className="px-5 py-2 font-medium"><span className="sr-only">Acción</span></th></tr></thead>
                <tbody>{visibles.map((f) => {
                    const v = borrador[f.producto_id]; const contado = v === undefined || v.trim() === '' ? null : (num(v) || 0);
                    const dif = contado === null ? null : Math.round((contado - f.stock_sistema) * 1000) / 1000;
                    return (
                        <tr key={f.producto_id} className={`border-t border-line ${dif !== null && dif !== 0 ? 'bg-signal/5' : ''}`}>
                            <td className="px-5 py-2"><span className="font-medium">{f.nombre}</span><span className="num block text-[11.5px] text-muted">{f.sku} · {f.categoria}</span></td>
                            <td className="num px-3 py-2 text-right">{n0(f.stock_sistema)}</td>
                            <td className="px-3 py-2 text-center">
                                {activo.estado === 'ABIERTO' ? (
                                    <input inputMode="decimal" aria-label={`Contado de ${f.nombre}`} value={v ?? ''} onChange={(e) => setBorrador({ ...borrador, [f.producto_id]: e.target.value })}
                                        className="num h-9 w-24 rounded-lg border border-line text-center text-[14px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" placeholder="—" />
                                ) : <span className="num">{f.contado === null ? '—' : n0(f.contado)}</span>}
                            </td>
                            <td className={`num px-3 py-2 text-right font-semibold ${dif === null ? 'text-muted' : dif === 0 ? 'text-ok' : dif > 0 ? 'text-[#8a5a00]' : 'text-danger'}`}>{dif === null ? '—' : `${dif > 0 ? '+' : ''}${n0(dif)}`}</td>
                            <td className="num px-3 py-2 text-right text-muted">{usd(f.valor_costo)}</td>
                            <td className="px-5 py-2 text-right">{activo.estado === 'ABIERTO' && <button type="button" aria-label={`Quitar ${f.nombre} del conteo`} onClick={() => quitar(f.producto_id)} className="grid size-8 place-items-center rounded-md text-muted hover:bg-[#fdecec] hover:text-danger"><Trash2 className="size-4" /></button>}</td>
                        </tr>
                    );
                })}</tbody>
            </table></div>
            {activo.estado === 'ABIERTO' && <p className="border-t border-line px-5 py-3 text-[13px] text-muted"><AlertTriangle className="mr-1.5 inline size-3.5" />Al aplicar se genera el ajuste del kardex por cada pieza con diferencia. El «sistema» es el stock congelado al abrir el conteo.</p>}
        </Card>
    );
}

export default function Conteos(p) {
    const { negocio, usuario, fecha_larga, stock_bajo, tasa_usd, conteos, activo, categorias } = p;
    const [modal, setModal] = useState(null);
    const [f, setF] = useState({ alcance: 'CATEGORIA', categoria_id: categorias[0]?.id || '', descripcion: '' });
    const [env, setEnv] = useState(false);
    const [err, setErr] = useState('');
    const hecho = () => router.get('/conteos', {}, { preserveScroll: true, preserveState: false });
    const abiertos = useMemo(() => conteos.filter((c) => c.estado === 'ABIERTO'), [conteos]);

    const crear = async () => {
        setErr('');
        setEnv(true);
        try {
            const r = await http('POST', '/conteos', { alcance: f.alcance, descripcion: f.descripcion.trim() || null, categoria_id: f.alcance === 'CATEGORIA' ? f.categoria_id : null });
            setModal(null); hecho();
        } catch (e) { setErr(e.message); }
        setEnv(false);
    };

    return (
        <AppLayout actual="/conteos" titulo="Conteo físico" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Conteo físico" />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Conteo físico de inventario</h2>
                    <p className="mt-1 max-w-[62ch] text-[15px] text-muted">Cuenta un estante (o todo) y aplica los ajustes de una vez. Cada conteo congela el stock del sistema al abrirlo.</p></div>
                <Button onClick={() => setModal(true)} disabled={abiertos.length > 0}><Plus className="size-4" />Nuevo conteo</Button>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Kpi icon={ListChecks} titulo="Conteos abiertos" valor={n0(abiertos.length)} detalle={abiertos.length ? 'Termina o anula antes de abrir otro' : 'Ninguno abierto'} tono={abiertos.length ? 'warn' : undefined} />
                <Kpi icon={ClipboardCheck} titulo="Con diferencia" valor={n0(activo?.con_diferencia ?? 0)} detalle="Piezas distintas al sistema (conteo abierto)" />
                <Kpi icon={Undo2} titulo="Históricos" valor={n0(conteos.length)} detalle="Últimos 60 conteos registrados" />
            </div>

            {abiertos.length > 0 && activo && <PanelConteo activo={activo} hecho={hecho} />}

            <Card>
                <div className="flex items-center gap-2 border-b border-line p-4 sm:p-5"><ClipboardCheck className="size-4 text-muted" /><h3 className="text-[15px] font-semibold">Historial de conteos</h3></div>
                {conteos.length === 0 ? (
                    <Vacio icon={ListChecks} titulo="Todavía no hay conteos" texto="Abre el primero: una categoría, las piezas con stock bajo o todo el catálogo." />
                ) : (
                    <ul>
                        {conteos.map((c) => (
                            <li key={c.id}>
                                <button type="button" onClick={() => router.get('/conteos', { conteo: c.id }, { preserveScroll: true, preserveState: false })}
                                    className={`flex w-full flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3 text-left last:border-0 hover:bg-paper ${activo?.id === c.id ? 'bg-brand-50/60' : ''}`}>
                                    <span className="num w-[84px] shrink-0 text-[13.5px] font-bold">{String(c.numero).padStart(4, '0')}</span>
                                    <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{ALCANCES[c.alcance]}{c.categoria ? ` · ${c.categoria}` : ''}</span>
                                        <span className="block truncate text-[12.5px] text-muted">{c.descripcion || c.por} · {c.fecha}</span></span>
                                    <span className="num shrink-0 text-[13px] text-muted">{c.contadas}/{c.lineas} · {c.con_diferencia} dif.</span>
                                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.estado === 'ABIERTO' ? 'bg-brand-50 text-brand' : c.estado === 'APLICADO' ? 'bg-[#e7f6ee] text-ok' : 'bg-[#fdecec] text-danger'}`}>{c.estado}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {modal && (
                <Modal titulo="Nuevo conteo físico" subtitulo="El stock del sistema se congela al abrir: lo que se venda mientras cuentas no distorsiona el resultado." cerrar={() => setModal(null)} onSubmit={crear} enviando={env} ok="Abrir conteo">
                    <Field select label="Alcance del conteo" forceFloat value={f.alcance} onChange={(e) => setF({ ...f, alcance: e.target.value })}>
                        <option value="CATEGORIA">Una categoría completa</option>
                        <option value="STOCK_BAJO">Solo las piezas con stock bajo</option>
                        <option value="TODO">Todo el catálogo activo</option>
                    </Field>
                    {f.alcance === 'CATEGORIA' && <Field select label="Categoría a contar" forceFloat value={f.categoria_id} onChange={(e) => setF({ ...f, categoria_id: e.target.value })}>
                        {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </Field>}
                    <Field label="Nota (opcional)" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} hint="Ej.: conteo del estante de frenos" />
                    {err && <p className="text-[13px] text-danger">{err}</p>}
                </Modal>
            )}
        </AppLayout>
    );
}
