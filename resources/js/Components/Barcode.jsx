/**
 * Código de barras EAN-13 en SVG para previsualizar las etiquetas antes de imprimirlas.
 * El PDF (lib/pdfEtiquetas.js) dibuja las mismas barras con rectángulos de jsPDF.
 */
import { barrasEan13, esGuarda, ean13Valido, tramosDe } from '../lib/barcode';

export default function Barcode({ codigo, modulo = 2, alto = 40, texto = true, className = '' }) {
    const c = String(codigo ?? '');
    if (!ean13Valido(c)) return null;
    const bits = barrasEan13(c);
    const w = bits.length * modulo;
    const descenso = Math.round(alto * 0.12);
    const altoNum = texto ? 13 : 0;
    const digitos = [];
    if (texto) {
        digitos.push({ t: c[0], x: 0, anchor: 'start' });
        for (let i = 1; i <= 6; i++) digitos.push({ t: c[i], x: 10 * modulo + (i - 1) * 7 * modulo + 3.5 * modulo, anchor: 'middle' });
        for (let i = 7; i <= 12; i++) digitos.push({ t: c[i], x: 50 * modulo + (i - 7) * 7 * modulo + 3.5 * modulo, anchor: 'middle' });
        digitos.push({ t: c[12], x: w, anchor: 'end' });
    }
    return (
        <svg role="img" aria-label={`Código de barras EAN-13 ${c}`} className={className} viewBox={`0 0 ${w} ${alto + descenso + altoNum}`} preserveAspectRatio="xMidYMid meet">
            {tramosDe(bits).map(([ini, an], i) => (
                <rect key={i} x={ini * modulo} y={0} width={an * modulo} height={esGuarda(ini, an) ? alto + descenso : alto} fill="#000" />
            ))}
            {texto && (
                <g fill="#000" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize={altoNum - 1}>
                    {digitos.map((d, i) => <text key={i} x={d.x} y={alto + descenso + altoNum - 1} textAnchor={d.anchor}>{d.t}</text>)}
                </g>
            )}
        </svg>
    );
}
