<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Consulta ExchangeRate-API (https://www.exchangerate-api.com/docs/standard-requests).
 * La clave vive solo en el servidor (.env → config/services.php); nunca se envía al navegador.
 * La API devuelve unidades de cada moneda por 1 USD; aquí se convierte a "Bs por 1 unidad", como se guarda en tasas_cambio.
 */
class ExchangeRateService
{
    private const ERRORES = [
        'invalid-key' => 'La clave de ExchangeRate-API no es válida. Revisa EXCHANGERATE_API_KEY en el archivo .env.',
        'inactive-account' => 'Tu cuenta de ExchangeRate-API no está activa. Confirma tu correo en su sitio.',
        'quota-reached' => 'Se agotó el límite de consultas de tu plan de ExchangeRate-API. Prueba más tarde o ingresa la tasa a mano.',
        'unsupported-code' => 'ExchangeRate-API no reconoce una de las monedas.',
        'malformed-request' => 'La consulta a ExchangeRate-API estaba mal formada.',
    ];

    public function configurado(): bool
    {
        return filled(config('services.exchangerate.key'));
    }

    /** Tabla completa de la API: unidades de cada moneda por 1 USD. @return array{rates:array<string,float>,fecha:string,actualizada:string} */
    public function tasasUsd(bool $forzar = false): array
    {
        if ($forzar) Cache::forget('exchangerate.latest.usd');
        // 30 min de caché: el plan gratuito actualiza una vez al día, no tiene sentido consultar más seguido.
        $d = Cache::remember('exchangerate.latest.usd', now()->addMinutes(30), fn () => $this->consultar());
        $t = strtotime($d['time_last_update_utc'] ?? 'now');
        return ['rates' => array_map('floatval', $d['conversion_rates'] ?? []), 'fecha' => date('Y-m-d', $t),
            'actualizada' => (new \DateTime('@' . $t))->setTimezone(new \DateTimeZone('America/Caracas'))->format('d/m/Y H:i')];
    }

    /** 1 unidad de $de equivale a cuántas de $a (cruce por USD). @return array{valor:float,fecha:string,actualizada:string} */
    public function par(string $de, string $a, bool $forzar = false): array
    {
        $d = $this->tasasUsd($forzar);
        foreach ([$de, $a] as $c) {
            if (empty($d['rates'][$c]) || $d['rates'][$c] <= 0) throw new RuntimeException("ExchangeRate-API no tiene la moneda {$c}.");
        }
        return ['valor' => $d['rates'][$a] / $d['rates'][$de], 'fecha' => $d['fecha'], 'actualizada' => $d['actualizada']];
    }

    protected function consultar(): array
    {
        if (! $this->configurado()) throw new RuntimeException('Falta EXCHANGERATE_API_KEY en el archivo .env.');
        $res = Http::timeout(10)->retry(2, 300, throw: false)
            ->get('https://v6.exchangerate-api.com/v6/' . config('services.exchangerate.key') . '/latest/USD');
        $json = $res->json();
        if (! is_array($json)) throw new RuntimeException('ExchangeRate-API no respondió. Revisa tu conexión a internet.');
        if (($json['result'] ?? '') !== 'success') {
            throw new RuntimeException(self::ERRORES[$json['error-type'] ?? ''] ?? 'ExchangeRate-API devolvió un error inesperado.');
        }
        return $json;
    }
}
