<?php

/*
 * AtaqueBolaIdsCruzadosTest · Suite de Auditoría Forense (3/4) — BOLA/IDOR por ids en la URL.
 *
 * Un usuario del inquilino A adivina los ids del inquilino B cambiando el
 * número en la URL (y B hace lo mismo con los de A). El contrato duro:
 *
 *   · 403 o 404, y NADA más: un 200 mostraría la fila ajena y un 5xx sería
 *     el servidor rompiéndose ante un ataque, que es en sí mismo un agujero.
 *   · Tras la ronda completa de lecturas, la INTEGRIDAD de las filas de B se
 *     verifica por SQL directo (superusuario): la lectura no debe dejar
 *     rastro, y este es el mismo convenio del suite hostil.
 *
 * La lista cubre los 10 endpoints de lectura con id en la ruta, incluidos
 * los que el suite hostil ya certifica (los herejeros de proveedores y el
 * de devolvibles, corregido a 404 limpio). Reutiliza prepararInquilinoB()
 * del suite hostil; NUNCA lo redeclara.
 */

use Illuminate\Support\Facades\DB;

/**
 * Endpoints de LECTURA con id en la URL, con los ids de B.
 *
 * @param  array{cliente: int, producto: int, venta: int, proveedor: int}  $b
 * @return list<string>
 */
function forenseRutasBolaDeB(array $b): array
{
    return [
        "/clientes/{$b['cliente']}",
        "/productos/{$b['producto']}",
        "/proveedores/{$b['proveedor']}",
        "/proveedores/{$b['proveedor']}/cuenta",
        "/proveedores/{$b['proveedor']}/expediente",
        "/ventas/{$b['venta']}",
        "/ventas/{$b['venta']}/devolvibles",
        "/caja/venta/{$b['venta']}",
        "/kardex/producto/{$b['producto']}",
        "/cuentas-por-cobrar/cliente/{$b['cliente']}",
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

it('el inquilino A que adivina ids del B por URL recibe 403/404 y JAMÁS 200/5xx', function () {
    $b = prepararInquilinoB();
    $this->actingAs($b['admin']);

    // Acumulación: el diff final lista TODAS las rutas donde A vio algo del B
    // o donde el servidor explotó, con la ruta y el status exactos.
    $fallos = [];

    foreach (forenseRutasBolaDeB($b) as $ruta) {
        $status = $this->get("http://{$b['hostA']}{$ruta}")->status();
        if (! in_array($status, [403, 404], true)) {
            $fallos[] = "GET {$ruta} respondió {$status} (contrato BOLA: solo 403 o 404)";
        }
    }

    expect($fallos, 'lecturas cross-tenant que NO quedaron bloqueadas')->toBe([]);
});

it('la ronda de lecturas NO deja rastro: la integridad de B se verifica por SQL directo', function () {
    $b = prepararInquilinoB();
    $this->actingAs($b['admin']);

    foreach (forenseRutasBolaDeB($b) as $ruta) {
        $this->get("http://{$b['hostA']}{$ruta}");
    }

    // Superusuario: la fila de B sigue EXACTAMENTE igual tras la ronda.
    DB::statement('RESET ROLE');
    expect(DB::table('clientes')->where('id', $b['cliente'])->value('nombre'))->toBe($b['cliente_nombre'])
        ->and(DB::table('productos')->where('id', $b['producto'])->value('sku'))->toBe($b['producto_sku'])
        ->and(DB::table('ventas')->where('id', $b['venta'])->value('estado'))->toBe($b['venta_estado'])
        ->and(DB::table('proveedores')->where('id', $b['proveedor'])->exists())->toBeTrue();
    DB::statement('SET ROLE saas_app');
});

it('el inquilino B tampoco ve los recursos del A al adivinar ids (403/404)', function () {
    $b = prepararInquilinoB();
    $this->actingAs($b['adminB']);

    $rutas = [
        "/clientes/{$b['clienteA']}",
        "/productos/{$b['productoA']}",
        "/kardex/producto/{$b['productoA']}",
        "/cuentas-por-cobrar/cliente/{$b['clienteA']}",
    ];

    $fallos = [];

    foreach ($rutas as $ruta) {
        $status = $this->get('http://'.HOST_INQUILINO_B.$ruta)->status();
        if (! in_array($status, [403, 404], true)) {
            $fallos[] = "GET {$ruta} (como inquilino B) respondió {$status}";
        }
    }

    expect($fallos, 'lecturas cross-tenant del B hacia el A que NO quedaron bloqueadas')->toBe([]);
});
