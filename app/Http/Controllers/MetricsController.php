<?php

namespace App\Http\Controllers;

use App\Support\Metricas;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Observabilidad N1 · /metrics en formato de texto de Prometheus.
 *
 *   Protegido por token Bearer (METRICS_TOKEN). FALLA CERRADO: sin token
 *   configurado responde 403 SIEMPRE — un .env incompleto nunca expone métricas.
 *   Eximido del resolver de tenant (Prometheus no sabe de subdominios).
 *
 * Series que emite:
 *   http_requests_total{negocio_id,ruta,estado}      · contador
 *   http_request_duration_ms_sum{negocio_id,ruta}    · acumulado
 *   http_request_duration_ms_count{negocio_id,ruta}  · nº mediciones
 *     (Prometheus calcula el promedio; el histograma de buckets es la mejora N2)
 *   pg_stat_activity_count{estado}                   · conexiones por estado
 *   postgres_max_connections                         · techo configurado
 */
class MetricsController extends Controller
{
    public function __invoke(Request $request): Response
    {
        $token = (string) config('observabilidad.token', '');
        $recibido = (string) $request->bearerToken();
        if ($token === '' || $recibido === '' || ! hash_equals($token, $recibido)) {
            abort(403, 'Métricas cerradas: define METRICS_TOKEN y pídelas con Bearer.');
        }

        $lineas = ['# ERP POS · N1', ''];

        foreach (Metricas::snapshot() as $serie => $mediciones) {
            $nombre = match ($serie) {
                'total' => 'http_requests_total',
                'ms' => 'http_request_duration_ms_sum',
                'n' => 'http_request_duration_ms_count',
                default => null,   // serie desconocida del snapshot: se omite
            };
            if ($nombre === null || $mediciones === []) {
                continue;
            }
            $lineas[] = '# HELP '.$nombre.' peticiones HTTP acumuladas del proceso PHP';
            $lineas[] = '# TYPE '.$nombre.' counter';
            foreach ($mediciones as $m) {
                $lineas[] = $nombre.'{'.$this->etiquetas($m['etiquetas']).'} '.$m['valor'];
            }
            $lineas[] = '';
        }

        foreach ($this->postgres() as $nombre => $lineas_pg) {
            $lineas = [...$lineas, ...$lineas_pg];
        }

        return response(implode("\n", $lineas)."\n", 200)
            ->header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    }

    /**
     * Escape del formato de exposición de Prometheus: contrabarra, comillas
     * dobles y saltos de línea se representan con contrabarra.
     *
     * @param array<string, string> $etiquetas
     */
    protected function etiquetas(array $etiquetas): string
    {
        $pares = [];
        foreach ($etiquetas as $clave => $valor) {
            $pares[] = $clave.'="'.str_replace(['\\', '"', "\n"], ['\\\\', '\\"', '\\n'], (string) $valor).'"';
        }

        return implode(',', $pares);
    }

    /**
     * pg_stat_activity por estado y max_connections. La vista completa exige
     * privilegios de lectura de estadísticas: se usa pgsql_admin si existe
     * (rol de administración del despliegue) y si no la conexión de la app
     * (verá al menos SUS conexiones: suficiente para la alerta básica).
     *
     * @return array<string, list<string>>
     */
    protected function postgres(): array
    {
        try {
            // pgsql_admin SOLO si tiene usuario definido. Trampa clásica de env():
            // .env.example trae DB_ADMIN_USERNAME= (vacío) y env('DB_ADMIN_USERNAME',
            // $fallback) devuelve '' porque la clave EXISTE en .env — el fallback no
            // aplica — así que conectaría con usuario vacío y fallaría. Sin DB_ADMIN_*
            // definido de verdad, se usa la conexión de la app.
            $admin = config('database.connections.pgsql_admin');
            $conexion = (is_array($admin) && filled($admin['username'] ?? null))
                ? DB::connection('pgsql_admin')
                : DB::connection();
            $filas = array_map(
                fn (object $f): array => (array) $f,
                $conexion->select("SELECT coalesce(state, 'otro') AS estado, count(*)::int AS n
                    FROM pg_stat_activity WHERE datname = current_database() GROUP BY state ORDER BY 2 DESC"),
            );
            $maxRow = (array) $conexion->selectOne('SHOW max_connections');
            $max = (int) ($maxRow['max_connections'] ?? 0);
        } catch (Throwable $e) {
            // NUNCA silencioso: el scrape es la única ventana que tiene el
            // operador para ver por qué no hay gauges (credenciales, privilegios
            // de pg_stat_activity, conexión). Línea de comentario válida del
            // formato de exposición — el resto de métricas sigue sirviendo.
            return [
                'diag' => [
                    '# pg_gauges_indisponibles: '.str_replace(["\n", "\r"], ' ', substr($e->getMessage(), 0, 140)),
                ],
            ];
        }

        $usadas = array_sum(array_column($filas, 'n'));
        $salida = [
            'cabecera_pg' => [
                '# HELP pg_stat_activity_count conexiones PostgreSQL por estado',
                '# TYPE pg_stat_activity_count gauge',
            ],
        ];
        foreach ($filas as $f) {
            $salida['cabecera_pg'][] = 'pg_stat_activity_count{estado="'.str_replace('"', '', (string) $f['estado']).'"} '.((int) $f['n']);
        }
        $salida['cabecera_pg'][] = '# HELP postgres_max_connections techo de conexiones de PostgreSQL';
        $salida['cabecera_pg'][] = '# TYPE postgres_max_connections gauge';
        $salida['cabecera_pg'][] = 'postgres_max_connections '.$max;
        $salida['cabecera_pg'][] = '# HELP postgres_connections_usadas conexiones abiertas de esta base';
        $salida['cabecera_pg'][] = '# TYPE postgres_connections_usadas gauge';
        $salida['cabecera_pg'][] = 'postgres_connections_usadas '.$usadas;
        $salida['cabecera_pg'][] = '# HELP postgres_connections_pct porcentaje del techo en uso';
        $salida['cabecera_pg'][] = '# TYPE postgres_connections_pct gauge';
        $salida['cabecera_pg'][] = 'postgres_connections_pct '.($max > 0 ? round($usadas / $max * 100, 2) : 0);

        return $salida;
    }
}
