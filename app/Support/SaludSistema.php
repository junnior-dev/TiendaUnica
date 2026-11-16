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

        return [
            'estado' => $alertas === [] ? 'ok' : 'alerta',
            'alertas' => $alertas,
            'disco' => $disco,
            'cola' => $cola,
            'postgres' => $postgres,
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
        $umbral = (float) env('OBS_DISCO_MAX_PCT', 85);

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
            $umbralEdad = (int) env('OBS_QUEUE_MAX_AGE_S', 300);

            $fallidos24h = 0;
            if (DB::getSchemaBuilder()->hasTable('failed_jobs')) {
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

            if ($fallidos24h > 0) {
                $alertas[] = [
                    'componente' => 'queue',
                    'nivel' => 'warning',
                    'mensaje' => "{$fallidos24h} job(s) fallidos en las últimas 24h",
                ];
            }

            return [
                'ok' => ! ($pendientes > 0 && $antiguedad >= $umbralEdad),
                'driver' => $driver,
                'pendientes' => $pendientes,
                'antiguedad_maxima_s' => $antiguedad,
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
            $umbralConn = (float) env('OBS_PG_CONN_MAX_PCT', 80);

            if ($connPct >= $umbralConn) {
                $alertas[] = [
                    'componente' => 'pg_conexiones',
                    'nivel' => $connPct >= 95 ? 'critical' : 'warning',
                    'mensaje' => "Conexiones PG al {$connPct}% ({$activas}/{$maxConn})",
                ];
            }

            $umbralLockS = (float) env('OBS_PG_LOCK_WAIT_S', 1.0);
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
}
