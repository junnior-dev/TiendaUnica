<?php

/**
 * Prueba de App\Support\Ean13 sin PHPUnit (se corre con: php tests/ean/ean13.php).
 * Cubre el dígito de control contra el ejemplo clásico del estándar, los códigos internos
 * de producto/encargo y la frontera de capacidad (10 mil millones de productos).
 */
require __DIR__ . '/../../app/Support/Ean13.php';

use App\Support\Ean13;

$fallos = 0;
$ok = function (bool $cond, string $nombre) use (&$fallos) {
    echo ($cond ? 'OK  ' : 'FAIL') . ' ' . $nombre . PHP_EOL;
    if (! $cond) $fallos++;
};

/* 1. El ejemplo clásico del estándar */
$ok(Ean13::completo('590123412345') === '5901234123457', '590123412345 + control = 5901234123457');
$ok(Ean13::valido('5901234123457'), 'valido() lo acepta');
$ok(! Ean13::valido('1234567890123'), 'valido() rechaza un control incorrecto');
$ok(! Ean13::valido('59012341234'), 'valido() rechaza longitud corta');

/* 2. Códigos internos: prefijo 20 producto, 21 encargo, control correcto */
$p = Ean13::codigoProducto(50000);
$ok($p === '200000050000' . Ean13::digito('200000050000'), 'producto id 50000 → ' . $p);
$ok(str_starts_with($p, '20') && Ean13::valido($p), 'rango interno 200… con control válido');
$e = Ean13::codigoEncargo(3);
$ok(str_starts_with($e, '21') && Ean13::valido($e), 'encargo id 3 → ' . $e);
$ok(Ean13::codigoProducto(5) !== Ean13::codigoEncargo(5), 'producto y encargo del mismo id no chocan');

/* 3. Frontera de capacidad: hasta 9.999.999.999 cabe; a partir de 10 mil millones lanza error */
$ult = Ean13::codigoProducto(9999999999);
$ok(strlen($ult) === 13 && Ean13::valido($ult), 'id 9.999.999.999 aún cabe (cuerpo de 12)');
try {
    Ean13::codigoProducto(10000000000);
    $ok(false, 'id 10.000.000.000 debe lanzar InvalidArgumentException');
} catch (InvalidArgumentException) {
    $ok(true, 'id 10.000.000.000 lanza InvalidArgumentException (capacidad documentada)');
}

echo $fallos ? PHP_EOL . $fallos . ' FALLOS' : PHP_EOL . 'TODAS LAS PRUEBAS EAN-13 PASARON';
exit($fallos ? 1 : 0);
