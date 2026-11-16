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
