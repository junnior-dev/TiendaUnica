import { Head, usePage } from '@inertiajs/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Download, FileText, History, Minus, PackageSearch, Percent, Plus, Printer, Receipt, ScanBarcode, Search, Trash2, UserPlus, UserRound, X } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Chip, Switch, Vacio } from '../../Components/kit';
import { BarraTurno, ModalApertura, ModalCierreZ, ModalCorteX, Ventana } from './Turno';
import { Button, Field, Segmented } from '../../Components/ui';
import { http } from '../../lib/http';
import { n0, n2, tasa as fTasa, SIMBOLO } from '../../lib/format';

/* ───────── utilidades ───────── */
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const num = (s) => { const t = String(s ?? '').trim(); if (!t) return NaN; return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); };
const dm = (iso) => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '');
const bs = (v) => `Bs ${n2(v)}`;
const dec = (m, v) => (m === 'COP' ? n0(v) : n2(v));
const monedaTxt = (m, v) => `${SIMBOLO[m] || m} ${dec(m, v)}`;
const num6 = (n) => String(n).padStart(6, '0');
const ls = {
    leer: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    poner: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const TIPOS_DOC = [['V', 'V · Cédula venezolana'], ['E', 'E · Cédula extranjera'], ['J', 'J · RIF jurídico'], ['G', 'G · RIF gubernamental'], ['C', 'C · Consejo comunal'], ['P', 'P · Pasaporte']];
let uid = 0;

const Tecla = ({ children }) => <kbd className="rounded border border-line bg-paper px-1.5 py-0.5 text-[11px] font-semibold text-muted">{children}</kbd>;

/* ───────── cálculo de pagos (espejo del que hace la base de datos; la base manda) ───────── */
function motor(tasas, regimen, cot) {
    const T = { VES: 1, USD: tasas.USD?.tasa || 0, EUR: tasas.EUR?.tasa || 0, COP: tasas.COP?.tasa || 0 };
    const usdDe = (m, v) => (m === 'USD' ? r2(v) : m === 'VES' ? r2(v / T.USD) : r2(r2(v * T[m]) / T.USD));
    const deUsd = (m, usd) => (m === 'USD' ? r2(usd) : m === 'VES' ? r2(usd * T.USD) : r2((usd * T.USD) / T[m]));
    const aVes = (m, v) => (m === 'VES' ? v : r2(v * T[m]));
    const factor = regimen.igtf_base === 'SIN_IVA' && cot?.total_usd > 0 ? (cot.total_usd - cot.iva_usd) / cot.total_usd : 1;
    const igtfDe = (metodo, monto) => (regimen.cobra_igtf && metodo.igtf && monto > 0 ? r2(monto * factor * (regimen.igtf_pct / 100)) : 0);
    return { T, usdDe, deUsd, aVes, igtfDe };
}

/* ═══════════════════════════ Pantalla ═══════════════════════════ */
export default function Caja(p) {
    const { negocio, usuario, fecha_larga, stock_bajo, tasa_usd, estado, emisor, regimen, tasas, metodos } = p;
    const [lineas, setLineas] = useState(() => ls.leer('pos.lineas', []));
    const [cliente, setCliente] = useState(() => ls.leer('pos.cliente', null));
    const [cot, setCot] = useState(null);
    const [cotError, setCotError] = useState('');
    const [recientes, setRecientes] = useState(p.recientes || []);
    const [modal, setModal] = useState(null); // 'cobro' | 'cliente' | 'recientes' | 'combos'
    const [post, setPost] = useState(null);   // documento recién registrado o reimpreso
    const [aviso, setAviso] = useState(null);
    const [apertura, setApertura] = useState(p.apertura || null);   // turno de caja abierto (null = hay que abrir caja)
    const [credito, setCreditoRaw] = useState(false);
    const [dias, setDias] = useState(30);                              // plazo del crédito (días)                 // venta a crédito: el cliente paga después
    const [deuda, setDeuda] = useState(null);                      // saldo pendiente del cliente elegido
    const admin = /admin/i.test(usuario?.rol || '');

    /* Combos/kit: al elegir uno se agregan sus componentes con el descuento repartido por la base (fn_combo_items). */
    const lid = (l) => `${l.producto.id}:${l.pres?.id ?? 0}`;
    const piezas = (l) => l.cantidad * (l.pres?.factor ?? 1);
    const agregarCombo = useCallback(async (combo, cantidad = 1) => {
        try {
            const t = await http('GET', `/combos/cotizar?id=${combo.id}&cantidad=${cantidad}`);
            setLineas((ls0) => {
                const out = [...ls0];
                for (const it of t.items ?? []) {
                    const comp = combo.componentes.find((c) => c.producto_id === it.producto_id) || {};
                    const precioConIva = r2((comp.precio || 0) * (1 + (regimen.iva_pct || 0) / 100));
                    const prod = { id: it.producto_id, sku: comp.sku, nombre: comp.nombre || comp.sku || `Producto ${it.producto_id}`,
                        ubicacion: null, stock: comp.stock ?? 0, exento: !!comp.exento,
                        final_usd: precioConIva, final_ves: r2(precioConIva * (tasas.USD?.tasa || 0)) };
                    const i = out.findIndex((l) => l.producto.id === it.producto_id && !l.pres);
                    if (i >= 0 && !it.descuento_pct) out[i] = { ...out[i], cantidad: r2(out[i].cantidad + it.cantidad) };
                    else if (i >= 0) out[i] = { ...out[i], cantidad: r2(out[i].cantidad + it.cantidad) };
                    else out.unshift({ producto: prod, cantidad: it.cantidad, descuento: it.descuento_pct || 0 });
                }
                return out;
            });
            setAviso({ t: 'ok', m: `${combo.nombre} agregado (${n0(cantidad)} × kit).` });
            return true;
        } catch (e) { setAviso({ t: 'err', m: e.message }); return false; }
    }, [regimen.iva_pct, tasas]);

    useEffect(() => ls.poner('pos.lineas', lineas.map(({ clave, ...l }) => l)), [lineas]);
    useEffect(() => ls.poner('pos.cliente', cliente), [cliente]);
    useEffect(() => {
        if (!cliente?.id) { setDeuda(null); return; }
        let vivo = true;
        http('GET', `/caja/credito/verificar?cliente_id=${cliente.id}`).then((r) => { if (vivo) setDeuda(r.tiene_deuda ? r : null); }).catch(() => {});
        return () => { vivo = false; };
    }, [cliente?.id]);
    useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 4000); return () => clearTimeout(t); }, [aviso]);

    /* Totales: los calcula la base de datos con el mismo precio, tasa e IVA que usará al registrar. */
    const seq = useRef(0);
    useEffect(() => {
        if (estado !== 'ok') return;
        if (!lineas.length) { setCot(null); setCotError(''); return; }
        const mi = ++seq.current;
        const t = setTimeout(async () => {
            try {
                const r = await http('POST', '/caja/cotizar', { items: lineas.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad, descuento_pct: l.descuento, ...(l.pres ? { presentacion_id: l.pres.id } : {}) })) });
                if (mi === seq.current) { setCot(r.vacio ? null : r); setCotError(''); }
            } catch (e) { if (mi === seq.current) setCotError(e.message); }
        }, 120);
        return () => clearTimeout(t);
    }, [lineas, estado]);

    const agregar = useCallback((prod, pres = null) => {
        const sinStock = !regimen.stock_negativo;
        const f = pres?.factor ?? 1;
        const nombre = pres ? `${prod.nombre} (${pres.nombre})` : prod.nombre;
        if (sinStock && prod.stock < f) { setAviso({ t: 'err', m: prod.stock <= 0 ? `«${prod.nombre}» no tiene existencias.` : `«${prod.nombre}»: quedan ${n0(prod.stock)} piezas y ${pres.nombre} trae ${n0(f)}.` }); return false; }
        setLineas((ls0) => {
            const i = ls0.findIndex((l) => l.producto.id === prod.id && (l.pres?.id ?? 0) === (pres?.id ?? 0));
            if (i >= 0) {
                const l = ls0[i]; const q = l.cantidad + 1;
                if (sinStock && q * f > prod.stock) { setAviso({ t: 'err', m: `Solo quedan ${n0(prod.stock)} piezas de «${prod.nombre}».` }); return ls0; }
                return ls0.map((x, k) => (k === i ? { ...x, cantidad: q, producto: prod, pres } : x));
            }
            return [{ producto: prod, pres, cantidad: 1, descuento: 0 }, ...ls0];
        });
        setAviso({ t: 'ok', m: `${nombre} agregado.` });
        return true;
    }, [regimen.stock_negativo]);

    const cambiarCant = (id, q) => setLineas((a) => a.map((l) => {
        if (lid(l) !== id) return l;
        let c = Math.max(0, q);
        const f = l.pres?.factor ?? 1;
        if (!regimen.stock_negativo && c * f > l.producto.stock) {
            c = Math.floor((l.producto.stock / f) * 1000) / 1000;
            setAviso({ t: 'err', m: `Solo quedan ${n0(l.producto.stock)} piezas de «${l.producto.nombre}».` });
        }
        return { ...l, cantidad: c };
    }).filter((l) => l.cantidad > 0));
    const cambiarDesc = (id, d) => setLineas((a) => a.map((l) => (lid(l) === id ? { ...l, descuento: Math.min(100, Math.max(0, d || 0)) } : l)));
    const quitar = (id) => setLineas((a) => a.filter((l) => lid(l) !== id));
    const vaciar = () => { setLineas([]); setCliente(null); setCot(null); setCreditoRaw(false); setDias(30); };

    const buscador = useRef(null);
    const clienteObligatorio = regimen.especial || credito;
    const listoBase = estado === 'ok' && !!apertura && lineas.length > 0 && !!cot && !cotError;
    const puedeCobrar = listoBase && (!credito || !!cliente);
    // A crédito sin cliente el botón no queda mudo: lleva a elegirlo (el crédito no se da a «Consumidor final»).
    const abrirCobro = useCallback(() => { if (!listoBase) return; setModal(credito && !cliente ? 'cliente' : 'cobro'); }, [listoBase, credito, cliente]);
    const setCredito = (v) => { setCreditoRaw(v); if (v && !cliente && lineas.length > 0) setModal('cliente'); };

    useEffect(() => {
        const k = (e) => {
            if (e.key === 'F2') { e.preventDefault(); buscador.current?.focus(); }
            if (e.key === 'F4') { e.preventDefault(); abrirCobro(); }
        };
        window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
    }, [abrirCobro]);

    const nuevaVenta = () => { setPost(null); setModal(null); setTimeout(() => buscador.current?.focus(), 50); };
    const registrada = (doc) => {
        setPost(doc); setModal(null); vaciar();
        setRecientes((r) => [{ id: doc.id, numero: doc.numero, hora: doc.hora, cliente: doc.cliente?.nombre || 'Consumidor final', total_usd: doc.totales.total_usd, total_ves: doc.totales.total_ves, estado: doc.estado, factura: doc.factura }, ...r].slice(0, 8));
    };

    return (
        <AppLayout actual="/caja" titulo="Punto de venta" subtitulo={fecha_larga} {...{ usuario, negocio, stockBajo: stock_bajo, tasaUsd: tasa_usd }} ancho>
            <Head title="Punto de venta" />
            {estado !== 'ok' ? <Bloqueo estado={estado} /> : (
                <>
                    {apertura && <BarraTurno apertura={apertura} corteX={() => setModal('cortex')} cerrarZ={() => setModal('cierrez')} />}
                    <div className="mt-4"><Barra {...{ tasas, regimen }} /></div>
                    <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
                        <div className="min-w-0 space-y-4">
                            <Buscador {...{ buscador, agregar, aviso, stockNegativo: regimen.stock_negativo, abrirRecientes: () => setModal('recientes'), abrirCombos: () => setModal('combos') }} />
                            <Lista {...{ lineas, cot, cotError, regimen, cambiarCant, cambiarDesc, quitar, vaciar, lid }} />
                        </div>
                        <div className="space-y-4 lg:sticky lg:top-20">
                            <ClienteCard {...{ cliente, setCliente, obligatorio: clienteObligatorio, credito, abrir: () => setModal('cliente') }} />
                            {deuda && (
                                <div className="rounded-xl border border-signal/60 bg-signal/10 px-4 py-3 text-[13.5px] leading-snug text-[#6b4a00]" role="status">
                                    <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>Este cliente tiene un saldo pendiente de <b className="num">$ {n2(deuda.saldo_usd)}</b>{deuda.vencidas > 0 ? ` (${deuda.vencidas} ${deuda.vencidas === 1 ? 'cuenta vencida' : 'cuentas vencidas'})` : ''}. Puede pagar ahora o incluirlo en la nueva venta.</span></p>
                                    {/* F-2: deuda puede quedar un instante con cliente ya vaciado
                                        (vaciar borra cliente; el efecto que limpia deuda corre después
                                        del render): sin cliente, el enlace no tiene sentido. */}
                                    {admin && cliente && <a href={`/cuentas-por-cobrar?cliente=${cliente.id}`} className="mt-1.5 inline-block text-[13px] font-semibold text-brand hover:underline">Cobrar ahora en Cuentas por cobrar</a>}
                                </div>
                            )}
                            <Totales {...{ cot, regimen, lineas, puedeCobrar, listoBase, abrirCobro, cliente, credito, setCredito, automatica: p.factura_automatica }} />
                        </div>
                    </div>
                </>
            )}

            {modal === 'cliente' && <ModalCliente cerrar={() => setModal(null)} elegir={(c) => { setCliente(c); setModal(null); }} obligatorio={clienteObligatorio} />}
            {modal === 'recientes' && <ModalRecientes lista={recientes} cerrar={() => setModal(null)} abrir={(d) => { setModal(null); setPost(d); }} />}
            {modal === 'combos' && <ModalCombos cerrar={() => setModal(null)} elegir={(c, n) => agregarCombo(c, n)} />}
            {modal === 'cortex' && <ModalCorteX cerrar={() => setModal(null)} />}
            {modal === 'cierrez' && apertura && <ModalCierreZ apertura={apertura} carritoLleno={lineas.length > 0} cerrar={() => setModal(null)} alCerrado={() => { setApertura(null); setModal(null); vaciar(); }} />}
            {estado === 'ok' && !apertura && <ModalApertura usuario={usuario} alAbrir={setApertura} />}
            {modal === 'cobro' && cot && <ModalCobro {...{ cot, regimen, tasas, metodos, cliente, lineas, credito, dias, setDias, deuda }} cerrar={() => setModal(null)} registrada={registrada} elegirCliente={() => setModal('cliente')} />}
            {post && <ModalListo doc={post} regimen={regimen} automatica={p.factura_automatica} setDoc={setPost} nueva={nuevaVenta} />}
        </AppLayout>
    );
}

