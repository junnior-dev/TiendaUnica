<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
 * Alertas de ISLR (tienda única): consulta directamente el negocio 1, sin
 * estado_tenants. Termina con código 1 si hay algo vencido. Se ejecuta cada
 * día si el programador de Laravel está activo (php artisan schedule:run).
 */
Artisan::command('islr:alertas {--dias=7 : Días de anticipación}', function () {
    $vencido = false;
    $hubo = false;
    foreach (\App\Http\Controllers\DeclaracionIslrController::alertas(max(0, (int) $this->option('dias'))) as $a) {
        $hubo = true;
        $vencido = $vencido || $a['gravedad'] === 'VENCIDO';
        $linea = '['.$a['gravedad'].'] '.$a['mensaje'];
        $a['gravedad'] === 'VENCIDO' ? $this->error($linea) : $this->warn($linea);
        Log::warning('ISLR: '.$linea);
    }
    if (! $hubo) {
        $this->info('Sin alertas de ISLR.');
    }

    return $vencido ? 1 : 0;
})->purpose('Avisa de retenciones de ISLR por enterar y de vencimientos de ISLR cercanos');

Schedule::command('islr:alertas')->dailyAt('07:00')->timezone('America/Caracas');

/*
 * Monitoreo operativo mínimo: disco, queue worker, conexiones PG y esperas de locks.
 */
Artisan::command('sistema:monitoreo', function () {
    $salud = \App\Support\SaludSistema::verificar();

    if ($salud['alertas'] === []) {
        $this->info('Sistema OK (disco, queue, conexiones PG y locks dentro de umbral).');

        return 0;
    }

    foreach ($salud['alertas'] as $alerta) {
        $linea = '['.strtoupper($alerta['nivel']).' · '.$alerta['componente'].'] '.$alerta['mensaje'];
        if ($alerta['nivel'] === 'critical') {
            $this->error($linea);
            Log::critical($linea, $alerta);
        } else {
            $this->warn($linea);
            Log::warning($linea, $alerta);
        }
    }

    return 1;
})->purpose('Verifica disco, cola de jobs, conexiones PostgreSQL y esperas de locks');

Schedule::command('sistema:monitoreo')->everyFiveMinutes();
