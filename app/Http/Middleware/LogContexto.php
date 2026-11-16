<?php

namespace App\Http\Middleware;

use App\Support\Metricas;
use App\Support\Tenant;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Observabilidad N1 · contexto de logs y línea de acceso por petición.
 *
 *   1. AL ENTRAR comparte el contexto vía Log::shareContext(): request_id (el
 *      que traiga X-Request-Id o uno nuevo), negocio_id del tenant activo y
 *      la ruta PATRÓN (productos/{producto}: sin IDs reales para acotar la
 *      cardinalidad en logs y métricas). TODA línea de log de esta petición
 *      sale ya identificada — en multi-negocio, un error sin negocio_id no
 *      se puede auditar.
 *   2. AL SALIR (terminate, tras enviar la respuesta) escribe UNA línea en el
 *      canal «acceso»: método, ruta, estado, ms, negocio_id, usuario_id, ip.
 *      Es la materia prima de http_requests_total y de la duración por ruta.
 *   3. Devuelve X-Request-Id al cliente para correlacionar con sus reportes.
 */
class LogContexto
{
    public function handle(Request $request, Closure $next): Response
    {
        $idPeticion = (string) $request->header('X-Request-Id') ?: (string) Str::uuid();

        Log::shareContext([
            'request_id' => $idPeticion,
            'negocio_id' => Tenant::id(),
            'ruta' => static::patron($request),
        ]);

        $respuesta = $next($request);
        $respuesta->headers->set('X-Request-Id', $idPeticion);

        return $respuesta;
    }

    /** Se ejecuta tras enviar la respuesta: auth()->id() ya está resuelto. */
    public function terminate(Request $request, Response $response): void
    {
        // LARAVEL_START la define public/index.php (HTTP real); en pruebas y
        // comandos cae a REQUEST_TIME_FLOAT del propio SAPI.
        $inicio = defined('LARAVEL_START')
            ? LARAVEL_START
            : ($_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true));
        $ms = (int) round((microtime(true) - $inicio) * 1000);
        $ruta = static::patron($request);
        $negocio = Tenant::id();
        $usuario = auth()->id();

        // Métricas (contadores de caché). Jamás rompen la petición ya enviada.
        Metricas::registrar($ruta, $response->getStatusCode(), $ms, $negocio);

        try {
            $canal = (string) config('observabilidad.canal_acceso', 'acceso');
            if ($canal !== '') {
                Log::channel($canal)->info('http', [
                    'metodo' => $request->method(),
                    'ruta' => $ruta,
                    'estado' => $response->getStatusCode(),
                    'ms' => $ms,
                    'negocio_id' => $negocio,
                    'usuario_id' => $usuario,
                    'ip' => $request->ip(),
                ]);
            }
        } catch (\Throwable) {
            // sin canal de acceso no se invalida la respuesta ya enviada
        }
    }

    /** 'productos/12' → 'productos/{producto}'; sin ruta enlazada (404…): path. */
    public static function patron(Request $request): string
    {
        $ruta = $request->route();

        return $ruta !== null ? (string) $ruta->uri() : (string) $request->path();
    }
}
