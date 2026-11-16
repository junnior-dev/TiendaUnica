import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarCheck, Check, CircleX, Landmark, Undo2 } from 'lucide-react';
import { Card, Modal } from '../../Components/kit';
import { Field } from '../../Components/ui';
import { n2 } from '../../lib/format';
import { http } from '../../lib/http';

const fecha = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const SEMAFORO = {
    verde: { punto: 'bg-ok', texto: 'Todo en orden', fondo: 'bg-[#e6f4ec]', tinta: 'text-ok', sub: 'No encontramos nada pendiente para declarar este mes.' },
    ambar: { punto: 'bg-signal', texto: 'Casi listo', fondo: 'bg-signal/15', tinta: 'text-[#8a5a00]', sub: 'Solo hay avisos que conviene revisar; no impiden declarar.' },
    rojo: { punto: 'bg-danger', texto: 'Hay cosas por corregir', fondo: 'bg-[#fdecec]', tinta: 'text-danger', sub: 'Corrige lo marcado en rojo antes de declarar.' },
};

/** Punto de color del botón: se consulta al abrir la página y al cambiar de mes. */
export function useCierre(mes, activo = true) {
    const [c, setC] = useState(null);
    const [cargando, setCargando] = useState(false);
    const cargar = async () => { setCargando(true); try { setC(await http('GET', `/libros-fiscales/validar?mes=${mes}`)); } catch { setC(null); } finally { setCargando(false); } };
    useEffect(() => { if (activo) cargar(); }, [mes]);
    return [c, cargando, cargar];
}

export function PuntoCierre({ c }) {
    if (!c) return null;
    return <span aria-hidden className={`size-2.5 rounded-full ${SEMAFORO[c.semaforo].punto}`} />;
}

