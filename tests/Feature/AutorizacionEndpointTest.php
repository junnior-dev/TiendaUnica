<?php

/*
 * AutorizacionEndpointTest · la matriz de autorización POR ENDPOINT (no solo de página).
 *
 * El control fino del rol vive en dos capas: el middleware AccesoPorRol (que
 * devuelve al cajero a /caja) y los guards soloAdmin() de los controladores
 * (abort 403). Aquí se prueba cada capa con peticiones reales:
 *   · invitado  → redirigido a /login, sin tocar nada.
 *   · cajero    → los endpoints de administración devueltos (302 a /caja) o 403,
 *                 y NINGÚN dato cambia tras el intento.
 *   · admin     → los mismos endpoints funcionan (la autorización siempre pasa).
 *   · cajero    → /ventas solo muestra SUS ventas (propio) y /ventas/{id}/anular
 *                 es 403.
 */

use Illuminate\Support\Facades\DB;

/** El cajero no puede tocar estos endpoints de administración. */
dataset('endpoints_admin', [
    'crear usuario' => ['/usuarios', []],
    'crear producto' => ['/productos', ['sku' => 'X', 'nombre' => 'X', 'costo' => 1, 'unidad' => 'UND']],
    'ajustar stock' => ['/productos/999999/ajustar', ['cantidad' => 1, 'motivo' => 'prueba']],
    'crear proveedor' => ['/proveedores', []],
    'crear método de pago' => ['/metodos-pago', []],
    'crear cliente' => ['/clientes', []],
    'anular venta' => ['/ventas/999999/anular', ['motivo' => 'prueba']],
    'crear categoria' => ['/categorias', []],
]);

it('el invitado es redirigido al login en los endpoints de administración', function (string $ruta, array $datos) {
    $this->post($ruta, $datos)->assertRedirect('/login');
})->with('endpoints_admin');

it('el cajero NO puede ejecutar endpoints de administración (ni toca datos)', function (string $ruta, array $datos) {
    $this->actingAs(\App\Models\Usuario::find(cajeroActivoId()));

    $conteo = fn () => DB::selectOne(
        'SELECT (SELECT count(*) FROM productos) AS p, (SELECT count(*) FROM usuarios) AS u,
                (SELECT count(*) FROM clientes) AS c, (SELECT count(*) FROM categorias) AS k'
    );
    $antes = $conteo();

    $resp = $this->post($ruta, $datos);

    // El middleware AccesoPorRol lo devuelve a su pantalla de inicio…
    if ($resp->status() === 302) {
        expect($resp->headers->get('Location'))->toContain('/caja');
    } else {
        // …o el guard del controlador responde 403 (soloAdmin).
        expect($resp->status())->toBe(403);
    }

    // Y ningún dato cambió tras el intento.
    expect($conteo())->toEqual($antes);
})->with('endpoints_admin');

it('el admin SÍ pasa la autorización de los mismos endpoints', function (string $ruta, array $datos) {
    $this->actingAs(\App\Models\Usuario::find(adminId()));

    $payload = match ($ruta) {
        '/usuarios' => [
            'username' => 'pest_admin_' . random_int(1000, 9999),
            'nombre' => 'Creado por Pest',
            'rol' => 'CAJERO',
            'password' => 'ClaveSegura2026',
        ],
        '/productos' => [
            'sku' => 'PEST-' . random_int(1000, 9999), 'nombre' => 'Producto Pest',
            'costo' => 5, 'margen_pct' => 30, 'unidad' => 'UND', 'stock_inicial' => 3,
        ],
        '/productos/999999/ajustar' => ['cantidad' => 1, 'motivo' => 'Ajuste de prueba Pest'],
        '/proveedores' => [
            'rif' => rifValidoPest('J'), 'razon_social' => 'Proveedor Pest ' . random_int(1000, 9999),
        ],
        '/metodos-pago' => ['nombre' => 'Prueba Pest ' . random_int(1000, 9999), 'moneda' => 'USD', 'es_divisa' => true],
        '/clientes' => [
            'tipo' => 'V', 'documento' => (string) random_int(10000000, 29999999),
            'nombre' => 'Cliente Pest', 'telefono' => '04140000000',
        ],
        '/categorias' => ['nombre' => 'Categoría Pest ' . random_int(1000, 9999)],
        default => $datos,   // anular una venta inexistente → error controlado, no 403
    };

    $resp = $this->post($ruta, $payload);

    // El admin NUNCA recibe 403 ni es devuelto a /caja: la AUTORIZACIÓN pasa.
    expect($resp->status())->not->toBe(403)
        ->and($resp->status())->not->toBe(405);   // el endpoint existe para el admin
    if ($resp->status() === 302) {
        expect($resp->headers->get('Location'))->not->toContain('/caja');
    }
})->with('endpoints_admin');

