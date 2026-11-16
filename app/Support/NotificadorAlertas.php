<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Despacha alertas operativas a canales externos reales (Webhook, Telegram,
 * Slack y/o Email) con cooldown por componente para evitar tormentas.
 * Si falla el disco o el logger principal, hace fallback a stderr.
 */
class NotificadorAlertas
{
    /**
     * @param  array<int, array<string, mixed>>  $alertas
     */
    public static function despachar(array $alertas): int
    {
        if ($alertas === []) {
            return 0;
        }

        $cooldown = max(0, (int) config('observabilidad.alerta_cooldown_s', 900));
        $pendientes = [];

        foreach ($alertas as $alerta) {
            $clave = 'obs:alerta:'.($alerta['componente'] ?? 'general').':'.($alerta['nivel'] ?? 'warning');
            if ($cooldown > 0 && Cache::has($clave)) {
                continue;
            }
            $pendientes[] = $alerta;
            if ($cooldown > 0) {
                try {
                    Cache::put($clave, true, $cooldown);
                } catch (Throwable) {
                    // Si el caché está caído, no bloqueamos el envío de la alerta.
                }
            }
        }

        if ($pendientes === []) {
            return 0;
        }

        $app = (string) config('app.name', 'TiendaUnicaPOS');
        $env = (string) app()->environment();
        $lineas = array_map(
            fn (array $a) => '['.strtoupper((string) ($a['nivel'] ?? 'warning')).' · '.($a['componente'] ?? 'sistema').'] '.($a['mensaje'] ?? ''),
            $pendientes
        );
        $texto = "🚨 {$app} ({$env})\n".implode("\n", $lineas);

        self::registrarConFallback($pendientes);
        self::enviarWebhook($texto, $pendientes);
        self::enviarTelegram($texto);
        self::enviarEmail($app, $env, $texto);

        return count($pendientes);
    }

    /**
     * @param  array<int, array<string, mixed>>  $alertas
     */
    private static function registrarConFallback(array $alertas): void
    {
        foreach ($alertas as $alerta) {
            $linea = '['.strtoupper((string) ($alerta['nivel'] ?? 'warning')).' · '.($alerta['componente'] ?? 'sistema').'] '.($alerta['mensaje'] ?? '');
            try {
                if (($alerta['nivel'] ?? '') === 'critical') {
                    Log::critical($linea, $alerta);
                } else {
                    Log::warning($linea, $alerta);
                }
            } catch (Throwable $e) {
                // Fallback si el disco está al 100% o storage/logs no es escribible.
                @fwrite(STDERR, now()->toIso8601String().' '.$linea.' [log_fallback: '.$e->getMessage()."]\n");
            }
        }
    }

    /**
     * @param  array<int, array<string, mixed>>  $alertas
     */
    private static function enviarWebhook(string $texto, array $alertas): void
    {
        $url = (string) config('observabilidad.alerta_webhook_url', '');
        if ($url === '') {
            return;
        }

        try {
            Http::timeout(4)->post($url, [
                'text' => $texto,
                'entorno' => app()->environment(),
                'alertas' => $alertas,
            ]);
        } catch (Throwable $e) {
            @fwrite(STDERR, 'Error enviando alerta webhook: '.$e->getMessage()."\n");
        }
    }

    private static function enviarTelegram(string $texto): void
    {
        $token = (string) config('observabilidad.telegram_bot_token', '');
        $chatId = (string) config('observabilidad.telegram_chat_id', '');
        if ($token === '' || $chatId === '') {
            return;
        }

        try {
            Http::timeout(4)->post("https://api.telegram.org/bot{$token}/sendMessage", [
                'chat_id' => $chatId,
                'text' => $texto,
            ]);
        } catch (Throwable $e) {
            @fwrite(STDERR, 'Error enviando alerta Telegram: '.$e->getMessage()."\n");
        }
    }

    private static function enviarEmail(string $app, string $env, string $texto): void
    {
        $destino = (string) config('observabilidad.alerta_email', '');
        if ($destino === '') {
            return;
        }

        try {
            Mail::raw($texto, function ($msg) use ($destino, $app, $env) {
                $msg->to($destino)->subject("[ALERTA {$env}] {$app}");
            });
        } catch (Throwable $e) {
            @fwrite(STDERR, 'Error enviando alerta Email: '.$e->getMessage()."\n");
        }
    }
}
