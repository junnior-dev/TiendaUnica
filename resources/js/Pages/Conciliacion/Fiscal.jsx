import { useState } from 'react';
import { router } from '@inertiajs/react';
import { CircleAlert, CircleCheck, CircleDashed, FileDown, Pencil, Plus, Scale, Trash2, TriangleAlert } from 'lucide-react';
import { Card, Kpi, Modal } from '../../Components/kit';
import { Button, Field, Segmented } from '../../Components/ui';
import { http } from '../../lib/http';
import { n2 } from '../../lib/format';
import { numero } from '../../lib/leerExtracto';
import { dmy, mesLargo, ModalPdf, monto, Semaforo } from './comun';

const TIPO_CORTO = { FORMA_30: 'Forma 30 (IVA)', RETENCIONES_IVA: 'Retenciones de IVA', IGTF: 'IGTF' };

/* ───────── Registrar lo que se declaró ───────── */
function ModalDeclaracion({ t, periodo, cerrar, guardado }) {
    const previo = Object.fromEntries(t.filas.map((f) => [f.concepto, f.declarado === null ? '' : n2(f.declarado)]));
    const [m, setM] = useState(previo); const [planilla, setPlanilla] = useState(t.declaracion?.numero_planilla || ''); const [fecha, setFecha] = useState(t.declaracion?.fecha_presentacion || ''); const [obs, setObs] = useState(t.declaracion?.observaciones || '');
    const [errs, setErrs] = useState({}); const [env, setEnv] = useState(false);
    const enviar = async () => {
        const montos = {}; const e = {};
        for (const [k, v] of Object.entries(m)) { if (v.trim() === '') continue; const n = numero(v); if (n === null || n < 0) e[k] = 'Escribe un monto de 0 en adelante. Ejemplo: 1.234,56'; else montos[k] = n; }
        if (Object.keys(e).length) return setErrs(e);
        setEnv(true); setErrs({});
        try { const r = await http('POST', '/conciliacion/fiscal', { tipo: t.tipo, periodicidad: periodo.periodicidad, mes: periodo.mes, quincena: periodo.quincena, numero_planilla: planilla, fecha_presentacion: fecha || null, observaciones: obs, montos }); guardado(r.fiscal); }
        catch (x) { setErrs(x.errors ? Object.fromEntries(Object.entries(x.errors).map(([k, v]) => [k.replace('montos.', ''), v[0]])) : { general: x.message }); } finally { setEnv(false); }
    };
    return (
        <Modal titulo={t.titulo} subtitulo={`Anota lo que presentaste en el portal del SENIAT · ${periodo.quincena ? `quincena ${periodo.quincena} de ${mesLargo(periodo.mes)}` : mesLargo(periodo.mes)}`} cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Guardar declaración" ancho="max-w-[560px]">
            {errs.general && <p className="flex items-start gap-2 rounded-lg bg-[#fde8e6] p-3 text-[14px] text-danger"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{errs.general}</p>}
            {errs.montos && <p className="flex items-start gap-2 rounded-lg bg-[#fde8e6] p-3 text-[14px] text-danger"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{errs.montos}</p>}
            <div className="grid gap-3">{t.filas.map((f) => <Field key={f.concepto} label={`${f.etiqueta}${f.unidad === 'USD' ? ' (US$)' : ' (Bs)'}`} inputMode="decimal" value={m[f.concepto]} onChange={(e) => setM({ ...m, [f.concepto]: e.target.value })} error={errs[f.concepto]} hint={`El sistema calcula ${f.unidad === 'USD' ? 'US$' : 'Bs'} ${n2(f.sistema)}`} />)}</div>
            <div className="grid grid-cols-2 gap-3"><Field label="N.º de planilla (opcional)" value={planilla} onChange={(e) => setPlanilla(e.target.value)} maxLength={40} error={errs.numero_planilla} /><Field label="Presentada el" type="date" forceFloat value={fecha} onChange={(e) => setFecha(e.target.value)} error={errs.fecha_presentacion} /></div>
            <Field label="Observaciones (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
            <p className="text-[13px] text-muted">Los conceptos que dejes en blanco se toman como 0. Si ya habías registrado este período, esto lo reemplaza.</p>
        </Modal>
    );
}

