import { useEffect, useMemo, useState } from 'react';
import { Switch } from './kit';
import { n2 } from '../lib/format';

const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const num = (s) => { const t = String(s ?? '').trim(); return t ? Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) : NaN; };
const bs = (v) => `Bs ${n2(v)}`;
const cant = (v) => new Intl.NumberFormat('es-VE', { maximumFractionDigits: 3 }).format(v);

/**
 * «El cliente devuelve la mercancía»: switch + productos de la venta + vista previa de lo que pasará al guardar.
 * Avisa al formulario con onChange({ devuelve, productos:[{producto_id,cantidad}], error }).
 * Solo aplica a notas de crédito; el costo de la vista previa usa la misma fórmula que la base (cantidad × costo congelado × tasa de la venta).
 */
export default function DevolucionNota({ ventaId, tipo, base, ivaPct, onChange }) {
    const [info, setInfo] = useState(null);           // { activo, productos }
    const [on, setOn] = useState(false);
    const [q, setQ] = useState({});                    // producto_id → texto

    useEffect(() => {
        setInfo(null); setOn(false); setQ({});
        if (!ventaId) return;
        let vivo = true;
        fetch(`/ventas/${ventaId}/devolvibles`, { headers: { Accept: 'application/json' } }).then((r) => r.json()).then((d) => {
            if (!vivo) return;
            setInfo(d);
            setQ(Object.fromEntries((d.productos || []).map((p) => [p.producto_id, p.disponible > 0 ? cant(p.disponible) : '0'])));
        }).catch(() => vivo && setInfo({ activo: false, productos: [] }));
        return () => { vivo = false; };
    }, [ventaId]);

    const esC = tipo === 'C';
    const activo = esC && on && !!info?.activo;
    const filas = useMemo(() => (info?.productos || []).map((p) => {
        const c = num(q[p.producto_id]);
        const valida = !isNaN(c) && c >= 0 && c <= p.disponible + 0.0005;
        const costo = valida && c > 0 ? r2(r2(c * p.costo_usd) * p.tasa) : 0;
        return { ...p, c: isNaN(c) ? 0 : c, valida, costo };
    }), [info, q]);
    const elegidas = filas.filter((f) => f.c > 0 && f.valida);
    const error = !activo ? null
        : filas.some((f) => !f.valida) ? 'Revisa las cantidades: no pueden superar lo que se vendió.'
        : elegidas.length === 0 ? 'Indica cuántas unidades devuelve el cliente (al menos una).' : null;
    const clave = JSON.stringify([activo, elegidas.map((f) => [f.producto_id, f.c]), error]);
    useEffect(() => { onChange?.({ devuelve: activo, productos: elegidas.map((f) => ({ producto_id: f.producto_id, cantidad: f.c })), error }); }, [clave]);

    useEffect(() => { if (!esC) setOn(false); }, [esC]);

    const b = num(base);
    const credito = !isNaN(b) && b > 0 ? r2(b + r2((b * ivaPct) / 100)) : null;
    const unidades = elegidas.reduce((s, f) => s + f.c, 0);
    const costoTotal = r2(elegidas.reduce((s, f) => s + f.costo, 0));
    const detalle = elegidas.length === 1 ? `${cant(elegidas[0].c)} ${elegidas[0].c === 1 ? 'unidad' : 'unidades'} de «${elegidas[0].nombre}»` : `${cant(unidades)} unidades (${elegidas.length} productos)`;
    const deshabilitado = !esC || !info?.activo;
    const pista = !esC ? 'Solo aplica a notas de crédito.' : info && !info.activo ? 'Falta ejecutar 12_devolucion_notas.sql en la base de datos.' : 'Si la activas, las unidades vuelven al stock y se revierte su costo.';

    return (
        <div className={`rounded-xl border p-4 ${activo ? 'border-brand bg-brand-50/40' : 'border-line'}`}>
            <div className="flex items-start justify-between gap-4">
                <div><p className={`text-[15px] font-semibold ${deshabilitado ? 'text-muted' : ''}`}>El cliente devuelve la mercancía</p><p className="text-[13px] text-muted">{esC ? '(ingresa al inventario) ' : ''}{pista}</p></div>
                <div className={deshabilitado ? 'pointer-events-none opacity-40' : ''}><Switch on={activo} set={(v) => setOn(v)} label="El cliente devuelve la mercancía (ingresa al inventario)" /></div>
            </div>
            {activo && (
                <div className="mt-4">
                    <ul className="divide-y divide-line rounded-lg border border-line bg-white">
                        {filas.map((f) => (
                            <li key={f.producto_id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                <div className="min-w-0"><p className="truncate text-[14px] font-medium">{f.nombre}</p>
                                    <p className="text-[12.5px] text-muted">{f.sku} · vendidas {cant(f.vendida)}{f.devuelta > 0 ? ` · ya devueltas ${cant(f.devuelta)}` : ''}</p></div>
                                <label className="flex shrink-0 items-center gap-2 text-[13px] text-muted">Devuelve
                                    <input inputMode="decimal" aria-label={`Unidades devueltas de ${f.nombre}`} disabled={f.disponible <= 0} value={q[f.producto_id] ?? ''} onChange={(e) => setQ({ ...q, [f.producto_id]: e.target.value })}
                                        className={`num h-9 w-20 rounded-lg border bg-white px-2 text-right text-[14px] text-text focus:outline-none focus:ring-1 disabled:bg-paper ${f.valida ? 'border-line focus:border-brand focus:ring-brand' : 'border-danger focus:ring-danger'}`} />
                                </label>
                            </li>
                        ))}
                    </ul>
                    {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
                    {!error && elegidas.length > 0 && (
                        <p className="mt-3 rounded-lg bg-white px-3 py-2.5 text-[13.5px] leading-snug text-[#1f2933] ring-1 ring-line">
                            <span className="font-semibold">Al guardar:</span> {credito != null ? <>se acreditarán <span className="num font-semibold">{bs(credito)}</span> al cliente y </> : <>(escribe el monto de la nota) </>}regresarán {detalle} al inventario{costoTotal > 0 ? <> por un costo de <span className="num font-semibold">{bs(costoTotal)}</span></> : ''}.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
