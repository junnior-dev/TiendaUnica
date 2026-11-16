<?php

namespace App\Http\Controllers;

use App\Support\Ean13;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Encargos de piezas sin stock (database/sql/24_encargos.sql). El flujo que antes se anotaba en papel:
 *   fn_crear_encargo            → SOLICITADO (qué pidió el cliente)
 *   fn_cobrar_anticipo_encargo  → anticipo: entra a la gaveta del turno como INGRESO de caja
 *   fn_cambiar_estado_encargo   → ORDENADO → RECIBIDO → AVISADO
 *   fn_entregar_encargo         → crea la VENTA con la pieza, aplica los anticipos (pagos es_anticipo)
 *                                 y cobra el resto. Todo o nada, como una venta del POS.
 * La búsqueda de clientes y de productos reutiliza /caja/clientes y /caja/buscar del POS.
 */
class EncargosController extends Controller
{
    use ContextoPagina;

    public function index(Request $r)
    {
        $estado = in_array($r->query('estado'), ['abiertos', 'historial'], true) ? $r->query('estado') : 'abiertos';
        return Inertia::render('Encargos/Index', [
            ...$this->contexto(),
            'estado' => $estado,
            'encargos' => $this->datos($estado),
            'kpi' => DB::selectOne("SELECT count(*) FILTER (WHERE estado IN ('SOLICITADO','ORDENADO')) AS por_pedir,
                                           count(*) FILTER (WHERE estado = 'RECIBIDO') AS por_avisar,
                                           count(*) FILTER (WHERE estado = 'AVISADO') AS por_entregar,
                                           COALESCE(sum(anticipado_usd) FILTER (WHERE estado IN ('SOLICITADO','ORDENADO','RECIBIDO','AVISADO')), 0) AS anticipos_pendientes
                                      FROM v_encargos"),
            'metodos' => array_map(fn ($m) => ['id' => (int) $m->id, 'nombre' => $m->nombre, 'moneda' => trim($m->moneda),
                'referencia' => (bool) $m->requiere_referencia],
                DB::select('SELECT id, nombre, moneda, requiere_referencia FROM metodos_pago WHERE activo ORDER BY id')),
            'caja_abierta' => (bool) DB::scalar('SELECT fn_apertura_activa(?)', [auth()->id()]),
        ]);
    }

    /** Lista según la pestaña: abiertos por antigüedad o el historial completo. */
    public function datos(string $estado): array
    {
        $filas = DB::select($estado === 'historial'
            ? 'SELECT * FROM v_encargos ORDER BY created_at DESC LIMIT 200'
            : "SELECT * FROM v_encargos WHERE estado IN ('SOLICITADO','ORDENADO','RECIBIDO','AVISADO') ORDER BY created_at");
        return array_map(fn ($e) => [
            'id' => (int) $e->id, 'estado' => $e->estado, 'descripcion' => $e->descripcion, 'cantidad' => (float) $e->cantidad,
            'precio_estimado' => $e->precio_estimado_usd !== null ? (float) $e->precio_estimado_usd : null,
            'cliente' => $e->cliente, 'telefono' => $e->cliente_telefono, 'documento' => $e->documento_cliente,
            'sku' => $e->sku, 'producto' => $e->producto, 'stock' => (float) $e->stock_actual, 'moto' => $e->moto,
            'anticipado' => (float) $e->anticipado_usd, 'n_anticipos' => (int) $e->n_anticipos,
            'nota_proveedor' => $e->nota_proveedor, 'venta_id' => $e->venta_id !== null ? (int) $e->venta_id : null,
            'por' => $e->por, 'creado' => substr((string) $e->created_at, 0, 10), 'dias' => (int) $e->dias,
            'fecha_orden' => $e->fecha_orden, 'fecha_llegada' => $e->fecha_llegada, 'fecha_aviso' => $e->fecha_aviso, 'fecha_entrega' => $e->fecha_entrega,
        ], $filas);
    }

    /** GET /encargos/{id} → encargo completo + emisor, para imprimir el ticket térmico de «Retiro de pieza». */
    public function ver(int $id)
    {
        $e = DB::selectOne('SELECT * FROM v_encargos WHERE id = ?', [$id]);
        if (! $e) {
            return response()->json(['message' => 'Encargo no encontrado.'], 404);
        }
        $neg = DB::table('negocio')->first();
        return response()->json([
            'emisor' => ['razon_social' => $neg->razon_social ?? '', 'nombre_comercial' => $neg->nombre_comercial ?? null,
                'rif' => $neg->rif ?? '', 'direccion' => $neg->direccion_fiscal ?? '', 'telefono' => $neg->telefono ?? ''],
            'encargo' => [
                'id' => (int) $e->id, 'estado' => $e->estado, 'descripcion' => $e->descripcion, 'cantidad' => (float) $e->cantidad,
                'precio_estimado' => $e->precio_estimado_usd !== null ? (float) $e->precio_estimado_usd : null,
                'cliente' => $e->cliente, 'telefono' => $e->cliente_telefono, 'documento' => $e->documento_cliente,
                'sku' => $e->sku, 'producto' => $e->producto, 'moto' => $e->moto,
                'anticipado' => (float) $e->anticipado_usd, 'n_anticipos' => (int) $e->n_anticipos,
                'nota_proveedor' => $e->nota_proveedor, 'por' => $e->por,
                'creado' => substr((string) $e->created_at, 0, 10), 'fecha_orden' => $e->fecha_orden,
                'fecha_llegada' => $e->fecha_llegada, 'fecha_aviso' => $e->fecha_aviso,
                'ean' => Ean13::codigoEncargo((int) $e->id),
            ],
        ]);
    }

    /** POST /encargos {cliente_id, descripcion, cantidad, producto_id?, precio_estimado?, moto_modelo_id?} */
    public function store(Request $r)
    {
        $d = $r->validate([
            'cliente_id' => 'required|integer', 'descripcion' => 'required|string|min:3|max:300',
            'cantidad' => 'nullable|numeric|gt:0|max:999999', 'producto_id' => 'nullable|integer',
            'precio_estimado' => 'nullable|numeric|min:0|max:999999999', 'moto_modelo_id' => 'nullable|integer',
        ], ['descripcion.required' => 'Describe la pieza encargada.']);
        try {
            $id = (int) DB::scalar('SELECT fn_crear_encargo(?::bigint, ?::text, ?::numeric, ?::bigint, ?::numeric, ?::bigint, ?::bigint)', [
                $d['cliente_id'], $d['descripcion'], $d['cantidad'] ?? 1, $d['producto_id'] ?? null,
                $d['precio_estimado'] ?? null, $d['moto_modelo_id'] ?? null, auth()->id()]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo registrar el encargo.')], 422);
        }
        return response()->json(['id' => $id]);
    }

    /** POST /encargos/{id}/anticipo {metodo_pago_id, monto, referencia?} — exige caja abierta. */
    public function anticipo(Request $r, int $id)
    {
        $d = $r->validate([
            'metodo_pago_id' => 'required|integer', 'monto' => 'required|numeric|gt:0|max:999999999999', 'referencia' => 'nullable|string|max:60',
        ], ['monto.required' => 'Escribe el monto del anticipo.']);
        try {
            DB::scalar('SELECT fn_cobrar_anticipo_encargo(?::bigint, ?::bigint, ?::numeric, ?::bigint, ?::text)', [
                $id, $d['metodo_pago_id'], $d['monto'], auth()->id(), $d['referencia'] ?? null]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo cobrar el anticipo.')], 422);
        }
        $x = DB::selectOne('SELECT anticipado_usd, n_anticipos FROM v_encargos WHERE id = ?', [$id]);
        return response()->json(['anticipado_usd' => (float) $x->anticipado_usd, 'n_anticipos' => (int) $x->n_anticipos]);
    }

    /** POST /encargos/{id}/estado {estado, nota?} */
    public function estado(Request $r, int $id)
    {
        $d = $r->validate(['estado' => 'required|in:ORDENADO,RECIBIDO,AVISADO,CANCELADO,ANULADO', 'nota' => 'nullable|string|max:300']);
        try {
            DB::statement('CALL fn_cambiar_estado_encargo(?::bigint, ?::text, ?::bigint, ?::text)', [$id, $d['estado'], auth()->id(), $d['nota'] ?? null]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo cambiar el estado.')], 422);
        }
        return response()->json(['ok' => true]);
    }

    /** POST /encargos/{id}/entregar {pagos:[{metodo_pago_id,monto,referencia?}], descuento_pct?, tipo_emision?, observaciones?} */
    public function entregar(Request $r, int $id)
    {
        $d = $r->validate([
            'pagos' => 'nullable|array', 'pagos.*.metodo_pago_id' => 'required|integer', 'pagos.*.monto' => 'required|numeric|gt:0',
            'pagos.*.referencia' => 'nullable|string|max:60',
            'descuento_pct' => 'nullable|numeric|min:0|max:100', 'tipo_emision' => 'nullable|in:PRESENCIAL,DIGITAL,MAQUINA_FISCAL',
            'observaciones' => 'nullable|string|max:300',
        ]);
        $pagos = [];
        foreach ($d['pagos'] ?? [] as $p) {
            $pagos[] = ['metodo_pago_id' => (int) $p['metodo_pago_id'], 'monto' => round((float) $p['monto'], 2),
                'referencia' => isset($p['referencia']) ? trim((string) $p['referencia']) : null];
        }
        try {
            $ventaId = (int) DB::scalar('SELECT fn_entregar_encargo(?::bigint, ?::jsonb, ?::bigint, ?::numeric, ?::text, ?::text)', [
                $id, json_encode($pagos), auth()->id(),
                $d['descuento_pct'] ?? null, $d['tipo_emision'] ?? 'PRESENCIAL', $d['observaciones'] ?? null]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo entregar el encargo.')], 422);
        }
        $doc = app(CajaController::class)->documentoDatos($ventaId);
        $doc['aviso_emision'] = null;
        return response()->json(['venta_id' => $ventaId, 'documento' => $doc]);
    }

    private function mensaje(QueryException $e, string $porDefecto): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }
}