/* ───────── sin configurar / sin tasa ───────── */
function Bloqueo({ estado }) {
    const sinTasa = estado === 'sin_tasa';
    const admin = /admin/i.test(usePage().props.usuario?.rol || '');
    return (
        <Card className="mx-auto max-w-[640px]">
            <Vacio icon={AlertTriangle} titulo={sinTasa ? 'Falta la tasa del dólar de hoy' : 'Falta configurar el negocio'}
                texto={sinTasa ? 'Para vender necesitamos la tasa del dólar en bolívares. Regístrala o actualízala y vuelve al punto de venta.' : 'Antes de vender, completa los datos fiscales de tu negocio: RIF, razón social y régimen (especial u ordinario).'}>
                {admin ? <a href={sinTasa ? '/tasas' : '/configuracion'} className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-5 text-[15px] font-semibold text-white hover:bg-brand-600">{sinTasa ? 'Ir a tasas de cambio' : 'Ir a configuración'}<ArrowRight className="size-4" /></a> : <p className="max-w-[46ch] text-sm text-muted">Avisa al administrador para que lo deje listo y vuelve a intentarlo.</p>}
            </Vacio>
        </Card>
    );
}

/* ───────── barra superior: tasas del día ───────── */
function Barra({ tasas, regimen }) {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-2" aria-label="Tasas de cambio del día">
                {['USD', 'EUR', 'COP'].filter((m) => tasas[m]).map((m) => {
                    const t = tasas[m];
                    return (
                        <span key={m} className={`inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-[13px] ${t.vigente ? 'border-line' : 'border-signal'}`} title={t.vigente ? 'Tasa vigente de hoy' : `Esta tasa es del ${dm(t.fecha)}. Actualízala en Tasas de cambio.`}>
                            <Chip m={m} size="sm" /><span className="text-muted">1 {m} =</span><span className="num font-semibold">Bs {fTasa(t.tasa)}</span>
                            <span className={`text-[11px] ${t.vigente ? 'text-ok' : 'font-semibold text-[#9a6a00]'}`}>{t.vigente ? 'de hoy' : `del ${dm(t.fecha)}`}</span>
                        </span>
                    );
                })}
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-[13px] font-medium text-brand">
                <Receipt className="size-3.5" />{regimen.especial ? `Contribuyente especial${regimen.cobra_igtf ? ` · IGTF ${n2(regimen.igtf_pct)} %` : ''}` : 'Contribuyente ordinario'}
            </span>
        </div>
    );
}

