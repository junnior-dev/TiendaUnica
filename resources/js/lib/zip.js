/** ZIP sin compresión ("store"), sin dependencias. Suficiente para PDFs, que ya vienen comprimidos. Nombres en UTF-8. */
const TABLA = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = TABLA[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** archivos: [{ nombre, datos: Uint8Array | ArrayBuffer | string }] → Blob application/zip */
export function crearZip(archivos, fecha = new Date()) {
    const enc = new TextEncoder();
    const dosHora = ((fecha.getHours() << 11) | (fecha.getMinutes() << 5) | (fecha.getSeconds() >> 1)) & 0xffff;
    const dosFecha = (((fecha.getFullYear() - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate()) & 0xffff;
    const partes = [], central = [];
    let pos = 0;
    for (const a of archivos) {
        const nombre = enc.encode(a.nombre);
        const datos = typeof a.datos === 'string' ? enc.encode(a.datos) : a.datos instanceof Uint8Array ? a.datos : new Uint8Array(a.datos);
        const crc = crc32(datos);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
        local.setUint16(10, dosHora, true); local.setUint16(12, dosFecha, true); local.setUint32(14, crc, true);
        local.setUint32(18, datos.length, true); local.setUint32(22, datos.length, true); local.setUint16(26, nombre.length, true); local.setUint16(28, 0, true);
        partes.push(new Uint8Array(local.buffer), nombre, datos);
        const cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
        cd.setUint16(12, dosHora, true); cd.setUint16(14, dosFecha, true); cd.setUint32(16, crc, true); cd.setUint32(20, datos.length, true); cd.setUint32(24, datos.length, true);
        cd.setUint16(28, nombre.length, true); cd.setUint32(42, pos, true);
        central.push(new Uint8Array(cd.buffer), nombre);
        pos += 30 + nombre.length + datos.length;
    }
    const tam = central.reduce((s, x) => s + x.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true); fin.setUint32(12, tam, true); fin.setUint32(16, pos, true);
    return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], { type: 'application/zip' });
}

export function descargar(blob, nombre) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
