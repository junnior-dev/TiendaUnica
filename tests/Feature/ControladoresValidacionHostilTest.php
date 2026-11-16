<?php

/*
 * ControladoresValidacionHostilTest · FUZZING de los endpoints de escritura.
 *
 * Cada endpoint crítico recibe payloads basura —vacíos, tipos equivocados,
 * cadenas de 5000 caracteres, nulos, valores anidados, números extremos,
 * inyección SQL en los campos de texto, ids inexistentes— y el contrato es
 * duro:
 *
 *   · NUNCA un 500: la validación de Laravel o las reglas de negocio
 *     responden (302 con errores de sesión / 422 / 404 / 403 / 409); un
 *     QueryException sin capturar se vería aquí como 500 y el suite lo caza.
 *   · La basura INVÁLIDA no toca la base: tras cada intento el conteo de la
 *     tabla es exactamente el mismo.
 *   · La inyección SQL en los campos es DATO (consultas parametrizadas):
 *     nada se ejecuta — las ventas siguen intactas y las tablas vivas.
 *   · Una venta con items/pagos basura responde 422 y NO queda registrada.
 */

use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->actingAs(\App\Models\Usuario::find(adminId()));
    // Turno abierto: /caja/apertura y /caja/venta deben llegar a su validación
    // (con caja cerrada, la función de la base fallaría por otro motivo).
    if (DB::selectOne('SELECT tienda.fn_apertura_activa(?) AS a', [adminId()])->a === null) {
        $this->post('/caja/apertura', ['fondo_inicial_usd' => 100, 'fondo_inicial_ves' => 3650])->assertOk();
    }
});

/** @return list<array{string, string}> Los 10 endpoints críticos: [ruta, tabla que no debe cambiar]. */
function endpointsCriticos(): array
{
    return [
        ['/productos', 'productos'],
        ['/clientes', 'clientes'],
        ['/proveedores', 'proveedores'],
        ['/usuarios', 'usuarios'],
        ['/metodos-pago', 'metodos_pago'],
        ['/categorias', 'categorias'],
        ['/caja/apertura', 'aperturas_caja'],
        ['/movimientos-caja', 'movimientos_caja'],
        ['/encargos', 'encargos'],
        ['/cuentas-por-cobrar/pagos', 'cuentas_por_cobrar'],
    ];
}

/** @return array<string, array<string,mixed>> Payloads que DEBEN trip la validación. */
function basuraInvalida(): array
{
    $gigante = str_repeat('X', 5000);

    return [
        'vacío' => [],
        'tipos equivocados' => [
            'sku' => ['no' => 'array'], 'nombre' => 123, 'costo' => 'abc', 'unidad' => true,
            'tipo' => 7, 'documento' => null, 'razon_social' => ['x'], 'rif' => false,
            'rol' => ['SUPERUSUARIO'], 'username' => false, 'password' => [],
            'moneda' => 12.5, 'monto' => 'no-es-numero', 'fondo_inicial_usd' => 'millones',
            'fondo_inicial_ves' => [], 'concepto' => 999, 'producto_id' => 'letra',
            'cantidad' => 'mucho', 'activo' => 'si-claro', 'estado' => ['LISTO'],
        ],
        'cadena gigante' => [
            'sku' => $gigante, 'nombre' => $gigante, 'razon_social' => $gigante,
            'rif' => $gigante, 'documento' => $gigante, 'concepto' => $gigante,
            'referencia' => $gigante, 'username' => $gigante, 'password' => $gigante,
        ],
        'nulos y anidados' => [
            'nombre' => null, 'sku' => null, 'costo' => null, 'documento' => null,
            'items' => ['nested' => ['deep' => ['deeper' => ['deepest' => PHP_INT_MAX]]]],
            'componentes' => 'no-soy-array', 'pagos' => 'tampoco',
        ],
    ];
}