/* ───────── buscador de productos / lector de barras ───────── */
function Buscador({ buscador, agregar, aviso, abrirRecientes, abrirCombos, agregarCombo, stockNegativo }) {
    const regimen_stock_ok = !!stockNegativo;
    const [q, setQ] = useState('');
    const [res, setRes] = useState([]);
    const [idx, setIdx] = useState(-1);
    const [cargando, setCargando] = useState(false);
    const [vacio, setVacio] = useState(false);
    const [eligiendo, setEligiendo] = useState(null);   // producto con presentaciones: falta elegir cómo se vende
    const ctl = useRef(null);

    const buscar = useCallback(async (texto, exacto) => {
        ctl.current?.abort(); const c = new AbortController(); ctl.current = c; setCargando(true);
        try {
            const r = await http('GET', `/caja/buscar?q=${encodeURIComponent(texto)}${exacto ? '&exacto=1' : ''}`, undefined, c.signal);
            setRes(r); setIdx(-1); setVacio(r.length === 0); setCargando(false); return r;
        } catch (e) { if (e.name !== 'AbortError') { setCargando(false); setRes([]); setVacio(false); } return null; }
    }, []);

    useEffect(() => {
        const t = q.trim();
        if (t.length < 2) { ctl.current?.abort(); setRes([]); setVacio(false); setCargando(false); return; }
        const id = setTimeout(() => buscar(t, false), 180);
        return () => clearTimeout(id);
    }, [q, buscar]);

    const cerrar = () => { setQ(''); setRes([]); setVacio(false); setEligiendo(null); buscador.current?.focus(); };
    // Con presentaciones hay que decidir cómo se vende; si el lector leyó el código de barras de la caja, ya está decidido.
    const elegir = (prod, barras = null) => {
        const pres = prod.presentaciones || [];
        if (!pres.length) { if (agregar(prod)) cerrar(); return; }
        const porBarras = barras ? pres.find((x) => x.barras && x.barras === barras) : null;
        if (porBarras) { if (agregar(prod, porBarras)) cerrar(); return; }
        setRes([]); setVacio(false); setEligiendo(prod);
    };
    const vender = (prod, pres) => { if (agregar(prod, pres)) cerrar(); };
    const enter = async () => {
        const t = q.trim(); if (!t) return;
        if (eligiendo) return vender(eligiendo, null);
        if (idx >= 0 && res[idx]) return elegir(res[idx]);
        const r = await buscar(t, true);
        if (r && r.length === 1) return elegir(r[0], t);
        if (r && r.length === 0) { const r2_ = await buscar(t, false); if (r2_ && r2_.length === 1) elegir(r2_[0]); }
    };
    const tecla = (e) => {
        if (eligiendo) {
            if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
            if (e.key === 'Enter') { e.preventDefault(); enter(); return; }
            const n = Number(e.key);
            if (n >= 1 && n <= (eligiendo.presentaciones || []).length + 1) { e.preventDefault(); vender(eligiendo, n === 1 ? null : eligiendo.presentaciones[n - 2]); return; }
            e.preventDefault(); return;
        }
        if (e.key === 'Enter') { e.preventDefault(); enter(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(res.length - 1, i + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(-1, i - 1)); }
        else if (e.key === 'Escape') { setQ(''); setRes([]); }
    };

    return (
        <Card className="relative p-4">
            <label className="relative block">
                <span className="sr-only">Buscar producto o escanear código de barras</span>
                <ScanBarcode aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-6 -translate-y-1/2 text-brand" />
                <input ref={buscador} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={tecla} autoComplete="off" spellCheck="false"
                    role="combobox" aria-expanded={res.length > 0} aria-controls="pos-resultados"
                    placeholder="Escanea un código o escribe: bujía, aceite 20W50…"
                    className="h-16 w-full rounded-xl border-2 border-line bg-paper pl-14 pr-24 text-[17px] placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none" />
                <span className="absolute right-4 top-1/2 -translate-y-1/2">{cargando ? <span className="inline-block size-4 animate-spin rounded-full border-2 border-line border-t-brand" /> : <Tecla>F2</Tecla>}</span>
            </label>
                    <div className="mt-2 flex min-h-5 items-center justify-between gap-3 text-[13px]" aria-live="polite">
                        <span className={aviso ? (aviso.t === 'ok' ? 'flex items-center gap-1.5 text-ok' : 'flex items-center gap-1.5 text-danger') : 'text-muted'}>
                            {aviso ? <>{aviso.t === 'ok' ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />}{aviso.m}</> : 'Busca por nombre, código, marca, categoría o la moto compatible. El lector de barras agrega el producto al instante.'}
                        </span>
                        <span className="flex shrink-0 items-center gap-4">
                            <button type="button" onClick={abrirCombos} className="inline-flex items-center gap-1.5 font-semibold text-muted hover:text-text"><PackageSearch className="size-4" />Kits</button>
                            <button type="button" onClick={abrirRecientes} className="inline-flex items-center gap-1.5 font-semibold text-muted hover:text-text"><History className="size-4" />Últimas ventas</button>
                        </span>
                    </div>
            {eligiendo && (
                <div id="pos-resultados" role="dialog" aria-label={`Cómo vender ${eligiendo.nombre}`} className="absolute inset-x-4 top-[88px] z-20 rounded-xl border border-line bg-white p-4 shadow-xl">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="truncate text-[15px] font-semibold">{eligiendo.nombre}</p><p className="text-[13px] text-muted">¿Cómo lo vendes? Pulsa el número o toca la opción.</p></div>
                        <button type="button" onClick={cerrar} className="text-[13px] font-semibold text-muted hover:text-text">Cancelar <Tecla>Esc</Tecla></button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {[{ id: 0, nombre: 'Unidad', factor: 1, final_usd: eligiendo.final_usd, final_ves: eligiendo.final_ves }, ...eligiendo.presentaciones].map((o, i) => {
                            const falta = !regimen_stock_ok && eligiendo.stock < o.factor;
                            return (
                                <button type="button" key={o.id} disabled={falta} onClick={() => vender(eligiendo, o.id ? o : null)}
                                    className="flex items-center gap-3 rounded-xl border border-line px-3 py-3 text-left hover:border-brand hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50">
                                    <Tecla>{i + 1}</Tecla>
                                    <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{o.nombre}</span><span className="block text-[12.5px] text-muted">{o.id ? `${n0(o.factor)} piezas` : `1 ${eligiendo.unidad || 'pieza'}`}{falta && ' · no alcanza el stock'}</span></span>
                                    <span className="text-right"><span className="num block text-[15px] font-semibold">{bs(o.final_ves)}</span><span className="num block text-[12.5px] text-muted">$ {n2(o.final_usd)}</span></span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
            {!eligiendo && (res.length > 0 || vacio) && (
                <div id="pos-resultados" role="listbox" className="absolute inset-x-4 top-[88px] z-20 max-h-[420px] overflow-y-auto rounded-xl border border-line bg-white shadow-xl">
                    {vacio ? (
                        <p className="px-4 py-5 text-sm text-muted">No encontramos «{q.trim()}». Prueba con otra palabra, el código del producto o la moto (por ejemplo «Bera 150»).</p>
                    ) : res.map((r, i) => (
                        <button type="button" role="option" aria-selected={i === idx} key={r.id} onClick={() => elegir(r)} onMouseEnter={() => setIdx(i)}
                            className={`flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-0 ${i === idx ? 'bg-brand-50' : 'hover:bg-paper'} ${!r.stock ? 'opacity-60' : ''}`}>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[15px] font-medium">{r.nombre}{r.presentaciones?.length > 0 && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 align-middle text-[11.5px] font-semibold text-brand">también {r.presentaciones.map((x) => x.nombre).join(' · ')}</span>}</span>
                                <span className="mt-0.5 block truncate text-[12.5px] text-muted">{[r.sku, r.marca, r.categoria, r.ubicacion && `Ubic. ${r.ubicacion}`].filter(Boolean).join(' · ')}</span>
                            </span>
                            <span className={`shrink-0 text-[12.5px] ${r.stock > 0 ? (r.stock <= 5 ? 'font-semibold text-[#9a6a00]' : 'text-muted') : 'font-semibold text-danger'}`}>{r.stock > 0 ? `${n0(r.stock)} en stock` : 'Sin stock'}</span>
                            <span className="w-[116px] shrink-0 text-right"><span className="num block text-[15px] font-semibold">{bs(r.final_ves)}</span><span className="num block text-[12.5px] text-muted">$ {n2(r.final_usd)}{r.exento && ' · exento'}</span></span>
                        </button>
                    ))}
                </div>
            )}
        </Card>
    );
}

/* ───────── productos de la venta (documento, no carrito) ───────── */
function Lista({ lineas, cot, cotError, regimen, cambiarCant, cambiarDesc, quitar, vaciar, lid }) {
    const por = cot?.lineas || [];   // la base devuelve una fila por línea, en el mismo orden
    return (
        <Card>
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <h2 className="text-[15px] font-semibold">Productos de la venta{lineas.length > 0 && <span className="ml-2 text-[13px] font-normal text-muted">{lineas.length} {lineas.length === 1 ? 'producto' : 'productos'} · {n0(lineas.reduce((s, l) => s + l.cantidad * (l.pres?.factor ?? 1), 0))} piezas</span>}</h2>
                {lineas.length > 0 && <button type="button" onClick={vaciar} className="text-[13px] font-semibold text-muted hover:text-danger">Vaciar venta</button>}
            </div>
            {cotError && <p className="flex items-center gap-2 bg-[#fdecec] px-5 py-2.5 text-[13px] text-danger"><AlertTriangle className="size-4 shrink-0" />{cotError}</p>}
            {lineas.length === 0 ? (
                <Vacio icon={PackageSearch} titulo="Aún no hay productos" texto="Escanea un código de barras o escribe en el buscador. Aquí irá armándose la factura mientras vendes.">
                    <span className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-muted">
                        <span className="flex items-center gap-1.5"><Tecla>F2</Tecla> buscar</span><span className="flex items-center gap-1.5"><Tecla>↑</Tecla><Tecla>↓</Tecla> moverse</span><span className="flex items-center gap-1.5"><Tecla>Enter</Tecla> agregar</span><span className="flex items-center gap-1.5"><Tecla>F4</Tecla> cobrar</span>
                    </span>
                </Vacio>
            ) : (
                <ul>
                    {lineas.map((l, ix) => {
                        const pr = l.producto; const c = por[ix]?.producto_id === pr.id ? por[ix] : null; const pu = l.pres ?? pr; const k = lid(l);
                        const estVes = c ? c.total_ves : r2(pu.final_ves * l.cantidad * (1 - l.descuento / 100));
                        const estUsd = c ? c.total_usd : r2(pu.final_usd * l.cantidad * (1 - l.descuento / 100));
                        return (
                            <li key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3.5 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto_120px_40px]">
                                <div className="min-w-0">
                                    <p className="truncate text-[15px] font-medium">{pr.nombre}{l.pres && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 align-middle text-[11.5px] font-semibold text-brand">{l.pres.nombre} · {n0(l.pres.factor)} pzas</span>}</p>
                                    <p className="mt-0.5 truncate text-[12.5px] text-muted">{[pr.sku, pr.marca, pr.ubicacion && `Ubic. ${pr.ubicacion}`].filter(Boolean).join(' · ')} · <span className="num">$ {n2(pu.final_usd)}</span> {l.pres ? `por ${l.pres.nombre}` : 'c/u'}{pr.exento && <span className="ml-1.5 rounded bg-paper px-1.5 py-0.5 text-[11px] font-semibold text-muted">Exento</span>}</p>
                                </div>
                                <div className="flex items-center gap-3 sm:order-none">
                                    <div className="flex items-center rounded-lg border border-line">
                                        <button type="button" aria-label={l.pres ? `Quitar una ${l.pres.nombre}` : "Quitar una unidad"} onClick={() => cambiarCant(k, l.cantidad - 1)} className="grid size-9 place-items-center rounded-l-lg hover:bg-paper"><Minus className="size-4" /></button>
                                        <input aria-label={`Cantidad de ${pr.nombre}`} inputMode="decimal" value={l.cantidad} onChange={(e) => { const v = num(e.target.value); if (!Number.isNaN(v)) cambiarCant(k, v); }} className="num h-9 w-12 border-x border-line text-center text-[15px] font-semibold focus:bg-brand-50 focus:outline-none" />
                                        <button type="button" aria-label={l.pres ? `Agregar una ${l.pres.nombre}` : "Agregar una unidad"} onClick={() => cambiarCant(k, l.cantidad + 1)} className="grid size-9 place-items-center rounded-r-lg hover:bg-paper"><Plus className="size-4" /></button>
                                    </div>
                                    <label className="flex items-center gap-1 text-[12px] text-muted" title="Descuento en porcentaje">
                                        <Percent className="size-3.5" /><span className="sr-only">Descuento</span>
                                        <input inputMode="decimal" placeholder="0" value={l.descuento || ''} onChange={(e) => { const v = num(e.target.value); cambiarDesc(k, Number.isNaN(v) ? 0 : v); }} className="num h-9 w-12 rounded-lg border border-line text-center text-[14px] text-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                                    </label>
                                </div>
                                <div className="text-right"><p className="num text-[16px] font-semibold">{bs(estVes)}</p><p className="num text-[12.5px] text-muted">$ {n2(estUsd)}</p></div>
                                <button type="button" onClick={() => quitar(k)} aria-label={`Quitar ${pr.nombre}`} className="grid size-9 place-items-center justify-self-end rounded-lg text-muted hover:bg-[#fdecec] hover:text-danger"><Trash2 className="size-[17px]" /></button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </Card>
    );
}

/* ───────── cliente ───────── */
function ClienteCard({ cliente, setCliente, obligatorio, credito, abrir }) {
    return (
        <Card className="p-5">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-[15px] font-semibold">Cliente</h2>
                {obligatorio ? <span className="rounded-full bg-[#fff4d6] px-2.5 py-0.5 text-[12px] font-semibold text-[#8a5d00]">{credito ? 'Obligatorio a crédito' : 'Obligatorio en factura'}</span> : <span className="text-[12px] text-muted">Opcional</span>}
            </div>
            {cliente ? (
                <div className="mt-3 flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand"><UserRound className="size-5" /></span>
                    <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-semibold">{cliente.nombre}</p><p className="num text-[13px] text-muted">{cliente.tipo}-{cliente.documento}{cliente.telefono ? ` · ${cliente.telefono}` : ''}</p>{cliente.direccion && <p className="mt-0.5 truncate text-[12.5px] text-muted">{cliente.direccion}</p>}</div>
                    <div className="flex gap-1"><button type="button" onClick={abrir} className="h-8 rounded-md px-2 text-[13px] font-semibold text-brand hover:bg-brand-50">Cambiar</button><button type="button" aria-label="Quitar cliente" onClick={() => setCliente(null)} className="grid size-8 place-items-center rounded-md text-muted hover:bg-paper"><X className="size-4" /></button></div>
                </div>
            ) : (
                <button type="button" onClick={abrir} className="mt-3 flex w-full items-center gap-3 rounded-xl border border-dashed border-[#b9c1ca] px-4 py-3 text-left hover:border-brand hover:bg-brand-50">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-paper text-muted"><UserPlus className="size-5" /></span>
                    <span><span className="block text-[15px] font-semibold">{obligatorio ? 'Identificar al cliente' : 'Consumidor final'}</span><span className="block text-[13px] text-muted">{credito ? 'El crédito necesita un cliente: busca por cédula o RIF, o registra uno nuevo.' : obligatorio ? 'Busca por cédula o RIF, o registra uno nuevo.' : 'Toca para agregar cédula o RIF si lo pide.'}</span></span>
                </button>
            )}
        </Card>
    );
}

/* ───────── totales y botón cobrar ───────── */
function Totales({ cot, regimen, lineas, puedeCobrar, listoBase, abrirCobro, cliente, credito, setCredito, automatica }) {
    const vacio = !cot;
    const Fila = ({ a, b, c }) => <div className="flex items-baseline justify-between gap-3 text-[14px]"><dt className="text-muted">{a}</dt><dd className="num font-medium">{b}{c && <span className="ml-2 text-[12px] text-muted">{c}</span>}</dd></div>;
    const faltaCliente = regimen.especial && !cliente;
    return (
        <Card className="p-5">
            <h2 className="text-[15px] font-semibold">Resumen</h2>
            <dl className="mt-3 space-y-2">
                <Fila a="Base imponible" b={vacio ? '—' : bs(cot.base_ves)} />
                {(vacio || cot.exento_ves > 0) && <Fila a="Exento" b={vacio ? '—' : bs(cot.exento_ves)} />}
                <Fila a={`IVA ${n2(cot?.iva_pct ?? regimen.iva_pct)} %`} b={vacio ? '—' : bs(cot.iva_ves)} />
            </dl>
            <div className="mt-4 border-t border-line pt-4">
                <div className="flex items-end justify-between gap-3"><span className="text-[14px] font-semibold">Total</span>
                    <span className="text-right"><span className="num block text-[30px] font-bold leading-none tracking-[-0.02em]">{vacio ? 'Bs 0,00' : bs(cot.total_ves)}</span><span className="num mt-1.5 block text-[14px] text-muted">{vacio ? '$ 0,00' : `$ ${n2(cot.total_usd)}`}</span></span></div>
                {regimen.cobra_igtf && !vacio && <p className="mt-2 text-[12.5px] leading-snug text-muted">Si pagan en divisas se suma el IGTF ({n2(regimen.igtf_pct)} %); lo verás al cobrar.</p>}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2.5">
                <span><span className="block text-[14px] font-semibold">Venta a crédito</span><span className="block text-[12.5px] text-muted">El cliente paga después.</span></span>
                <Switch on={credito} set={setCredito} label="Venta a crédito" />
            </div>
            {credito && <p className="mt-2 text-[12.5px] leading-snug text-muted">El saldo pendiente se registrará en Cuentas por Cobrar.</p>}
            {credito && !cliente && lineas.length > 0 && <p className="mt-1.5 text-[12.5px] text-[#8a5d00]">El crédito necesita un cliente identificado: toca el botón para buscarlo o registrarlo.</p>}
            <button type="button" onClick={abrirCobro} disabled={!listoBase} className="mt-4 flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-brand text-[17px] font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-[#c5cdd6]">
                {credito ? (cliente ? 'Registrar crédito' : 'Elegir cliente para el crédito') : 'Cobrar'} <Tecla>F4</Tecla>
            </button>
            {faltaCliente && !credito && lineas.length > 0 && <p className="mt-2.5 text-[12.5px] text-[#8a5d00]">Podrás cobrar, pero antes tendrás que identificar al cliente.</p>}
            <p className="mt-3 text-[12px] leading-snug text-muted">{regimen.especial ? 'Al confirmar la venta se emite la factura con su número y control.' : 'Al cobrar se emite una nota de venta; registra el número de factura fiscal si la emites.'}</p>
        </Card>
    );
}

/* ═══════════════ Cliente: buscar o registrar ═══════════════ */
const TIPOS = [['V', 'V', 'Cédula'], ['E', 'E', 'Extranjero'], ['J', 'J', 'Empresa'], ['G', 'G', 'Gobierno'], ['P', 'P', 'Pasaporte'], ['C', 'C', 'Comunal']];
const EJEMPLO = { V: 'Ejemplo: 12345678', E: 'Ejemplo: 81234567', J: 'Ejemplo: 123456784 (el dígito final se valida)', G: 'Ejemplo: 200012345', C: 'Ejemplo: 300123456', P: 'Letras y números, sin espacios' };
function ModalCliente({ cerrar, elegir, obligatorio }) {
    const [modo, setModo] = useState('buscar');
    const [q, setQ] = useState(''); const [res, setRes] = useState([]); const [buscando, setBuscando] = useState(false);
    const [f, setF] = useState({ tipo: 'V', documento: '', nombre: '', telefono: '', direccion: '' });
    const [err, setErr] = useState({}); const [msg, setMsg] = useState(''); const [env, setEnv] = useState(false);
    const ctl = useRef(null);
    useEffect(() => {
        const t = q.trim(); if (t.length < 2) { ctl.current?.abort(); setRes([]); setBuscando(false); return; }
        const id = setTimeout(async () => {
            ctl.current?.abort(); const c = new AbortController(); ctl.current = c; setBuscando(true);
            try { setRes(await http('GET', `/caja/clientes?q=${encodeURIComponent(t)}`, undefined, c.signal)); setBuscando(false); } catch (e) { if (e.name !== 'AbortError') setBuscando(false); }
        }, 200);
        return () => clearTimeout(id);
    }, [q]);
    const empresa = ['J', 'G', 'C'].includes(f.tipo);
    const crear = async () => {
        setEnv(true); setErr({}); setMsg('');
        try { const r = await http('POST', '/caja/clientes', f); elegir(r.cliente); }
        catch (e) { setErr(Object.fromEntries(Object.entries(e.errors || {}).map(([k, v]) => [k, v[0]]))); setMsg(Object.keys(e.errors || {}).length ? '' : e.message); setEnv(false); }
    };
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    const t = q.trim(); const soloNumeros = t.replace(/[^0-9]/g, '');
    const nuevoDesde = () => { const esDoc = soloNumeros.length >= 4 && soloNumeros.length >= t.replace(/\s/g, '').length - 2; setF({ tipo: 'V', documento: esDoc ? soloNumeros : '', nombre: esDoc ? '' : t, telefono: '', direccion: '' }); setErr({}); setMsg(''); setModo('nuevo'); };

    if (modo === 'nuevo') {
        return (
            <Ventana titulo="Registrar cliente" subtitulo="Se guarda para futuras ventas y se agrega a esta factura." cerrar={cerrar} ancho="max-w-[560px]"
                pie={<>
                    <button type="button" onClick={() => setModo('buscar')} className="mr-auto inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-[14px] font-semibold text-muted hover:bg-paper hover:text-text"><ArrowLeft className="size-4" />Volver a la búsqueda</button>
                    <Button type="button" onClick={crear} disabled={env || !f.documento.trim() || !f.nombre.trim()}>{env ? 'Guardando…' : 'Guardar y usar en la venta'}</Button>
                </>}>
                <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); crear(); }}>
                    <fieldset>
                        <legend className="mb-2 text-[13px] font-semibold">Tipo de documento</legend>
                        <div role="radiogroup" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                            {TIPOS.map(([v, l, d]) => (
                                <button key={v} type="button" role="radio" aria-checked={f.tipo === v} onClick={() => setF({ ...f, tipo: v })}
                                    className={`rounded-lg border px-2 py-2 text-center transition-colors ${f.tipo === v ? 'border-brand bg-brand-50 ring-1 ring-brand' : 'border-line hover:border-[#b9c1ca]'}`}>
                                    <span className="block text-[15px] font-bold">{l}</span><span className="block text-[11.5px] text-muted">{d}</span>
                                </button>
                            ))}
                        </div>
                    </fieldset>
                    <Field label={f.tipo === 'P' ? 'N.º de pasaporte' : empresa ? 'RIF' : 'N.º de cédula'} inputMode={f.tipo === 'P' ? 'text' : 'numeric'} value={f.documento} onChange={set('documento')} error={err.documento} hint={!err.documento ? EJEMPLO[f.tipo] : undefined} autoFocus />
                    <Field label={empresa ? 'Razón social' : 'Nombre y apellido'} value={f.nombre} onChange={set('nombre')} error={err.nombre} />
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Teléfono (opcional)" inputMode="tel" value={f.telefono} onChange={set('telefono')} error={err.telefono} />
                        <Field label="Dirección (opcional)" value={f.direccion} onChange={set('direccion')} error={err.direccion} />
                    </div>
                    {msg && <p className="text-[13px] text-danger">{msg}</p>}
                    <button type="submit" className="hidden" />
                </form>
            </Ventana>
        );
    }

    return (
        <Ventana titulo="Cliente de la venta" subtitulo={obligatorio ? 'La factura necesita el nombre y la cédula o RIF del comprador.' : 'Solo si el cliente pide la factura con sus datos.'} cerrar={cerrar} ancho="max-w-[560px]">
            <Field label="Buscar por cédula, RIF o nombre" icon={Search} autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                trailing={buscando ? <span className="absolute right-4 top-1/2 inline-block size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-line border-t-brand" /> : null} />
            <div className="mt-3 min-h-[120px]">
                {t.length < 2 ? (
                    <p className="px-1 py-6 text-center text-[13.5px] text-muted">Escribe al menos 2 caracteres. Por ejemplo, «12345678» o «José».</p>
                ) : res.length > 0 ? (
                    <ul className="max-h-[300px] overflow-y-auto rounded-xl border border-line">
                        {res.map((c) => (
                            <li key={c.id} className="border-b border-line last:border-0">
                                <button type="button" onClick={() => elegir(c)} className="group flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-brand-50">
                                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-paper text-[13px] font-bold text-muted group-hover:bg-white group-hover:text-brand">{c.nombre.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
                                    <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{c.nombre}</span><span className="num block truncate text-[13px] text-muted">{c.tipo}-{c.documento}{c.telefono ? ` · ${c.telefono}` : ''}</span></span>
                                    <span className="text-[13px] font-semibold text-brand opacity-0 group-hover:opacity-100">Elegir</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : !buscando && (
                    <div className="rounded-xl bg-paper px-4 py-5 text-center"><p className="text-[14px] font-medium">No hay clientes con «{t}»</p><p className="mt-0.5 text-[13px] text-muted">Puedes registrarlo ahora, toma menos de un minuto.</p></div>
                )}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <button type="button" onClick={nuevoDesde} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper"><UserPlus className="size-4 text-brand" />Registrar cliente nuevo</button>
                {!obligatorio && <button type="button" onClick={() => elegir(null)} className="text-[13.5px] font-semibold text-muted hover:text-text">Continuar como consumidor final</button>}
            </div>
        </Ventana>
    );
}

/* ═══════════════ Últimas ventas ═══════════════ */
function ModalRecientes({ lista, cerrar, abrir }) {
    const [cargando, setCargando] = useState(null); const [err, setErr] = useState('');
    const ver = async (id) => { setCargando(id); setErr(''); try { abrir(await http('GET', `/caja/venta/${id}`)); } catch (e) { setErr(e.message); setCargando(null); } };
    return (
        <Ventana titulo="Ventas de hoy" subtitulo="Reimprime una nota de venta o registra el número de factura que falte." cerrar={cerrar} ancho="max-w-[600px]">
            {err && <p className="mb-3 text-[13px] text-danger">{err}</p>}
            {lista.length === 0 ? <p className="py-8 text-center text-sm text-muted">Todavía no hay ventas hoy.</p> : (
                <ul className="divide-y divide-line">
                    {lista.map((v) => (
                        <li key={v.id}><button type="button" onClick={() => ver(v.id)} disabled={cargando === v.id} className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-paper">
                            <span className="num w-20 shrink-0 text-[13px] font-semibold">N.º {num6(v.numero)}</span>
                            <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{v.cliente || 'Consumidor final'}</span><span className="num block text-[12.5px] text-muted">{v.hora}{v.factura ? ` · ${v.factura}` : ' · sin factura fiscal'}{v.estado === 'ANULADA' ? ' · anulada' : ''}</span></span>
                            <span className="text-right"><span className="num block text-[14px] font-semibold">{bs(v.total_ves)}</span><span className="num block text-[12.5px] text-muted">$ {n2(v.total_usd)}</span></span>
                            <Printer className="size-4 shrink-0 text-muted" />
                        </button></li>
                    ))}
                </ul>
            )}
        </Ventana>
    );
}

/* ═══════════════ Combos / kits de mantenimiento (archivo 25) ═══════════════ */
function ModalCombos({ cerrar, elegir }) {
    const [lista, setLista] = useState(null);
    const [err, setErr] = useState('');
    const [sel, setSel] = useState(null);          // combo elegido, esperando la cantidad
    const [cant, setCant] = useState('1');
    const [env, setEnv] = useState(false);
    useEffect(() => { http('GET', '/combos/lista').then(setLista).catch((e) => setErr(e.message)); }, []);
    const agregar = async () => {
        const n = num(cant);
        if (!sel || Number.isNaN(n) || n <= 0) return;
        setEnv(true);
        if (await elegir(sel, n)) cerrar();
        setEnv(false);
    };
    const conIva = (v) => r2((v || 0) * 1.16);   // solo para mostrar; el total real lo recalcula la base
    return (
        <Ventana titulo="Kits y combos" subtitulo="Se agregan sus piezas reales: cada línea lleva su precio, su IVA y su descuento hasta el precio del kit." cerrar={cerrar} ancho="max-w-[600px]">
            {err && <p className="text-[13px] text-danger">{err}</p>}
            {sel ? (
                <div className="space-y-4">
                    <div className="rounded-xl border border-brand/40 bg-brand-50 p-4">
                        <p className="text-[15px] font-semibold">{sel.nombre}</p>
                        <p className="mt-1 text-[13px] text-muted">{(sel.componentes || []).map((c) => `${c.nombre} × ${n0(c.cantidad)}`).join(' · ')}</p>
                    </div>
                    <Field label="¿Cuántos kits?" inputMode="decimal" value={cant} onChange={(e) => setCant(e.target.value)} autoFocus className="[&_input]:num" />
                    <div className="flex justify-end gap-3">
                        <button type="button" onClick={() => setSel(null)} className="inline-flex h-11 items-center rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper">Volver</button>
                        <Button type="button" onClick={agregar} disabled={env}>{env ? 'Agregando…' : 'Agregar a la venta'}</Button>
                    </div>
                </div>
            ) : !lista ? (
                <p className="py-8 text-center text-sm text-muted">Cargando kits…</p>
            ) : lista.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">Todavía no hay kits creados. Los crea el administrador en Catálogo → Combos y kits.</p>
            ) : (
                <ul className="max-h-[380px] divide-y divide-line overflow-y-auto rounded-xl border border-line">
                    {lista.map((c) => (
                        <li key={c.id}>
                            <button type="button" disabled={!c.hay_stock} onClick={() => { setSel(c); setCant('1'); }}
                                className={`flex w-full items-center gap-3 px-4 py-3 text-left ${c.hay_stock ? 'hover:bg-brand-50' : 'opacity-50'}`}>
                                <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-medium">{c.nombre}</span>
                                    <span className="block truncate text-[12.5px] text-muted">{c.sku} · {(c.componentes || []).length} piezas{c.ahorro_pct > 0 ? ` · ahorras ${n2(c.ahorro_pct)} %` : ''}</span></span>
                                <span className="shrink-0 text-right"><span className="num block text-[15px] font-semibold">$ {n2(conIva(c.precio ?? c.suma_piezas))}</span>
                                    <span className="block text-[12px] text-muted">{c.hay_stock ? 'hay stock' : 'sin stock completo'}</span></span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </Ventana>
    );
}

/* ═══════════════ Cobro: pagos mixtos ═══════════════ */
function ModalCobro({ cot, regimen, tasas, metodos, cliente, lineas, credito, dias, setDias, deuda, cerrar, registrada, elegirCliente }) {
    const M = useMemo(() => motor(tasas, regimen, cot), [tasas, regimen, cot]);
    const [filas, setFilas] = useState([]);
    const [env, setEnv] = useState(false); const [error, setError] = useState('');
    const tol = regimen.tolerancia ?? 0.01;

    const calc = (f) => {
        const m = num(f.monto); const monto = Number.isNaN(m) || m < 0 ? 0 : m; const mon = f.metodo.moneda;
        const usd = M.usdDe(mon, monto); const igtf = M.igtfDe(f.metodo, monto); const cobrado = r2(monto + igtf);
        const rec = num(f.recibido); const recibido = Number.isNaN(rec) ? 0 : rec;
        return { monto, usd, igtf, cobrado, recibido, vuelto: recibido > 0 ? r2(recibido - cobrado) : 0 };
    };
    const cs = filas.map(calc);
    const pagadoUsd = r2(cs.reduce((s, c) => s + c.usd, 0));
    const faltaUsd = r2(cot.total_usd - pagadoUsd);
    const igtfVes = r2(filas.reduce((s, f, i) => s + M.aVes(f.metodo.moneda, cs[i].igtf), 0));
    const igtfUsd = r2(igtfVes / M.T.USD);
    const totalCobrarVes = r2(cot.total_ves + igtfVes); const totalCobrarUsd = r2(cot.total_usd + igtfUsd);
    const cuadra = filas.length > 0 && Math.abs(faltaUsd) <= tol;
    const sobra = faltaUsd < -tol;
    const refsOk = filas.every((f, i) => cs[i].monto === 0 || !f.metodo.referencia || f.ref.trim().length >= 3);
    const recOk = filas.every((f, i) => !(cs[i].recibido > 0) || cs[i].vuelto >= 0);
    const clienteOk = (!regimen.especial && !credito) || !!cliente;
    // Al contado los pagos deben cuadrar con el total; a crédito pueden ser menores (o no haber ninguno), nunca mayores.
    const montosOk = filas.every((f, i) => cs[i].monto > 0);
    const listo = (credito ? !sobra : cuadra) && refsOk && recOk && clienteOk && montosOk;
    const quedaCredito = credito && faltaUsd > tol;

    const agregar = (metodo) => {
        const falta = Math.max(0, faltaUsd);
        setFilas((a) => [...a, { id: ++uid, metodo, monto: falta > 0 ? String(M.deUsd(metodo.moneda, falta)).replace('.', ',') : '', ref: '', recibido: '', vueltoBs: false }]);
    };
    const cubrir = (id) => setFilas((a) => a.map((f) => {
        if (f.id !== id) return f;
        const otros = a.filter((x) => x.id !== id).reduce((s, x) => s + M.usdDe(x.metodo.moneda, calcMonto(x)), 0);
        const falta = Math.max(0, r2(cot.total_usd - otros));
        return { ...f, monto: String(M.deUsd(f.metodo.moneda, falta)).replace('.', ',') };
    }));
    const calcMonto = (x) => { const m = num(x.monto); return Number.isNaN(m) ? 0 : m; };
    const cambiar = (id, k, v) => setFilas((a) => a.map((f) => (f.id === id ? { ...f, [k]: v } : f)));
    const quitar = (id) => setFilas((a) => a.filter((f) => f.id !== id));

    const confirmar = async () => {
        if (!listo || env) return;
        setEnv(true); setError('');
        try {
            const pagos = filas.map((f, i) => {
                const c = cs[i];
                const o = { metodo_pago_id: f.metodo.id, monto: c.monto, referencia: f.ref.trim() || undefined };
                if (c.recibido > 0 && c.vuelto > 0) {
                    o.monto_entregado = c.recibido;
                    o.vuelto_moneda = f.vueltoBs && f.metodo.moneda !== 'VES' ? 'VES' : f.metodo.moneda;
                    o.vuelto_monto = f.vueltoBs && f.metodo.moneda !== 'VES' ? M.aVes(f.metodo.moneda, c.vuelto) : c.vuelto;
                }
                return o;
            });
            const doc = await http('POST', '/caja/venta', { items: lineas.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad, descuento_pct: l.descuento, ...(l.pres ? { presentacion_id: l.pres.id } : {}) })), pagos, cliente_id: cliente?.id ?? null, es_credito: !!credito, ...(credito ? { dias_credito: dias } : {}) });
            registrada(doc);
        } catch (e) { setError(e.message); setEnv(false); }
    };

    return (
        <Ventana titulo={credito ? 'Venta a crédito' : 'Cobrar venta'} cerrar={cerrar} ancho="max-w-[760px]" subtitulo={cliente ? `${cliente.nombre} · ${cliente.tipo}-${cliente.documento}` : regimen.especial ? 'Falta identificar al cliente.' : 'Consumidor final'}
            pie={<>
                <button type="button" onClick={cerrar} className="inline-flex h-12 items-center rounded-lg border border-line px-5 text-[15px] font-semibold hover:bg-paper">Volver a la venta</button>
                <button type="button" onClick={confirmar} disabled={!listo || env} className="inline-flex h-12 items-center gap-2 rounded-lg bg-brand px-6 text-[15px] font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-[#c5cdd6]">{env ? 'Registrando…' : <>{credito ? 'Registrar a crédito' : 'Confirmar venta'}<Check className="size-4" /></>}</button>
            </>}>
            <div className="grid gap-4 rounded-xl bg-paper p-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <div><p className="text-[13px] text-muted">{credito ? 'Total de la venta' : 'Total a cobrar'}</p><p className="num text-[32px] font-bold leading-tight tracking-[-0.02em]">{bs(totalCobrarVes)}</p><p className="num text-[14px] text-muted">$ {n2(totalCobrarUsd)}{igtfVes > 0 && <span> · incluye IGTF {bs(igtfVes)}</span>}</p></div>
                <div className="text-right"><p className="text-[13px] text-muted">{sobra ? 'Pagos de más' : cuadra ? 'Pagado completo' : credito ? 'Quedará a crédito' : 'Falta por pagar'}</p>
                    <p className={`num text-[22px] font-bold ${cuadra ? 'text-ok' : sobra ? 'text-danger' : credito ? 'text-[#8a5d00]' : 'text-text'}`}>{cuadra ? '$ 0,00' : `$ ${n2(Math.abs(faltaUsd))}`}</p>
                    <p className="num text-[13px] text-muted">{bs(M.deUsd('VES', Math.abs(cuadra ? 0 : faltaUsd)))}</p></div>
            </div>

            <p className="mb-2 mt-5 text-[13px] font-semibold">Forma de pago <span className="font-normal text-muted">· puedes combinar varias</span></p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {metodos.map((m) => (
                    <button type="button" key={m.id} onClick={() => agregar(m)} className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-3 text-left hover:border-brand hover:bg-brand-50">
                        <Chip m={m.moneda} size="sm" /><span className="text-[14px] font-semibold leading-tight">{m.nombre}</span>
                    </button>
                ))}
            </div>

            {filas.length > 0 && (
                <ul className="mt-5 space-y-3">
                    {filas.map((f, i) => {
                        const c = cs[i]; const mon = f.metodo.moneda; const efectivo = !f.metodo.referencia;
                        return (
                            <li key={f.id} className="rounded-xl border border-line p-4">
                                <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Chip m={mon} /><span className="text-[15px] font-semibold">{f.metodo.nombre}</span></div>
                                    <button type="button" onClick={() => quitar(f.id)} aria-label={`Quitar ${f.metodo.nombre}`} className="grid size-8 place-items-center rounded-md text-muted hover:bg-[#fdecec] hover:text-danger"><X className="size-4" /></button></div>
                                <div className={`mt-3 grid gap-3 ${f.metodo.referencia || efectivo ? 'sm:grid-cols-2' : ''}`}>
                                    <Field label={`Monto en ${mon === 'VES' ? 'bolívares' : mon}`} inputMode="decimal" value={f.monto} onChange={(e) => cambiar(f.id, 'monto', e.target.value)} autoFocus={i === filas.length - 1}
                                        trailing={<button type="button" onClick={() => cubrir(f.id)} className="absolute right-1.5 top-1/2 z-10 h-8 -translate-y-1/2 rounded-md px-2 text-[12px] font-semibold text-brand hover:bg-brand-50">Cubrir resto</button>} />
                                    {f.metodo.referencia && <Field label="N.º de referencia" value={f.ref} onChange={(e) => cambiar(f.id, 'ref', e.target.value)} error={c.monto > 0 && f.ref.trim().length < 3 && f.ref ? 'Escribe la referencia completa.' : undefined} hint={!f.ref ? 'Obligatoria para este método.' : undefined} />}
                                    {efectivo && <Field label="Recibido del cliente (opcional)" inputMode="decimal" value={f.recibido} onChange={(e) => cambiar(f.id, 'recibido', e.target.value)} error={c.recibido > 0 && c.vuelto < 0 ? `Falta ${monedaTxt(mon, Math.abs(c.vuelto))}.` : undefined} />}
                                </div>
                                <p className="num mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
                                    <span>Equivale a $ {n2(c.usd)} · {bs(M.aVes(mon, c.monto))}</span>
                                    {c.igtf > 0 && <span className="font-medium text-[#8a5d00]">IGTF {n2(regimen.igtf_pct)} %: {monedaTxt(mon, c.igtf)} → cobrar {monedaTxt(mon, c.cobrado)}</span>}
                                </p>
                                {efectivo && c.vuelto > 0 && (
                                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#e8f5ee] px-3 py-2.5 text-[14px]">
                                        <span className="font-semibold text-ok">Vuelto: <span className="num">{f.vueltoBs && mon !== 'VES' ? bs(M.aVes(mon, c.vuelto)) : monedaTxt(mon, c.vuelto)}</span></span>
                                        {mon !== 'VES' && <label className="flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" checked={f.vueltoBs} onChange={(e) => cambiar(f.id, 'vueltoBs', e.target.checked)} className="size-4 accent-[#1e4fd6]" />Dar el vuelto en bolívares</label>}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {credito && (
                <div className="mt-4 rounded-xl border border-line p-3.5">
                    <p className="text-[13.5px] font-semibold">Plazo para pagar</p>
                    <div role="radiogroup" aria-label="Plazo del crédito" className="mt-2 flex flex-wrap gap-2">
                        {[8, 15, 30, 45, 60].map((d) => (
                            <button key={d} type="button" role="radio" aria-checked={dias === d} onClick={() => setDias(d)}
                                className={`h-10 rounded-lg border px-3.5 text-[14px] font-semibold ${dias === d ? 'border-brand bg-brand-50 text-brand' : 'border-line hover:bg-paper'}`}>{d} días</button>
                        ))}
                    </div>
                    <p className="mt-2.5 text-[13px] text-muted">{(() => { const v = new Date(); v.setDate(v.getDate() + dias); return `Vence el ${v.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })}. `; })()}El saldo queda en Cuentas por Cobrar a nombre de {cliente?.nombre ?? 'el cliente'}.</p>
                    {deuda && <p className="mt-2 flex items-start gap-2 text-[13px] text-[#8a5d00]"><AlertTriangle className="mt-0.5 size-4 shrink-0" />Este cliente ya debe $ {n2(deuda.saldo_usd)}{deuda.vencidas > 0 ? ` (${deuda.vencidas} ${deuda.vencidas === 1 ? 'cuenta vencida' : 'cuentas vencidas'})` : ''}. Tú decides si le das más crédito.</p>}
                </div>
            )}

            <div className="mt-4 space-y-2 text-[13px]" aria-live="polite">
                {filas.length === 0 && <p className="text-muted">{credito ? 'El abono inicial es opcional: puedes registrar la venta sin ningún pago.' : 'Elige cómo paga el cliente. Si falta dinero, agrega otra forma de pago.'}</p>}
                {credito && <p className="flex items-start gap-2 rounded-lg bg-signal/10 px-3 py-2.5 text-[#6b4a00]"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{quedaCredito ? <span>El saldo pendiente de <b className="num">$ {n2(faltaUsd)}</b> se registrará en Cuentas por Cobrar de {cliente?.nombre || 'el cliente'}.</span> : <span>Con este pago no queda saldo: la venta se registra como de contado.</span>}</p>}
                {sobra && <p className="flex items-start gap-2 text-danger"><AlertTriangle className="mt-0.5 size-4 shrink-0" />Los pagos superan el total. Baja el monto: el vuelto se calcula con «Recibido del cliente».</p>}
                {!clienteOk && <p className="flex items-center gap-2 text-[#8a5d00]"><AlertTriangle className="size-4 shrink-0" />{credito ? 'El crédito necesita un cliente identificado.' : 'Para la factura necesitamos los datos del cliente.'} <button type="button" onClick={elegirCliente} className="font-semibold text-brand hover:underline">Identificar cliente</button></p>}
                {filas.length > 0 && !refsOk && <p className="flex items-center gap-2 text-[#8a5d00]"><AlertTriangle className="size-4 shrink-0" />Falta el número de referencia en algún pago.</p>}
                {error && <p className="flex items-start gap-2 rounded-lg bg-[#fdecec] px-3 py-2.5 text-danger"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</p>}
            </div>
        </Ventana>
    );
}

/* ═══════════════ Venta registrada: imprimir ═══════════════ */
function ModalListo({ doc, regimen, automatica, setDoc, nueva }) {
    const [formato, setFormato] = useState(() => ls.leer('pos.formato', 'ticket'));
    const [fact, setFact] = useState(''); const [ctrl, setCtrl] = useState('');
    const [err, setErr] = useState(doc.aviso_emision || ''); const [env, setEnv] = useState(false); const [gen, setGen] = useState(false);
    useEffect(() => ls.poner('pos.formato', formato), [formato]);

    const emitir = async () => {
        setEnv(true); setErr('');
        try { setDoc(await http('POST', `/caja/venta/${doc.id}/emitir`, {})); }
        catch (e) { setErr(e.message); } finally { setEnv(false); }
    };
    const asignarManual = async () => {
        setEnv(true); setErr('');
        try { setDoc(await http('POST', `/caja/venta/${doc.id}/factura`, { factura: fact.trim(), control: ctrl.trim() || null })); }
        catch (e) { setErr(e.errors?.factura?.[0] || e.message); } finally { setEnv(false); }
    };
    const generar = async (descargar) => {
        setGen(true);
        try {
            const { construirPdfVenta, abrirPdf } = await import('../../lib/pdfVenta');
            const pdf = await construirPdfVenta(doc, formato);
            abrirPdf(pdf, { imprimir: !descargar, descargar, nombre: `${doc.factura ? 'factura' : 'nota-de-venta'}-${doc.factura || num6(doc.numero)}.pdf` });
        } finally { setGen(false); }
    };
    const esFactura = !!doc.factura;
    return (
        <Ventana titulo={doc.estado === 'ANULADA' ? 'Venta anulada' : esFactura ? 'Factura emitida' : 'Venta registrada'} cerrar={nueva} ancho="max-w-[520px]"
            subtitulo={`Venta N.º ${num6(doc.numero)} · ${doc.fecha} ${doc.hora}`}
            pie={<button type="button" onClick={nueva} className="inline-flex h-12 items-center gap-2 rounded-lg bg-brand px-6 text-[15px] font-semibold text-white hover:bg-brand-600"><Plus className="size-4" />Nueva venta</button>}>
            <div className="flex items-center gap-3 rounded-xl bg-[#e8f5ee] p-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-ok text-white"><Check className="size-6" /></span>
                <div className="min-w-0"><p className="num text-[22px] font-bold leading-tight">{bs(doc.totales.total_cobrar_ves)}</p><p className="num text-[13px] text-muted">$ {n2(doc.totales.total_cobrar_usd)} · {doc.cliente?.nombre || 'Consumidor final'}</p></div>
            </div>
            {doc.credito?.es && doc.credito.saldo_usd > 0 && <p className="mt-3 rounded-lg bg-signal/10 px-3.5 py-2.5 text-[13.5px] text-[#6b4a00]">Venta a crédito: saldo pendiente <b className="num">$ {n2(doc.credito.saldo_usd)}</b>{doc.credito.vence ? <>, vence el <b className="num">{doc.credito.vence}</b></> : ''}. Quedó registrado en Cuentas por Cobrar a nombre de {doc.cliente?.nombre}.</p>}

            {esFactura ? (
                <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-[14px]">
                    <div className="bg-white px-4 py-3"><dt className="text-[12.5px] text-muted">N.º de factura</dt><dd className="num mt-0.5 font-semibold">{doc.factura}</dd></div>
                    <div className="bg-white px-4 py-3"><dt className="text-[12.5px] text-muted">N.º de control</dt><dd className="num mt-0.5 font-semibold">{doc.control || '—'}</dd></div>
                </dl>
            ) : automatica ? (
                <div className="mt-4 rounded-xl border border-[#f0d58a] bg-[#fff8e6] p-4">
                    <p className="flex items-start gap-2 text-[14px] font-semibold text-[#8a5d00]"><AlertTriangle className="mt-0.5 size-4 shrink-0" />La venta quedó registrada, pero la factura no se emitió</p>
                    {err && <p className="mt-1 text-[13px] text-[#8a5d00]">{err}</p>}
                    <Button type="button" onClick={emitir} disabled={env} className="mt-3 h-10">{env ? 'Emitiendo…' : 'Emitir factura ahora'}</Button>
                </div>
            ) : (
                <form className="mt-4 rounded-xl border border-line p-4" onSubmit={(e) => { e.preventDefault(); asignarManual(); }}>
                    <p className="text-[14px] font-semibold">Número de factura</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-muted">La numeración automática está desactivada. Escribe el número que te dio tu máquina fiscal o tu sistema de facturación digital.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="N.º de factura" value={fact} onChange={(e) => setFact(e.target.value)} error={err} autoFocus /><Field label="N.º de control (opcional)" value={ctrl} onChange={(e) => setCtrl(e.target.value)} /></div>
                    <div className="mt-3 flex justify-end"><Button type="submit" disabled={env || !fact.trim()}>{env ? 'Un momento…' : 'Guardar número'}</Button></div>
                </form>
            )}

            <div className="mt-5 flex items-center justify-between gap-3">
                <div><p className="text-[13px] text-muted">Documento</p><p className="text-[15px] font-semibold">{esFactura ? 'Factura' : 'Nota de venta'}</p></div>
                <div className="w-[250px] shrink-0"><Segmented name="formato" compact value={formato} onChange={setFormato} options={[{ value: 'ticket', label: 'Ticket 80 mm' }, { value: 'carta', label: 'Hoja carta' }]} /></div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
                <button type="button" onClick={() => generar(false)} disabled={gen} className="flex h-14 items-center justify-center gap-2.5 rounded-xl bg-ink text-[15px] font-semibold text-white hover:bg-black disabled:opacity-60"><Printer className="size-5" />{gen ? 'Preparando…' : 'Imprimir'}</button>
                <button type="button" onClick={() => generar(true)} disabled={gen} className="flex h-14 items-center justify-center gap-2.5 rounded-xl border border-line text-[15px] font-semibold hover:bg-paper disabled:opacity-60"><Download className="size-5" />Descargar PDF</button>
            </div>
        </Ventana>
    );
}
