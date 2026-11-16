import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { Modal } from '../../Components/kit';
import { Field } from '../../Components/ui';
import { n2 } from '../../lib/format';

export const dmy = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
export const corto = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—');
/* Montos con signo: los egresos en rojo y entre paréntesis, como se ven en un estado de cuenta. */
export const monto = (v) => (v === null || v === undefined ? '—' : v < 0 ? `(${n2(-v)})` : n2(v));
export const mesLargo = (ym) => { const t = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T12:00:00Z`)); return t.charAt(0).toUpperCase() + t.slice(1); };

export const SEM = {
    CUADRA: { t: 'Cuadra', c: 'text-ok', bg: 'bg-[#d8f1e3]', dot: 'bg-ok' },
    REDONDEO: { t: 'Redondeo', c: 'text-[#7a5600]', bg: 'bg-[#fff4d6]', dot: 'bg-signal' },
    NO_CUADRA: { t: 'No cuadra', c: 'text-danger', bg: 'bg-[#fde8e6]', dot: 'bg-danger' },
    SIN_DECLARAR: { t: 'Sin declarar', c: 'text-muted', bg: 'bg-paper', dot: 'bg-[#a3acb6]' },
};
export const Semaforo = ({ k }) => (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEM[k].bg} ${SEM[k].c}`}><span aria-hidden className={`size-2 rounded-full ${SEM[k].dot}`} />{SEM[k].t}</span>
);

/** Folio, contador y C.P.C. antes de generar un PDF legal. `generar({folio, contador})` devuelve el documento de jsPDF y el nombre del archivo. */
export function ModalPdf({ titulo, subtitulo, folioInicial = 1, cerrar, generar, children }) {
    const guardado = (() => { try { return JSON.parse(localStorage.getItem('contab_pdf') || '{}'); } catch { return {}; } })();
    const [f, setF] = useState({ folio: String(folioInicial), nombre: guardado.nombre || '', cpc: guardado.cpc || '' });
    const [env, setEnv] = useState(false); const [err, setErr] = useState('');
    const enviar = async () => {
        const folio = Math.floor(Number(f.folio));
        if (!Number.isFinite(folio) || folio < 1) return setErr('El primer folio debe ser un número desde 1.');
        setEnv(true); setErr('');
        try {
            try { localStorage.setItem('contab_pdf', JSON.stringify({ nombre: f.nombre, cpc: f.cpc })); } catch { /* sin almacenamiento */ }
            const { doc, archivo } = await generar({ folio, contador: { nombre: f.nombre.trim(), cpc: f.cpc.trim() } });
            doc.save(archivo); cerrar();
        } catch (e) { setErr(e.message || 'No se pudo preparar el PDF. Inténtalo de nuevo.'); } finally { setEnv(false); }
    };
    return (
        <Modal titulo={titulo} subtitulo={subtitulo} cerrar={cerrar} onSubmit={enviar} enviando={env} ok="Descargar PDF">
            {children}
            <Field label="Primer folio" inputMode="numeric" value={f.folio} onChange={(e) => setF({ ...f, folio: e.target.value })} hint="Cada hoja lleva su número de folio. Si ya usaste folios en este libro, continúa desde el siguiente." />
            <Field label="Contador público (opcional)" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
            <Field label="N.º de C.P.C. (opcional)" value={f.cpc} onChange={(e) => setF({ ...f, cpc: e.target.value })} />
            {err && <p className="flex items-start gap-2 rounded-lg bg-[#fde8e6] p-3 text-[14px] text-danger"><FileDown className="mt-0.5 size-4 shrink-0" />{err}</p>}
        </Modal>
    );
}
