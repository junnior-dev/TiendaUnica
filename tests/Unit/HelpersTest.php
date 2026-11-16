<?php

/*
 * HelpersTest · las piezas puras de PHP sin base de datos: la matriz de
 * permisos por rol (la fuente única que usan el middleware, el menú y la
 * pantalla de usuarios) y el cálculo de subdominio del middleware multi-tenant.
 */

use App\Support\Permisos;
use App\Support\Tenant;

it('envía a cada rol a su pantalla de inicio', function () {
    expect(Permisos::inicio('ADMINISTRADOR'))->toBe('/dashboard')
        ->and(Permisos::inicio('CAJERO'))->toBe('/caja')
        ->and(Permisos::inicio(null))->toBe('/caja');
});

it('el administrador puede abrir TODO', function () {
    foreach (['dashboard', 'usuarios', 'productos', 'compras', 'libros-fiscales', 'configuracion'] as $ruta) {
        expect(Permisos::permitido('ADMINISTRADOR', $ruta))->toBeTrue();
    }
});

it('el cajero puede vender y cobrar, pero no administrar', function () {
    // Los módulos suyos ('si' y 'propio').
    foreach (['caja', 'encargos', 'combos', 'ventas', 'cierre-caja', 'cuentas-por-cobrar'] as $ruta) {
        expect(Permisos::permitido('CAJERO', $ruta))->toBeTrue();
    }

    // Los de administración ('no').
    foreach (['dashboard', 'productos', 'kardex', 'compras', 'proveedores', 'clientes',
              'categorias', 'tasas', 'metodos-pago', 'libros-fiscales', 'contabilidad',
              'conciliacion', 'usuarios', 'configuracion', 'reportes'] as $ruta) {
        expect(Permisos::permitido('CAJERO', $ruta))->toBeFalse();
    }

    // Sus propias cuentas (contraseña) siempre pasan.
    expect(Permisos::permitido('CAJERO', 'cuenta/contrasena'))->toBeTrue();
});

it('extrae el subdominio del host del tenant', function () {
    $metodo = new ReflectionMethod(Tenant::class, 'subdominioDe');
    $metodo->setAccessible(true);
    $de = fn (string $host) => $metodo->invoke(null, $host);

    expect($de('moto-piezas.misitiolibre.com'))->toBe('moto-piezas')
        ->and($de('LA-CAVA.MISITIOLIBRE.COM'))->toBe('la-cava')
        ->and($de('www.misitiolibre.com'))->toBe('www')
        ->and($de('localhost'))->toBe('')
        ->and($de('127.0.0.1'))->toBe('')
        ->and($de('moto-piezas.misitiolibre.com:8080'))->toBe('moto-piezas');
});
