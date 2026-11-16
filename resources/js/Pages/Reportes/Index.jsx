import { Head } from '@inertiajs/react';
import { useState } from 'react';
import { Boxes, FileDown, Landmark, ShoppingBasket, TrendingUp, Users, PieChart, Timer } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card } from '../../Components/kit';
import { Field } from '../../Components/ui';
import { http } from '../../lib/http';
import { n0, n2 } from '../../lib/format';

const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

/* Cada reporte: qué pide, cómo se previsualiza y qué PDF arma. */
const REPORTES = [
    { id: 'rentabilidad', icon: TrendingUp, titulo: 'Rentabilidad por producto', texto: 'Cuánto ingresó, cuánto costó y cuánto ganaste con cada producto vendido. Ordenado de más a menos utilidad.',
        url: '/reportes/rentabilidad', archivo: 'rentabilidad', cols: [['sku', 'SKU'], ['producto', 'Producto'], ['ingreso_usd', 'Ingreso US$', 'n'], ['utilidad_usd', 'Utilidad US$', 'n'], ['margen_pct', 'Margen', 'p']],
        resumen: (t) => `Utilidad US$ ${n2(t.utilidad_usd)} sobre ingresos de US$ ${n2(t.ingreso_usd)}${t.margen_pct !== null ? ` (${n2(t.margen_pct)} %)` : ''}` },
    { id: 'abc', icon: PieChart, titulo: 'Análisis ABC de lo vendido', texto: 'Las piezas A aportan el 80 % del dinero, las B hasta el 95 % y las C son el resto. Clasifica por ingreso o por unidades.',
        url: '/reportes/abc', archivo: 'analisis-abc', extra: true, cols: [['clase', 'Clase'], ['sku', 'SKU'], ['producto', 'Producto'], ['ingreso_usd', 'Ingreso US$', 'n'], ['participacion_pct', '%', 'p'], ['acumulado_pct', '% acum.', 'p'], ['margen_pct', 'Margen', 'p']],
        resumen: (t) => `${n0(t.productos)} piezas: ${n0(t.clase_a)} A · ${n0(t.clase_b)} B · ${n0(t.clase_c)} C` },
    { id: 'rotacion', icon: Timer, titulo: 'Rotación de inventario', texto: 'Cuánto rota cada pieza: días para agotar el stock actual y qué dinero está parado. Las piezas muertas (sin ventas y con stock) saltan a la vista.',
        url: '/reportes/rotacion', archivo: 'rotacion-inventario', cols: [['sku', 'SKU'], ['producto', 'Producto'], ['stock', 'Stock', 'i'], ['valor_stock_usd', 'Valor US$', 'n'], ['dias_para_agotar', 'Días p/ agotar', 'p'], ['estado', 'Estado']],
        resumen: (t) => `${n0(t.productos)} piezas · US$ ${n2(t.valor_parado_usd)} parados · ${n0(t.muertos)} muertas (US$ ${n2(t.valor_muerto_usd)})` },
    { id: 'rentabilidad-categoria', icon: Boxes, titulo: 'Rentabilidad por categoría', texto: 'Qué grupo de repuestos gana más: ingreso, costo, utilidad y margen por categoría, con las devoluciones descontadas.',
        url: '/reportes/rentabilidad-categoria', archivo: 'rentabilidad-categoria', cols: [['categoria', 'Categoría'], ['ingreso_usd', 'Ingreso US$', 'n'], ['costo_usd', 'Costo US$', 'n'], ['utilidad_usd', 'Utilidad US$', 'n'], ['margen_pct', 'Margen', 'p'], ['participacion_pct', '%', 'p']],
        resumen: (t) => `Utilidad US$ ${n2(t.utilidad_usd)} · margen ${t.margen_pct === null ? '—' : `${n2(t.margen_pct)} %`}` },
    { id: 'rentabilidad-cliente', icon: Users, titulo: 'Rentabilidad por cliente', texto: 'Cuánto compra cada cliente, su margen, su ticket promedio y hace cuánto no pasa por la tienda.',
        url: '/reportes/rentabilidad-cliente', archivo: 'rentabilidad-cliente', cols: [['cliente', 'Cliente'], ['ventas', 'Ventas', 'i'], ['ingreso_usd', 'Ingreso US$', 'n'], ['utilidad_usd', 'Utilidad US$', 'n'], ['ticket_promedio_usd', 'Ticket US$', 'n'], ['dias_sin_comprar', 'Días sin comprar', 'i']],
        resumen: (t) => `${n0(t.clientes)} clientes · utilidad US$ ${n2(t.utilidad_usd)} · margen ${t.margen_pct === null ? '—' : `${n2(t.margen_pct)} %`}` },
    { id: 'compras', icon: ShoppingBasket, titulo: 'Compras por proveedor', texto: 'Cuánto le compraste a cada proveedor en el rango: facturas, total en dólares y en bolívares.',
        url: '/reportes/compras-global', archivo: 'compras-por-proveedor', cols: [['rif', 'RIF'], ['proveedor', 'Proveedor'], ['facturas', 'Facturas', 'i'], ['total_usd', 'Total US$', 'n'], ['total_ves', 'Total Bs', 'n']],
        resumen: (t) => `${n0(t.facturas)} facturas · US$ ${n2(t.total_usd)} · Bs ${n2(t.total_ves)}` },
    { id: 'caja', icon: Landmark, titulo: 'Movimientos de caja', texto: 'Cada ingreso y egreso de caja: cobros de ventas, cobros de cuentas por cobrar y egresos manuales. Por turno o por fechas.',
        url: '/reportes/movimientos-caja', archivo: 'movimientos-de-caja', turno: true, cols: [['fecha', 'Fecha', 'f'], ['tipo', 'Tipo'], ['concepto', 'Concepto'], ['usd', 'US$', 'n'], ['ves', 'Bs', 'n']],
        resumen: (t) => `Ingresos US$ ${n2(t.ingresos_usd)} · egresos US$ ${n2(t.egresos_usd)} · neto US$ ${n2(t.neto_usd)}` },
];
const celda = (v, k) => (k === 'n' ? n2(v) : k === 'i' ? n0(v) : k === 'p' ? (v === null || v === undefined ? '—' : `${n2(v)} %`) : k === 'f' ? `${dmy(v)} ${String(v).slice(11, 16)}` : v);

