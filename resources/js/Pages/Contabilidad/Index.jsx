import { Head, router } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Boxes, ChevronLeft, ChevronRight, CircleAlert, FileDown, FileSpreadsheet, Layers, ListTree, Pencil, Plus, Scale, Trash2, TrendingUp, Wallet, Receipt } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi, Modal, Switch, Toast, Vacio } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { http } from '../../lib/http';
import { AvisoCierreInstalar, ModalAjuste, ModalApertura, ModalEjercicio, ModalExportar, ModalPeriodos, PanelCierres } from './Cierres';
import { n2 } from '../../lib/format';

/* ───────── utilidades ───────── */
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const num = (s) => { const t = String(s ?? '').trim(); if (!t) return 0; const v = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(v) ? v : NaN; };
const bs = (v) => `Bs ${n2(v)}`;
const cel = (v) => (v ? n2(v) : '');                                     // en los libros, el cero se deja en blanco
const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const mesLargo = (ym) => { const t = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T12:00:00Z`)); return t.charAt(0).toUpperCase() + t.slice(1); };
const sumaMes = (ym, d) => { const [y, m] = ym.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + d, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
const TIPO = { ACTIVO: 'Activo', PASIVO: 'Pasivo', PATRIMONIO: 'Patrimonio', INGRESO: 'Ingreso', GASTO: 'Gasto' };
const ORIGEN = { VENTA: 'Venta', ANULACION_VENTA: 'Anulación de venta', COMPRA: 'Compra', ANULACION_COMPRA: 'Anulación de compra', NOTA_CREDITO: 'Nota de crédito', NOTA_DEBITO: 'Nota de débito', DEVOLUCION_COSTO: 'Costo de devolución', PAGO_PROVEEDOR: 'Pago a proveedor', ANULACION_PAGO: 'Pago anulado', CIERRE: 'Cierre de ejercicio', AJUSTE_CAMBIARIO: 'Ajuste cambiario', APERTURA: 'Apertura', MANUAL: 'Manual' };
const TABS = [['resumen', 'Resumen', TrendingUp], ['diario', 'Libro diario', BookOpen], ['mayor', 'Libro mayor', Layers], ['inventario', 'Libro de inventario', Boxes], ['cuentas', 'Cuentas', ListTree]];
const A = { a: 'right' };

export default function Contabilidad(p) {
    const { negocio, usuario, stock_bajo, tasa_usd, fecha_larga, instalado, vista, mes, hoy, emisor } = p;
    const [toast, setToast] = useState('');
    const [modal, setModal] = useState(null);                    // 'asiento' | 'cuenta' | 'activar' | {editar: cuenta}
    const avisar = (t) => { setToast(''); setTimeout(() => setToast(t), 30); };
    const ir = (c = {}) => router.get('/contabilidad', { vista, mes, ...c }, { preserveScroll: true, preserveState: false });
    const recargar = (msg) => { if (msg) avisar(msg); router.reload({ preserveScroll: true }); };
    const periodo = mesLargo(mes);

    const exportable = instalado && ['diario', 'mayor', 'inventario'].includes(vista) && !(vista === 'mayor' && p.mayor?.detalle);
    const exportar = async () => {
        try {
            const lib = await import('../../lib/pdfLibro');
            let cfg;
            if (vista === 'diario') {
                const filas = [];
                p.diario.filas.forEach((a) => a.lineas.forEach((l, i) => filas.push([i === 0 ? dmy(a.fecha) : '', i === 0 ? String(a.numero) : '', i === 0 ? a.concepto : '', l.codigo, l.cuenta, cel(l.debe), cel(l.haber)])));
                cfg = { file: `libro-diario-${mes}`, columnas: [{ h: 'Fecha' }, { h: 'N.º' }, { h: 'Concepto' }, { h: 'Código' }, { h: 'Cuenta' }, { h: 'Debe' }, { h: 'Haber' }], filas, totales: ['', '', 'Totales', '', '', n2(p.diario.total), n2(p.diario.total)] };
            } else if (vista === 'mayor') {
                cfg = { file: `libro-mayor-${mes}`, columnas: [{ h: 'Código' }, { h: 'Cuenta' }, { h: 'Saldo inicial' }, { h: 'Débitos' }, { h: 'Créditos' }, { h: 'Saldo final' }],
                    filas: p.mayor.filas.map((c) => [c.codigo, c.cuenta, n2(c.inicial), n2(c.debitos), n2(c.creditos), n2(c.final)]), totales: ['', 'Totales del período', '', n2(p.mayor.totales.debitos), n2(p.mayor.totales.creditos), ''] };
            } else {
                const f = p.inventario.filas;
                cfg = { file: `libro-inventario-${p.inventario.corte}`, columnas: [{ h: 'Categoría' }, { h: 'Productos' }, { h: 'Unidades' }, { h: 'Costo promedio ($)' }, { h: 'Valor ($)' }, { h: 'Valor (Bs)' }],
                    filas: f.filter((x) => !x.total).map((x) => [x.categoria, x.productos, n2(x.unidades), x.costo == null ? '' : n2(x.costo), n2(x.valor_usd), x.valor_ves == null ? '' : n2(x.valor_ves)]),
                    totales: f.filter((x) => x.total).map((x) => ['Gran total', x.productos, n2(x.unidades), x.costo == null ? '' : n2(x.costo), n2(x.valor_usd), x.valor_ves == null ? '' : n2(x.valor_ves)])[0] };
            }
            lib.csv(`${cfg.file}.csv`, cfg.columnas, cfg.filas, cfg.totales);
        } catch (e) { avisar(e.message || 'No se pudo preparar el archivo.'); }
    };

    return (
        <AppLayout actual="/contabilidad" titulo="Contabilidad" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Contabilidad" />
            <Toast texto={toast} />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Contabilidad</h2><p className="mt-1 max-w-[62ch] text-[15px] text-muted">Tus ventas y compras convertidas en asientos contables, y los libros diario, mayor e inventario listos para tu contador.</p></div>
                {instalado && (
                    <div className="flex flex-wrap items-center gap-3">
                        {vista !== 'cuentas' && (
                            <div className="inline-flex items-center rounded-lg border border-line bg-white">
                                <button onClick={() => ir({ mes: sumaMes(mes, -1), cuenta: undefined })} aria-label="Mes anterior" className="grid size-11 place-items-center rounded-l-lg hover:bg-paper"><ChevronLeft className="size-4" /></button>
                                <span className="w-[150px] text-center text-[15px] font-semibold">{periodo}</span>
                                <button onClick={() => ir({ mes: sumaMes(mes, 1), cuenta: undefined })} disabled={mes >= hoy.slice(0, 7)} aria-label="Mes siguiente" className="grid size-11 place-items-center rounded-r-lg hover:bg-paper disabled:opacity-40"><ChevronRight className="size-4" /></button>
                            </div>)}
                        {vista !== 'cuentas' && <button onClick={() => setModal({ pdf: vista === 'resumen' ? 'estados' : vista })} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper"><FileDown className="size-[18px]" />{vista === 'resumen' ? 'Estados en PDF' : 'Libro en PDF'}</button>}
                        {vista === 'diario' && <button onClick={() => setModal('exportar')} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper"><FileSpreadsheet className="size-[18px]" />Exportar al contador</button>}
                        {exportable && vista !== 'diario' && <button onClick={exportar} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold hover:bg-paper"><FileSpreadsheet className="size-[18px]" />Excel (CSV)</button>}
                    </div>)}
            </div>

            {!instalado ? <NoInstalado /> : (<>
                <nav aria-label="Contabilidad" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
                    {TABS.map(([k, t, I]) => <button key={k} onClick={() => router.get('/contabilidad', { vista: k, mes }, { preserveScroll: true, preserveState: false })} aria-current={vista === k ? 'page' : undefined} className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-3 text-sm font-medium ${vista === k ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-text'}`}><I className="size-4" />{t}</button>)}
                </nav>
                {vista === 'resumen' && (p.cierre_activo ? <PanelCierres mes={mes} cerrado={!!p.periodo_cerrado} abrir={setModal} /> : <AvisoCierreInstalar />)}
                {vista === 'resumen' && <Resumen d={p.resumen} p={p} ir={ir} activar={() => setModal('activar')} asiento={() => setModal('asiento')} pdf={(t) => setModal({ pdf: t })} />}
                {vista === 'diario' && <Diario d={p.diario} nuevo={() => setModal('asiento')} />}
                {vista === 'mayor' && <Mayor d={p.mayor} ir={ir} />}
                {vista === 'inventario' && <Inventario d={p.inventario} />}
                {vista === 'cuentas' && <Cuentas d={p.cuentas} nueva={() => setModal('cuenta')} editar={(c) => setModal({ editar: c })} cambiado={recargar} avisar={avisar} />}
                {modal === 'periodos' && <ModalPeriodos mes={mes} cerrar={() => setModal(null)} cambiado={(t) => recargar(t)} />}
                {modal === 'ejercicio' && <ModalEjercicio hoy={hoy} cerrar={() => setModal(null)} cambiado={(t) => recargar(t)} />}
                {modal === 'apertura' && <ModalApertura cerrar={() => setModal(null)} cambiado={(t) => recargar(t)} />}
                {modal === 'ajuste' && <ModalAjuste mes={mes} cerrar={() => setModal(null)} cambiado={(t) => recargar(t)} />}
                {modal === 'exportar' && <ModalExportar desde={p.desde} hasta={p.hasta} hoy={hoy} cerrar={() => setModal(null)} />}
                {modal?.pdf && <ModalPdf tipo={modal.pdf} mes={mes} cerrar={() => setModal(null)} avisar={avisar} />}
                {modal === 'activar' && <ModalActivar cerrar={() => setModal(null)} listo={() => { setModal(null); recargar('Contabilidad automática activada.'); }} />}
                {modal === 'asiento' && <ModalAsiento cuentas={p.cuentas_mov} hoy={hoy} cerrar={() => setModal(null)} listo={(n) => { setModal(null); router.get('/contabilidad', { vista: 'diario', mes: mes }, { preserveState: false }); avisar(`Asiento ${n} registrado.`); }} />}
                {modal === 'cuenta' && <ModalCuenta cuentas={p.cuentas?.cuentas || []} cerrar={() => setModal(null)} listo={() => { setModal(null); recargar('Cuenta creada.'); }} />}
                {modal?.editar && <ModalEditar c={modal.editar} cerrar={() => setModal(null)} listo={() => { setModal(null); recargar('Cuenta actualizada.'); }} />}
            </>)}
        </AppLayout>
    );
}

