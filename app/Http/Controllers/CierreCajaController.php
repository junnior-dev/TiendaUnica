<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;

/**
 * Cierre de caja multimoneda.
 *
 * Las cifras salen SIEMPRE de pagos_venta / ventas (inmutables): lo cobrado en la moneda original, con la tasa congelada
 * de cada pago, más IGTF y vuelto. «Efectivo» = método de pago que no pide referencia (Efectivo USD/EUR/COP/Bs).
 * Registrar el cierre (contar, firmar, dejarlo fijo) necesita la tabla opcional cierres_caja (database/sql/07_cierres_caja.sql);
 * sin ella el módulo funciona en modo consulta con su PDF.
 */
class CierreCajaController extends Controller
{
    use ContextoPagina;

    private function esAdmin(): bool
    {
        return strtoupper((string) auth()->user()->rol) === 'ADMINISTRADOR';
    }

    private function hayTablaCierres(): bool
    {
        return Schema::hasTable('cierres_caja');
    }

    public function index(Request $r)
    {
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $periodo = in_array($r->query('periodo'), ['dia', 'mes', 'anio', 'rango'], true) ? $r->query('periodo') : 'dia';
        [$desde, $hasta] = $this->rango($r, $periodo, $hoy);
        $uid = $this->esAdmin() ? (int) $r->query('cajero', 0) : (int) auth()->id();

        $informe = $this->informe($desde, $hasta, $uid);
        $cierre = null;
        $cortes = [];
        if ($this->hayTablaCierres()) {
            $base = DB::table('cierres_caja as c')->join('usuarios as u', 'u.id', '=', 'c.cerrado_por')->leftJoin('usuarios as k', 'k.id', '=', 'c.usuario_id')
                ->whereBetween('c.fecha', [$desde, $hasta])->when($uid, fn ($q) => $q->where('c.usuario_id', $uid));
            if ($desde === $hasta) {
                $c = (clone $base)->whereRaw('COALESCE(c.usuario_id, 0) = ?', [$uid])
                    ->first(['c.id', 'c.cerrado_en', 'c.conteo', 'c.diferencia', 'c.observaciones', 'u.nombre_completo as por']);
                if ($c) {
                    $cierre = ['id' => $c->id, 'cerrado_en' => $c->cerrado_en, 'por' => $c->por, 'observaciones' => $c->observaciones,
                        'conteo' => json_decode($c->conteo, true) ?: new \stdClass, 'diferencia' => json_decode($c->diferencia, true) ?: new \stdClass];
                }
            } else {
                $cortes = (clone $base)->orderBy('c.fecha')->orderBy('c.id')
                    ->get(['c.id', 'c.fecha', 'c.total_usd', 'c.diferencia', 'u.nombre_completo as por', 'k.nombre_completo as caja'])
                    ->map(fn ($c) => ['id' => $c->id, 'fecha' => $c->fecha, 'total_usd' => (float) $c->total_usd, 'por' => $c->por, 'caja' => $c->caja ?? 'Todas las cajas',
                        'con_diferencia' => collect(json_decode($c->diferencia, true) ?: [])->contains(fn ($d) => abs((float) $d) > 0.004)])->all();
            }
        }

        $neg = DB::table('negocio')->first(['razon_social', 'nombre_comercial', 'rif', 'direccion_fiscal']);

        return Inertia::render('CierreCaja/Index', $this->contexto() + [
            'hoy' => $hoy,
            'periodo' => $periodo, 'desde' => $desde, 'hasta' => $hasta, 'cortes' => $cortes,
            'cajero' => $uid,
            'es_admin' => $this->esAdmin(),
            'puede_registrar' => $this->hayTablaCierres(),
            'informe' => $informe,
            'cierre' => $cierre,
            'cajeros' => $this->esAdmin()
                ? DB::table('usuarios')->where('activo', true)->orderBy('nombre_completo')->get(['id', 'nombre_completo as nombre'])
                : [],
            'dias' => $periodo === 'dia' ? $this->ultimosDias($uid) : [],
            'emisor' => ['razon_social' => $neg->razon_social, 'comercial' => $neg->nombre_comercial, 'rif' => $neg->rif, 'direccion' => $neg->direccion_fiscal],
            'generado_por' => auth()->user()->nombre_completo,
            // Turno de caja abierto de quien mira la pantalla: permite hacer el Corte Z (cierre del turno) desde aquí.
            'turno' => ($ap = app(AperturaCajaController::class)->activa()) ? app(AperturaCajaController::class)->resumen($ap['id']) : null,
        ]);
    }

