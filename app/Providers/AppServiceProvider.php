<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Events\ConnectionEstablished;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /** Resultado de la guardia por proceso: null = sin verificar · false = sano · true = SUPERUSUARIO. */
    protected static ?bool $esSuperusuario = null;

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
        // Auditoría A-3 · guardia de superusuario. El RLS de PostgreSQL solo protege
        // a roles NO superusuario: si producción arranca conectada como postgres,
        // todo el aislamiento multiinquilino se ignora silenciosamente.
        //
        // La comprobación vive en el LISTENER de ConnectionEstablished: se dispara
        // al abrir la conexión de la app en CUALQUIER camino —HTTP (php -S, nginx,
        // Octane), queue:work, schedule:run, tinker y comandos de mantenimiento—.
        // Deliberadamente NO se consulta la base en boot(): un abort() durante el
        // arranque mataría al servidor antes de escuchar (artisan serve sale sin
        // bind) y el fallo sería menos diagnosticable que un 500 por petición.
        // Solo vigila la conexión de la APP: pgsql_admin y la del portal SÍ pueden
        // ser superusuario (el propagador y el instalador lo necesitan).
        if (app()->environment('production')) {
            Event::listen(ConnectionEstablished::class, function (ConnectionEstablished $e) {
                if ($e->connectionName === config('database.default')) {
                    $this->guardarSuperusuario();
                }
            });
        }

        // Auditoría (mejora 2 del CHANGES) · límites de tasa registrados con nombre:
        //   auth             → 600/min por USUARIO autenticado (10 req/s sostenido,
        //                      fallback: IP). No estrangula al POS real (una caja
        //                      ocupada dispara ~100 req/min de páginas + AJAX y
        //                      partials de Inertia) pero sí corta floods y spam
        //                      de un usuario comprometido; el límite DURO para
        //                      operaciones sensibles es el de abajo (10/min).
        //   portal_escritura → 10/min por IP+sesión para las 4 operaciones
        //                      destructivas del portal (verificar pago, publicar
        //                      tasa, cambiar estado de tienda, guardar cuenta).
        RateLimiter::for('auth', fn (Request $r) => Limit::perMinute(600)->by($r->user()?->id ? 'u'.$r->user()->id : 'ip'.$r->ip()));
        RateLimiter::for('portal_escritura', fn (Request $r) => Limit::perMinute(10)->by('portal'.$r->ip().($r->session()?->getId() ?? '')));

        // Observabilidad N1 · usuario_id en el contexto de TODA línea de log
        // en cuanto Laravel resuelve al usuario (Auth::onceBasic, sesión, token):
        // LogContexto comparte request_id/negocio_id al entrar, pero el usuario
        // aún no existe en ese momento — este listener lo añade en cuanto hay.
        Event::listen(\Illuminate\Auth\Events\Authenticated::class, function (\Illuminate\Auth\Events\Authenticated $e) {
            \Illuminate\Support\Facades\Log::shareContext([
                'usuario_id' => $e->guard()->user()?->getAuthIdentifier(),
            ]);
        });
    }

    /**
     * Aborta si la conexión de la app es un superusuario de PostgreSQL.
     * Fail-closed: una vez detectado el superusuario, TODA petición posterior
     * del proceso aborta (no solo la primera). Si ya salió sano, no vuelve a
     * preguntarle a la base (una conexión no cambia de rol a mitad del proceso).
     */
    protected function guardarSuperusuario(): void
    {
        if (static::$esSuperusuario === true) {
            abort(500, 'Configuración insegura: la app está conectada a PostgreSQL como superusuario. '
                .'Define DB_USERNAME=saas_app (ver MULTIINQUILINO.md y .env.production.example).');
        }
        if (static::$esSuperusuario === false) {
            return;
        }
        try {
            $super = (bool) DB::connection()->selectOne(
                'SELECT rolsuper FROM pg_roles WHERE rolname = current_user'
            )?->rolsuper;
        } catch (\Throwable $e) {
            return;   // sin base de datos: el error de conexión se mostrará al usar la app
        }
        static::$esSuperusuario = $super;
        if ($super) {
            // Queda en el log de la app (el HTML de producción es genérico con
            // APP_DEBUG=false): el operador ve la causa exacta y el remedio.
            \Illuminate\Support\Facades\Log::critical(
                'A-3 · Configuración insegura: la app está conectada a PostgreSQL como superusuario. '
                .'Define DB_USERNAME=saas_app (ver MULTIINQUILINO.md y .env.production.example).'
            );
            abort(500, 'Configuración insegura: la app está conectada a PostgreSQL como superusuario. '
                .'Define DB_USERNAME=saas_app (ver MULTIINQUILINO.md y .env.production.example).');
        }
    }
}
