<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;

/**
 * Qué repuestos le sirven a cada moto (tabla producto_compatibilidad). Se trabaja moto por moto:
 * es la pregunta natural del mostrador. La vista por producto está en la pestaña «Motos» del panel de productos.
 */
class CompatibilidadController extends Controller
{
    use ContextoPagina;

    public function index(Request $r)
    {
        $modelos = DB::table('motos_modelos as m')->leftJoin('producto_compatibilidad as pc', 'pc.moto_modelo_id', '=', 'm.id')
            ->groupBy('m.id')->orderBy('m.marca')->orderBy('m.modelo')->selectRaw('m.id, m.marca, m.modelo, m.cilindrada, count(pc.producto_id) AS productos')->get()
            ->map(fn ($m) => ['id' => $m->id, 'marca' => $m->marca, 'modelo' => $m->modelo, 'cilindrada' => $m->cilindrada, 'productos' => (int) $m->productos]);

        $seleccion = null;
        if ($r->filled('moto') && ($moto = $modelos->firstWhere('id', (int) $r->moto))) {
            $seleccion = ['moto' => $moto, 'productos' => DB::table('producto_compatibilidad as pc')->join('productos as p', 'p.id', '=', 'pc.producto_id')->leftJoin('categorias as c', 'c.id', '=', 'p.categoria_id')
                ->where('pc.moto_modelo_id', $moto['id'])->where('p.activo', true)->orderBy('p.nombre')
                ->get(['p.id', 'p.sku', 'p.nombre', 'c.nombre as categoria', 'pc.anio_desde', 'pc.anio_hasta', 'p.stock_actual', 'p.stock_minimo'])
                ->map(fn ($p) => ['id' => $p->id, 'sku' => $p->sku, 'nombre' => $p->nombre, 'categoria' => $p->categoria ?? 'Sin categoría', 'desde' => $p->anio_desde, 'hasta' => $p->anio_hasta,
                    'stock' => (float) $p->stock_actual, 'minimo' => (float) $p->stock_minimo])];
        }
        return Inertia::render('Compatibilidad/Index', $this->contexto() + ['modelos' => $modelos, 'seleccion' => $seleccion]);
    }

    /** Repuestos activos que aún no le sirven a esta moto. Primero los que ya sirven a otros modelos de la misma marca. */
    public function candidatos(Request $r, int $moto)
    {
        $m = DB::table('motos_modelos')->find($moto) ?? abort(404);
        $q = DB::table('productos as p')->leftJoin('categorias as c', 'c.id', '=', 'p.categoria_id')->where('p.activo', true)
            ->whereNotExists(fn ($s) => $s->select(DB::raw(1))->from('producto_compatibilidad as x')->whereColumn('x.producto_id', 'p.id')->where('x.moto_modelo_id', $moto))
            ->selectRaw("p.id, p.sku, p.nombre, COALESCE(c.nombre, 'Sin categoría') AS categoria,
                (SELECT mm.modelo FROM producto_compatibilidad pc JOIN motos_modelos mm ON mm.id = pc.moto_modelo_id
                  WHERE pc.producto_id = p.id AND mm.marca = ? ORDER BY mm.modelo LIMIT 1) AS sugerido", [$m->marca]);
        foreach (preg_split('/\s+/', trim($r->input('q', '')), -1, PREG_SPLIT_NO_EMPTY) as $w) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $w) . '%';
            $q->where(fn ($s) => $s->whereRaw('unaccent(p.nombre) ILIKE unaccent(?)', [$like])->orWhere('p.sku', 'ILIKE', $like)->orWhere('p.referencia_fabricante', 'ILIKE', $like));
        }
        return response()->json($q->orderByRaw("(SELECT mm.modelo FROM producto_compatibilidad pc JOIN motos_modelos mm ON mm.id = pc.moto_modelo_id WHERE pc.producto_id = p.id AND mm.marca = ?) IS NULL, p.nombre", [$m->marca])->limit(60)->get()->map(fn ($p) => ['id' => $p->id, 'sku' => $p->sku, 'nombre' => $p->nombre, 'categoria' => $p->categoria, 'sugerido' => $p->sugerido ? "{$m->marca} {$p->sugerido}" : null]));
    }

    public function agregar(Request $r, int $moto)
    {
        $d = $r->validate(['producto_ids' => 'required|array|min:1', 'producto_ids.*' => 'integer|exists:productos,id', ...$this->anios()], ['producto_ids.required' => 'Marca al menos un repuesto.']);
        $this->validarAnios($d);
        $filas = collect($d['producto_ids'])->unique()->map(fn ($id) => ['producto_id' => $id, 'moto_modelo_id' => $moto, 'anio_desde' => $d['anio_desde'] ?? null, 'anio_hasta' => $d['anio_hasta'] ?? null])->all();
        DB::table('producto_compatibilidad')->upsert($filas, ['producto_id', 'moto_modelo_id'], ['anio_desde', 'anio_hasta']);
        return back()->with('ok', count($filas) . (count($filas) === 1 ? ' repuesto agregado.' : ' repuestos agregados.'));
    }

    public function anio(Request $r, int $moto, int $producto)
    {
        $d = $r->validate($this->anios());
        $this->validarAnios($d);
        DB::table('producto_compatibilidad')->where(['moto_modelo_id' => $moto, 'producto_id' => $producto])->update(['anio_desde' => $d['anio_desde'] ?? null, 'anio_hasta' => $d['anio_hasta'] ?? null]);
        return back()->with('ok', 'Años guardados.');
    }

    public function quitar(Request $r, int $moto)
    {
        $ids = $r->validate(['producto_ids' => 'required|array|min:1', 'producto_ids.*' => 'integer'])['producto_ids'];
        $n = DB::table('producto_compatibilidad')->where('moto_modelo_id', $moto)->whereIn('producto_id', $ids)->delete();
        return back()->with('ok', $n === 1 ? 'Repuesto quitado de esta moto.' : "{$n} repuestos quitados de esta moto.");
    }

    /** Copia la compatibilidad de otra moto (con sus años). Lo que ya existe no se toca. */
    public function copiar(Request $r, int $moto)
    {
        $o = $r->validate(['desde_moto' => 'required|integer|exists:motos_modelos,id'])['desde_moto'];
        if ($o === $moto) throw ValidationException::withMessages(['desde_moto' => 'Elige otra moto.']);
        $n = DB::affectingStatement('INSERT INTO producto_compatibilidad (producto_id, moto_modelo_id, anio_desde, anio_hasta)
            SELECT producto_id, ?, anio_desde, anio_hasta FROM producto_compatibilidad WHERE moto_modelo_id = ? ON CONFLICT (producto_id, moto_modelo_id) DO NOTHING', [$moto, $o]);
        return back()->with('ok', $n === 0 ? 'No había repuestos nuevos para copiar.' : "{$n} repuestos copiados.");
    }

    private function anios(): array
    {
        return ['anio_desde' => 'nullable|integer|between:1950,2100', 'anio_hasta' => 'nullable|integer|between:1950,2100'];
    }

    private function validarAnios(array $d): void
    {
        if (isset($d['anio_desde'], $d['anio_hasta']) && $d['anio_hasta'] < $d['anio_desde'])
            throw ValidationException::withMessages(['anio_hasta' => 'El año final no puede ser menor que el inicial.']);
    }
}
