<?php
/** Regresión multi-tenant: ningún controlador puede apuntar al negocio 1 a mano (negocio.id = id de cada tienda).
 *  Uso: php tests/plan_basico/sin_id_fijo.php  (código 1 si encuentra alguno) */
$raiz = dirname(__DIR__, 2); $mal = [];
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($raiz.'/app', FilesystemIterator::SKIP_DOTS));
foreach ($it as $f) {
    if ($f->getExtension() !== 'php' || str_contains($f->getPathname(), 'RegisterController')) continue;
    foreach (file($f->getPathname()) as $n => $l) {
        if (preg_match("/WHERE id = 1\b|where\('id', *1\)/", $l)) $mal[] = substr($f->getPathname(), strlen($raiz) + 1).':'.($n + 1);
    }
}
echo $mal ? "FALLA: id=1 fijo en:\n  ".implode("\n  ", $mal)."\n" : "OK: ningún controlador usa negocio id=1 fijo.\n";
exit($mal ? 1 : 0);
