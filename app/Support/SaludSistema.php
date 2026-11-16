<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Verificación de salud operativa y alertas mínimas para producción:
 *   · Uso de disco en storage/
 *   · Estado de la cola (jobs pendientes, antigüedad máxima y fallidos recientes)
 *   · Conexiones PostgreSQL (activas vs max_connections)
 *   · Esperas de locks en PostgreSQL (pg_stat_activity + pg_locks)
 */
class SaludSistema
{
    public static function verificar(): array
    {
        $alertas = [];

        $disco = self::disco($alertas);
        $cola = self::cola($alertas);
        $postgres = self::postgres($alertas);
        $http = self::http($alertas);
        $negocio = self::negocio($alertas);

        return [
            'estado' => $alertas === [] ? 'ok' : 'alerta',
            'alertas' => $alertas,
            'disco' => $disco,
            'cola' => $cola,
            'postgres' => $postgres,
            'http' => $http,
            'negocio' => $negocio,
            'verificado_en' => now()->toIso8601String(),
        ];
    }

    private static function disco(array &$alertas): array
    {
        $ruta = storage_path();
        $total = @disk_total_space($ruta);
        $libre = @disk_free_space($ruta);

        if (! $total || $libre === false) {
            $alertas[] = ['componente' => 'disco', 'nivel' => 'error', 'mensaje' => 'No se pudo leer el espacio en disco'];

            return ['ok' => false];
        }

        $usadoPct = round((($total - $libre) / $total) * 100, 1);
        $umbral = (float) config('observabilidad.disco_max_pct', 85);

        if ($usadoPct >= $umbral) {
            $alertas[] = [
                'componente' => 'disco',
                'nivel' => $usadoPct >= 95 ? 'critical' : 'warning',
                'mensaje' => "Uso de disco al {$usadoPct}% (umbral {$umbral}%)",
            ];
        }

        return [
            'ok' => $usadoPct < $umbral,
            'usado_pct' => $usadoPct,
            'libre_gb' => round($libre / 1073741824, 2),
            'total_gb' => round($total / 1073741824, 2),
        ];
    }

    private static function cola(array &$alertas): array
    {
        $driver = (string) config('queue.default');
        if ($driver === 'sync') {
            return ['ok' => true, 'driver' => $driver];
        }

        if ($driver !== 'database') {
            return ['ok' => true, 'driver' => $driver];
        }

        try {
            $pendientes = (int) DB::table('jobs')->count();
            $masViejo = DB::table('jobs')->min('created_at');
            $antiguedad = $masViejo !== null ? max(0, time() - (int) $masViejo) : 0;
            $umbralEdad = (int) config('observabilidad.queue_max_age_s', 300);

            $fallidos1h = 0;
            $fallidos24h = 0;
            if (DB::getSchemaBuilder()->hasTable('failed_jobs')) {
                $fallidos1h = (int) DB::table('failed_jobs')
                    ->where('failed_at', '>=', now()->subHour())
                    ->count();
                $fallidos24h = (int) DB::table('failed_jobs')
                    ->where('failed_at', '>=', now()->subDay())
                    ->count();
            }

            if ($pendientes > 0 && $antiguedad >= $umbralEdad) {
                $alertas[] = [
                    'componente' => 'queue',
                    'nivel' => 'critical',
                    'mensaje' => "Queue worker posiblemente caído: {$pendientes} job(s) pendientes, el más antiguo lleva {$antiguedad}s",
                ];
            }

            $umbralFallidos = (int) config('observabilidad.failed_jobs_max', 10);
            if ($fallidos1h >= $umbralFallidos) {
                $alertas[] = [
                    'componente' => 'queue_failed',
                    'nivel' => 'critical',
                    'mensaje' => "Pico de jobs fallidos: {$fallidos1h} en la última hora (umbral {$umbralFallidos})",
                ];
            }

            return [
                'ok' => ! ($pendientes > 0 && $antiguedad >= $umbralEdad) && $fallidos1h < $umbralFallidos,
                'driver' => $driver,
                'pendientes' => $pendientes,
                'antiguedad_maxima_s' => $antiguedad,
                'fallidos_1h' => $fallidos1h,
                'fallidos_24h' => $fallidos24h,
            ];
        } catch (Throwable $e) {
            $alertas[] = [
                'componente' => 'queue',
                'nivel' => 'error',
                'mensaje' => 'Error consultando cola: '.substr($e->getMessage(), 0, 120),
            ];

            return ['ok' => false, 'driver' => $driver];
        }
    }

