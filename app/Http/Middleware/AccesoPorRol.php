<?php

namespace App\Http\Middleware;

use App\Support\Permisos;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Tres guardas en una, para todo el grupo autenticado:
 *   1. Usuario desactivado → se cierra su sesión (desactivar a alguien lo saca aunque tenga la sesión abierta).
 *   2. Contraseña temporal (debe_cambiar_password) → solo puede abrir «Cambiar contraseña» hasta que la cambie.
 *   3. Rol → el cajero solo abre lo que dice App\Support\Permisos; lo demás lo devuelve a su pantalla de inicio con un aviso.
 */
class AccesoPorRol
{
    public function handle(Request $request, Closure $next): Response
    {
        $u = $request->user();
        if (! $u) {
            return $next($request);
        }
        if (! $u->activo) {
            Auth::logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
            return redirect('/login');
        }
        $path = $request->path();
        $json = $request->expectsJson() && ! $request->header('X-Inertia');

        if ($u->debe_cambiar_password && ! str_starts_with($path, 'cuenta') && $path !== 'logout') {
            return $request->isMethod('GET') && ! $json
                ? redirect('/cuenta/contrasena')
                : response()->json(['message' => 'Primero cambia tu contraseña temporal.'], 403);
        }
        if (! Permisos::permitido($u->rol, $path)) {
            if ($request->isMethod('GET') && ! $json) {
                return redirect(Permisos::inicio($u->rol))->with('ok', 'Esa pantalla es solo para administradores.');
            }
            return response()->json(['message' => 'Solo un administrador puede hacer esto.'], 403);
        }
        return $next($request);
    }
}
