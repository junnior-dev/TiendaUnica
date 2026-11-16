import { useState } from 'react';
import { Banknote, Check, ReceiptText, SearchX, X } from 'lucide-react';
import { Card, Vacio } from '../../../Components/kit';
import Paginador from '../../../Components/Paginador';
import { Buscador, Cabeza, Chip, PagoPendiente, bs, fecha, ir, useRetraso } from '../comun';

/* Pagos: la cola por verificar, el historial de lo resuelto y los cobros registrados. */

const SEGS = [['pendientes', 'Por verificar'], ['historial', 'Historial'], ['cobros', 'Cobros registrados']];

function Resultado({ estado, motivo }) {
    return estado === 'VERIFICADO'
        ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-ok/10 px-2.5 py-0.5 text-[12.5px] font-semibold text-ok ring-1 ring-inset ring-ok/25"><Check aria-hidden className="size-3" strokeWidth={3} />Verificado</span>
        : <span><span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-danger/10 px-2.5 py-0.5 text-[12.5px] font-semibold text-danger ring-1 ring-inset ring-danger/25"><X aria-hidden className="size-3" strokeWidth={3} />Rechazado</span>{motivo && <span className="mt-1 block max-w-[28ch] text-[12.5px] text-muted">{motivo}</span>}</span>;
}

export default function Pagos({ seg, filtros, pendientes, filas, meta, suma }) {
    const [texto, setTexto] = useState(filtros.q || '');
    const base = { vista: 'pagos', seg, q: texto, resultado: filtros.resultado, por: filtros.por };
    const nav = (c) => ir(base, c);
    useRetraso(texto, () => nav({ q: texto }));
    const cambiarSeg = (s) => { setTexto(''); ir({ vista: 'pagos', seg: s, por: filtros.por }); };

    return (
        <div className="space-y-4">
            <div role="tablist" aria-label="Qué pagos ver" className="flex gap-1 border-b border-line">
                {SEGS.map(([k, t]) => (
                    <button key={k} role="tab" aria-selected={seg === k} onClick={() => cambiarSeg(k)}
                        className={`relative -mb-px inline-flex h-11 items-center gap-2 border-b-2 px-4 text-[14.5px] font-medium transition-colors ${seg === k ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-text'}`}>
                        {t}{k === 'pendientes' && pendientes.length > 0 && <span className="num rounded-full bg-signal/20 px-2 text-[12px] font-semibold text-[#8a5a00]">{pendientes.length}</span>}
                    </button>
                ))}
            </div>

            {seg === 'pendientes' && (
                <div className="space-y-3">
                    <p className="max-w-[70ch] text-[14px] text-muted">Compara cada reporte con tu estado de cuenta y aprueba o rechaza. El cliente ve el resultado al instante.</p>
                    {pendientes.map((s) => <PagoPendiente key={s.id} s={s} />)}
                    {!pendientes.length && <Card><Vacio icon={Banknote} titulo="Todo al día" texto="No hay pagos esperando. Cuando un cliente reporte su pago móvil o transferencia, aparecerá aquí." /></Card>}
                </div>
            )}

            {seg !== 'pendientes' && (
                <>
                    <Card className="flex flex-wrap items-center gap-3 p-4">
                        <Buscador valor={texto} set={setTexto} etiqueta="Buscar pagos" placeholder={seg === 'historial' ? 'Buscar por tienda, referencia o banco' : 'Buscar por tienda, método o nota'} />
                        {seg === 'historial' && (
                            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por resultado">
                                <Chip activo={!filtros.resultado} onClick={() => nav({ resultado: '' })}>Todos</Chip>
                                <Chip activo={filtros.resultado === 'VERIFICADO'} onClick={() => nav({ resultado: 'VERIFICADO' })}>Verificados</Chip>
                                <Chip activo={filtros.resultado === 'RECHAZADO'} onClick={() => nav({ resultado: 'RECHAZADO' })}>Rechazados</Chip>
                            </div>
                        )}
                        {seg === 'cobros' && <p className="ml-auto text-[14px] text-muted">Total de esta lista <b className="num text-[17px] font-semibold text-text">{bs(suma)} US$</b></p>}
                    </Card>
                    <Card className="overflow-hidden">
                        {filas.length ? (
                            <div className="overflow-x-auto">
                                {seg === 'historial' ? (
                                    <table className="w-full min-w-[820px] text-[14px]">
                                        <thead className="border-b border-line bg-paper/60"><tr><Cabeza>Tienda</Cabeza><Cabeza derecha>Monto</Cabeza><Cabeza>Banco y referencia</Cabeza><Cabeza>Pagado el</Cabeza><Cabeza>Resultado</Cabeza><Cabeza>Resuelto el</Cabeza></tr></thead>
                                        <tbody className="divide-y divide-line">
                                            {filas.map((p) => (
                                                <tr key={p.id} className="hover:bg-paper/50">
                                                    <td className="px-4 py-3 font-semibold">{p.subdominio}</td>
                                                    <td className="num px-4 py-3 text-right">{p.moneda === 'BS' ? <>Bs {bs(p.monto_bs)}<span className="block text-[12.5px] text-muted">≈ {bs(p.monto_usd)} US$</span></> : <>{bs(p.monto_usd)} US$</>}</td>
                                                    <td className="px-4 py-3">{p.banco_origen}<span className="num block text-[12.5px] text-muted">{p.referencia}</span></td>
                                                    <td className="num px-4 py-3">{fecha(p.pagado_el)}</td>
                                                    <td className="px-4 py-3"><Resultado estado={p.estado} motivo={p.rechazo_motivo} /></td>
                                                    <td className="num px-4 py-3 text-muted">{fecha(p.verificado_en)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <table className="w-full min-w-[640px] text-[14px]">
                                        <thead className="border-b border-line bg-paper/60"><tr><Cabeza>Tienda</Cabeza><Cabeza>Mes pagado</Cabeza><Cabeza derecha>Monto</Cabeza><Cabeza>Método</Cabeza><Cabeza>Nota</Cabeza></tr></thead>
                                        <tbody className="divide-y divide-line">
                                            {filas.map((c) => (
                                                <tr key={c.id} className="hover:bg-paper/50">
                                                    <td className="px-4 py-3 font-semibold">{c.subdominio}</td>
                                                    <td className="num px-4 py-3">{fecha(c.periodo)}</td>
                                                    <td className="num px-4 py-3 text-right">{bs(c.monto)} {c.moneda || 'US$'}</td>
                                                    <td className="px-4 py-3 text-muted">{c.metodo || '—'}</td>
                                                    <td className="px-4 py-3 text-muted">{c.nota || ''}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        ) : texto || filtros.resultado
                            ? <Vacio icon={SearchX} titulo="Sin resultados" texto="Ningún pago coincide con la búsqueda. Prueba con otra palabra o quita el filtro." />
                            : <Vacio icon={ReceiptText} titulo={seg === 'historial' ? 'Todavía no hay pagos resueltos' : 'Todavía no hay cobros registrados'} texto="Aparecerán aquí cuando verifiques el primer pago de un cliente." />}
                        <Paginador meta={meta} mostrados={filas.length} ir={nav} />
                    </Card>
                </>
            )}
        </div>
    );
}
