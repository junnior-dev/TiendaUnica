/**
 * Lectura del estado de cuenta del banco en el navegador, sin librerías: CSV/TXT y Excel (.xlsx).
 *  · CSV: detecta el separador (; , tab |), comillas y la codificación (UTF-8 o Windows-1252, la de muchos bancos).
 *  · XLSX: un .xlsx es un ZIP de XML; se abre con DecompressionStream, que ya trae el navegador. (.xls antiguo: guárdalo como .xlsx o CSV.)
 *  · Detecta la fila de encabezados y qué columna es cada cosa; la persona puede corregirla en pantalla.
 * Los números aceptan «1.234,56», «1,234.56», «-12,5», «(12,50)» y «12,50-». Las fechas, dd/mm/aaaa, aaaa-mm-dd y los números de serie de Excel.
 */

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/* ───────── CSV ───────── */
async function textoDe(file) {
    const buf = await file.arrayBuffer();
    let t = new TextDecoder('utf-8').decode(buf);
    if (t.includes('�')) t = new TextDecoder('windows-1252').decode(buf);       // tildes rotas = archivo en Windows-1252
    return t.replace(/^﻿/, '');
}

function separador(t) {
    const muestra = t.split(/\r?\n/).filter(Boolean).slice(0, 15);
    let mejor = ';', max = -1;
    for (const s of [';', '\t', ',', '|']) {
        const cuentas = muestra.map((l) => l.split(s).length - 1);
        const min = Math.min(...cuentas);                                              // el separador de verdad aparece parejo en todas las líneas
        if (min > max && cuentas.some((c) => c > 0)) { max = min; mejor = s; }
    }
    return mejor;
}

export function parseCsv(t) {
    const sep = separador(t), filas = [];
    let fila = [], campo = '', q = false;
    for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (q) { if (ch === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else q = false; } else campo += ch; }
        else if (ch === '"') q = true;
        else if (ch === sep) { fila.push(campo); campo = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; fila.push(campo); campo = ''; if (fila.some((c) => c.trim() !== '')) filas.push(fila); fila = []; }
        else campo += ch;
    }
    fila.push(campo); if (fila.some((c) => c.trim() !== '')) filas.push(fila);
    return filas.map((f) => f.map((c) => c.trim()));
}

/* ───────── XLSX (ZIP + XML) ───────── */
async function inflar(datos) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(datos); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

async function entradasZip(buf) {
    const v = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('El archivo no es un Excel válido (.xlsx).');
    const total = v.getUint16(eocd + 10, true); let p = v.getUint32(eocd + 16, true);
    const out = {};
    for (let n = 0; n < total; n++) {
        if (v.getUint32(p, true) !== 0x02014b50) break;
        const metodo = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nlen = v.getUint16(p + 28, true), elen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
        const nombre = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
        out[nombre] = async () => {
            const lh = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
            const crudo = u8.subarray(lh, lh + csize);
            return new TextDecoder().decode(metodo === 0 ? crudo : await inflar(crudo));
        };
        p += 46 + nlen + elen + clen;
    }
    return out;
}