const Titulo = ({ t, d, aside }) => <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-5"><div><h3 className="text-[16px] font-semibold">{t}</h3>{d && <p className="mt-0.5 max-w-[70ch] text-[13.5px] text-muted">{d}</p>}</div>{aside}</div>;
const Th = ({ children, a }) => <th scope="col" className={`whitespace-nowrap px-4 py-2.5 text-[12.5px] font-medium text-muted ${a ? 'text-right' : 'text-left'}`}>{children}</th>;

function NoInstalado() {
    return <Card><Vacio icon={Scale} titulo="La contabilidad todavía no está instalada" texto="Ejecuta el archivo database/sql/10_contabilidad.sql en tu base de datos (psql -d tienda -f 10_contabilidad.sql) y vuelve a entrar. No cambia nada de tus ventas ni compras hasta que actives los asientos automáticos." /></Card>;
}

/* ───────── Resumen ───────── */
function Resumen({ d, p, ir, activar, asiento, pdf }) {
    const ivaNeto = r2(d.iva_debito - d.iva_credito);
    const ing = d.resultados.filter((x) => x.tipo === 'INGRESO'), gas = d.resultados.filter((x) => x.tipo === 'GASTO');
    const cuadra = d.comprobacion.debe === d.comprobacion.haber;
    return (
        <div className="space-y-6">
            {!p.automatica && (
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#f0d58a] bg-[#fff8e6] p-5">
                    <div className="max-w-[68ch]"><p className="text-[15px] font-semibold text-[#6f4b00]">Los asientos automáticos están apagados</p>
                        <p className="mt-1 text-[14px] text-[#6f4b00]">Mientras estén apagados, tus ventas y compras no generan contabilidad. Al activarlos, cada venta y cada compra nueva crea su asiento sola. Lo que ya registraste antes no cambia.</p></div>
                    <Button type="button" onClick={activar}>Activar asientos automáticos</Button>
                </div>)}
            {p.automatica && (d.sin_asiento.ventas > 0 || d.sin_asiento.compras > 0) && (
                <div role="note" className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4 text-[14px]"><CircleAlert className="mt-0.5 size-5 shrink-0 text-muted" />
                    <p className="text-muted">Este mes hay <b className="font-semibold text-text">{d.sin_asiento.ventas} {d.sin_asiento.ventas === 1 ? 'venta' : 'ventas'}</b> y <b className="font-semibold text-text">{d.sin_asiento.compras} {d.sin_asiento.compras === 1 ? 'compra' : 'compras'}</b> sin asiento: son de antes de activar la contabilidad automática y no se contabilizan solas. Para empezar con tus saldos actuales, registra un <button type="button" onClick={asiento} className="font-semibold text-brand underline underline-offset-2">asiento de apertura</button>.</p></div>)}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi icon={Receipt} titulo="Ventas del mes" valor={bs(d.ingresos)} detalle="Sin IVA" />
                <Kpi icon={TrendingUp} titulo={d.resultado < 0 ? 'Pérdida del mes' : 'Ganancia del mes'} valor={bs(Math.abs(d.resultado))} tono={d.resultado < 0 ? 'bad' : undefined} detalle="Ventas menos costos y gastos" />
                <Kpi icon={Boxes} titulo="Inventario" valor={bs(d.inventario)} detalle="Saldo según contabilidad" onClick={() => ir({ vista: 'inventario' })} />
                <Kpi icon={Wallet} titulo={ivaNeto < 0 ? 'IVA a tu favor' : 'IVA por pagar'} valor={bs(Math.abs(ivaNeto))} detalle="IVA cobrado menos IVA pagado" tono={ivaNeto < 0 ? 'warn' : undefined} />
            </div>

            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                <Card className="pb-3">
                    <Titulo t="Cómo te fue este mes" d="Lo que vendiste, lo que te costó y lo que gastaste. Sale de los asientos del mes." />
                    {d.resultados.length === 0 ? <Vacio icon={TrendingUp} titulo="Todavía no hay movimientos este mes" texto="Cuando registres ventas, compras o asientos manuales, aquí verás el resultado." /> : (
                        <div className="mt-3 overflow-x-auto"><table className="w-full text-[14.5px]"><tbody>
                            <GrupoFila t="Ingresos" />{ing.map((x) => <Fila key={x.codigo} x={x} />)}
                            <GrupoFila t="Costos y gastos" />{gas.map((x) => <Fila key={x.codigo} x={x} />)}
                            <tr className="border-t border-line text-[15.5px] font-semibold"><td className="px-6 py-3" colSpan={2}>{d.resultado < 0 ? 'Pérdida del mes' : 'Ganancia del mes'}</td><td className={`num px-6 py-3 text-right ${d.resultado < 0 ? 'text-danger' : 'text-ok'}`}>{bs(d.resultado)}</td></tr>
                        </tbody></table></div>)}
                </Card>
                <div className="space-y-6">
                    <Card className="p-6">
                        <h3 className="text-[16px] font-semibold">¿Está cuadrada?</h3>
                        <p className={`mt-2 flex items-center gap-2 text-[14.5px] font-medium ${cuadra ? 'text-ok' : 'text-danger'}`}><Scale className="size-[18px]" />{cuadra ? 'Sí, el debe y el haber son iguales.' : 'No: revisa los asientos.'}</p>
                        <dl className="mt-3 space-y-1 text-[14px]"><div className="flex justify-between"><dt className="text-muted">Total debe</dt><dd className="num">{bs(d.comprobacion.debe)}</dd></div><div className="flex justify-between"><dt className="text-muted">Total haber</dt><dd className="num">{bs(d.comprobacion.haber)}</dd></div></dl>
                    </Card>
                    <Card className="pb-3">
                        <Titulo t="Reportes para tu contador" d="PDF listos para imprimir, firmar y foliar." />
                        <ul className="mt-2 divide-y divide-line">{[['diario', 'Libro diario', 'Todos los asientos del mes, con suma y sigue.'], ['mayor', 'Libro mayor', 'Cada cuenta con sus movimientos y saldos.'], ['inventario', 'Libro de inventarios', 'Producto por producto, con costo y valor.'], ['estados', 'Estados financieros', 'Comprobación, resultados y balance general.']].map(([k, t, dd]) => (
                            <li key={k}><button type="button" onClick={() => pdf(k)} className="flex w-full items-center justify-between gap-3 px-6 py-3 text-left hover:bg-paper/60"><span><span className="block text-[14.5px] font-medium">{t}</span><span className="block text-[12.5px] text-muted">{dd}</span></span><FileDown className="size-[18px] shrink-0 text-muted" /></button></li>))}</ul>
                    </Card>
                    <Card className="pb-3">
                        <Titulo t="Últimos asientos" aside={<button onClick={() => ir({ vista: 'diario' })} className="text-[13.5px] font-semibold text-brand hover:underline">Ver el diario</button>} />
                        {d.recientes.length === 0 ? <p className="px-6 py-5 text-[14px] text-muted">Aún no hay asientos.</p> : (
                            <ul className="mt-2 divide-y divide-line">{d.recientes.map((a) => <li key={a.id} className="flex items-center justify-between gap-3 px-6 py-3"><div className="min-w-0"><p className="truncate text-[14px] font-medium">{a.concepto}</p><p className="num text-[12.5px] text-muted">N.º {a.numero} · {dmy(a.fecha)}</p></div><span className="num shrink-0 text-[14px] font-semibold">{n2(a.total)}</span></li>)}</ul>)}
                    </Card>
                </div>
            </div>
        </div>
    );
}
const GrupoFila = ({ t }) => <tr><td colSpan={3} className="bg-paper/70 px-6 py-2 text-[12.5px] font-semibold text-muted">{t}</td></tr>;
const Fila = ({ x }) => <tr className="border-t border-line"><td className="num w-24 px-6 py-2.5 text-muted">{x.codigo}</td><td className="py-2.5">{x.cuenta}</td><td className="num px-6 py-2.5 text-right">{bs(x.monto)}</td></tr>;