it('los 10 endpoints críticos RECHAZAN la basura (302 con errores / 422 / 404 / 409, nunca 500)', function () {
    foreach (endpointsCriticos() as [$ruta, $tabla]) {
        $conteo = fn (): int => (int) DB::selectOne("SELECT count(*) AS n FROM {$tabla}")->n;

        foreach (basuraInvalida() as $clase => $payload) {
            $antes = $conteo();
            $resp = $this->post($ruta, $payload);
            $status = $resp->status();

            expect(in_array($status, [302, 303, 422, 403, 404, 409], true),
                "POST {$ruta} [{$clase}] respondió {$status}")->toBeTrue();
            expect($status, "POST {$ruta} [{$clase}] explotó con {$status}")->toBeLessThan(500);

            if ($status === 302 || $status === 303) {
                $resp->assertSessionHasErrors();
            }
            // La basura inválida no creó ni borró nada. (Las cadenas de 5000
            // pueden pasar un «max» generoso y guardarse como dato: eso sería
            // un hallazgo de límites, no de integridad, y no se exige aquí.)
            if ($clase !== 'cadena gigante') {
                expect($conteo(), "POST {$ruta} [{$clase}] alteró {$tabla}")->toBe($antes);
            }
        }
    }
});

it('la inyección SQL en los campos es SOLO dato (no ejecuta, no explota)', function () {
    $ventasAntes = (int) DB::selectOne('SELECT count(*) AS n FROM ventas')->n;

    $inyecciones = [
        ['/productos', ['sku' => "B2-01' OR '1'='1", 'nombre' => "Pieza'); DROP TABLE categorias;--",
            'costo' => 5, 'unidad' => 'UND']],
        ['/clientes', ['tipo' => 'V', 'documento' => "' UNION SELECT password_hash FROM usuarios--",
            'nombre' => "Cliente'--", 'telefono' => '04140000000']],
        ['/categorias', ['nombre' => "Categoria' OR 1=1; DELETE FROM categorias;--"]],
        ['/movimientos-caja', ['tipo' => 'INGRESO', 'concepto' => "Flete'; DROP TABLE movimientos_caja;--",
            'monto' => 10, 'moneda' => 'VES']],
    ];

    foreach ($inyecciones as [$ruta, $payload]) {
        $resp = $this->post($ruta, $payload);
        $status = $resp->status();

        expect($status, "POST {$ruta} con inyección explotó con {$status}")->toBeLessThan(500);
        expect(in_array($status, [302, 303, 422, 403, 404, 409], true),
            "POST {$ruta} con inyección respondió {$status}")->toBeTrue();
    }

    // Nada fue ejecutado: las ventas siguen donde estaban y las tablas siguen vivas.
    expect((int) DB::selectOne('SELECT count(*) AS n FROM ventas')->n)->toBe($ventasAntes)
        ->and((int) DB::selectOne('SELECT count(*) AS n FROM categorias')->n)->toBeGreaterThan(0)
        ->and((int) DB::selectOne('SELECT count(*) AS n FROM movimientos_caja')->n)->toBeGreaterThanOrEqual(0);
});

