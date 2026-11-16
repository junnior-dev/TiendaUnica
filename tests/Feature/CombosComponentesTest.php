<?php

/*
 * CombosComponentesTest · auditoría D-3 en Pest, sin depender de Playwright.
 * El bug real: v_combos.componentes llega como TEXTO (jsonb por PDO) y el
 * controlador lo iteraba como string → "componentes" colaba como string en vez
 * de array. CombosController::componentes() ahora decodifica; este test crea un
 * combo REAL por HTTP y verifica que los dos consumidores (lista para el POS,
 * datos para la pantalla) entregan SIEMPRE un array con la forma interna
 * correcta, para que una regresión no vuelva a alcanzar a los usuarios.
 */

use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->actingAs(\App\Models\Usuario::find(adminId()));
    $this->producto = productoActivo();
    asegurarStock($this->producto);
    $this->pid = (int) $this->producto->id;

    // Combo de trabajo (idempotente: si ya existe por una corrida anterior, se usa).
    $this->comboId = (int) (DB::table('combos')->where('nombre', 'Combo Regresión D3')->value('id')
        ?? (function () {
            $this->post('/combos', [
                'sku' => 'CB-D3', 'nombre' => 'Combo Regresión D3', 'descripcion' => 'combo del test D-3',
                'componentes' => [['producto_id' => $this->pid, 'cantidad' => 2]],
            ])->assertOk();

            return DB::table('combos')->where('nombre', 'Combo Regresión D3')->value('id');
        })());
    expect($this->comboId)->toBeGreaterThan(0, 'no se pudo dejar el combo del test');
});

it('GET /combos/lista entrega componentes como ARRAY, nunca string', function () {
    $json = $this->get('/combos/lista')->assertOk()->json();
    expect($json)->toBeArray();

    $combo = collect($json)->first(fn ($c) => (int) $c['id'] === $this->comboId);
    expect($combo)->not->toBeNull();
    expect($combo['componentes'])->toBeArray('componentes llegó como '.gettype($combo['componentes']));

    $c = $combo['componentes'][0] ?? null;
    expect($c)->not->toBeNull('el combo no trae su componente');
    expect($c['producto_id'])->toBeInt()->toBe($this->pid);
    expect($c)->toHaveKeys(['sku', 'nombre', 'cantidad', 'precio', 'stock', 'exento']);
});

it('la pantalla /combos (props Inertia) entrega componentes como array por combo', function () {
    $resp = $this->get('/combos')->assertOk();
    $props = $resp->inertiaProps();
    expect($props['combos'])->toBeArray();

    foreach ($props['combos'] as $combo) {
        expect($combo['componentes'])->toBeArray('componentes llegó como '.gettype($combo['componentes']));
    }
    $mios = collect($props['combos'])->first(fn ($c) => (int) $c['id'] === $this->comboId);
    expect($mios)->not->toBeNull();
    expect($mios['componentes'][0]['producto_id'] ?? null)->toBe($this->pid);
});

it('la VISTA cruda entrega texto (lo que rompía) y el controlador lo corrige por HTTP', function () {
    $crudo = DB::selectOne('SELECT componentes FROM v_combos WHERE id = ?', [$this->comboId])->componentes;
    expect(is_string($crudo))->toBeTrue('v_combos cambió su tipo: ajustar este test');

    $json = $this->get('/combos/lista')->assertOk()->json();
    foreach ($json as $combo) {
        expect($combo['componentes'])->toBeArray();
    }
});
