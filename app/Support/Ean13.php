<?php

namespace App\Support;

/**
 * EAN-13 para las etiquetas de productos y los tickets de encargos. Los códigos internos
 * usan el rango 200–299 (reservado al uso interno de la tienda, no lo emite ningún organismo):
 *   producto: '20' + id a 10 dígitos + dígito de control  → 2000000000xx
 *   encargo:  '21' + id a 10 dígitos + dígito de control  → 2100000000xx
 * El escáner del POS teclea el número y /caja/buscar lo encuentra por codigo_barras exacto,
 * así que una etiqueta impresa por aquí se escanea directa al punto de venta.
 */
final class Ean13
{
    /** Dígito de control EAN-13 de un cuerpo de 12 dígitos (pesos 1-3-1-3…). */
    public static function digito(string $cuerpo12): int
    {
        if (preg_match('/^\d{12}$/', $cuerpo12) !== 1) {
            throw new \InvalidArgumentException('El cuerpo de un EAN-13 tiene 12 dígitos.');
        }
        $suma = 0;
        foreach (str_split($cuerpo12) as $i => $d) {
            $suma += (int) $d * ($i % 2 === 0 ? 1 : 3);
        }
        return (10 - $suma % 10) % 10;
    }

    /** EAN-13 completo (13 dígitos) a partir del cuerpo de 12. */
    public static function completo(string $cuerpo12): string
    {
        return $cuerpo12 . self::digito($cuerpo12);
    }

    /** Cuerpo de 12 dígitos: prefijo + id a 10 dígitos con ceros. Si el id no cabe lanza un error
     *  claro en vez de fabricar un código inválido: la capacidad del rango interno es 9.999.999.999. */
    private static function cuerpo(string $prefijo, int $id): string
    {
        $cuerpo = $prefijo . str_pad((string) $id, 10, '0', STR_PAD_LEFT);
        if (strlen($cuerpo) !== 12) {
            throw new \InvalidArgumentException("El id {$id} no cabe en el rango interno {$prefijo}: la capacidad es 9.999.999.999.");
        }
        return $cuerpo;
    }

    /** Código interno de un producto: único porque sale del id. */
    public static function codigoProducto(int $id): string
    {
        return self::completo(self::cuerpo('20', $id));
    }

    /** Código interno de un encargo (no choca con los de producto). */
    public static function codigoEncargo(int $id): string
    {
        return self::completo(self::cuerpo('21', $id));
    }

    /** ¿Es un EAN-13 válido (13 dígitos con su control correcto)? */
    public static function valido(string $codigo): bool
    {
        return preg_match('/^\d{13}$/', $codigo) === 1
            && (int) $codigo[12] === self::digito(substr($codigo, 0, 12));
    }
}
