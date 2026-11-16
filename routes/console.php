<?php

use App\Support\Tenant;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
 * Alertas de ISLR por tienda (multiinquilino): un comando artisan no tiene petición ni subdominio, así que recorre las tiendas activas
 * con la parte fiscal y fija cada negocio con Tenant::fijar() antes de consultar (el RLS aísla los datos de cada una).
 * Termina con código 1 si alguna tiene algo vencido. Se ejecuta solo cada día si el programador de Laravel está activo
 * (php artisan schedule:run cada minuto).
 */
Artisan::command('islr:alertas {--dias=7 : Días de anticipación} {--tienda= : Solo esta tienda (subdominio)}', function () {
    $q = DB::table('estado_tenants')->where('activo', true)->orderBy('negocio_id');
    if ($this->option('tienda')) $q->where('subdominio', $this->option('tienda'));
    $vencido = false; $hubo = false;
    foreach ($q->get() as $t) {
        Tenant::fijar((int) $t->negocio_id);
        if (! Tenant::modulo('fiscal')) continue;          // el plan Sistema no incluye la parte fiscal
        foreach (\App\Http\Controllers\DeclaracionIslrController::alertas(max(0, (int) $this->option('dias'))) as $a) {
            $hubo = true; $vencido = $vencido || $a['gravedad'] === 'VENCIDO';
            $linea = '[' . $t->subdominio . '] [' . $a['gravedad'] . '] ' . $a['mensaje'];
            $a['gravedad'] === 'VENCIDO' ? $this->error($linea) : $this->warn($linea);
            Log::warning('ISLR: ' . $linea);
        }
    }
    if (! $hubo) $this->info('Sin alertas de ISLR.');
    return $vencido ? 1 : 0;
})->purpose('Avisa, tienda por tienda, de retenciones de ISLR por enterar y de vencimientos de ISLR cercanos');

Schedule::command('islr:alertas')->dailyAt('07:00')->timezone('America/Caracas');

/*
 * Ciclo de cobro del portal: marca MORA a los vencidos, suspende al agotarse la gracia y lleva plan/suspensión
 * a cada tienda (tienda.estado_tenants). Es idempotente: se repite cada 5 minutos sin duplicar nada.
 */
Artisan::command('portal:propagar {--sin-barrido : Solo propaga, no recalcula mora ni suspensiones}', function () {
    if (! $this->option('sin-barrido')) {
        $mora = \App\Support\Portal::llamar('portal.fn_verificar_vencimientos()', []);
        $this->info("Barrido de vencimientos: {$mora} tienda(s) entraron en mora.");
    }
    $this->info(\App\Support\Propagador::aplicar().' tienda(s) actualizadas en estado_tenants.');
})->purpose('Aplica el veredicto del portal (mora, suspensión, plan) en las tiendas');

Schedule::command('portal:propagar')->everyFiveMinutes()->withoutOverlapping()->timezone('America/Caracas');