    /**
     * Cierre del TURNO (Corte Z). Dentro de una sola transacción: 1) cierra el turno (congela la ventana de ventas),
     * 2) toma las cifras de fn_resumen_apertura (no confía en cifras del navegador), 3) compara el efectivo contado con el esperado
     * (fondo inicial + efectivo de ventas − vueltos + ingresos − egresos) y 4) guarda el cierre ligado a su apertura. Si algo falla, el turno sigue abierto.
     */
    private function cerrarTurno(Request $r)
    {
        $d = $r->validate([
            'apertura_id' => 'required|integer', 'conteo' => 'required|array', 'conteo.*' => 'nullable|numeric|min:0|max:999999999999', 'observaciones' => 'nullable|string|max:500',
        ]);
        $ap = DB::selectOne('SELECT id, usuario_id, estado FROM aperturas_caja WHERE id = ?', [$d['apertura_id']]);
        if (! $ap) {
            throw ValidationException::withMessages(['apertura_id' => 'Ese turno de caja no existe.']);
        }
        if (! $this->esAdmin() && (int) $ap->usuario_id !== (int) auth()->id()) {
            abort(403, 'Solo puedes cerrar tu propia caja.');
        }
        if ($ap->estado !== 'ABIERTA') {
            throw ValidationException::withMessages(['apertura_id' => 'Este turno ya está cerrado.']);
        }
        $aperturas = app(AperturaCajaController::class);

        $res = DB::transaction(function () use ($d, $ap, $aperturas) {
            $aperturas->cerrar((int) $ap->id);
            $inf = $aperturas->resumen((int) $ap->id);
            $conteo = $esperado = $dif = [];
            foreach ($inf['monedas'] as $m) {
                if (! in_array($m['moneda'], ['USD', 'VES'], true) && abs($m['esperado']) < 0.005 && $m['efectivo_recibido'] < 0.005) {
                    continue;
                }
                $esperado[$m['moneda']] = (float) $m['esperado'];
                $v = $d['conteo'][$m['moneda']] ?? null;
                if ($v === null || $v === '') {
                    throw ValidationException::withMessages(['conteo' => 'Cuenta el efectivo de todas las monedas antes de cerrar (puede ser 0).']);
                }
                $conteo[$m['moneda']] = round((float) $v, 2);
                $dif[$m['moneda']] = round($conteo[$m['moneda']] - (float) $m['esperado'], 2);
            }
            $id = DB::table('cierres_caja')->insertGetId([
                'fecha' => DB::scalar('SELECT fn_hoy()'), 'usuario_id' => $ap->usuario_id, 'cerrado_por' => auth()->id(), 'apertura_id' => $ap->id,
                'ventas' => $inf['ventas'], 'total_usd' => $inf['total_usd'], 'total_ves' => $inf['total_ves'],
                'conteo' => json_encode($conteo), 'esperado' => json_encode($esperado), 'diferencia' => json_encode($dif),
                'observaciones' => $d['observaciones'] ?? null, 'detalle' => json_encode($inf),
            ]);
            return ['id' => $id, 'resumen' => $inf, 'conteo' => $conteo, 'esperado' => $esperado, 'diferencia' => $dif];
        });
        $res['numero'] = (int) $res['id'];
        $res['cerrado_por'] = auth()->user()->nombre_completo;
        $res['cerrado_en'] = now()->toIso8601String();

        return $r->wantsJson() ? response()->json($res) : back()->with('ok', 'Turno cerrado.');
    }

