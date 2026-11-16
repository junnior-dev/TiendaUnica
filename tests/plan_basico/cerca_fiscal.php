<?php
/**
 * Prueba de la cerca por plan (sin Laravel): recorre TODAS las rutas de routes/web.php y comprueba que
 *   1. toda ruta que llega a un controlador fiscal (o a un método fiscal de uno operativo) queda bloqueada, y
 *   2. ninguna ruta operativa del plan básico queda bloqueada por error.
 * Uso:  php tests/plan_basico/cerca_fiscal.php   (sale con código 1 si algo falla)
 */
require __DIR__.'/../../app/Http/Middleware/ModuloFiscal.php';

use App\Http\Middleware\ModuloFiscal;

$raiz = dirname(__DIR__, 2);
$web = file_get_contents($raiz.'/routes/web.php');
preg_match_all("~Route::(get|post|put|patch|delete)\(\s*'([^']*)'\s*,\s*(?:\[\s*([\\\\\w]+)::class\s*,\s*'(\w+)'\s*\]|fn)~", $web, $m, PREG_SET_ORDER);

// Controladores y métodos que son parte fiscal aunque la URL no lo diga.
$ctrlFiscal = ['LibrosFiscalesController', 'RetencionesIslrController', 'DeclaracionIslrController', 'CalendarioFiscalController', 'ContabilidadController'];
$metodoFiscal = ['ConciliacionController' => '/^fiscal/', 'ComprasController' => '/^(retencion|retencionAnular|importacion)$/'];
// Rutas operativas que el plan básico DEBE conservar (IVA, IGTF y factura forman parte de la venta).
$operativas = ['caja', 'caja/venta/1/factura', 'ventas', 'ventas/1/nota', 'compras', 'compras/1', 'compras/1/anular', 'conciliacion', 'conciliacion/bancaria',
               'configuracion', 'configuracion/regimen', 'configuracion/numeracion', 'reportes', 'productos', 'cierre-caja', 'suscripcion', 'clientes', 'dashboard'];

$ok = 0; $mal = [];
$n = 0;
$deben = 0;
foreach ($m as $f) {
    [$verbo, $uri, $ctrl, $metodo] = [$f[1], $f[2], $f[3] ?? '', $f[4] ?? ''];
    $n++;
    $ruta = preg_replace('/\{[^}]+\}/', '1', $uri);
    $ctrl = $ctrl ? substr(strrchr('\\'.$ctrl, '\\'), 1) : '';
    $debe = in_array($ctrl, $ctrlFiscal, true) || (isset($metodoFiscal[$ctrl]) && preg_match($metodoFiscal[$ctrl], $metodo));
    $deben += $debe ? 1 : 0;
    $bloq = ModuloFiscal::esFiscal($ruta);
    if ($debe && ! $bloq) { $mal[] = "ABIERTA  $verbo /$uri → $ctrl@$metodo"; } else { $ok++; }
}
echo "Rutas analizadas: $n; fiscales que deben estar cercadas: $deben; coinciden con lo esperado: $ok\n";
if ($deben < 40) { $mal[] = "La prueba es vacía: solo $deben rutas fiscales reconocidas"; }

// Las operativas siguen abiertas.
foreach ($operativas as $r) {
    if (ModuloFiscal::esFiscal($r)) { $mal[] = "BLOQUEADA POR ERROR /$r"; } else { $ok++; }
}
// Intentos de saltarse la cerca por la forma de la URL.
foreach (['libros-fiscales', '/libros-fiscales/', 'LIBROS-FISCALES', 'libros%2Dfiscales', 'libros%2dfiscales/paquete', 'Contabilidad/asientos',
          'compras/9/retencion', 'compras/9/retencion/anular', 'compras/9/importacion', 'conciliacion/fiscal', 'conciliacion/fiscal/reporte', 'declaracion-islr/liquidar'] as $r) {
    if (! ModuloFiscal::esFiscal($r)) { $mal[] = "SE COLÓ  /$r"; } else { $ok++; }
}
if (! ModuloFiscal::esFiscal('conciliacion', ['vista' => 'fiscal'])) { $mal[] = 'SE COLÓ  /conciliacion?vista=fiscal'; } else { $ok++; }
if (ModuloFiscal::esFiscal('conciliacion', ['vista' => 'bancaria'])) { $mal[] = 'BLOQUEADA POR ERROR /conciliacion?vista=bancaria'; } else { $ok++; }
if (ModuloFiscal::esFiscal('conciliacion')) { $mal[] = 'BLOQUEADA POR ERROR /conciliacion'; } else { $ok++; }

foreach ($mal as $l) { echo "FALLA  $l\n"; }
echo count($mal) ? "\n".count($mal)." FALLAS\n" : "\nTODO OK ($ok comprobaciones): la cerca cubre las rutas fiscales y deja libres las operativas.\n";
exit(count($mal) ? 1 : 0);
