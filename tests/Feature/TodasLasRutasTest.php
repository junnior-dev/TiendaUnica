<?php

/*
 * TodasLasRutasTest · smoke hostil sobre la TABLA DE RUTAS REAL (no una lista
 * escrita a mano): Route::getRoutes() es la fuente, de modo que ninguna ruta
 * nueva puede quedar fuera. Tres pases por TODAS las rutas GET —invitado,
 * cajero y administrador— con un contrato duro:
 *
 *   · NINGUNA petición responde 500: una ruta que explota con un usuario real
 *     o con un invitado es un agujero, no un «caso de borde».
 *   · El invitado solo recibe 302 hacia /login (o 401/403/404/422 en los
 *     endpoints que fallan cerrado), jamás una página de negocio.
 *   · El cajero autenticado no puede ser devuelto a /login: si su sesión
 *     muere al navegar, aquí se ve.
 *   · Toda respuesta 200 de página Inertia declara un componente que EXISTE
 *     como archivo en resources/js/Pages (la página en blanco en producción
 *     nace de un nombre equivocado; aquí se caza antes).
 *
 * Las rutas con parámetro se piden con un id inexistente: el camino correcto
 * es 404/422 controlado; un 500 en ese camino es exactamente el tipo de fallo
 * que solo se descubre en producción si nadie lo prueba.
 */

use Illuminate\Routing\Route as RutaLaravel;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Route;

/** @return list<RutaLaravel> */
function rutasGet(): array
{
    $rutas = [];
    foreach (Route::getRoutes()->getRoutes() as $r) {
        if (in_array('GET', $r->methods(), true) && ! str_starts_with($r->uri(), '_')) {
            $rutas[] = $r;
        }
    }

    return $rutas;
}

/** ¿Es una ruta del grupo guest (requiere NO estar autenticado)? */
function esRutaGuest(RutaLaravel $r): bool
{
    return in_array($r->uri(), ['login', 'registro', 'crear-cuenta'], true);
}

/** La URI de la ruta con sus parámetros sustituidos por valores ejercitables. */
function uriDeRuta(RutaLaravel $r): string
{
    $uri = preg_replace_callback('/\{(\w+)\}/', function (array $m): string {
        return match ($m[1]) {
            'seccion' => 'negocio',          // configuracion/{seccion}: sección válida
            'codigo', 'clave' => 'USD',      // monedas/{codigo} y alícuotas: código de catálogo
            default => '99999999',           // ids inexistentes: el camino correcto es 404
        };
    }, $r->uri()) ?? $r->uri();

    return '/'.$uri;
}

/** Si la respuesta es una página Inertia, el componente declarado debe existir en disco. */
function verificarComponenteInertia(Illuminate\Testing\TestResponse $resp): void
{
    preg_match('/data-page="([^"]+)"/', $resp->getContent(), $m);
    if (! isset($m[1])) {
        return;   // no es una página Inertia (JSON, PDF, stream): no aplica
    }
    /** @var array<string,mixed>|null $pagina */
    $pagina = json_decode(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'), true);
    $componente = (string) ($pagina['component'] ?? '');
    expect($componente, 'la página Inertia debe declarar su componente')->not->toBeEmpty();
    expect(File::exists(resource_path("js/Pages/{$componente}.jsx")),
        "el componente «{$componente}» no existe en resources/js/Pages")->toBeTrue();
}

it('TODAS las rutas GET responden sin 500 al INVITADO (302 a /login o páginas públicas)', function () {
    foreach (rutasGet() as $r) {
        $uri = uriDeRuta($r);
        $resp = $this->get($uri);
        $status = $resp->status();

        expect(in_array($status, [200, 302, 401, 403, 404, 422], true),
            "GET {$uri} respondió {$status} al invitado")->toBeTrue();

        if ($status === 302) {
            expect(str_contains((string) $resp->headers->get('Location'), '/login'),
                "GET {$uri} redirige a ".$resp->headers->get('Location').': el invitado solo debe ir a /login')->toBeTrue();
        }
        if ($status === 200) {
            verificarComponenteInertia($resp);
        }
    }
});

it('TODAS las rutas GET responden sin 500 al CAJERO (y sin expulsarlo a /login)', function () {
    $this->actingAs(cajeroConClave());

    foreach (rutasGet() as $r) {
        if (esRutaGuest($r)) {
            continue;   // el middleware guest manda al autenticado a su inicio: no es camino del cajero
        }
        $uri = uriDeRuta($r);
        $resp = $this->get($uri);
        $status = $resp->status();

        expect(in_array($status, [200, 302, 403, 404, 422], true),
            "GET {$uri} respondió {$status} al cajero")->toBeTrue();

        if ($status === 302) {
            $destino = (string) $resp->headers->get('Location');
            expect(str_contains($destino, '/caja') || str_contains($destino, '/portal/login'),
                "GET {$uri} devolvió al cajero a {$destino}: su sesión no debe morir al navegar")->toBeTrue();
        }
        if ($status === 200) {
            verificarComponenteInertia($resp);
        }
    }
});

it('TODAS las rutas GET responden sin 500 al ADMINISTRADOR (y sin expulsarlo a /login)', function () {
    $this->actingAs(\App\Models\Usuario::find(adminId()));

    foreach (rutasGet() as $r) {
        if (esRutaGuest($r)) {
            continue;
        }
        $uri = uriDeRuta($r);
        $resp = $this->get($uri);
        $status = $resp->status();

        expect(in_array($status, [200, 302, 403, 404, 422], true),
            "GET {$uri} respondió {$status} al administrador")->toBeTrue();

        if ($status === 302) {
            $destino = (string) $resp->headers->get('Location');
            expect(! str_contains($destino, '/login') || str_contains($destino, '/portal/login'),
                "GET {$uri} devolvió al administrador a {$destino}")->toBeTrue();
        }
        if ($status === 200) {
            verificarComponenteInertia($resp);
        }
    }
});
