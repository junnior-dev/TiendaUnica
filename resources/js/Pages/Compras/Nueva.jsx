import { Head } from '@inertiajs/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CircleAlert, Landmark, PackagePlus, Plus, Search, Trash2, Truck, X } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Modal, Vacio } from '../../Components/kit';
import { Button, Choice, Field, Segmented } from '../../Components/ui';
import { http } from '../../lib/http';
import { n0, n2 } from '../../lib/format';
import { normalizarRif, validarRif } from '../../lib/rif';

/* ───────── utilidades ───────── */
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const num = (s) => { const t = String(s ?? '').trim(); if (!t) return NaN; return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); };
const bs = (v) => `Bs ${n2(v)}`;
const usd = (v) => `$ ${n2(v)}`;
const money = (m, v) => (m === 'VES' ? bs(v) : usd(v));
const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const pctTxt = (a, b) => (a > 0 ? `${b >= a ? '+' : '−'}${n2(Math.abs(((b - a) / a) * 100))} %` : '');
const claveLinea = (() => { let n = 0; return () => `l${++n}`; })();

export default function NuevaCompra(p) {
    const { negocio, usuario, stock_bajo, tasa_usd, hoy, especial, credito_fiscal, metodo_costo, politica_costo, alicuotas_iva, proveedores_frecuentes, cxp } = p;
    const [proveedor, setProveedor] = useState(null);
    const [factura, setFactura] = useState(''); const [control, setControl] = useState(''); const [fecha, setFecha] = useState(hoy);
    const [moneda, setMoneda] = useState('USD'); const [credito, setCredito] = useState(!!credito_fiscal); const [obs, setObs] = useState('');
    const [condicion, setCondicion] = useState('CONTADO'); const [dias, setDias] = useState('30');
    const [lineas, setLineas] = useState([]);
    const [tasa, setTasa] = useState({ estado: 'na' }); const [dup, setDup] = useState(null); const [sim, setSim] = useState({});
    const [modalProv, setModalProv] = useState(false); const [enviando, setEnviando] = useState(false); const [errorGen, setErrorGen] = useState(''); const [listo, setListo] = useState(null);
    const [intento, setIntento] = useState(false);
    const refQty = useRef({});

    /* IVA vigente para la fecha de la factura (igual que la base de datos). */
    const ivaPct = useMemo(() => { const a = alicuotas_iva.find((x) => x.desde <= fecha && (!x.hasta || x.hasta >= fecha)) || alicuotas_iva[alicuotas_iva.length - 1]; return a ? a.pct : 0; }, [fecha, alicuotas_iva]);

    /* Tasa de la fecha, solo si la factura es en bolívares. */
    useEffect(() => {
        if (moneda !== 'VES') { setTasa({ estado: 'na' }); return undefined; }
        if (!fecha) { setTasa({ estado: 'error', mensaje: 'Elige la fecha de la factura.' }); return undefined; }
        setTasa({ estado: 'carga' }); let vivo = true;
        const t = setTimeout(async () => { try { const r = await http('GET', `/compras/tasa?fecha=${fecha}`); if (vivo) setTasa(r.ok ? { estado: 'ok', tasa: r.tasa, fecha: r.fecha } : { estado: 'error', mensaje: r.mensaje }); } catch (e) { if (vivo) setTasa({ estado: 'error', mensaje: e.message }); } }, 250);
        return () => { vivo = false; clearTimeout(t); };
    }, [moneda, fecha]);

    /* ¿Ya registraste esa factura de ese proveedor? */
    useEffect(() => {
        setDup(null);
        if (!proveedor || !factura.trim()) return undefined; let vivo = true;
        const t = setTimeout(async () => { try { const r = await http('GET', `/compras/duplicada?proveedor=${proveedor.id}&factura=${encodeURIComponent(factura.trim())}`); if (vivo) setDup(r.existe ? r : null); } catch { /* sin aviso */ } }, 350);
        return () => { vivo = false; clearTimeout(t); };
    }, [proveedor, factura]);

    /* Cálculo de cada línea (mismo redondeo que la base de datos). Con presentación: lo tecleado son CAJAS y las piezas salen × factor. */
    const calc = lineas.map((l) => {
        const bruto = num(l.cantidad);
        const pres = l.modo === 'cajas' && l.pres > 1 ? l.pres : 1;
        const cant = Number.isNaN(bruto) ? NaN : Math.round(bruto * pres * 1000) / 1000;
        const costo = num(l.costo);
        const valida = cant > 0 && costo >= 0 && Number.isFinite(costo) && l.costo !== '';
        const base = valida ? r2(cant * costo) : 0;
        const iva = valida && !l.exento ? r2((base * ivaPct) / 100) : 0;
        return { cant, costo, valida, base, iva };
    });
    const sumBase = r2(calc.reduce((s, c, i) => s + (lineas[i].exento ? 0 : c.base), 0));
    const sumExento = r2(calc.reduce((s, c, i) => s + (lineas[i].exento ? c.base : 0), 0));
    const sumIva = r2(calc.reduce((s, c) => s + c.iva, 0));
    const total = r2(sumBase + sumExento + sumIva);
    const tasaUsar = moneda === 'USD' ? 1 : tasa.estado === 'ok' ? tasa.tasa : null;
    const totalUsd = tasaUsar ? r2(total / tasaUsar) : null;
    const unidades = calc.reduce((s, c) => s + (c.cant > 0 ? c.cant : 0), 0);

    /* Vista previa de costos y precios (no guarda nada). */
    const clavesim = JSON.stringify([moneda, fecha, credito, tasaUsar, lineas.map((l, i) => [l.id, calc[i].valida ? calc[i].cant : 0, calc[i].valida ? calc[i].costo : 0, l.exento])]);
    useEffect(() => {
        const validas = lineas.map((l, i) => ({ l, c: calc[i] })).filter((x) => x.c.valida);
        if (!validas.length || (moneda === 'VES' && !tasaUsar)) { setSim({}); return undefined; } let vivo = true;
        const t = setTimeout(async () => {
            try { const r = await http('POST', '/compras/simular', { moneda, fecha, credito_fiscal: credito, items: validas.map(({ l, c }) => ({ producto_id: l.id, cantidad: c.cant, costo_unitario: c.costo, exento: l.exento })) }); if (vivo) setSim(r.ok ? r.productos : {}); } catch { if (vivo) setSim({}); }
        }, 450);
        return () => { vivo = false; clearTimeout(t); };
    }, [clavesim]);

    const cambios = lineas.filter((l) => { const s = sim[l.id]; return s && Math.abs(s.precio_sugerido_usd - s.precio_actual_usd) > 0.004; }).length;

    const agregar = useCallback((pr) => {
        setLineas((ls) => {
            const ya = ls.find((l) => l.id === pr.id);
            if (ya) { setTimeout(() => refQty.current[ya.key]?.focus(), 30); return ls; }
            const key = claveLinea(); setTimeout(() => refQty.current[key]?.focus(), 60);
            return [...ls, { key, id: pr.id, sku: pr.sku, nombre: pr.nombre, marca: pr.marca, stock: pr.stock, unidad: pr.unidad, pres: pr.piezas_por_presentacion || 1, unidad_compra: pr.unidad_compra || null, modo: pr.unidad_compra ? 'cajas' : 'piezas', costo_usd: pr.costo_usd, exento: pr.exento, cantidad: '', costo: '' }];
        });
    }, []);
    const cambiar = (key, c) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...c } : l)));
    const quitar = (key) => setLineas((ls) => ls.filter((l) => l.key !== key));

    /* Qué falta para poder guardar. */
    const faltan = [];
    if (!proveedor) faltan.push('elegir el proveedor');
    if (!factura.trim()) faltan.push('escribir el N.º de factura');
    if (!fecha) faltan.push('elegir la fecha');
    if (moneda === 'VES' && tasa.estado !== 'ok') faltan.push('tener la tasa de esa fecha');
    if (!lineas.length) faltan.push('agregar productos');
    else if (calc.some((c) => !c.valida)) faltan.push('completar cantidad y costo de cada producto');
    if (dup) faltan.push('revisar la factura repetida');

    const elegirProveedor = (pv) => {
        setProveedor(pv);
        if (cxp && pv && pv.dias_credito > 0) { setCondicion('CREDITO'); setDias(String(pv.dias_credito)); }
    };
    const diasN = Math.max(0, Math.min(365, parseInt(dias, 10) || 0));
    const vence = useMemo(() => { if (!fecha) return null; const d = new Date(`${fecha}T00:00:00`); d.setDate(d.getDate() + diasN); return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' }); }, [fecha, diasN]);

    const guardar = async () => {
        setIntento(true); setErrorGen('');
        if (faltan.length) return;
        setEnviando(true);
        try {
            const r = await http('POST', '/compras', { proveedor_id: proveedor.id, numero_factura: factura.trim(), numero_control: control.trim() || null, fecha_factura: fecha, moneda, credito_fiscal: credito, observaciones: obs.trim() || null, ...(cxp ? { condicion, dias_credito: condicion === 'CREDITO' ? diasN : 0 } : {}),
                items: lineas.map((l, i) => ({ producto_id: l.id, cantidad: calc[i].cant, costo_unitario: calc[i].costo, exento: l.exento })) });
            setListo(r.resumen);
        } catch (e) { setErrorGen(e.message); } finally { setEnviando(false); }
    };
    const reiniciar = () => { setListo(null); setProveedor(null); setCondicion('CONTADO'); setFactura(''); setControl(''); setObs(''); setLineas([]); setSim({}); setIntento(false); setErrorGen(''); setCredito(!!credito_fiscal); setFecha(hoy); window.scrollTo(0, 0); };

    return (
        <AppLayout actual="/compras" titulo="Nueva compra" subtitulo="Registra la factura de un proveedor" {...{ usuario, negocio, stockBajo: stock_bajo, tasaUsd: tasa_usd }}>
            <Head title="Nueva compra" />
            <a href="/compras" className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-muted hover:text-text"><ArrowLeft className="size-4" />Volver a Compras</a>

            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0 space-y-6">
                    {/* 1 · Datos de la factura */}
                    <Card className="p-6">
                        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Datos de la factura</h2>
                        <p className="mt-0.5 text-[14px] text-muted">Cópialos tal como aparecen en la factura que te dio el proveedor.</p>

                        <div className="mt-5"><ProveedorPicker valor={proveedor} onChange={elegirProveedor} frecuentes={proveedores_frecuentes} nuevo={() => setModalProv(true)} error={intento && !proveedor} /></div>

                        <div className="mt-5 grid gap-4 md:grid-cols-3">
                            <Field label="N.º de factura" value={factura} onChange={(e) => setFactura(e.target.value)} error={intento && !factura.trim() ? 'Escribe el número de la factura.' : ''} />
                            <Field label="N.º de control (opcional)" value={control} onChange={(e) => setControl(e.target.value)} />
                            <Field label="Fecha de la factura" type="date" forceFloat max={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} />
                        </div>
                        {dup && (
                            <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-[#fff8e6] px-3.5 py-2.5 text-[13.5px] text-[#6f4b00]"><AlertTriangle className="mt-0.5 size-4 shrink-0" />
                                <span>Ya registraste la factura {factura.trim()} de este proveedor el {dmy(dup.fecha)}{dup.estado === 'ANULADA' ? ' (está anulada)' : ''}. <a href={`/compras?ver=${dup.id}`} className="font-semibold underline underline-offset-2">Verla</a></span></p>
                        )}

                        {cxp && (
                            <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,320px)_1fr] md:items-start">
                                <div>
                                    <p className="mb-2 text-[14px] font-medium">¿Cómo se la vas a pagar?</p>
                                    <Segmented compact name="Condición de pago" value={condicion} onChange={setCondicion} options={[{ value: 'CONTADO', label: 'De contado' }, { value: 'CREDITO', label: 'A crédito' }]} />
                                </div>
                                <div className="min-h-[48px] md:pt-[30px]">
                                    {condicion === 'CONTADO'
                                        ? <p className="text-[13.5px] text-muted">Ya la pagaste: no queda deuda con el proveedor.</p>
                                        : <div className="flex flex-wrap items-center gap-3 text-[13.5px] text-muted"><label className="flex items-center gap-2">Plazo <input value={dias} onChange={(e) => setDias(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" aria-label="Días de crédito" className="num h-10 w-20 rounded-lg border border-line px-3 text-center text-[15px] text-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" /> días</label>
                                            <span>Vence el <b className="num font-semibold text-text">{vence}</b>. La verás en el estado de cuenta del proveedor.</span></div>}
                                </div>
                            </div>)}

                        <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,320px)_1fr] md:items-start">
                            <div>
                                <p className="mb-2 text-[14px] font-medium">¿En qué moneda está la factura?</p>
                                <Segmented compact name="Moneda de la factura" value={moneda} onChange={setMoneda} options={[{ value: 'USD', label: 'Dólares ($)' }, { value: 'VES', label: 'Bolívares (Bs)' }]} />
                            </div>
                            <div className="min-h-[48px] md:pt-[30px]">
                                {moneda === 'VES' && tasa.estado === 'carga' && <p className="text-[13.5px] text-muted">Buscando la tasa de esa fecha…</p>}
                                {moneda === 'VES' && tasa.estado === 'ok' && <p className="text-[13.5px] leading-snug text-muted">Se convertirá a dólares con la tasa del <b className="font-semibold text-text">{dmy(tasa.fecha)}</b>: <b className="num font-semibold text-text">Bs {n2(tasa.tasa)}</b> por dólar.</p>}
                                {moneda === 'VES' && tasa.estado === 'error' && <p role="alert" className="flex items-start gap-2 text-[13.5px] leading-snug text-danger"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{tasa.mensaje} <a href="/tasas" className="font-semibold underline underline-offset-2">Cargar tasa</a></span></p>}
                                {moneda === 'USD' && <p className="text-[13.5px] text-muted">Los costos se escriben en dólares, sin IVA.</p>}
                            </div>
                        </div>

                        <div className="mt-5 space-y-3">
                            <Choice checked={credito} onChange={setCredito} title="El IVA de esta factura es crédito fiscal">
                                {credito ? 'Se descuenta del IVA que cobras a tus clientes y no encarece el costo de tus productos.' : 'No lo vas a descontar: el IVA se suma al costo de cada producto.'}
                            </Choice>
                            <Field label="Nota (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
                        </div>
                    </Card>

                    {/* 2 · Productos */}
                    <Card className="p-6">
                        <div className="flex flex-wrap items-end justify-between gap-2">
                            <div><h2 className="text-[17px] font-semibold tracking-[-0.01em]">Productos de la factura</h2><p className="mt-0.5 text-[14px] text-muted">Busca cada producto y escribe cuántos llegaron y lo que costó cada uno, <b className="font-semibold">sin IVA</b>.</p></div>
                        </div>
                        <BuscadorProductos agregar={agregar} />

                        {lineas.length === 0 ? (
                            <div className={`mt-4 rounded-xl border border-dashed ${intento ? 'border-danger' : 'border-line'}`}><Vacio icon={PackagePlus} titulo="Aún no has agregado productos" texto="Escribe el nombre, el código o la referencia en el buscador de arriba. Si usas lector, escanea el código de barras." /></div>
                        ) : (
                            <div className="mt-4">
                                <div className="hidden grid-cols-[minmax(0,1fr)_96px_132px_76px_116px_36px] gap-3 px-1 pb-2 text-[12.5px] font-medium text-muted lg:grid"><span>Producto</span><span className="text-right">Cantidad</span><span className="text-right">Costo unitario</span><span className="text-center">IVA</span><span className="text-right">Subtotal</span><span /></div>
                                <ul className="divide-y divide-line rounded-xl border border-line">
                                    {lineas.map((l, i) => {
                                        const c = calc[i]; const s = sim[l.id]; const falta = intento && !c.valida;
                                        const alto = s && s.costo_actual_usd > 0 && Math.abs(s.costo_nuevo_usd - s.costo_actual_usd) / s.costo_actual_usd > 0.25;
                                        return (
                                            <li key={l.key} className="grid items-start gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_84px_120px_68px_104px_32px] lg:px-4">
                                                <div className="min-w-0">
                                                    <p className="text-[14.5px] font-medium leading-snug">{l.nombre}</p>
                                                    <p className="num text-[12.5px] text-muted">{l.sku} · Hay {n0(l.stock)}{l.unidad_compra ? ` · se compra en ${l.unidad_compra} × ${n0(l.pres)}` : ''}</p>
                                                    {s && c.valida && <p className={`num mt-1 text-[12.5px] ${alto ? 'font-medium text-[#8a5d00]' : 'text-muted'}`}>{alto && <AlertTriangle className="-mt-0.5 mr-1 inline size-3.5" />}Costo {usd(s.costo_actual_usd)} → <b className="font-semibold text-text">{usd(s.costo_nuevo_usd)}</b> {pctTxt(s.costo_actual_usd, s.costo_nuevo_usd)}</p>}
                                                </div>
                                                <label className="block"><span className="mb-1 block text-[12px] text-muted lg:sr-only">{l.modo === 'cajas' ? `Cant. (${l.unidad_compra})` : 'Cantidad'}</span>
                                                    <input ref={(el) => { refQty.current[l.key] = el; }} inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(l.key, { cantidad: e.target.value })} aria-label={`Cantidad de ${l.nombre}`} placeholder="0"
                                                        className={`num h-11 w-full rounded-lg border bg-white px-3 text-right text-[15px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand ${falta && !(c.cant > 0) ? 'border-danger' : 'border-line'}`} />
                                                    {l.pres > 1 && (
                                                        <button type="button" onClick={() => cambiar(l.key, { modo: l.modo === 'cajas' ? 'piezas' : 'cajas', cantidad: '' })}
                                                            className="num mt-1 block w-full text-center text-[11px] font-semibold text-brand hover:underline" title="Cambiar entre teclear cajas o piezas">
                                                            {l.modo === 'cajas' ? `${c.cant > 0 ? `${n0(c.cant)} piezas` : `${n0(l.pres)} piezas c/u`}` : `${n0(l.pres)} pza c/u`}
                                                        </button>
                                                    )}
                                                </label>
                                                <label className="block"><span className="mb-1 block text-[12px] text-muted lg:sr-only">Costo unitario</span>
                                                    <span className="relative block"><span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">{moneda === 'VES' ? 'Bs' : '$'}</span>
                                                        <input inputMode="decimal" value={l.costo} onChange={(e) => cambiar(l.key, { costo: e.target.value })} aria-label={`Costo unitario de ${l.nombre}`} placeholder="0,00"
                                                            className={`num h-11 w-full rounded-lg border bg-white pl-8 pr-3 text-right text-[15px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand ${falta && !(num(l.costo) >= 0 && l.costo !== '') ? 'border-danger' : 'border-line'}`} /></span></label>
                                                <div className="flex lg:justify-center lg:pt-1.5"><button type="button" onClick={() => cambiar(l.key, { exento: !l.exento })} aria-pressed={l.exento} title={l.exento ? 'Este producto no paga IVA. Toca para cobrarlo' : 'Toca si este producto no paga IVA'}
                                                    className={`h-8 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold transition-colors ${l.exento ? 'bg-brand-50 text-brand' : 'bg-paper text-muted hover:text-text'}`}>{l.exento ? 'Exento' : `${n0(ivaPct)} %`}</button></div>
                                                <p className="num text-right text-[15px] font-semibold lg:pt-2.5">{c.valida ? money(moneda, c.base) : '—'}</p>
                                                <button type="button" onClick={() => quitar(l.key)} aria-label={`Quitar ${l.nombre}`} className="grid size-9 place-items-center justify-self-end rounded-lg text-muted hover:bg-[#fdecec] hover:text-danger lg:mt-1"><Trash2 className="size-4" /></button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}
                    </Card>
                </div>

                {/* 3 · Resumen */}
                <aside className="xl:sticky xl:top-[88px]">
                    <Card className="p-6">
                        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Resumen</h2>
                        {proveedor && <p className="mt-1 truncate text-[13.5px] text-muted">{proveedor.nombre}{factura.trim() ? ` · ${factura.trim()}` : ''}</p>}
                        <dl className="mt-4">
                            <Fila a="Productos" b={`${lineas.length} · ${n0(unidades)} unidades`} />
                            {sumBase > 0 && <Fila a="Base imponible" b={money(moneda, sumBase)} />}
                            {sumExento > 0 && <Fila a="Exento" b={money(moneda, sumExento)} />}
                            <Fila a={`IVA ${n0(ivaPct)} %`} b={money(moneda, sumIva)} />
                            <div className="mt-2 border-t border-line pt-3"><Fila a="Total de la factura" b={money(moneda, total)} fuerte /></div>
                            {moneda === 'VES' && <p className="num mt-1 text-right text-[12.5px] text-muted">{totalUsd != null ? `${usd(totalUsd)} · tasa Bs ${n2(tasaUsar)}` : 'Falta la tasa para convertir a dólares'}</p>}
                        </dl>

                        <div className="mt-5 rounded-xl bg-paper px-4 py-3.5">
                            <p className="text-[13.5px] font-semibold">Al registrar la compra</p>
                            <ul className="mt-2 space-y-1.5 text-[13.5px] leading-snug">
                                <Punto>{lineas.length ? `El inventario sube ${n0(unidades)} unidades en ${lineas.length} ${lineas.length === 1 ? 'producto' : 'productos'}.` : 'El inventario sube con lo que agregues.'}</Punto>
                                <Punto>{metodo_costo === 'PROMEDIO' ? 'El costo de cada producto se promedia con el que ya tienes.' : 'El costo de cada producto pasa a ser el de esta factura.'}</Punto>
                                <Punto>{credito ? 'El IVA se anota como crédito fiscal.' : 'El IVA se suma al costo de los productos.'}</Punto>
                                <Punto>{politica_costo === 'AUTOMATICO' ? (cambios ? `El precio de venta de ${cambios} ${cambios === 1 ? 'producto se recalcula' : 'productos se recalculan'} solo.` : 'Los precios de venta no necesitan cambios.')
                                    : politica_costo === 'AVISAR' ? (cambios ? `${cambios} ${cambios === 1 ? 'producto quedará' : 'productos quedarán'} con un aviso para revisar su precio.` : 'Por ahora ningún precio necesita revisión.') : 'Los precios de venta no se modifican.'}</Punto>
                            </ul>
                        </div>

                        {errorGen && <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-[#fdecec] px-3.5 py-2.5 text-[13.5px] text-danger"><CircleAlert className="mt-0.5 size-4 shrink-0" />{errorGen}</p>}
                        {intento && faltan.length > 0 && <p role="alert" className="mt-4 text-[13.5px] leading-snug text-[#8a5d00]">Para registrar la compra falta: {faltan.join(', ')}.</p>}
                        <Button type="button" className="mt-5 h-12 w-full text-[16px]" onClick={guardar} disabled={enviando}>{enviando ? 'Registrando…' : 'Registrar compra'}</Button>
                        {!intento && faltan.length > 0 && <p className="mt-2.5 text-center text-[12.5px] text-muted">Aún falta: {faltan.join(', ')}.</p>}
                    </Card>
                </aside>
            </div>

            {modalProv && <ModalProveedor cerrar={() => setModalProv(false)} creado={(pv) => { setProveedor(pv); setModalProv(false); }} />}
            {listo && <Listo r={listo} reiniciar={reiniciar} />}
        </AppLayout>
    );
}

const Fila = ({ a, b, fuerte }) => <div className={`flex items-baseline justify-between gap-3 py-1 ${fuerte ? 'text-[16px] font-semibold' : 'text-[14px]'}`}><dt className={fuerte ? '' : 'text-muted'}>{a}</dt><dd className="num text-right">{b}</dd></div>;
const Punto = ({ children }) => <li className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-ok" /><span>{children}</span></li>;

/* ───────── Proveedor ───────── */
function ProveedorPicker({ valor, onChange, frecuentes, nuevo, error }) {
    const [q, setQ] = useState(''); const [res, setRes] = useState([]); const [abierto, setAbierto] = useState(false); const caja = useRef(null);
    useEffect(() => {
        if (!q.trim()) { setRes([]); return undefined; } let vivo = true;
        const t = setTimeout(async () => { try { const r = await http('GET', `/compras/proveedores?q=${encodeURIComponent(q.trim())}`); if (vivo) setRes(r); } catch { if (vivo) setRes([]); } }, 220);
        return () => { vivo = false; clearTimeout(t); };
    }, [q]);
    useEffect(() => { const f = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
    const elegir = (pv) => { onChange(pv); setQ(''); setAbierto(false); };

    if (valor) {
        return (
            <div>
                <p className="mb-2 text-[14px] font-medium">Proveedor</p>
                <div className="flex items-center gap-3 rounded-xl border border-line bg-paper/60 px-4 py-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand"><Truck className="size-5" /></span>
                    <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-semibold">{valor.nombre}</p><p className="num text-[13px] text-muted">{valor.rif}{valor.telefono ? ` · ${valor.telefono}` : ''}</p></div>
                    <button type="button" onClick={() => onChange(null)} className="shrink-0 rounded-lg px-3 py-2 text-[14px] font-semibold text-brand hover:bg-brand-50">Cambiar</button>
                </div>
            </div>
        );
    }
    return (
        <div ref={caja}>
            <p className="mb-2 text-[14px] font-medium">Proveedor</p>
            <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)} role="combobox" aria-expanded={abierto && !!q.trim()} aria-label="Buscar proveedor" placeholder="Busca por nombre o RIF"
                    className={`h-12 w-full rounded-lg border bg-white pl-11 pr-3 text-[15px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand ${error ? 'border-danger' : 'border-line hover:border-[#b9c1ca]'}`} />
                {abierto && q.trim() && (
                    <ul className="absolute z-20 mt-1.5 max-h-72 w-full overflow-auto rounded-xl border border-line bg-white p-1.5 shadow-xl">
                        {res.map((pv) => <li key={pv.id}><button type="button" onClick={() => elegir(pv)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-paper"><span className="min-w-0"><span className="block truncate text-[14.5px] font-medium">{pv.nombre}</span><span className="num block text-[12.5px] text-muted">{pv.rif}</span></span>{pv.compras > 0 && <span className="shrink-0 text-[12.5px] text-muted">{pv.compras} {pv.compras === 1 ? 'compra' : 'compras'}</span>}</button></li>)}
                        {res.length === 0 && <li className="px-3 py-2.5 text-[14px] text-muted">No encontramos ese proveedor.</li>}
                        <li className="mt-1 border-t border-line pt-1"><button type="button" onClick={() => { setAbierto(false); nuevo(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[14px] font-semibold text-brand hover:bg-brand-50"><Plus className="size-4" />Registrar un proveedor nuevo</button></li>
                    </ul>
                )}
            </div>
            {error && <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-danger"><CircleAlert className="size-3.5" />Elige el proveedor de la factura.</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
                {frecuentes.length > 0 && <span className="text-[13px] text-muted">Frecuentes:</span>}
                {frecuentes.slice(0, 4).map((pv) => <button key={pv.id} type="button" onClick={() => elegir(pv)} className="max-w-[240px] truncate rounded-full border border-line px-3.5 py-1.5 text-[13.5px] font-medium hover:border-brand hover:bg-brand-50">{pv.nombre}</button>)}
                <button type="button" onClick={nuevo} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13.5px] font-semibold text-brand hover:bg-brand-50"><Plus className="size-3.5" />Proveedor nuevo</button>
            </div>
        </div>
    );
}

function ModalProveedor({ cerrar, creado }) {
    const [v, setV] = useState({ rif: '', razon_social: '', telefono: '', correo: '', direccion: '' }); const [err, setErr] = useState({}); const [env, setEnv] = useState(false);
    const set = (k, x) => { setV((s) => ({ ...s, [k]: x })); setErr((e) => ({ ...e, [k]: undefined, general: undefined })); };
    const enviar = async () => {
        const e = {}; const r = validarRif(v.rif); if (r) e.rif = r; if (v.razon_social.trim().length < 2) e.razon_social = 'Escribe el nombre o razón social.'; if (v.correo && !/^\S+@\S+\.\S+$/.test(v.correo)) e.correo = 'Ese correo no parece válido.';
        if (Object.keys(e).length) return setErr(e);
        setEnv(true);
        try { creado(await http('POST', '/compras/proveedores', { ...v, rif: normalizarRif(v.rif) })); } catch (x) { setErr(Object.keys(x.errors || {}).length ? Object.fromEntries(Object.entries(x.errors).map(([k, m]) => [k, m[0]])) : { general: x.message }); } finally { setEnv(false); }
    };
    return (
        <Modal titulo="Nuevo proveedor" subtitulo="Solo lo básico. Podrás completar el resto después." cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Guardar proveedor" ancho="max-w-[520px]">
            <Field label="RIF" value={v.rif} onChange={(e) => set('rif', e.target.value.toUpperCase())} onBlur={() => v.rif && set('rif', normalizarRif(v.rif))} error={err.rif} hint="Ejemplo: J-12345678-4" autoFocus />
            <Field label="Nombre o razón social" value={v.razon_social} onChange={(e) => set('razon_social', e.target.value)} error={err.razon_social} />
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Teléfono (opcional)" inputMode="tel" value={v.telefono} onChange={(e) => set('telefono', e.target.value)} /><Field label="Correo (opcional)" type="email" value={v.correo} onChange={(e) => set('correo', e.target.value)} error={err.correo} /></div>
            {err.general && <p role="alert" className="flex items-start gap-1.5 text-[13px] text-danger"><CircleAlert className="mt-px size-3.5 shrink-0" />{err.general}</p>}
        </Modal>
    );
}

/* ───────── Buscador de productos ───────── */
function BuscadorProductos({ agregar }) {
    const [q, setQ] = useState(''); const [res, setRes] = useState([]); const [cargando, setCargando] = useState(false); const [sel, setSel] = useState(0); const [abierto, setAbierto] = useState(false); const caja = useRef(null);
    useEffect(() => {
        if (!q.trim()) { setRes([]); setCargando(false); return undefined; } let vivo = true; setCargando(true);
        const t = setTimeout(async () => { try { const r = await http('GET', `/compras/productos?q=${encodeURIComponent(q.trim())}`); if (vivo) { setRes(r); setSel(0); setCargando(false); if (r.length === 1 && r[0].exacto) { agregar(r[0]); setQ(''); setRes([]); } } } catch { if (vivo) { setRes([]); setCargando(false); } } }, 220);
        return () => { vivo = false; clearTimeout(t); };
    }, [q]);
    useEffect(() => { const f = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
    const elegir = (pr) => { agregar(pr); setQ(''); setRes([]); setAbierto(false); };
    const tecla = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(res.length - 1, s + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
        else if (e.key === 'Enter') { e.preventDefault(); if (res[sel]) elegir(res[sel]); } else if (e.key === 'Escape') setAbierto(false);
    };
    return (
        <div ref={caja} className="relative mt-4">
            <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)} onKeyDown={tecla} role="combobox" aria-expanded={abierto && res.length > 0} aria-label="Buscar producto" placeholder="Busca por nombre, código, referencia o marca"
                className="h-12 w-full rounded-lg border border-line bg-white pl-11 pr-10 text-[15px] hover:border-[#b9c1ca] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
            {q && <button type="button" onClick={() => { setQ(''); setRes([]); }} aria-label="Borrar búsqueda" className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-paper"><X className="size-4" /></button>}
            {abierto && q.trim() && !cargando && (
                <ul className="absolute z-20 mt-1.5 max-h-80 w-full overflow-auto rounded-xl border border-line bg-white p-1.5 shadow-xl" role="listbox">
                    {res.map((pr, i) => (
                        <li key={pr.id} role="option" aria-selected={i === sel}>
                            <button type="button" onMouseEnter={() => setSel(i)} onClick={() => elegir(pr)} className={`flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left ${i === sel ? 'bg-brand-50' : 'hover:bg-paper'}`}>
                                <span className="min-w-0"><span className="block truncate text-[14.5px] font-medium">{pr.nombre}</span><span className="num block text-[12.5px] text-muted">{pr.sku}{pr.marca ? ` · ${pr.marca}` : ''}</span></span>
                                <span className="num shrink-0 text-right text-[12.5px] text-muted">Hay {n0(pr.stock)}<span className="block">Costo {usd(pr.costo_usd)}</span></span>
                            </button>
                        </li>
                    ))}
                    {res.length === 0 && <li className="px-3 py-3 text-[14px] text-muted">No encontramos productos con «{q.trim()}». Revisa que esté creado en <a href="/productos" className="font-semibold text-brand underline underline-offset-2">Productos</a>.</li>}
                </ul>
            )}
        </div>
    );
}

/* ───────── Compra registrada ───────── */
function Listo({ r, reiniciar }) {
    return (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label="Compra registrada">
            <div className="fixed inset-0 bg-black/50" />
            <div className="relative my-auto w-full max-w-[560px] rounded-2xl bg-white p-6 shadow-2xl">
                <div className="flex items-start gap-4">
                    <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[#e3f3ea] text-ok"><Check className="size-6" /></span>
                    <div><h2 className="text-xl font-semibold tracking-[-0.01em]">Compra registrada</h2><p className="mt-1 text-[14px] text-muted">Factura {r.factura} de {r.proveedor}</p></div>
                </div>
                <dl className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line text-[14px]">
                    <div className="bg-white px-4 py-3"><dt className="text-[12.5px] text-muted">Total</dt><dd className="num mt-0.5 font-semibold">{money(r.moneda, r.total)}</dd></div>
                    <div className="bg-white px-4 py-3"><dt className="text-[12.5px] text-muted">Productos</dt><dd className="num mt-0.5 font-semibold">{r.productos}</dd></div>
                    <div className="bg-white px-4 py-3"><dt className="text-[12.5px] text-muted">Unidades nuevas</dt><dd className="num mt-0.5 font-semibold">+{n0(r.unidades)}</dd></div>
                </dl>
                <p className="mt-3 text-[13.5px] text-muted">Ya están sumadas a tu inventario.</p>

                {r.alertas.length > 0 && (
                    <div className="mt-4 rounded-xl border border-[#f0d58a] bg-[#fff8e6] p-4">
                        <p className="text-[14px] font-semibold text-[#8a5d00]">Revisa estos precios</p>
                        <p className="mt-0.5 text-[13px] text-[#6f4b00]">Su costo cambió. Con tu margen, el precio de venta sugerido es otro:</p>
                        <ul className="mt-2 divide-y divide-[#f0d58a]/70 text-[13.5px]">
                            {r.alertas.slice(0, 5).map((a) => <li key={a.producto_id} className="flex items-center justify-between gap-3 py-1.5"><span className="min-w-0 truncate font-medium">{a.nombre}</span><span className="num shrink-0">{usd(a.precio_actual_usd)} → <b>{usd(a.precio_sugerido_usd)}</b></span></li>)}
                        </ul>
                        {r.alertas.length > 5 && <p className="mt-1 text-[12.5px] text-[#6f4b00]">y {r.alertas.length - 5} más</p>}
                        <a href="/productos" className="mt-2 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-[#8a5d00] underline underline-offset-2">Ir a Productos<ArrowRight className="size-4" /></a>
                    </div>
                )}
                {r.puede_retener && (
                    <div className="mt-4 flex items-start gap-3 rounded-xl border border-line p-4">
                        <Landmark className="mt-0.5 size-5 shrink-0 text-brand" />
                        <p className="text-[13.5px] leading-snug text-muted"><b className="font-semibold text-text">Esta factura tiene IVA.</b> Como contribuyente especial, queda pendiente de retención. Puedes registrarla ahora desde el detalle de la compra.</p>
                    </div>
                )}
                <div className="mt-6 flex flex-wrap justify-end gap-3">
                    <Button type="button" variant="ghost" onClick={reiniciar}>Registrar otra compra</Button>
                    <a href={`/compras?ver=${r.id}`} className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-5 text-[15px] font-semibold text-white hover:bg-brand-600">{r.puede_retener ? 'Ver y retener' : 'Ver la compra'}<ArrowRight className="size-4" /></a>
                </div>
            </div>
        </div>
    );
}
