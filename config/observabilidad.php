<?php

// Observabilidad N1: knobs del LogContexto y del endpoint /metrics.
return [

    // Token Bearer de /metrics. Vacío = endpoint CERRADO (403 siempre):
    // falla cerrado para que nunca quede expuesto por un .env incompleto.
    // En staging/producción: METRICS_TOKEN con un valor aleatorio largo.
    'token' => env('METRICS_TOKEN', ''),

    // Canal de la línea de acceso por petición (LogContexto::terminate).
    // Vacío desactiva la línea (útil en pruebas de carga si molesta al disco).
    'canal_acceso' => env('LOG_ACCESO', 'acceso'),
];
