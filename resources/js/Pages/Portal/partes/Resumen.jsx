import { Link, router } from '@inertiajs/react';
import { AlertTriangle, ArrowRight, Ban, BadgeCheck, Banknote, Clock, TrendingUp } from 'lucide-react';
import { Card, Kpi, Titulo, Vacio } from '../../../Components/kit';
import { Estado } from '../../../Components/saas';
import { Plazo, PagoPendiente, bs, nombrePlan } from '../comun';

/* Lo primero que ve el operador: cuánto entra, cómo está la cartera, qué pagos esperan y a quién hay que cobrar. */

const verTiendas = (estado) => router.get('/portal', { vista: 'tiendas', ...(estado ? { estado } : {}) });

export default function Resumen({ kpis, pendientes, n_pendientes, por_vencer }) {
    const total = Math.max(1, kpis.total || 0);
    const partes = [
        { k: 'activos', t: 'Al día', c: 'bg-[#3ddc84]', n: kpis.activos }, { k: 'en_demo', t: 'En demo', c: 'bg-[#4f7cff]', n: kpis.en_demo },
        { k: 'en_mora', t: 'Pago pendiente', c: 'bg-signal', n: kpis.en_mora }, { k: 'suspendidos', t: 'Suspendidas', c: 'bg-[#ff6b61]', n: kpis.suspendidos },
    ];
    return (
        <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr_1fr]">
                <section className="relative overflow-hidden rounded-2xl p-6 text-white lg:row-span-2" style={{ background: 'linear-gradient(160deg,#171d25 0%,#0b0e12 100%)' }}>
                    <p className="flex items-center gap-2 text-[14px] text-white/70"><TrendingUp aria-hidden className="size-4 text-[#3ddc84]" />Ingreso mensual de la plataforma</p>
                    <p className="num mt-3 text-[52px] font-semibold leading-none tracking-[-0.03em]">${bs(kpis.mrr_usd)}</p>
                    <p className="mt-2 text-[13.5px] text-white/60">Suma de los planes de las {kpis.activos} tiendas que están al día.</p>
                    <div className="mt-7">
                        <div className="flex h-2.5 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${kpis.total} tiendas: ${partes.map((p) => `${p.n} ${p.t}`).join(', ')}`}>
                            {partes.map((p) => p.n > 0 && <span key={p.k} className={p.c} style={{ width: `${(p.n / total) * 100}%` }} />)}
                        </div>
                        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] text-white/70">
                            {partes.map((p) => <li key={p.k} className="flex items-center gap-2"><span aria-hidden className={`size-2 rounded-full ${p.c}`} />{p.t}<span className="num ml-auto font-semibold text-white">{p.n}</span></li>)}
                        </ul>
                    </div>
                </section>
                <Kpi icon={BadgeCheck} titulo="Al día" valor={kpis.activos} detalle="Plan activo y pagado" onClick={() => verTiendas('ACTIVO')} />
                <Kpi icon={Clock} titulo="En demo" valor={kpis.en_demo} detalle="Prueba gratis de 15 días" onClick={() => verTiendas('PRUEBA')} />
                <Kpi icon={AlertTriangle} titulo="Pago pendiente" valor={kpis.en_mora} detalle="Vencidas, dentro de la gracia" tono="warn" onClick={() => verTiendas('MORA')} />
                <Kpi icon={Ban} titulo="Suspendidas" valor={kpis.suspendidos} detalle="Sin acceso hasta que paguen" tono="danger" onClick={() => verTiendas('SUSPENDIDO')} />
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                <section>
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <h2 className="text-[16px] font-semibold">Pagos por verificar</h2>
                        <Link href="/portal?vista=pagos" className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-brand hover:underline">{n_pendientes > pendientes.length ? `Ver los ${n_pendientes}` : 'Ir a pagos'}<ArrowRight aria-hidden className="size-3.5" /></Link>
                    </div>
                    <div className="space-y-3">
                        {pendientes.map((s) => <PagoPendiente key={s.id} s={s} />)}
                        {!pendientes.length && <Card><Vacio icon={Banknote} titulo="No hay pagos esperando" texto="Cuando un cliente reporte su pago móvil o transferencia, aparecerá aquí para que lo verifiques." /></Card>}
                    </div>
                </section>
                <Card className="self-start">
                    <Titulo aside={<Link href="/portal?vista=tiendas&orden=vence" className="text-[13.5px] font-semibold text-brand hover:underline">Ver todas</Link>}>A quién cobrar esta semana</Titulo>
                    <ul className="mt-2 divide-y divide-line px-5 pb-2">
                        {por_vencer.map((t) => (
                            <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                                <div className="min-w-0"><p className="truncate text-[14.5px] font-semibold">{t.subdominio}</p><p className="text-[12.5px] text-muted">{nombrePlan(t.plan)} · <span className="num">{bs(t.precio_usd)} US$</span></p></div>
                                <div className="shrink-0 text-right"><Estado estado={t.estado} /><Plazo dias={t.dias} /></div>
                            </li>
                        ))}
                        {!por_vencer.length && <li className="py-8 text-center text-[14px] text-muted">Nadie vence en los próximos 7 días.</li>}
                    </ul>
                </Card>
            </div>
        </div>
    );
}