const colDe = (ref) => { let n = 0; for (const ch of ref.replace(/\d/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export async function parseXlsx(buf) {
    const z = await entradasZip(buf), dom = (t) => new DOMParser().parseFromString(t, 'application/xml');
    const compartidas = z['xl/sharedStrings.xml'] ? [...dom(await z['xl/sharedStrings.xml']()).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')) : [];
    const hoja = Object.keys(z).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.match(/(\d+)\.xml/)[1]) - parseInt(b.match(/(\d+)\.xml/)[1]))[0];
    if (!hoja) throw new Error('El Excel no tiene hojas con datos.');
    const filas = [];
    for (const row of dom(await z[hoja]()).getElementsByTagName('row')) {
        const f = [];
        for (const c of row.getElementsByTagName('c')) {
            const t = c.getAttribute('t'), vNode = c.getElementsByTagName('v')[0];
            let val = '';
            if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
            else if (vNode) val = t === 's' ? (compartidas[Number(vNode.textContent)] ?? '') : vNode.textContent;
            f[colDe(c.getAttribute('r') || 'A1')] = String(val).trim();
        }
        const lleno = Array.from(f, (x) => x ?? '');
        if (lleno.some((x) => x !== '')) filas.push(lleno);
    }
    return filas;
}

export async function leerArchivo(file) {
    if (file.size > 8 * 1024 * 1024) throw new Error('El archivo pesa más de 8 MB: súbelo por períodos más cortos.');
    const nombre = file.name.toLowerCase();
    if (nombre.endsWith('.xls')) throw new Error('Los .xls antiguos no se pueden leer: guárdalo como .xlsx o como CSV desde Excel.');
    const filas = nombre.endsWith('.xlsx') ? await parseXlsx(await file.arrayBuffer()) : parseCsv(await textoDe(file));
    if (!filas.length) throw new Error('El archivo está vacío.');
    return filas;
}

/* ───────── números y fechas ───────── */
export function numero(t) {
    let s = String(t ?? '').replace(/[\s ]|Bs\.?|VES|\$/gi, '');
    if (s === '') return null;
    let neg = false;
    const par = s.match(/^\((.*)\)$/); if (par) { neg = true; s = par[1]; }
    if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
    if (!/^[\d.,]+$/.test(s)) return null;
    const p = s.lastIndexOf('.'), c = s.lastIndexOf(',');
    let dec = '';
    if (p >= 0 && c >= 0) dec = p > c ? '.' : ',';
    else if (c >= 0) dec = (s.split(',').length > 2 || s.length - c - 1 === 3) ? '' : ',';       // «1,234» = mil doscientos treinta y cuatro; «12,5» = doce y medio
    else if (p >= 0) dec = (s.split('.').length > 2 || s.length - p - 1 === 3) ? '' : '.';
    let r = s;
    if (dec === '') r = s.replace(/[.,]/g, '');
    else { r = s.replace(dec === ',' ? /\./g : /,/g, '').replace(dec, '.'); }
    const v = Number(r);
    return Number.isFinite(v) ? (neg ? -v : v) : null;
}

export function fechaIso(t) {
    const s = String(t ?? '').trim();
    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    let a, mm, d;
    if (m) { a = +m[1]; mm = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) { d = +m[1]; mm = +m[2]; a = +m[3]; if (a < 100) a += 2000; }
    else if (/^\d{5}(\.\d+)?$/.test(s) && +s > 30000 && +s < 80000) { const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000); a = dt.getUTCFullYear(); mm = dt.getUTCMonth() + 1; d = dt.getUTCDate(); }   // serial de Excel
    else return null;
    const f = new Date(Date.UTC(a, mm - 1, d));
    if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mm - 1 || f.getUTCDate() !== d) return null;
    return `${String(a).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/* ───────── detección de columnas ───────── */
export const CAMPOS = [['fecha', 'Fecha'], ['referencia', 'Referencia'], ['descripcion', 'Descripción'], ['monto', 'Monto (con signo)'], ['debito', 'Débito / cargo'], ['credito', 'Crédito / abono'], ['saldo', 'Saldo']];
const CLAVES = { fecha: /^(fecha|date|f\.? ?valor|fecha (de )?(operacion|movimiento|valor))/, referencia: /(referencia|ref\b|nro|numero|n°|n\.º|comprobante|documento|serial)/, descripcion: /(descripcion|concepto|detalle|movimiento|operacion|observacion)/, debito: /(debito|debe|cargo|retiro|egreso|salida)/, credito: /(credito|haber|abono|deposito|ingreso|entrada)/, monto: /(monto|importe|valor)/, saldo: /(saldo|balance)/ };

/** Devuelve { cabecera: índice de la fila de encabezados (-1 si no hay), mapa: {campo: índice de columna} }. */
export function detectar(filas) {
    let mejor = { cabecera: -1, mapa: {}, puntos: 0 };
    filas.slice(0, 30).forEach((f, i) => {
        const mapa = {}; let puntos = 0;
        f.forEach((cel, j) => {
            const c = norm(cel); if (!c || c.length > 40) return;
            for (const k of ['fecha', 'debito', 'credito', 'saldo', 'monto', 'referencia', 'descripcion']) if (mapa[k] === undefined && CLAVES[k].test(c)) { mapa[k] = j; puntos++; break; }
        });
        if (puntos > mejor.puntos && mapa.fecha !== undefined) mejor = { cabecera: i, mapa, puntos };
    });
    if (mejor.cabecera < 0) {                                                            // sin encabezados: adivina por el contenido de la primera fila de datos
        const f = filas.find((x) => x.some((c) => fechaIso(c))) || [];
        const mapa = {}; f.forEach((c, j) => { if (mapa.fecha === undefined && fechaIso(c)) mapa.fecha = j; });
        return { cabecera: -1, mapa };
    }
    if (mejor.mapa.monto !== undefined && (mejor.mapa.debito !== undefined || mejor.mapa.credito !== undefined)) delete mejor.mapa.monto;
    return { cabecera: mejor.cabecera, mapa: mejor.mapa };
}

/**
 * Convierte las filas del archivo en movimientos. modo: 'signo' (una columna de monto, + abono / − cargo) o 'columnas' (débito y crédito).
 * invertir: para bancos que muestran los cargos en positivo. Devuelve { lineas, errores, saldo_final, descartadas }.
 */
export function normalizar(filas, { cabecera, mapa, modo, invertir = false }) {
    const lineas = [], errores = []; let descartadas = 0;
    filas.slice(cabecera + 1).forEach((f, i) => {
        const n = cabecera + 2 + i, crudaFecha = f[mapa.fecha];
        if (crudaFecha === undefined || String(crudaFecha).trim() === '') { descartadas++; return; }
        const fecha = fechaIso(crudaFecha);
        if (!fecha) { if (f.some((c) => numero(c) !== null && String(c).includes(','))) errores.push(`Fila ${n}: no entiendo la fecha «${crudaFecha}».`); else descartadas++; return; }
        let monto;
        if (modo === 'columnas') {
            const d = numero(f[mapa.debito]) || 0, c = numero(f[mapa.credito]) || 0;
            monto = Math.abs(c) - Math.abs(d);
        } else {
            monto = numero(f[mapa.monto]);
            if (monto === null) { errores.push(`Fila ${n}: no entiendo el monto «${f[mapa.monto] ?? ''}».`); return; }
        }
        if (invertir) monto = -monto;
        monto = Math.round(monto * 100) / 100;
        if (monto === 0) { descartadas++; return; }
        lineas.push({ fecha, referencia: mapa.referencia !== undefined ? String(f[mapa.referencia] ?? '') : '', descripcion: mapa.descripcion !== undefined ? String(f[mapa.descripcion] ?? '') : '', monto, saldo: mapa.saldo !== undefined ? numero(f[mapa.saldo]) : null });
    });
    // El saldo final es el de la línea más reciente; si el archivo viene del más nuevo al más viejo, es el de la primera.
    let saldo_final = null;
    const conSaldo = lineas.filter((l) => l.saldo !== null);
    if (conSaldo.length) { const desc = lineas.length > 1 && lineas[0].fecha > lineas[lineas.length - 1].fecha; saldo_final = (desc ? conSaldo[0] : conSaldo[conSaldo.length - 1]).saldo; }
    return { lineas, errores, saldo_final, descartadas };
}