/** Extrae los props del JSON que Inertia incrusta en data-page="…". */
function propsDePest(Illuminate\Testing\TestResponse $resp): array
{
    preg_match('/data-page="([^"]+)"/', $resp->getContent(), $m);
    expect($m)->toHaveCount(2, 'la página debe ser una página Inertia completa');

    return json_decode(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'), true)['props'];
}

it('el cajero solo ve SUS ventas en /ventas (propio)', function () {
    $admin = \App\Models\Usuario::find(adminId());
    $cajero = \App\Models\Usuario::find(cajeroActivoId());
    $producto = productoActivo();
    asegurarStock($producto);

    // Dos ventas reales: una del admin y una del cajero (vía la función de la base).
    $hacerVenta = function (int $uid) use ($producto): int {
        $items = json_encode([['producto_id' => $producto->id, 'cantidad' => 1, 'descuento_pct' => 0]]);
        DB::statement("SELECT set_config('app.negocio_id', '1', true)");
        $cot = DB::selectOne('SELECT * FROM tienda.fn_cotizar_venta(?::jsonb)', [$items]);
        $metodo = (int) DB::table('metodos_pago')->where('nombre', 'Pago móvil')->value('id');
        $pagos = json_encode([['metodo_pago_id' => $metodo,
            'monto' => round((float) $cot->total_usd * (float) $cot->tasa_cambio, 2), 'referencia' => 'PEST']]);

        return (int) DB::selectOne('SELECT tienda.fn_registrar_venta(?, ?::jsonb, ?::jsonb, NULL, ?, ?, FALSE, 0) AS v',
            [$uid, $items, $pagos, 'Venta Pest propio', 'PRESENCIAL'])->v;
    };

    // El admin también necesita SU turno abierto: los clones de CI son FRESCOS
    // (desde TEMPLATE) y no heredan el turno residual de otras corridas.
    if (DB::selectOne('SELECT tienda.fn_apertura_activa(?) AS a', [$admin->id])->a === null) {
        DB::selectOne('SELECT tienda.fn_abrir_caja(?, 100, 3650) AS a', [$admin->id]);
    }
    $ventaAdmin = $hacerVenta($admin->id);

    // El cajero también necesita SU turno abierto para poder vender.
    if (DB::selectOne('SELECT tienda.fn_apertura_activa(?) AS a', [$cajero->id])->a === null) {
        DB::selectOne('SELECT tienda.fn_abrir_caja(?, 100, 3650) AS a', [$cajero->id]);
    }
    $ventaCajero = $hacerVenta($cajero->id);

    $this->actingAs($cajero);
    $props = propsDePest($this->get('/ventas'));

    // En la respuesta solo puede estar el número de SU venta, nunca el del admin.
    $json = json_encode($props, JSON_UNESCAPED_UNICODE);
    expect($json)->toContain('"numero":' . $ventaCajero)
        ->not->toContain('"numero":' . $ventaAdmin);
});

it('el cajero no puede anular una venta real (403 del guard del controlador)', function () {
    $this->actingAs(\App\Models\Usuario::find(cajeroActivoId()));
    $this->post('/ventas/999999/anular', ['motivo' => 'intentando anular'])
        ->assertForbidden();
});

it('el cajero no puede ver /dashboard (redirigido a su inicio)', function () {
    $this->actingAs(\App\Models\Usuario::find(cajeroActivoId()));
    $this->get('/dashboard')->assertRedirect('/caja');
});
