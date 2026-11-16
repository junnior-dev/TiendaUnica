<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Movimientos de caja que no son ventas (database/sql/15): fletes, retiros, gastos menores y los cobros de cuentas por cobrar
 * (estos últimos los crea fn_registrar_pago_cobrar solos). Cada movimiento queda atado al turno abierto de quien lo registra.
 */
class MovimientosCajaController extends Controller
{
    use ContextoPagina;

    private function soloAdmin(): void
    {
        abort_if(strtoupper((string) (auth()->user()->rol ?? '')) !== 'ADMINISTRADOR', 403, 'Solo un administrador puede ver los movimientos de caja.');
    }

    /** Sin fechas: el turno abierto del usuario. Con ?desde=&hasta=: todos los movimientos de ese rango. */
    public function index(Request $r)
    {
        $this->soloAdmin();
        $f = fn ($v) => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $v) && strtotime($v) !== false ? $v : null;
        $desde = $f($r->query('desde'));
        $hasta = $f($r->query('hasta'));
        $apertura = app(AperturaCajaController::class)->activa();

        $base = "SELECT m.id, m.apertura_id, m.tipo, m.concepto, m.monto, trim(m.moneda) AS moneda, m.monto_usd, m.monto_ves, m.referencia, m.es_efectivo, m.origen, m.estado, m.motivo_anulacion,
                        to_char(m.created_at AT TIME ZONE 'America/Caracas', 'DD/MM/YYYY HH24:MI') AS cuando, u.nombre_completo AS por
                   FROM movimientos_caja m JOIN usuarios u ON u.id = m.usuario_id";
        if ($desde || $hasta) {
            $desde ??= $hasta;
            $hasta ??= $desde;
            $filas = DB::select($base . " WHERE (m.created_at AT TIME ZONE 'America/Caracas')::date BETWEEN ? AND ? ORDER BY m.id DESC LIMIT 500", [$desde, $hasta]);
            $modo = 'rango';
        } else {
            $filas = $apertura ? DB::select($base . ' WHERE m.apertura_id = ? ORDER BY m.id DESC', [$apertura['id']]) : [];
            $modo = 'turno';
        }
        $act = array_filter($filas, fn ($m) => $m->estado === 'ACTIVO');
        $suma = fn ($tipo, $col) => round(array_sum(array_map(fn ($m) => (float) $m->$col, array_filter($act, fn ($m) => $m->tipo === $tipo))), 2);

        return Inertia::render('MovimientosCaja/Index', $this->contexto() + [
            'hoy' => (string) DB::scalar('SELECT fn_hoy()'),
            'modo' => $modo, 'desde' => $desde, 'hasta' => $hasta, 'apertura' => $apertura,
            'totales' => ['ingresos_usd' => $suma('INGRESO', 'monto_usd'), 'egresos_usd' => $suma('EGRESO', 'monto_usd'), 'ingresos_ves' => $suma('INGRESO', 'monto_ves'), 'egresos_ves' => $suma('EGRESO', 'monto_ves')],
            'movimientos' => array_map(fn ($m) => ['id' => (int) $m->id, 'tipo' => $m->tipo, 'concepto' => $m->concepto, 'monto' => (float) $m->monto, 'moneda' => $m->moneda, 'usd' => (float) $m->monto_usd, 'ves' => (float) $m->monto_ves,
                'referencia' => $m->referencia, 'efectivo' => (bool) $m->es_efectivo, 'origen' => $m->origen, 'estado' => $m->estado, 'motivo' => $m->motivo_anulacion, 'cuando' => $m->cuando, 'por' => $m->por], $filas),
            'monedas' => array_map(fn ($m) => trim($m->codigo), DB::select("SELECT codigo FROM monedas WHERE activa ORDER BY array_position(ARRAY['USD','VES','EUR','COP'], trim(codigo)::text), codigo")),
        ]);
    }

    /** Registra un egreso (o ingreso) manual en la caja abierta. */
    public function store(Request $r)
    {
        $this->soloAdmin();
        $d = $r->validate([
            'tipo' => 'nullable|in:INGRESO,EGRESO', 'concepto' => 'required|string|min:3|max:200', 'monto' => 'required|numeric|gt:0|max:999999999999',
            'moneda' => 'required|string|size:3', 'referencia' => 'nullable|string|max:60',
        ], ['concepto.required' => 'Escribe el concepto (por ejemplo: flete, retiro).', 'concepto.min' => 'El concepto es muy corto.', 'monto.required' => 'Escribe el monto.', 'monto.gt' => 'El monto debe ser mayor que cero.']);
        try {
            $id = (int) DB::transaction(fn () => DB::scalar("SELECT fn_registrar_movimiento_caja(?::bigint, ?::text, ?::text, ?::char(3), ?::numeric, ?::text)",
                [auth()->id(), $d['tipo'] ?? 'EGRESO', $d['concepto'], strtoupper($d['moneda']), $d['monto'], $d['referencia'] ?? null]));
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo registrar el movimiento.')], 422);
        }
        return response()->json(['id' => $id]);
    }

    public function anular(Request $r, $id)
    {
        $this->soloAdmin();
        $v = $r->validate(['motivo' => 'required|string|min:3|max:300'], ['motivo.required' => 'Escribe el motivo de la anulación.', 'motivo.min' => 'Escribe el motivo de la anulación.']);
        try {
            DB::transaction(fn () => DB::statement('SELECT fn_anular_movimiento_caja(?::bigint, ?::text, ?::bigint)', [(int) $id, $v['motivo'], auth()->id()]));
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo anular el movimiento.')], 422);
        }
        return response()->json(['ok' => true]);
    }

    private function mensaje(QueryException $e, string $porDefecto): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }
}
