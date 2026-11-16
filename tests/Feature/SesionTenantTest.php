<?php

/*
 * SesionTenantTest · la identidad de sesión MULTI-TENANT vista desde la app
 * Laravel (la misma conexión que los controladores usan por DB facade):
 *   · sin GUC, el rol de la aplicación no ve ni escribe nada (fail-closed);
 *   · con el GUC de TRANSACCIÓN (dentro de DB::transaction), ve y escribe SOLO
 *     su negocio y muere con el COMMIT;
 *   · el GUC de sesión persiste en la conexión hasta que alguien lo limpia
 *     (el riesgo de pool que Tenant::limpiar() neutraliza en cada petición).
 */

use Illuminate\Support\Facades\DB;

/** RIF venezolano CON dígito de control válido (mismo algoritmo de fn_validar_rif). */
function rifValidoPest(string $tipo = 'J'): string
{
    $cuerpo = (string) random_int(10000000, 29999999);
    $v = ['V' => 1, 'E' => 2, 'J' => 3, 'P' => 4, 'G' => 5, 'C' => 3][$tipo];
    $pesos = [3, 2, 7, 6, 5, 4, 3, 2];
    $suma = $v * 4;
    for ($i = 0; $i < 8; $i++) {
        $suma += (int) $cuerpo[$i] * $pesos[$i];
    }
    $dv = 11 - ($suma % 11);
    $dv = $dv >= 10 ? 0 : $dv;

    return "{$tipo}-{$cuerpo}-{$dv}";
}

beforeEach(function () {
    DB::statement('SET ROLE saas_app');
});

afterEach(function () {
    DB::statement("SELECT set_config('app.negocio_id', '', false)");
    DB::statement('RESET ROLE');
});

it('sin sesión de negocio el rol de la app no ve ni escribe nada', function () {
    expect((bool) DB::selectOne('SELECT tienda.fn_sesion_permitida() AS ok')->ok)->toBeFalse();

    // INSERT sin GUC → rechazado por el WITH CHECK de la política RLS.
    DB::table('categorias')->insert(['negocio_id' => 1, 'nombre' => 'Fantasma Pest']);
})->throws(\Illuminate\Database\QueryException::class);

it('con el GUC de TRANSACCIÓN ve y escribe SOLO su negocio', function () {
    DB::transaction(function () {
        DB::statement("SELECT set_config('app.negocio_id', '1', true)");
        expect((bool) DB::selectOne('SELECT tienda.fn_sesion_permitida() AS ok')->ok)->toBeTrue();

        $row = DB::selectOne('SELECT count(*) AS n, bool_and(negocio_id = 1) AS solo1 FROM ventas');
        expect($row->solo1)->toBeTrue();

        DB::table('categorias')->insert(['nombre' => 'Pest Sesión Transacción ' . random_int(1000, 9999)]);
        expect(DB::table('categorias')->where('nombre', 'like', 'Pest Sesión Transacción%')->value('negocio_id'))->toBe(1);
    });
});

it('el GUC de SESIÓN persiste en la conexión (por eso el middleware lo limpia)', function () {
    DB::statement("SELECT set_config('app.negocio_id', '1', false)");   // como Tenant::fijar()

    // Nueva "transacción" SIN fijar nada: la conexión recuerda al negocio 1.
    $row = DB::selectOne('SELECT count(*) AS n, bool_and(negocio_id = 1) AS solo1 FROM ventas');
    expect($row->n)->toBeGreaterThan(0)->and($row->solo1)->toBeTrue();

    // La limpieza nueva del middleware deja la conexión neutra (fail-closed).
    DB::statement("SELECT set_config('app.negocio_id', '', false)");
    expect(DB::selectOne('SELECT count(*) AS n FROM ventas')->n)->toBe(0);
});

it('dos negocios alternando en la misma conexión nunca se ven entre sí', function () {
    // Las comprobaciones de existencia se hacen como superusuario: con RLS el
    // rol de la app sin GUC no ve ninguna fila de negocio.
    // (La fila de negocio es permanente —el trigger prohíbe borrarla—; al final
    // se retira su estado_tenants para devolver la base al modo tienda-única.)
    DB::statement('RESET ROLE');
    if (! DB::table('negocio')->where('id', 2)->exists()) {
        DB::statement("INSERT INTO tienda.negocio (id, razon_social, nombre_comercial, rif, direccion_fiscal,
            telefono, correo, es_contribuyente_especial, cobra_igtf, recupera_credito_fiscal, precios_incluyen_iva,
            configurado_en, configurado_por)
            VALUES (2, 'Bodega Pest C.A.', 'Bodega Pest', ?, 'Calle Pest', '04140000000', 'pest@bodega.com',
            false, false, true, false, now(), 1)", [rifValidoPest('J')]);
    }
    if (! DB::table('estado_tenants')->where('negocio_id', 2)->exists()) {
        DB::statement("INSERT INTO tienda.estado_tenants (negocio_id, subdominio, activo, plan, modulos)
            VALUES (2, 'bodega-pest', true, 'BASE', '{\"repuestos\": true}')");
    }
    DB::statement('SET ROLE saas_app');

    try {
        foreach ([1, 2, 1, 2] as $negocio) {
            DB::statement("SELECT set_config('app.negocio_id', ?::text, false)", [(string) $negocio]);
            $row = DB::selectOne('SELECT count(*) AS n, COALESCE(bool_and(negocio_id = ?::integer), true) AS solo FROM ventas', [$negocio]);
            expect($row->solo)->toBeTrue();
        }

        // El negocio 1 ve sus ventas; el negocio 2 (nuevo, sin ventas) ve CERO:
        // si hubiera una fuga de sesión, aquí aparecerían filas ajenas.
        DB::statement("SELECT set_config('app.negocio_id', '1', false)");
        expect(DB::selectOne('SELECT count(*) AS n FROM ventas')->n)->toBeGreaterThan(0);
        DB::statement("SELECT set_config('app.negocio_id', '2', false)");
        expect(DB::selectOne('SELECT count(*) AS n FROM ventas')->n)->toBe(0);
    } finally {
        // Devuelve la base al modo tienda-única (el middleware exige subdominio
        // cuando hay más de una tienda registrada).
        DB::statement('RESET ROLE');
        DB::table('estado_tenants')->where('negocio_id', 2)->delete();
        DB::statement('SET ROLE saas_app');
    }
});
