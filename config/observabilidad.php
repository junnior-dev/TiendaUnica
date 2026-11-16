<?php

// Observabilidad N1 + alertas operativas + CSP.
return [

    // Token Bearer de /metrics. Vacío = endpoint CERRADO (403 siempre):
    // falla cerrado para que nunca quede expuesto por un .env incompleto.
    'token' => env('METRICS_TOKEN', ''),

    // Canal de la línea de acceso por petición (LogContexto::terminate).
    'canal_acceso' => env('LOG_ACCESO', 'acceso'),

    // CSP: fecha de activación automática en staging (en production siempre enforce).
    'csp_force' => filter_var((string) env('CSP_FORCE', false), FILTER_VALIDATE_BOOLEAN),
    'csp_enforce_from' => (string) env('CSP_ENFORCE_FROM', '2026-12-01'),

    // Umbrales de salud operativa (SaludSistema)
    'disco_max_pct' => (float) env('OBS_DISCO_MAX_PCT', 85),
    'queue_max_age_s' => (int) env('OBS_QUEUE_MAX_AGE_S', 300),
    'failed_jobs_max' => (int) env('OBS_FAILED_JOBS_MAX', 10),
    'pg_conn_max_pct' => (float) env('OBS_PG_CONN_MAX_PCT', 80),
    'pg_lock_wait_s' => (float) env('OBS_PG_LOCK_WAIT_S', 1.0),
    'http_5xx_max_pct' => (float) env('OBS_HTTP_5XX_MAX_PCT', 5.0),
    'http_5xx_min_reqs' => (int) env('OBS_HTTP_5XX_MIN_REQS', 20),
    'caja_max_ms' => (float) env('OBS_CAJA_MAX_MS', 1500.0),
    'negocio_hora_inicio' => (int) env('OBS_NEGOCIO_HORA_INICIO', 8),
    'negocio_hora_fin' => (int) env('OBS_NEGOCIO_HORA_FIN', 18),
    'negocio_sin_ventas_alerta' => filter_var((string) env('OBS_NEGOCIO_SIN_VENTAS_ALERTA', true), FILTER_VALIDATE_BOOLEAN),

    // Canales de notificación de alertas (NotificadorAlertas)
    'alerta_cooldown_s' => (int) env('OBS_ALERTA_COOLDOWN_S', 900),
    'alerta_webhook_url' => (string) env('OBS_ALERTA_WEBHOOK_URL', env('LOG_SLACK_WEBHOOK_URL', '')),
    'telegram_bot_token' => (string) env('OBS_TELEGRAM_BOT_TOKEN', ''),
    'telegram_chat_id' => (string) env('OBS_TELEGRAM_CHAT_ID', ''),
    'alerta_email' => (string) env('OBS_ALERTA_EMAIL', ''),
];
