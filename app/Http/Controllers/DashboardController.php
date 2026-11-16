<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/** Panel principal. Todo sale de las vistas del esquema tienda (v_tasas_actuales, v_cierre_caja, v_ventas_diarias…). */
class DashboardController extends Controller
{
    public function __invoke()
    {
        $hoy = DB::scalar('SELECT fn_hoy()');
        $r2 = fn ($v) => round((float) $v, 2);

        // Tasas: última de cada par (USD, EUR, COP → VES) + los últimos 7 días del dólar para la línea.
        $usdVes = (float) (DB::table('v_tasas_actuales')->where(['moneda_origen' => 'USD', 'moneda_destino' => 'VES'])->value('tasa') ?? 0);
        $tasas = DB::table('v_tasas_actuales')->where('moneda_destino', 'VES')->get()->map(function ($t) {
            $serie = $t->moneda_origen === 'USD'
                ? DB::table('tasas_cambio')->where(['moneda_origen' => 'USD', 'moneda_destino' => 'VES'])->orderByDesc('fecha_valor')->limit(7)->pluck('tasa')->reverse()->map(fn ($x) => (float) $x)->values()
                : [];
            $prev = DB::table('tasas_cambio')->where(['moneda_origen' => $t->moneda_origen, 'moneda_destino' => 'VES'])
                ->where('fecha_valor', '<', $t->fecha_valor)->orderByDesc('fecha_valor')->value('tasa');
            return ['par' => $t->moneda_origen, 'tasa' => (float) $t->tasa, 'fecha' => $t->fecha_valor, 'oficial' => (bool) $t->es_oficial_bcv,
                'fuente' => $t->fuente ?? ($t->es_oficial_bcv ? 'BCV' : 'MANUAL'),
                'vigente' => (bool) $t->vigente, 'variacion_pct' => $prev ? round(($t->tasa / $prev - 1) * 100, 3) : null, 'serie' => $serie,
                'serie_desde' => $serie && count($serie) > 1 ? 'hace ' . count($serie) . ' registros' : '', 'serie_hasta' => $serie && count($serie) > 1 ? 'hoy' : ''];
        })->values()->map(function ($t) use ($usdVes) {
            // COP se guarda como "1 COP = Bs x"; en pantalla se muestra "pesos por dólar".
            if ($t['par'] === 'COP' && $t['tasa'] > 0) $t['por_dolar'] = round($usdVes / $t['tasa'], 2);
            return $t;
        });

        // Cobrado hoy por moneda de pago: monto en su moneda y su equivalente en USD y Bs (a la tasa congelada de cada pago).
        $porMoneda = DB::table('v_cierre_caja')->where('fecha', $hoy)
            ->selectRaw("moneda, array_agg(DISTINCT metodo_pago) AS metodos, sum(monto_aplicado) AS monto, sum(equivalente_usd) AS eq_usd, sum(equivalente_ves) AS eq_ves")
            ->groupBy('moneda')->get()->map(fn ($f) => [
                'moneda' => $f->moneda, 'metodos' => array_map(fn ($m) => trim($m, '"'), explode(',', trim($f->metodos, '{}'))),
                'monto' => (float) $f->monto, 'equivalente_usd' => $r2($f->eq_usd), 'equivalente_ves' => $r2($f->eq_ves),
                'tasa' => $f->moneda === 'VES' ? 1 : (float) (collect($tasas)->firstWhere('par', $f->moneda)['tasa'] ?? 0),
            ])->sortBy(fn ($f) => array_search($f['moneda'], ['USD', 'EUR', 'COP', 'VES']))->values();

        $dia = DB::table('v_ventas_diarias')->where('fecha', $hoy)->first();
        $ayer = DB::table('v_ventas_diarias')->where('fecha', '<', $hoy)->orderByDesc('fecha')->first();
        $util = DB::table('v_utilidad_diaria')->where('fecha', $hoy)->first();

        // Últimos 7 días, en USD y por moneda (v_cierre_caja.equivalente_usd).
        $semana = DB::table('v_cierre_caja')->where('fecha', '>=', DB::raw("'$hoy'::date - 6"))
            ->selectRaw('fecha, moneda, sum(equivalente_usd) AS usd')->groupBy('fecha', 'moneda')->get()->groupBy('fecha')
            ->map(fn ($g, $f) => ['fecha' => $f, 'etiqueta' => \Carbon\Carbon::parse($f)->locale('es')->isoFormat('ddd D'), 'largo' => ucfirst(\Carbon\Carbon::parse($f)->locale('es')->isoFormat('dddd D [de] MMMM'))]
                + collect(['USD', 'EUR', 'COP', 'VES'])->mapWithKeys(fn ($m) => [$m => $r2($g->firstWhere('moneda', $m)->usd ?? 0)])->all())->values();

        $ultimas = DB::table('v_ventas_resumen')->where('fecha_valor', $hoy)->orderByDesc('id')->limit(8)->get()->map(fn ($v) => [
            'numero' => str_pad($v->numero, 6, '0', STR_PAD_LEFT), 'hora' => substr($v->fecha_hora, 11, 5), 'cliente' => $v->cliente, 'estado' => $v->estado,
            'total_usd' => (float) $v->total_usd, 'total_ves' => (float) $v->total_ves,
            'pagos' => DB::table('pagos_venta')->where('venta_id', $v->id)->get(['moneda', 'monto'])->map(fn ($p) => ['moneda' => $p->moneda, 'monto' => (float) $p->monto])->all(),
        ]);

        return Inertia::render('Dashboard', [
            'negocio' => DB::table('negocio')->value(DB::raw('COALESCE(nombre_comercial, razon_social)')),
            'usuario' => ['nombre' => auth()->user()->nombre_completo, 'rol' => ucfirst(strtolower(auth()->user()->rol))],
            'fecha_larga' => ucfirst(\Carbon\Carbon::parse($hoy)->locale('es')->isoFormat('dddd D [de] MMMM [de] YYYY')),
            'tasas' => $tasas,
            'vencimientos' => \App\Support\Tenant::fiscal() ? CalendarioFiscalController::proximos(5) : [],
            'kpis' => [
                'ventas_usd' => $r2($dia->total_usd ?? 0), 'ventas_ves' => $r2($dia->total_ves ?? 0), 'cantidad' => (int) ($dia->cantidad_ventas ?? 0),
                'ayer_usd' => $r2($ayer->total_usd ?? 0), 'utilidad_usd' => $r2($util->utilidad_usd ?? 0), 'margen_pct' => (float) ($util->margen_sobre_venta_pct ?? 0),
                'igtf_usd' => $r2($dia->igtf_usd ?? 0),
            ],
            'por_moneda' => $porMoneda, 'semana' => $semana, 'ultimas' => $ultimas,
            'alertas' => [
                'total_stock_bajo' => DB::table('v_stock_bajo')->count(),
                'stock_bajo' => DB::table('v_stock_bajo')->limit(4)->get(['sku', 'nombre', 'stock_actual as stock', 'stock_minimo as minimo']),
                'precios_pendientes' => DB::table('v_alertas_precio_pendientes')->count(),
            ],
            'mas_vendidos' => DB::table('detalle_venta as d')->join('ventas as v', 'v.id', '=', 'd.venta_id')->join('productos as p', 'p.id', '=', 'd.producto_id')
                ->where('v.fecha_valor', $hoy)->where('v.estado', 'COMPLETADA')->selectRaw('p.nombre, sum(d.cantidad)::int AS unidades')
                ->groupBy('p.nombre')->orderByDesc('unidades')->limit(4)->get(),
        ]);
    }
}