/* ───────── Libro diario ───────── */
function Diario({ d, nuevo }) {
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-[14.5px] text-muted">{d.filas.length === 0 ? 'Sin asientos este mes.' : `${d.filas.length} ${d.filas.length === 1 ? 'asiento' : 'asientos'} · movimiento total ${bs(d.total)}`}</p>
                <Button type="button" onClick={nuevo}><Plus className="size-[18px]" />Nuevo asiento</Button></div>
            {d.filas.length === 0 ? <Card><Vacio icon={BookOpen} titulo="No hay asientos en este mes" texto="Los asientos de ventas y compras aparecen solos cuando la contabilidad automática está activa. También puedes registrar uno a mano: gastos, apertura, ajustes." /></Card> : d.filas.map((a) => (
                <Card key={a.id} className="overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper/60 px-5 py-3">
                        <div className="min-w-0"><p className="truncate text-[15px] font-semibold">{a.concepto}</p><p className="num text-[12.5px] text-muted">Asiento N.º {a.numero} · {dmy(a.fecha)}</p></div>
                        <span className="rounded-full bg-white px-2.5 py-1 text-[12px] font-medium text-muted ring-1 ring-line">{ORIGEN[a.origen] || a.origen}</span>
                    </div>
                    <div className="overflow-x-auto"><table className="w-full text-[14px]">
                        <thead><tr><Th>Cuenta</Th><Th a>Debe</Th><Th a>Haber</Th></tr></thead>
                        <tbody>{a.lineas.map((l, i) => (
                            <tr key={i} className="border-t border-line/70"><td className={`px-4 py-2 ${l.haber > 0 ? 'pl-10' : ''}`}><span className="num mr-2 text-muted">{l.codigo}</span>{l.cuenta}{l.glosa && <span className="block pl-[3.1rem] text-[12.5px] text-muted">{l.glosa}</span>}</td>
                                <td className="num px-4 py-2 text-right">{cel(l.debe)}</td><td className="num px-4 py-2 text-right">{cel(l.haber)}</td></tr>))}</tbody>
                        <tfoot><tr className="border-t border-line font-semibold"><td className="px-4 py-2 text-[13px] text-muted">Total</td><td className="num px-4 py-2 text-right">{n2(a.total)}</td><td className="num px-4 py-2 text-right">{n2(a.total)}</td></tr></tfoot>
                    </table></div>
                </Card>))}
        </div>
    );
}