/* ───────── Reporte PDF ───────── */
function ModalReporte({ fiscal, cerrar }) {
    const [desde, setDesde] = useState(fiscal.periodo.mes); const [hasta, setHasta] = useState(fiscal.periodo.mes);
    return (
        <ModalPdf titulo="Reporte de conciliación fiscal" subtitulo="Sistema contra declarado, con semáforo. Hasta 12 meses por reporte." cerrar={cerrar}
            generar={async ({ folio, contador }) => { const d = await http('GET', `/conciliacion/fiscal/reporte?desde=${desde}&hasta=${hasta}&periodicidad=${fiscal.periodo.periodicidad}`); const lib = await import('../../lib/pdfConciliacion'); return { doc: await lib.pdfReporteFiscal(d, { folio, contador }), archivo: `conciliacion-fiscal-${d.desde_mes}${d.desde_mes === d.hasta_mes ? '' : '-a-' + d.hasta_mes}.pdf` }; }}>
            <div className="grid grid-cols-2 gap-3"><Field label="Desde el mes" type="month" forceFloat value={desde} onChange={(e) => setDesde(e.target.value)} /><Field label="Hasta el mes" type="month" forceFloat value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        </ModalPdf>
    );
}

/* ───────── Pestaña ───────── */
export default function Fiscal({ fiscal, setFiscal, mes, periodicidad, quincena, regimenEspecial }) {
    const [modal, setModal] = useState(null); const [error, setError] = useState('');
    const ir = (c) => router.get('/conciliacion', { vista: 'fiscal', mes, periodicidad, quincena, ...c }, { preserveScroll: true, preserveState: false });
    const quitar = async (t) => { try { const r = await http('DELETE', `/conciliacion/fiscal/${t.declaracion.id}`); setFiscal(r.fiscal); setModal(null); } catch (e) { setError(e.message); } };
    if (!fiscal) return null;
    const { periodo, tipos, resumen, historial } = fiscal;
    const quincenal = periodicidad === 'QUINCENAL';
    return (
        <div className="space-y-5">
            <Card><div className="flex flex-wrap items-end gap-4 p-4">
                <div className="w-full sm:w-52"><div className="mb-1.5 text-[13px] text-muted">Se declara</div><Segmented compact name="Periodicidad" value={periodicidad} onChange={(v) => ir({ periodicidad: v })} options={[{ value: 'MENSUAL', label: 'Mensual' }, { value: 'QUINCENAL', label: 'Quincenal' }]} /></div>
                <Field className="w-full sm:w-52" label="Mes" type="month" forceFloat value={mes} onChange={(e) => e.target.value && ir({ mes: e.target.value })} />
                {quincenal && <div className="w-full sm:w-52"><div className="mb-1.5 text-[13px] text-muted">Quincena</div><Segmented compact name="Quincena" value={String(quincena)} onChange={(v) => ir({ quincena: Number(v) })} options={[{ value: '1', label: '1 al 15' }, { value: '2', label: '16 al fin' }]} /></div>}
                <div className="flex-1" /><Button variant="ghost" onClick={() => setModal({ t: 'reporte' })}><FileDown className="size-4" />Reporte PDF</Button>
                <p className="w-full text-[13px] text-muted">Período: del {dmy(periodo.desde)} al {dmy(periodo.hasta)}.{regimenEspecial && !quincenal ? ' Eres contribuyente especial: normalmente declaras por quincena.' : ''}</p>
            </div></Card>
            {error && <p className="flex items-start gap-2 rounded-lg bg-[#fde8e6] px-3 py-2 text-[14px] text-danger"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{error}</p>}

            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Kpi icon={CircleCheck} titulo="Cuadran" valor={resumen.CUADRA} detalle="Sistema y planilla coinciden" />
                <Kpi icon={CircleAlert} tono={resumen.REDONDEO ? 'warn' : undefined} titulo="Diferencia por redondeo" valor={resumen.REDONDEO} detalle="Hasta Bs 1,00 de diferencia" />
                <Kpi icon={TriangleAlert} tono={resumen.NO_CUADRA ? 'bad' : undefined} titulo="No cuadran" valor={resumen.NO_CUADRA} detalle="Revisa antes de firmar" />
                <Kpi icon={CircleDashed} titulo="Sin declarar" valor={resumen.SIN_DECLARAR} detalle="Falta anotar la planilla" />
            </div>

            {tipos.map((t) => (
                <Card key={t.tipo}>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
                        <div><h3 className="text-[16px] font-semibold">{t.titulo}</h3><p className="mt-0.5 text-[13px] text-muted">{t.declaracion ? `Planilla ${t.declaracion.numero_planilla ? 'N.º ' + t.declaracion.numero_planilla : 'sin número'}${t.declaracion.fecha_presentacion ? ` · presentada el ${dmy(t.declaracion.fecha_presentacion)}` : ''}` : 'Todavía no anotaste lo que declaraste en este período.'}</p></div>
                        <div className="flex gap-2">
                            <button onClick={() => setModal({ t: 'declarar', tipo: t })} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper">{t.declaracion ? <><Pencil className="size-4" />Editar lo declarado</> : <><Plus className="size-4" />Anotar lo declarado</>}</button>
                            {t.declaracion && <button onClick={() => setModal({ t: 'borrar', tipo: t })} aria-label="Quitar declaración" className="grid size-10 place-items-center rounded-lg text-muted hover:bg-[#fde8e6] hover:text-danger"><Trash2 className="size-4" /></button>}
                        </div>
                    </div>
                    <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left">
                        <thead><tr className="border-b border-line bg-paper text-[13px] text-muted"><th className="px-4 py-2.5 font-medium">Concepto</th><th className="px-3 py-2.5 text-right font-medium">Según el sistema</th><th className="px-3 py-2.5 text-right font-medium">Declarado</th><th className="px-3 py-2.5 text-right font-medium">Diferencia</th><th className="px-4 py-2.5 font-medium">Estado</th></tr></thead>
                        <tbody>{t.filas.map((f) => (
                            <tr key={f.concepto} className="border-b border-line last:border-0">
                                <td className="px-4 py-3 text-[14px] font-medium">{f.etiqueta}{f.unidad === 'USD' && <span className="ml-1 text-[12px] font-normal text-muted">(US$)</span>}</td>
                                <td className="num px-3 py-3 text-right text-[14px]">{n2(f.sistema)}</td>
                                <td className="num px-3 py-3 text-right text-[14px]">{f.declarado === null ? '—' : n2(f.declarado)}</td>
                                <td className={`num px-3 py-3 text-right text-[14px] ${f.diferencia ? 'font-semibold' : ''} ${f.semaforo === 'NO_CUADRA' ? 'text-danger' : ''}`}>{f.diferencia === null ? '—' : monto(f.diferencia)}</td>
                                <td className="px-4 py-3"><Semaforo k={f.semaforo} /></td></tr>))}</tbody></table></div>
                </Card>
            ))}

            {historial.length > 0 && (
                <Card><div className="border-b border-line p-4"><h3 className="text-[16px] font-semibold">Declaraciones anotadas</h3></div>
                    <ul>{historial.map((h) => <li key={h.id} className="border-b border-line last:border-0"><button onClick={() => ir({ mes: h.desde.slice(0, 7), periodicidad: h.periodicidad, quincena: Number(h.desde.slice(8, 10)) > 15 ? 2 : 1 })} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-paper"><span className="text-[14px] font-medium">{TIPO_CORTO[h.tipo]}</span><span className="text-[13px] text-muted">{dmy(h.desde)} al {dmy(h.hasta)}{h.numero_planilla ? ` · N.º ${h.numero_planilla}` : ''}</span></button></li>)}</ul></Card>
            )}
            <p className="flex items-start gap-2 text-[13px] text-muted"><Scale className="mt-0.5 size-4 shrink-0" />Es un control interno: el sistema no consulta el portal del SENIAT, compara con lo que tú anotas. Confirma el criterio con tu contador antes de presentar una sustitutiva.</p>

            {modal?.t === 'declarar' && <ModalDeclaracion t={modal.tipo} periodo={periodo} cerrar={() => setModal(null)} guardado={(f) => { setFiscal(f); setModal(null); }} />}
            {modal?.t === 'borrar' && <Modal titulo="Quitar declaración anotada" subtitulo={`${modal.tipo.titulo} · ${dmy(periodo.desde)} al ${dmy(periodo.hasta)}`} cerrar={() => setModal(null)} ok="Quitar" peligro onSubmit={() => quitar(modal.tipo)}><p className="text-[14px] text-muted">Solo borra lo que anotaste aquí; tu declaración en el portal no cambia.</p></Modal>}
            {modal?.t === 'reporte' && <ModalReporte fiscal={fiscal} cerrar={() => setModal(null)} />}
        </div>
    );
}
