<?php

/*
 * SesionYCsrfTest · la seguridad de la sesión HTTP:
 *
 *   · el middleware CSRF rechaza un token falsificado con 419;
 *   · un login exitoso REGENERA el id de sesión (prevención de fijación);
 *   · el login a golpes responde 429 desde el sexto intento (throttle:5,1);
 *   · un usuario DESACTIVADO pierde la sesión al navegar (AccesoPorRol);
 *   · el logout cierra de verdad la sesión.
 *
 * Nota: la cubeta del throttle plano («sha1(dominio|ip)») es compartida por
 * todas las rutas con throttle n,m y la misma IP: /login, /registro y el
 * portal. Cada prueba de este archivo la limpia ANTES y DESPUÉS para que la
 * sesión de una prueba nunca la cobre la siguiente.
 */

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;

/** Vacía la cubeta del throttle plano para 127.0.0.1 (dominio vacío en las pruebas). */
function limpiarCubetaLogin(): void
{
    RateLimiter::clear(sha1('|127.0.0.1'));
}

it('un POST con el token CSRF falsificado no pasa (419)', function () {
    // Laravel 12 OMITE el filtro CSRF cuando runningUnitTests() (env=testing):
    // el middleware ni siquiera evalúa el token y el 419 jamás saldría. Para
    // probar la defensa de PRODUCCIÓN el entorno se declara production solo
    // para esta prueba y se restaura testing al salir (try/finally).
    app()->detectEnvironment(fn (): string => 'production');
    try {
        $this->get('/login');   // arranca la sesión con su cookie

        $this->post('/login', ['username' => 'admin', 'password' => 'incorrecta',
            '_token' => 'token-falsificado-por-el-atacante'])
            ->assertStatus(419);
    } finally {
        app()->detectEnvironment(fn (): string => 'testing');
    }
});

it('un POST con el token CSRF correcto NO recibe 419', function () {
    $this->get('/login');
    $token = (string) app(\Illuminate\Session\Store::class)->token();

    $this->post('/login', ['username' => 'admin', 'password' => 'incorrecta', '_token' => $token])
        ->assertStatus(302);   // pasa el filtro CSRF y responde el controlador
});

it('el login exitoso REGENERA el id de sesión (anti fijación)', function () {
    $cookie = (string) config('session.cookie');
    $antes = $this->get('/login')->getCookie($cookie)?->getValue();

    $resp = $this->post('/login', ['username' => 'admin', 'password' => 'PaginasTest2026']);
    $resp->assertStatus(302);
    $despues = $resp->getCookie($cookie)?->getValue();

    expect($antes)->not->toBeEmpty()
        ->and($despues)->not->toBeEmpty()
        ->and($antes)->not->toBe($despues);

    // Y quedó autenticado con la sesión nueva: el dashboard responde 200.
    $this->get('/dashboard')->assertOk();
});

it('el SEXTO intento de login en un minuto recibe 429', function () {
    limpiarCubetaLogin();

    for ($i = 0; $i < 5; $i++) {
        $this->post('/login', ['username' => 'admin', 'password' => 'clave-equivocada'])->assertStatus(302);
    }
    $resp = $this->post('/login', ['username' => 'admin', 'password' => 'clave-equivocada']);

    expect($resp->status())->toBe(429)
        ->and((string) $resp->headers->get('Retry-After'))->not->toBeEmpty();

    limpiarCubetaLogin();   // devolvemos la cubeta limpia a las demás pruebas
});

it('un usuario DESACTIVADO pierde la sesión al navegar', function () {
    $id = cajeroActivoId();
    DB::table('usuarios')->where('id', $id)->update(['activo' => false]);

    try {
        $this->actingAs(\App\Models\Usuario::find($id));
        $this->get('/dashboard')->assertRedirect('/login');
        expect(auth()->check())->toBeFalse();   // AccesoPorRol lo desloqueó
    } finally {
        DB::table('usuarios')->where('id', $id)->update(['activo' => true]);
    }
});

it('el logout POST cierra la sesión de verdad', function () {
    $this->actingAs(\App\Models\Usuario::find(adminId()));

    $this->post('/logout')->assertRedirect('/login');
    $this->get('/dashboard')->assertRedirect('/login');
});