/* ───────── Libro mayor ───────── */
function Mayor({ d, ir }) {
    if (d.detalle) {
        const x = d.detalle; const ult = x.movimientos.length ? x.movimientos[x.movimientos.length - 1].saldo : x.inicial;
        return (
            <div className="space-y-4">
                <button type="button" onClick={() => ir({ cuenta: undefined })} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-muted hover:text-text"><ArrowLeft className="size-4" />Volver al libro mayor</button>
                <Card className="overflow-hidden">
                    <div className="border-b border-line px-6 py-4"><h3 className="text-[17px] font-semibold"><span className="num mr-2 text-muted">{x.codigo}</span>{x.cuenta}</h3><p className="mt-0.5 text-[13.5px] text-muted">Cuenta de {TIPO[x.tipo].toLowerCase()} · movimiento por movimiento, con el saldo después de cada uno.</p></div>
                    <div className="overflow-x-auto"><table className="w-full text-[14px]">
                        <thead><tr><Th>Fecha</Th><Th>Asiento</Th><Th>Concepto</Th><Th a>Debe</Th><Th a>Haber</Th><Th a>Saldo</Th></tr></thead>
                        <tbody>
                            <tr className="border-t border-line bg-paper/50"><td className="px-4 py-2.5 text-muted" colSpan={5}>Saldo al comenzar el mes</td><td className="num px-4 py-2.5 text-right font-semibold">{n2(x.inicial)}</td></tr>
                            {x.movimientos.map((m, i) => <tr key={i} className="border-t border-line/70"><td className="num px-4 py-2.5">{dmy(m.fecha)}</td><td className="num px-4 py-2.5 text-muted">N.º {m.numero}</td><td className="px-4 py-2.5">{m.concepto}</td><td className="num px-4 py-2.5 text-right">{cel(m.debe)}</td><td className="num px-4 py-2.5 text-right">{cel(m.haber)}</td><td className="num px-4 py-2.5 text-right font-medium">{n2(m.saldo)}</td></tr>)}
                            {x.movimientos.length === 0 && <tr className="border-t border-line"><td colSpan={6} className="px-4 py-6 text-center text-muted">Esta cuenta no tuvo movimientos este mes.</td></tr>}
                        </tbody>
                        <tfoot><tr className="border-t border-line text-[15px] font-semibold"><td className="px-4 py-3" colSpan={5}>Saldo al final del mes</td><td className="num px-4 py-3 text-right">{bs(ult)}</td></tr></tfoot>
                    </table></div>
                </Card>
            </div>
        );
    }
    return (
        <Card className="overflow-hidden">
            <Titulo t="Saldo de cada cuenta" d="Toca una cuenta para ver sus movimientos. Los activos y gastos suben por el debe; los pasivos, el patrimonio y los ingresos, por el haber." />
            {d.filas.length === 0 ? <Vacio icon={Layers} titulo="No hay movimientos todavía" texto="El libro mayor se llena con los asientos del libro diario." /> : (
                <div className="mt-3 overflow-x-auto"><table className="w-full text-[14px]">
                    <thead><tr><Th>Código</Th><Th>Cuenta</Th><Th a>Saldo inicial</Th><Th a>Débitos</Th><Th a>Créditos</Th><Th a>Saldo final</Th></tr></thead>
                    <tbody>{d.filas.map((c) => (
                        <tr key={c.codigo} onClick={() => ir({ cuenta: c.codigo })} className="cursor-pointer border-t border-line/70 hover:bg-paper/60">
                            <td className="num px-4 py-2.5 text-muted">{c.codigo}</td>
                            <td className="px-4 py-2.5"><button type="button" onClick={(e) => { e.stopPropagation(); ir({ cuenta: c.codigo }); }} className="text-left font-medium hover:text-brand">{c.cuenta}</button><span className="ml-2 text-[12px] text-muted">{TIPO[c.tipo]}</span></td>
                            <td className="num px-4 py-2.5 text-right text-muted">{n2(c.inicial)}</td><td className="num px-4 py-2.5 text-right">{cel(c.debitos)}</td><td className="num px-4 py-2.5 text-right">{cel(c.creditos)}</td><td className="num px-4 py-2.5 text-right font-semibold">{n2(c.final)}</td></tr>))}</tbody>
                    <tfoot><tr className="border-t border-line font-semibold"><td className="px-4 py-3" colSpan={3}>Totales del mes</td><td className="num px-4 py-3 text-right">{n2(d.totales.debitos)}</td><td className="num px-4 py-3 text-right">{n2(d.totales.creditos)}</td><td /></tr></tfoot>
                </table></div>)}
        </Card>
    );
}

