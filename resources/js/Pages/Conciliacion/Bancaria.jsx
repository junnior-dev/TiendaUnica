import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, CircleCheck, FileDown, Landmark, Link2, Lock, Plus, ShieldCheck, Trash2, TriangleAlert, Undo2, Upload, Wand2, X } from 'lucide-react';
import { Card, Modal, Vacio } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { http } from '../../lib/http';
import { numero } from '../../lib/leerExtracto';
import { n2 } from '../../lib/format';
import { corto, dmy, ModalPdf, monto, Semaforo } from './comun';
import ImportarExtracto from './ImportarExtracto';

const BANCOS = ['Banesco', 'Mercantil', 'Banco de Venezuela', 'Provincial', 'BNC', 'Bancamiga', 'Banco del Tesoro', 'Bicentenario', 'Exterior', 'Banplus', 'Banco Caroní'];
const cents = (v) => Math.round(v * 100);
const Num = ({ v, neg = true, className = '' }) => <span className={`num ${neg && v < 0 ? 'text-danger' : ''} ${className}`}>{monto(v)}</span>;

function EstadoChip({ c }) {
    return c.estado === 'CERRADA'
        ? <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-white"><Lock className="size-3" />Cerrada</span>
        : <span className="rounded-full bg-[#fff4d6] px-2 py-0.5 text-[11px] font-semibold text-[#7a5600]">Borrador</span>;
}

/* ───────── Nueva conciliación ───────── */
function ModalNueva({ cuenta, hoy, cerrar, creada }) {
    const ini = (() => { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(0); return d; })();                // por defecto: el mes que terminó
    const [f, setF] = useState({ banco: '', cuenta_bancaria: '', desde: `${ini.getUTCFullYear()}-${String(ini.getUTCMonth() + 1).padStart(2, '0')}-01`, hasta: ini.toISOString().slice(0, 10), tolerancia_dias: '2' });
    const [errs, setErrs] = useState({}); const [env, setEnv] = useState(false);
    const enviar = async () => {
        setEnv(true); setErrs({});
        try { const r = await http('POST', '/conciliacion/bancaria', { ...f, tolerancia_dias: Number(f.tolerancia_dias), cuenta_id: cuenta?.id }); creada(r.conciliacion); }
        catch (e) { setErrs(e.errors ? Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k, v[0]])) : { banco: e.message }); } finally { setEnv(false); }
    };
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    return (
        <Modal titulo="Nueva conciliación bancaria" subtitulo={cuenta ? `Se compara el estado de cuenta contra ${cuenta.codigo} ${cuenta.nombre} del libro mayor.` : undefined} cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Crear y subir estado de cuenta">
            <Field label="Banco" list="bancos-ve" value={f.banco} onChange={set('banco')} error={errs.banco} autoFocus /><datalist id="bancos-ve">{BANCOS.map((b) => <option key={b} value={b} />)}</datalist>
            <Field label="Cuenta (últimos 4 dígitos, opcional)" value={f.cuenta_bancaria} onChange={set('cuenta_bancaria')} error={errs.cuenta_bancaria} maxLength={30} />
            <div className="grid grid-cols-2 gap-3"><Field label="Desde" type="date" forceFloat value={f.desde} onChange={set('desde')} error={errs.desde} /><Field label="Hasta" type="date" forceFloat value={f.hasta} onChange={set('hasta')} error={errs.hasta} /></div>
            <Field label="Tolerancia de fechas (días)" inputMode="numeric" value={f.tolerancia_dias} onChange={set('tolerancia_dias')} error={errs.tolerancia_dias} hint="El banco acredita con retraso: un depósito del viernes puede aparecer el lunes. Con 2 días el cruce automático lo reconoce." />
        </Modal>
    );
}

