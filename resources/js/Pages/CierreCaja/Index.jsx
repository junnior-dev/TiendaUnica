import { Head, router } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import { AlertTriangle, Banknote, CalendarDays, Check, ChevronDown, FileDown, Lock, Receipt, ShieldCheck, Stamp, Users } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi, Modal, Vacio } from '../../Components/kit';
import { Button } from '../../Components/ui';
import { COLOR, NOMBRE, SIMBOLO, monto, n0, n2, tasa, usd, bs } from '../../lib/format';

const parse = (s) => { const t = String(s ?? '').trim(); return t === '' ? null : Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); };
const dec = (m, v) => (m === 'COP' ? n0(v) : n2(v));
const redondea = (v) => Math.round(v * 100) / 100;
const corto = (iso) => new Intl.DateTimeFormat('es-VE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`)).replace('.', '');
const largo = (iso) => new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const mesLargo = (ym) => { const t = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T12:00:00Z`)); return t.charAt(0).toUpperCase() + t.slice(1); };
const etiquetaPeriodo = (periodo, desde, hasta) => periodo === 'dia' ? largo(desde) : periodo === 'mes' ? mesLargo(desde.slice(0, 7)) : periodo === 'anio' ? `Año ${desde.slice(0, 4)}` : `Del ${largo(desde)} al ${largo(hasta)}`;
const hora = (iso) => new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Caracas' }).format(new Date(iso));

export default function CierreCaja(p) {
    const { turno, negocio, usuario, fecha_larga, stock_bajo, tasa_usd, hoy, periodo, desde, hasta, cortes, cajero, es_admin, puede_registrar, informe, cierre, cajeros, dias, emisor, generado_por } = p;
    const fecha = desde, esDia = periodo === 'dia';
    const anios = Array.from({ length: 6 }, (_, i) => Number(hoy.slice(0, 4)) - i);
    const etiqueta = etiquetaPeriodo(periodo, desde, hasta);
    const r = informe.resumen;
    const [conteo, setConteo] = useState(() => (cierre ? Object.fromEntries(Object.entries(cierre.conteo).map(([k, v]) => [k, String(v)])) : {}));
    const [obs, setObs] = useState('');
    const [confirmar, setConfirmar] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [errores, setErrores] = useState({});
    const [verOps, setVerOps] = useState(false);
    const [pdf, setPdf] = useState(false);

    const ir = (cambio) => router.get('/cierre-caja', { periodo, cajero: cajero || undefined, ...(periodo === 'dia' ? { fecha } : periodo === 'mes' ? { mes: desde.slice(0, 7) } : periodo === 'anio' ? { anio: desde.slice(0, 4) } : { desde, hasta }), ...cambio }, { preserveScroll: true, preserveState: false });
    const cambiarPeriodo = (k) => ir({ periodo: k, fecha: undefined, mes: undefined, anio: undefined, desde: undefined, hasta: undefined, ...(k === 'dia' ? { fecha: hasta } : k === 'mes' ? { mes: hasta.slice(0, 7) } : k === 'anio' ? { anio: hasta.slice(0, 4) } : { desde, hasta }) });
    const efectivo = informe.monedas.filter((m) => m.tiene_efectivo);
    const cerrado = !!cierre;
    const cuenta = esDia;

    const filas = useMemo(() => efectivo.map((m) => {
        const c = parse(conteo[m.moneda]);
        return { ...m, contado: c, dif: c == null || isNaN(c) ? null : m.moneda === 'COP' ? Math.round(c - m.efectivo_esperado) : redondea(c - m.efectivo_esperado) };
    }), [efectivo, conteo]);
    const completo = cuenta && filas.every((f) => f.contado != null && !isNaN(f.contado) && f.contado >= 0);
    const hayDif = filas.some((f) => f.dif);
    const nombreCajero = cajero ? cajeros.find((c) => c.id === cajero)?.nombre ?? usuario.nombre : (es_admin ? null : usuario.nombre);

    const descargar = async () => {
        setPdf(true);
        try {
            const { construirPdfCierre } = await import('../../lib/pdfCierre');
            const conteoNum = Object.fromEntries(filas.filter((f) => f.contado != null && !isNaN(f.contado)).map((f) => [f.moneda, f.contado]));
            const doc = await construirPdfCierre({ fecha, informe, emisor, cajeroNombre: nombreCajero, conteo: conteoNum, cierre, generadoPor: generado_por, periodo: { tipo: periodo, desde, hasta, etiqueta }, cortes });
            doc.save(`${esDia ? (cierre ? 'corte-z' : 'cierre-caja') : 'informe-caja'}-${desde}${esDia ? '' : `_${hasta}`}${cajero ? `-caja-${cajero}` : ''}.pdf`);
        } finally { setPdf(false); }
    };

    const firmar = () => {
        setEnviando(true);
        router.post('/cierre-caja', { fecha: desde, cajero: cajero || null, conteo: Object.fromEntries(filas.map((f) => [f.moneda, f.contado])), observaciones: obs.trim() || null },
            { preserveScroll: true, onError: (e) => { setErrores(e); setConfirmar(false); }, onSuccess: () => { setConfirmar(false); setErrores({}); }, onFinish: () => setEnviando(false) });
    };

    return (
        <AppLayout actual="/cierre-caja" titulo="Cierre de caja" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Cierre de caja" />
            {turno && (
                <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-[14px]" role="status">
                    <span className="size-2 shrink-0 rounded-full bg-ok" aria-hidden />
                    <span className="min-w-0 flex-1">Tienes una caja abierta ({turno.ventas} {turno.ventas === 1 ? 'venta' : 'ventas'} en el turno). El cierre con conteo de efectivo y ticket se hace desde el punto de venta, con <b>Cerrar caja (Z)</b>.</span>
                    <a href="/caja" className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-[13.5px] font-semibold hover:bg-paper">Ir al punto de venta</a>
                </div>
            )}

            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h2 className="text-[26px] font-semibold tracking-[-0.02em]">Cierre de caja</h2>
                    <p className="mt-1 max-w-[62ch] text-[15px] text-muted">Lo cobrado en cada moneda, el efectivo que debe haber en caja y el corte Z del día. Mira un día, un mes, un año o el rango que quieras.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <div role="radiogroup" aria-label="Período" className="inline-flex rounded-lg bg-[#e9ecf0] p-1 text-[13px]">
                        {[['dia', 'Día'], ['mes', 'Mes'], ['anio', 'Año'], ['rango', 'Rango']].map(([k, l]) => <button key={k} role="radio" aria-checked={periodo === k} onClick={() => periodo !== k && cambiarPeriodo(k)} className={`rounded-md px-3.5 py-2 font-medium ${periodo === k ? 'bg-white shadow-sm' : 'text-muted hover:text-text'}`}>{l}</button>)}
                    </div>
                    {periodo === 'dia' && <label className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><input type="date" aria-label="Día" value={desde} max={hoy} onChange={(e) => e.target.value && ir({ fecha: e.target.value })} className="h-11 rounded-lg border border-line bg-white pl-9 pr-3 text-[15px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" /></label>}
                    {periodo === 'mes' && <label className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><input type="month" aria-label="Mes" value={desde.slice(0, 7)} max={hoy.slice(0, 7)} onChange={(e) => e.target.value && ir({ mes: e.target.value })} className="h-11 rounded-lg border border-line bg-white pl-9 pr-3 text-[15px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" /></label>}
                    {periodo === 'anio' && <select aria-label="Año" value={desde.slice(0, 4)} onChange={(e) => ir({ anio: e.target.value })} className="h-11 rounded-lg border border-line bg-white px-3 text-[15px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">{anios.map((y) => <option key={y} value={y}>{y}</option>)}</select>}
                    {periodo === 'rango' && <><label className="relative"><span className="sr-only">Desde</span><CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><input type="date" aria-label="Desde" value={desde} max={hasta} onChange={(e) => e.target.value && ir({ desde: e.target.value })} className="h-11 rounded-lg border border-line bg-white pl-9 pr-3 text-[15px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" /></label>
                        <span className="text-[13px] text-muted">a</span>
                        <label className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><input type="date" aria-label="Hasta" value={hasta} min={desde} max={hoy} onChange={(e) => e.target.value && ir({ hasta: e.target.value })} className="h-11 rounded-lg border border-line bg-white pl-9 pr-3 text-[15px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" /></label></>}
                    {es_admin && (
                        <select aria-label="Caja" value={cajero} onChange={(e) => ir({ cajero: Number(e.target.value) || undefined })} className="h-11 rounded-lg border border-line bg-white px-3 text-[15px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
                            <option value={0}>Todas las cajas</option>
                            {cajeros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                    )}
                    <button onClick={descargar} disabled={pdf || r.ventas + r.anuladas === 0} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper disabled:opacity-50"><FileDown className="size-4" />{pdf ? 'Preparando…' : 'Descargar PDF'}</button>
                </div>
            </div>

            <p className="mb-4 text-[13px] font-medium text-muted">{etiqueta}{cajero ? ` · ${nombreCajero}` : ''}</p>

            {esDia && dias.length > 0 && (
                <div className="mb-6 flex gap-2 overflow-x-auto pb-1" role="list" aria-label="Días con ventas">
                    {dias.map((d) => (
                        <button key={d.fecha} role="listitem" onClick={() => ir({ fecha: d.fecha })} className={`shrink-0 rounded-xl border px-3.5 py-2 text-left ${d.fecha === desde ? 'border-brand bg-brand-50' : 'border-line bg-white hover:border-[#b9c1ca]'}`}>
                            <p className="text-[13px] font-medium capitalize">{d.fecha === hoy ? 'Hoy' : corto(d.fecha)}</p>
                            <p className="num text-[13px] text-muted">{usd(d.total_usd)} · {d.ventas}</p>
                        </button>
                    ))}
                </div>
            )}

            {cerrado ? (
                <div className="mb-6 flex items-start gap-3 rounded-2xl border border-line bg-white p-4"><Lock className="mt-0.5 size-5 shrink-0 text-ok" />
                    <div><p className="text-[15px] font-semibold">Corte Z N.º {String(cierre.id).padStart(6, '0')} hecho</p><p className="text-[13px] text-muted">{hora(cierre.cerrado_en)} por {cierre.por}. Queda fijo y ya no se puede modificar.{cierre.observaciones ? ` Nota: ${cierre.observaciones}` : ''}</p></div></div>
            ) : !puede_registrar && esDia && (
                <div className="mb-6 flex items-start gap-3 rounded-2xl border border-line bg-white p-4"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#8a5a00]" />
                    <div><p className="text-[15px] font-semibold">Modo consulta</p><p className="text-[13px] text-muted">Puedes ver el informe y descargar el PDF. Para hacer el corte Z crea la tabla opcional con <span className="num">database/sql/07_cierres_caja.sql</span>.</p></div></div>
            )}

            {errores.fecha && <p role="alert" className="mb-4 rounded-lg bg-[#fdecec] px-4 py-3 text-[13px] text-danger">{errores.fecha}</p>}

            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Kpi icon={Receipt} titulo="Ventas" valor={n0(r.ventas)} detalle={r.anuladas ? `${r.anuladas} anulada${r.anuladas === 1 ? '' : 's'}` : 'Sin anulaciones'} />
                <Kpi icon={Banknote} titulo="Total cobrado" valor={usd(r.total_usd)} detalle={`Incluye IGTF ${usd(r.igtf_usd)}`} />
                <Kpi icon={Banknote} titulo="Equivalente en bolívares" valor={bs(r.total_ves)} detalle={r.tasa_min == null ? 'Sin tasa' : `Tasa ${r.tasa_min === r.tasa_max ? tasa(r.tasa_min) : `${tasa(r.tasa_min)} – ${tasa(r.tasa_max)}`}`} />
                <Kpi icon={ShieldCheck} tono={r.cuadra ? undefined : 'bad'} titulo="Cuadre con ventas" valor={r.cuadra ? 'Cuadra' : 'No cuadra'} detalle={r.cuadra ? 'Los pagos suman el total vendido' : 'Revisa los pagos del día'} />
            </div>

            {r.ventas + r.anuladas === 0 ? (
                <Card><Vacio icon={Receipt} titulo="No hay ventas en este período" texto="Elige otro día, mes o año en los filtros de arriba." /></Card>
            ) : (
                <>
                    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {informe.monedas.map((m) => (
                            <Card key={m.moneda} className="p-4">
                                <div className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: COLOR[m.moneda] }} /><p className="text-[13px] font-medium">{NOMBRE[m.moneda]} · {m.moneda}</p></div>
                                <p className="num mt-2 text-[22px] font-semibold tracking-[-0.02em]">{monto(m.moneda, m.cobrado)}</p>
                                <dl className="num mt-3 space-y-1 border-t border-line pt-3 text-[13px]">
                                    <div className="flex justify-between"><dt className="text-muted">Equiv. USD</dt><dd>{usd(m.usd)}</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted">Equiv. Bs</dt><dd>{bs(m.ves)}</dd></div>
                                </dl>
                            </Card>
                        ))}
                    </div>

                    <Card className="mb-6">
                        <div className="border-b border-line p-4 sm:p-5"><h3 className="text-[15px] font-semibold">Cobros por método</h3><p className="mt-0.5 text-[13px] text-muted">Cada pago con la tasa que tenía al venderse. El IGTF va incluido en lo cobrado.</p></div>
                        <div className="relative overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
                            <thead><tr className="border-b border-line text-left text-[13px] text-muted"><th className="px-5 py-3 font-medium">Método</th><th className="px-3 py-3 font-medium">Moneda</th><th className="px-3 py-3 text-right font-medium">Pagos</th><th className="px-3 py-3 text-right font-medium">Cobrado</th><th className="px-3 py-3 text-right font-medium">Tasa Bs</th><th className="px-3 py-3 text-right font-medium">Equiv. USD</th><th className="px-5 py-3 text-right font-medium">Equiv. Bs</th></tr></thead>
                            <tbody>{informe.metodos.map((m, i) => (
                                <tr key={`${m.metodo}-${m.moneda}-${m.es_anticipo ? 'a' : 'n'}-${i}`} className="border-b border-line last:border-0">
                                    <td className="px-5 py-3 font-medium">{m.metodo}{m.es_anticipo && <span className="ml-2 rounded-full bg-signal/15 px-2 py-0.5 text-xs font-medium text-[#8a5a00]" title="Anticipo de encargo ya cobrado antes: no vuelve a entrar en la gaveta">Anticipo aplicado</span>}</td>
                                    <td className="px-3 py-3"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: COLOR[m.moneda] }} />{m.moneda}</span></td>
                                    <td className="num px-3 py-3 text-right">{m.n}</td>
                                    <td className="num px-3 py-3 text-right">{dec(m.moneda, m.cobrado)}</td>
                                    <td className="num px-3 py-3 text-right text-muted">{m.moneda === 'USD' ? '—' : m.tasa_min === m.tasa_max ? tasa(m.tasa_min) : `${tasa(m.tasa_min)} – ${tasa(m.tasa_max)}`}</td>
                                    <td className="num px-3 py-3 text-right">{n2(m.usd)}</td>
                                    <td className="num px-5 py-3 text-right">{n2(m.ves)}</td>
                                </tr>))}
                            </tbody>
                            <tfoot><tr className="border-t border-ink font-semibold"><td className="px-5 py-3" colSpan={5}>{esDia ? 'Total del día' : 'Total del período'}</td><td className="num px-3 py-3 text-right">{n2(r.total_usd)}</td><td className="num px-5 py-3 text-right">{n2(r.total_ves)}</td></tr></tfoot>
                        </table></div>
                    </Card>

                    {informe.desglose_x && (informe.desglose_x.por_hora?.length > 0 || informe.desglose_x.top_productos?.length > 0) && (() => {
                        const dx = informe.desglose_x;
                        const maxHora = Math.max(...(dx.por_hora || []).map((h) => h.total_usd), 1);
                        const franja = (h) => (h < 6 ? 'Madrugada' : h < 12 ? 'Mañana' : h < 14 ? 'Mediodía' : h < 19 ? 'Tarde' : 'Noche');
                        return (
                            <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
                                {dx.por_hora?.length > 0 && (
                                    <Card><div className="border-b border-line p-4 sm:p-5"><h3 className="text-[15px] font-semibold">Ventas por hora</h3><p className="mt-0.5 text-[13px] text-muted">Cuándo entra el dinero{esDia ? ' hoy' : ''}: ¿la mañana o la tarde?</p></div>
                                        <ul className="px-5 py-3">
                                            {dx.por_hora.map((h) => (
                                                <li key={h.hora} className="flex items-center gap-3 py-1.5 text-[13px]">
                                                    <span className="num w-[72px] shrink-0 text-muted">{String(h.hora).padStart(2, '0')}:00 · {franja(Number(h.hora))}</span>
                                                    <span className="h-2 flex-1 rounded-full bg-paper"><span className="block h-full rounded-full bg-ink" style={{ width: `${Math.max(3, (h.total_usd / maxHora) * 100)}%` }} /></span>
                                                    <span className="num w-[64px] shrink-0 text-right font-medium">{usd(h.total_usd)}</span>
                                                    <span className="num w-[36px] shrink-0 text-right text-muted">{n0(h.ventas)}</span>
                                                </li>
                                            ))}
                                        </ul></Card>
                                )}
                                {dx.top_productos?.length > 0 && (
                                    <Card><div className="border-b border-line p-4 sm:p-5"><h3 className="text-[15px] font-semibold">Top de piezas vendidas</h3><p className="mt-0.5 text-[13px] text-muted">Por unidades, con la utilidad real de cada una.</p></div>
                                        <ul>{dx.top_productos.slice(0, 8).map((p, i) => (
                                            <li key={`${p.sku}-${i}`} className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5 text-sm last:border-0">
                                                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{i + 1}. {p.nombre}</span><span className="num block text-[12px] text-muted">{p.sku}</span></span>
                                                <span className="num shrink-0 text-muted">{n0(p.unidades)} u</span>
                                                <span className="num shrink-0 font-semibold">{usd(p.ingreso_usd)}</span>
                                            </li>))}</ul></Card>
                                )}
                                <Card><div className="border-b border-line p-4 sm:p-5"><h3 className="text-[15px] font-semibold">Crédito y anticipos</h3><p className="mt-0.5 text-[13px] text-muted">Lo que sale fiado y lo que entra por piezas encargadas.</p></div>
                                    <ul className="px-5 py-3 text-[13.5px]">
                                        <li className="flex justify-between py-1.5"><span>Cuentas por cobrar creadas</span><span className="num font-medium">{n0(dx.credito?.cuentas || 0)} · {usd(dx.credito?.cuentas_usd || 0)}</span></li>
                                        <li className="flex justify-between py-1.5"><span>Cobros de CxC recibidos</span><span className="num font-medium">{n0(dx.credito?.cobros || 0)} · {usd(dx.credito?.cobros_usd || 0)}</span></li>
                                        <li className="flex justify-between py-1.5"><span>Cuentas vencidas a la fecha</span><span className={`num font-medium ${(dx.credito?.vencidas_hoy || 0) > 0 ? 'text-danger' : ''}`}>{n0(dx.credito?.vencidas_hoy || 0)}</span></li>
                                        <li className="flex justify-between py-1.5"><span>Anticipos de encargos cobrados</span><span className="num font-medium">{n0(dx.anticipos?.cobrados || 0)} · {usd(dx.anticipos?.cobrados_usd || 0)}</span></li>
                                        <li className="flex justify-between py-1.5"><span>Anticipos aplicados en entregas</span><span className="num font-medium">{n0(dx.anticipos?.aplicados || 0)} · {usd(dx.anticipos?.aplicados_usd || 0)}</span></li>
                                        <li className="flex justify-between py-1.5 border-t border-line mt-1.5 pt-2"><span className="font-semibold">Ticket promedio</span><span className="num font-semibold">{dx.ticket_promedio_usd ? usd(dx.ticket_promedio_usd) : '—'}</span></li>
                                    </ul></Card>
                            </div>
                        );
                    })()}

                    {efectivo.length > 0 && (
                        <Card className="mb-6">
                            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4 sm:p-5">
                                <div><h3 className="text-[15px] font-semibold">{esDia ? 'Arqueo de efectivo' : 'Efectivo del período'}</h3><p className="mt-0.5 max-w-[64ch] text-[13px] text-muted">{esDia ? 'Cuenta los billetes de cada moneda y escribe el total. «Debe haber» es lo recibido en efectivo menos el vuelto entregado.' : 'Efectivo recibido menos vuelto entregado, por moneda. El conteo se hace en el corte de cada día.'}</p></div>
                                {esDia && !cerrado && puede_registrar && <Button onClick={() => setConfirmar(true)} disabled={!completo || r.ventas === 0}><Stamp className="size-4" />Hacer corte Z</Button>}
                            </div>
                            <div className="relative overflow-x-auto"><table className="w-full min-w-[680px] text-sm">
                                <thead><tr className="border-b border-line text-left text-[13px] text-muted"><th className="px-5 py-3 font-medium">Moneda</th><th className="px-3 py-3 text-right font-medium">Recibido</th><th className="px-3 py-3 text-right font-medium">Vuelto</th><th className="px-3 py-3 text-right font-medium">Debe haber</th>{cuenta && <><th className="px-3 py-3 text-right font-medium">Contado</th><th className="px-5 py-3 text-right font-medium">Diferencia</th></>}</tr></thead>
                                <tbody>{filas.map((f) => (
                                    <tr key={f.moneda} className="border-b border-line last:border-0">
                                        <td className="px-5 py-3 font-medium"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: COLOR[f.moneda] }} />{f.moneda}</span></td>
                                        <td className="num px-3 py-3 text-right">{dec(f.moneda, f.efectivo_recibido)}</td>
                                        <td className="num px-3 py-3 text-right text-muted">{f.vuelto ? `-${dec(f.moneda, f.vuelto)}` : '—'}</td>
                                        <td className="num px-3 py-3 text-right font-semibold">{dec(f.moneda, f.efectivo_esperado)}</td>
                                        {cuenta && <>
                                        <td className="px-3 py-2 text-right">
                                            <div className="relative ml-auto w-36"><span className="num pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">{SIMBOLO[f.moneda]}</span>
                                                <input inputMode="decimal" aria-label={`Efectivo contado en ${f.moneda}`} readOnly={cerrado} value={conteo[f.moneda] ?? ''} onChange={(e) => setConteo({ ...conteo, [f.moneda]: e.target.value })} placeholder="0,00"
                                                    className="num h-10 w-full rounded-lg border border-line bg-white pl-10 pr-3 text-right text-[15px] read-only:bg-paper focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" /></div>
                                        </td>
                                        <td className="num px-5 py-3 text-right font-semibold">
                                            {f.dif == null ? <span className="font-normal text-muted">—</span> : f.dif === 0 ? <span className="inline-flex items-center gap-1 text-ok"><Check className="size-4" />Cuadra</span> : <span className={f.dif > 0 ? 'text-[#8a5a00]' : 'text-danger'}>{f.dif > 0 ? 'Sobra ' : 'Falta '}{dec(f.moneda, Math.abs(f.dif))}</span>}
                                        </td>
                                        </>}
                                    </tr>))}
                                </tbody>
                            </table></div>
                            {cuenta && hayDif && !cerrado && <p className="flex items-center gap-2 border-t border-line px-5 py-3 text-[13px] text-[#8a5a00]"><AlertTriangle className="size-4 shrink-0" />Hay diferencias. Vuelve a contar antes de cerrar; si se mantienen, anótalas en las observaciones.</p>}
                            {cuenta && !cerrado && puede_registrar && <div className="border-t border-line p-4 sm:p-5"><label className="text-[13px] font-medium" htmlFor="obs">Observaciones <span className="font-normal text-muted">(opcional)</span></label>
                                <textarea id="obs" rows={2} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: faltan 5 Bs por un vuelto en monedas" className="mt-1.5 w-full resize-none rounded-lg border border-line bg-white px-3.5 py-2.5 text-[15px] placeholder:text-[#8d97a2] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" /></div>}
                        </Card>
                    )}

                    {!esDia && informe.desglose.filas.length > 0 && (() => {
                        const max = Math.max(...informe.desglose.filas.map((d) => d.total_usd), 1);
                        return (
                            <Card className="mb-6">
                                <div className="border-b border-line p-4 sm:p-5"><h3 className="text-[15px] font-semibold">Ventas por {informe.desglose.por === 'mes' ? 'mes' : 'día'}</h3><p className="mt-0.5 text-[13px] text-muted">Total cobrado en cada {informe.desglose.por === 'mes' ? 'mes' : 'día'} del período.</p></div>
                                <div className="relative overflow-x-auto"><table className="w-full min-w-[620px] text-sm">
                                    <thead><tr className="border-b border-line text-left text-[13px] text-muted"><th className="px-5 py-3 font-medium">{informe.desglose.por === 'mes' ? 'Mes' : 'Día'}</th><th className="px-3 py-3 text-right font-medium">Ventas</th><th className="w-[34%] px-3 py-3 font-medium"><span className="sr-only">Proporción</span></th><th className="px-3 py-3 text-right font-medium">USD</th><th className="px-5 py-3 text-right font-medium">Bs</th></tr></thead>
                                    <tbody>{informe.desglose.filas.map((d) => (
                                        <tr key={d.clave} className="border-b border-line last:border-0">
                                            <td className="px-5 py-2.5 font-medium capitalize">{informe.desglose.por === 'mes' ? mesLargo(d.clave) : corto(d.clave)}</td>
                                            <td className="num px-3 py-2.5 text-right">{d.ventas}</td>
                                            <td className="px-3 py-2.5"><div className="h-1.5 rounded-full bg-paper"><div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(2, (d.total_usd / max) * 100)}%` }} /></div></td>
                                            <td className="num px-3 py-2.5 text-right font-semibold">{n2(d.total_usd)}</td>
                                            <td className="num px-5 py-2.5 text-right text-muted">{n2(d.total_ves)}</td>
                                        </tr>))}
                                    </tbody>
                                </table></div>
                            </Card>
                        );
                    })()}

                    {!esDia && puede_registrar && (
                        <Card className="mb-6">
                            <div className="flex items-center gap-2 border-b border-line p-4 sm:p-5"><Stamp className="size-4 text-muted" /><h3 className="text-[15px] font-semibold">Cortes Z del período</h3></div>
                            {cortes.length === 0 ? <p className="px-5 py-4 text-[13px] text-muted">Todavía no hay cortes Z hechos en este período. Se hacen desde la vista «Día».</p> : (
                                <ul>{cortes.map((c) => (
                                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-3 text-sm last:border-0">
                                        <button onClick={() => router.get('/cierre-caja', { periodo: 'dia', fecha: c.fecha, cajero: cajero || undefined })} className="num text-left font-medium text-brand hover:underline">Z-{String(c.id).padStart(6, '0')} · {corto(c.fecha)}</button>
                                        <span className="text-[13px] text-muted">{c.caja} · {c.por}</span>
                                        <span className="num flex items-center gap-3"><span className="font-semibold">{usd(c.total_usd)}</span>{c.con_diferencia ? <span className="rounded-full bg-signal/15 px-2.5 py-0.5 text-xs font-medium text-[#8a5a00]">Con diferencia</span> : <span className="inline-flex items-center gap-1 text-xs font-medium text-ok"><Check className="size-3.5" />Cuadró</span>}</span>
                                    </li>))}
                                </ul>)}
                        </Card>
                    )}

                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                        {informe.cajeros.length > 0 && (
                            <Card><div className="flex items-center gap-2 border-b border-line p-4 sm:p-5"><Users className="size-4 text-muted" /><h3 className="text-[15px] font-semibold">Ventas por cajero</h3></div>
                                <ul>{informe.cajeros.map((c) => <li key={c.id} className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 last:border-0 text-sm"><span className="font-medium">{c.nombre}</span><span className="num text-muted">{c.ventas} venta{c.ventas === 1 ? '' : 's'} · <span className="font-semibold text-text">{usd(c.total_usd)}</span></span></li>)}</ul></Card>
                        )}
                        {informe.anuladas.length > 0 && (
                            <Card><div className="flex items-center gap-2 border-b border-line p-4 sm:p-5"><AlertTriangle className="size-4 text-muted" /><h3 className="text-[15px] font-semibold">Ventas anuladas</h3><span className="text-[13px] text-muted">No suman en los totales</span></div>
                                <ul>{informe.anuladas.map((a) => <li key={a.numero} className="flex items-start justify-between gap-3 border-b border-line px-5 py-3 last:border-0 text-sm"><div className="min-w-0"><p className="num font-medium">N.º {String(a.numero).padStart(6, '0')} · {a.hora}</p><p className="text-[13px] text-muted">{a.cajero}{a.motivo ? ` · ${a.motivo}` : ''}</p></div><span className="num shrink-0">{usd(a.total_usd)}</span></li>)}</ul></Card>
                        )}
                    </div>

                    {informe.operaciones.length > 0 && (
                        <Card className="mt-6">
                            <button onClick={() => setVerOps(!verOps)} aria-expanded={verOps} className="flex w-full items-center justify-between gap-3 p-4 text-left sm:p-5"><div><h3 className="text-[15px] font-semibold">Detalle de operaciones</h3><p className="text-[13px] text-muted">{informe.operaciones.length} ventas con sus pagos</p></div><ChevronDown className={`size-5 text-muted transition-transform ${verOps ? 'rotate-180' : ''}`} /></button>
                            {verOps && <div className="relative overflow-x-auto border-t border-line"><table className="w-full min-w-[680px] text-sm"><tbody>{informe.operaciones.map((o) => (
                                <tr key={o.numero} className="border-b border-line last:border-0"><td className="num px-5 py-3 font-medium">{String(o.numero).padStart(6, '0')}</td><td className="num px-3 py-3 text-muted">{o.hora}</td><td className="px-3 py-3">{o.cajero}</td>
                                    <td className="px-3 py-3 text-[13px] text-muted">{o.pagos.map((x) => `${x.metodo} ${dec(x.moneda, x.monto)}`).join(' + ')}</td><td className="num px-5 py-3 text-right font-semibold">{usd(o.total_usd)}</td></tr>))}</tbody></table></div>}
                        </Card>
                    )}
                </>
            )}

            {confirmar && (
                <Modal titulo="Hacer el corte Z" subtitulo={`${etiqueta} · ${nombreCajero ?? 'Todas las cajas'}. Después del corte no se puede cambiar.`} cerrar={() => setConfirmar(false)} onSubmit={firmar} enviando={enviando} ok="Hacer corte Z">
                    <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                        {filas.map((f) => <li key={f.moneda} className="flex items-center justify-between gap-3 px-3.5 py-2.5"><span className="font-medium">{f.moneda}</span><span className="num text-muted">contado {dec(f.moneda, f.contado)} · {f.dif === 0 ? <span className="text-ok">cuadra</span> : <span className={f.dif > 0 ? 'text-[#8a5a00]' : 'text-danger'}>{f.dif > 0 ? 'sobra' : 'falta'} {dec(f.moneda, Math.abs(f.dif))}</span>}</span></li>)}
                    </ul>
                    <p className="text-[13px] text-muted">Total del día: <span className="num font-semibold text-text">{usd(r.total_usd)}</span> en {r.ventas} venta{r.ventas === 1 ? '' : 's'}.</p>
                    {errores.conteo && <p role="alert" className="text-[13px] text-danger">{errores.conteo}</p>}
                </Modal>
            )}
        </AppLayout>
    );
}
