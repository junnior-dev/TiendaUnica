<?php

/*
 * AislamientoMultiTenantHttpTest · BOLA/IDOR a nivel HTTP (la frontera del SaaS).
 *
 * El inquilino A ataca por HTTP los recursos del inquilino B adivinando sus
 * ids: GET para leerlos, PUT/PATCH/DELETE para corromperlos, y las LISTAS para
 * ver si filtran filas ajenas. Dos garantías:
 *
 *   1. NUNCA un 200: el servidor debe responder 403/404 (la fila del otro
 *      negocio NO existe para él) y, tras cada intento, la fila de B sigue
 *      EXACTAMENTE igual — integridad verificada por SQL directo.
 *   2. El aislamiento probado es el de PRODUCCIÓN: la conexión de pruebas es
 *      superusuario (RLS bypassado), así que antes de cada petición la sesión
 *      corre como saas_app con SET ROLE — el rol de conexión con el que la app
 *      hablaría con PostgreSQL en producción. Sin esto, un 200 sería un falso
 *      positivo del ambiente, no del código.
 *
 * El negocio 2 (inquilino B) es PERMANENTE (el trigger prohíbe borrarlo, igual
 * que en SesionTenantTest); lo retirable es su fila en estado_tenants, que se
 * quita en afterEach para devolver la base al modo tienda-única del resto de
 * las pruebas.
 */

use Illuminate\Support\Facades\DB;

/** Host HTTP del inquilino B (subdominio sobre SAAS_BASE_DOMAIN=localhost). */
const HOST_INQUILINO_B = 'bodega-pest.localhost';

/**
 * Prepara el inquilino B (negocio 2) con su usuario admin, catálogo y una
 * venta REAL creada por la función de la base. Se ejecuta como SUPERUSUARIO
 * y devuelve, además de los ids, los MODELOS ya cargados y el host del
 * inquilino A: con RLS, el rol saas_app sin GUC no puede consultar usuarios,
 * de modo que actingAs necesita esas instancias resueltas de antemano.
 *
 * @return array{admin: \App\Models\Usuario, adminB: \App\Models\Usuario, cliente: int, cliente_documento: string, cliente_nombre: string, producto: int, producto_sku: string, producto_nombre: string, venta: int, venta_estado: string, proveedor: int, metodo: int, clienteA: int, productoA: int, hostA: string}
 */
