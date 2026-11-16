<?php

/*
 * JobConTenantTest · auditoría mejora 9: el GUC app.negocio_id también debe
 * limpiarse FUERA del ciclo HTTP. El middleware cubre las peticiones; los jobs
 * que tocan datos de una tienda deben usar el trait ConTenant, que fija el
 * tenant, ejecuta y —excepción incluida— deja la conexión neutra. Aquí se
 * despacha un job REAL (Bus::dispatchSync) y se comprueba la conexión de la
 * base antes y después, exactamente como t17 hizo para HTTP.
 */

use App\Jobs\RecalculoPreciosTenant;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;

/** GUC app.negocio_id tal como lo ve la conexión compartida AHORA. */
function gucNegocio(): string
{
    return (string) (DB::selectOne('SELECT current_setting(?, true) as v', ['app.negocio_id'])->v ?? '');
}

beforeEach(function () {
    // La base Pest corre con estado neutro: sin GUC al empezar cada prueba.
    DB::statement("SELECT set_config('app.negocio_id', '', false)");
});

it('el job ve SU tenant dentro y deja la conexión neutra al terminar', function () {
    $negocio = (int) DB::table('negocio')->orderBy('id')->value('id');
    expect($negocio)->toBeGreaterThan(0);

    $job = new RecalculoPreciosTenant($negocio);
    // Ruta de integración real (aunque el driver de colas fabrique otra
    // instancia, la conexión compartida debe quedar neutra):
    Bus::dispatchSync($job);
    expect(gucNegocio())->toBe('');

    // Ruta directa: aquí SÍ leemos el interior del trabajo.
    $salida = $job->handle();
    expect($salida['guc'])->toBe((string) $negocio)
        ->and($salida['negocio'])->not->toBe('');

    // Al terminar, la conexión compartida volvió a estar neutra (fail-closed).
    expect(gucNegocio())->toBe('');
});

it('un job que FALLA dentro del tenant limpia el GUC igual (finally)', function () {
    $negocio = (int) DB::table('negocio')->orderBy('id')->value('id');
    $job = new RecalculoPreciosTenant($negocio);

    try {
        $job->handleFallo();
        $this->fail('el job debía lanzar la excepción deliberada');
    } catch (\RuntimeException $e) {
        expect($e->getMessage())->toBe('fallo deliberado dentro del tenant');
    }

    expect(gucNegocio())->toBe('');
});

it('la conexión neutra como saas_app no ve nada (fail-closed), igual que en t17', function () {
    // La suite Pest conecta como postgres (superusuario: RLS no aplica a él).
    // La prueba real del fail-closed es como el ROL DE LA APP: GUC vacío → 0 filas.
    DB::transaction(function () {
        DB::statement('SET ROLE saas_app');
        try {
            DB::statement("SELECT set_config('app.negocio_id', '', false)");
            $visibles = (int) DB::scalar('SELECT count(*) FROM productos');
            expect($visibles)->toBe(0);
        } finally {
            DB::statement('RESET ROLE');
        }
    });
});
