<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Declaración anual de ISLR: borrador de trabajo, anticipos pagados, retenciones que te practicaron y tarifa por tramos
 * (database/sql/36_islr_declaracion.sql). Con contabilidad automática cada anticipo, retención recibida, la liquidación y el pago generan su asiento (39_islr_asientos.sql). El sistema no calcula la renta neta fiscal por
 * su cuenta (gastos, deducciones, ajuste por inflación y tarifa los aporta el contador). No es el formulario del SENIAT: la declaración se presenta en el
 * portal del SENIAT. Todas las reglas viven en PostgreSQL; aquí solo se valida el formato. Solo administrador (módulo «fiscal»).
 */
class DeclaracionIslrController extends Controller
{
    use ContextoPagina;

    private function instalado(): bool
    {
        return (bool) DB::scalar("SELECT to_regproc('fn_islr_borrador') IS NOT NULL AND to_regclass('islr_anticipos') IS NOT NULL");
    }

    private function mensaje(QueryException $e, string $porDefecto): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }

    private function ejercicio(Request $r, string $hoy): int
    {
        $e = (int) $r->input('ejercicio', $r->query('ejercicio', substr($hoy, 0, 4)));
        return ($e >= 2000 && $e <= 2100) ? $e : (int) substr($hoy, 0, 4);
    }

    /** Todo lo de la pantalla para un ejercicio (también lo devuelven las acciones, para refrescar sin recargar la página). */
    private function datos(int $e): array
    {
        $b = json_decode((string) DB::scalar('SELECT fn_islr_borrador(?)::text', [$e]), true);
        $d = DB::table('islr_declaracion')->where('ejercicio', $e)->first();
        return [
            'borrador' => $b,
            'contab' => [
                'disponible' => (bool) DB::scalar("SELECT to_regproc('fn_islr_contabilizar') IS NOT NULL"),
                'automatica' => (bool) DB::scalar('SELECT fn_contab_automatica()'),
                'liquidada' => (bool) ($d->contabilizada ?? false), 'pagada' => (bool) ($d->pagada ?? false),
            ],
            'declaracion' => [
                'desde' => $d->desde ?? $b['desde'], 'hasta' => $d->hasta ?? $b['hasta'],
                'costo_ventas' => $d && $d->costo_ventas_ves !== null ? (float) $d->costo_ventas_ves : null,
                'gastos' => (float) ($d->gastos_ves ?? 0), 'otras' => (float) ($d->otras_deducciones_ves ?? 0), 'ajuste' => (float) ($d->ajuste_inflacion_ves ?? 0),
                'rebajas' => (float) ($d->rebajas_ves ?? 0), 'notas' => $d->notas ?? '',
            ],
            'tramos' => DB::table('islr_tarifa_tramos')->where('ejercicio', $e)->orderBy('desde_ut')->get()
                ->map(fn ($t) => ['desde_ut' => (float) $t->desde_ut, 'hasta_ut' => $t->hasta_ut !== null ? (float) $t->hasta_ut : null, 'pct' => (float) $t->pct, 'sustraendo_ut' => (float) $t->sustraendo_ut])->all(),
            'anticipos' => DB::table('islr_anticipos')->whereBetween('fecha_pago', [$b['desde'], $b['hasta']])->orderByDesc('fecha_pago')->orderByDesc('id')->get()
                ->map(fn ($a) => ['id' => (int) $a->id, 'fecha' => $a->fecha_pago, 'periodo' => $a->periodo, 'monto' => (float) $a->monto_ves, 'referencia' => $a->referencia, 'observaciones' => $a->observaciones, 'estado' => $a->estado, 'motivo' => $a->motivo_anulacion])->all(),
            'sufridas' => DB::table('islr_retenciones_sufridas')->whereBetween('fecha', [$b['desde'], $b['hasta']])->orderByDesc('fecha')->orderByDesc('id')->get()
                ->map(fn ($s) => ['id' => (int) $s->id, 'fecha' => $s->fecha, 'agente' => $s->agente_nombre, 'rif' => $s->agente_rif, 'comprobante' => $s->comprobante, 'documento' => $s->documento,
                    'base' => (float) $s->base_ves, 'retenido' => (float) $s->retenido_ves, 'estado' => $s->estado, 'motivo' => $s->motivo_anulacion])->all(),
        ];
    }

    public function index(Request $r)
    {
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $base = $this->contexto() + ['hoy' => $hoy, 'instalado' => $this->instalado()];
        $anioActual = (int) substr($hoy, 0, 4);
        if (!$base['instalado']) return Inertia::render('DeclaracionIslr/Index', $base + ['ejercicio' => $anioActual]);
        $e = $this->ejercicio($r, $hoy);
        $n = DB::table('negocio')->first();
        return Inertia::render('DeclaracionIslr/Index', $base + $this->datos($e) + [
            'ejercicio' => $e,
            'contribuyente' => ['razon_social' => $n->razon_social, 'comercial' => $n->nombre_comercial, 'rif' => $n->rif, 'direccion' => $n->direccion_fiscal],
        ]);
    }

    private function responder(int $e, array $extra = [])
    {
        return response()->json(['ok' => true] + $extra + $this->datos($e));
    }

    private function intentar(callable $f, string $porDefecto, int $e, array $extra = [])
    {
        try { $f(); } catch (QueryException $x) { return response()->json(['message' => $this->mensaje($x, $porDefecto)], 422); }
        return $this->responder($e, $extra);
    }

    public function guardarDatos(Request $r)
    {
        $d = $r->validate([
            'ejercicio' => 'required|integer|between:2000,2100', 'desde' => 'required|date_format:Y-m-d', 'hasta' => 'required|date_format:Y-m-d',
            'costo_ventas' => 'nullable|numeric|min:0', 'gastos' => 'nullable|numeric|min:0', 'otras' => 'nullable|numeric|min:0', 'ajuste' => 'nullable|numeric',
            'rebajas' => 'nullable|numeric|min:0', 'notas' => 'nullable|string|max:300',
        ]);
        return $this->intentar(fn () => DB::statement('SELECT fn_islr_declaracion_guardar(?::int, ?::date, ?::date, ?::numeric, ?::numeric, ?::numeric, ?::numeric, ?::numeric, ?::text, ?::bigint)',
            [$d['ejercicio'], $d['desde'], $d['hasta'], $d['costo_ventas'] ?? null, $d['gastos'] ?? 0, $d['otras'] ?? 0, $d['ajuste'] ?? 0, $d['rebajas'] ?? 0, $d['notas'] ?? null, auth()->id()]),
            'No se pudieron guardar los datos del ejercicio.', (int) $d['ejercicio']);
    }

    public function guardarTramos(Request $r)
    {
        $d = $r->validate([
            'ejercicio' => 'required|integer|between:2000,2100', 'tramos' => 'present|array|max:12',
            'tramos.*.desde_ut' => 'required|numeric|min:0', 'tramos.*.hasta_ut' => 'nullable|numeric', 'tramos.*.pct' => 'required|numeric|between:0,100', 'tramos.*.sustraendo_ut' => 'nullable|numeric|min:0',
        ]);
        return $this->intentar(fn () => DB::statement('SELECT fn_islr_tramos_guardar(?::int, ?::jsonb)', [$d['ejercicio'], json_encode($d['tramos'])]), 'No se pudieron guardar los tramos.', (int) $d['ejercicio']);
    }

    public function anticipo(Request $r)
    {
        $d = $r->validate(['ejercicio' => 'required|integer|between:2000,2100', 'fecha' => 'required|date_format:Y-m-d', 'periodo' => 'nullable|date_format:Y-m-d', 'monto' => 'required|numeric|gt:0', 'referencia' => 'nullable|string|max:60', 'observaciones' => 'nullable|string|max:200']);
        return $this->intentar(fn () => DB::statement('SELECT fn_islr_anticipo_registrar(?::date, ?::date, ?::numeric, ?::text, ?::text, ?::bigint)',
            [$d['fecha'], $d['periodo'] ?? null, $d['monto'], $d['referencia'] ?? null, $d['observaciones'] ?? null, auth()->id()]), 'No se pudo registrar el anticipo.', (int) $d['ejercicio']);
    }

    public function anularAnticipo(Request $r, int $id)
    {
        $d = $r->validate(['ejercicio' => 'required|integer|between:2000,2100', 'motivo' => 'required|string|min:3|max:200']);
        return $this->intentar(fn () => DB::statement('SELECT fn_islr_anticipo_anular(?::bigint, ?::text)', [$id, $d['motivo']]), 'No se pudo anular el anticipo.', (int) $d['ejercicio']);
    }

    public function sufrida(Request $r)
    {
        $d = $r->validate(['ejercicio' => 'required|integer|between:2000,2100', 'fecha' => 'required|date_format:Y-m-d', 'agente' => 'required|string|min:3|max:150', 'rif' => 'required|string|max:15',
            'comprobante' => 'nullable|string|max:40', 'documento' => 'nullable|string|max:40', 'base' => 'required|numeric|gt:0', 'retenido' => 'required|numeric|gt:0']);
        return $this->intentar(fn () => DB::statement('SELECT fn_islr_sufrida_registrar(?::date, ?::text, ?::text, ?::text, ?::text, ?::numeric, ?::numeric, ?::text, ?::bigint)',
            [$d['fecha'], $d['agente'], $d['rif'], $d['comprobante'] ?? null, $d['documento'] ?? null, $d['base'], $d['retenido'], null, auth()->id()]), 'No se pudo registrar la retención.', (int) $d['ejercicio']);
    }

    /** Liquida el impuesto del ejercicio en los libros (gasto contra anticipos, retenciones recibidas y saldo por pagar). */
    public function liquidar(Request $r)
    {
        $d = $r->validate(['ejercicio' => 'required|integer|between:2000,2100']);
        return $this->intentar(fn () => DB::statement('SELECT fn_islr_contabilizar(?::int, ?::bigint)', [$d['ejercicio'], auth()->id()]), 'No se pudo liquidar el ISLR en la contabilidad.', (int) $d['ejercicio']);
    }

    public function pagar(Request $r)
    {
        $d = $r->validate(['ejercicio' => 'required|integer|between:2000,2100', 'fecha' => 'required|date_format:Y-m-d']);
        return $this->intentar(fn () => DB::statement('SELECT fn_islr_pagar(?::int, ?::date, ?::bigint)', [$d['ejercicio'], $d['fecha'], auth()->id()]), 'No se pudo registrar el pago.', (int) $d['ejercicio']);
    }

    public function revertir(Request $r)
    {
        $d = $r->validate(['ejercicio' => 'required|integer|between:2000,2100']);
        return $this->intentar(fn () => DB::statement('SELECT fn_islr_descontabilizar(?::int, ?::bigint)', [$d['ejercicio'], auth()->id()]), 'No se pudo revertir la liquidación.', (int) $d['ejercicio']);
    }

    public function anularSufrida(Request $r, int $id)
    {
        $d = $r->validate(['ejercicio' => 'required|integer|between:2000,2100', 'motivo' => 'required|string|min:3|max:200']);
        return $this->intentar(fn () => DB::statement('SELECT fn_islr_sufrida_anular(?::bigint, ?::text)', [$id, $d['motivo']]), 'No se pudo anular la retención.', (int) $d['ejercicio']);
    }

    /** Alertas de ISLR para el comando islr:alertas y para la pantalla de retenciones. */
    public static function alertas(int $dias = 7): array
    {
        if (!DB::scalar("SELECT to_regproc('fn_islr_alertas') IS NOT NULL")) return [];
        return array_map(fn ($a) => ['tipo' => $a->tipo, 'gravedad' => $a->gravedad, 'mensaje' => $a->mensaje, 'fecha' => $a->fecha], DB::select('SELECT * FROM fn_islr_alertas(NULL, ?)', [$dias]));
    }
}
