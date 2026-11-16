<?php

/*
 * AislamientoFiltrosDashboardTest · Suite de Auditoría Forense (2/4) — el test del Dashboard.
 *
 * El inquilino A recorre SUS páginas de lectura (dashboard, ventas, productos,
 * clientes) y el JSON que el servidor le manda a React debe contener SU mundo
 * y NADA del inquilino B. Dos garantías:
 *
 *   · Los conteos se miden con la MISMA LENTE que usa la app: RLS como
 *     `saas_app` + GUC `app.negocio_id` del negocio 1 (fijado exactamente
 *     como lo hace IdentificarTenant). Contar "3 vs 13" con fija sería
 *     frágil; aquí el conteo esperado sale de la MISMA vista/filtro que
 *     consulta el controlador, y el mundo global (superusuario) debe
 *     SUPERARLO porque B aporta al menos una venta REAL de HOY creada en
 *     vivo por fn_registrar_venta.
 *   · Los marcadores de B (sku, nombres, documento) NO pueden aparecer en
 *     NINGÚN rincón del JSON de Inertia: un where() mal filtrado o una
 *     vista sin RLS queda atrapado aquí, en la página exacta.
 *
 * Reutiliza prepararInquilinoB() (negocio 2 permanente con su venta) del
 * smoke hostil; NUNCA lo redeclara. El `estado_tenants` del negocio 2 se
 * retira en afterEach para devolver la base al modo tienda-única.
 */

use Illuminate\Support\Facades\DB;

/**
 * Mide el mundo del inquilino 1 con la lente de PRODUCCIÓN: primero el mundo
 * GLOBAL (superusuario) y los nombres de la semilla; después los conteos con
 * RLS como saas_app + GUC del negocio 1, la misma vista que consulta el
 * controlador (v_ventas_diarias / tablas base).
 *
 * @return array{hoy: string, global_hoy: int, nombre: string, cliente: string, ventas_hoy: int, ventas_usd_hoy: float, productos_activos: int, clientes_activos: int}
 */
function forenseMundoInquilinoA(): array
{
    DB::statement('RESET ROLE');   // superusuario: el mundo COMPLETO y la semilla
    $hoy = (string) DB::scalar('SELECT fn_hoy()');
    $globalHoy = (int) DB::scalar("SELECT count(*) FROM ventas WHERE estado = 'COMPLETADA' AND fecha_valor = ?", [$hoy]);
    $nombreA = (string) DB::scalar("SELECT COALESCE(nombre_comercial, razon_social, '') FROM negocio WHERE id = 1");
    $clienteA = (string) (DB::table('clientes')->where('negocio_id', 1)->orderBy('id')->value('nombre') ?? '');

    DB::statement('SET ROLE saas_app');
    DB::statement("SELECT set_config('app.negocio_id', '1', false)");   // la lente exacta del middleware
    // La MISMA vista que consulta DashboardController, con la MISMA lente:
    // sin fila para hoy, scalar() devuelve null y el cast cuenta 0.
    $ventasHoy = (int) DB::scalar('SELECT cantidad_ventas FROM v_ventas_diarias WHERE fecha = ?', [$hoy]);
    $usdHoy = round((float) DB::scalar('SELECT total_usd FROM v_ventas_diarias WHERE fecha = ?', [$hoy]), 2);
    $productosA = (int) DB::scalar('SELECT count(*) FROM productos WHERE activo');
    $clientesA = (int) DB::scalar('SELECT count(*) FROM clientes WHERE activo');
    DB::statement("SELECT set_config('app.negocio_id', '', false)");

    return [
        'hoy' => $hoy,
        'global_hoy' => $globalHoy,
        'nombre' => $nombreA,
        'cliente' => $clienteA,
        'ventas_hoy' => $ventasHoy,
        'ventas_usd_hoy' => $usdHoy,
        'productos_activos' => $productosA,
        'clientes_activos' => $clientesA,
    ];
}

/** Props de una página Inertia como texto plano, para rastrear marcadores del otro inquilino.
 *
 * @param  \Illuminate\Testing\TestResponse<\Illuminate\Http\Response>  $resp
 */
function forenseJsonDeProps(Illuminate\Testing\TestResponse $resp): string
{
    return json_encode(propsDePest($resp), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]';
}

beforeEach(function () {
    DB::statement('SET ROLE saas_app');
});

afterEach(function () {
    // La conexión vuelve neutra y SIN el rol de la app; se retira el estado
    // del inquilino B para que la base quede en modo tienda-única (el negocio
    // 2 es permanente: el trigger prohíbe borrarlo).
    DB::statement("SELECT set_config('app.negocio_id', '', false)");
    DB::statement('RESET ROLE');
    DB::table('estado_tenants')->where('negocio_id', 2)->delete();
});

