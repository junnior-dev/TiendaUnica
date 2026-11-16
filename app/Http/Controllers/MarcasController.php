<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;

/** Marcas = fabricante del repuesto (NGK, Bendix…). Las marcas de moto viven en motos_modelos. */
class MarcasController extends Controller
{
    use ContextoPagina;

    public function index()
    {
        $filas = DB::table('marcas as m')->leftJoin('productos as p', fn ($j) => $j->on('p.marca_id', '=', 'm.id')->where('p.activo', true))
            ->groupBy('m.id')->orderBy('m.nombre')->selectRaw('m.id, m.nombre, m.activa, count(p.id) AS productos')->get();
        return Inertia::render('Marcas/Index', $this->contexto() + [
            'marcas' => $filas->map(fn ($m) => ['id' => $m->id, 'nombre' => $m->nombre, 'activa' => (bool) $m->activa, 'productos' => (int) $m->productos]),
            'sin_marca' => DB::table('productos')->where('activo', true)->whereNull('marca_id')->count(),
        ]);
    }

    public function store(Request $r)
    {
        DB::table('marcas')->insert(['nombre' => $this->nombre($r)]);
        return back()->with('ok', 'Marca creada.');
    }

    public function update(Request $r, int $id)
    {
        DB::table('marcas')->where('id', $id)->update(['nombre' => $this->nombre($r, $id)]);
        return back()->with('ok', 'Marca guardada.');
    }

    public function estado(Request $r, int $id)
    {
        DB::table('marcas')->where('id', $id)->update(['activa' => $r->boolean('activa')]);
        return back()->with('ok', $r->boolean('activa') ? 'Marca activada.' : 'Marca desactivada.');
    }

    public function destroy(int $id)
    {
        if (DB::table('productos')->where('marca_id', $id)->exists())
            throw ValidationException::withMessages(['nombre' => 'Esta marca tiene productos. Desactívala en lugar de eliminarla.']);
        DB::table('marcas')->where('id', $id)->delete();
        return back()->with('ok', 'Marca eliminada.');
    }

    private function nombre(Request $r, ?int $id = null): string
    {
        $n = trim($r->validate(['nombre' => 'required|string|max:100'], ['nombre.required' => 'Escribe el nombre de la marca.'])['nombre']);
        if (DB::table('marcas')->whereRaw('lower(nombre) = lower(?)', [$n])->when($id, fn ($q) => $q->where('id', '!=', $id))->exists())
            throw ValidationException::withMessages(['nombre' => 'Ya tienes una marca con ese nombre.']);
        return $n;
    }
}
