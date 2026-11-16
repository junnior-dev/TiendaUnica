<?php

/*
 * AuditoriaRutasInertiaTest · Suite de Auditoría Forense (1/4) — el buscador de 500.
 *
 * Recorre la TABLA DE RUTAS REAL (Route::getRoutes(), la misma fuente del
 * smoke hostil) como administrador y como cajero, con tres contratos duros:
 *
 *   · NINGUNA petición responde 500: el diff de la aserción acumulada lista
 *     el $uri exacto y el status de cada agujero (Pest no imprime los
 *     mensajes de expect($x, "msg"); la lista, sí).
 *   · Toda página Inertia 200 declara un componente que EXISTE en
 *     resources/js/Pages y trae props NO vacías (la página en blanco de
 *     producción nace de props perdidas o de un nombre equivocado).
 *   · Toda página del ERP trae la identidad compartida del layout:
 *     «negocio» con el nombre de la tienda y «usuario» con «nombre». Las
 *     páginas SIN layout (la pública /precios y la transicional
 *     /cuenta/contrasena) quedan exentas de la identidad, no de lo demás.
 *
 * Reutiliza los helpers del smoke hostil (rutasGet, uriDeRuta, esRutaGuest,
 * verificarComponenteInertia) y propsDePest: NUNCA los redeclara (sería un
 * fatal de función duplicada en el mismo proceso).
 */

use Illuminate\Support\Facades\DB;

/** Host HTTP del inquilino 1 (subdominio sembrado sobre SAAS_BASE_DOMAIN=localhost). */
function forenseHostA(): string
{
    $subdominio = (string) DB::table('estado_tenants')->where('negocio_id', 1)->value('subdominio');

    return $subdominio !== '' ? "{$subdominio}.localhost" : 'localhost';
}

/** ¿Es una página Inertia SIN el layout del ERP (pública o transicional)? */
function forensePaginaSinLayout(string $uri): bool
{
    // /portal/login: login público del portal SaaS, layout propio sin tenant.
    return in_array($uri, ['/precios', '/cuenta/contrasena', '/portal/login'], true);
}

/**
 * Contrato forense de UNA respuesta ya pedida. Devuelve la lista de
 * violaciones (vacía = correcto) para acumularlas en el it.
 *
 * @param  \Illuminate\Testing\TestResponse<\Illuminate\Http\Response>  $resp
 * @return list<string>
 */
function forenseViolaciones(Illuminate\Testing\TestResponse $resp, string $uri, string $rol): array
{
    $violaciones = [];
    $status = $resp->status();

    if ($status >= 500) {
        $violaciones[] = "{$rol}: GET {$uri} respondió {$status} (un 500 aquí es un agujero, no un caso de borde)";
    } elseif (! in_array($status, [200, 302, 403, 404, 422], true)) {
        $violaciones[] = "{$rol}: GET {$uri} respondió {$status}";
    }

    if ($status === 200 && preg_match('/data-page="([^"]+)"/', $resp->getContent()) === 1) {
        try {
            verificarComponenteInertia($resp);
            $props = propsDePest($resp);
            if (! forensePaginaSinLayout($uri)) {
                if ($props === []) {
                    $violaciones[] = "{$rol}: GET {$uri} es una página Inertia SIN props";
                }
                $negocio = (string) ($props['negocio'] ?? '');
                $nombre = is_array($props['usuario'] ?? null) ? (string) ($props['usuario']['nombre'] ?? '') : '';
                if (trim($negocio) === '') {
                    $violaciones[] = "{$rol}: GET {$uri} no trae la identidad «negocio» del layout";
                }
                if (trim($nombre) === '') {
                    $violaciones[] = "{$rol}: GET {$uri} no trae «usuario.nombre» del layout";
                }
            }
        } catch (\Throwable $e) {
            $violaciones[] = "{$rol}: GET {$uri} — ".$e->getMessage();
        }
    }

    return $violaciones;
}

it('AUDITORÍA: ninguna ruta GET responde 500 al ADMINISTRADOR y cada página Inertia trae su identidad', function () {
    $this->actingAs(\App\Models\Usuario::find(adminId()));
    $host = forenseHostA();

    // Acumulación: el diff de la única aserción final lista TODAS las rutas
    // que violaron el contrato, con $uri y status exactos.
    $fallos = [];

    foreach (rutasGet() as $r) {
        if (esRutaGuest($r)) {
            continue;
        }
        $uri = uriDeRuta($r);
        array_push($fallos, ...forenseViolaciones($this->get("http://{$host}{$uri}"), $uri, 'administrador'));
    }

    expect($fallos, 'rutas que violaron el contrato forense (administrador)')->toBe([]);
});

it('AUDITORÍA: ninguna ruta GET responde 500 al CAJERO y cada página Inertia trae su identidad', function () {
    $this->actingAs(cajeroConClave());
    $host = forenseHostA();

    $fallos = [];

    foreach (rutasGet() as $r) {
        if (esRutaGuest($r)) {
            continue;
        }
        $uri = uriDeRuta($r);
        array_push($fallos, ...forenseViolaciones($this->get("http://{$host}{$uri}"), $uri, 'cajero'));
    }

    expect($fallos, 'rutas que violaron el contrato forense (cajero)')->toBe([]);
});