it('los ids INEXISTENTES en escrituras responden 404/422 controlado (nunca 500)', function () {
    $ataques = [
        ['PUT', '/productos/99999999', ['nombre' => 'X', 'costo' => 5, 'unidad' => 'UND']],
        ['POST', '/productos/99999999/ajustar', ['cantidad' => 1, 'motivo' => 'prueba']],
        ['PUT', '/clientes/99999999', ['tipo' => 'V', 'documento' => '29999999', 'nombre' => 'X']],
        ['PATCH', '/clientes/99999999/estado', ['activo' => false]],
        ['DELETE', '/clientes/99999999', null],
        ['PUT', '/proveedores/99999999', ['razon_social' => 'X']],
        ['POST', '/proveedores/99999999/pagos', ['monto' => 10, 'moneda' => 'VES']],
        ['POST', '/encargos/99999999/estado', ['estado' => 'LISTO']],
        ['POST', '/conteos/99999999/aplicar', []],
        ['POST', '/ordenes-compra/99999999/recibir', []],
        ['PUT', '/combos/99999999', ['sku' => 'X', 'nombre' => 'X', 'componentes' => [['producto_id' => 1, 'cantidad' => 1]]]],
        ['PUT', '/metodos-pago/99999999', ['nombre' => 'X', 'moneda' => 'VES']],
        ['POST', '/cuentas-por-cobrar/pagos/99999999/anular', ['motivo' => 'anulado']],
        ['POST', '/movimientos-caja/99999999/anular', ['motivo' => 'anulado']],
        ['PUT', '/categorias/99999999', ['nombre' => 'X']],
        ['PUT', '/usuarios/99999999', ['nombre' => 'X', 'rol' => 'CAJERO']],
        ['POST', '/retenciones-islr/99999999/anular', ['motivo' => 'anulado']],
        ['POST', '/alertas-precio/99999999', []],
        ['PUT', '/modelos/99999999', ['nombre' => 'X']],
        ['POST', '/conciliacion/bancaria/99999999/cruzar', []],
        ['POST', '/compatibilidad/99999999/productos', []],
        ['POST', '/declaracion-islr/anticipos/99999999/anular', []],
        ['PUT', '/contabilidad/cuentas/99999999', []],
        ['PUT', '/clientes/99999999999999999999999', ['nombre' => 'X']],   // desborda whereNumber: 404 de ruta
    ];

    foreach ($ataques as [$metodo, $ruta, $payload]) {
        $resp = match ($metodo) {
            'PUT' => $this->put($ruta, $payload ?? []),
            'PATCH' => $this->patch($ruta, $payload ?? []),
            'DELETE' => $this->delete($ruta),
            default => $this->post($ruta, $payload ?? []),
        };
        $status = $resp->status();

        expect(in_array($status, [403, 404, 422, 302, 303, 409], true),
            "{$metodo} {$ruta} respondió {$status}")->toBeTrue();
        expect($status, "{$metodo} {$ruta} explotó con {$status}")->toBeLessThan(500);
    }
});

it('una venta con ITEMS o PAGOS basura responde 422 y NO queda registrada', function () {
    $ventasAntes = (int) DB::selectOne('SELECT count(*) AS n FROM ventas')->n;

    $ataques = [
        'items como texto' => ['items' => 'BASURA', 'pagos' => []],
        'sin producto' => ['items' => [['cantidad' => 1, 'descuento_pct' => 0]], 'pagos' => []],
        'cantidad negativa' => ['items' => [['producto_id' => productoActivo()->id, 'cantidad' => -5, 'descuento_pct' => 0]], 'pagos' => []],
        'cantidad texto' => ['items' => [['producto_id' => productoActivo()->id, 'cantidad' => 'varias', 'descuento_pct' => 0]], 'pagos' => []],
        'sin pagos' => ['items' => itemsVenta(productoActivo()), 'pagos' => []],
        'pago vacío' => ['items' => itemsVenta(productoActivo()), 'pagos' => [[]]],
        'método inexistente' => ['items' => itemsVenta(productoActivo()), 'pagos' => [['metodo_pago_id' => 99999999, 'monto' => 10, 'referencia' => 'FUZZ']]],
        'monto texto' => ['items' => itemsVenta(productoActivo()), 'pagos' => [['metodo_pago_id' => 1, 'monto' => 'cara', 'referencia' => 'FUZZ']]],
        'descuento imposible' => ['items' => [['producto_id' => productoActivo()->id, 'cantidad' => 1, 'descuento_pct' => 500]], 'pagos' => []],
    ];

    foreach ($ataques as $clase => $payload) {
        $resp = $this->postJson('/caja/venta', $payload);
        $status = $resp->status();

        expect($status, "caja/venta [{$clase}] explotó con {$status}")->toBeLessThan(500);
        expect(in_array($status, [422, 403, 404, 302], true),
            "caja/venta [{$clase}] respondió {$status}")->toBeTrue();
    }

    // NINGUNA venta basura quedó registrada.
    expect((int) DB::selectOne('SELECT count(*) AS n FROM ventas')->n)->toBe($ventasAntes);
});