    /** Firma el cierre: recalcula en el servidor (no confía en cifras del navegador) y guarda una copia fija. */
    public function store(Request $r)
    {
        abort_unless($this->hayTablaCierres(), 404);
        if ($r->filled('apertura_id')) {
            return $this->cerrarTurno($r);
        }
        $d = $r->validate([
            'fecha' => 'required|date_format:Y-m-d',
            'cajero' => 'nullable|integer|min:0',
            'conteo' => 'required|array',
            'conteo.*' => 'nullable|numeric|min:0|max:999999999999',
            'observaciones' => 'nullable|string|max:500',
        ]);
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        if ($d['fecha'] > $hoy) {
            throw ValidationException::withMessages(['fecha' => 'No se puede cerrar una fecha futura.']);
        }
        $uid = $this->esAdmin() ? (int) ($d['cajero'] ?? 0) : (int) auth()->id();
        $inf = $this->informe($d['fecha'], $d['fecha'], $uid);
        if ($inf['resumen']['ventas'] === 0) {
            throw ValidationException::withMessages(['fecha' => 'No hay ventas para cerrar en esta fecha.']);
        }

        $conteo = $esperado = $dif = [];
        foreach ($inf['monedas'] as $m) {
            if (! $m['efectivo_esperado'] && ! $m['tiene_efectivo']) {
                continue;
            }
            $esperado[$m['moneda']] = $m['efectivo_esperado'];
            if (isset($d['conteo'][$m['moneda']]) && $d['conteo'][$m['moneda']] !== '') {
                $conteo[$m['moneda']] = round((float) $d['conteo'][$m['moneda']], 2);
                $dif[$m['moneda']] = round($conteo[$m['moneda']] - $m['efectivo_esperado'], 2);
            }
        }
        if ($esperado && count($conteo) < count($esperado)) {
            throw ValidationException::withMessages(['conteo' => 'Cuenta el efectivo de todas las monedas antes de cerrar (puede ser 0).']);
        }

        try {
            DB::table('cierres_caja')->insert([
                'fecha' => $d['fecha'], 'usuario_id' => $uid ?: null, 'cerrado_por' => auth()->id(),
                'ventas' => $inf['resumen']['ventas'], 'total_usd' => $inf['resumen']['total_usd'], 'total_ves' => $inf['resumen']['total_ves'],
                'conteo' => json_encode($conteo), 'esperado' => json_encode($esperado), 'diferencia' => json_encode($dif),
                'observaciones' => $d['observaciones'] ?? null, 'detalle' => json_encode($inf),
            ]);
        } catch (QueryException $e) {
            if ($e->getCode() === '23505') {
                throw ValidationException::withMessages(['fecha' => 'Esta caja ya tiene un cierre registrado para ese día.']);
            }
            throw $e;
        }

        return back()->with('ok', 'Cierre registrado.');
    }

