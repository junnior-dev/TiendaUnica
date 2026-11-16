<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Tienda única: ya no se resuelve subdominio ni se fija negocio_id.
 *
 * El SQL siempre trabaja con negocio_id = 1.
 * Se mantiene el middleware por compatibilidad con la cadena de middlewares.
 */
class IdentificarTenant
{
    public function handle(Request $request, Closure $next): Response
    {
        // En tienda única no hay nada que resolver
        // Simplemente continuar con la petición
        return $next($request);
    }
}
