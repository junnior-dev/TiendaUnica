import { Head, router } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import { Banknote, BookOpen, CreditCard, Info, Landmark, Lock, Pencil, Percent, Plus, Power, Smartphone, Trash2, TriangleAlert, Wallet } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Chip, IconBtn, Kpi, Modal, Switch, Vacio } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { n0, n2 } from '../../lib/format';

/* Plantillas: un clic y el método queda configurado como suele estar en Venezuela. */
const PLANTILLAS = [
    { t: 'Efectivo en dólares', nombre: 'Efectivo USD', moneda: 'USD', efectivo: true, referencia: false, igtf: true },
    { t: 'Zelle', nombre: 'Zelle', moneda: 'USD', efectivo: false, referencia: true, igtf: true },
    { t: 'Efectivo en bolívares', nombre: 'Efectivo Bs', moneda: 'VES', efectivo: true, referencia: false, igtf: false },
    { t: 'Pago móvil', nombre: 'Pago móvil', moneda: 'VES', efectivo: false, referencia: true, igtf: false },
    { t: 'Punto de venta', nombre: 'Punto de venta', moneda: 'VES', efectivo: false, referencia: true, igtf: false },
    { t: 'Transferencia en bolívares', nombre: 'Transferencia Bs', moneda: 'VES', efectivo: false, referencia: true, igtf: false },
    { t: 'Cuenta en dólares en un banco del país', nombre: 'Cuenta en USD (banco del país)', moneda: 'USD', efectivo: false, referencia: true, igtf: false },
];

const vacio = (moneda = 'USD') => ({ nombre: '', moneda, efectivo: moneda === 'VES' ? false : true, referencia: false, igtf: moneda !== 'VES', cuenta_id: '' });
const desde = (m) => ({ id: m.id, nombre: m.nombre, moneda: m.moneda, efectivo: m.es_efectivo, referencia: m.requiere_referencia, igtf: m.aplica_igtf, cuenta_id: m.cuenta_id ?? '' });

