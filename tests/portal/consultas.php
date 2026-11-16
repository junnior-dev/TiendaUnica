<?php
/** Emite como JSON las consultas del panel del portal para varios escenarios; p02_consultas.py las ejecuta en PostgreSQL. */
require (getenv('APP_RAIZ') ?: __DIR__.'/../..').'/app/Support/PortalConsultas.php';

use App\Support\PortalConsultas as C;

$por = 10;
$casos = [
    'tiendas_p1' => C::tiendas([], 1, $por), 'tiendas_p3' => C::tiendas([], 3, $por),
    'tiendas_mora' => C::tiendas(['estado' => 'MORA'], 1, 50), 'tiendas_plan' => C::tiendas(['plan' => 2], 1, 50),
    'tiendas_q' => C::tiendas(['q' => 'tienda-1'], 1, 50), 'tiendas_correo' => C::tiendas(['q' => 'dueno7@'], 1, 50),
    'tiendas_pct' => C::tiendas(['q' => '%'], 1, 50), 'tiendas_guion' => C::tiendas(['q' => '_'], 1, 50), 'tiendas_100' => C::tiendas(['q' => '100%'], 1, 50),
    'tiendas_vence' => C::tiendas(['orden' => 'vence'], 1, 50), 'tiendas_recientes' => C::tiendas(['orden' => 'recientes'], 1, 50),
    'tiendas_nombre' => C::tiendas(['orden' => 'nombre'], 1, 50), 'tiendas_mala_orden' => C::tiendas(['orden' => 'id; DROP TABLE portal.cobros'], 1, 50),
    'tiendas_mal_estado' => C::tiendas(['estado' => "X' OR 1=1 --"], 1, 50), 'tiendas_inyeccion' => C::tiendas(['q' => "'; DROP TABLE portal.cobros; --"], 1, 50),
    'tiendas_combo' => C::tiendas(['estado' => 'ACTIVO', 'plan' => 1, 'q' => 'tienda'], 1, 50),
    'por_vencer' => C::porVencer(7, 6), 'conteos_estados' => [C::conteos()['estados'], []], 'conteos_planes' => [C::conteos()['planes'], []],
    'historial' => C::historial([], 1, 50), 'historial_ver' => C::historial(['resultado' => 'VERIFICADO'], 1, 50),
    'historial_rech' => C::historial(['resultado' => 'RECHAZADO'], 1, 50), 'historial_q' => C::historial(['q' => 'REF-0003'], 1, 50),
    'cobros' => C::cobros([], 1, 50), 'cobros_q' => C::cobros(['q' => 'zelle'], 1, 50),
    'meta' => [C::meta(30, 1, 10), C::meta(30, 99, 10), C::meta(0, 1, 10), C::meta(31, 4, 10)],
    'saneo' => [C::por(1000), C::por('25'), C::por(null), C::pagina(-5), C::pagina('7'), C::pagina(10 ** 9)],
];
echo json_encode($casos, JSON_UNESCAPED_UNICODE);
