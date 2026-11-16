<?php

/*
|--------------------------------------------------------------------------
| Configuración de Pest (tests/Pest.php)
|--------------------------------------------------------------------------
| Suite Pest/PHPUnit del sistema: páginas Inertia (con assertInertia oficial),
| autorización por endpoint por rol, validaciones de formulario, flujo completo
| de venta por la pila Laravel y helpers puros. Corre contra las bases
| dedicadas tienda_pest / portal_pest (ver phpunit.xml), NUNCA contra la base
| del servidor en vivo.
|
|   ./vendor/bin/pest            (toda la suite)
|   ./vendor/bin/pest --filter=Paginas
*/

use Illuminate\Support\Facades\DB;

pest()->extend(Tests\TestCase::class)->in('Feature', 'Unit');

/*
 * Global: helper para leer valores del catálogo sembrado en la base de pruebas.
 */
function productoActivo(): object
{
    return DB::table('productos')->where('activo', true)->orderBy('id')->first();
}

/** Items de una línea sencilla con el producto dado (para cotizar/vender). */
function itemsVenta(object $producto, float $cantidad = 1): array
{
    return [['producto_id' => (int) $producto->id, 'cantidad' => $cantidad, 'descuento_pct' => 0]];
}

/** Reposición de stock para que las carreras de ventas siempre tengan unidades. */
function asegurarStock(object $producto, float $minimo = 5): void
{
    $actual = (float) DB::table('productos')->where('id', $producto->id)->value('stock_actual');
    if ($actual < $minimo) {
        $admin = adminId();
        DB::statement('CALL tienda.sp_ajustar_stock(?, ?, ?, ?)',
            [(int) $producto->id, $minimo - $actual, 'Reposición de pruebas Pest', $admin]);
    }
}

function adminId(): int
{
    return (int) DB::table('usuarios')->where('rol', 'ADMINISTRADOR')->orderBy('id')->value('id');
}

function cajeroActivoId(): int
{
    $id = DB::table('usuarios')->where('rol', 'CAJERO')->where('activo', true)->orderBy('id')->value('id');
    if (! $id) {
        // La plantilla siembra solo el admin: el cajero de prueba se crea una vez
        // (hash pendiente; los tests que inician sesión con él le fijan clave).
        $id = DB::table('usuarios')->insertGetId([
            'negocio_id' => 1,
            'username' => 'cajero_pest',
            'password_hash' => 'PENDIENTE',
            'nombre_completo' => 'Cajero de Pest',
            'rol' => 'CAJERO',
            'activo' => true,
        ]);
    }

    return (int) $id;
}

function cajeroConClave(): \App\Models\Usuario
{
    $usuario = \App\Models\Usuario::find(cajeroActivoId());
    if ($usuario->password_hash === 'PENDIENTE') {
        DB::statement("SELECT set_config('tienda.cambiando_password', '1', true)");
        DB::table('usuarios')->where('id', $usuario->id)
            ->update(['password_hash' => \Illuminate\Support\Facades\Hash::make('ClaveCajero2026')]);
        DB::statement("SELECT set_config('tienda.cambiando_password', '', true)");
        $usuario->refresh();
    }

    return $usuario;
}
