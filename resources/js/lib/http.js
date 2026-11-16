/** fetch con JSON y el token CSRF de Laravel (cookie XSRF-TOKEN). Lanza { message, errors } si la respuesta no es correcta. */
const xsrf = () => {
    const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
};

export async function http(metodo, url, cuerpo, signal) {
    let r;
    try {
        r = await fetch(url, {
            method: metodo, signal, credentials: 'same-origin',
            headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), 'X-XSRF-TOKEN': xsrf() },
            body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
        });
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        throw { message: 'No hay conexión con el servidor. Revisa la red e inténtalo de nuevo.' };
    }
    let datos = null;
    try { datos = await r.json(); } catch { /* sin cuerpo */ }
    if (!r.ok) {
        const primero = datos?.errors && Object.values(datos.errors)[0]?.[0];
        throw { message: datos?.message && !/^The given data/.test(datos.message) ? datos.message : primero || (r.status === 419 ? 'La sesión caducó. Recarga la página.' : 'No se pudo completar la acción.'), errors: datos?.errors || {}, status: r.status };
    }
    return datos;
}
