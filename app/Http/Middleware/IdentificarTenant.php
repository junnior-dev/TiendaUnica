<?php

namespace App\Http\Middleware;

use App\Support\Tenant;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Multinquilino: decide QUÉ tienda atiende esta petición ANTES de tocar cualquier
 * dato y fija el GUC app.negocio_id en la conexión PostgreSQL (set_config).
 *
 *   1. El subdominio (la-cava.misitiolibre.com) se busca en tienda.estado_tenants.
 *   2. En desarrollo (localhost o una sola tienda registrada) se usa la única que hay.
 *   3. Varios negocios y sin subdominio → 404 (no se adivina: se dice).
 *   4. Suspendida por mora → 403 con mensaje claro; RLS además lo hace cumplir.
 *   5. El SQL restante queda aislado por RLS aunque se olvide un WHERE.
 *
 * Producción: la conexión debe usar el rol saas_app (nunca postgres).
 */
class IdentificarTenant
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->is('up') || $request->is('health/*') || $request->is('metrics')) {   // health y métricas no dependen de tenants (el orquestador/Prometheus no sabe de subdominios)
            try {
                return $next($request);
            } finally {
                Tenant::limpiar();  // la conexión vuelve al pool neutra
            }
        }

        Tenant::resolver($request->getHost());

        try {
            return $next($request);
        } finally {
            // Sin importar cómo termine la petición (respuesta o excepción), la
            // conexión PostgreSQL queda SIN negocio activo: ni pgBouncer en modo
            // sesión, ni Octane, ni un worker pueden heredar el tenant de la
            // petición anterior. El middleware de la siguiente petición vuelve a
            // fijarlo al empezar.
            Tenant::limpiar();
        }
    }
}
