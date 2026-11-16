<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Cabeceras de seguridad (auditoría B-1). Se aplican a todas las respuestas web:
 *   · X-Frame-Options: DENY            → nadie incrusta la app en un iframe (clickjacking).
 *   · X-Content-Type-Options: nosniff  → el navegador no adivina tipos MIME.
 *   · Referrer-Policy                  → no se filtran URLs internas al salir.
 *   · Permissions-Policy               → sin cámara/micrófono/geolocalización.
 *   · CSP (solo fuera de «local»)      → guiones solo propios: en desarrollo se
 *     omite para no romper Vite/HMR; en producción el frontend es estático y cabe.
 */
class SeguridadCabeceras
{
    public function handle(Request $request, Closure $next): Response
    {
        $respuesta = $next($request);

        $respuesta->headers->set('X-Frame-Options', 'DENY');
        $respuesta->headers->set('X-Content-Type-Options', 'nosniff');
        $respuesta->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $respuesta->headers->set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

        // Auditoría (mejora 7) · CSP por entorno, PROBADA antes de producción:
        //   local (normal)     → sin CSP, para no romper Vite/HMR.
        //   local + CSP_FORCE  → enforcement; así el E2E y los desarrolladores
        //                        pueden probar la CSP real sin un despliegue.
        //   staging            → Content-Security-Policy-Report-Only: el
        //                        navegador REPORTA (a /csp-report) sin romper
        //                        nada: se detecta toda rotura antes de firma.
        //   production         → enforcement completo.
        $politica = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; ".
            "font-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; ".
            "base-uri 'self'; form-action 'self'; report-uri /csp-report";
        $entorno = app()->environment();
        $forzada = filter_var((string) env('CSP_FORCE', false), FILTER_VALIDATE_BOOLEAN);
        $enforceDesde = (string) env('CSP_ENFORCE_FROM', '2026-12-01');
        $fechaEnforceAlcanzada = $enforceDesde !== '' && now('America/Caracas')->toDateString() >= $enforceDesde;

        if ($forzada || $entorno === 'production' || ($entorno === 'staging' && $fechaEnforceAlcanzada)) {
            $respuesta->headers->set('Content-Security-Policy', $politica);
        } elseif ($entorno === 'staging') {
            $respuesta->headers->set('Content-Security-Policy-Report-Only', $politica);
        }

        return $respuesta;
    }
}