/* ───────── Libro de inventario ───────── */
function Inventario({ d }) {
    const tot = d.filas.find((f) => f.total); const dif = tot && tot.valor_ves != null ? r2(tot.valor_ves - d.contable_ves) : null;
    return (
        <div className="space-y-6">
            <Card className="overflow-hidden">
                <Titulo t={`Inventario al ${dmy(d.corte)}`} d="Lo que tenías en cada categoría ese día, valorado al costo que tenía cada producto en esa fecha." />
                {d.filas.length <= 1 ? <Vacio icon={Boxes} titulo="No había existencias en esa fecha" texto="Prueba con un mes más reciente: el libro toma el stock y el costo que registró el kardex hasta el cierre." /> : (
                    <div className="mt-3 overflow-x-auto"><table className="w-full text-[14px]">
                        <thead><tr><Th>Categoría</Th><Th a>Productos</Th><Th a>Unidades</Th><Th a>Costo promedio</Th><Th a>Valor ($)</Th><Th a>Valor (Bs)</Th></tr></thead>
                        <tbody>{d.filas.filter((f) => !f.total).map((f) => <tr key={f.categoria} className="border-t border-line/70"><td className="px-4 py-2.5 font-medium">{f.categoria}</td><td className="num px-4 py-2.5 text-right">{f.productos}</td><td className="num px-4 py-2.5 text-right">{n2(f.unidades)}</td><td className="num px-4 py-2.5 text-right text-muted">{f.costo == null ? '' : `$ ${n2(f.costo)}`}</td><td className="num px-4 py-2.5 text-right">{n2(f.valor_usd)}</td><td className="num px-4 py-2.5 text-right">{f.valor_ves == null ? '—' : n2(f.valor_ves)}</td></tr>)}</tbody>
                        {tot && <tfoot><tr className="border-t-2 border-text/80 text-[15px] font-semibold"><td className="px-4 py-3">Gran total</td><td className="num px-4 py-3 text-right">{tot.productos}</td><td className="num px-4 py-3 text-right">{n2(tot.unidades)}</td><td className="num px-4 py-3 text-right">{tot.costo == null ? '' : `$ ${n2(tot.costo)}`}</td><td className="num px-4 py-3 text-right">{n2(tot.valor_usd)}</td><td className="num px-4 py-3 text-right">{tot.valor_ves == null ? '—' : n2(tot.valor_ves)}</td></tr></tfoot>}
                    </table></div>)}
                {d.sin_tasa && <p className="mx-6 mb-5 mt-3 text-[13.5px] text-[#8a5d00]">No hay tasa cargada para esa fecha, por eso no se calculó el valor en bolívares. Cárgala en <a href="/tasas" className="font-semibold underline underline-offset-2">Tasas de cambio</a>.</p>}
            </Card>
            {tot && tot.valor_ves != null && (
                <Card className="p-6">
                    <h3 className="text-[16px] font-semibold">¿Coincide con tu contabilidad?</h3>
                    <dl className="mt-3 grid gap-x-8 gap-y-2 text-[14.5px] sm:max-w-[520px]">
                        <div className="flex justify-between"><dt className="text-muted">Libro de inventario</dt><dd className="num font-medium">{bs(tot.valor_ves)}</dd></div>
                        <div className="flex justify-between"><dt className="text-muted">Cuenta Inventario de mercancía</dt><dd className="num font-medium">{bs(d.contable_ves)}</dd></div>
                        <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Diferencia</dt><dd className={`num ${Math.abs(dif) < 1 ? 'text-ok' : 'text-[#8a5d00]'}`}>{bs(dif)}</dd></div>
                    </dl>
                    <p className="mt-3 max-w-[70ch] text-[13.5px] text-muted">Una diferencia pequeña es normal: el libro valora al cambio del día de cierre y los asientos al cambio de cada documento. Una diferencia grande suele venir de ajustes de stock (que todavía no generan asiento) o de mercancía anterior a la contabilidad.</p>
                </Card>)}
        </div>
    );
}