function Reporte({ r, inicio, hoy, aperturas }) {
    const [f, setF] = useState({ desde: inicio, hasta: hoy, apertura: '', por: 'VALOR' });
    const [d, setD] = useState(null); const [cargando, setCargando] = useState(''); const [err, setErr] = useState('');
    const consulta = () => { const q = new URLSearchParams(r.turno && f.apertura ? { apertura: f.apertura } : { desde: f.desde, hasta: f.hasta }); if (r.id === 'abc') q.set('por', f.por); return `${r.url}?${q}`; };
    const ver = async () => { setErr(''); setCargando('ver'); try { setD(await http('GET', consulta())); } catch (e) { setErr(e.message); } finally { setCargando(''); } };
    const pdf = async () => {
        setErr(''); setCargando('pdf');
        try {
            const datos = d && !cargando ? await http('GET', consulta()) : await http('GET', consulta()); setD(datos);   // siempre con datos frescos
            const lib = await import('../../lib/pdfReportes'); const { abrirPdf } = await import('../../lib/pdfVenta');
            abrirPdf(await lib.PDF_REPORTE[r.id](datos), { nombre: `${r.archivo}-${(datos.desde || hoy)}.pdf` });
        } catch (e) { setErr(e.message); } finally { setCargando(''); }
    };
    const Icon = r.icon;
    return (
        <Card className="p-5">
            <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand"><Icon className="size-5" /></span>
                <div><h2 className="text-[16px] font-semibold">{r.titulo}</h2><p className="mt-0.5 max-w-[70ch] text-[13.5px] leading-snug text-muted">{r.texto}</p></div></div>
            <div className="mt-4 flex flex-wrap items-end gap-3">
                {r.turno && <div className="w-full sm:w-[300px]"><Field select label="Turno" forceFloat value={f.apertura} onChange={(e) => setF({ ...f, apertura: e.target.value })}><option value="">Por fechas…</option>{aperturas.map((a) => <option key={a.id} value={a.id}>{a.etiqueta}</option>)}</Field></div>}
                {r.id === 'abc' && <div className="w-[210px]"><Field select label="Clasificar por" forceFloat value={f.por} onChange={(e) => setF({ ...f, por: e.target.value })}><option value="VALOR">Ingreso (dinero)</option><option value="UNIDADES">Unidades vendidas</option></Field></div>}
                {!(r.turno && f.apertura) && <>
                    <div className="w-[158px]"><Field label="Desde" type="date" forceFloat value={f.desde} max={hoy} onChange={(e) => setF({ ...f, desde: e.target.value })} /></div>
                    <div className="w-[158px]"><Field label="Hasta" type="date" forceFloat value={f.hasta} max={hoy} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></div></>}
                <button type="button" onClick={ver} disabled={!!cargando} className="inline-flex h-12 items-center rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper disabled:opacity-60">{cargando === 'ver' ? 'Consultando…' : 'Ver resultado'}</button>
                <button type="button" onClick={pdf} disabled={!!cargando} className="inline-flex h-12 items-center gap-2 rounded-lg bg-brand px-4 text-[14px] font-semibold text-white hover:bg-brand-600 disabled:opacity-60"><FileDown className="size-4" />{cargando === 'pdf' ? 'Generando…' : 'PDF'}</button>
            </div>
            {err && <p role="alert" className="mt-3 text-[13.5px] text-danger">{err}</p>}
            {d && (
                <div className="mt-4">
                    <p className="text-[14px] font-semibold">{r.resumen(d.totales)}</p>
                    {d.filas.length === 0 ? <p className="mt-2 text-[13.5px] text-muted">No hay datos en ese período.</p> : (
                        <div className="mt-2 overflow-x-auto rounded-xl border border-line"><table className="w-full min-w-[560px] text-[13.5px]">
                            <thead><tr className="bg-paper text-left text-[12px] text-muted">{r.cols.map(([k, t, tipo]) => <th key={k} className={`px-3 py-2 font-medium ${['n', 'i', 'p'].includes(tipo) ? 'text-right' : ''}`}>{t}</th>)}</tr></thead>
                            <tbody>{d.filas.slice(0, 10).map((x, i) => <tr key={i} className="border-t border-line">{r.cols.map(([k, , tipo]) => <td key={k} className={`px-3 py-2 ${['n', 'i', 'p'].includes(tipo) ? 'num text-right' : ''}`}>{celda(x[k], tipo)}</td>)}</tr>)}</tbody></table></div>)}
                    {d.filas.length > 10 && <p className="mt-1.5 text-[12.5px] text-muted">Se muestran 10 de {d.filas.length} filas. El PDF las trae todas.</p>}
                </div>
            )}
        </Card>
    );
}

export default function Reportes(p) {
    const { negocio, usuario, stock_bajo, tasa_usd, hoy, inicio_mes, aperturas } = p;
    return (
        <AppLayout actual="/reportes" titulo="Reportes" subtitulo="Rentabilidad, compras y caja, listos para imprimir" {...{ usuario, negocio, stockBajo: stock_bajo, tasaUsd: tasa_usd }}>
            <Head title="Reportes" />
            <div className="space-y-4">{REPORTES.map((r) => <Reporte key={r.id} r={r} inicio={inicio_mes} hoy={hoy} aperturas={aperturas} />)}</div>
        </AppLayout>
    );
}
