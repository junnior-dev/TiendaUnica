<?php

/*
 * PaginasInertiaTest · la versión Pest de t16.
 *
 * Cada página se pide por HTTP real ($this->get) y se valida con el paquete
 * oficial de Inertia (assertInertia): el componente declarado, el conteo de
 * props que t16 certificó y la versión de los assets. La raíz del Assertable
 * son los PROPS de la página; el conteo total y la versión se leen de
 * toArray(), que muestra la página completa. Además, el componente declarado
 * DEBE existir como archivo .jsx en resources/js/Pages.
 */

use Illuminate\Support\Facades\File;

function paginaInertia(Illuminate\Testing\TestResponse $r, string $componente, int $props): void
{
    $r->assertOk()->assertInertia(function ($page) use ($componente, $props) {
        $page->component($componente);
        $completa = $page->toArray();
        expect(count($completa['props']))->toBe($props)
            ->and($completa['version'])->not->toBeEmpty()
            ->and($completa['url'])->not->toBeEmpty();
    });

    expect(File::exists(resource_path("js/Pages/{$componente}.jsx")))->toBeTrue();
}

it('muestra las páginas públicas al invitado (componente + props)', function (string $ruta, string $componente, int $props) {
    paginaInertia($this->get($ruta), $componente, $props);
})->with([
    'login' => ['/login', 'Auth/Login', 3],
]);

it('protege el dashboard del invitado (redirige al login)', function () {
    $this->get('/dashboard')->assertRedirect('/login');
});

it('muestra las pantallas del administrador con sus props certificadas', function (string $ruta, string $componente, int $props) {
    $this->actingAs(\App\Models\Usuario::find(adminId()));
    paginaInertia($this->get($ruta), $componente, $props);
})->with([
    'dashboard' => ['/dashboard', 'Dashboard', 14],
    'usuarios' => ['/usuarios', 'Usuarios/Index', 12],
    'productos' => ['/productos', 'Productos/Index', 16],
    'kardex' => ['/kardex', 'Kardex/Index', 19],
    'clientes' => ['/clientes', 'Clientes/Index', 14],
    'proveedores' => ['/proveedores', 'Proveedores/Index', 14],
    'categorias' => ['/categorias', 'Categorias/Index', 11],
    'modelos' => ['/modelos', 'Modelos/Index', 9],
    'compatibilidad' => ['/compatibilidad', 'Compatibilidad/Index', 10],
    'tasas' => ['/tasas', 'Tasas/Index', 13],
    'metodos de pago' => ['/metodos-pago', 'MetodosPago/Index', 13],
    'configuracion' => ['/configuracion', 'Configuracion/Index', 18],
    'reportes' => ['/reportes', 'Reportes/Index', 12],
    'conciliacion' => ['/conciliacion', 'Conciliacion/Index', 21],
    'cierre de caja' => ['/cierre-caja', 'CierreCaja/Index', 23],
    'movimientos de caja' => ['/movimientos-caja', 'MovimientosCaja/Index', 16],
]);

it('el punto de venta comparte el régimen y los métodos de pago', function () {
    $this->actingAs(\App\Models\Usuario::find(cajeroActivoId()));
    $this->get('/caja')->assertOk()->assertInertia(fn ($page) => $page
        ->component('Caja/Index')
        ->has('metodos')
        ->has('regimen')
        ->has('tasa_usd'));
});

it('muestra las 7 vistas de libros fiscales al administrador', function (string $vista) {
    $this->actingAs(\App\Models\Usuario::find(adminId()));
    paginaInertia($this->get("/libros-fiscales?vista={$vista}"), 'LibrosFiscales/Index', 18);
})->with(['ventas', 'compras', 'retenciones', 'igtf', 'notas', 'alicuotas']);

it('muestra las pantallas fiscales dedicadas (ISLR y calendario)', function (string $ruta, string $componente, int $props) {
    $this->actingAs(\App\Models\Usuario::find(adminId()));
    paginaInertia($this->get($ruta), $componente, $props);
})->with([
    'retenciones islr' => ['/retenciones-islr', 'RetencionesIslr/Index', 21],
    'declaracion islr' => ['/declaracion-islr', 'DeclaracionIslr/Index', 18],
    'calendario fiscal' => ['/calendario-fiscal', 'CalendarioFiscal/Index', 16],
]);

it('muestra las pantallas del cajero y redirige su entrada a la caja', function (string $ruta, string $componente, int $props) {
    $this->actingAs(\App\Models\Usuario::find(cajeroActivoId()));
    if ($ruta === '/') {
        $this->get('/')->assertRedirect('/caja');
    }
    paginaInertia($this->get($ruta), $componente, $props);
})->with([
    'punto de venta' => ['/caja', 'Caja/Index', 16],
    'sus ventas' => ['/ventas', 'Ventas/Index', 16],
    'encargos' => ['/encargos', 'Encargos/Index', 13],
    'combos' => ['/combos', 'Combos/Index', 9],
    'cuentas por cobrar' => ['/cuentas-por-cobrar', 'CuentasPorCobrar/Index', 16],
]);

it('muestra el panel del portal solo con la sesión del operador', function () {
    $this->get('/portal')->assertRedirect('/portal/login');

    $this->withSession(['portal_admin' => 'pest']);
    paginaInertia($this->get('/portal'), 'Portal/Index', 11);
});

it('responde JSON parcial Inertia válido con la cabecera X-Inertia', function () {
    $this->actingAs(\App\Models\Usuario::find(adminId()));

    // Versión actual: sale de la página completa (data-page → version).
    $html = $this->get('/dashboard')->getContent();
    preg_match('/data-page="([^"]+)"/', $html, $m);
    expect($m)->toHaveCount(2);
    $data = json_decode(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'), true);
    expect($data['version'])->not->toBeEmpty();

    // Petición parcial: el cuerpo ES el JSON de Inertia con component + props.
    $parcial = $this->get('/dashboard', [
        'X-Inertia' => 'true',
        'X-Inertia-Version' => $data['version'],
    ]);
    $parcial->assertOk()
        ->assertHeader('X-Inertia', 'true')
        ->assertJsonStructure(['component', 'props', 'url', 'version']);
    $json = $parcial->json();
    expect($json['component'])->toBe('Dashboard')
        ->and(count($json['props']))->toBe(14)
        ->and($json['url'])->toContain('/dashboard');
});