/* ───────── Cuentas ───────── */
function Cuentas({ d, nueva, editar, cambiado, avisar }) {
    const porId = useMemo(() => Object.fromEntries(d.cuentas.map((c) => [c.id, c])), [d.cuentas]);
    const mov = d.cuentas.filter((c) => c.mov && c.activa);
    const [env, setEnv] = useState('');
    const cambiarParam = async (clave, cuenta_id) => {
        setEnv(clave);
        try { await http('PUT', `/contabilidad/parametros/${clave}`, { cuenta_id: Number(cuenta_id) }); cambiado('Cuenta actualizada.'); } catch (e) { avisar(e.message); } finally { setEnv(''); }
    };
    return (
        <div className="space-y-6">
            <Card className="overflow-hidden">
                <Titulo t="Plan de cuentas" d="Las cuentas en las que se anota todo. Las que están en negrita agrupan a las demás y no reciben movimientos." aside={<Button type="button" onClick={nueva}><Plus className="size-[18px]" />Nueva cuenta</Button>} />
                <div className="mt-3 overflow-x-auto"><table className="w-full text-[14px]">
                    <thead><tr><Th>Código</Th><Th>Nombre</Th><Th>Tipo</Th><Th a>Movimientos</Th><Th><span className="sr-only">Acciones</span></Th></tr></thead>
                    <tbody>{d.cuentas.map((c) => {
                        const nivel = c.codigo.split('.').length - 1;
                        return (
                            <tr key={c.id} className={`border-t border-line/70 ${c.activa ? '' : 'opacity-50'}`}>
                                <td className="num px-4 py-2.5 text-muted">{c.codigo}</td>
                                <td className="px-4 py-2.5" style={{ paddingLeft: 16 + nivel * 20 }}><span className={c.mov ? '' : 'font-semibold'}>{c.nombre}</span>{!c.activa && <span className="ml-2 text-[12px] text-muted">(desactivada)</span>}</td>
                                <td className="px-4 py-2.5 text-muted">{TIPO[c.tipo]}</td>
                                <td className="num px-4 py-2.5 text-right text-muted">{c.mov ? c.usos : ''}</td>
                                <td className="px-4 py-2.5 text-right"><button type="button" onClick={() => editar(c)} aria-label={`Editar ${c.nombre}`} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-paper hover:text-text"><Pencil className="size-4" /></button></td>
                            </tr>);
                    })}</tbody>
                </table></div>
            </Card>
            <Card className="pb-2">
                <Titulo t="Cuentas del sistema" d="A qué cuenta va cada parte de los asientos automáticos. Si tu contador usa otro plan, cámbialas aquí." />
                <ul className="mt-3 divide-y divide-line">{d.parametros.map((x) => (
                    <li key={x.clave} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                        <div className="min-w-0"><p className="text-[14.5px] font-medium">{x.etiqueta}</p>{x.nota && <p className="text-[12.5px] text-muted">{x.nota}</p>}</div>
                        <select value={x.cuenta_id} disabled={env === x.clave} onChange={(e) => cambiarParam(x.clave, e.target.value)} aria-label={x.etiqueta} className="h-10 max-w-full rounded-lg border border-line bg-white px-3 text-[14px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
                            {mov.concat(porId[x.cuenta_id] && !porId[x.cuenta_id].activa ? [porId[x.cuenta_id]] : []).map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                        </select>
                    </li>))}</ul>
            </Card>
        </div>
    );
}

/* ───────── Modales ───────── */
function ModalPdf({ tipo, mes, cerrar, avisar }) {
    const NOMBRE = { diario: 'Libro diario', mayor: 'Libro mayor', inventario: 'Libro de inventarios', estados: 'Estados financieros' };
    const guardado = (() => { try { return JSON.parse(localStorage.getItem('contab_pdf') || '{}'); } catch { return {}; } })();
    const [f, setF] = useState({ folio: '1', nombre: guardado.nombre || '', cpc: guardado.cpc || '' }); const [env, setEnv] = useState(false); const [err, setErr] = useState('');
    const generar = async () => {
        const folio = Math.floor(Number(f.folio));
        if (!Number.isFinite(folio) || folio < 1) return setErr('El primer folio debe ser un número desde 1.');
        setEnv(true); setErr('');
        try {
            try { localStorage.setItem('contab_pdf', JSON.stringify({ nombre: f.nombre, cpc: f.cpc })); } catch { /* sin almacenamiento */ }
            const d = await http('GET', `/contabilidad/reporte?tipo=${tipo}&mes=${mes}`);
            const lib = await import('../../lib/pdfContabilidad');
            const doc = await lib.PDF_CONTAB[tipo](d, { folio, contador: { nombre: f.nombre.trim(), cpc: f.cpc.trim() } });
            doc.save(`${tipo === 'inventario' ? 'libro-inventarios-' + d.corte : (tipo === 'estados' ? 'estados-financieros-' : 'libro-' + tipo + '-') + d.mes}.pdf`);
            avisar(`${NOMBRE[tipo]} listo.`); cerrar();
        } catch (e) { setErr(e.message || 'No se pudo preparar el PDF.'); setEnv(false); }
    };
    return (
        <Modal titulo={`${NOMBRE[tipo]} en PDF`} subtitulo={`Período: ${mesLargo(mes)}. Cada hoja lleva el número de folio para que puedas archivarla.`} cerrar={cerrar} onSubmit={generar} enviando={env} ok="Descargar PDF">
            <Field label="Primer folio" inputMode="numeric" value={f.folio} onChange={(e) => setF({ ...f, folio: e.target.value })} hint="Si ya imprimiste hojas de este libro, continúa la numeración desde el siguiente folio." />
            <div className="grid gap-4 sm:grid-cols-[1fr_170px]">
                <Field label="Contador público (opcional)" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
                <Field label="C.P.C. N.º (opcional)" value={f.cpc} onChange={(e) => setF({ ...f, cpc: e.target.value })} />
            </div>
            <p className="rounded-lg bg-paper px-3.5 py-2.5 text-[13px] text-muted">Al final del documento van las líneas de firma del representante legal y del contador. Estos datos solo se guardan en este navegador.</p>
            {err && <p role="alert" className="flex items-start gap-1.5 text-[13px] text-danger"><CircleAlert className="mt-px size-3.5 shrink-0" />{err}</p>}
        </Modal>
    );
}

function ModalActivar({ cerrar, listo }) {
    const [env, setEnv] = useState(false); const [err, setErr] = useState('');
    const ok = async () => { setEnv(true); try { await http('POST', '/contabilidad/automatica', { activa: true }); listo(); } catch (e) { setErr(e.message); setEnv(false); } };
    return (
        <Modal titulo="Activar asientos automáticos" subtitulo="Cada venta y cada compra nueva crea su asiento contable." cerrar={cerrar} onSubmit={ok} enviando={env} ok="Activar">
            <ul className="space-y-2 text-[14.5px] leading-snug">
                <li>• Las <b className="font-semibold">ventas</b> anotan lo cobrado en caja o bancos, las ventas, el IVA, el IGTF y el costo de la mercancía.</li>
                <li>• Las <b className="font-semibold">compras</b> anotan el inventario, el IVA crédito y lo que debes al proveedor.</li>
                <li>• Las anulaciones generan el asiento contrario; nada se borra.</li>
                <li>• Lo que registraste antes de activar <b className="font-semibold">no</b> se contabiliza solo. Empieza con un asiento de apertura.</li>
            </ul>
            <p className="rounded-lg bg-paper px-3.5 py-2.5 text-[13px] text-muted">El plan de cuentas inicial es una propuesta. Revísalo con tu contador antes de usar estos libros como contabilidad oficial.</p>
            {err && <p role="alert" className="flex items-start gap-1.5 text-[13px] text-danger"><CircleAlert className="mt-px size-3.5 shrink-0" />{err}</p>}
        </Modal>
    );
}

function ModalAsiento({ cuentas, hoy, cerrar, listo }) {
    const vacia = () => ({ cuenta_id: '', debe: '', haber: '', glosa: '' });
    const [f, setF] = useState({ fecha: hoy, concepto: '', tipo: 'MANUAL' }); const [ls, setLs] = useState([vacia(), vacia()]); const [env, setEnv] = useState(false); const [err, setErr] = useState(''); const [intento, setIntento] = useState(false);
    const debe = r2(ls.reduce((s, l) => s + (num(l.debe) || 0), 0)), haber = r2(ls.reduce((s, l) => s + (num(l.haber) || 0), 0)); const dif = r2(debe - haber);
    const mod = (i, c) => setLs((a) => a.map((l, k) => (k === i ? { ...l, ...c } : l)));
    const enviar = async () => {
        setIntento(true); setErr('');
        if (!f.concepto.trim()) return setErr('Escribe de qué trata el asiento.');
        if (ls.some((l) => !l.cuenta_id)) return setErr('Elige la cuenta de cada línea.');
        if (ls.some((l) => (num(l.debe) > 0) === (num(l.haber) > 0))) return setErr('Cada línea lleva un monto en el debe o en el haber, no en los dos.');
        if (dif !== 0 || debe === 0) return setErr('El asiento no cuadra: el debe y el haber deben ser iguales.');
        setEnv(true);
        try { const r = await http('POST', '/contabilidad/asientos', { fecha: f.fecha, concepto: f.concepto.trim(), tipo: f.tipo, lineas: ls.map((l) => ({ cuenta_id: Number(l.cuenta_id), debe: num(l.debe) || 0, haber: num(l.haber) || 0, glosa: l.glosa.trim() || null })) }); listo(r.numero); } catch (e) { setErr(e.message); setEnv(false); }
    };
    return (
        <Modal titulo="Nuevo asiento" subtitulo="Para gastos, apertura de saldos o ajustes que no vienen de una venta o compra." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Registrar asiento" ancho="max-w-[760px]">
            <div className="grid gap-4 sm:grid-cols-[150px_1fr_170px]">
                <Field label="Fecha" type="date" forceFloat max={hoy} value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
                <Field label="Concepto" value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} error={intento && !f.concepto.trim() ? 'Escribe de qué trata.' : ''} autoFocus />
                <Field label="Tipo" select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="MANUAL">Manual</option><option value="APERTURA">Apertura</option></Field>
            </div>
            <div>
                <div className="hidden grid-cols-[minmax(0,1fr)_120px_120px_36px] gap-2 px-1 pb-1.5 text-[12.5px] font-medium text-muted sm:grid"><span>Cuenta</span><span className="text-right">Debe</span><span className="text-right">Haber</span><span /></div>
                <ul className="space-y-2">{ls.map((l, i) => (
                    <li key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_120px_36px]">
                        <select value={l.cuenta_id} onChange={(e) => mod(i, { cuenta_id: e.target.value })} aria-label={`Cuenta de la línea ${i + 1}`} className={`h-11 min-w-0 rounded-lg border bg-white px-2.5 text-[14px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand ${intento && !l.cuenta_id ? 'border-danger' : 'border-line'}`}>
                            <option value="">Elige una cuenta…</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}</select>
                        <input inputMode="decimal" value={l.debe} onChange={(e) => mod(i, { debe: e.target.value, haber: e.target.value ? '' : l.haber })} aria-label={`Debe de la línea ${i + 1}`} placeholder="Debe" className="num h-11 rounded-lg border border-line bg-white px-3 text-right text-[14.5px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                        <input inputMode="decimal" value={l.haber} onChange={(e) => mod(i, { haber: e.target.value, debe: e.target.value ? '' : l.debe })} aria-label={`Haber de la línea ${i + 1}`} placeholder="Haber" className="num h-11 rounded-lg border border-line bg-white px-3 text-right text-[14.5px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                        <button type="button" onClick={() => setLs((a) => (a.length > 2 ? a.filter((_, k) => k !== i) : a))} disabled={ls.length <= 2} aria-label={`Quitar la línea ${i + 1}`} className="grid size-9 place-items-center justify-self-end rounded-lg text-muted hover:bg-[#fdecec] hover:text-danger disabled:opacity-30"><Trash2 className="size-4" /></button>
                    </li>))}</ul>
                <button type="button" onClick={() => setLs((a) => [...a, vacia()])} className="mt-2 inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand hover:underline"><Plus className="size-4" />Agregar línea</button>
            </div>
            <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-3 text-[14px] ${dif === 0 && debe > 0 ? 'bg-[#e3f3ea] text-[#0f5f37]' : 'bg-paper text-muted'}`}>
                <span className="num">Debe {n2(debe)} · Haber {n2(haber)}</span>
                <span className="font-semibold">{debe === 0 && haber === 0 ? 'Escribe los montos' : dif === 0 ? 'Cuadra' : dif > 0 ? `Falta ${n2(dif)} en el haber` : `Falta ${n2(-dif)} en el debe`}</span>
            </div>
            {err && <p role="alert" className="flex items-start gap-1.5 text-[13px] text-danger"><CircleAlert className="mt-px size-3.5 shrink-0" />{err}</p>}
        </Modal>
    );
}

function ModalCuenta({ cuentas, cerrar, listo }) {
    const [f, setF] = useState({ padre: '', codigo: '', nombre: '', mov: true }); const [err, setErr] = useState({}); const [env, setEnv] = useState(false);
    const padre = cuentas.find((c) => String(c.id) === String(f.padre));
    const posibles = cuentas.filter((c) => !c.mov && c.activa);
    const sugerido = (pd) => { if (!pd) return ''; const hijos = cuentas.filter((c) => c.padre_id === pd.id).map((c) => Number(c.codigo.split('.').pop())); const sig = (hijos.length ? Math.max(...hijos) : 0) + 1; return `${pd.codigo}.${String(sig).padStart(2, '0')}`; };
    const enviar = async () => {
        const e = {}; if (!padre) e.padre = 'Elige dónde va esta cuenta.'; if (!/^\d+(\.\d+)*$/.test(f.codigo)) e.codigo = 'Usa números separados por puntos, como 1.1.06.'; if (f.nombre.trim().length < 2) e.nombre = 'Escribe el nombre.';
        if (Object.keys(e).length) return setErr(e);
        setEnv(true);
        try { await http('POST', '/contabilidad/cuentas', { codigo: f.codigo, nombre: f.nombre, tipo: padre.tipo, cuenta_padre_id: padre.id, permite_movimiento: f.mov }); listo(); } catch (x) { setErr({ general: x.message }); setEnv(false); }
    };
    return (
        <Modal titulo="Nueva cuenta" subtitulo="Se crea dentro de una cuenta de agrupación y toma su tipo." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Crear cuenta">
            <Field label="¿Dónde va?" select value={f.padre} onChange={(e) => { const pd = cuentas.find((c) => String(c.id) === e.target.value); setF({ ...f, padre: e.target.value, codigo: sugerido(pd) }); setErr({}); }} error={err.padre}>
                <option value="">Elige una cuenta de agrupación…</option>{posibles.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre} ({TIPO[c.tipo].toLowerCase()})</option>)}</Field>
            <div className="grid gap-4 sm:grid-cols-[150px_1fr]">
                <Field label="Código" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} error={err.codigo} />
                <Field label="Nombre" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} error={err.nombre} />
            </div>
            <label className="flex items-start gap-3"><Switch on={f.mov} set={(v) => setF({ ...f, mov: v })} label="Recibe movimientos" /><span className="text-[14px]"><b className="font-semibold">Recibe movimientos</b><span className="block text-muted">Apágalo si esta cuenta solo va a agrupar a otras.</span></span></label>
            {err.general && <p role="alert" className="flex items-start gap-1.5 text-[13px] text-danger"><CircleAlert className="mt-px size-3.5 shrink-0" />{err.general}</p>}
        </Modal>
    );
}

function ModalEditar({ c, cerrar, listo }) {
    const [nombre, setNombre] = useState(c.nombre); const [activa, setActiva] = useState(c.activa); const [err, setErr] = useState(''); const [env, setEnv] = useState(false);
    const enviar = async () => { if (nombre.trim().length < 2) return setErr('Escribe el nombre.'); setEnv(true); try { await http('PUT', `/contabilidad/cuentas/${c.id}`, { nombre, activa }); listo(); } catch (x) { setErr(x.message); setEnv(false); } };
    return (
        <Modal titulo={`Cuenta ${c.codigo}`} subtitulo="El código y el tipo no cambian, para no alterar los libros ya emitidos." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Guardar">
            <Field label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
            <label className="flex items-start gap-3"><Switch on={activa} set={setActiva} label="Cuenta activa" /><span className="text-[14px]"><b className="font-semibold">Cuenta activa</b><span className="block text-muted">Si la desactivas, ya no aparece al registrar asientos. Sus movimientos pasados se conservan.</span></span></label>
            {err && <p role="alert" className="flex items-start gap-1.5 text-[13px] text-danger"><CircleAlert className="mt-px size-3.5 shrink-0" />{err}</p>}
        </Modal>
    );
}
