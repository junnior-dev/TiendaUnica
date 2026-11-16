<?php

namespace App\Http\Middleware;

use App\Support\Tenant;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Cerca del plan: la parte fiscal, contable e ISLR solo se abre a las tiendas cuyo plan la incluye (ESPECIAL y la DEMO
 * de 15 días). El plan Sistema es todo lo operativo —caja, inventario, compras, cobranza, reportes— sin esa parte.
 *
 * Nada se borra: los datos fiscales se siguen guardando por debajo (IVA, IGTF, retenciones, asientos), de modo que
 * quien sube de plan lo encuentra todo al día. Lo que cambia es lo que se MUESTRA y lo que se PUEDE ABRIR.
 *
 * Este middleware es la defensa real (el menú es solo comodidad): bloquea por URL, también las rutas que cuelgan de
 * pantallas operativas (/conciliacion/fiscal, /compras/{id}/retencion…), y responde 403 a cualquier método. Va en el
 * grupo autenticado de routes/web.php. Sin fila en estado_tenants (tienda única sin portal) todo queda abierto.
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
        if (! self::esFiscal($request->decodedPath(), $request->query()) || Tenant::fiscal()) {
            return $next($request);
        }
        $mensaje = 'Esa parte del sistema va con el plan Contribuyente especial.';
        if (! $request->isMethod('GET') || ($request->expectsJson() && ! $request->header('X-Inertia'))) {
            return response()->json(['message' => $mensaje], 403);
        }
        $negocio = DB::table('negocio')->first();

        return Inertia::render('Suscripcion/PlanRequerido', [
            'plan' => Tenant::estado()['plan'] ?? null,
            'modulo' => 'fiscal',
            'actual' => '/'.$request->path(),
            'negocio' => $negocio->nombre_comercial ?: ($negocio->razon_social ?? ''),
            'usuario' => ['nombre' => $request->user()->nombre_completo ?? '', 'rol' => ucfirst(strtolower($request->user()->rol ?? 'Cajero'))],
        ])->toResponse($request)->setStatusCode(403);
    }
}
