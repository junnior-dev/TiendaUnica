import { Head, useForm } from '@inertiajs/react';
import { useState } from 'react';
import { ArrowRight, Check, Copy, Landmark } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card } from '../../Components/kit';
import { Field } from '../../Components/ui';
import { Aviso, Dias, ESTADOS, Estado, bs, fecha } from '../../Components/saas';

/* Panel de suscripción de la tienda: el dueño ve su demo o plan, los días que
   le quedan, cómo pagar (pago móvil o transferencia, Bs o USD) y qué pasó con
   cada pago que reportó. Los datos vienen del portal vía SuscripcionController. */

const PLANES = {
    SISTEMA: { nombre: 'Sistema', precio: 60, sub: 'Ventas, caja, inventario, compras y encargos.' },
    ESPECIAL: { nombre: 'Contribuyente especial', precio: 80, sub: 'Todo lo anterior más libros fiscales, retenciones, calendario y contabilidad.' },
};

/* Dato que se copia al portapapeles con un toque: número de cuenta, monto, correo. */
function Copiable({ valor, etiqueta, children }) {
    const [ok, setOk] = useState(false);
    const copiar = () => {
        navigator.clipboard?.writeText(valor);
        setOk(true); setTimeout(() => setOk(false), 1800);
    };
    return (
        <button type="button" onClick={copiar} aria-label={`Copiar ${etiqueta}`}
            className="group inline-flex max-w-full items-center gap-2 rounded-md py-0.5 pr-1.5 text-left hover:bg-brand-50">
            <span className="num min-w-0 break-all !whitespace-normal font-semibold">{children}</span>
            <span className={`inline-flex shrink-0 items-center gap-1 text-[12px] font-medium ${ok ? 'text-ok' : 'text-brand'}`} aria-live="polite">
                {ok ? <><Check className="size-3.5" /> Copiado</> : <Copy className="size-3.5" />}
            </span>
        </button>
    );
}

const Paso = ({ n, titulo, children }) => (
    <div className="flex items-start gap-3">
        <span aria-hidden className="num mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-ink text-[13px] font-semibold text-white">{n}</span>
        <div className="min-w-0 flex-1"><h3 className="text-[17px] font-semibold leading-7">{titulo}</h3>{children}</div>
    </div>
);

