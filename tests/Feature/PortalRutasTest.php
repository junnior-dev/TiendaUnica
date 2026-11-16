<?php

/*
 * PortalRutasTest · auditoría C-1 como GARANTÍA, no como convención (mejora 1
 * del CHANGES). El middleware PortalAdmin protege /portal/* HOY; este test
 * recorre la TABLA DE RUTAS REAL y hace verdadera la frase «ninguna ruta
 * futura puede olvidarlo»: si alguien registra un /portal/... sin portal_admin,
 * el suite falla aquí, no en producción.
 */

use Illuminate\Support\Facades\Route;

/** Las rutas del portal que SON el login (única excepción permitida). */
const RUTAS_LOGIN_PORTAL = ['portal/login'];

it('TODA ruta /portal/* excepto el login lleva portal_admin', function () {
    $portal = collect(Route::getRoutes())->filter(
        fn ($r) => str_starts_with($r->uri(), 'portal/')
    );

    // La convención tiene sentido solo si hay rutas que proteger.
    expect($portal->count())->toBeGreaterThan(3);

    $vuln = $portal->reject(function ($r) {
        if (in_array($r->uri(), RUTAS_LOGIN_PORTAL, true)) {
            return true;   // el login es la excepción declarada
        }
        return in_array('portal_admin', $r->gatherMiddleware(), true);
    })->map(fn ($r) => strtoupper(implode('|', $r->methods())).' /'.$r->uri());

    expect($vuln->all())->toBe([], 'Rutas del portal sin portal_admin: '.$vuln->implode(', '));
});

it('el login del portal lleva su throttle de 5/min', function () {
    $login = collect(Route::getRoutes())->first(fn ($r) => $r->uri() === 'portal/login' && in_array('POST', $r->methods()));
    expect($login)->not->toBeNull()
        ->and($login->gatherMiddleware())->toContain('throttle:5,1');
});

it('las 4 escrituras destructivas del portal llevan portal_escritura (10/min)', function () {
    $escrituras = [
        'portal/pagos/{solicitud}/verificar',
        'portal/tasa',
        'portal/tenants/{tenant}/estado',
        'portal/cuentas',
    ];
    foreach ($escrituras as $uri) {
        $r = collect(Route::getRoutes())->first(fn ($x) => $x->uri() === $uri && in_array('POST', $x->methods()));
        expect($r, "falta la ruta POST /$uri")->not->toBeNull();
        expect($r->gatherMiddleware())->toContain('throttle:portal_escritura');
        // Y la defensa en profundidad original se mantiene: portal_admin encima.
        expect($r->gatherMiddleware())->toContain('portal_admin');
    }
});

it('todo el grupo privado lleva el throttle global auth (60/min)', function () {
    $privadas = collect(Route::getRoutes())->filter(fn ($r) => in_array('auth', $r->gatherMiddleware()));
    expect($privadas->count())->toBeGreaterThan(50);

    $sinThrottle = $privadas->reject(fn ($r) => in_array('throttle:auth', $r->gatherMiddleware()))
        ->map(fn ($r) => '/'.$r->uri());
    expect($sinThrottle->all())->toBe([], 'Rutas privadas sin throttle:auth: '.$sinThrottle->implode(', '));
});

it('el health check de base de datos responde sin sesión', function () {
    $r = $this->get('/health/db');
    expect($r->status())->toBe(200)
        ->and($r->json('db'))->toBe('ok')
        ->and($r->json('superusuario'))->toBeBool();
});
