import { useEffect, useState } from 'react';
import { Banknote, Building2, FileDown, Landmark, Plus, X } from 'lucide-react';
import { Modal } from '../../Components/kit';
import { Field, Segmented } from '../../Components/ui';
import { dmy, dolares } from '../../Components/expediente';
import { n2 } from '../../lib/format';
import { http } from '../../lib/http';
import { situacion } from '../../lib/pdfProveedores';

const TONO = {
    vencida: 'bg-[#fdecec] text-danger', por_vencer: 'bg-[#fff4d6] text-[#8a5a00]', al_dia: 'bg-paper text-muted',
    pagada: 'bg-[#e3f5ea] text-ok', contado: 'bg-[#e3f5ea] text-ok', anulada: 'bg-paper text-muted line-through',
};

export function EstadoCuenta({ cuenta, cerrar, onPagar, onPdf, onAnular, generando, puedePagar }) {
    useEffect(() => { const k = (e) => e.key === 'Escape' && cerrar(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
    const { proveedor: p, filas, totales: t, antiguedad: a, pagos } = cuenta;
    const tramos = [['Por vencer', a.por_vencer], ['1 a 30 días', a.d1_30], ['31 a 60 días', a.d31_60], ['61 a 90 días', a.d61_90], ['Más de 90', a.d90_mas]];
    const vivos = pagos.filter((x) => x.estado === 'ACTIVO');
    return (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label="Estado de cuenta">
            <div className="fixed inset-0 bg-black/50" onClick={cerrar} />
            <div className="relative my-auto w-full max-w-[860px] rounded-2xl bg-white shadow-2xl">
                <div className="flex items-start justify-between gap-3 border-b border-line p-5 sm:p-6">
                    <div><h2 className="text-lg font-semibold tracking-[-0.01em]">Estado de cuenta</h2><p className="mt-1 text-[13px] text-muted">{p.nombre} · <span className="num">{p.rif}</span> · al {dmy(cuenta.hoy)}</p></div>
                    <button type="button" onClick={cerrar} aria-label="Cerrar" className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-paper"><X className="size-4" /></button>
                </div>
                <div className="space-y-6 p-5 sm:p-6">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div><p className="text-[13px] text-muted">Le debes</p><p className={`num text-[30px] font-semibold leading-tight tracking-[-0.02em] ${t.saldo > 0 ? '' : 'text-ok'}`}>{dolares(t.saldo)}</p>
                            <p className="text-[13px] text-muted">{t.saldo > 0 ? `De ${dolares(t.facturado)} facturados, has pagado ${dolares(t.pagado)}.` : 'No tienes deuda pendiente con este proveedor.'}</p></div>
                        <div className="flex flex-wrap gap-2">
                            <button onClick={onPdf} disabled={generando} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper disabled:opacity-60"><FileDown className="size-4" />{generando ? 'Preparando…' : 'Descargar PDF'}</button>
                            {puedePagar && <button onClick={onPagar} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-[14px] font-semibold text-white hover:bg-brand-600"><Plus className="size-4" />Registrar pago</button>}
                        </div>
                    </div>

                    <div>
                        <h3 className="mb-2 text-[14px] font-semibold">Antigüedad del saldo</h3>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                            {tramos.map(([l, v], i) => (
                                <div key={l} className={`rounded-xl border p-3 ${v > 0 && i > 0 ? 'border-[#f0b4af] bg-[#fdf3f2]' : 'border-line'}`}>
                                    <p className="text-[12.5px] text-muted">{l}</p><p className="num mt-0.5 text-[15px] font-semibold">{n2(v)}</p>
                                </div>))}
                        </div>
                    </div>

                    <div>
                        <h3 className="mb-2 text-[14px] font-semibold">Facturas</h3>
                        {filas.length === 0 ? <p className="rounded-xl border border-line p-4 text-[14px] text-muted">Este proveedor no tiene facturas registradas.</p> : (
                            <div className="overflow-x-auto rounded-xl border border-line">
                                <table className="w-full min-w-[620px] text-[14px]">
                                    <thead><tr className="border-b border-line bg-paper text-left text-[12.5px] text-muted"><th className="px-3 py-2 font-medium">Factura</th><th className="px-3 py-2 font-medium">Fecha</th><th className="px-3 py-2 text-right font-medium">Total</th><th className="px-3 py-2 text-right font-medium">Saldo</th><th className="px-3 py-2 font-medium">Situación</th></tr></thead>
                                    <tbody className="divide-y divide-line">
                                        {filas.map((f) => (
                                            <tr key={f.id}>
                                                <td className="num px-3 py-2.5 font-medium">{f.factura}</td>
                                                <td className="px-3 py-2.5 text-muted">{dmy(f.fecha)}</td>
                                                <td className="num px-3 py-2.5 text-right">{n2(f.total_usd)}</td>
                                                <td className="num px-3 py-2.5 text-right font-semibold">{f.situacion === 'anulada' ? '—' : n2(f.saldo_usd)}</td>
                                                <td className="px-3 py-2.5"><span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${TONO[f.situacion]}`}>{situacion(f)}</span></td>
                                            </tr>))}
                                    </tbody>
                                </table>
                            </div>)}
                        <p className="mt-2 text-[12.5px] text-muted">Las facturas de contado se dan por pagadas. Solo las compras registradas a crédito generan deuda.</p>
                    </div>

                    {vivos.length > 0 && (
                        <div>
                            <h3 className="mb-2 text-[14px] font-semibold">Pagos registrados</h3>
                            <ul className="divide-y divide-line rounded-xl border border-line">
                                {vivos.slice(0, 8).map((x) => (
                                    <li key={x.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[14px]">
                                        <div className="min-w-0 flex-1"><p className="font-medium">{dmy(x.fecha)} · <span className="num">{x.moneda} {n2(x.monto)}</span>{x.moneda !== 'USD' && <span className="text-muted"> (US$ {n2(x.monto_usd)})</span>}</p>
                                            <p className="truncate text-[13px] text-muted">{x.fondos === 'BANCOS' ? 'Desde bancos' : 'Desde caja'}{x.referencia && ` · Ref. ${x.referencia}`}{x.aplicado && ` · ${x.aplicado}`}</p></div>
                                        <button onClick={() => onAnular(x)} className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-danger hover:bg-[#fdecec]">Anular</button>
                                    </li>))}
                            </ul>
                        </div>)}
                </div>
            </div>
        </div>
    );
}

export function PagoModal({ proveedor, cuenta, cerrar, listo }) {
    const monedas = cuenta.monedas?.length ? cuenta.monedas : [{ codigo: 'USD', nombre: 'Dólar' }];
    const [f, setF] = useState({ fecha: cuenta.hoy, moneda: monedas[0].codigo, monto: '', referencia: '', fondos: 'BANCOS', compra_id: '' });
    const [cot, setCot] = useState(null);
    const [err, setErr] = useState({});
    const [enviando, setEnviando] = useState(false);
    const num = Number(String(f.monto).replace(',', '.'));
    useEffect(() => {
        setCot(null);
        if (!(num > 0)) return;
        const t = setTimeout(async () => {
            try { setCot(await http('GET', `/proveedores/pagos/cotizar?moneda=${f.moneda}&fecha=${f.fecha}&monto=${num}`)); } catch (e) { setCot({ error: e.message }); }
        }, 250);
        return () => clearTimeout(t);
    }, [f.moneda, f.fecha, num]);
    const factura = cuenta.pendientes.find((x) => String(x.id) === String(f.compra_id));
    const tope = factura ? factura.saldo_usd : cuenta.totales.saldo;
    const enviar = async () => {
        const er = {};
        if (!(num > 0)) er.monto = 'Escribe cuánto vas a pagar.';
        if (!f.fecha) er.fecha = 'Elige la fecha del pago.';
        if (cot?.ok && cot.monto_usd > tope + 0.005) er.monto = `Es más de lo que le debes (US$ ${n2(tope)}).`;
        setErr(er); if (Object.keys(er).length) return;
        setEnviando(true);
        try { listo(await http('POST', `/proveedores/${proveedor.id}/pagos`, { ...f, monto: num, compra_id: f.compra_id || null })); }
        catch (e) { setErr({ general: Object.values(e.errors || {})[0]?.[0] || e.message }); } finally { setEnviando(false); }
    };
    return (
        <Modal titulo="Registrar pago a proveedor" subtitulo={`${proveedor.nombre} · le debes ${dolares(cuenta.totales.saldo)}`} cerrar={cerrar} onSubmit={enviar} enviando={enviando} ok="Registrar pago" ancho="max-w-[520px]">
            {err.general && <p role="alert" className="rounded-lg bg-[#fdecec] p-3 text-[14px] text-danger">{err.general}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Fecha del pago" type="date" value={f.fecha} max={cuenta.hoy} onChange={(e) => setF({ ...f, fecha: e.target.value })} error={err.fecha} forceFloat />
                <Field select label="Moneda" value={f.moneda} onChange={(e) => setF({ ...f, moneda: e.target.value })}>{monedas.map((m) => <option key={m.codigo} value={m.codigo}>{m.codigo} · {m.nombre}</option>)}</Field>
            </div>
            <Field label="Monto" icon={Banknote} value={f.monto} inputMode="decimal" autoFocus onChange={(e) => setF({ ...f, monto: e.target.value.replace(/[^\d.,]/g, '') })} error={err.monto}
                hint={cot?.ok ? `Equivale a US$ ${n2(cot.monto_usd)} · Bs ${n2(cot.monto_ves)} (tasa del ${dmy(f.fecha)})` : cot?.error || (num > 0 ? 'Calculando equivalente…' : 'En la moneda que elegiste.')} />
            <Field label="Referencia (opcional)" icon={Landmark} value={f.referencia} onChange={(e) => setF({ ...f, referencia: e.target.value })} hint="Número de transferencia, cheque o recibo." />
            <div>
                <p className="mb-1.5 text-[13px] font-medium text-muted">¿De dónde salió el dinero?</p>
                <Segmented compact name="Origen de los fondos" value={f.fondos} onChange={(v) => setF({ ...f, fondos: v })} options={[{ value: 'BANCOS', label: 'Bancos' }, { value: 'CAJA', label: 'Caja' }]} />
            </div>
            {cuenta.pendientes.length > 0 && (
                <Field select icon={Building2} label="Aplicar a" value={f.compra_id} onChange={(e) => setF({ ...f, compra_id: e.target.value })} forceFloat hint="Si no eliges, se aplica a la factura más antigua.">
                    <option value="">La más antigua primero</option>
                    {cuenta.pendientes.map((x) => <option key={x.id} value={x.id}>Factura {x.factura} · debes US$ {n2(x.saldo_usd)}</option>)}
                </Field>)}
            <p className="rounded-lg bg-paper p-3 text-[13px] leading-snug text-muted">El pago baja la deuda de este proveedor. Si llevas la contabilidad automática, también genera el asiento (Debe cuentas por pagar, Haber caja o bancos).</p>
        </Modal>
    );
}
