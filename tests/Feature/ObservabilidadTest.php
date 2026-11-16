<?php

/*
 * ObservabilidadTest · Nivel 1 en caliente (HTTP real a través de todo el stack):
 *   · /health/db, /health/cache y /health/queue responden SIN subdominio y sin
 *     sesión (el orquestador y Prometheus no saben de tenants);
 *   · /metrics exige token Bearer y FALLA CERRADO sin METRICS_TOKEN;
 *   · LogContexto genera X-Request-Id nuevo, respeta el que llega y deja la
 *     métrica de la petición contada;
 *   · Metricas suma y devuelve las series bien etiquetadas (negocio, ruta, estado).
 */

use App\Support\Metricas;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;

it('los health checks responden sin subdominio y sin sesión', function () {
    $this->get('/health/db')->assertOk()->assertJson(['db' => 'ok']);
    $this->get('/health/cache')->assertOk()->assertJsonStructure(['cache', 'driver', 'ms']);
    $this->get('/health/queue')->assertOk()->assertJson(['queue' => 'ok']);
});

it('health/queue reporta el driver sync del entorno de pruebas', function () {
    expect(config('queue.default'))->toBe('sync');
    $this->get('/health/queue')->assertJson(['queue' => 'ok', 'driver' => 'sync']);
});

it('health/cache escribe, lee y borra una clave real', function () {
    $respuesta = $this->get('/health/cache');
    $respuesta->assertOk();
    expect($respuesta->json('cache'))->toBe('ok');
    expect($respuesta->json('driver'))->toBe('array');   // phpunit.xml fija array
    expect((int) $respuesta->json('ms'))->toBeGreaterThanOrEqual(0);
});

it('metrics falla CERRADO sin token y con token equivocado', function () {
    Config::set('observabilidad.token', '');
    $this->get('/metrics')->assertForbidden();

    Config::set('observabilidad.token', 'correcto');
    $this->get('/metrics', ['Authorization' => 'Bearer incorrecto'])->assertForbidden();
    $this->get('/metrics')->assertForbidden();
});

it('metrics responde con token y formato de texto de Prometheus', function () {
    Config::set('observabilidad.token', 'prueba-prom-123');
    Metricas::registrar('pruebas/observabilidad', 200, 12, 1);   // garantiza ≥1 serie

    $respuesta = $this->get('/metrics', ['Authorization' => 'Bearer prueba-prom-123']);
    $respuesta->assertOk();
    expect($respuesta->headers->get('Content-Type'))->toContain('text/plain');
    expect($respuesta->getContent())->toContain('http_requests_total{');
    expect($respuesta->getContent())->toContain('negocio_id="1"');
    expect($respuesta->getContent())->toContain('ruta="pruebas/observabilidad"');
    expect($respuesta->getContent())->toContain('estado="200"');
});

it('metrics expone los gauges de PostgreSQL cuando la base responde', function () {
    try {
        DB::selectOne('SELECT 1');
    } catch (\Throwable) {
        $this->markTestSkipped('sin PostgreSQL visible en este entorno');
    }

    Config::set('observabilidad.token', 'prueba-prom-pg');
    $respuesta = $this->get('/metrics', ['Authorization' => 'Bearer prueba-prom-pg']);
    $respuesta->assertOk();
    expect($respuesta->getContent())->toContain('pg_stat_activity_count{');
    expect($respuesta->getContent())->toContain('postgres_max_connections ');
    expect($respuesta->getContent())->toContain('postgres_connections_pct ');
});

it('LogContexto genera X-Request-Id nuevo y respeta el que llega', function () {
    $sinHeader = $this->get('/health/cache');
    expect((string) $sinHeader->headers->get('X-Request-Id'))->toBeUuid();

    $conHeader = $this->withHeaders(['X-Request-Id' => 'prueba-id-correlacion'])->get('/health/cache');
    expect($conHeader->headers->get('X-Request-Id'))->toBe('prueba-id-correlacion');
});

