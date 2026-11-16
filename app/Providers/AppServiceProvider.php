<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Auditoría (mejora 2 del CHANGES) · límites de tasa registrados con nombre:
        //   auth → 600/min por USUARIO autenticado (10 req/s sostenido, fallback:
        //          IP). No estrangula al POS real (una caja ocupada dispara ~100
        //          req/min de páginas + AJAX y partials de Inertia) pero sí corta
        //          floods y spam de un usuario comprometido.
        RateLimiter::for('auth', fn (Request $r) => Limit::perMinute(600)->by($r->user()?->id ? 'u'.$r->user()->id : 'ip'.$r->ip()));

        // Observabilidad N1 · usuario_id en el contexto de TODA línea de log
        // en cuanto Laravel resuelve al usuario (Auth::onceBasic, sesión, token):
        // LogContexto comparte request_id/negocio_id al entrar, pero el usuario
        // aún no existe en ese momento — este listener lo añade en cuanto hay.
        // OJO: el evento expone $user como PROPIEDAD (guard() es del guard, no
        // del evento — llamar $e->guard() rompería cada petición autenticada).
        Event::listen(\Illuminate\Auth\Events\Authenticated::class, function (\Illuminate\Auth\Events\Authenticated $e) {
            \Illuminate\Support\Facades\Log::shareContext([
                'usuario_id' => $e->user->getAuthIdentifier(),   // el evento garantiza user no nulo
            ]);
        });
    }
}
