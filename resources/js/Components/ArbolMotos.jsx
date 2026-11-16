import { useEffect, useMemo, useState } from 'react';
import { Bike, ChevronRight, PackageSearch, Search } from 'lucide-react';
import { n0 } from '../lib/format';

const sinTilde = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* Árbol marca → modelo, compartido por «Modelos de moto» y «Compatibilidad».
   Un clic en una marca la abre y la selecciona; un clic en un modelo lo selecciona. */
export default function ArbolMotos({ modelos, marca, modeloId, onMarca, onModelo, cabecera, vacio }) {
    const [q, setQ] = useState(''); const [soloSin, setSoloSin] = useState(false);
    const [abiertas, setAbiertas] = useState(() => new Set(marca ? [marca] : []));
    const grupos = useMemo(() => {
        const t = sinTilde(q).trim();
        const f = modelos.filter((m) => (!soloSin || m.productos === 0) && (!t || t.split(/\s+/).every((w) => sinTilde(`${m.marca} ${m.modelo} ${m.cilindrada ?? ''}`).includes(w))));
        return Object.entries(f.reduce((a, m) => ((a[m.marca] ??= []).push(m), a), {})).sort(([x], [y]) => x.localeCompare(y, 'es'))
            .map(([nombre, items]) => ({ nombre, items: items.sort((a, b) => a.modelo.localeCompare(b.modelo, 'es', { numeric: true })) }));
    }, [modelos, q, soloSin]);
    const sin = modelos.filter((m) => m.productos === 0).length;
    const buscando = q.trim() !== '' || soloSin;
    useEffect(() => { if (marca) setAbiertas((s) => new Set(s).add(marca)); }, [marca]);
    const alternar = (nombre) => setAbiertas((s) => { const n = new Set(s); n.has(nombre) ? n.delete(nombre) : n.add(nombre); return n; });

    return (
        <div className="flex min-h-0 flex-col rounded-2xl border border-line bg-white">
            {cabecera}
            <div className="space-y-2.5 border-b border-line p-3.5">
                <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Buscar moto" placeholder="Busca una moto: «bera 150»" className="h-10 w-full rounded-lg border border-line bg-paper pl-9 pr-3 text-sm placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" /></label>
                {sin > 0 && <button role="switch" aria-checked={soloSin} onClick={() => setSoloSin(!soloSin)} className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium ${soloSin ? 'border-brand bg-brand-50 text-brand' : 'border-line text-muted hover:bg-paper'}`}><PackageSearch className="size-3.5" />Solo las {sin} sin repuestos</button>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
                {grupos.length === 0 ? <p className="px-3 py-10 text-center text-sm text-muted">{vacio ?? 'No encontramos esa moto.'}</p> : (
                    <ul role="tree" aria-label="Marcas y modelos de moto" className="space-y-0.5">
                        {grupos.map((g) => {
                            const abierta = buscando || abiertas.has(g.nombre), sel = marca === g.nombre && !modeloId;
                            const total = g.items.reduce((a, m) => a + (m.productos > 0 ? 1 : 0), 0);
                            return (
                                <li key={g.nombre} role="none">
                                    <button role="treeitem" aria-expanded={abierta} aria-selected={sel} onClick={() => { onMarca?.(g.nombre); if (!buscando) alternar(g.nombre); }}
                                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${sel ? 'bg-brand-50' : 'hover:bg-paper'}`}>
                                        <ChevronRight className={`size-4 shrink-0 text-muted transition-transform ${abierta ? 'rotate-90' : ''}`} />
                                        <span className={`grid size-7 shrink-0 place-items-center rounded-md ${sel ? 'bg-brand text-white' : 'bg-ink text-white'}`}><Bike className="size-4" /></span>
                                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{g.nombre}</span>
                                        <span className="text-xs text-muted">{g.items.length}</span>
                                    </button>
                                    {abierta && (
                                        <ul role="group" className="ml-[22px] border-l border-line pl-2.5">
                                            {g.items.map((m) => {
                                                const on = modeloId === m.id;
                                                return (
                                                    <li key={m.id} role="none" className="relative">
                                                        <span aria-hidden className="absolute -left-2.5 top-1/2 h-px w-2.5 bg-line" />
                                                        <button role="treeitem" aria-selected={on} aria-current={on ? 'true' : undefined} onClick={() => onModelo(m)}
                                                            className={`relative flex w-full items-center gap-2 rounded-lg py-2 pl-3 pr-2.5 text-left text-sm ${on ? 'bg-brand-50 font-medium text-brand' : 'hover:bg-paper'}`}>
                                                            {on && <span aria-hidden className="absolute inset-y-1.5 left-0 w-1 rounded-r bg-brand" />}
                                                            <span className="min-w-0 flex-1 truncate">{m.modelo}{m.cilindrada ? <span className={`ml-1.5 text-xs font-normal ${on ? 'text-brand/70' : 'text-muted'}`}>{m.cilindrada} cc</span> : null}</span>
                                                            {m.productos > 0 ? <span className={`num rounded-full px-2 py-0.5 text-xs font-medium ${on ? 'bg-white text-brand' : 'bg-paper text-muted'}`}>{n0(m.productos)}</span>
                                                                : <span title="Sin repuestos asignados" className="size-2 rounded-full bg-signal" aria-label="Sin repuestos asignados" />}
                                                        </button>
                                                    </li>);
                                            })}
                                        </ul>)}
                                </li>);
                        })}
                    </ul>)}
            </div>
            <p className="border-t border-line px-4 py-2.5 text-xs text-muted"><span className="mr-1 inline-block size-2 rounded-full bg-signal align-middle" /> Sin repuestos asignados · el número es la cantidad de repuestos</p>
        </div>
    );
}