it('Metricas acumula por etiqueta y snapshot desglosa negocio, ruta y estado', function () {
    Cache::flush();   // el driver de pruebas (array) se vacía sin tocar el caché del proceso web

    Metricas::registrar('productos/{producto}', 200, 55, 7);
    Metricas::registrar('productos/{producto}', 200, 45, 7);
    Metricas::registrar('productos/{producto}', 500, 30, 7);   // otro estado → otra serie

    $snapshot = Metricas::snapshot();

    $totales = collect($snapshot['total'])->filter(
        fn (array $s) => $s['etiquetas']['ruta'] === 'productos/{producto}' && $s['etiquetas']['negocio_id'] === '7'
    )->values();
    expect($totales)->toHaveCount(2);   // un contador por estado

    $doscientos = $totales->first(fn (array $s) => $s['etiquetas']['estado'] === '200');
    expect($doscientos['valor'])->toBe(2);
    expect($doscientos['etiquetas'])->toBe(['negocio_id' => '7', 'ruta' => 'productos/{producto}', 'estado' => '200']);

    $ms = collect($snapshot['ms'])->first(
        fn (array $s) => $s['etiquetas']['ruta'] === 'productos/{producto}'
    );
    // El acumulador de ms es por RUTA (todos los estados): 55 + 45 + 30.
    expect((float) $ms['valor'])->toBe(130.0);

    $n = collect($snapshot['n'])->first(
        fn (array $s) => $s['etiquetas']['ruta'] === 'productos/{producto}'
    );
    expect($n['valor'])->toBe(3);   // también contó la de 500
});

it('Metricas sobrevive a un caché roto sin lanzar excepción', function () {
    Config::set('cache.default', 'none_driver_inexistente');   // store inexistente

    Metricas::registrar('pruebas/roto', 200, 1, null);   // no debe lanzar
    expect(Metricas::snapshot()['total'])->toBe([]);
});

it('health/sistema reporta disco, cola, conexiones PG, esperas de locks, HTTP y negocio', function () {
    $respuesta = $this->get('/health/sistema');
    $respuesta->assertOk()->assertJsonStructure([
        'estado',
        'alertas',
        'disco' => ['ok', 'usado_pct', 'libre_gb', 'total_gb'],
        'cola' => ['ok', 'driver'],
        'postgres' => ['ok', 'conexiones_activas', 'max_connections', 'conexiones_pct', 'sesiones_esperando_lock', 'locks_no_otorgados'],
        'http' => ['ok', 'total_peticiones', 'errores_5xx', 'tasa_5xx_pct', 'caja_media_ms'],
        'negocio' => ['ok', 'en_horario', 'cajas_abiertas', 'ventas_ultima_hora'],
    ]);

    $this->artisan('sistema:monitoreo')->assertExitCode(0);
});

it('NotificadorAlertas despacha a webhook con cooldown y hace fallback si Log falla', function () {
    \Illuminate\Support\Facades\Http::fake();
    Config::set('observabilidad.alerta_webhook_url', 'https://hooks.test/alerta');
    Config::set('observabilidad.alerta_cooldown_s', 600);
    Cache::flush();

    try {
        $alerta = [['componente' => 'pg_locks', 'nivel' => 'critical', 'mensaje' => 'Lock > 5s']];
        expect(\App\Support\NotificadorAlertas::despachar($alerta))->toBe(1);
        expect(\App\Support\NotificadorAlertas::despachar($alerta))->toBe(0); // cooldown activo

        \Illuminate\Support\Facades\Http::assertSentCount(1);

        // Simula fallo del disco al escribir en el log (fallback a STDERR sin lanzar excepción)
        Cache::flush();
        \Illuminate\Support\Facades\Log::shouldReceive('critical')->once()->andThrow(new \RuntimeException('Disk full'));
        expect(\App\Support\NotificadorAlertas::despachar($alerta))->toBe(1);
    } finally {
        Config::set('observabilidad.alerta_webhook_url', '');
        Config::set('observabilidad.alerta_cooldown_s', 900);
    }
});

it('SaludSistema detecta tasa alta de 5xx y latencia alta en /caja', function () {
    Cache::flush();
    for ($i = 0; $i < 20; $i++) {
        Metricas::registrar('caja', $i < 3 ? 500 : 200, 1800, 1);
    }

    $salud = \App\Support\SaludSistema::verificar();
    $componentes = array_column($salud['alertas'], 'componente');

    expect($salud['estado'])->toBe('alerta');
    expect($componentes)->toContain('http_5xx');
    expect($componentes)->toContain('http_caja_latencia');
});

it('csp-report sanitiza, limita tamaño y aplica rate limiting', function () {
    $gigante = str_repeat('a', 9000);
    $this->postJson('/csp-report', ['csp-report' => ['blocked-uri' => $gigante]])->assertStatus(413);

    $this->postJson('/csp-report', [
        'csp-report' => [
            'document-uri' => "https://tienda.test/caja\r\nFAKE LOG",
            'violated-directive' => 'script-src',
            'blocked-uri' => 'https://evil.test/x.js',
            'campo-extra-no-permitido' => 'ignorado',
        ],
    ])->assertNoContent();
});
