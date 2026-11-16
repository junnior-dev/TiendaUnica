<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/**
 * Cerca del plan (era del multitenant): en TIENDA ÚNICA la parte fiscal,
 * contable e ISLR siempre está incluida, así que el middleware deja pasar
 * todo. Se conserva (y con él PATRONES / esFiscal) por compatibilidad con
 * rutas y pruebas que lo referencian.
 */
class ModuloFiscal
{
    /** Patrones (Request::is) de todo lo que pertenece a la parte fiscal. */
    public const PATRONES = [
        'libros-fiscales', 'libros-fiscales/*',
        'retenciones-islr', 'retenciones-islr/*',
        'calendario-fiscal', 'calendario-fiscal/*',
        'declaracion-islr', 'declaracion-islr/*',
        'contabilidad', 'contabilidad/*',
        'conciliacion/fiscal', 'conciliacion/fiscal/*',
        'compras/*/retencion', 'compras/*/retencion/*',
        'compras/*/importacion',
    ];

    /**
     * ¿Esta petición toca la parte fiscal? Pura (sin estado) para poder probarla contra todas las rutas.
     * La pestaña «Declaraciones SENIAT» de Conciliación es una consulta (?vista=fiscal) sobre una pantalla operativa.
     */
    public static function esFiscal(string $ruta, array $consulta = []): bool
    {
        $ruta = strtolower(trim(rawurldecode($ruta), '/'));
        foreach (self::PATRONES as $p) {
            if (fnmatch($p, $ruta)) {
                return true;
            }
        }

        return $ruta === 'conciliacion' && (($consulta['vista'] ?? '') === 'fiscal');
    }

    public function handle(Request $request, Closure $next)
    {
        // Tienda única: la parte fiscal siempre está incluida (Tenant::fiscal()
        // devuelve true), así que nunca se bloquea nada.
        return $next($request);
    }
}
