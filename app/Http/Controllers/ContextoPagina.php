<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\DB;

/** Datos que comparte todo módulo con el layout: negocio, usuario, fecha, tasa del dólar y contador de stock bajo. */
trait ContextoPagina
{
    protected function contexto(): array
    {
        $meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        $dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        $h = now();
        $neg = DB::table('negocio')->first();
        return [
            'negocio' => $neg->nombre_comercial ?: ($neg->razon_social ?? ''),
            'usuario' => ['nombre' => auth()->user()->nombre_completo ?? '', 'rol' => ucfirst(strtolower(auth()->user()->rol ?? 'Cajero'))],
            'fecha_larga' => $dias[$h->dayOfWeek] . ' ' . $h->day . ' de ' . $meses[$h->month - 1] . ' de ' . $h->year,
            'stock_bajo' => (int) DB::table('v_stock_bajo')->count(),
            'tasa_usd' => (float) DB::table('v_tasa_actual')->value('tasa'),
        ];
    }
}