    /** Convierte la selección (día, mes, año o rango) en desde/hasta. Nunca pasa de hoy ni de 366 días. */
    private function rango(Request $r, string $periodo, string $hoy): array
    {
        $f = fn ($v) => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $v) && strtotime($v) !== false ? $v : null;
        if ($periodo === 'mes' && preg_match('/^(\d{4})-(\d{2})$/', (string) $r->query('mes'), $m) && (int) $m[2] >= 1 && (int) $m[2] <= 12) {
            $desde = "{$m[1]}-{$m[2]}-01";
            $hasta = date('Y-m-t', strtotime($desde));
        } elseif ($periodo === 'anio' && preg_match('/^\d{4}$/', (string) $r->query('anio'))) {
            $desde = $r->query('anio') . '-01-01';
            $hasta = $r->query('anio') . '-12-31';
        } elseif ($periodo === 'rango') {
            $desde = $f($r->query('desde')) ?? $hoy;
            $hasta = $f($r->query('hasta')) ?? $hoy;
        } else {
            $desde = $hasta = $f($r->query('fecha')) ?? $hoy;
        }
        $hasta = min($hasta, $hoy);
        $desde = min($desde, $hasta);
        if ((strtotime($hasta) - strtotime($desde)) / 86400 > 365) {
            $desde = date('Y-m-d', strtotime($hasta . ' -365 days'));
        }
        return [$desde, $hasta];
    }

    private function ultimosDias(int $uid)
    {
        return DB::table('ventas')->where('estado', 'COMPLETADA')->when($uid, fn ($q) => $q->where('usuario_id', $uid))
            ->whereRaw("fecha_valor >= fn_hoy() - 13")->groupBy('fecha_valor')->orderByDesc('fecha_valor')
            ->selectRaw('fecha_valor::text AS fecha, count(*) AS ventas, sum(total_cobrar_usd) AS total_usd')->get()
            ->map(fn ($x) => ['fecha' => $x->fecha, 'ventas' => (int) $x->ventas, 'total_usd' => round((float) $x->total_usd, 2)]);
    }

    /** Informe del día (y de una caja, si $uid > 0). Todo en moneda original + equivalentes con la tasa congelada. */
    private function informe(string $desde, string $hasta, int $uid): array
    {
        $b = [$desde, $hasta, $uid, $uid];
        $unDia = $desde === $hasta;

        $metodos = DB::select("
            SELECT mp.nombre AS metodo, pv.moneda, mp.es_efectivo AS efectivo, pv.es_anticipo, count(*) AS n,
                   sum(pv.monto) AS aplicado, sum(pv.igtf_monto) AS igtf, sum(pv.monto_cobrado) AS cobrado,
                   min(pv.tasa_cambio) AS tasa_min, max(pv.tasa_cambio) AS tasa_max,
                   sum(pv.monto_usd + pv.igtf_usd) AS usd, sum(pv.monto_ves + pv.igtf_ves) AS ves,
                   sum(COALESCE(pv.monto_entregado, pv.monto_cobrado)) AS recibido
              FROM pagos_venta pv JOIN ventas v ON v.id = pv.venta_id JOIN metodos_pago mp ON mp.id = pv.metodo_pago_id
             WHERE v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN ? AND ? AND (?::bigint = 0 OR v.usuario_id = ?)
             GROUP BY mp.id, mp.nombre, pv.moneda, mp.es_efectivo, pv.es_anticipo
             ORDER BY array_position(ARRAY['USD','EUR','COP','VES'], pv.moneda::text), mp.nombre", $b);

        $vueltos = [];
        foreach (DB::select("
            SELECT pv.vuelto_moneda AS moneda, sum(pv.vuelto_monto) AS vuelto
              FROM pagos_venta pv JOIN ventas v ON v.id = pv.venta_id
             WHERE v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN ? AND ? AND pv.vuelto_monto > 0 AND (?::bigint = 0 OR v.usuario_id = ?)
             GROUP BY 1", $b) as $x) {
            $vueltos[trim($x->moneda)] = (float) $x->vuelto;
        }

        $res = DB::selectOne("
            SELECT count(*) FILTER (WHERE estado = 'COMPLETADA') AS ventas, count(*) FILTER (WHERE estado = 'ANULADA') AS anuladas,
                   COALESCE(sum(base_usd + exento_usd) FILTER (WHERE estado = 'COMPLETADA'), 0) AS base_usd,
                   COALESCE(sum(iva_usd) FILTER (WHERE estado = 'COMPLETADA'), 0) AS iva_usd,
                   COALESCE(sum(igtf_usd) FILTER (WHERE estado = 'COMPLETADA'), 0) AS igtf_usd,
                   COALESCE(sum(total_cobrar_usd) FILTER (WHERE estado = 'COMPLETADA'), 0) AS total_usd,
                   min(tasa_cambio) AS tasa_min, max(tasa_cambio) AS tasa_max
              FROM ventas WHERE fecha_valor BETWEEN ? AND ? AND (?::bigint = 0 OR usuario_id = ?)", $b);

        $filas = array_map(fn ($m) => [
            'metodo' => $m->metodo, 'moneda' => trim($m->moneda), 'efectivo' => (bool) $m->efectivo, 'n' => (int) $m->n,
            'aplicado' => (float) $m->aplicado, 'igtf' => (float) $m->igtf, 'cobrado' => (float) $m->cobrado,
            'tasa_min' => (float) $m->tasa_min, 'tasa_max' => (float) $m->tasa_max,
            'usd' => (float) $m->usd, 'ves' => (float) $m->ves, 'recibido' => (float) $m->recibido,
            'es_anticipo' => (bool) $m->es_anticipo,
        ], $metodos);

        // Por moneda: cobrado, equivalentes y efectivo esperado en caja (lo recibido en efectivo − vuelto entregado).
        // Los pagos marcados es_anticipo (anticipos de encargos ya cobrados antes) NO vuelven a la gaveta (archivo 24).
        $anticiposAplicados = array_filter($filas, fn ($f) => $f['es_anticipo']);
        $monedas = [];
        foreach ($filas as $f) {
            $m = &$monedas[$f['moneda']];
            $m ??= ['moneda' => $f['moneda'], 'cobrado' => 0.0, 'usd' => 0.0, 'ves' => 0.0, 'efectivo_recibido' => 0.0, 'tiene_efectivo' => false];
            $m['cobrado'] += $f['cobrado'];
            $m['usd'] += $f['usd'];
            $m['ves'] += $f['ves'];
            if ($f['efectivo'] && ! $f['es_anticipo']) {
                $m['efectivo_recibido'] += $f['recibido'];
                $m['tiene_efectivo'] = true;
            }
            unset($m);
        }
        foreach ($vueltos as $mon => $v) {
            $monedas[$mon] ??= ['moneda' => $mon, 'cobrado' => 0.0, 'usd' => 0.0, 'ves' => 0.0, 'efectivo_recibido' => 0.0, 'tiene_efectivo' => true];
            $monedas[$mon]['tiene_efectivo'] = true;
        }
        $orden = ['USD' => 1, 'EUR' => 2, 'COP' => 3, 'VES' => 4];
        $monedas = collect($monedas)->map(function ($m) use ($vueltos) {
            $v = $vueltos[$m['moneda']] ?? 0.0;
            return [
                'moneda' => $m['moneda'], 'cobrado' => round($m['cobrado'], 2), 'usd' => round($m['usd'], 2), 'ves' => round($m['ves'], 2),
                'efectivo_recibido' => round($m['efectivo_recibido'], 2), 'vuelto' => round($v, 2),
                'efectivo_esperado' => round($m['efectivo_recibido'] - $v, 2), 'tiene_efectivo' => $m['tiene_efectivo'],
            ];
        })->sortBy(fn ($m) => $orden[$m['moneda']] ?? 9)->values()->all();

        $totalUsd = round(array_sum(array_column($filas, 'usd')), 2);
        $totalVes = round(array_sum(array_column($filas, 'ves')), 2);

        $cajeros = DB::select("
            SELECT u.id, u.nombre_completo AS nombre, count(*) AS ventas, sum(v.total_cobrar_usd) AS total_usd
              FROM ventas v JOIN usuarios u ON u.id = v.usuario_id
             WHERE v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN ? AND ? AND (?::bigint = 0 OR v.usuario_id = ?)
             GROUP BY u.id, u.nombre_completo ORDER BY u.nombre_completo", $b);

        $anuladas = DB::select("
            SELECT v.numero, to_char(v.fecha_hora AT TIME ZONE 'America/Caracas', 'HH24:MI') AS hora, u.nombre_completo AS cajero,
                   v.total_cobrar_usd AS total_usd, COALESCE(v.motivo_anulacion, '') AS motivo
              FROM ventas v JOIN usuarios u ON u.id = v.usuario_id
             WHERE v.estado = 'ANULADA' AND v.fecha_valor BETWEEN ? AND ? AND (?::bigint = 0 OR v.usuario_id = ?) ORDER BY v.numero", $b);

        $ops = DB::select("
            SELECT v.numero, to_char(v.fecha_hora AT TIME ZONE 'America/Caracas', 'HH24:MI') AS hora, u.nombre_completo AS cajero,
                   v.total_cobrar_usd AS total_usd,
                   json_agg(json_build_object('metodo', mp.nombre, 'monto', pv.monto_cobrado, 'moneda', trim(pv.moneda)) ORDER BY pv.id) AS pagos
              FROM ventas v JOIN usuarios u ON u.id = v.usuario_id
              JOIN pagos_venta pv ON pv.venta_id = v.id JOIN metodos_pago mp ON mp.id = pv.metodo_pago_id
             WHERE v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN ? AND ? AND (?::bigint = 0 OR v.usuario_id = ?)
             GROUP BY v.id, u.nombre_completo ORDER BY v.numero LIMIT 500", $b);
        if (! $unDia) {
            $ops = [];
        }

        // Desglose: por día si el período cabe en ~un mes; por mes si es más largo.
        $porMes = (strtotime($hasta) - strtotime($desde)) / 86400 > 35;
        $desglose = DB::select("
            SELECT " . ($porMes ? "to_char(v.fecha_valor, 'YYYY-MM')" : "v.fecha_valor::text") . " AS clave, count(DISTINCT v.id) AS ventas,
                   sum(pv.monto_usd + pv.igtf_usd) AS total_usd, sum(pv.monto_ves + pv.igtf_ves) AS total_ves
              FROM ventas v JOIN pagos_venta pv ON pv.venta_id = v.id
             WHERE v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN ? AND ? AND (?::bigint = 0 OR v.usuario_id = ?)
             GROUP BY 1 ORDER BY 1", $b);

        return [
            'resumen' => [
                'ventas' => (int) $res->ventas, 'anuladas' => (int) $res->anuladas,
                'base_usd' => (float) $res->base_usd, 'iva_usd' => (float) $res->iva_usd, 'igtf_usd' => (float) $res->igtf_usd,
                'total_usd' => $totalUsd, 'total_ves' => $totalVes,
                'tasa_min' => $res->tasa_min !== null ? (float) $res->tasa_min : null, 'tasa_max' => $res->tasa_max !== null ? (float) $res->tasa_max : null,
                // Los pagos deben sumar lo que dicen las ventas (tolerancia de redondeo de centavos por venta).
                'cuadra' => abs($totalUsd - (float) $res->total_usd) <= 0.01 * max(1, (int) $res->ventas),
            ],
            'metodos' => $filas,
            'monedas' => $monedas,
            // Anticipos de encargos aplicados en ventas del período (el dinero ya entró a la gaveta el día del anticipo).
            'anticipos_aplicados' => array_map(fn ($f) => ['metodo' => $f['metodo'], 'moneda' => $f['moneda'], 'n' => $f['n'],
                'cobrado' => $f['cobrado'], 'usd' => $f['usd'], 'ves' => $f['ves']], array_values($anticiposAplicados)),
            // Desglose gerencial del corte (fn_corte_desglose, archivo 29): por hora, top de piezas, crédito, anticipos y movimientos.
            'desglose_x' => json_decode(DB::scalar('SELECT fn_corte_desglose(?::date, ?::date, ?::bigint)::text', [$desde, $hasta, $uid]), true),
            'desglose' => ['por' => $porMes ? 'mes' : 'dia', 'filas' => array_map(fn ($d) => ['clave' => $d->clave, 'ventas' => (int) $d->ventas, 'total_usd' => round((float) $d->total_usd, 2), 'total_ves' => round((float) $d->total_ves, 2)], $desglose)],
            'cajeros' => array_map(fn ($c) => ['id' => $c->id, 'nombre' => $c->nombre, 'ventas' => (int) $c->ventas, 'total_usd' => round((float) $c->total_usd, 2)], $cajeros),
            'anuladas' => array_map(fn ($a) => ['numero' => (int) $a->numero, 'hora' => $a->hora, 'cajero' => $a->cajero, 'total_usd' => (float) $a->total_usd, 'motivo' => $a->motivo], $anuladas),
            'operaciones' => array_map(fn ($o) => ['numero' => (int) $o->numero, 'hora' => $o->hora, 'cajero' => $o->cajero, 'total_usd' => (float) $o->total_usd, 'pagos' => json_decode($o->pagos, true)], $ops),
        ];
    }
}