function prepararInquilinoB(): array
{
    DB::statement('RESET ROLE');   // superusuario: siembra con RLS bypassado

    if (! DB::table('negocio')->where('id', 2)->exists()) {
        DB::statement("INSERT INTO tienda.negocio (id, razon_social, nombre_comercial, rif, direccion_fiscal,
            telefono, correo, es_contribuyente_especial, cobra_igtf, recupera_credito_fiscal, precios_incluyen_iva,
            configurado_en, configurado_por)
            VALUES (2, 'Repuestos BOLA C.A.', 'Bodega BOLA', ?, 'Calle BOLA', '04140000002', 'bola@bodega.com',
            false, false, true, false, now(), 1)", [rifValidoPest('J')]);
    }
    if (! DB::table('estado_tenants')->where('negocio_id', 2)->exists()) {
        DB::statement("INSERT INTO tienda.estado_tenants (negocio_id, subdominio, activo, plan, modulos)
            VALUES (2, 'bodega-pest', true, 'BASE', '{\"repuestos\": true, \"fiscal\": true, \"editar_global\": true}')");
    }

    // Usuario ADMIN del negocio 2: pasa el middleware AccesoPorRol y el ataque
    // llega hasta los controladores, que es donde se mide el BOLA real.
    $uidB = DB::table('usuarios')->where('username', 'admin_bola')->value('id');
    if (! $uidB) {
        $uidB = DB::table('usuarios')->insertGetId([
            'negocio_id' => 2, 'username' => 'admin_bola', 'password_hash' => 'PENDIENTE',
            'nombre_completo' => 'Admin BOLA', 'rol' => 'ADMINISTRADOR', 'activo' => true,
        ]);
    }
    $uidA = adminId();

    // Catálogo mínimo del negocio 2 (es_efectivo es NOT NULL sin default).
    $pid = DB::table('productos')->where('sku', 'B2-BOLA')->value('id');
    if (! $pid) {
        $pid = DB::table('productos')->insertGetId([
            'negocio_id' => 2, 'sku' => 'B2-BOLA', 'nombre' => 'Producto BOLA', 'unidad' => 'UND',
            'costo_usd' => 3.5, 'margen_pct' => 30, 'stock_actual' => 0, 'activo' => true,
        ]);
        DB::statement("SELECT set_config('app.negocio_id', '2', false)");
        DB::statement('CALL tienda.sp_ajustar_stock(?, 50, ?, ?, true)', [$pid, 'Inventario inicial BOLA', $uidB]);
    }

    $cid = DB::table('clientes')->where('documento', '29999991')->value('id');
    if (! $cid) {
        $cid = DB::table('clientes')->insertGetId([
            'negocio_id' => 2, 'tipo_documento' => 'V', 'documento' => '29999991',
            'nombre' => 'BOLA Cliente Oculto', 'telefono' => '04140000002', 'activo' => true,
        ]);
    }

    $prid = DB::table('proveedores')->where('rif', 'J-29999992-1')->value('id');
    if (! $prid) {
        $prid = DB::table('proveedores')->insertGetId([
            'negocio_id' => 2, 'rif' => 'J-29999992-1', 'razon_social' => 'BOLA Proveedor Oculto', 'activo' => true,
        ]);
    }

    $mid = DB::table('metodos_pago')->where('negocio_id', 2)->value('id');
    if (! $mid) {
        $mid = DB::table('metodos_pago')->insertGetId([
            'negocio_id' => 2, 'nombre' => 'Pago móvil BOLA', 'moneda' => 'VES', 'es_divisa' => false,
            'aplica_igtf' => false, 'es_efectivo' => false, 'activo' => true,
        ]);
    }

    // Venta REAL del negocio 2 por la función de la base (caja abierta antes),
    // con el GUC del negocio 2 fijado exactamente como lo hace el middleware.
    DB::statement("SELECT set_config('app.negocio_id', '2', false)");
    if (DB::selectOne('SELECT tienda.fn_apertura_activa(?) AS a', [$uidB])->a === null) {
        DB::selectOne('SELECT tienda.fn_abrir_caja(?, 100, 3650) AS a', [$uidB]);
    }
    $items = json_encode([['producto_id' => (int) $pid, 'cantidad' => 1, 'descuento_pct' => 0]]);
    $cot = DB::selectOne('SELECT * FROM tienda.fn_cotizar_venta(?::jsonb)', [$items]);
    $pagos = json_encode([['metodo_pago_id' => (int) $mid,
        'monto' => round((float) $cot->total_usd * (float) $cot->tasa_cambio, 2), 'referencia' => 'BOLA']]);
    $vid = (int) DB::selectOne('SELECT tienda.fn_registrar_venta(?, ?::jsonb, ?::jsonb, NULL, ?, ?, FALSE, 0) AS v',
        [$uidB, $items, $pagos, 'Venta BOLA del inquilino B', 'PRESENCIAL'])->v;

    // Referencias del inquilino A (semilla) para el ataque en sentido contrario.
    $clienteA = (int) DB::table('clientes')->where('negocio_id', 1)->orderBy('id')->value('id');
    $productoA = (int) DB::table('productos')->where('negocio_id', 1)->where('activo', true)->orderBy('id')->value('id');
    $hostA = (string) DB::table('estado_tenants')->where('negocio_id', 1)->value('subdominio');

    DB::statement("SELECT set_config('app.negocio_id', '', false)");
    DB::statement('SET ROLE saas_app');   // de aquí en adelante: RLS como producción

    return [
        'admin' => \App\Models\Usuario::find($uidA),
        'adminB' => \App\Models\Usuario::find($uidB),
        'cliente' => (int) $cid,
        'cliente_documento' => '29999991',
        'cliente_nombre' => 'BOLA Cliente Oculto',
        'producto' => (int) $pid,
        'producto_sku' => 'B2-BOLA',
        'producto_nombre' => 'Producto BOLA',
        'venta' => $vid,
        'venta_estado' => 'COMPLETADA',
        'proveedor' => (int) $prid,
        'metodo' => (int) $mid,
        'clienteA' => $clienteA,
        'productoA' => $productoA,
        'hostA' => $hostA !== '' ? "{$hostA}.localhost" : 'localhost',
    ];
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

it('el inquilino A no puede LEER recursos del inquilino B (nunca 200)', function () {
    $b = prepararInquilinoB();
    $this->actingAs($b['admin']);

    $lecturas = [
        "/clientes/{$b['cliente']}",
        "/productos/{$b['producto']}",
        "/proveedores/{$b['proveedor']}",
        "/ventas/{$b['venta']}",
        "/caja/venta/{$b['venta']}",
        "/kardex/producto/{$b['producto']}",
        "/cuentas-por-cobrar/cliente/{$b['cliente']}",
    ];

    foreach ($lecturas as $ruta) {
        $resp = $this->get("http://{$b['hostA']}{$ruta}");
        $status = $resp->status();
        expect(in_array($status, [403, 404], true),
            "GET {$ruta} respondió {$status}: el inquilino A NO debe ver recursos del inquilino B")->toBeTrue();
    }
});

it('el inquilino A no puede MODIFICAR NI BORRAR recursos del inquilino B (y la fila queda intacta)', function () {
    $b = prepararInquilinoB();
    $this->actingAs($b['admin']);

    $ataques = [
        ['PUT', "/clientes/{$b['cliente']}", ['tipo' => 'V', 'documento' => '29999991', 'nombre' => 'HACKEADO POR BOLA']],
        ['PATCH', "/clientes/{$b['cliente']}/estado", ['activo' => false]],
        ['DELETE', "/clientes/{$b['cliente']}", null],
        ['PUT', "/productos/{$b['producto']}", ['nombre' => 'HACKEADO', 'costo' => 0.01]],
        ['PUT', "/proveedores/{$b['proveedor']}", ['razon_social' => 'HACKEADO']],
        ['DELETE', "/proveedores/{$b['proveedor']}", null],
        ['PATCH', "/metodos-pago/{$b['metodo']}/estado", ['activo' => false]],
        ['POST', "/ventas/{$b['venta']}/anular", ['motivo' => 'BOLA']],
    ];

    foreach ($ataques as [$metodo, $ruta, $payload]) {
        $url = "http://{$b['hostA']}{$ruta}";
        $resp = match ($metodo) {
            'PUT' => $this->put($url, $payload ?? []),
            'PATCH' => $this->patch($url, $payload ?? []),
            'DELETE' => $this->delete($url),
            default => $this->post($url, $payload ?? []),
        };
        $status = $resp->status();
        expect(in_array($status, [403, 404, 422], true),
            "{$metodo} {$ruta} respondió {$status}: el ataque cross-tenant no puede salir exitoso ni explotar")->toBeTrue();
    }

    // Integridad: como SUPERUSUARIO, la fila del inquilino B sigue EXACTAMENTE igual.
    DB::statement('RESET ROLE');
    $cliente = DB::table('clientes')->where('id', $b['cliente'])->first();
    expect($cliente->nombre)->toBe($b['cliente_nombre'])
        ->and((bool) $cliente->activo)->toBeTrue();
    $venta = DB::table('ventas')->where('id', $b['venta'])->first();
    expect($venta->estado)->toBe($b['venta_estado']);
    $producto = DB::table('productos')->where('id', $b['producto'])->first();
    expect($producto->sku)->toBe($b['producto_sku'])
        ->and($producto->nombre)->toBe($b['producto_nombre']);
    expect(DB::table('proveedores')->where('id', $b['proveedor'])->exists())->toBeTrue();
    $metodo = DB::table('metodos_pago')->where('id', $b['metodo'])->first();
    expect((bool) $metodo->activo)->toBeTrue();
    DB::statement('SET ROLE saas_app');
});

it('las LISTAS del inquilino A no filtran una sola fila del inquilino B', function () {
    $b = prepararInquilinoB();
    $this->actingAs($b['admin']);

    $clientes = propsDePest($this->get("http://{$b['hostA']}/clientes"));
    $jsonClientes = json_encode($clientes, JSON_UNESCAPED_UNICODE);
    expect($jsonClientes)->toContain('María Pérez')   // control: SU lista sí trae sus datos
        ->and($jsonClientes)->not->toContain($b['cliente_documento'])
        ->and($jsonClientes)->not->toContain($b['cliente_nombre']);

    $productos = propsDePest($this->get("http://{$b['hostA']}/productos"));
    $jsonProductos = json_encode($productos, JSON_UNESCAPED_UNICODE);
    expect($jsonProductos)->not->toContain($b['producto_sku'])
        ->and($jsonProductos)->not->toContain('BOLA');
});

it('el inquilino B tampoco ve los recursos del inquilino A (y su lista tampoco filtra)', function () {
    $b = prepararInquilinoB();
    $this->actingAs($b['adminB']);

    foreach (["/clientes/{$b['clienteA']}", "/productos/{$b['productoA']}"] as $ruta) {
        $resp = $this->get('http://'.HOST_INQUILINO_B.$ruta);
        expect(in_array($resp->status(), [403, 404], true),
            "GET {$ruta} (como inquilino B) respondió ".$resp->status())->toBeTrue();
    }

    $clientes = propsDePest($this->get('http://'.HOST_INQUILINO_B.'/clientes'));
    $json = json_encode($clientes, JSON_UNESCAPED_UNICODE);
    expect($json)->not->toContain('María Pérez')
        ->and($json)->not->toContain('Juan Rodríguez');
});

it('con DOS tiendas registradas, pedir SIN subdominio no adivina el inquilino (404)', function () {
    prepararInquilinoB();

    $resp = $this->get('/clientes');
    expect($resp->status())->toBe(404);
});

it('un subdominio NO registrado tampoco se cuela (404)', function () {
    prepararInquilinoB();

    $resp = $this->get('http://fantasma.localhost/clientes');
    expect($resp->status())->toBe(404);
});
