import { ChevronLeft, ChevronRight } from 'lucide-react';

/* Pie de tabla: cuántas filas se ven, tamaño de página y anterior/siguiente.
   `meta` llega del servidor ({pagina, por_pagina, total, paginas}); `ir(cambios)` navega conservando los filtros. */
export default function Paginador({ meta, mostrados, ir, tamanos = [10, 25, 50] }) {
    const desde = meta.total ? (meta.pagina - 1) * meta.por_pagina + 1 : 0;
    const boton = 'inline-flex h-9 items-center gap-1 rounded-lg border border-line px-3 font-semibold text-text hover:bg-paper disabled:opacity-40';
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13.5px] text-muted">
            <span>{meta.total ? <>Mostrando <b className="num font-semibold text-text">{desde}–{desde + mostrados - 1}</b> de <b className="num font-semibold text-text">{meta.total}</b></> : 'Sin resultados'}</span>
            <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2">Filas por página
                    <select value={meta.por_pagina} onChange={(e) => ir({ por: e.target.value })} className="h-9 rounded-lg border border-line bg-white px-2 text-text">
                        {tamanos.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                </label>
                {meta.paginas > 1 && (
                    <div className="flex items-center gap-2">
                        <button type="button" disabled={meta.pagina <= 1} onClick={() => ir({ pagina: meta.pagina - 1 })} className={boton}><ChevronLeft className="size-4" />Anterior</button>
                        <span className="num">Página {meta.pagina} de {meta.paginas}</span>
                        <button type="button" disabled={meta.pagina >= meta.paginas} onClick={() => ir({ pagina: meta.pagina + 1 })} className={boton}>Siguiente<ChevronRight className="size-4" /></button>
                    </div>
                )}
            </div>
        </div>
    );
}