    private static function postgres(array &$alertas): array
    {
        try {
            $maxConn = (int) (DB::selectOne("SELECT current_setting('max_connections')::int AS m")->m ?? 100);
            $activas = (int) (DB::selectOne(
                'SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database()'
            )->n ?? 0);
            $connPct = $maxConn > 0 ? round(($activas / $maxConn) * 100, 1) : 0.0;
            $umbralConn = (float) config('observabilidad.pg_conn_max_pct', 80);

            if ($connPct >= $umbralConn) {
                $alertas[] = [
                    'componente' => 'pg_conexiones',
                    'nivel' => $connPct >= 95 ? 'critical' : 'warning',
                    'mensaje' => "Conexiones PG al {$connPct}% ({$activas}/{$maxConn})",
                ];
            }

            $umbralLockS = (float) config('observabilidad.pg_lock_wait_s', 1.0);
            $esperasLock = DB::select(
                "SELECT a.pid,
                        ROUND(EXTRACT(EPOCH FROM (now() - COALESCE(a.state_change, a.query_start)))::numeric, 2) AS espera_s,
                        LEFT(REGEXP_REPLACE(COALESCE(a.query, ''), '[\\r\\n\\t]+', ' ', 'g'), 160) AS query
                   FROM pg_stat_activity a
                  WHERE a.datname = current_database()
                    AND a.pid <> pg_backend_pid()
                    AND a.wait_event_type = 'Lock'
                    AND EXTRACT(EPOCH FROM (now() - COALESCE(a.state_change, a.query_start))) >= ?",
                [$umbralLockS]
            );

            $locksNoOtorgados = (int) (DB::selectOne(
                'SELECT count(*) AS n FROM pg_locks l
                   JOIN pg_database d ON d.oid = l.database
                  WHERE d.datname = current_database() AND NOT l.granted'
            )->n ?? 0);

            if ($esperasLock !== [] || $locksNoOtorgados > 0) {
                $maxEspera = $esperasLock !== [] ? max(array_map(fn ($r) => (float) $r->espera_s, $esperasLock)) : 0.0;
                $alertas[] = [
                    'componente' => 'pg_locks',
                    'nivel' => $maxEspera >= 5.0 ? 'critical' : 'warning',
                    'mensaje' => 'Esperas de lock en PostgreSQL: '.count($esperasLock)." sesión(es) >= {$umbralLockS}s, {$locksNoOtorgados} lock(s) pendientes (máx {$maxEspera}s)",
                    'detalle' => array_map(fn ($r) => [
                        'pid' => (int) $r->pid,
                        'espera_s' => (float) $r->espera_s,
                        'query' => (string) $r->query,
                    ], $esperasLock),
                ];
            }

            return [
                'ok' => $connPct < $umbralConn && $esperasLock === [] && $locksNoOtorgados === 0,
                'conexiones_activas' => $activas,
                'max_connections' => $maxConn,
                'conexiones_pct' => $connPct,
                'sesiones_esperando_lock' => count($esperasLock),
                'locks_no_otorgados' => $locksNoOtorgados,
            ];
        } catch (Throwable $e) {
            $alertas[] = [
                'componente' => 'postgres',
                'nivel' => 'critical',
                'mensaje' => 'Error consultando PostgreSQL: '.substr($e->getMessage(), 0, 120),
            ];

            return ['ok' => false];
        }
    }