/* ───────── Clasificar un movimiento sin asiento ───────── */
function ModalClasificar({ linea, clases, cerrar, guardar }) {
    const [clase, setClase] = useState(linea.clase || (linea.monto < 0 ? 'COMISION' : 'NOTA_CREDITO_BANCO')); const [nota, setNota] = useState(linea.nota || ''); const [env, setEnv] = useState(false);
    return (
        <Modal titulo="Clasificar movimiento del banco" subtitulo={`${dmy(linea.fecha)} · ${linea.descripcion || linea.referencia || 'sin descripción'} · Bs ${monto(linea.monto)}`} cerrar={cerrar} enviando={env} ok="Clasificar" onSubmit={async () => { setEnv(true); try { await guardar(linea.id, clase, nota); } finally { setEnv(false); } }}>
            <p className="text-[14px] text-muted">Es un movimiento que el banco hizo y que tu libro aún no tiene. Queda en el acta como <b className="text-text">ajuste por registrar en libros</b>: regístralo con un asiento manual en Contabilidad.</p>
            <Field select label="Tipo de movimiento" value={clase} onChange={(e) => setClase(e.target.value)}>{Object.entries(clases).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</Field>
            <Field label="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={250} />
        </Modal>
    );
}

/* ───────── Mesa de trabajo de una conciliación ───────── */
function Mesa({ c, clases, emisor, onCambio, onVolver, onBorrada, hoy }) {
    const cerrada = c.estado === 'CERRADA', r = c.resumen;
    const [fBanco, setFBanco] = useState(c.movimientos.some((l) => l.estado === 'PENDIENTE') || !c.movimientos.length ? 'pendientes' : 'todos'); const [fLibro, setFLibro] = useState('sin');
    const [selB, setSelB] = useState(null); const [selL, setSelL] = useState([]);
    const [modal, setModal] = useState(null); const [error, setError] = useState(''); const [ocupado, setOcupado] = useState(false); const [aviso, setAviso] = useState('');
    const [saldo, setSaldo] = useState(c.saldo_banco_final === null ? '' : n2(c.saldo_banco_final));
    useEffect(() => { setSaldo(c.saldo_banco_final === null ? '' : n2(c.saldo_banco_final)); }, [c.saldo_banco_final]);
    const [limB, setLimB] = useState(150); const [limL, setLimL] = useState(150);

    const act = async (metodo, url, cuerpo, ok) => {
        setOcupado(true); setError('');
        try { const x = await http(metodo, `/conciliacion/bancaria/${c.id}${url}`, cuerpo); if (x.conciliacion) onCambio(x.conciliacion); setSelB(null); setSelL([]); if (ok) setAviso(ok(x)); return x; }
        catch (e) { setError(e.message || 'No se pudo completar la acción.'); return null; } finally { setOcupado(false); }
    };
    const guardarSaldo = async () => {
        const t = saldo.trim(); const v = t === '' ? null : numero(t);
        if (t !== '' && v === null) return setError('El saldo final debe ser un número. Ejemplo: 10.587,50');
        if (v === c.saldo_banco_final) return;
        await act('PUT', '', { saldo_banco_final: v });
    };

    const banco = useMemo(() => c.movimientos.filter((l) => fBanco === 'todos' || (fBanco === 'pendientes' && l.estado === 'PENDIENTE') || (fBanco === 'cruzados' && l.estado === 'CRUZADA') || (fBanco === 'ajustes' && l.estado === 'AJUSTE')), [c.movimientos, fBanco]);
    const libro = useMemo(() => c.libro.filter((l) => (fLibro === 'sin' ? l.estado === 'SIN_CRUZAR' : l.estado !== 'SIN_CRUZAR')), [c.libro, fLibro]);
    const lineaSel = c.movimientos.find((l) => l.id === selB && l.estado === 'PENDIENTE');
    const sumaSel = selL.reduce((s, id) => s + (c.libro.find((l) => l.id === id)?.monto || 0), 0);
    const iguales = lineaSel && selL.length > 0 && cents(sumaSel) === cents(lineaSel.monto);
    const conteo = (e) => c.movimientos.filter((l) => l.estado === e).length;
    const cuadra = r.saldo_banco !== null && r.lineas_pendientes === 0 && Math.abs(r.diferencia) < 0.005;
    const nPend = conteo('PENDIENTE');
    const alternar = (id) => setSelL((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

    const Fila = ({ k, v, fuerte, neg: n }) => <div className={`flex items-baseline justify-between gap-3 py-1.5 ${fuerte ? 'border-t border-line font-semibold' : 'text-[14px]'}`}><span className={fuerte ? '' : 'text-muted'}>{k}</span><Num v={v} neg={n !== false} className={fuerte ? 'text-[17px]' : ''} /></div>;
    const Pestana = ({ v, set, t, n, activo }) => <button type="button" onClick={() => set(v)} className={`h-8 rounded-md px-3 text-[13px] font-semibold ${activo ? 'bg-ink text-white' : 'text-muted hover:bg-paper'}`}>{t}{n !== undefined && <span className={`ml-1.5 ${activo ? 'text-white/70' : 'text-muted'}`}>{n}</span>}</button>;

    return (
        <div className="min-w-0 space-y-5">
            <Card>
                <div className="rounded-t-2xl bg-ink px-5 pb-5 pt-4 text-white sm:px-6">
                    <button onClick={onVolver} className="-ml-1.5 mb-3 inline-flex h-9 items-center gap-1.5 rounded-lg px-1.5 text-[14px] text-white/70 hover:bg-white/10 hover:text-white xl:hidden"><ArrowLeft className="size-4" />Volver a la lista</button>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div><div className="flex items-center gap-2"><Landmark className="size-5 text-white/70" /><h3 className="text-[22px] font-semibold tracking-[-0.02em]">{c.banco}{c.cuenta_bancaria ? ` · ${c.cuenta_bancaria}` : ''}</h3></div>
                            <p className="mt-1 text-[14px] text-white/65">Del {dmy(c.desde)} al {dmy(c.hasta)} · cuenta {c.cuenta}{c.archivo ? ` · ${c.archivo}` : ''}</p></div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${cerrada ? 'bg-white text-ink' : 'bg-signal text-ink'}`}>{cerrada ? `Cerrada el ${dmy(c.cerrada_at)}` : 'Borrador'}</span>
                    </div>
                </div>
                <div className="p-5 sm:p-6">
                    <div className="flex flex-wrap gap-2">
                        {!cerrada && <button onClick={() => setModal({ t: 'importar' })} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper"><Upload className="size-4" />Subir estado de cuenta</button>}
                        {!cerrada && <button disabled={ocupado || !nPend} onClick={() => act('POST', '/cruzar-auto', {}, (x) => (x.cruzadas ? `Se cruzaron ${x.cruzadas} movimientos con ${x.asientos} asientos.` : 'No se encontró ningún cruce exacto. Empareja a mano o sube la tolerancia de días.'))} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-[14px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"><Wand2 className="size-4" />Cruzar automáticamente</button>}
                        <button onClick={() => setModal({ t: 'pdf' })} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper"><FileDown className="size-4" />Acta en PDF</button>
                        {!cerrada && <button onClick={() => setModal({ t: 'borrar' })} className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-[14px] font-semibold text-danger hover:bg-[#fde8e6]"><Trash2 className="size-4" />Borrar</button>}
                    </div>
                    {aviso && <p className="mt-3 flex items-center gap-2 rounded-lg bg-[#d8f1e3] px-3 py-2 text-[14px] text-ok"><CircleCheck className="size-4 shrink-0" />{aviso}</p>}
                    {error && <p className="mt-3 flex items-start gap-2 rounded-lg bg-[#fde8e6] px-3 py-2 text-[14px] text-danger"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><span className="flex-1">{error}</span><button onClick={() => setError('')} aria-label="Cerrar aviso"><X className="size-4" /></button></p>}

                    <div className="mt-5 grid gap-5 md:grid-cols-2">
                        <div className="rounded-xl border border-line p-4"><h4 className="mb-1 text-[15px] font-semibold">Según tu libro</h4>
                            <Fila k={`Saldo al ${corto(c.hasta)}`} v={r.saldo_libros} /><Fila k="Abonos del banco sin registrar" v={r.ajustes_abonos} /><Fila k="Cargos del banco sin registrar" v={r.ajustes_cargos} /><Fila k="Saldo ajustado" v={r.saldo_libros_ajustado} fuerte /></div>
                        <div className="rounded-xl border border-line p-4"><h4 className="mb-1 text-[15px] font-semibold">Según el banco</h4>
                            <div className="flex items-center justify-between gap-3 py-1.5 text-[14px]"><label htmlFor="saldo-banco" className="text-muted">Saldo final del estado de cuenta</label>
                                <input id="saldo-banco" value={saldo} disabled={cerrada || ocupado} onChange={(e) => setSaldo(e.target.value)} onBlur={guardarSaldo} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} inputMode="decimal" placeholder="0,00" className="num h-9 w-36 rounded-lg border border-line bg-white px-2.5 text-right text-[14px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:bg-paper" /></div>
                            <Fila k="Depósitos en tránsito" v={r.depositos_transito} /><Fila k="Pagos en tránsito" v={r.pagos_transito} /><Fila k="Saldo ajustado" v={r.saldo_banco_ajustado} fuerte /></div>
                    </div>
                    <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 ${cuadra ? 'bg-[#d8f1e3]' : 'bg-paper'}`}>
                        <div className="flex items-center gap-3"><Semaforo k={cuadra ? 'CUADRA' : 'NO_CUADRA'} />
                            <span className="text-[14px]">{r.saldo_banco === null ? 'Escribe el saldo final del estado de cuenta para ver si cuadra.' : cuadra ? 'Los dos saldos ajustados son iguales.' : nPend ? `Faltan ${nPend} movimiento${nPend === 1 ? '' : 's'} del banco por cruzar o clasificar.` : `Diferencia de Bs ${monto(r.diferencia)} entre libros y banco.`}</span></div>
                        {!cerrada && <button disabled={!cuadra || ocupado} onClick={() => setModal({ t: 'cerrar' })} className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-[14px] font-semibold text-white hover:bg-black disabled:opacity-40"><ShieldCheck className="size-4" />Cerrar acta</button>}
                    </div>
                </div>
            </Card>

            {!cerrada && lineaSel && (
                <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand bg-brand-50 px-4 py-3 shadow-sm">
                    <div className="text-[14px]"><b>{lineaSel.descripcion || lineaSel.referencia || 'Movimiento'}</b> · <Num v={lineaSel.monto} />
                        <span className="ml-2 text-muted">{selL.length ? <>Seleccionaste {selL.length} asiento{selL.length === 1 ? '' : 's'} por <Num v={sumaSel} neg={false} />{iguales ? <span className="ml-1 font-semibold text-ok">· coincide</span> : <span className="ml-1 font-semibold text-danger">· diferencia {monto(Math.round((lineaSel.monto - sumaSel) * 100) / 100)}</span>}</> : 'Marca a la derecha el o los asientos que lo componen.'}</span></div>
                    <div className="flex gap-2"><button disabled={!iguales || ocupado} onClick={() => act('POST', '/cruzar', { linea_id: lineaSel.id, asientos: selL }, () => 'Movimiento emparejado.')} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[14px] font-semibold text-white hover:bg-brand-600 disabled:opacity-40"><Link2 className="size-4" />Emparejar</button>
                        <button onClick={() => setModal({ t: 'clasificar', linea: lineaSel })} className="inline-flex h-9 items-center rounded-lg border border-line bg-white px-3.5 text-[14px] font-semibold hover:bg-paper">No tiene asiento…</button>
                        <button onClick={() => { setSelB(null); setSelL([]); }} aria-label="Quitar selección" className="grid size-9 place-items-center rounded-lg hover:bg-white"><X className="size-4" /></button></div>
                </div>
            )}

            <div className="grid items-start gap-5 xl:grid-cols-2">
                <Card>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3"><h4 className="px-1 text-[15px] font-semibold">Estado de cuenta del banco</h4>
                        <div className="flex flex-wrap gap-1"><Pestana v="pendientes" set={setFBanco} t="Pendientes" n={nPend} activo={fBanco === 'pendientes'} /><Pestana v="cruzados" set={setFBanco} t="Cruzados" n={conteo('CRUZADA')} activo={fBanco === 'cruzados'} /><Pestana v="ajustes" set={setFBanco} t="Ajustes" n={conteo('AJUSTE')} activo={fBanco === 'ajustes'} /><Pestana v="todos" set={setFBanco} t="Todos" activo={fBanco === 'todos'} /></div></div>
                    {!banco.length ? <Vacio icon={Landmark} titulo={c.movimientos.length ? 'Nada en esta pestaña' : 'Aún no hay estado de cuenta'} texto={c.movimientos.length ? 'Cambia de pestaña para ver los demás movimientos.' : 'Sube el archivo del banco (CSV o Excel) para empezar a cruzar.'}>{!c.movimientos.length && !cerrada && <Button onClick={() => setModal({ t: 'importar' })}><Upload className="size-4" />Subir estado de cuenta</Button>}</Vacio> : (
                        <ul>{banco.slice(0, limB).map((l) => (
                            <li key={l.id} className="border-b border-line last:border-0">
                                <div role={l.estado === 'PENDIENTE' && !cerrada ? 'button' : undefined} tabIndex={l.estado === 'PENDIENTE' && !cerrada ? 0 : undefined} onClick={() => l.estado === 'PENDIENTE' && !cerrada && setSelB(l.id === selB ? null : l.id)} onKeyDown={(e) => e.key === 'Enter' && l.estado === 'PENDIENTE' && !cerrada && setSelB(l.id)}
                                    className={`flex items-center gap-3 px-4 py-3 ${l.id === selB ? 'bg-brand-50' : l.estado === 'PENDIENTE' && !cerrada ? 'cursor-pointer hover:bg-paper' : ''}`}>
                                    <span className="w-11 shrink-0 text-[13px] text-muted">{corto(l.fecha)}</span>
                                    <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{l.descripcion || l.referencia || 'Sin descripción'}</span>
                                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">{l.referencia && l.descripcion ? <span>Ref. {l.referencia}</span> : null}
                                            {l.estado === 'CRUZADA' && <span className="rounded-full bg-[#d8f1e3] px-2 py-0.5 font-semibold text-ok">Cruzado{l.metodo === 'MANUAL' ? ' a mano' : ''} · {l.asientos.length} asiento{l.asientos.length === 1 ? '' : 's'}</span>}
                                            {l.estado === 'AJUSTE' && <span className="rounded-full bg-[#e8edff] px-2 py-0.5 font-semibold text-brand">{clases[l.clase]}</span>}
                                            {l.estado === 'PENDIENTE' && <span className="rounded-full bg-[#fff4d6] px-2 py-0.5 font-semibold text-[#7a5600]">Pendiente</span>}</span></span>
                                    <Num v={l.monto} className="shrink-0 text-[14px] font-medium" />
                                    {!cerrada && l.estado !== 'PENDIENTE' && <button onClick={(e) => { e.stopPropagation(); l.estado === 'CRUZADA' ? act('POST', '/descruzar', { linea_id: l.id }) : act('POST', '/clasificar', { linea_id: l.id, clase: null }); }} aria-label={l.estado === 'CRUZADA' ? 'Deshacer cruce' : 'Quitar clasificación'} title={l.estado === 'CRUZADA' ? 'Deshacer cruce' : 'Quitar clasificación'} className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-paper hover:text-text"><Undo2 className="size-4" /></button>}
                                </div>
                            </li>))}</ul>)}
                    {banco.length > limB && <button onClick={() => setLimB(limB + 200)} className="w-full border-t border-line py-3 text-[14px] font-semibold text-brand hover:bg-paper">Mostrar más ({banco.length - limB})</button>}
                </Card>

                <Card>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3"><h4 className="px-1 text-[15px] font-semibold">Asientos del libro · {c.cuenta.split(' ')[0]}</h4>
                        <div className="flex gap-1"><Pestana v="sin" set={setFLibro} t="Sin cruzar" n={c.libro.filter((l) => l.estado === 'SIN_CRUZAR').length} activo={fLibro === 'sin'} /><Pestana v="cruzados" set={setFLibro} t="Cruzados" activo={fLibro === 'cruzados'} /></div></div>
                    {!cerrada && selL.length > 0 && !lineaSel && (
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper px-4 py-2.5 text-[13px]"><span>{selL.length} asiento{selL.length === 1 ? '' : 's'} · <Num v={sumaSel} neg={false} /></span>
                            <button disabled={ocupado} onClick={() => act('POST', '/anterior', { asientos: selL }, () => 'Marcados como conciliados antes de usar el sistema.')} className="font-semibold text-brand hover:underline">Ya estaban conciliados antes</button></div>)}
                    {!libro.length ? <Vacio icon={Check} titulo={fLibro === 'sin' ? 'Todo el libro está cruzado' : 'Nada cruzado todavía'} texto={fLibro === 'sin' ? 'No quedan asientos de la cuenta sin emparejar con el banco.' : 'Aquí aparecen los asientos ya emparejados.'} /> : (
                        <ul>{libro.slice(0, limL).map((l) => {
                            const marcado = selL.includes(l.id), igual = lineaSel && cents(l.monto) === cents(lineaSel.monto) && l.estado === 'SIN_CRUZAR';
                            const habilitado = !cerrada && l.estado === 'SIN_CRUZAR';
                            return (
                                <li key={l.id} className="border-b border-line last:border-0">
                                    <label className={`flex items-center gap-3 px-4 py-3 ${habilitado ? 'cursor-pointer hover:bg-paper' : ''} ${marcado ? 'bg-brand-50' : ''}`}>
                                        {habilitado ? <input type="checkbox" checked={marcado} onChange={() => alternar(l.id)} className="size-4 shrink-0 accent-[#1e4fd6]" /> : <span className="size-4 shrink-0" />}
                                        <span className="w-11 shrink-0 text-[13px] text-muted">{corto(l.fecha)}</span>
                                        <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{l.concepto}</span>
                                            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted"><span>Asiento N.º {l.asiento}</span>{igual && <span className="rounded-full bg-[#d8f1e3] px-2 py-0.5 font-semibold text-ok">Mismo monto</span>}{l.estado === 'ANTERIOR' && <span className="rounded-full bg-paper px-2 py-0.5 font-semibold">Conciliado antes</span>}{l.estado === 'CRUZADO' && <span className="rounded-full bg-[#d8f1e3] px-2 py-0.5 font-semibold text-ok">Cruzado</span>}</span></span>
                                        <Num v={l.monto} className="shrink-0 text-[14px] font-medium" />
                                        {!cerrada && l.estado === 'ANTERIOR' && <button type="button" onClick={(e) => { e.preventDefault(); act('POST', '/descruzar', { asiento_id: l.id }); }} aria-label="Deshacer" className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-white"><Undo2 className="size-4" /></button>}
                                    </label>
                                </li>);
                        })}</ul>)}
                    {libro.length > limL && <button onClick={() => setLimL(limL + 200)} className="w-full border-t border-line py-3 text-[14px] font-semibold text-brand hover:bg-paper">Mostrar más ({libro.length - limL})</button>}
                </Card>
            </div>

            {modal?.t === 'importar' && <ImportarExtracto conc={c} cerrar={() => setModal(null)} listo={(x) => { onCambio(x.conciliacion); setModal(null); setAviso(`Se importaron ${x.nuevas} movimientos${x.repetidas ? ` (${x.repetidas} ya estaban)` : ''}${x.fuera_periodo ? `; ${x.fuera_periodo} quedaron fuera del período` : ''}.`); }} />}
            {modal?.t === 'clasificar' && <ModalClasificar linea={modal.linea} clases={clases} cerrar={() => setModal(null)} guardar={async (id, clase, nota) => { const x = await act('POST', '/clasificar', { linea_id: id, clase, nota }); if (x) setModal(null); }} />}
            {modal?.t === 'cerrar' && (
                <Modal titulo="Cerrar el acta" subtitulo="Al cerrarla queda como documento firmable y ya no se puede cambiar." cerrar={() => setModal(null)} ok="Cerrar acta" enviando={ocupado} onSubmit={async () => { const x = await act('POST', '/cerrar', {}); if (x) setModal(null); }}>
                    <p className="text-[14px] text-muted">Saldo ajustado en libros y en banco: <b className="num text-text">Bs {monto(r.saldo_libros_ajustado)}</b>. Los asientos emparejados no podrán usarse en otra conciliación.</p>
                    {r.ajustes_abonos !== 0 || r.ajustes_cargos !== 0 ? <p className="rounded-lg bg-[#fff4d6] p-3 text-[13px] text-[#7a5600]">Recuerda registrar en Contabilidad los ajustes del banco (comisiones, notas) con un asiento manual: el acta los lista como «por registrar en libros».</p> : null}
                </Modal>)}
            {modal?.t === 'borrar' && (
                <Modal titulo="Borrar conciliación" subtitulo={`${c.banco} · ${dmy(c.desde)} al ${dmy(c.hasta)}`} cerrar={() => setModal(null)} ok="Borrar" peligro enviando={ocupado} onSubmit={async () => { const x = await act('DELETE', '', undefined); if (x) onBorrada(); }}>
                    <p className="text-[14px] text-muted">Se borra el estado de cuenta importado y los emparejamientos. Tus asientos contables no se tocan.</p>
                </Modal>)}
            {modal?.t === 'pdf' && (
                <ModalPdf titulo="Acta de conciliación bancaria" subtitulo={cerrada ? 'Documento para imprimir, firmar y archivar.' : 'El acta está en borrador: el PDF lo indica hasta que la cierres.'} folioInicial={c.folio_inicial} cerrar={() => setModal(null)}
                    generar={async ({ folio, contador }) => { const d = await http('GET', `/conciliacion/bancaria/${c.id}/acta`); const lib = await import('../../lib/pdfConciliacion'); if (folio !== c.folio_inicial && !cerrada) http('PUT', `/conciliacion/bancaria/${c.id}`, { folio_inicial: folio }).catch(() => {}); return { doc: await lib.pdfActaBancaria(d, { folio, contador }), archivo: `acta-conciliacion-${c.banco.toLowerCase().replace(/\W+/g, '-')}-${c.hasta}.pdf` }; }} />)}
        </div>
    );
}

/* ───────── Pestaña: lista + mesa ───────── */
export default function Bancaria({ lista, actual, setActual, refrescar, clases, emisor, hoy, cuentaBancos }) {
    const [nueva, setNueva] = useState(false); const [movil, setMovil] = useState(!!actual);
    const abrir = async (id) => { try { const d = await http('GET', `/conciliacion/bancaria/${id}`); setActual(d); setMovil(true); } catch { /* se queda en la lista */ } };
    return (
        <div className="grid items-start gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
            <Card className={movil ? 'hidden xl:block' : ''}>
                <div className="flex items-center justify-between gap-3 border-b border-line p-4"><h3 className="text-[16px] font-semibold">Conciliaciones</h3><Button className="!h-9 !px-3.5 !text-[14px]" onClick={() => setNueva(true)}><Plus className="size-4" />Nueva</Button></div>
                {!lista.length ? <Vacio icon={Landmark} titulo="Aún no has conciliado el banco" texto="Sube el estado de cuenta de un mes y el sistema lo cruza con tu libro."><Button onClick={() => setNueva(true)}><Plus className="size-4" />Nueva conciliación</Button></Vacio> : (
                    <ul>{lista.map((x) => (
                        <li key={x.id} className="border-b border-line last:border-0"><button onClick={() => abrir(x.id)} className={`w-full px-4 py-3.5 text-left ${actual?.id === x.id ? 'bg-brand-50/60' : 'hover:bg-paper'}`}>
                            <div className="flex items-center justify-between gap-2"><span className="truncate text-[15px] font-semibold">{x.banco}{x.cuenta_bancaria ? ` · ${x.cuenta_bancaria}` : ''}</span><EstadoChip c={x} /></div>
                            <div className="mt-0.5 text-[13px] text-muted">{dmy(x.desde)} al {dmy(x.hasta)}</div>
                            <div className="mt-1.5 text-[13px]">{x.estado === 'CERRADA' ? <span className="text-ok">Cuadró</span> : !x.lineas ? <span className="text-muted">Sin estado de cuenta</span> : x.pendientes ? <span className="text-[#7a5600]">{x.pendientes} por resolver</span> : x.diferencia === null ? <span className="text-muted">Falta el saldo del banco</span> : Math.abs(x.diferencia) < 0.005 ? <span className="text-ok">Lista para cerrar</span> : <span className="text-danger">Diferencia {monto(x.diferencia)}</span>}</div></button></li>))}</ul>)}
            </Card>
            <div className={movil ? '' : 'hidden xl:block'}>
                {actual ? <Mesa key={actual.id} c={actual} clases={clases} emisor={emisor} hoy={hoy} onCambio={(d) => { setActual(d); refrescar(); }} onVolver={() => setMovil(false)} onBorrada={() => { setActual(null); setMovil(false); refrescar(); }} />
                    : <Card className="min-h-[420px]"><Vacio icon={Landmark} titulo="Elige una conciliación" texto="Verás el estado de cuenta frente a tu libro, lo que ya cruzó y lo que falta." /></Card>}
            </div>
            {nueva && <ModalNueva cuenta={cuentaBancos} hoy={hoy} cerrar={() => setNueva(false)} creada={(d) => { setNueva(false); setActual(d); setMovil(true); refrescar(); }} />}
        </div>
    );
}
