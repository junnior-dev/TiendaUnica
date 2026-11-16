<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Combos / kits de mantenimiento (database/sql/25_combos.sql). El combo es una RECETA, no un producto:
 *   fn_combo_items            → los items con el descuento repartido para dar el precio del kit
 *   fn_cotizar_combo          → totales sin vender (la caja los muestra al agregarlo)
 *   fn_registrar_venta_combo  → la venta real, línea por componente (IVA, costo y kardex por pieza)
 * El listado (lista) lo usa el punto de venta; el CRUD es del administrador.
 */
class CombosController extends Controller
{
    use ContextoPagina;

    /** El CRUD de combos es del administrador: la caja solo los cotiza y vende (hallazgo 2026-11-16). */
    private function soloAdmin(): void
    {
        abort_if(strtoupper((string) (auth()->user()->rol ?? '')) !== 'ADMINISTRADOR', 403, 'Solo un administrador puede gestionar los combos.');
    }

    public function index()
    {
        return Inertia::render('Combos/Index', [...$this->contexto(), 'combos' => $this->datos()]);
    }

    /** GET /combos/lista → activos con componentes (lo consume el punto de venta y esta pantalla). */
    public function lista(): array
    {
        return array_map(fn ($c) => [
            'id' => (int) $c->id, 'sku' => $c->sku, 'nombre' => $c->nombre, 'descripcion' => $c->descripcion,
            'precio' => $c->precio_usd !== null ? (float) $c->precio_usd : null, 'hay_stock' => (bool) $c->hay_stock,
            'suma_piezas' => (float) $c->suma_piezas_usd, 'ahorro_pct' => (float) $c->ahorro_pct,
            'componentes' => array_map(fn ($x) => ['producto_id' => (int) $x['producto_id'], 'sku' => $x['sku'], 'nombre' => $x['nombre'],
                'cantidad' => (float) $x['cantidad'], 'precio' => (float) $x['precio_usd'], 'stock' => (float) $x['stock'],
                'exento' => (bool) $x['exento']], $this->componentes($c)),
        ], DB::select('SELECT * FROM v_combos WHERE activo ORDER BY nombre'));
    }

    public function datos(): array
    {
        return array_map(fn ($c) => [
            'id' => (int) $c->id, 'sku' => $c->sku, 'nombre' => $c->nombre, 'descripcion' => $c->descripcion,
            'precio' => $c->precio_usd !== null ? (float) $c->precio_usd : null, 'activo' => (bool) $c->activo,
            'suma_piezas' => (float) $c->suma_piezas_usd, 'ahorro_pct' => (float) $c->ahorro_pct, 'hay_stock' => (bool) $c->hay_stock,
            'componentes' => array_map(fn ($x) => ['producto_id' => (int) $x['producto_id'], 'sku' => $x['sku'], 'nombre' => $x['nombre'],
                'cantidad' => (float) $x['cantidad'], 'precio' => (float) $x['precio_usd'], 'stock' => (float) $x['stock']], $this->componentes($c)),
        ], DB::select('SELECT * FROM v_combos ORDER BY activo DESC, nombre'));
    }

    /** v_combos.componentes es jsonb: PDO lo entrega como texto y hay que decodificarlo antes de iterar. */
    private function componentes($combo): array
    {
        return is_string($combo->componentes) ? json_decode($combo->componentes, true) : (array) $combo->componentes;
    }

    /** POST /combos {sku, nombre, precio?, descripcion?, componentes:[{producto_id, cantidad}]} */
    public function store(Request $r)
    {
        $this->soloAdmin();
        $d = $this->validar($r);
        try {
            DB::transaction(function () use ($d) {
                $id = (int) DB::scalar('INSERT INTO combos (sku, nombre, descripcion, precio_usd, usuario_id) VALUES (?, ?, ?, ?, ?) RETURNING id',
                    [strtoupper(trim($d['sku'])), trim($d['nombre']), $d['descripcion'] ?: null, $d['precio'], auth()->id()]);
                foreach ($d['componentes'] as $c) {
                    DB::table('combo_componentes')->insert(['combo_id' => $id, 'producto_id' => (int) $c['producto_id'], 'cantidad' => (float) $c['cantidad']]);
                }
            });
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo guardar el combo.')], 422);
        }
        return response()->json(['ok' => true]);
    }

    /** PUT /combos/{id} */
    public function update(Request $r, int $id)
    {
        $this->soloAdmin();
        $d = $this->validar($r);
        try {
            DB::transaction(function () use ($d, $id) {
                DB::table('combos')->where('id', $id)->update(['sku' => strtoupper(trim($d['sku'])), 'nombre' => trim($d['nombre']),
                    'descripcion' => $d['descripcion'] ?: null, 'precio_usd' => $d['precio']]);
                DB::table('combo_componentes')->where('combo_id', $id)->delete();
                foreach ($d['componentes'] as $c) {
                    DB::table('combo_componentes')->insert(['combo_id' => $id, 'producto_id' => (int) $c['producto_id'], 'cantidad' => (float) $c['cantidad']]);
                }
            });
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo guardar el combo.')], 422);
        }
        return response()->json(['ok' => true]);
    }

    /** PATCH /combos/{id}/estado  ·  DELETE /combos/{id} */
    public function estado(Request $r, int $id)
    {
        $this->soloAdmin();
        $on = (bool) $r->boolean('activo');
        DB::table('combos')->where('id', $id)->update(['activo' => $on]);
        return back();
    }

    public function destroy(int $id)
    {
        $this->soloAdmin();
        try {
            DB::table('combos')->where('id', $id)->delete();
        } catch (QueryException $e) {
            return response()->json(['message' => 'No se pudo eliminar el combo.'], 422);
        }
        return back();
    }

    /** GET /combos/cotizar?id=&cantidad= → totales del kit sin venderlo (la caja lo muestra al agregarlo). */
    public function cotizar(Request $r)
    {
        $id = (int) $r->query('id', 0);
        $cantidad = max(1, (float) $r->query('cantidad', 1));
        try {
            $t = json_decode(DB::scalar('SELECT fn_cotizar_combo(?::bigint, ?::numeric)::text', [$id, $cantidad]), true);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo calcular el combo.')], 422);
        }
        return response()->json($t);
    }

    private function validar(Request $r): array
    {
        $d = $r->validate([
            'sku' => 'required|string|max:40', 'nombre' => 'required|string|min:3|max:200', 'descripcion' => 'nullable|string|max:400',
            'precio' => 'nullable|numeric|min:0|max:9999999999', 'componentes' => 'required|array|min:1|max:50',
            'componentes.*.producto_id' => 'required|integer|distinct', 'componentes.*.cantidad' => 'required|numeric|gt:0|max:999999',
        ], ['sku.required' => 'Escribe un código corto para el kit (KIT-ACE…).', 'nombre.required' => 'Escribe el nombre del kit.',
            'componentes.required' => 'Agrega al menos una pieza al kit.']);
        // D-3 (regresión 16/11): sin precio en el POST la clave no existe y el
        // acceso directo $d['precio'] tumbaba el alta con un 500.
        $d['precio'] = (($d['precio'] ?? null) !== null && ($d['precio'] ?? '') !== '') ? round((float) $d['precio'], 4) : null;
        $d['descripcion'] = trim((string) ($d['descripcion'] ?? ''));
        return $d;
    }

    private function mensaje(QueryException $e, string $porDefecto): string
    {
        if (str_contains($e->getMessage(), 'uq_combos_sku')) {
            return 'Ya existe un combo con ese código.';
        }
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }
}
