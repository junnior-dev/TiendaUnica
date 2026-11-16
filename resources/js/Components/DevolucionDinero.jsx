import { useEffect, useState } from 'react';
import { Banknote, Info, Landmark } from 'lucide-react';
import { Switch } from './kit';
import { Field } from './ui';

/**
 * «Devolver el dinero al cliente»: método de pago, monto (vacío = todo lo reembolsable) y referencia si el método la pide.
 * Avisa al formulario con onChange({ devuelve, devolucion: {metodo_pago_id, monto, referencia} | null, error }).
 * Se usa en la nota de crédito de Ventas y en la de Libros fiscales. La base lo registra como EGRESO del turno del emisor
 * (18_devolucion_en_caja.sql); si el método es efectivo, hace falta tener la caja abierta. Si la venta es a crédito, la nota primero
 * baja la deuda y solo el excedente se devuelve: el servidor calcula el tope y lo avisa.
 */
export default function DevolucionDinero({ tipo, onChange, aviso }) {
    const [info, setInfo] = useState(null);      // { activo, turno, metodos }
    const [on, setOn] = useState(false);
    const [metodo, setMetodo] = useState(''); const [monto, setMonto] = useState(''); const [ref, setRef] = useState('');

    useEffect(() => {
        let vivo = true;
        fetch('/ventas/metodos-devolucion', { headers: { Accept: 'application/json' } }).then((r) => r.json()).then((d) => {
            if (!vivo) return;
            setInfo(d); const primero = (d.metodos || []).find((m) => m.efectivo) || (d.metodos || [])[0]; if (primero) setMetodo(String(primero.id));
        }).catch(() => vivo && setInfo({ activo: false, turno: false, metodos: [] }));
        return () => { vivo = false; };
    }, []);

    const esC = tipo === 'C';
    const m = info?.metodos?.find((x) => String(x.id) === metodo);
    const activo = esC && on && !!info?.activo && !!m;
    const montoNum = monto.trim() ? Number(monto.includes(',') ? monto.replace(/\./g, '').replace(',', '.') : monto) : null;
    const error = !activo ? null
        : montoNum !== null && !(montoNum > 0) ? 'Escribe un monto válido o déjalo vacío para devolver todo.'
        : m.efectivo && !info.turno ? 'Para devolver efectivo debes tener tu caja abierta (Punto de venta → Abrir caja).'
        : m.referencia && !ref.trim() ? `Anota la referencia de la devolución por ${m.nombre}.` : null;
    useEffect(() => { if (!esC) setOn(false); }, [esC]);
    useEffect(() => {
        onChange?.({ devuelve: activo, devolucion: activo ? { metodo_pago_id: Number(metodo), monto: montoNum, referencia: m?.referencia ? ref.trim() : null } : null, error });
    }, [activo, metodo, monto, ref, error]);

    const deshabilitado = !esC || !info?.activo || !(info.metodos || []).length;
    const pista = !esC ? 'Solo aplica a notas de crédito.' : info && !info.activo ? 'Falta ejecutar 18_devolucion_en_caja.sql en la base de datos.'
        : 'Si la activas, la devolución queda anotada como egreso de tu caja y el Corte Z la descuenta del efectivo esperado.';

    return (
        <div className={`rounded-xl border p-4 ${activo ? 'border-brand bg-brand-50/40' : 'border-line'}`}>
            <div className="flex items-start justify-between gap-4">
                <div><p className={`text-[15px] font-semibold ${deshabilitado ? 'text-muted' : ''}`}>Devolver el dinero al cliente</p><p className="text-[13px] leading-snug text-muted">{pista}</p></div>
                <div className={deshabilitado ? 'pointer-events-none opacity-50' : ''}><Switch on={on} set={setOn} label="Devolver el dinero al cliente" /></div>
            </div>
            {activo && (
                <div className="mt-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
                        <Field select label="¿Con qué se devuelve?" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                            {info.metodos.map((x) => <option key={x.id} value={x.id}>{x.nombre}{x.efectivo ? ' (efectivo)' : ''}</option>)}
                        </Field>
                        <Field label={`Monto en ${m.moneda}`} inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} hint="Vacío = todo" />
                    </div>
                    {m.referencia && <Field label="Referencia de la devolución" value={ref} onChange={(e) => setRef(e.target.value)} />}
                    <p className="flex items-start gap-2 text-[13px] leading-snug text-muted">{m.efectivo ? <Banknote className="mt-0.5 size-4 shrink-0" /> : <Landmark className="mt-0.5 size-4 shrink-0" />}{m.efectivo ? 'Sale de la gaveta: se descuenta del arqueo.' : 'No mueve la gaveta: queda anotado en los movimientos del turno si tienes caja abierta.'}</p>
                    {aviso && <p className="flex items-start gap-2 text-[13px] leading-snug text-muted"><Info className="mt-0.5 size-4 shrink-0" />{aviso}</p>}
                    {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
                </div>)}
        </div>
    );
}
