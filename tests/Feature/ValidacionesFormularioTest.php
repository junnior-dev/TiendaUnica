<?php

/*
 * ValidacionesFormularioTest · que las reglas de formulario RESPONDAN y muestren
 * sus mensajes (Laravel validate → errores de sesión; reglas de negocio → 422).
 */

it('el login vacío devuelve los dos errores obligatorios', function () {
    $this->from('/login')->post('/login', [])
        ->assertRedirect('/login')
        ->assertSessionHasErrors(['username', 'password']);
});

it('el producto sin SKU ni nombre no se guarda y explica qué falta', function () {
    $this->actingAs(\App\Models\Usuario::find(adminId()));

    $antes = \Illuminate\Support\Facades\DB::table('productos')->count();
    $this->from('/productos')->post('/productos', ['costo' => 5, 'unidad' => 'UND'])
        ->assertRedirect('/productos')
        ->assertSessionHasErrors(['sku', 'nombre']);

    expect(\Illuminate\Support\Facades\DB::table('productos')->count())->toBe($antes);
});

it('el usuario con nombre demasiado corto es rechazado con su mensaje', function () {
    $this->actingAs(\App\Models\Usuario::find(adminId()));

    // La API de usuarios devuelve sus validaciones como JSON 422 (falla()).
    $this->post('/usuarios', [
        'username' => 'ab',          // mínimo 3 caracteres
        'nombre' => 'Nombre válido largo',
        'rol' => 'CAJERO',
        'password' => 'ClaveSegura2026',
    ])->assertStatus(422)
      ->assertJsonValidationErrors(['username']);
});

it('un valor no numérico en el costo del producto es rechazado', function () {
    $this->actingAs(\App\Models\Usuario::find(adminId()));

    $this->from('/productos')->post('/productos', [
        'sku' => 'PEST-NEG-' . random_int(1000, 9999),
        'nombre' => 'Costo inválido',
        'costo' => 'no-es-un-numero',
        'unidad' => 'UND',
    ])->assertSessionHasErrors(['costo']);
});

it('el resultado de la búsqueda del POS responde con el producto buscado', function () {
    $this->actingAs(\App\Models\Usuario::find(cajeroActivoId()));
    $producto = productoActivo();

    $this->getJson('/caja/buscar?q=' . urlencode(mb_substr($producto->nombre, 0, 8)))
        ->assertOk()
        ->assertJsonFragment(['nombre' => $producto->nombre]);
});

it('el buscador sin resultados responde vacío sin error', function () {
    $this->actingAs(\App\Models\Usuario::find(cajeroActivoId()));

    $this->getJson('/caja/buscar?q=zzz-nada-existe-zzz')
        ->assertOk()
        ->assertJsonMissing(['nombre' => 'Aceite motor 20W-50 1L']);
});
