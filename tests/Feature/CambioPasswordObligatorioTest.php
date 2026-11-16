<?php

/*
 * CambioPasswordObligatorioTest · auditoría B-7 (mejora 6) en Pest.
 *
 * Dos garantías:
 *   1. La respuesta del ALTA de usuario lleva la clave temporal y NO puede
 *      quedar en cachés: Cache-Control: no-store.
 *   2. La obligación de cambiar la contraseña en el primer login NO es una
 *      promesa del frontend: es el middleware AccesoPorRol, probado aquí por
 *      HTTP (el usuario con debe_cambiar_password=true solo llega a
 *      /cuenta/contrasena; todo lo demás lo devuelve ahí, hasta que cambia).
 */

use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->actingAs(\App\Models\Usuario::find(adminId()));
});

it('el alta de usuario devuelve la clave temporal con Cache-Control: no-store', function () {
    $suffix = substr((string) time(), -6);
    $resp = $this->post('/usuarios', [
        'username' => 'temporal'.$suffix, 'nombre' => 'Temporal De Prueba',
        'rol' => 'CAJERO', 'password' => 'ClaveTemporal2026!',
    ])->assertOk();

    expect($resp->json('clave'))->toBe('ClaveTemporal2026!');   // la temporal viene en la respuesta…
    expect($resp->headers->get('Cache-Control'))->toContain('no-store');   // …pero sin copia en cachés.

    DB::table('usuarios')->where('username', 'temporal'.$suffix)->delete();
});

it('el usuario recién creado es rebotado a cambiar su contraseña (primer login)', function () {
    $suffix = substr((string) time(), -6);
    $this->post('/usuarios', [
        'username' => 'primerlogin'.$suffix, 'nombre' => 'Primer Login Prueba',
        'rol' => 'CAJERO', 'password' => 'TemporalABC2026!',
    ])->assertOk();

    $nuevo = \App\Models\Usuario::where('username', 'primerlogin'.$suffix)->first();
    expect($nuevo)->not->toBeNull()
        ->and((bool) $nuevo->debe_cambiar_password)->toBeTrue('sp_crear_usuario debe dejar la obligación encendida');

    $this->actingAs($nuevo);
    // Todo lo sensible lo devuelve a /cuenta/contrasena…
    $this->get('/dashboard')->assertRedirect('/cuenta/contrasena');
    $this->get('/caja')->assertRedirect('/cuenta/contrasena');
    $this->get('/ventas')->assertRedirect('/cuenta/contrasena');
    // …la única página disponible es la de cambiar contraseña.
    $this->get('/cuenta/contrasena')->assertOk();

    DB::table('usuarios')->where('username', 'primerlogin'.$suffix)->delete();
});

it('al cambiar la contraseña la obligación se apaga y el usuario entra normal', function () {
    $suffix = substr((string) time(), -6);
    $this->post('/usuarios', [
        'username' => 'cambiopass'.$suffix, 'nombre' => 'Cambio Pass Prueba',
        'rol' => 'CAJERO', 'password' => 'TemporalXYZ2026!',
    ])->assertOk();

    $nuevo = \App\Models\Usuario::where('username', 'cambiopass'.$suffix)->first();
    $this->actingAs($nuevo);
    $this->get('/dashboard')->assertRedirect('/cuenta/contrasena');

    // Cambia SU contraseña (la API exige la anterior).
    $this->post('/cuenta/contrasena', [
        'actual' => 'TemporalXYZ2026!', 'nueva' => 'MiNuevaClave2026!', 'nueva_confirmation' => 'MiNuevaClave2026!',
    ])->assertRedirect();

    expect((bool) $nuevo->fresh()->debe_cambiar_password)->toBeFalse('la obligación debió apagarse');
    // En producción cada petición recarga el usuario de la base; en el test el
    // guard conserva la instancia cacheada (con la obligación todavía encendida):
    // se re-autentica con la instancia FRESCA, igual que un nuevo request real.
    $this->actingAs($nuevo->fresh());
    // Con la obligación apagada, el middleware vuelve a enrutar POR ROL
    // (el cajero → /caja): antes lo devolvía a /cuenta/contrasena.
    $this->get('/dashboard')->assertRedirect('/caja');
    $this->get('/cuenta/contrasena')->assertOk();

    DB::table('usuarios')->where('username', 'cambiopass'.$suffix)->delete();
});
