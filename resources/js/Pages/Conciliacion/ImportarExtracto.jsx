import { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, TriangleAlert, Upload } from 'lucide-react';
import { Modal, Switch } from '../../Components/kit';
import { Field, Segmented } from '../../Components/ui';
import { CAMPOS, detectar, leerArchivo, normalizar } from '../../lib/leerExtracto';
import { http } from '../../lib/http';
import { dmy, monto } from './comun';

/**
 * Subir el estado de cuenta: el archivo se lee aquí (CSV o Excel), se reconoce qué columna es cada cosa y se muestra cómo quedaría
 * ANTES de importar. Si el banco usa otro formato, se corrige con los selectores. Al servidor solo viaja la lista ya normalizada.
 */
export default function ImportarExtracto({ conc, cerrar, listo }) {
    const [filas, setFilas] = useState(null); const [nombre, setNombre] = useState('');
    const [cab, setCab] = useState(-1); const [mapa, setMapa] = useState({}); const [modo, setModo] = useState('columnas'); const [invertir, setInvertir] = useState(false);
    const [err, setErr] = useState(''); const [env, setEnv] = useState(false); const [arrastre, setArrastre] = useState(false);
    const input = useRef(null);

    const cargar = async (file) => {
        if (!file) return;
        setErr('');
        try {
            const f = await leerArchivo(file); const d = detectar(f);
            setFilas(f); setNombre(file.name); setCab(d.cabecera); setMapa(d.mapa);
            setModo(d.mapa.debito !== undefined || d.mapa.credito !== undefined ? 'columnas' : 'signo');
        } catch (e) { setErr(e.message || 'No se pudo leer el archivo.'); }
    };

    const res = useMemo(() => (filas && mapa.fecha !== undefined && (modo === 'signo' ? mapa.monto !== undefined : mapa.debito !== undefined || mapa.credito !== undefined)
        ? normalizar(filas, { cabecera: cab, mapa, modo, invertir }) : null), [filas, cab, mapa, modo, invertir]);
    const dentro = res ? res.lineas.filter((l) => l.fecha >= conc.desde && l.fecha <= conc.hasta) : [];
    const fuera = res ? res.lineas.length - dentro.length : 0;
    const columnas = filas ? Math.max(...filas.slice(0, 40).map((f) => f.length)) : 0;
    const etiqueta = (j) => { const t = cab >= 0 ? filas[cab]?.[j] : ''; return `${String.fromCharCode(65 + (j % 26))}${t ? ` — ${String(t).slice(0, 22)}` : ''}`; };
    const selector = (campo, titulo) => (
        <Field select key={campo} label={titulo} forceFloat value={mapa[campo] ?? ''} onChange={(e) => setMapa((m) => { const n = { ...m }; if (e.target.value === '') delete n[campo]; else n[campo] = Number(e.target.value); return n; })}>
            <option value="">(ninguna)</option>
            {Array.from({ length: columnas }, (_, j) => <option key={j} value={j}>{etiqueta(j)}</option>)}
        </Field>
    );

    const enviar = async () => {
        if (!res || !dentro.length) return setErr('No hay movimientos para importar con esa configuración.');
        setEnv(true); setErr('');
        try { const r = await http('POST', `/conciliacion/bancaria/${conc.id}/importar`, { lineas: dentro, archivo: nombre, saldo_final: res.saldo_final }); listo(r); }
        catch (e) { setErr(e.errors?.lineas?.[0] || e.message || 'No se pudo importar.'); } finally { setEnv(false); }
    };

    return (
        <Modal titulo="Subir estado de cuenta" subtitulo={`${conc.banco} · del ${dmy(conc.desde)} al ${dmy(conc.hasta)}. Acepta CSV y Excel (.xlsx).`} cerrar={cerrar} onSubmit={enviar} enviando={env} ok={dentro.length ? `Importar ${dentro.length} movimientos` : 'Importar'} ancho="max-w-[760px]">
            {!filas ? (
                <button type="button" onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setArrastre(true); }} onDragLeave={() => setArrastre(false)}
                    onDrop={(e) => { e.preventDefault(); setArrastre(false); cargar(e.dataTransfer.files?.[0]); }}
                    className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${arrastre ? 'border-brand bg-brand-50/60' : 'border-line hover:border-[#b9c1ca]'}`}>
                    <span className="grid size-12 place-items-center rounded-full bg-paper"><Upload className="size-5 text-muted" /></span>
                    <span className="text-[15px] font-semibold">Arrastra el archivo aquí o elígelo</span>
                    <span className="max-w-[48ch] text-[13px] text-muted">Descarga el estado de cuenta desde la banca en línea (CSV o Excel). Necesita al menos fecha y monto.</span>
                </button>
            ) : (
                <>
                    <div className="flex items-center gap-3 rounded-lg bg-paper px-3 py-2.5 text-[14px]"><FileSpreadsheet className="size-4 shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate font-medium">{nombre}</span>
                        <button type="button" onClick={() => { setFilas(null); setErr(''); }} className="text-[13px] font-semibold text-brand hover:underline">Cambiar archivo</button></div>
                    <div>
                        <div className="mb-2 text-[14px] font-medium">¿Cómo trae el banco los montos?</div>
                        <Segmented compact name="Formato de montos" value={modo} onChange={setModo} options={[{ value: 'columnas', label: 'Débito y crédito' }, { value: 'signo', label: 'Una columna con signo' }]} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {CAMPOS.filter(([k]) => (modo === 'signo' ? k !== 'debito' && k !== 'credito' : k !== 'monto')).map(([k, t]) => selector(k, t))}
                    </div>
                    {modo === 'signo' && <label className="flex items-center justify-between gap-3 rounded-lg border border-line px-3.5 py-3"><span className="text-[14px]"><span className="font-medium">Mi banco muestra los cargos en positivo</span><span className="block text-[13px] text-muted">Actívalo si en la vista previa los depósitos salen negativos.</span></span><Switch on={invertir} set={setInvertir} label="Invertir signo" /></label>}
                    {res ? (
                        <div>
                            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
                                <span>Vista previa: {dentro.length} movimientos dentro del período{fuera ? ` · ${fuera} fuera (se descartan)` : ''}</span>
                                {res.saldo_final !== null && <span>Saldo final detectado: <b className="num text-text">Bs {monto(res.saldo_final)}</b></span>}
                            </div>
                            <div className="max-h-56 overflow-auto rounded-lg border border-line">
                                <table className="w-full min-w-[480px] text-left text-[13px]"><thead className="sticky top-0 bg-paper text-muted"><tr><th className="px-3 py-2 font-medium">Fecha</th><th className="px-3 py-2 font-medium">Referencia</th><th className="px-3 py-2 font-medium">Descripción</th><th className="px-3 py-2 text-right font-medium">Monto</th></tr></thead>
                                    <tbody>{dentro.slice(0, 8).map((l, i) => <tr key={i} className="border-t border-line"><td className="px-3 py-1.5 whitespace-nowrap">{dmy(l.fecha)}</td><td className="px-3 py-1.5">{l.referencia}</td><td className="max-w-[240px] truncate px-3 py-1.5">{l.descripcion}</td><td className={`num px-3 py-1.5 text-right ${l.monto < 0 ? 'text-danger' : ''}`}>{monto(l.monto)}</td></tr>)}</tbody></table>
                            </div>
                            {res.errores.length > 0 && <p className="mt-2 flex items-start gap-2 rounded-lg bg-[#fff4d6] p-3 text-[13px] text-[#7a5600]"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{res.errores[0]}{res.errores.length > 1 ? ` (y ${res.errores.length - 1} más)` : ''} Revisa las columnas elegidas.</p>}
                        </div>
                    ) : <p className="rounded-lg bg-paper p-3 text-[13px] text-muted">Elige la columna de la fecha y la del monto (o las de débito y crédito) para ver cómo quedaría.</p>}
                </>
            )}
            <input ref={input} type="file" accept=".csv,.txt,.xlsx" className="hidden" onChange={(e) => { cargar(e.target.files?.[0]); e.target.value = ''; }} />
            {err && <p className="flex items-start gap-2 rounded-lg bg-[#fde8e6] p-3 text-[14px] text-danger"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{err}</p>}
        </Modal>
    );
}
