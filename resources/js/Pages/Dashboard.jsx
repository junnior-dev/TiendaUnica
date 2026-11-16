import { Head, Link } from '@inertiajs/react';
import { useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BadgeCheck, CircleCheck, FileText, Percent, PiggyBank, Tag, TrendingUp } from 'lucide-react';
import AppLayout from '../Layouts/AppLayout';
import { Card, Chip, Fuente, Sparkline, Titulo } from '../Components/kit';
import { http } from '../lib/http';
import { useFiscal } from '../lib/plan';
import { COLOR, NOMBRE, SIMBOLO, bs, monto, n0, n2, pct, tasa as fTasa, usd } from '../lib/format';

const MONEDAS = ['USD', 'EUR', 'COP', 'VES'];
/* ── La tasa del día: lo primero que el cajero necesita saber ── */
function TasaCard({ t }) {
    const usdT = t.find((x) => x.par === 'USD'), eur = t.find((x) => x.par === 'EUR'), cop = t.find((x) => x.par === 'COP');
    const sube = (usdT.variacion_pct ?? 0) >= 0;
    return (
        <section className="relative min-w-0 overflow-hidden rounded-2xl p-6 text-white" style={{ background: 'radial-gradient(80% 70% at 100% 0%, #2c3744 0%, transparent 65%), linear-gradient(160deg,#0f1319,#0a0c10)' }}>
            <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-white/70">Tasa de cambio de hoy</p>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium"><BadgeCheck className="size-3.5" />{{ BCV: 'Oficial BCV', EXCHANGERATE_API: 'ExchangeRate-API', MANUAL: 'Manual' }[usdT.fuente]}</span>
            </div>
            <p className="mt-5 text-sm text-white/60">1 dólar (US$) equivale a</p>
            <p className="num mt-1 flex items-baseline gap-2 text-[48px] font-semibold leading-none tracking-[-0.03em]"><span className="text-2xl font-medium text-white/60">Bs</span>{fTasa(usdT.tasa)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                {usdT.variacion_pct != null && <span className={`inline-flex items-center gap-1 font-medium ${sube ? 'text-[#7ee2a8]' : 'text-[#ff9b94]'}`}>{sube ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}{pct(usdT.variacion_pct, true)} vs día anterior</span>}
                <span className="inline-flex items-center gap-1.5 text-white/60"><span className={`size-1.5 rounded-full ${usdT.vigente ? 'bg-[#3ddc84]' : 'bg-signal'}`} />{usdT.vigente ? 'Vigente' : 'Desactualizada'} · fecha valor {usdT.fecha.split('-').reverse().join('/')}</span>
            </div>
            <div className="mt-4"><Sparkline serie={usdT.serie} /><div className="flex justify-between text-[11px] text-white/40"><span>{usdT.serie_desde}</span><span>{usdT.serie_hasta}</span></div></div>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-sm">
                <div><dt className="text-white/55">1 euro (€) a bolívares</dt><dd className="num mt-0.5 text-lg font-semibold">Bs {fTasa(eur.tasa)}</dd></div>
                <div><dt className="text-white/55">1 dólar a pesos colombianos</dt><dd className="num mt-0.5 text-lg font-semibold">COP {n2(cop.por_dolar)}</dd></div>
            </dl>
        </section>
    );
}

function Kpi({ icon: Icon, label, valor, nota, tono }) {
    return (
        <Card className="p-5">
            <div className="flex items-center justify-between"><p className="text-sm text-muted">{label}</p><span className="grid size-8 place-items-center rounded-lg bg-paper text-muted"><Icon className="size-4" /></span></div>
            <p className="num mt-3 text-[28px] font-semibold leading-none tracking-[-0.02em]">{valor}</p>
            <p className={`mt-2 text-[13px] ${tono === 'up' ? 'font-medium text-ok' : 'text-muted'}`}>{nota}</p>
        </Card>
    );
}

/* ── Ventas de hoy por moneda ── */
function PorMoneda({ filas, hoyUsd, hoyBs }) {
    const total = filas.reduce((a, f) => a + f.equivalente_usd, 0);
    return (
        <Card>
            <Titulo aside={<span className="text-[13px] text-muted">A la tasa de cada venta</span>}>Ventas de hoy por moneda de pago</Titulo>
            <div className="px-5 pt-3">
                <p className="num text-[32px] font-semibold leading-none tracking-[-0.02em]">{usd(hoyUsd)}<span className="ml-3 text-base font-normal text-muted">= {bs(hoyBs)}</span></p>
                <p className="mt-1.5 text-[13px] text-muted">Total vendido hoy, expresado en dólares y en bolívares.</p>
                <div className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Participación de cada moneda en las ventas de hoy">
                    {filas.map((f) => <span key={f.moneda} style={{ width: `${(f.equivalente_usd / total) * 100}%`, background: COLOR[f.moneda] }} />)}
                </div>
            </div>
            <div className="overflow-x-auto px-2 pb-2 pt-3">
                <table className="w-full min-w-[560px] text-sm">
                    <thead><tr className="text-left text-[13px] text-muted">
                        <th className="px-3 py-2 font-medium">Moneda</th><th className="px-3 py-2 text-right font-medium">Cobrado en su moneda</th>
                        <th className="px-3 py-2 text-right font-medium">Tasa a Bs</th><th className="px-3 py-2 text-right font-medium">Equivale a US$</th><th className="w-20 px-3 py-2 text-right font-medium">%</th>
                    </tr></thead>
                    <tbody>
                        {filas.map((f) => (
                            <tr key={f.moneda} className="border-t border-line">
                                <td className="px-3 py-3"><div className="flex items-center gap-3"><Chip m={f.moneda} /><div><p className="font-medium">{NOMBRE[f.moneda]}</p><p className="text-xs text-muted">{f.metodos.join(' · ')}</p></div></div></td>
                                <td className="num px-3 py-3 text-right font-medium">{monto(f.moneda, f.monto)}</td>
                                <td className="num px-3 py-3 text-right text-muted">{f.moneda === 'VES' ? '—' : fTasa(f.tasa)}</td>
                                <td className="num px-3 py-3 text-right font-semibold">{usd(f.equivalente_usd)}</td>
                                <td className="num px-3 py-3 text-right text-muted">{n0((f.equivalente_usd / total) * 100)} %</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot><tr className="border-t-2 border-text/80 font-semibold">
                        <td className="px-3 py-3" colSpan={3}>Total en dólares</td><td className="num px-3 py-3 text-right">{usd(total)}</td><td className="num px-3 py-3 text-right text-muted">100 %</td>
                    </tr></tfoot>
                </table>
            </div>
        </Card>
    );
}

/* ── Ventas de la semana: barras apiladas por moneda ── */
function Semana({ dias }) {
    const [tip, setTip] = useState(null);
    const W = 560, H = 440, L = 44, B = 28, T = 16, R = 8;
    const tot = dias.map((d) => MONEDAS.reduce((a, m) => a + d[m], 0));
    // Con una semana SIN ventas, max sería 0 y la división v/max produce NaN
    // (líneas y textos SVG inválidos): el piso de 1 lo evita.
    const max = Math.ceil(Math.max(...tot, 1) / 500) * 500;
    const bw = 40, step = (W - L - R) / dias.length, y = (v) => T + (H - T - B) * (1 - v / max);
    return (
        <Card className="flex flex-col">
            <Titulo>Ventas de los últimos 7 días</Titulo>
            <p className="px-5 pt-1 text-[13px] text-muted">En dólares, separadas por la moneda con que pagó el cliente.</p>
            <div className="relative px-3 pt-3">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ventas por día y por moneda">
                    {[0, max / 2, max].map((v) => (<g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e4e8ec" /><text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#5b6672" className="num">{v ? n0(v) : '0'}</text></g>))}
                    {dias.map((d, i) => {
                        const x = L + i * step + (step - bw) / 2; let acc = 0; const hoy = i === dias.length - 1;
                        return (
                            <g key={d.fecha} onMouseEnter={() => setTip({ i, x: x + bw / 2 })} onMouseLeave={() => setTip(null)}>
                                <rect x={L + i * step} y={T} width={step} height={H - T - B} fill="transparent" />
                                {MONEDAS.map((m) => { const h0 = y(acc), h1 = y(acc + d[m]); acc += d[m]; return <rect key={m} x={x} y={h1} width={bw} height={Math.max(h0 - h1 - 2, 0)} rx="3" fill={COLOR[m]} />; })}
                                {hoy && <text x={x + bw / 2} y={y(tot[i]) - 6} textAnchor="middle" fontSize="11.5" fontWeight="600" fill="#161b21" className="num">{n0(tot[i])}</text>}
                                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="11.5" fill={hoy ? '#161b21' : '#5b6672'} fontWeight={hoy ? 600 : 400}>{hoy ? 'Hoy' : d.etiqueta}</text>
                            </g>
                        );
                    })}
                </svg>
                {tip && (
                    <div className="pointer-events-none absolute z-10 w-44 rounded-lg border border-line bg-white p-3 text-xs shadow-lg" style={{ left: `calc(${(tip.x / W) * 100}% - 88px)`, top: 4 }}>
                        <p className="mb-1.5 font-semibold">{dias[tip.i].largo}</p>
                        {MONEDAS.map((m) => (<p key={m} className="flex items-center justify-between py-0.5"><span className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: COLOR[m] }} />{NOMBRE[m]}</span><span className="num">{n2(dias[tip.i][m])}</span></p>))}
                        <p className="mt-1.5 flex justify-between border-t border-line pt-1.5 font-semibold"><span>Total US$</span><span className="num">{n2(tot[tip.i])}</span></p>
                    </div>
                )}
            </div>
            <ul className="mt-auto flex flex-wrap gap-x-5 gap-y-1.5 px-5 pb-5 pt-1 text-[13px]">
                {MONEDAS.map((m) => <li key={m} className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: COLOR[m] }} />{NOMBRE[m]}</li>)}
            </ul>
        </Card>
    );
}

