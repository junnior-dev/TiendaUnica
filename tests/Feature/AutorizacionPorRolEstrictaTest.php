<?php

/*
 * AutorizacionPorRolEstrictaTest · la MATRIZ de autorización por rol, celda por
 * celda y con el código de estado EXACTO esperado (no «cualquier 4xx»):
 *
 *   · invitado   → 302 a /login en TODAS las páginas privadas y TODAS las
 *                  escrituras (el middleware auth responde antes que nada).
 *   · cajero     → 302 a /caja en cada página de administración y 403 EXACTO
 *                  en cada escritura que no le toca; 200 en SUS páginas y
 *                  422/302 (nunca 403) en las escrituras que sí le tocan.
 *   · admin      → 200 en todas sus páginas y nunca 403/405 en sus escrituras.
 *
 * La fuente de la matriz es App\Support\Permisos (la misma que usa el
 * middleware AccesoPorRol): si alguien cambia el rol del cajero, este test
 * obliga a hacerlo con la matriz en la mano.
 *
 * El portal va aparte: su sesión NO es la de la tienda — un cajero con sesión
 * de tienda NO puede entrar al panel, y la contraseña del operador es la
 * única llave (PORTAL_ADMIN_PASSWORD).
 */

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;

dataset('matriz_get', function (): array {
    /** @var list<string> $admin Páginas SOLO del administrador (Permisos: cajero='no'). */
    $admin = ['dashboard', 'productos', 'kardex', 'clientes', 'proveedores', 'compras', 'ordenes-compra',
        'conteos', 'reportes', 'movimientos-caja', 'configuracion', 'usuarios', 'tasas', 'metodos-pago',
        'marcas', 'modelos', 'compatibilidad', 'categorias', 'libros-fiscales', 'retenciones-islr',
        'declaracion-islr', 'calendario-fiscal', 'contabilidad', 'conciliacion'];

    /** @var list<string> $cajero Páginas del cajero (Permisos: 'si' o 'propio'). */
    $cajero = ['caja', 'ventas', 'encargos', 'combos', 'cierre-caja', 'cuentas-por-cobrar', 'cuenta/contrasena'];

    $celdas = [];
    foreach ($admin as $p) {
        $celdas[] = ['invitado', "/{$p}", 302, '/login'];
        $celdas[] = ['cajero', "/{$p}", 302, '/caja'];
        $celdas[] = ['admin', "/{$p}", 200, null];
    }
    foreach ($cajero as $p) {
        $celdas[] = ['invitado', "/{$p}", 302, '/login'];
        $celdas[] = ['cajero', "/{$p}", 200, null];
        $celdas[] = ['admin', "/{$p}", 200, null];
    }

    return $celdas;
});

dataset('matriz_escritura', [
    // [método, ruta, payload, ¿es escritura SOLO del administrador?]
    ['post', '/usuarios', [], true],
    ['put', '/usuarios/99999999', ['nombre' => 'X', 'rol' => 'CAJERO'], true],
    ['patch', '/usuarios/99999999/estado', ['activo' => false], true],
    ['post', '/productos', [], true],
    ['post', '/conteos', [], true],
    ['post', '/compras', [], true],
    ['post', '/movimientos-caja', [], true],
    ['delete', '/proveedores/99999999', null, true],
    ['delete', '/categorias/99999999', null, true],
    ['delete', '/metodos-pago/99999999', null, true],
    ['post', '/tasas/manual', [], true],
    ['post', '/configuracion/alicuota', [], true],
    ['post', '/kardex/ajustar', [], true],
    ['post', '/alertas-precio/aplicar-todas', [], true],
    ['post', '/ordenes-compra', [], true],
    ['put', '/modelos/99999999', ['nombre' => 'X'], true],
    ['post', '/combos', [], true],
    ['patch', '/combos/99999999/estado', ['activo' => false], true],
    ['post', '/clientes', [], true],
    ['post', '/ventas/99999999/anular', ['motivo' => 'anulado'], true],   // 'propio' permite VER, no ANULAR
    ['post', '/cierre-caja', [], false],                                  // el cajero cierra SU caja
    ['post', '/caja/venta', [], false],                                   // el cajero vende
    ['post', '/cuentas-por-cobrar/pagos', [], false],                     // el cajero cobra
    ['post', '/encargos', [], false],                                     // el cajero toma encargos
]);

it('la matriz GET de páginas es EXACTA por rol', function (string $rol, string $ruta, int $esperado, ?string $destino) {
    match ($rol) {
        'cajero' => $this->actingAs(cajeroConClave()),
        'admin' => $this->actingAs(\App\Models\Usuario::find(adminId())),
        default => null,
    };

    $resp = $this->get($ruta);
    if ($esperado === 302) {
        $resp->assertRedirect();
        expect(str_contains((string) $resp->headers->get('Location'), (string) $destino),
            "{$ruta} ({$rol}) redirige a ".$resp->headers->get('Location').", se esperaba {$destino}")->toBeTrue();
    } else {
        $resp->assertOk();
    }
})->with('matriz_get');

it('el invitado no puede ejecutar NINGUNA escritura (302 a /login)', function (string $metodo, string $ruta, ?array $payload, bool $soloAdmin) {
    $resp = match ($metodo) {
        'post' => $this->post($ruta, $payload ?? []),
        'put' => $this->put($ruta, $payload ?? []),
        'patch' => $this->patch($ruta, $payload ?? []),
        default => $this->delete($ruta),
    };

    $resp->assertRedirect('/login');
})->with('matriz_escritura');

it('el cajero SOLO escribe donde su rol permite (403 exacto en lo demás)', function (string $metodo, string $ruta, ?array $payload, bool $soloAdmin) {
    $this->actingAs(cajeroConClave());

    $resp = match ($metodo) {
        'post' => $this->post($ruta, $payload ?? []),
        'put' => $this->put($ruta, $payload ?? []),
        'patch' => $this->patch($ruta, $payload ?? []),
        default => $this->delete($ruta),
    };
    $status = $resp->status();

    if ($soloAdmin) {
        expect($status, "{$metodo} {$ruta} (cajero)")->toBe(403);
    } else {
        expect($status, "{$metodo} {$ruta} (cajero)")->not->toBe(403)->and($status)->not->toBe(405);
    }
})->with('matriz_escritura');

it('el administrador nunca recibe 403 ni 405 en sus escrituras', function (string $metodo, string $ruta, ?array $payload, bool $soloAdmin) {
    $this->actingAs(\App\Models\Usuario::find(adminId()));

    $resp = match ($metodo) {
        'post' => $this->post($ruta, $payload ?? []),
        'put' => $this->put($ruta, $payload ?? []),
        'patch' => $this->patch($ruta, $payload ?? []),
        default => $this->delete($ruta),
    };

    expect($resp->status(), "{$metodo} {$ruta} (admin)")->not->toBe(403);
    expect($resp->status(), "{$metodo} {$ruta} (admin)")->not->toBe(405);
})->with('matriz_escritura');

it('la raíz envía a cada rol a SU pantalla de inicio', function () {
    $this->get('/')->assertRedirect('/login');                       // invitado
    $this->actingAs(cajeroConClave());
    $this->get('/')->assertRedirect('/caja');                        // cajero
    $this->actingAs(\App\Models\Usuario::find(adminId()));
    $this->get('/')->assertRedirect('/dashboard');                   // administrador
});
