import { Head, router } from '@inertiajs/react';
import { useState } from 'react';
import { CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, CircleAlert, ClipboardPaste, Pencil, Plus, Trash2 } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi, Modal, Toast, Vacio } from '../../Components/kit';
import { Field, Segmented } from '../../Components/ui';
import { http } from '../../lib/http';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const REG = { ESPECIAL: 'Contribuyente especial', ORDINARIO: 'Contribuyente ordinario' };
const periodoTxt = (v) => (v.tipo === 'MES' ? `Mes de ${MESES[Number(v.desde.slice(5, 7)) - 1]}` : v.tipo === 'ANIO' ? `Ejercicio ${v.desde.slice(0, 4)}` : `Del ${dmy(v.desde).slice(0, 5)} al ${dmy(v.hasta)}`);
const Alerta = ({ children, tono = 'bad' }) => (
    <p role={tono === 'bad' ? 'alert' : undefined} className={`flex items-start gap-2 rounded-lg p-3 text-[13.5px] leading-snug ${tono === 'bad' ? 'bg-[#fdecec] text-danger' : 'bg-signal/15 text-[#7a4d00]'}`}>
        <CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{children}</span>
    </p>
);
const Pill = ({ c, children }) => <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${c}`}>{children}</span>;

/* ───── Una fecha (nueva o corregida). «Todos» sirve para fechas iguales para cualquier RIF, como en un ordinario ───── */
function ModalFecha({ d, inicial, cerrar, listo }) {
    const nueva = !inicial;
    const [f, setF] = useState(inicial ? { regimen: inicial.regimen, obligacion: inicial.obligacion, digito: String(inicial.digito), desde: inicial.desde, hasta: inicial.hasta, fecha: inicial.fecha, fuente: inicial.fuente ?? '' }
        : { regimen: d.admin.reg, obligacion: d.obligaciones[0]?.codigo ?? '', digito: '0', desde: '', hasta: '', fecha: '', fuente: '' });
    const [err, setErr] = useState(''); const [env, setEnv] = useState(false);
    const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
    const enviar = async () => {
        if (!f.desde || !f.hasta || !f.fecha) return setErr('Completa las tres fechas: el período (desde y hasta) y la fecha límite.');
        setEnv(true);
        try { await http('POST', '/calendario-fiscal/fecha', f); listo(nueva ? 'Fecha agregada al calendario' : 'Fecha corregida'); }
        catch (e) { setErr(Object.values(e.errors || {})[0]?.[0] || e.message); setEnv(false); }
    };
    return (
        <Modal titulo={nueva ? 'Agregar una fecha' : 'Corregir fecha'} subtitulo="El período es lo que se declara (por ejemplo, del 1 al 15 de enero). La fecha límite es el último día para presentarlo." cerrar={cerrar} onSubmit={enviar} enviando={env} ok={nueva ? 'Agregar' : 'Guardar cambios'} ancho="max-w-[520px]">
            {err && <Alerta>{err}</Alerta>}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field select label="Régimen" value={f.regimen} onChange={set('regimen')} disabled={!nueva}><option value="ESPECIAL">{REG.ESPECIAL}</option><option value="ORDINARIO">{REG.ORDINARIO}</option></Field>
                <Field select label="Último dígito del RIF" value={f.digito} onChange={set('digito')} disabled={!nueva}>
                    {nueva && <option value="todos">Todos los dígitos</option>}{[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => <option key={x} value={x}>{x}</option>)}
                </Field>
            </div>
            <Field select label="Obligación" value={f.obligacion} onChange={set('obligacion')} disabled={!nueva}>{d.obligaciones.map((o) => <option key={o.codigo} value={o.codigo}>{o.titulo}</option>)}</Field>
            <div className="grid gap-4 sm:grid-cols-3">
                <Field type="date" forceFloat label="Período desde" value={f.desde} onChange={set('desde')} disabled={!nueva} />
                <Field type="date" forceFloat label="Período hasta" value={f.hasta} onChange={set('hasta')} />
                <Field type="date" forceFloat label="Fecha límite" value={f.fecha} onChange={set('fecha')} />
            </div>
            <Field label="Fuente (opcional)" value={f.fuente} onChange={set('fuente')} hint="Por ejemplo: Providencia SNAT/2026/000123 o «me lo indicó mi contador»." maxLength={120} />
        </Modal>
    );
}

/* ───── Carga de un año completo pegando el texto de la providencia ───── */
function ModalCargar({ d, cerrar, listo }) {
    const [f, setF] = useState({ regimen: d.admin.reg, fuente: '', texto: '' });
    const [err, setErr] = useState(''); const [env, setEnv] = useState(false);
    const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
    const enviar = async () => {
        if (!f.texto.trim()) return setErr('Pega al menos una línea.');
        setEnv(true);
        try { const r = await http('POST', '/calendario-fiscal/cargar', f); listo(`${r.guardadas} ${r.guardadas === 1 ? 'fecha cargada' : 'fechas cargadas'}`); }
        catch (e) { setErr(Object.values(e.errors || {})[0]?.[0] || e.message); setEnv(false); }
    };
    return (
        <Modal titulo="Cargar varias fechas" subtitulo="Una fecha por línea. Si una línea tiene un error no se guarda ninguna, y las fechas que ya existan se corrigen." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Cargar fechas" ancho="max-w-[620px]">
            {err && <Alerta>{err}</Alerta>}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field select label="Régimen" value={f.regimen} onChange={set('regimen')}><option value="ESPECIAL">{REG.ESPECIAL}</option><option value="ORDINARIO">{REG.ORDINARIO}</option></Field>
                <Field label="Fuente (opcional)" value={f.fuente} onChange={set('fuente')} maxLength={120} />
            </div>
            <div>
                <label htmlFor="txt" className="mb-1.5 block text-[13px] font-medium text-muted">Fechas (obligación; dígito; desde; hasta; fecha límite)</label>
                <textarea id="txt" value={f.texto} onChange={set('texto')} rows={9} spellCheck={false}
                    placeholder={'IVA; 0; 2027-01-01; 2027-01-15; 2027-01-27\nIVA; 1; 2027-01-01; 2027-01-15; 2027-01-19\nISLR_ESTIMADA; todos; 01/01/2027; 31/01/2027; 15/01/2027'}
                    className="w-full rounded-lg border border-line bg-white p-3 font-mono text-[13px] leading-relaxed placeholder:text-[#9aa4af] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                <p className="mt-1.5 text-[13px] leading-snug text-muted">Códigos de obligación: {d.obligaciones.map((o) => o.codigo).join(', ')}. El dígito es de 0 a 9 o «todos». Fechas como AAAA-MM-DD o DD/MM/AAAA. Las líneas que empiezan con # se ignoran.</p>
            </div>
        </Modal>
    );
}

function ModalObligacion({ cerrar, listo }) {
    const [f, setF] = useState({ codigo: '', titulo: '', periodo: 'MES' });
    const [err, setErr] = useState(''); const [env, setEnv] = useState(false);
    const set = (k) => (e) => setF((p) => ({ ...p, [k]: k === 'codigo' ? e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') : e.target.value }));
    const enviar = async () => {
        setEnv(true);
        try { await http('POST', '/calendario-fiscal/obligacion', f); listo('Obligación agregada'); }
        catch (e) { setErr(Object.values(e.errors || {})[0]?.[0] || e.message); setEnv(false); }
    };
    return (
        <Modal titulo="Nueva obligación" subtitulo="Para algo que el SENIAT te pida y no esté en la lista (por ejemplo, un pago de ISLR definitivo)." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Agregar">
            {err && <Alerta>{err}</Alerta>}
            <Field label="Nombre" value={f.titulo} onChange={set('titulo')} maxLength={100} />
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Código" value={f.codigo} onChange={set('codigo')} maxLength={20} hint="Letras, números y guion bajo." />
                <Field select label="Se declara por" value={f.periodo} onChange={set('periodo')}><option value="QUINCENA">Quincena</option><option value="MES">Mes</option><option value="ANIO">Año (ejercicio)</option><option value="OTRO">Otro</option></Field>
            </div>
        </Modal>
    );
}

/* ───── Pestaña 1: el calendario del negocio, mes a mes ───── */
function MiCalendario({ d, hecho }) {
    const [env, setEnv] = useState(null); const [err, setErr] = useState('');
    const accion = async (v, quitar) => {
        setEnv(v.obligacion + v.desde); setErr('');
        try { await http('POST', quitar ? '/calendario-fiscal/presentada/quitar' : '/calendario-fiscal/presentada', quitar ? { obligacion: v.obligacion, desde: v.desde } : { obligacion: v.obligacion, desde: v.desde, fecha: d.hoy }); router.reload({ preserveScroll: true }); }
        catch (e) { setErr(e.message); } finally { setEnv(null); }
    };
    const cal = d.calendario;
    const pend = cal.filter((v) => !v.presentada);
    const vencidas = pend.filter((v) => v.dias < 0).length;
    const proxima = pend.find((v) => v.dias >= 0);
    const porMes = Array.from({ length: 12 }, (_, i) => cal.filter((v) => Number(v.fecha.slice(5, 7)) === i + 1));
    if (d.mi.digito === null) return <Card className="mt-5"><Vacio icon={CalendarClock} titulo="Falta el RIF de tu negocio" texto="El calendario se ajusta al último dígito de tu RIF. Regístralo en Configuración → Negocio." /></Card>;
    return (
        <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi icon={CalendarClock} titulo="Tu calendario" valor={`Dígito ${d.mi.digito}`} detalle={`${REG[d.mi.regimen]} · RIF ${d.mi.rif}`} />
                <Kpi icon={CalendarClock} titulo="Fechas del año" valor={String(cal.length)} detalle={`${cal.length - pend.length} presentadas`} />
                <Kpi icon={CalendarClock} titulo="Vencidas sin marcar" valor={String(vencidas)} detalle={vencidas ? 'Revisa si ya las presentaste' : 'Al día'} tono={vencidas ? 'bad' : undefined} />
                <Kpi icon={CalendarClock} titulo="Próximo vencimiento" valor={proxima ? dmy(proxima.fecha) : 'Ninguno'} detalle={proxima ? `En ${proxima.dias} ${proxima.dias === 1 ? 'día' : 'días'}` : 'No hay fechas por venir'} />
            </div>
            {err && <div className="mt-4"><Alerta>{err}</Alerta></div>}
            {cal.length === 0 ? (
                <Card className="mt-5"><Vacio icon={CalendarPlus} titulo={`Aún no hay fechas para ${d.anio}`} texto={`Cuando el SENIAT publique el calendario de ${d.anio}, cárgalo en la pestaña «Administrar fechas». Mientras no haya fechas, el Panel no mostrará vencimientos.`} /></Card>
            ) : (
                <div className="mt-5 space-y-4">
                    {porMes.map((fs, i) => fs.length > 0 && (
                        <Card key={i}>
                            <h3 className="border-b border-line px-5 py-3 text-[15px] font-semibold capitalize">{MESES[i]} {d.anio}</h3>
                            <ul className="divide-y divide-line px-5">
                                {fs.map((v) => {
                                    const venc = !v.presentada && v.dias < 0, pronto = !v.presentada && v.dias >= 0 && v.dias <= 3;
                                    return (
                                        <li key={v.obligacion + v.desde} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                                            <span className="w-12 shrink-0 text-[20px] font-semibold tabular-nums">{v.fecha.slice(8, 10)}</span>
                                            <div className="min-w-0 flex-1"><p className="text-[14.5px] font-medium">{v.titulo}</p><p className="text-[13px] text-muted">{periodoTxt(v)}</p></div>
                                            <Pill c={v.presentada ? 'bg-[#e7f6ee] text-ok' : venc ? 'bg-[#fdecec] text-danger' : pronto ? 'bg-signal/20 text-[#7a4d00]' : 'bg-paper text-muted'}>
                                                {v.presentada ? `Presentada el ${dmy(v.presentada_en)}` : venc ? 'Vencida' : v.dias === 0 ? 'Vence hoy' : `En ${v.dias} ${v.dias === 1 ? 'día' : 'días'}`}
                                            </Pill>
                                            <button type="button" onClick={() => accion(v, v.presentada)} disabled={env === v.obligacion + v.desde} className="text-[13px] font-semibold text-brand hover:underline disabled:opacity-50">{v.presentada ? 'Quitar marca' : 'Ya la presenté'}</button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </Card>
                    ))}
                </div>
            )}
            <p className="mt-4 text-[12.5px] leading-snug text-muted">Las fechas salen de lo que cargaste en «Administrar fechas» para tu régimen y el último dígito de tu RIF. No descuentan feriados: confírmalas en el portal del SENIAT. El sistema no presenta las declaraciones por ti.</p>
        </>
    );
}

/* ───── Pestaña 2: el administrador carga y corrige las fechas ───── */
function Administrar({ d, abrir, hecho }) {
    const { admin, obligaciones } = d;
    const [err, setErr] = useState('');
    const ir = (c) => router.get('/calendario-fiscal', { anio: d.anio, tab: 'admin', reg: admin.reg, obl: admin.obl, dig: admin.dig ?? '', ...c }, { preserveState: true, replace: true });
    const quitar = async (x) => {
        if (!window.confirm(`¿Eliminar la fecha del ${dmy(x.fecha)} (${x.titulo}, dígito ${x.digito})?`)) return;
        setErr('');
        try { await http('POST', '/calendario-fiscal/fecha/eliminar', { regimen: x.regimen, obligacion: x.obligacion, digito: x.digito, desde: x.desde }); hecho('Fecha eliminada'); }
        catch (e) { setErr(e.message); }
    };
    return (
        <>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <select aria-label="Régimen" value={admin.reg} onChange={(e) => ir({ reg: e.target.value })} className="h-10 rounded-lg border border-line bg-white px-3 text-[14px]"><option value="ESPECIAL">{REG.ESPECIAL}</option><option value="ORDINARIO">{REG.ORDINARIO}</option></select>
                    <select aria-label="Obligación" value={admin.obl} onChange={(e) => ir({ obl: e.target.value })} className="h-10 rounded-lg border border-line bg-white px-3 text-[14px]"><option value="">Todas las obligaciones</option>{obligaciones.map((o) => <option key={o.codigo} value={o.codigo}>{o.titulo}</option>)}</select>
                    <select aria-label="Dígito del RIF" value={admin.dig ?? ''} onChange={(e) => ir({ dig: e.target.value })} className="h-10 rounded-lg border border-line bg-white px-3 text-[14px]"><option value="">Todos los dígitos</option>{[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => <option key={x} value={x}>Dígito {x}</option>)}</select>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => abrir({ t: 'obligacion' })} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[14px] font-semibold hover:bg-paper"><Plus className="size-4" />Nueva obligación</button>
                    <button type="button" onClick={() => abrir({ t: 'cargar' })} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[14px] font-semibold hover:bg-paper"><ClipboardPaste className="size-4" />Cargar varias</button>
                    <button type="button" onClick={() => abrir({ t: 'fecha' })} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-[14px] font-semibold text-white hover:bg-brand-600"><Plus className="size-4" />Agregar fecha</button>
                </div>
            </div>
            {err && <div className="mt-4"><Alerta>{err}</Alerta></div>}
            <Card className="mt-4">
                {admin.filas.length === 0 ? (
                    <Vacio icon={CalendarPlus} titulo={`Sin fechas de ${d.anio} para este filtro`} texto="Agrega una fecha o pega las del año con «Cargar varias». El año de una fecha es el de su fecha límite." />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[720px] text-left text-[14px]">
                            <thead><tr className="border-b border-line text-[12.5px] text-muted"><th className="px-5 py-3 font-medium">Vence</th><th className="px-3 py-3 font-medium">Obligación</th><th className="px-3 py-3 font-medium">Dígito</th><th className="px-3 py-3 font-medium">Período</th><th className="px-3 py-3 font-medium">Fuente</th><th className="w-24 px-5 py-3" /></tr></thead>
                            <tbody className="divide-y divide-line">
                                {admin.filas.map((x) => (
                                    <tr key={x.regimen + x.obligacion + x.digito + x.desde}>
                                        <td className="whitespace-nowrap px-5 py-2.5 font-medium tabular-nums">{dmy(x.fecha)}</td>
                                        <td className="px-3 py-2.5">{x.titulo}</td>
                                        <td className="px-3 py-2.5 tabular-nums">{x.digito}</td>
                                        <td className="whitespace-nowrap px-3 py-2.5 text-muted">{dmy(x.desde)} al {dmy(x.hasta)}</td>
                                        <td className="max-w-[220px] truncate px-3 py-2.5 text-[13px] text-muted" title={x.fuente || ''}>{x.fuente || '—'}</td>
                                        <td className="px-5 py-2.5"><div className="flex justify-end gap-1">
                                            <button type="button" onClick={() => abrir({ t: 'fecha', x })} aria-label="Corregir" className="grid size-8 place-items-center rounded-md text-muted hover:bg-paper hover:text-ink"><Pencil className="size-4" /></button>
                                            <button type="button" onClick={() => quitar(x)} aria-label="Eliminar" className="grid size-8 place-items-center rounded-md text-muted hover:bg-[#fdecec] hover:text-danger"><Trash2 className="size-4" /></button>
                                        </div></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {admin.total > admin.filas.length && <p className="border-t border-line px-5 py-3 text-[13px] text-muted">Se muestran {admin.filas.length} de {admin.total} fechas. Filtra por obligación o por dígito para ver el resto.</p>}
            </Card>
        </>
    );
}

export default function Index(p) {
    const { usuario, negocio, stock_bajo, tasa_usd, instalado, anio } = p;
    const [tab, setTab] = useState(() => (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'admin' ? 'admin' : 'mio'));
    const [modal, setModal] = useState(null);
    const [aviso, setAviso] = useState('');
    const layout = { actual: '/calendario-fiscal', titulo: 'Calendario fiscal', subtitulo: 'Cuándo vence cada declaración según tu régimen y el último dígito de tu RIF', usuario, negocio, stockBajo: stock_bajo, tasaUsd: tasa_usd };
    const hecho = (t) => { setModal(null); setAviso(t); router.reload({ preserveScroll: true }); };

    if (!instalado) return (
        <AppLayout {...layout}><Head title="Calendario fiscal" />
            <Card><Vacio icon={CalendarClock} titulo="Falta instalar este módulo" texto="Ejecuta 21_calendario_fiscal.sql y 22_calendario_parametrizable.sql en tu base de datos y recarga la página." /></Card>
        </AppLayout>
    );

    const ir = (a) => router.get('/calendario-fiscal', { anio: a, tab, reg: p.admin.reg }, { preserveState: true, replace: true });
    return (
        <AppLayout {...layout}>
            <Head title="Calendario fiscal" />
            <Toast texto={aviso} />
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-white p-1">
                    <button type="button" onClick={() => ir(anio - 1)} aria-label="Año anterior" className="grid size-9 place-items-center rounded-lg hover:bg-paper"><ChevronLeft className="size-4" /></button>
                    <span className="min-w-[90px] text-center text-[14.5px] font-semibold tabular-nums">{anio}</span>
                    <button type="button" onClick={() => ir(anio + 1)} aria-label="Año siguiente" className="grid size-9 place-items-center rounded-lg hover:bg-paper"><ChevronRight className="size-4" /></button>
                </div>
                <div className="w-full sm:w-[380px]">
                    <Segmented compact name="Vista" value={tab} onChange={setTab} options={[{ value: 'mio', label: 'Mi calendario' }, { value: 'admin', label: 'Administrar fechas' }]} />
                </div>
            </div>

            {tab === 'mio' ? <MiCalendario d={p} hecho={hecho} /> : <Administrar d={p} abrir={setModal} hecho={hecho} />}

            {modal?.t === 'fecha' && <ModalFecha d={p} inicial={modal.x} cerrar={() => setModal(null)} listo={hecho} />}
            {modal?.t === 'cargar' && <ModalCargar d={p} cerrar={() => setModal(null)} listo={hecho} />}
            {modal?.t === 'obligacion' && <ModalObligacion cerrar={() => setModal(null)} listo={hecho} />}
        </AppLayout>
    );
}
