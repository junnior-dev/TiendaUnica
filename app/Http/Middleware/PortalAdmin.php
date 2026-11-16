<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Puerta del panel del super administrador del portal (/portal/*).
 *
 * Auditoría C-1: los métodos de escritura (verificarPago, publicarTasa,
 * cambiarEstado, guardarCuenta) no verificaban la sesión y CUALQUIER visitante
 * podía aprobar pagos, publicar la tasa o suspender tiendas. Este middleware
 * aplica la verificación a TODO el grupo de rutas del portal (excepto el
 * login), de modo que ninguna ruta futura pueda olvidarlo.
 *
 * La contraseña del operador vive en PORTAL_ADMIN_PASSWORD (.env); el login la
 * compara y deja la marca de sesión «portal_admin».
 */
class PortalAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $autorizado = (bool) $request->session()->get('portal_admin')
            && (string) config('saas.portal_admin_password') !== '';

        if (! $autorizado) {
            if ($request->expectsJson() && ! $request->header('X-Inertia')) {
                return response()->json(['message' => 'No autorizado: entra con la contraseña del operador del portal.'], 403);
            }

            return redirect('/portal/login');
        }

        return $next($request);
    }
}