const Etiqueta = ({ icon: Icon, children, tono = 'gris' }) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${tono === 'azul' ? 'bg-brand-50 text-brand' : tono === 'ambar' ? 'bg-signal/15 text-[#8a5a00]' : 'bg-paper text-muted'}`}><Icon className="size-3.5" />{children}</span>
);

function Opcion({ icon: Icon, titulo, texto, on, set, deshabilitado, aviso }) {
    return (
        <div className={`flex items-start gap-3 rounded-xl border p-3.5 ${on ? 'border-brand/40 bg-brand-50/50' : 'border-line'} ${deshabilitado ? 'opacity-60' : ''}`}>
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white text-brand ring-1 ring-line"><Icon className="size-4" /></span>
            <div className="min-w-0 flex-1"><p className="text-[14.5px] font-semibold">{titulo}</p><p className="mt-0.5 text-[13px] leading-snug text-muted">{texto}</p>{aviso && <p className="mt-1.5 text-[12.5px] leading-snug text-[#8a5a00]">{aviso}</p>}</div>
            <div className={deshabilitado ? 'pointer-events-none' : ''}><Switch on={on} set={set} label={titulo} /></div>
        </div>
    );
}

export default function MetodosPago({ negocio, usuario, fecha_larga, stock_bajo, tasa_usd, metodos, monedas, cuentas, igtf, turnos_abiertos }) {
    const [ver, setVer] = useState('activos');
    const [edit, setEdit] = useState(null); const [borrar, setBorrar] = useState(null);
    const [enviando, setEnviando] = useState(false); const [errores, setErrores] = useState({});
    const activos = metodos.filter((m) => m.activo);
    const lista = useMemo(() => metodos.filter((m) => ver === 'todos' || (ver === 'activos') === m.activo), [metodos, ver]);
    const grupos = useMemo(() => {
        const g = {}; lista.forEach((m) => { (g[m.moneda] ||= []).push(m); });
        return Object.entries(g);
    }, [lista]);
    const opts = { preserveScroll: true, onStart: () => setEnviando(true), onFinish: () => setEnviando(false) };
    const cerrar = () => { setEdit(null); setBorrar(null); setErrores({}); };

    const esNuevo = edit && !edit.id;
    const enUso = edit?.id ? (() => { const m = metodos.find((x) => x.id === edit.id); return m ? Number(m.pagos_ventas) + Number(m.pagos_cobros) > 0 : false; })() : false;
    const bloqueoTurno = !!edit?.id && turnos_abiertos > 0;      // la base no deja cambiar «efectivo» ni «IGTF» con turnos abiertos
    const divisa = edit && edit.moneda !== 'VES';

    const cambiar = (patch) => setEdit((e) => {
        const n = { ...e, ...patch };
        if (patch.moneda) { if (patch.moneda === 'VES') n.igtf = false; else if (e.moneda === 'VES' && esNuevo) n.igtf = true; }
        if (patch.efectivo === true) n.referencia = false;
        if (patch.efectivo === false && esNuevo) n.referencia = true;
        return n;
    });
    const guardar = () => {
        if (edit.nombre.trim().length < 2) return setErrores({ nombre: 'Escribe el nombre del método.' });
        const datos = { nombre: edit.nombre.trim(), moneda: edit.moneda, es_efectivo: edit.efectivo, requiere_referencia: edit.referencia, aplica_igtf: divisa && edit.igtf, cuenta_id: edit.cuenta_id || null };
        const o = { ...opts, onSuccess: cerrar, onError: (er) => setErrores(er) };
        edit.id ? router.put(`/metodos-pago/${edit.id}`, datos, o) : router.post('/metodos-pago', datos, o);
    };

    const ejemplo = edit && (() => {
        const cobra = divisa && edit.igtf && igtf.cobra, pct = igtf.pct, monto = 100, ig = cobra ? Math.round(monto * pct) / 100 : 0;
        return { cobra, monto, ig, total: monto + ig };
    })();

    return (
        <AppLayout actual="/metodos-pago" titulo="Métodos de pago" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Métodos de pago" />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Métodos de pago</h2><p className="mt-1 max-w-[64ch] text-[15px] text-muted">Las formas en que te pagan tus clientes. Cada método decide solo si es efectivo, si pide referencia y si causa IGTF: el cajero ya no tiene que adivinarlo.</p></div>
                <Button onClick={() => setEdit(vacio())}><Plus className="size-4" />Nuevo método</Button>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Kpi icon={CreditCard} titulo="Métodos activos" valor={n0(activos.length)} detalle={`${metodos.length - activos.length} desactivado${metodos.length - activos.length === 1 ? '' : 's'}`} />
                <Kpi icon={Banknote} titulo="Efectivo (arqueo)" valor={n0(activos.filter((m) => m.es_efectivo).length)} detalle="Entran a la gaveta y al Corte Z" />
                <Kpi icon={Percent} tono={igtf.cobra ? undefined : 'warn'} titulo="Causan IGTF" valor={n0(activos.filter((m) => m.aplica_igtf).length)} detalle={igtf.cobra ? `Alícuota vigente: ${String(igtf.pct).replace('.', ',')} %` : 'Tu negocio no cobra IGTF'} />
                <Kpi icon={Landmark} titulo="Con cuenta contable" valor={n0(activos.filter((m) => m.cuenta_id).length)} detalle="El resto usa Caja o Bancos" />
            </div>

            {!igtf.cobra && metodos.some((m) => m.aplica_igtf) && (
                <p className="mb-4 flex items-start gap-2 rounded-xl bg-signal/15 px-4 py-3 text-[13.5px] leading-snug text-[#6f4a00]"><TriangleAlert className="mt-0.5 size-4 shrink-0" />Hay métodos marcados con IGTF, pero en Configuración tu negocio figura como que no cobra IGTF (solo los contribuyentes especiales lo perciben). Mientras tanto no se cobra IGTF en ninguno.</p>)}
            {turnos_abiertos > 0 && (
                <p className="mb-4 flex items-start gap-2 rounded-xl bg-paper px-4 py-3 text-[13.5px] leading-snug text-muted"><Lock className="mt-0.5 size-4 shrink-0" />Hay {turnos_abiertos} {turnos_abiertos === 1 ? 'turno de caja abierto' : 'turnos de caja abiertos'}. Puedes crear métodos y cambiar nombres, pero «efectivo» e «IGTF» de un método existente se pueden cambiar cuando se cierren los turnos: así el arqueo no se descuadra.</p>)}

            <Card>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:p-5">
                    <div role="radiogroup" aria-label="Estado" className="inline-flex rounded-lg bg-[#e9ecf0] p-1 text-[13px]">
                        {[['activos', 'Activos'], ['inactivos', 'Desactivados'], ['todos', 'Todos']].map(([k, l]) => <button key={k} role="radio" aria-checked={ver === k} onClick={() => setVer(k)} className={`rounded-md px-3 py-1.5 font-medium ${ver === k ? 'bg-white shadow-sm' : 'text-muted hover:text-text'}`}>{l}</button>)}
                    </div>
                    <p className="flex items-center gap-1.5 text-[13px] text-muted"><Info className="size-4" />Un método con ventas o cobros no se borra: se desactiva y se conserva su historial.</p>
                </div>
                {lista.length === 0 ? <Vacio icon={CreditCard} titulo="No hay métodos que mostrar" texto="Crea el primero: puedes partir de una plantilla (Zelle, pago móvil, efectivo…)."><Button onClick={() => setEdit(vacio())}><Plus className="size-4" />Nuevo método</Button></Vacio> : (
                    grupos.map(([moneda, filas]) => (
                        <div key={moneda}>
                            <div className="flex items-center gap-2 border-b border-line bg-paper/60 px-5 py-2"><Chip m={moneda} size="sm" /><span className="text-[13px] font-semibold text-muted">{monedas.find((x) => x.codigo === moneda)?.nombre ?? moneda}</span></div>
                            <ul className="divide-y divide-line">
                                {filas.map((m) => {
                                    const usos = Number(m.pagos_ventas) + Number(m.pagos_cobros);
                                    return (
                                        <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                                            <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${m.activo ? 'bg-ink text-white' : 'bg-paper text-muted'}`} aria-hidden>{m.es_efectivo ? <Banknote className="size-5" /> : m.moneda === 'VES' ? <Smartphone className="size-5" /> : <Landmark className="size-5" />}</span>
                                            <div className="min-w-[200px] flex-1">
                                                <p className={`text-[15px] font-semibold ${m.activo ? '' : 'text-muted'}`}>{m.nombre}{!m.activo && <span className="ml-2 text-[13px] font-normal">Desactivado</span>}</p>
                                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                                    <Etiqueta icon={m.es_efectivo ? Wallet : Landmark} tono={m.es_efectivo ? 'azul' : 'gris'}>{m.es_efectivo ? 'Efectivo: cuenta en el arqueo' : 'Banco o app: no mueve la gaveta'}</Etiqueta>
                                                    {m.requiere_referencia && <Etiqueta icon={BookOpen}>Pide referencia</Etiqueta>}
                                                    {m.aplica_igtf && <Etiqueta icon={Percent} tono="ambar">Causa IGTF</Etiqueta>}
                                                </div>
                                                <p className="mt-1.5 text-[12.5px] text-muted">{m.cuenta_codigo ? `Contabilidad: ${m.cuenta_codigo} ${m.cuenta_nombre}` : `Contabilidad: ${m.es_efectivo ? 'Caja' : 'Bancos'} (automático)`} · {usos > 0 ? `${n0(usos)} ${usos === 1 ? 'uso' : 'usos'}` : 'Sin usos todavía'}</p>
                                            </div>
                                            <div className="flex shrink-0">
                                                <IconBtn icon={Pencil} label={`Editar ${m.nombre}`} onClick={() => setEdit(desde(m))} />
                                                <IconBtn icon={Power} label={m.activo ? `Desactivar ${m.nombre}` : `Activar ${m.nombre}`} onClick={() => router.patch(`/metodos-pago/${m.id}/estado`, { activo: !m.activo }, { preserveScroll: true, onError: (er) => setErrores(er) })} />
                                                <IconBtn icon={Trash2} tone="danger" label={usos ? 'No se puede eliminar: tiene movimientos' : `Eliminar ${m.nombre}`} onClick={() => setBorrar(m)} disabled={usos > 0} />
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )))}
                {errores.general && !edit && !borrar && <p role="alert" className="border-t border-line bg-[#fdecec] px-5 py-3 text-[14px] text-danger">{errores.general}</p>}
            </Card>

            {edit && (
                <Modal titulo={esNuevo ? 'Nuevo método de pago' : `Editar ${edit.nombre || 'método'}`} subtitulo="Responde tres preguntas y listo." cerrar={cerrar} onSubmit={guardar} enviando={enviando} ok={esNuevo ? 'Crear método' : 'Guardar cambios'} ancho="max-w-[560px]">
                    {errores.general && <p role="alert" className="rounded-lg bg-[#fdecec] p-3 text-[14px] text-danger">{errores.general}</p>}
                    {esNuevo && (
                        <div>
                            <p className="mb-2 text-[13px] font-medium text-muted">Empieza desde una plantilla</p>
                            <div className="flex flex-wrap gap-2">{PLANTILLAS.map((p) => <button type="button" key={p.nombre} onClick={() => setEdit({ ...edit, nombre: p.nombre, moneda: p.moneda, efectivo: p.efectivo, referencia: p.referencia, igtf: p.igtf })} className="rounded-full border border-line px-3 py-1.5 text-[13px] font-medium hover:border-brand hover:text-brand">{p.t}</button>)}</div>
                        </div>)}
                    <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
                        <Field label="Nombre (como lo ve el cajero)" icon={CreditCard} value={edit.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} error={errores.nombre} autoFocus maxLength={60} />
                        <Field select label="Moneda" value={edit.moneda} onChange={(e) => cambiar({ moneda: e.target.value })} disabled={enUso} hint={enUso ? 'Ya tiene movimientos' : undefined}>{monedas.map((m) => <option key={m.codigo} value={m.codigo}>{m.codigo}</option>)}</Field>
                    </div>

                    <div className="grid gap-3">
                        <Opcion icon={Banknote} titulo="Es dinero en efectivo" texto="Billetes que el cajero guarda en la gaveta. Cuenta en el arqueo y exige turno abierto para cobrar." on={edit.efectivo} set={(v) => cambiar({ efectivo: v })} deshabilitado={bloqueoTurno}
                            aviso={bloqueoTurno ? 'Se puede cambiar cuando cierres los turnos abiertos.' : undefined} />
                        {!edit.efectivo && <Opcion icon={BookOpen} titulo="Pedir número de referencia" texto="Para transferencias, pago móvil, Zelle o punto de venta: el cajero debe anotar el comprobante." on={edit.referencia} set={(v) => cambiar({ referencia: v })} />}
                        {divisa && <Opcion icon={Percent} titulo={`Cobrar IGTF${igtf.cobra ? ` (${String(igtf.pct).replace('.', ',')} %)` : ''}`}
                            texto="Actívalo si la divisa llega fuera de un banco venezolano: efectivo en divisas, Zelle, PayPal. Desactívalo si entra a una cuenta en divisas de un banco del país (el banco percibe el impuesto)."
                            on={edit.igtf} set={(v) => cambiar({ igtf: v })} deshabilitado={bloqueoTurno}
                            aviso={bloqueoTurno ? 'Se puede cambiar cuando cierres los turnos abiertos.' : !igtf.cobra ? 'Tu negocio no cobra IGTF (Configuración): esta marca no tendrá efecto hasta que lo cobres.' : 'Confirma con tu contador qué métodos aplican en tu caso.'} />}
                        {!divisa && <p className="flex items-start gap-2 px-1 text-[13px] leading-snug text-muted"><Info className="mt-0.5 size-4 shrink-0" />Los pagos en bolívares no causan IGTF.</p>}
                    </div>

                    <Field select label="Cuenta contable donde cae el dinero" value={edit.cuenta_id} onChange={(e) => cambiar({ cuenta_id: e.target.value })} forceFloat hint="«Automática» usa Caja para efectivo y Bancos para lo demás. Elige una cuenta si tienes un banco propio para este método.">
                        <option value="">Automática ({edit.efectivo ? 'Caja' : 'Bancos'})</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}</Field>

                    <div className="rounded-xl bg-paper p-3.5 text-[13.5px] leading-snug">
                        <p className="mb-1 font-semibold">Así se verá al cobrar {edit.moneda} {n2(ejemplo.monto)}</p>
                        <ul className="space-y-0.5 text-muted">
                            {ejemplo.cobra ? <li>El cliente entrega {edit.moneda} {n2(ejemplo.total)}: {n2(ejemplo.monto)} a la deuda y {n2(ejemplo.ig)} de IGTF.</li> : <li>El cliente entrega {edit.moneda} {n2(ejemplo.monto)}, todo a la deuda.</li>}
                            <li>{edit.efectivo ? 'Entra a la gaveta: suma al arqueo del Corte Z y se necesita un turno abierto.' : 'No mueve la gaveta: no entra al arqueo.'}</li>
                            {!edit.efectivo && <li>{edit.referencia ? 'El cajero debe escribir la referencia.' : 'No se pide referencia.'}</li>}
                        </ul>
                    </div>
                </Modal>)}
            {borrar && (
                <Modal titulo={`Eliminar ${borrar.nombre}`} subtitulo="Este método no tiene ventas ni cobros, así que se puede quitar sin afectar nada." peligro cerrar={cerrar} enviando={enviando} ok="Eliminar" onSubmit={() => router.delete(`/metodos-pago/${borrar.id}`, { ...opts, onSuccess: cerrar, onError: (er) => setErrores(er) })}>
                    <p className="text-sm">¿Quieres eliminarlo? Si prefieres conservarlo, desactívalo.</p>
                </Modal>)}
        </AppLayout>
    );
}