/* ── Últimas ventas ── */
function Ultimas({ ventas }) {
    return (
        <Card>
            <Titulo aside={<a href="/ventas" className="text-[13px] font-medium text-brand hover:underline">Ver todas</a>}>Últimas ventas</Titulo>
            <div className="overflow-x-auto px-2 pb-2 pt-2">
                <table className="w-full min-w-[640px] text-sm">
                    <thead><tr className="text-left text-[13px] text-muted"><th className="px-3 py-2 font-medium">Factura</th><th className="px-3 py-2 font-medium">Cliente</th><th className="px-3 py-2 font-medium">Pagó con</th><th className="px-3 py-2 text-right font-medium">Total US$</th><th className="px-3 py-2 text-right font-medium">Total Bs</th></tr></thead>
                    <tbody>
                        {ventas.map((v) => (
                            <tr key={v.numero} className={`border-t border-line ${v.estado === 'ANULADA' ? 'text-muted' : ''}`}>
                                <td className="px-3 py-3"><p className="num font-medium">{v.numero}</p><p className="text-xs text-muted">{v.hora}</p></td>
                                <td className="px-3 py-3">{v.cliente}{v.estado === 'ANULADA' && <span className="ml-2 rounded-full bg-paper px-2 py-0.5 text-xs font-medium text-danger">Anulada</span>}</td>
                                <td className="px-3 py-3"><div className="flex flex-wrap gap-1.5">{v.pagos.map((p, i) => (
                                    <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-0.5 pr-2.5 text-xs"><Chip m={p.moneda} size="sm" /><span className="num">{p.moneda === 'COP' ? n0(p.monto) : n2(p.monto)}</span></span>))}</div></td>
                                <td className={`num px-3 py-3 text-right font-semibold ${v.estado === 'ANULADA' ? 'line-through' : ''}`}>{usd(v.total_usd)}</td>
                                <td className="num px-3 py-3 text-right text-muted">{bs(v.total_ves)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

function Atencion({ a, masVendidos }) {
    return (
        <div className="min-w-0 space-y-6">
            <Card>
                <Titulo aside={<span className="rounded-full bg-signal/15 px-2.5 py-0.5 text-xs font-semibold text-[#8a5a00]">{a.total_stock_bajo} por reponer</span>}>Stock bajo</Titulo>
                <ul className="px-5 pb-4 pt-2">
                    {a.stock_bajo.map((p) => (
                        <li key={p.sku} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
                            <AlertTriangle className="size-4 shrink-0 text-[#c97300]" />
                            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{p.nombre}</p><p className="text-xs text-muted">{p.sku}</p></div>
                            <p className="num text-right text-sm"><span className="font-semibold text-danger">{p.stock}</span><span className="text-muted"> / {p.minimo}</span></p>
                        </li>
                    ))}
                </ul>
                <div className="flex items-center justify-between border-t border-line bg-paper px-5 py-3 text-[13px] rounded-b-2xl">
                    <span className="flex items-center gap-2 text-muted"><Tag className="size-4" />{a.precios_pendientes} precios por confirmar</span><a href="/productos" className="font-medium text-brand hover:underline">Revisar</a>
                </div>
            </Card>
            <Card>
                <Titulo>Lo más vendido hoy</Titulo>
                <ul className="px-5 pb-4 pt-2">
                    {masVendidos.map((p, i) => (
                        <li key={p.nombre} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
                            <span className="grid size-6 place-items-center rounded-md bg-paper text-xs font-semibold text-muted">{i + 1}</span>
                            <p className="min-w-0 flex-1 truncate text-sm">{p.nombre}</p>
                            <p className="num text-right text-sm"><span className="font-semibold">{p.unidades}</span> <span className="text-muted">und</span></p>
                        </li>
                    ))}
                </ul>
            </Card>
        </div>
    );
}

const saludo = () => { const h = new Date().getHours(); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; };

/* ── Calendario fiscal: solo para contribuyentes especiales (21_calendario_fiscal.sql) ── */
const dm = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/');
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function Vencimientos({ inicial }) {
    const [lista, setLista] = useState(inicial);
    const [env, setEnv] = useState(null);
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
    const accion = async (v, quitar) => {
        setEnv(v.obligacion + v.desde);
        try { const r = await http('POST', quitar ? '/calendario-fiscal/presentada/quitar' : '/calendario-fiscal/presentada', quitar ? { obligacion: v.obligacion, desde: v.desde } : { obligacion: v.obligacion, desde: v.desde, fecha: hoy }); setLista(r.vencimientos); }
        catch { /* el aviso sigue visible: se puede reintentar */ } finally { setEnv(null); }
    };
    const periodo = (v) => (v.tipo === 'MES' ? `Mes de ${MES[Number(v.desde.slice(5, 7)) - 1]}` : v.tipo === 'ANIO' ? `Ejercicio ${v.desde.slice(0, 4)}` : `Del ${dm(v.desde).slice(0, 5)} al ${dm(v.hasta)}`);
    return (
        <Card className="mt-6">
            <Titulo aside={<Link href="/calendario-fiscal" className="text-[13px] font-semibold text-brand hover:underline">Ver calendario completo</Link>}>Tus próximas declaraciones</Titulo>
            <ul className="divide-y divide-line px-5 pb-2 pt-2">
                {lista.map((v) => {
                    const vencida = !v.presentada && v.dias < 0, pronto = !v.presentada && v.dias >= 0 && v.dias <= 3;
                    return (
                        <li key={v.obligacion + v.desde} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                            <div className="min-w-0"><p className="text-[14.5px] font-medium">{v.titulo}</p><p className="text-[13px] text-muted">{periodo(v)}</p></div>
                            <div className="flex flex-wrap items-center gap-3">
                                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${v.presentada ? 'bg-[#e7f6ee] text-ok' : vencida ? 'bg-[#fdecec] text-danger' : pronto ? 'bg-signal/20 text-[#7a4d00]' : 'bg-paper text-muted'}`}>
                                    {v.presentada ? `Presentada el ${dm(v.presentada_en)}` : vencida ? `Venció el ${dm(v.fecha)}` : v.dias === 0 ? 'Vence hoy' : `Vence el ${dm(v.fecha)} (en ${v.dias} ${v.dias === 1 ? 'día' : 'días'})`}
                                </span>
                                <button onClick={() => accion(v, v.presentada)} disabled={env === v.obligacion + v.desde} className="text-[13px] font-semibold text-brand hover:underline disabled:opacity-50">{v.presentada ? 'Quitar marca' : 'Ya la presenté'}</button>
                            </div>
                        </li>
                    );
                })}
            </ul>
            <p className="border-t border-line px-5 py-3 text-[12.5px] leading-snug text-muted">Fechas cargadas en tu calendario fiscal según tu régimen y el último dígito de tu RIF. No descuentan feriados: confírmalas en el portal del SENIAT. El sistema no presenta la declaración por ti.</p>
        </Card>
    );
}

export default function Dashboard({ negocio, usuario, fecha_larga, tasas, kpis, por_moneda, semana, ultimas, alertas, mas_vendidos, vencimientos = [] }) {
    const usdT = tasas.find((t) => t.par === 'USD');
    const fiscal = useFiscal();
    const dif = kpis.ayer_usd > 0 ? ((kpis.ventas_usd - kpis.ayer_usd) / kpis.ayer_usd) * 100 : 0;
    return (
        <AppLayout actual="/dashboard" titulo="Panel" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={usdT.tasa} stockBajo={alertas.total_stock_bajo} alertas={alertas.total_stock_bajo + alertas.precios_pendientes}>
            <Head title="Panel" />
            <div className="mb-6">
                <h2 className="text-[26px] font-semibold tracking-[-0.02em]">{saludo()}, {usuario.nombre.split(' ')[0]}</h2>
                <p className="mt-1 text-[15px] text-muted">Así va el día: lo que se ha vendido, en qué monedas te pagaron y qué necesita tu atención.</p>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <TasaCard t={tasas} />
                <div className="grid min-w-0 gap-6 sm:grid-cols-2 sm:grid-rows-2">
                    <Kpi icon={TrendingUp} label="Ventas de hoy" valor={usd(kpis.ventas_usd)} nota={kpis.ayer_usd > 0 ? `${pct(dif, true)} frente a ayer` : 'Ayer no hubo ventas con qué comparar'} tono={dif > 0 ? 'up' : ''} />
                    <Kpi icon={FileText} label="Facturas emitidas" valor={n0(kpis.cantidad)} nota={kpis.cantidad ? `Promedio ${usd(kpis.ventas_usd / kpis.cantidad)} por factura` : 'Aún no hay facturas hoy'} />
                    <Kpi icon={PiggyBank} label="Utilidad del día" valor={usd(kpis.utilidad_usd)} nota={`${pct(kpis.margen_pct)} de margen sobre la venta`} />
                    {fiscal
                        ? <Kpi icon={Percent} label="IGTF cobrado hoy" valor={usd(kpis.igtf_usd)} nota="Solo pagos en divisas" />
                        : <Kpi icon={AlertTriangle} label="Por reponer" valor={n0(alertas.total_stock_bajo)} nota={alertas.total_stock_bajo ? 'Productos bajo su mínimo' : 'Todo tu inventario está surtido'} tono={alertas.total_stock_bajo ? 'warn' : ''} />}
                </div>
            </div>

            {fiscal && vencimientos.length > 0 && <Vencimientos inicial={vencimientos} />}

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
                <PorMoneda filas={por_moneda} hoyUsd={kpis.ventas_usd} hoyBs={kpis.ventas_ves} />
                <Semana dias={semana} />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
                <Ultimas ventas={ultimas} />
                <Atencion a={alertas} masVendidos={mas_vendidos} />
            </div>
        </AppLayout>
    );
}
