import { useEffect, useState } from 'react';
import { Banknote } from 'lucide-react';
import { Ventana } from '../Caja/Turno';
import { http } from '../../lib/http';
import { n2 } from '../../lib/format';
import { CobroModal, Vence } from './Index';

const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const EDAD = [['al_dia', 'Al día'], ['d1_30', '1 a 30 días'], ['d31_60', '31 a 60 días'], ['d61_mas', 'Más de 60']];

/* Estado de cuenta de un cliente: saldo, antigüedad de la deuda, cuentas y cobros. Se abre desde la ficha del cliente. */
export default function EstadoCuentaCliente({ clienteId, cerrar }) {
    const [d, setD] = useState(null); const [err, setErr] = useState(''); const [cobro, setCobro] = useState(null);
    const cargar = () => http('GET', `/cuentas-por-cobrar/cliente/${clienteId}`).then(setD).catch((e) => setErr(e.message));
    useEffect(() => { cargar(); }, [clienteId]);
    return (
        <>
            <Ventana titulo="Estado de cuenta" subtitulo={d ? `${d.cliente.nombre} · ${d.cliente.documento}` : 'Cargando…'} cerrar={cerrar} ancho="max-w-[820px]">
                {err && <p className="text-[14px] text-danger">{err}</p>}
                {d && (
                    <div>
                        <div className="rounded-xl bg-paper p-4"><p className="text-[13px] text-muted">Te debe</p><p className="num text-[30px] font-bold leading-tight tracking-[-0.02em]">$ {n2(d.saldo_usd)}</p><p className="num text-[13.5px] text-muted">Bs {n2(d.saldo_ves)} a la tasa de cada venta</p></div>
                        {d.saldo_usd > 0 && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{EDAD.map(([k, t]) => <div key={k} className="rounded-xl border border-line px-3 py-2.5"><p className="text-[12.5px] text-muted">{t}</p><p className={`num text-[16px] font-semibold ${k === 'd61_mas' && d.antiguedad[k] > 0 ? 'text-danger' : ''}`}>$ {n2(d.antiguedad[k])}</p></div>)}</div>}
                        <h3 className="mb-1.5 mt-5 text-[13px] font-semibold">Cuentas</h3>
                        {d.cuentas.length === 0 ? <p className="text-[13.5px] text-muted">Este cliente nunca ha comprado a crédito.</p> : (
                            <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full min-w-[560px] text-[13.5px]"><thead><tr className="bg-paper text-left text-[12px] text-muted"><th className="px-3 py-2 font-medium">Venta</th><th className="px-3 py-2 text-right font-medium">Original</th><th className="px-3 py-2 text-right font-medium">Saldo USD</th><th className="px-3 py-2 font-medium">Vence</th><th className="px-3 py-2 font-medium">Estado</th><th /></tr></thead>
                                <tbody>{d.cuentas.map((c) => <tr key={c.id} className="border-t border-line"><td className="num px-3 py-2">N.º {String(c.venta ?? '').padStart(6, '0')}<span className="block text-[12px] text-muted">{dmy(c.fecha_venta)}</span></td><td className="num px-3 py-2 text-right">{n2(c.original_usd)}</td><td className="num px-3 py-2 text-right font-semibold">{n2(c.saldo_usd)}</td><td className="px-3 py-2"><Vence c={c} /></td><td className="px-3 py-2 capitalize">{c.estado.toLowerCase()}</td>
                                    <td className="px-3 py-2 text-right">{c.estado === 'PENDIENTE' && <button type="button" onClick={() => setCobro(c)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-2.5 text-[13px] font-semibold text-white hover:bg-brand-600"><Banknote className="size-3.5" />Cobrar</button>}</td></tr>)}</tbody></table></div>
                        )}
                        {d.pagos.length > 0 && (<><h3 className="mb-1.5 mt-5 text-[13px] font-semibold">Últimos cobros</h3>
                            <ul className="space-y-1">{d.pagos.slice(0, 12).map((p) => <li key={p.id} className="flex items-baseline justify-between gap-3 text-[13.5px]"><span className="num text-muted">{dmy(p.fecha)}</span><span className={`num ${p.estado === 'ANULADO' ? 'text-muted line-through' : 'font-medium'}`}>{p.moneda} {n2(p.monto)} · US$ {n2(p.monto_usd)}</span></li>)}</ul></>)}
                    </div>
                )}
            </Ventana>
            {cobro && d && <CobroModal cuenta={cobro} metodos={d.metodos} hoy={d.hoy} cajaAbierta={d.caja_abierta} cerrar={() => setCobro(null)} listo={() => { setCobro(null); cargar(); }} />}
        </>
    );
}
