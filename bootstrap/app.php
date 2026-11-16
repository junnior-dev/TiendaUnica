<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // IdentificarTenant PRIMERO (resuelve el negocio); LogContexto después
        // (ya puede leer Tenant::id() y comparte contexto para TODOS los logs
        // de la petición: request_id, negocio_id, ruta).
        $middleware->web(prepend: [\App\Http\Middleware\IdentificarTenant::class, \App\Http\Middleware\LogContexto::class]);
        $middleware->web(append: [\App\Http\Middleware\HandleInertiaRequests::class, \App\Http\Middleware\SeguridadCabeceras::class]);
        $middleware->alias([
            'portal_admin' => \App\Http\Middleware\PortalAdmin::class,
        ]);
        $middleware->redirectGuestsTo('/login');
        $middleware->redirectUsersTo('/dashboard');
        // El navegador manda los reportes de CSP por POST sin sesión ni token:
        // si no se excluye del CSRF, ninguna violación llegaría nunca.
        $middleware->validateCsrfTokens(except: ['csp-report']);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