    private static function http(array &$alertas): array
    {
        try {
            $snap = Metricas::snapshot();
            $total = 0;
            $errores5xx = 0;
            foreach ($snap['total'] ?? [] as $s) {
                $v = (int) ($s['valor'] ?? 0);
                $total += $v;
                $estado = (int) ($s['etiquetas']['estado'] ?? 0);
                if ($estado >= 500) {
                    $errores5xx += $v;
                }
            }

            $tasa5xx = $total > 0 ? round(($errores5xx / $total) * 100, 2) : 0.0;
            $umbral5xxPct = (float) config('observabilidad.http_5xx_max_pct', 5.0);
            $umbral5xxMin = (int) config('observabilidad.http_5xx_min_reqs', 20);

            if ($total >= $umbral5xxMin && $tasa5xx >= $umbral5xxPct) {
                $alertas[] = [
                    'componente' => 'http_5xx',
                    'nivel' => 'critical',
                    'mensaje' => "Tasa de errores HTTP 5xx al {$tasa5xx}% ({$errores5xx}/{$total})",
                ];
            }

            $cajaN = 0;
            $cajaMs = 0.0;
            foreach ($snap['n'] ?? [] as $s) {
                $ruta = (string) ($s['etiquetas']['ruta'] ?? '');
                if ($ruta === 'caja' || str_starts_with($ruta, 'caja/')) {
                    $cajaN += (int) ($s['valor'] ?? 0);
                }
            }
            foreach ($snap['ms'] ?? [] as $s) {
                $ruta = (string) ($s['etiquetas']['ruta'] ?? '');
                if ($ruta === 'caja' || str_starts_with($ruta, 'caja/')) {
                    $cajaMs += (float) ($s['valor'] ?? 0);
                }
            }

            $cajaMediaMs = $cajaN > 0 ? round($cajaMs / $cajaN, 1) : 0.0;
            $umbralCajaMs = (float) config('observabilidad.caja_max_ms', 1500.0);
            if ($cajaN >= 5 && $cajaMediaMs >= $umbralCajaMs) {
                $alertas[] = [
                    'componente' => 'http_caja_latencia',
                    'nivel' => 'warning',
                    'mensaje' => "Latencia media en /caja alta: {$cajaMediaMs} ms (umbral {$umbralCajaMs} ms)",
                ];
            }

            return [
                'ok' => ! ($total >= $umbral5xxMin && $tasa5xx >= $umbral5xxPct) && ! ($cajaN >= 5 && $cajaMediaMs >= $umbralCajaMs),
                'total_peticiones' => $total,
                'errores_5xx' => $errores5xx,
                'tasa_5xx_pct' => $tasa5xx,
                'caja_media_ms' => $cajaMediaMs,
            ];
        } catch (Throwable) {
            return ['ok' => true, 'total_peticiones' => 0, 'errores_5xx' => 0, 'tasa_5xx_pct' => 0.0, 'caja_media_ms' => 0.0];
        }
    }

    private static function negocio(array &$alertas): array
    {
        try {
            $horaInicio = (int) config('observabilidad.negocio_hora_inicio', 8);
            $horaFin = (int) config('observabilidad.negocio_hora_fin', 18);
            $horaActual = (int) now('America/Caracas')->format('G');
            $enHorario = $horaActual >= $horaInicio && $horaActual < $horaFin;

            $cajasAbiertas = (int) DB::table('aperturas_caja')->where('estado', 'ABIERTA')->count();
            $ventasUltimaHora = (int) DB::table('ventas')
                ->where('estado', 'COMPLETADA')
                ->where('fecha_hora', '>=', now()->subHour())
                ->count();

            $vigilar = (bool) config('observabilidad.negocio_sin_ventas_alerta', true);
            if ($vigilar && $enHorario && $cajasAbiertas > 0 && $ventasUltimaHora === 0) {
                $alertas[] = [
                    'componente' => 'negocio',
                    'nivel' => 'warning',
                    'mensaje' => "0 ventas completadas en la última hora con {$cajasAbiertas} caja(s) abierta(s)",
                ];
            }

            return [
                'ok' => ! ($vigilar && $enHorario && $cajasAbiertas > 0 && $ventasUltimaHora === 0),
                'en_horario' => $enHorario,
                'cajas_abiertas' => $cajasAbiertas,
                'ventas_ultima_hora' => $ventasUltimaHora,
            ];
        } catch (Throwable $e) {
            return ['ok' => false, 'detalle' => substr($e->getMessage(), 0, 120)];
        }
    }
}
