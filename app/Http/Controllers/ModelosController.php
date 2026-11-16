<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;

/**
 * Modelos de moto. La tabla no tiene «activa»: eliminar un modelo quita su compatibilidad (ON DELETE CASCADE),
 * por eso la pantalla avisa cuántos repuestos se ven afectados antes de borrar. Los productos nunca se borran.
 */
class ModelosController extends Controller
{
    use ContextoPagina;

    public function index()
    {
        $filas = DB::table('motos_modelos as m')->leftJoin('producto_compatibilidad as pc', 'pc.moto_modelo_id', '=', 'm.id')
            ->groupBy('m.id')->orderBy('m.marca')->orderBy('m.modelo')->selectRaw('m.id, m.marca, m.modelo, m.cilindrada, count(pc.producto_id) AS productos')->get();
        return Inertia::render('Modelos/Index', $this->contexto() + [
            'modelos' => $filas->map(fn ($m) => ['id' => $m->id, 'marca' => $m->marca, 'modelo' => $m->modelo, 'cilindrada' => $m->cilindrada, 'productos' => (int) $m->productos]),
        ]);
    }

    /** JSON para el panel de detalle: categorías que cubre y los primeros repuestos compatibles. */
    public function show(int $id)
    {
        $m = DB::table('motos_modelos')->find($id) ?? abort(404);
        $base = DB::table('producto_compatibilidad as pc')->join('productos as p', 'p.id', '=', 'pc.producto_id')->leftJoin('categorias as c', 'c.id', '=', 'p.categoria_id')
            ->where('pc.moto_modelo_id', $id)->where('p.activo', true);
        return response()->json([
            'id' => $m->id, 'total' => (clone $base)->count(),
            'categorias' => (clone $base)->groupBy('c.nombre')->orderByRaw('count(*) DESC')->selectRaw("COALESCE(c.nombre, 'Sin categoría') AS nombre, count(*) AS n")->get()->map(fn ($c) => ['nombre' => $c->nombre, 'n' => (int) $c->n]),
            'productos' => (clone $base)->orderBy('p.nombre')->limit(8)->get(['p.id', 'p.sku', 'p.nombre', 'c.nombre as categoria', 'p.stock_actual as stock', 'p.stock_minimo as minimo'])
                ->map(fn ($p) => ['id' => $p->id, 'sku' => $p->sku, 'nombre' => $p->nombre, 'categoria' => $p->categoria ?? 'Sin categoría', 'stock' => (float) $p->stock, 'minimo' => (float) $p->minimo]),
        ]);
    }

    /** Corrige o unifica el nombre de una marca de moto en todos sus modelos. */
    public function renombrarMarca(Request $r)
    {
        $d = $r->validate(['actual' => 'required|string|max:60', 'nuevo' => 'required|string|max:60'], ['nuevo.required' => 'Escribe el nombre nuevo.']);
        $nuevo = trim($d['nuevo']);
        // Si el nombre nuevo ya existe (p. ej. unificar «Empire» con «Empire Keeway»), no puede quedar un modelo repetido.
        $choque = DB::table('motos_modelos as a')->join('motos_modelos as b', fn ($j) => $j->whereRaw('lower(a.modelo) = lower(b.modelo)')->whereRaw('a.cilindrada IS NOT DISTINCT FROM b.cilindrada'))
            ->where('a.marca', $d['actual'])->whereRaw('lower(b.marca) = lower(?)', [$nuevo])->where('a.id', '!=', DB::raw('b.id'))->exists();
        if ($choque) throw ValidationException::withMessages(['nuevo' => 'Esa marca ya tiene un modelo con el mismo nombre. Elimina o renombra el repetido primero.']);
        DB::table('motos_modelos')->where('marca', $d['actual'])->update(['marca' => $nuevo]);
        return back()->with('ok', 'Marca renombrada.');
    }

    public function store(Request $r)
    {
        DB::table('motos_modelos')->insert($this->datos($r));
        return back()->with('ok', 'Modelo creado.');
    }

    public function update(Request $r, int $id)
    {
        DB::table('motos_modelos')->where('id', $id)->update($this->datos($r, $id));
        return back()->with('ok', 'Modelo guardado.');
    }

    public function destroy(int $id)
    {
        DB::table('motos_modelos')->where('id', $id)->delete();
        return back()->with('ok', 'Modelo eliminado.');
    }

    private function datos(Request $r, ?int $id = null): array
    {
        $d = $r->validate(['marca' => 'required|string|max:60', 'modelo' => 'required|string|max:80', 'cilindrada' => 'nullable|integer|min:1|max:32000'],
            ['marca.required' => 'Escribe la marca de la moto.', 'modelo.required' => 'Escribe el modelo.', 'cilindrada.integer' => 'Usa un número entero, por ejemplo 150.']);
        $marca = trim($d['marca']);
        // Si ya existe esa marca con otra escritura («honda»/«Honda»), se reutiliza la existente para no partir el listado.
        $marca = DB::table('motos_modelos')->whereRaw('lower(marca) = lower(?)', [$marca])->value('marca') ?? $marca;
        $modelo = trim($d['modelo']); $cc = $d['cilindrada'] ?? null;
        // UNIQUE (marca, modelo, cilindrada) no detecta duplicados cuando la cilindrada es NULL: se valida aquí.
        $dup = DB::table('motos_modelos')->where('marca', $marca)->whereRaw('lower(modelo) = lower(?)', [$modelo])
            ->when($cc === null, fn ($q) => $q->whereNull('cilindrada'), fn ($q) => $q->where('cilindrada', $cc))->when($id, fn ($q) => $q->where('id', '!=', $id))->exists();
        if ($dup) throw ValidationException::withMessages(['modelo' => 'Ese modelo ya está registrado.']);
        return ['marca' => $marca, 'modelo' => $modelo, 'cilindrada' => $cc];
    }
}