it('el DASHBOARD del inquilino A trae SOLO su mundo (lente RLS, sin suma global ni marcadores de B)', function () {
    $b = prepararInquilinoB();
    $mundo = forenseMundoInquilinoA();

    // B aporta AL MENOS una venta de HOY (creada en vivo): el mundo global
    // debe superar estrictamente al de la lente del inquilino 1. Si el
    // dashboard mostrara el mundo global, kpis.cantidad no cuadraría.
    expect($mundo['global_hoy'], 'la venta real del inquilino B debe contar en el mundo global')
        ->toBeGreaterThanOrEqual($mundo['ventas_hoy'] + 1);

    $resp = $this->actingAs($b['admin'])->get("http://{$b['hostA']}/dashboard");
    $resp->assertInertia(fn ($page) => $page
        ->component('Dashboard')
        ->where('negocio', $mundo['nombre'])
        ->where('usuario.nombre', $b['admin']->nombre_completo)
        ->where('usuario.rol', 'Administrador')
        ->where('kpis.cantidad', $mundo['ventas_hoy'])
        ->where('kpis.ventas_usd', $mundo['ventas_usd_hoy']));

    $json = forenseJsonDeProps($resp);
    expect($json)->toContain($mundo['nombre'])          // control: SU mundo sí está
        ->and($json)->not->toContain('B2-BOLA')
        ->and($json)->not->toContain('Producto BOLA')
        ->and($json)->not->toContain('BOLA Cliente Oculto')
        ->and($json)->not->toContain('Bodega BOLA')
        ->and($json)->not->toContain('Repuestos BOLA')
        ->and($json)->not->toContain('Pago móvil BOLA')
        ->and($json)->not->toContain('BOLA Proveedor Oculto')
        ->and($json)->not->toContain('29999991');
});

it('las VENTAS del inquilino A cuentan solo SU período (resumen con la misma lente del controller)', function () {
    $b = prepararInquilinoB();
    $mundo = forenseMundoInquilinoA();

    $resp = $this->actingAs($b['admin'])->get("http://{$b['hostA']}/ventas");
    $resp->assertInertia(fn ($page) => $page
        ->component('Ventas/Index')
        ->where('negocio', $mundo['nombre'])
        ->where('usuario.nombre', $b['admin']->nombre_completo)
        ->where('resumen.ventas', $mundo['ventas_hoy'])
        ->where('es_admin', true));

    $json = forenseJsonDeProps($resp);
    expect($json)->not->toContain('B2-BOLA')
        ->and($json)->not->toContain('BOLA Cliente Oculto')
        ->and($json)->not->toContain('Bodega BOLA')
        ->and($json)->not->toContain('29999991');
});

it('los PRODUCTOS del inquilino A cuentan solo SU catálogo (y ningún sku del B se filtra)', function () {
    $b = prepararInquilinoB();
    $mundo = forenseMundoInquilinoA();

    // Con el filtro de búsqueda «B2», una fuga de la fila de B se vería en
    // filas INDEPENDIENTEMENTE de la paginación (si RLS fallara, el sku
    // B2-BOLA calza con el buscador por sku/nombre).
    $resp = $this->actingAs($b['admin'])->get("http://{$b['hostA']}/productos?q=B2");
    $resp->assertInertia(fn ($page) => $page
        ->component('Productos/Index')
        ->where('negocio', $mundo['nombre'])
        ->where('usuario.nombre', $b['admin']->nombre_completo)
        ->where('kpis.activos', $mundo['productos_activos']));

    $json = forenseJsonDeProps($resp);
    expect($json)->not->toContain('B2-BOLA')
        ->and($json)->not->toContain('Producto BOLA')
        ->and($json)->not->toContain('Bodega BOLA');
});

it('los CLIENTES del inquilino A cuentan solo SU cartera (y ningún cliente del B se filtra)', function () {
    $b = prepararInquilinoB();
    $mundo = forenseMundoInquilinoA();

    $resp = $this->actingAs($b['admin'])->get("http://{$b['hostA']}/clientes");
    $resp->assertInertia(fn ($page) => $page
        ->component('Clientes/Index')
        ->where('negocio', $mundo['nombre'])
        ->where('usuario.nombre', $b['admin']->nombre_completo)
        ->where('resumen.activos', $mundo['clientes_activos']));

    $json = forenseJsonDeProps($resp);
    expect($json)->toContain($mundo['cliente'])         // control: SU cartera sí está
        ->and($json)->not->toContain('BOLA Cliente Oculto')
        ->and($json)->not->toContain('29999991')
        ->and($json)->not->toContain('Bodega BOLA');
});
