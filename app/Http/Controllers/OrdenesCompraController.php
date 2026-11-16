<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Órdenes de compra (database/sql/26_ordenes_compra.sql): el pedido AL proveedor, antes de la factura.
 *   fn_crear_orden / fn_editar_linea_orden → BORRADOR (se puede corregir)
 *   fn_enviar_orden                        → ENVIADA (backorder abierto)
 *   fn_recibir_orden                       → registra la COMPRA REAL y abona lo recibido; PARCIAL o RECIBIDA
 *   fn_cerrar_orden / fn_anular_orden      → cierra o anula lo pendiente
 *   fn_sugerir_compra                      → qué reponer según mínimo + consumo de los últimos 30 días
 */
class OrdenesCompraController extends Controller
{
    use ContextoPagina;

    public function index(Request $r)
    {
        return Inertia::render('OrdenesCompra/Index', [
            ...$this->contexto(),
            'ver' => in_array($r->query('ver'), ['todas', 'pendientes'], true) ? $r->query('ver') : 'pendientes',
            'ordenes' => $this->datos($r->query('ver', 'pendientes')),
            'kpi' => DB::selectOne("SELECT count(*) FILTER (WHERE estado IN ('ENVIADA','PARCIAL')) AS abiertas,
                                           COALESCE(sum(pendiente_piezas) FILTER (WHERE estado IN ('ENVIADA','PARCIAL')), 0) AS pendiente_piezas,
                                           COALESCE(sum(estimado_usd) FILTER (WHERE estado IN ('ENVIADA','PARCIAL')), 0) AS estimado_usd
                                      FROM v_ordenes_compra"),
            'proveedores' => array_map(fn ($p) => ['id' => (int) $p->id, 'nombre' => $p->razon_social],
                DB::select('SELECT id, razon_social FROM proveedores WHERE activo ORDER BY razon_social')),
            'condiciones' => DB::selectOne("SELECT to_regclass('pagos_proveedor') IS NOT NULL AS cxp"),
        ]);
    }

    public function datos(string $ver): array
    {
        // La vista v_ordenes_compra expone «fecha», no «created_at»: ordenar por
        // la columna inexistente rompe la pantalla con 500 (hallazgo 2026-11-16).
        $filas = DB::select($ver === 'todas'
            ? 'SELECT * FROM v_ordenes_compra ORDER BY fecha DESC, id DESC LIMIT 100'
            : 'SELECT * FROM v_ordenes_compra WHERE estado IN (\'BORRADOR\',\'ENVIADA\',\'PARCIAL\') ORDER BY fecha DESC, id DESC LIMIT 100');
        return array_map(fn ($o) => [
            'id' => (int) $o->id, 'numero' => (int) $o->numero, 'proveedor_id' => (int) $o->proveedor_id, 'proveedor' => $o->proveedor,
            'rif' => $o->rif, 'fecha' => $o->fecha, 'estado' => $o->estado, 'observaciones' => $o->observaciones,
            'fecha_envio' => $o->fecha_envio, 'cerrada_en' => $o->cerrada_en, 'cerrada_motivo' => $o->cerrada_motivo,
            'anulada_motivo' => $o->anulada_motivo, 'por' => $o->por,
            'n_lineas' => (int) $o->n_lineas, 'pedido' => (float) $o->pedido_piezas, 'recibido' => (float) $o->recibido_piezas,
            'pendiente' => (float) $o->pendiente_piezas, 'estimado_usd' => (float) $o->estimado_usd,
            'lineas' => array_map(fn ($l) => ['producto_id' => (int) $l['producto_id'], 'sku' => $l['sku'], 'nombre' => $l['nombre'],
                'unidad' => trim($l['unidad']), 'unidad_compra' => $l['unidad_compra'], 'presentacion' => (float) $l['presentacion'],
                'pedida' => (float) $l['pedida'], 'recibida' => (float) $l['recibida'], 'pendiente' => (float) $l['pendiente'],
                'costo_estimado' => $l['costo_estimado_usd'] !== null ? (float) $l['costo_estimado_usd'] : null,
                'costo_recibido' => $l['costo_recibido_usd'] !== null ? (float) $l['costo_recibido_usd'] : null], $o->lineas),
        ], $filas);
    }

    /** POST /ordenes-compra {proveedor_id, items:[{producto_id, cantidad, costo_estimado?}], observaciones?} */
    public function store(Request $r)
    {
        $d = $r->validate([
            'proveedor_id' => 'required|integer', 'observaciones' => 'nullable|string|max:300', 'items' => 'required|array|min:1|max:200',
            'items.*.producto_id' => 'required|integer|distinct', 'items.*.cantidad' => 'required|numeric|gt:0|max:999999',
            'items.*.costo_estimado' => 'nullable|numeric|min:0|max:9999999999',
        ], ['items.required' => 'Agrega al menos un producto a la orden.']);
        $items = array_map(fn ($i) => ['producto_id' => (int) $i['producto_id'], 'cantidad' => round((float) $i['cantidad'], 3),
            'costo_estimado_usd' => isset($i['costo_estimado']) && $i['costo_estimado'] !== '' && $i['costo_estimado'] !== null ? round((float) $i['costo_estimado'], 4) : null], $d['items']);
        try {
            $id = (int) DB::scalar('SELECT fn_crear_orden(?::bigint, ?::jsonb, ?::bigint, ?::text)',
                [$d['proveedor_id'], json_encode($items), auth()->id(), $d['observaciones'] ?? null]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo crear la orden.')], 422);
        }
        return response()->json(['id' => $id]);
    }

    /** POST /ordenes-compra/{id}/enviar · /cerrar {motivo} · /anular {motivo} */
    public function enviar(int $id)
    {
        try {
            DB::scalar('SELECT fn_enviar_orden(?::bigint, ?::bigint, NULL)', [$id, auth()->id()]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo enviar la orden.')], 422);
        }
        return response()->json(['ok' => true]);
    }

    public function cerrar(Request $r, int $id)
    {
        $d = $r->validate(['motivo' => 'required|string|min:3|max:300'], ['motivo.required' => 'Cuenta por qué se cierra la orden.']);
        try {
            DB::scalar('SELECT fn_cerrar_orden(?::bigint, ?::bigint, ?::text)', [$id, auth()->id(), $d['motivo']]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo cerrar la orden.')], 422);
        }
        return response()->json(['ok' => true]);
    }

    public function anular(Request $r, int $id)
    {
        $d = $r->validate(['motivo' => 'required|string|min:3|max:300'], ['motivo.required' => 'Cuenta por qué se anula la orden.']);
        try {
            DB::scalar('SELECT fn_anular_orden(?::bigint, ?::bigint, ?::text)', [$id, auth()->id(), $d['motivo']]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo anular la orden.')], 422);
        }
        return response()->json(['ok' => true]);
    }

    /**
     * POST /ordenes-compra/{id}/recibir — la recepción PARCIAL. Registra la factura real (fn_registrar_compra) y
     * abona las cantidades a la orden, en UNA transacción: si algo falla, no queda ni factura ni recepción.
     */
    public function recibir(Request $r, int $id)
    {
        $d = $r->validate([
            'numero_factura' => 'required|string|max:40', 'fecha_factura' => 'required|date_format:Y-m-d', 'moneda' => 'required|in:USD,VES',
            'numero_control' => 'nullable|string|max:40', 'condicion' => 'nullable|in:CONTADO,CREDITO',
            'dias_credito' => 'nullable|integer|min:0|max:365', 'credito_fiscal' => 'nullable|boolean', 'observaciones' => 'nullable|string|max:300',
            'items' => 'required|array|min:1|max:200',
            'items.*.producto_id' => 'required|integer', 'items.*.cantidad' => 'required|numeric|gt:0|max:999999',
            'items.*.costo_unitario' => 'required|numeric|min:0|max:999999999999', 'items.*.exento' => 'nullable|boolean',
        ], ['numero_factura.required' => 'Escribe el número de la factura del proveedor.', 'items.required' => 'Indica las líneas que están llegando.']);
        $items = array_map(fn ($i) => ['producto_id' => (int) $i['producto_id'], 'cantidad' => round((float) $i['cantidad'], 3),
            'costo_unitario' => round((float) $i['costo_unitario'], 4),
            'exento' => array_key_exists('exento', $i) && $i['exento'] !== null ? (bool) $i['exento'] : null], $d['items']);
        try {
            $compraId = (int) DB::transaction(function () use ($d, $id, $items) {
                return (int) DB::scalar('SELECT fn_recibir_orden(?::bigint, ?::jsonb, ?::text, ?::date, ?::char(3), ?::bigint, ?::text, ?::text, ?::int, ?::boolean, ?::text)', [
                    $id, json_encode($items), $d['numero_factura'], $d['fecha_factura'], $d['moneda'], auth()->id(),
                    $d['numero_control'] ?? null, $d['condicion'] ?? 'CONTADO', $d['dias_credito'] ?? 0,
                    $d['credito_fiscal'] ?? null, $d['observaciones'] ?? null]);
            });
        } catch (QueryException $e) {
            if (str_contains($e->getMessage(), 'compras_proveedor_id_numero_factura_key')) {
                return response()->json(['message' => 'Ya registraste esa factura de ese proveedor.'], 422);
            }
            return response()->json(['message' => $this->mensaje($e, 'No se pudo registrar la recepción.')], 422);
        }
        return response()->json(['compra_id' => $compraId, 'resumen' => app(ComprasController::class)->resumenRegistro($compraId)]);
    }

    /** GET /ordenes-compra/sugerir → qué conviene reponer (min + consumo 30 días). */
    public function sugerir(Request $r)
    {
        $dias = min(90, max(1, (int) $r->query('dias', 15)));
        $filas = DB::select('SELECT * FROM fn_sugerir_compra(?::int, 30)', [$dias]);
        return response()->json(['dias' => $dias, 'filas' => array_map(fn ($f) => [
            'producto_id' => (int) $f->producto_id, 'sku' => $f->sku, 'nombre' => $f->nombre, 'categoria' => $f->categoria,
            'unidad' => trim($f->unidad), 'unidad_compra' => $f->unidad_compra !== null ? trim($f->unidad_compra) : null,
            'presentacion' => (float) $f->piezas_por_presentacion, 'stock' => (float) $f->stock_actual, 'minimo' => (float) $f->stock_minimo,
            'consumo_30d' => (float) $f->consumo_30d, 'dias_para_agotar' => $f->dias_para_agotar !== null ? round((float) $f->dias_para_agotar, 1) : null,
            'faltante' => (float) $f->faltante_minimo, 'sugerido' => (float) $f->sugerido,
            'ultimo_costo' => $f->ultimo_costo_usd !== null ? (float) $f->ultimo_costo_usd : null,
            'ultimo_proveedor' => $f->ultimo_proveedor,
        ], $filas)]);
    }

    private function mensaje(QueryException $e, string $porDefecto): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }
}
