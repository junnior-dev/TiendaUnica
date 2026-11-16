<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;

/**
 * Categorías de repuestos. El margen de una categoría solo se usa cuando el producto no tiene el suyo (fn_margen_para);
 * cambiarlo NO toca los precios ya guardados: para eso está «recalcular» (sp_recalcular_precios).
 */
class CategoriasController extends Controller
{
    use ContextoPagina;

    public function index()
    {
        $filas = DB::table('categorias as c')->leftJoin('productos as p', fn ($j) => $j->on('p.categoria_id', '=', 'c.id')->where('p.activo', true))
            ->groupBy('c.id')->orderBy('c.nombre')
            ->selectRaw('c.id, c.nombre, c.margen_pct, c.activa, count(p.id) AS productos, COALESCE(sum(p.stock_actual * p.precio_venta_usd) FILTER (WHERE p.stock_actual > 0), 0) AS valor_venta')->get();
        return Inertia::render('Categorias/Index', $this->contexto() + [
            'margen_negocio' => (float) DB::table('negocio')->value('margen_defecto_pct'),
            'categorias' => $filas->map(fn ($c) => ['id' => $c->id, 'nombre' => $c->nombre, 'margen_pct' => $c->margen_pct !== null ? (float) $c->margen_pct : null,
                'activa' => (bool) $c->activa, 'productos' => (int) $c->productos, 'valor_venta' => round((float) $c->valor_venta, 2)]),
            'sin_categoria' => DB::table('productos')->where('activo', true)->whereNull('categoria_id')->count(),
        ]);
    }

    public function store(Request $r)
    {
        $d = $this->validar($r);
        DB::table('categorias')->insert($d);
        return back()->with('ok', 'Categoría creada.');
    }

    public function update(Request $r, int $id)
    {
        $d = $this->validar($r, $id);
        DB::table('categorias')->where('id', $id)->update($d);
        return back()->with('ok', 'Categoría guardada. Si cambiaste el margen, recalcula los precios para aplicarlo.');
    }

    public function estado(Request $r, int $id)
    {
        DB::table('categorias')->where('id', $id)->update(['activa' => $r->boolean('activa')]);
        return back()->with('ok', $r->boolean('activa') ? 'Categoría activada.' : 'Categoría desactivada.');
    }

    /** Solo si ningún producto (activo o no) la usa: la clave foránea no tiene ON DELETE. */
    public function destroy(int $id)
    {
        if (DB::table('productos')->where('categoria_id', $id)->exists())
            throw ValidationException::withMessages(['nombre' => 'Esta categoría tiene productos. Desactívala en lugar de eliminarla.']);
        DB::table('categorias')->where('id', $id)->delete();
        return back()->with('ok', 'Categoría eliminada.');
    }

    public function recalcular(int $id)
    {
        $n = DB::table('productos')->where('categoria_id', $id)->where('activo', true)->count();
        DB::statement('CALL sp_recalcular_precios(?, ?)', [auth()->id(), $id]);
        return back()->with('ok', "Precios recalculados en {$n} productos.");
    }

    private function validar(Request $r, ?int $id = null): array
    {
        $d = $r->validate(['nombre' => 'required|string|max:100', 'margen_pct' => 'nullable|numeric|min:0|max:1000'], ['nombre.required' => 'Escribe el nombre de la categoría.', 'margen_pct.max' => 'El margen no puede pasar de 1000 %.']);
        // Mismo criterio que el índice uq_categorias_nombre: sin distinguir mayúsculas.
        if (DB::table('categorias')->whereRaw('lower(nombre) = lower(?)', [trim($d['nombre'])])->when($id, fn ($q) => $q->where('id', '!=', $id))->exists())
            throw ValidationException::withMessages(['nombre' => 'Ya tienes una categoría con ese nombre.']);
        return ['nombre' => trim($d['nombre']), 'margen_pct' => $d['margen_pct'] ?? null];
    }
}