export function ModalCierre({ c, cargando, recargar, cerrar, periodo }) {
    const s = c ? SEMAFORO[c.semaforo] : null;
    return (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label="Validar cierre fiscal">
            <div className="fixed inset-0 bg-black/50" onClick={cerrar} />
            <div className="relative my-auto w-full max-w-[620px] rounded-2xl bg-white p-6 shadow-2xl">
                <h2 className="text-lg font-semibold tracking-[-0.01em]">Validar cierre fiscal</h2>
                <p className="mt-1 text-[13px] text-muted">{periodo}. Revisamos tus libros antes de declarar.</p>
                {!c ? <p className="py-10 text-center text-[14px] text-muted" role="status">{cargando ? 'Revisando tus libros…' : 'No se pudo hacer la revisión.'}</p> : (
                    <>
                        <div className={`mt-5 flex items-center gap-3 rounded-xl p-4 ${s.fondo}`}>
                            <span className={`size-4 shrink-0 rounded-full ${s.punto}`} />
                            <div><p className={`text-[16px] font-semibold ${s.tinta}`}>{s.texto}</p><p className="text-[13px] text-text/80">{s.sub}</p></div>
                        </div>
                        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
                            {c.items.map((i) => (
                                <li key={i.clave} className="flex items-start gap-3 px-4 py-3">
                                    {i.estado === 'ok' ? <Check className="mt-0.5 size-[18px] shrink-0 text-ok" /> : i.estado === 'bad' ? <CircleX className="mt-0.5 size-[18px] shrink-0 text-danger" /> : <AlertTriangle className="mt-0.5 size-[18px] shrink-0 text-[#8a5a00]" />}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[14.5px] font-medium leading-snug">{i.titulo}</p>
                                        {i.detalle && <p className="mt-0.5 text-[13px] leading-snug text-muted">{i.detalle}</p>}
                                    </div>
                                    {i.enlace && <a href={i.enlace} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[13px] font-medium text-brand hover:underline">{i.accion}<ArrowRight className="size-3.5" /></a>}
                                </li>))}
                        </ul>
                        <p className="mt-3 text-[12.5px] leading-snug text-muted">Es una revisión de tus propios registros. No consulta el Portal Fiscal ni sustituye la revisión de tu contador.</p>
                    </>)}
                <div className="mt-6 flex justify-end gap-3">
                    <button type="button" onClick={recargar} disabled={cargando} className="inline-flex h-11 items-center rounded-lg border border-line px-5 text-[15px] font-semibold hover:bg-paper disabled:opacity-60">{cargando ? 'Revisando…' : 'Revisar de nuevo'}</button>
                    <button type="button" onClick={cerrar} className="inline-flex h-11 items-center rounded-lg bg-brand px-5 text-[15px] font-semibold text-white hover:bg-brand-600">Listo</button>
                </div>
            </div>
        </div>
    );
}

/** Retenciones que tú practicas a proveedores, por quincena: lo que debes enterar y su control. */
export function Quincenas({ inicial, mes, hoy }) {
    const [q, setQ] = useState(inicial);
    const [marcar, setMarcar] = useState(null);
    const [deshacer, setDeshacer] = useState(null);
    useEffect(() => setQ(inicial), [inicial]);
    if (!q?.activo) return (
        <Card className="mb-6"><div className="p-5 text-[14px] text-muted"><p className="font-semibold text-text">Retenciones por enterar</p><p className="mt-1">Para llevar el control de lo que ya pagaste al SENIAT por quincena, ejecuta el archivo 11_cierre_y_pagos.sql en tu base de datos (requiere el 08).</p></div></Card>
    );
    const filas = [...(q.anteriores || []), ...q.filas];
    const porPagar = filas.filter((x) => !x.enterada).reduce((s, x) => s + x.monto, 0);
    return (
        <Card className="mb-6">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div><h3 className="text-[16px] font-semibold">Retenciones por enterar</h3><p className="mt-0.5 max-w-[60ch] text-[13px] text-muted">Lo que retuviste a tus proveedores, agrupado por quincena de emisión del comprobante (1 al 15 y 16 al fin de mes). Márcalo cuando lo pagues al SENIAT.</p></div>
                <div className="text-right"><p className="text-[12.5px] text-muted">Por pagar</p><p className={`num text-[20px] font-semibold ${porPagar > 0 ? '' : 'text-ok'}`}>Bs {n2(porPagar)}</p></div>
            </div>
            {filas.length === 0 ? <p className="px-5 py-6 text-[14px] text-muted">No retuviste IVA a proveedores en este mes ni hay quincenas anteriores pendientes.</p> : (
                <ul className="divide-y divide-line">
                    {filas.map((x) => (
                        <li key={`${x.anio}-${x.mes}-${x.quincena}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                            <div className="min-w-[180px] flex-1">
                                <p className="text-[14.5px] font-medium">{x.quincena === 1 ? '1.ª' : '2.ª'} quincena de {MES[x.mes - 1]} {x.anio}{x.mes + '' !== mes.slice(5).replace(/^0/, '') && !x.enterada && <span className="ml-2 rounded-full bg-signal/15 px-2 py-0.5 text-xs font-medium text-[#8a5a00]">De un mes anterior</span>}</p>
                                <p className="text-[13px] text-muted">Del {fecha(x.desde)} al {fecha(x.hasta)} · {x.comprobantes} {x.comprobantes === 1 ? 'comprobante' : 'comprobantes'}{!x.cerrada && !x.enterada && ' · aún en curso'}</p>
                            </div>
                            <p className="num text-[15px] font-semibold">Bs {n2(x.monto)}</p>
                            {x.enterada ? (
                                <div className="flex items-center gap-3">
                                    <span className="text-right text-[13px] text-ok"><span className="inline-flex items-center gap-1 font-medium"><Check className="size-4" />Enterada el {fecha(x.fecha_pago)}</span>{x.referencia && <span className="num block text-muted">Ref. {x.referencia}</span>}</span>
                                    <button onClick={() => setDeshacer(x)} className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-paper hover:text-text" aria-label="Deshacer marca de enterada" title="Deshacer"><Undo2 className="size-4" /></button>
                                </div>
                            ) : <button onClick={() => setMarcar(x)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper"><Landmark className="size-4" />Marcar como enterada</button>}
                        </li>))}
                </ul>)}
            <p className="border-t border-line px-5 py-3 text-[12.5px] leading-snug text-muted">Marcar una quincena no mueve dinero ni crea asientos: es tu control de lo que ya pagaste. El plazo de cada quincena lo fija el calendario del SENIAT; confírmalo con tu contador.</p>
            {marcar && <ModalEnterar x={marcar} mes={mes} hoy={hoy} cerrar={() => setMarcar(null)} listo={(r) => { setQ(r); setMarcar(null); }} />}
            {deshacer && <ModalDeshacer x={deshacer} mes={mes} cerrar={() => setDeshacer(null)} listo={(r) => { setQ(r); setDeshacer(null); }} />}
        </Card>
    );
}

function ModalEnterar({ x, mes, hoy, cerrar, listo }) {
    const [f, setF] = useState({ fecha_pago: hoy, referencia: '' });
    const [er, setEr] = useState('');
    const [env, setEnv] = useState(false);
    const enviar = async () => {
        if (!f.fecha_pago) return setEr('Elige la fecha en que pagaste.');
        setEnv(true);
        try { const r = await http('POST', `/libros-fiscales/retenciones/enterar?mes=${mes}`, { anio: x.anio, mes: x.mes, quincena: x.quincena, fecha_pago: f.fecha_pago, referencia: f.referencia || null }); listo(r.quincenas); }
        catch (e) { setEr(Object.values(e.errors || {})[0]?.[0] || e.message); } finally { setEnv(false); }
    };
    return (
        <Modal titulo="Marcar como enterada" subtitulo={`${x.quincena === 1 ? '1.ª' : '2.ª'} quincena de ${MES[x.mes - 1]} ${x.anio} · ${x.comprobantes} ${x.comprobantes === 1 ? 'comprobante' : 'comprobantes'}`} cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Marcar como enterada">
            {er && <p role="alert" className="rounded-lg bg-[#fdecec] p-3 text-[14px] text-danger">{er}</p>}
            <div className="rounded-xl bg-paper p-4"><p className="text-[13px] text-muted">Total a pagar al SENIAT</p><p className="num text-[24px] font-semibold">Bs {n2(x.monto)}</p></div>
            <Field label="Fecha en que lo pagaste" type="date" value={f.fecha_pago} max={hoy} forceFloat onChange={(e) => setF({ ...f, fecha_pago: e.target.value })} />
            <Field label="Referencia o planilla de pago (opcional)" value={f.referencia} onChange={(e) => setF({ ...f, referencia: e.target.value })} icon={CalendarCheck} />
        </Modal>
    );
}

function ModalDeshacer({ x, mes, cerrar, listo }) {
    const [motivo, setMotivo] = useState('');
    const [er, setEr] = useState('');
    const [env, setEnv] = useState(false);
    const enviar = async () => {
        if (motivo.trim().length < 3) return setEr('Cuéntanos por qué la desmarcas.');
        setEnv(true);
        try { const r = await http('POST', `/libros-fiscales/retenciones/enteradas/${x.enterado_id}/desmarcar?mes=${mes}`, { motivo: motivo.trim() }); listo(r.quincenas); }
        catch (e) { setEr(e.message); } finally { setEnv(false); }
    };
    return (
        <Modal titulo="Deshacer marca de enterada" subtitulo={`${x.quincena === 1 ? '1.ª' : '2.ª'} quincena de ${MES[x.mes - 1]} ${x.anio} · pagada el ${fecha(x.fecha_pago)}`} peligro cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Deshacer">
            <p className="text-sm">La quincena vuelve a aparecer como pendiente. El registro anterior queda guardado con tu motivo.</p>
            <Field label="Motivo" value={motivo} autoFocus onChange={(e) => setMotivo(e.target.value)} error={er} />
        </Modal>
    );
}
