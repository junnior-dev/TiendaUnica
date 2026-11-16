<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;

/**
 * Observabilidad N1 · contadores para /metrics, SIN esquema de base nuevo.
 *
 * Los contadores viven en el caché configurado (file en dev/staging, Redis en
 * producción): cada petición suma 1 a http_requests_total y acumula milisegundos
 * y número de mediciones por (negocio, ruta). El snapshot los serializa al
 * formato de texto de Prometheus.
 *
 *   metricas:http_total:{negocio}|{ruta}|{estado} → contador de peticiones
 *   metricas:http_ms:{negocio}|{ruta}             → suma de milisegundos
 *   metricas:http_n:{negocio}|{ruta}              → nº de mediciones
 *   metricas:llaves                               → registro de series vivas
 *
 * Con el driver FILE no hay enumeración de claves, así que el registro de
 * llaves vive en una lista del propio caché. Dos peticiones simultáneas pueden
 * perder una etiqueta del registro en la carrera (file driver no es atómico);
 * la métrica sigue contando y reaparece con la siguiente petición de esa ruta:
 * aceptable en N1. Con Redis sería SADD (operación atómica).
 */
final class Metricas
{
    public static function registrar(string $ruta, int $estado, float $ms, ?int $negocioId): void
    {
        $negocio = (string) ($negocioId ?? 0);
        $total = "metricas:http_total:{$negocio}|{$ruta}|{$estado}";
        $msKey = "metricas:http_ms:{$negocio}|{$ruta}";
        $nKey = "metricas:http_n:{$negocio}|{$ruta}";

        try {
            Cache::add($total, 0);
            Cache::increment($total);
            Cache::add($msKey, 0.0);
            Cache::increment($msKey, (int) $ms);
            Cache::add($nKey, 0);
            Cache::increment($nKey);
            foreach ([$total, $msKey, $nKey] as $llave) {
                static::registrarLlave($llave);
            }
        } catch (\Throwable) {
            // las métricas jamás rompen la petición que ya terminó
        }
    }

    /**
     * Series vivas para el scrape de /metrics. Cada serie trae sus etiquetas
     * desglosadas (negocio_id, ruta, estado cuando aplica) y su valor numérico.
     *
     * @return array<string, list<array{etiquetas: array<string, string>, valor: float|int}>>
     */
    public static function snapshot(): array
    {
        $salida = ['total' => [], 'ms' => [], 'n' => []];

        try {
            foreach (static::llaves() as $llave) {
                $valor = Cache::get($llave);
                if ($valor === null) {
                    continue;   // la serie expiró del caché: ya no existe
                }
                $cuerpo = explode(':', $llave, 2)[1] ?? '';
                $partes = explode('|', explode(':', $cuerpo, 2)[1] ?? '');
                if (str_starts_with($cuerpo, 'http_total')) {
                    // http_total:{negocio}|{ruta}|{estado}
                    if (count($partes) !== 3) {
                        continue;
                    }
                    [$negocio, $ruta, $estado] = $partes;
                    $salida['total'][] = [
                        'etiquetas' => ['negocio_id' => $negocio, 'ruta' => $ruta, 'estado' => $estado],
                        'valor' => $valor,
                    ];
                } elseif (str_starts_with($cuerpo, 'http_ms')) {
                    // http_ms:{negocio}|{ruta}
                    if (count($partes) !== 2) {
                        continue;
                    }
                    [$negocio, $ruta] = $partes;
                    $salida['ms'][] = [
                        'etiquetas' => ['negocio_id' => $negocio, 'ruta' => $ruta],
                        'valor' => (float) $valor,
                    ];
                } elseif (str_starts_with($cuerpo, 'http_n')) {
                    if (count($partes) !== 2) {
                        continue;
                    }
                    [$negocio, $ruta] = $partes;
                    $salida['n'][] = [
                        'etiquetas' => ['negocio_id' => $negocio, 'ruta' => $ruta],
                        'valor' => $valor,
                    ];
                }
            }
        } catch (\Throwable) {
            // snapshot vacío antes que romper el scrape
        }

        return $salida;
    }

    /** @return list<string> */
    protected static function llaves(): array
    {
        $lista = Cache::get('metricas:llaves');

        return is_array($lista) ? array_values($lista) : [];
    }

    protected static function registrarLlave(string $llave): void
    {
        $lista = Cache::get('metricas:llaves');
        if (! is_array($lista) || ! in_array($llave, $lista, true)) {
            $lista = is_array($lista) ? $lista : [];
            $lista[] = $llave;
            Cache::put('metricas:llaves', $lista);
        }
    }
}