export default function Suscripcion({ usuario, negocio, actual, tienda, suscripcion, plan, cobros, solicitudes, tasa, cuentas, instrucciones }) {
    const { data, setData, post, processing, errors, recentlySuccessful } = useForm({
        plan: tienda?.plan === 'ESPECIAL' ? 'ESPECIAL' : 'SISTEMA',
        moneda: 'BS', banco_origen: '', referencia: '', pagado_el: new Date().toISOString().slice(0, 10), nota: '',
    });
    const estado = suscripcion?.estado;
    const esDemo = estado === 'PRUEBA';
    const elegido = PLANES[data.plan];
    const montoBs = tasa ? elegido.precio * tasa : null;
    const total = esDemo ? 15 : 30;
    const restan = suscripcion?.dias_restantes;
    const usados = restan == null ? 0 : Math.min(Math.max(total - restan, 0), total);
    const cuentasVisibles = (cuentas || []).filter((c) => (data.moneda === 'USD' ? c.moneda === 'USD' : c.moneda === 'BS'));

    return (
        <AppLayout actual={actual} titulo="Suscripción" subtitulo="Tu plan, tus pagos y los días que te quedan" usuario={usuario} negocio={negocio} tasaUsd={tasa} ancho>
            <Head title="Suscripción" />

            {/* Dónde estoy: plan, estado y los días como hoja de control */}
            <Card className="p-5 sm:p-6">
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-center">
                    <div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <h2 className="text-[24px] font-semibold tracking-[-0.02em]">{plan?.nombre || 'Sin plan'}</h2>
                            {plan?.nombre !== ESTADOS[estado]?.t && <Estado estado={estado} />}
                        </div>
                        <p className="mt-1.5 text-[14.5px] text-muted">
                            {plan?.precio > 0
                                ? <><span className="num font-semibold text-text">{plan.precio} US$</span> al mes. Pagas por pago móvil o transferencia.</>
                                : 'La demo no se cobra. Cuando te guste, elige tu plan más abajo.'}
                        </p>
                    </div>
                    {suscripcion?.vence_el && (
                        <div>
                            <p className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 text-[14px]">
                                <span className="text-muted">{esDemo ? 'Tu demo termina el' : estado === 'ACTIVO' ? 'Tu plan cubre hasta el' : 'Tu plan cubría hasta el'} <b className="num font-semibold text-text">{fecha(suscripcion.vence_el)}</b></span>
                                <span className={`num font-semibold ${restan < 0 ? 'text-danger' : 'text-text'}`}>{restan >= 0 ? `Quedan ${restan} ${restan === 1 ? 'día' : 'días'}` : `Venció hace ${Math.abs(restan)} ${Math.abs(restan) === 1 ? 'día' : 'días'}`}</span>
                            </p>
                            <Dias total={total} usados={restan < 0 ? total : usados} />
                        </div>
                    )}
                </div>
                {esDemo && <Aviso tipo="info" className="mt-5">Tienes <b>15 días con todo abierto</b>, incluida la parte fiscal, para probar con tus propios repuestos. Nada se cobra hasta que reportes un pago.</Aviso>}
                {estado === 'MORA' && <Aviso tipo="aviso" className="mt-5">Tu pago está pendiente. Tienes <b>3 días de gracia</b> antes de que la tienda se pause; cuando verifiquemos tu pago, todo vuelve al momento.</Aviso>}
                {estado === 'SUSPENDIDO' && <Aviso tipo="error" className="mt-5">La tienda está pausada por falta de pago. Tus datos están intactos: reporta tu pago abajo y la reactivamos al verificarlo.</Aviso>}
            </Card>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                {/* 1 y 2: elegir plan y pagar */}
                <Card className="p-5 sm:p-6">
                    <Paso n={1} titulo="Elige tu plan">
                        <div role="radiogroup" aria-label="Plan mensual" className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
                            {Object.entries(PLANES).map(([k, v]) => {
                                const on = data.plan === k;
                                return (
                                    <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setData('plan', k)}
                                        className={`flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors ${on ? 'bg-brand-50/60' : 'bg-white hover:bg-paper'}`}>
                                        <span aria-hidden className={`grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] ${on ? 'border-brand bg-brand' : 'border-[#b3bbc4]'}`}>
                                            {on && <span className="size-2 rounded-full bg-white" />}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-[15px] font-semibold">{v.nombre}</span>
                                            <span className="block text-[13px] leading-snug text-muted">{v.sub}</span>
                                        </span>
                                        <span className="num shrink-0 text-[18px] font-semibold">{v.precio} US$<span className="block text-right text-[12px] font-normal text-muted">al mes</span></span>
                                    </button>
                                );
                            })}
                        </div>
                    </Paso>

                    <div className="mt-8">
                        <Paso n={2} titulo="Paga a una de estas cuentas">
                            <p className="mt-0.5 text-[14px] text-muted">Pago móvil o transferencia, en bolívares o dólares. Toca un dato para copiarlo.</p>
                            <div role="group" aria-label="Moneda del pago" className="mt-3 inline-grid grid-cols-2 gap-1 rounded-lg bg-[#e9ecf0] p-1">
                                {[['BS', 'Bolívares'], ['USD', 'Dólares']].map(([v, l]) => (
                                    <button key={v} type="button" aria-pressed={data.moneda === v} onClick={() => setData('moneda', v)}
                                        className={`h-9 rounded-md px-5 text-[14px] font-medium transition-all ${data.moneda === v ? 'bg-white text-text shadow-sm' : 'text-muted hover:text-text'}`}>{l}</button>
                                ))}
                            </div>

                            {data.moneda === 'BS' && (
                                <div className="mt-4 rounded-xl bg-ink px-4 py-3.5 text-white">
                                    {montoBs ? (<>
                                        <p className="text-[13px] text-white/65">Monto a pagar hoy, a la tasa del día (Bs {bs(tasa)} por US$)</p>
                                        <p className="mt-0.5 text-[22px] font-semibold [&_*]:text-white [&_button:hover]:bg-white/10">
                                            <Copiable valor={bs(montoBs)} etiqueta="el monto en bolívares">Bs {bs(montoBs)}</Copiable>
                                        </p>
                                    </>) : <p className="text-[13.5px] text-white/80">Aún no publicamos la tasa de hoy. Espera a que aparezca o paga en dólares.</p>}
                                </div>
                            )}
                            {data.moneda === 'USD' && (
                                <div className="mt-4 rounded-xl bg-ink px-4 py-3.5 text-white">
                                    <p className="text-[13px] text-white/65">Monto a pagar</p>
                                    <p className="num mt-0.5 text-[22px] font-semibold">{elegido.precio} US$</p>
                                </div>
                            )}

                            <ul className="mt-4 space-y-3">
                                {cuentasVisibles.map((c) => (
                                    <li key={c.id} className="rounded-xl border border-line p-4 text-[14px]">
                                        <p className="flex items-center gap-2 font-semibold"><Landmark aria-hidden className="size-4 text-muted" />{c.banco}</p>
                                        <dl className="mt-2 space-y-1">
                                            <div className="flex flex-wrap items-center gap-x-3"><dt className="w-24 text-muted">{c.tipo_cuenta}</dt><dd className="min-w-0"><Copiable valor={c.numero} etiqueta={c.tipo_cuenta}>{c.numero}</Copiable></dd></div>
                                            <div className="flex flex-wrap items-center gap-x-3"><dt className="w-24 text-muted">Titular</dt><dd>{c.titular}</dd></div>
                                            <div className="flex flex-wrap items-center gap-x-3"><dt className="w-24 text-muted">RIF</dt><dd className="num">{c.rif_titular}</dd></div>
                                        </dl>
                                    </li>
                                ))}
                                {!cuentasVisibles.length && <li className="rounded-xl border border-dashed border-line p-4 text-[14px] text-muted">Todavía no hay cuentas en {data.moneda === 'USD' ? 'dólares' : 'bolívares'}. Cambia de moneda arriba para ver las disponibles.</li>}
                            </ul>
                            {instrucciones && <p className="mt-3 text-[13.5px] leading-relaxed text-muted">{instrucciones}</p>}
                        </Paso>
                    </div>
                </Card>

                {/* 3: reportar el pago */}
                <form onSubmit={(e) => { e.preventDefault(); post('/suscripcion/pagos'); }} className="min-w-0 self-start rounded-2xl border border-line bg-white p-5 sm:p-6 lg:sticky lg:top-24" noValidate>
                    <Paso n={3} titulo="Reporta tu pago">
                        <p className="mt-0.5 text-[14px] text-muted">Con la referencia que te dio el banco. Lo verificamos contra el estado de cuenta, normalmente el mismo día.</p>
                    </Paso>
                    {errors.general && <Aviso tipo="error" className="mt-4">{errors.general}</Aviso>}
                    {recentlySuccessful && <Aviso tipo="ok" className="mt-4">Pago reportado. Lo revisamos y activamos tu plan.</Aviso>}
                    <div className="mt-5 grid gap-5">
                        <Field label="Banco donde pagaste" value={data.banco_origen} onChange={(e) => setData('banco_origen', e.target.value)} error={errors.banco_origen} placeholder="Ej: Banco de Venezuela" />
                        <Field label="Referencia o serial" value={data.referencia} onChange={(e) => setData('referencia', e.target.value)} error={errors.referencia} hint="Está en el comprobante del banco." inputMode="numeric" className="[&_input]:num" />
                        <Field label="Fecha del pago" type="date" forceFloat value={data.pagado_el} onChange={(e) => setData('pagado_el', e.target.value)} error={errors.pagado_el} />
                        <label className="block">
                            <span className="mb-1.5 block text-[13.5px] font-medium text-muted">Nota (opcional)</span>
                            <textarea value={data.nota} onChange={(e) => setData('nota', e.target.value)} rows={2} placeholder="Algo que nos ayude a encontrar tu pago"
                                className="w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-[15px] hover:border-[#b9c1ca] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                        </label>
                        <button type="submit" disabled={processing}
                            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand text-[15px] font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60">
                            {processing ? 'Enviando…' : 'Reportar mi pago'} <ArrowRight className="size-4" />
                        </button>
                    </div>
                </form>
            </div>

            {/* Historial */}
            <Card className="mt-6">
                <div className="grid divide-y divide-line lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                    <div className="min-w-0 p-5 sm:p-6">
                        <h3 className="text-[17px] font-semibold">Pagos que reportaste</h3>
                        <p className="mt-1 text-[13.5px] text-muted">Cada pago lo revisa una persona, para que nadie pague dos veces ni se pause una tienda por error.</p>
                        {!solicitudes?.length && <p className="mt-4 text-[14px] text-muted">Aún no reportas pagos. Cuando lo hagas, lo verás aquí.</p>}
                        <div className={`mt-4 overflow-x-auto ${solicitudes?.length ? '' : 'hidden'}`}>
                            <table className="w-full min-w-[420px] text-[13.5px]">
                                <thead><tr className="border-b border-line text-left text-muted">
                                    <th className="pb-2 pr-3 font-medium">Fecha</th><th className="pb-2 pr-3 font-medium">Referencia</th>
                                    <th className="pb-2 pr-3 text-right font-medium">Monto</th><th className="pb-2 pl-3 font-medium">Estado</th>
                                </tr></thead>
                                <tbody className="divide-y divide-line">
                                    {solicitudes?.map((s) => (
                                        <tr key={s.id} className="align-top">
                                            <td className="num py-2.5 pr-3">{fecha(s.pagado_el)}</td>
                                            <td className="num py-2.5 pr-3">{s.referencia}</td>
                                            <td className="num py-2.5 pr-3 text-right">{s.moneda === 'BS' ? `Bs ${bs(s.monto_bs)}` : `${bs(s.monto_usd)} US$`}</td>
                                            <td className="py-2.5 pl-3">
                                                <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold ${s.estado === 'VERIFICADO' ? 'bg-ok/10 text-ok' : s.estado === 'RECHAZADO' ? 'bg-danger/10 text-danger' : 'bg-signal/15 text-[#7a5600]'}`}>
                                                    {s.estado === 'VERIFICADO' ? 'Verificado' : s.estado === 'RECHAZADO' ? 'Rechazado' : 'En revisión'}
                                                </span>
                                                {s.estado === 'RECHAZADO' && s.rechazo_motivo && <p className="mt-1 max-w-[220px] text-[12.5px] leading-snug text-muted">{s.rechazo_motivo}</p>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div className="min-w-0 p-5 sm:p-6">
                        <h3 className="text-[17px] font-semibold">Meses pagados</h3>
                        <p className="mt-1 text-[13.5px] text-muted">Cada mes verificado queda aquí con su monto y la fecha en que lo confirmamos.</p>
                        {!cobros?.length && <p className="mt-4 text-[14px] text-muted">Todavía no hay meses pagados.</p>}
                        <div className={`mt-4 overflow-x-auto ${cobros?.length ? '' : 'hidden'}`}>
                            <table className="w-full min-w-[380px] text-[13.5px]">
                                <thead><tr className="border-b border-line text-left text-muted">
                                    <th className="pb-2 pr-3 font-medium">Mes pagado</th><th className="pb-2 pr-3 text-right font-medium">Monto</th>
                                    <th className="pb-2 pl-3 font-medium">Método</th><th className="pb-2 font-medium">Confirmado</th>
                                </tr></thead>
                                <tbody className="divide-y divide-line">
                                    {cobros?.map((c) => (
                                        <tr key={c.id}>
                                            <td className="num py-2.5 pr-3">{fecha(c.periodo)}</td>
                                            <td className="num py-2.5 pr-3 text-right">{bs(c.monto)} US$</td>
                                            <td className="py-2.5 pl-3 text-muted">{c.metodo || '—'}</td>
                                            <td className="num py-2.5">{fecha(c.pagado_el)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </Card>

            <p className="mt-5 text-[13px] text-muted">Cada pago se verifica a mano, hay 3 días de gracia antes de cualquier pausa y tus datos nunca se borran.</p>
        </AppLayout>
    );
}
