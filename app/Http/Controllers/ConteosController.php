<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Conteos físicos de inventario (database/sql/27_conteos_fisicos.sql):
 *   fn_crear_conteo   → abre el conteo (categoría, lista, stock bajo o todo) y congela el stock del sistema
 *   fn_contar         → guarda lo contado (línea por línea o en lote)
 *   fn_aplicar_conteo → TODOS los ajustes del kardex de una vez (uno por pieza con diferencia)
 *   fn_anular_conteo  → se descarta sin tocar el inventario
 */
class ConteosController extends Controller
{
    use ContextoPagina;

    public function index(Request $r)
    {
        $activo = (int) $r->query('conteo', 0) ?: (int) DB::scalar('SELECT max(id) FROM conteos_fisicos WHERE estado = \'ABIERTO\'');
        return Inertia::render('Conteos/Index', [
            ...$this->contexto(),
            'conteos' => array_map(fn ($c) => [
                'id' => (int) $c->id, 'numero' => (int) $c->numero, 'fecha' => $c->fecha, 'alcance' => $c->alcance,
                'categoria' => $c->categoria, 'descripcion' => $c->descripcion, 'estado' => $c->estado, 'por' => $c->por,
                'lineas' => (int) $c->lineas, 'contadas' => (int) $c->contadas, 'con_diferencia' => (int) $c->con_diferencia,
                'diferencia_absoluta' => (float) $c->diferencia_absoluta, 'aplicado_en' => $c->aplicado_en,
            ], DB::select('SELECT * FROM v_conteos ORDER BY (estado = \'ABIERTO\') DESC, created_at DESC LIMIT 60')),
            'activo' => $this->detalle($activo),
            'categorias' => array_map(fn ($c) => ['id' => (int) $c->id, 'nombre' => $c->nombre],
                DB::select('SELECT id, nombre FROM categorias WHERE activa ORDER BY nombre')),
        ]);
    }

    private function detalle(int $id): ?array
    {
        if (! $id) {
            return null;
        }
        $c = DB::selectOne('SELECT * FROM v_conteos WHERE id = ?', [$id]);
        if (! $c) {
            return null;
        }
        return ['id' => (int) $c->id, 'numero' => (int) $c->numero, 'fecha' => $c->fecha, 'alcance' => $c->alcance,
            'categoria' => $c->categoria, 'descripcion' => $c->descripcion, 'estado' => $c->estado, 'por' => $c->por,
            'lineas' => (int) $c->lineas, 'contadas' => (int) $c->contadas, 'con_diferencia' => (int) $c->con_diferencia,
            'diferencia_absoluta' => (float) $c->diferencia_absoluta,
            'filas' => array_map(fn ($f) => [
                'producto_id' => (int) $f->producto_id, 'sku' => $f->sku, 'nombre' => $f->nombre, 'unidad' => trim($f->unidad),
                'categoria' => $f->categoria, 'stock_sistema' => (float) $f->stock_sistema,
                'contado' => $f->contado !== null ? (float) $f->contado : null,
                'diferencia' => $f->contado !== null ? round((float) $f->contado - (float) $f->stock_sistema, 3) : null,
                'valor_costo' => (float) $f->valor_costo_usd,
            ], DB::select('SELECT * FROM v_conteo_detalle WHERE conteo_id = ? ORDER BY categoria, nombre', [$id]))];
    }

    /** POST /conteos {alcance, descripcion?, categoria_id?, producto_ids?} */
    public function store(Request $r)
    {
        $d = $r->validate([
            'alcance' => 'required|in:CATEGORIA,LISTA,STOCK_BAJO,TODO', 'descripcion' => 'nullable|string|max:200',
            'categoria_id' => 'nullable|integer', 'producto_ids' => 'nullable|array|min:1|max:1000',
            'producto_ids.*' => 'integer',
        ]);
        try {
            $id = (int) DB::scalar('SELECT fn_crear_conteo(?::text, ?::bigint, ?::text, ?::bigint, ?::jsonb)', [
                $d['alcance'], auth()->id(), $d['descripcion'] ?? null, $d['categoria_id'] ?? null,
                isset($d['producto_ids']) ? json_encode(array_map(fn ($x) => (int) $x, $d['producto_ids'])) : null]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo abrir el conteo.')], 422);
        }
        return response()->json(['id' => $id, 'detalle' => $this->detalle($id)]);
    }

    /** POST /conteos/{id}/contar {items:[{producto_id, contado}]} */
    public function contar(Request $r, int $id)
    {
        $d = $r->validate(['items' => 'required|array|min:1|max:2000', 'items.*.producto_id' => 'required|integer',
            'items.*.contado' => 'required|numeric|min:0|max:999999999']);
        $items = array_map(fn ($i) => ['producto_id' => (int) $i['producto_id'], 'contado' => round((float) $i['contado'], 3)], $d['items']);
        try {
            DB::scalar('SELECT fn_contar(?::bigint, ?::jsonb, ?::bigint)', [$id, json_encode($items), auth()->id()]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo guardar lo contado.')], 422);
        }
        return response()->json(['ok' => true]);
    }

    /** POST /conteos/{id}/quitar {producto_id} */
    public function quitar(Request $r, int $id)
    {
        $d = $r->validate(['producto_id' => 'required|integer']);
        try {
            DB::scalar('SELECT fn_quitar_linea_conteo(?::bigint, ?::bigint)', [$id, (int) $d['producto_id']]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo quitar la línea.')], 422);
        }
        return response()->json(['ok' => true]);
    }

    /** POST /conteos/{id}/aplicar → ajustes del kardex en lote. */
    public function aplicar(int $id)
    {
        try {
            $n = (int) DB::scalar('SELECT fn_aplicar_conteo(?::bigint, ?::bigint)', [$id, auth()->id()]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo aplicar el conteo.')], 422);
        }
        return response()->json(['ok' => true, 'ajustes' => $n]);
    }

    /** POST /conteos/{id}/anular {motivo} */
    public function anular(Request $r, int $id)
    {
        $d = $r->validate(['motivo' => 'required|string|min:3|max:300'], ['motivo.required' => 'Cuenta por qué se anula el conteo.']);
        try {
            DB::scalar('SELECT fn_anular_conteo(?::bigint, ?::bigint, ?::text)', [$id, auth()->id(), $d['motivo']]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo anular el conteo.')], 422);
        }
        return response()->json(['ok' => true]);
    }

    private function mensaje(QueryException $e, string $porDefecto): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }
}
