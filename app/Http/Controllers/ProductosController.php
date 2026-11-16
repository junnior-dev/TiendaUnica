<?php

namespace App\Http\Controllers;

use App\Support\Ean13;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Throwable;

/**
 * Módulo de productos. El precio lo calcula el esquema (costo × margen) y el stock solo cambia por el kardex:
 * aquí se usan fn_calcular_precio_usd, fn_margen_para y sp_ajustar_stock, nunca se escribe stock_actual.
 */
class ProductosController extends Controller
{
    use ContextoPagina;

    private const POR_PAGINA = 12;

    public function index(Request $r)
    {
        $f = $r->only(['q', 'estado', 'categoria', 'marca', 'moto', 'pagina']);
        $q = DB::table('v_productos_precios as v')->leftJoin('productos as p', 'p.id', '=', 'v.id')
            ->leftJoin('alertas_precio as a', fn ($j) => $j->on('a.producto_id', '=', 'v.id')->where('a.estado', 'PENDIENTE'));

        match ($f['estado'] ?? 'todos') {
            'inactivos' => $q->where('v.activo', false),
            'bajo' => $q->where('v.activo', true)->whereColumn('v.stock_actual', '<=', 'v.stock_minimo'),
            'sin_stock' => $q->where('v.activo', true)->where('v.stock_actual', '<=', 0),
            'por_confirmar' => $q->where('v.activo', true)->whereNotNull('a.id'),
            default => $q->where('v.activo', true),
        };
        if (! empty($f['categoria'])) $q->where('p.categoria_id', $f['categoria']);
        if (! empty($f['marca'])) $q->where('p.marca_id', $f['marca']);
        if (! empty($f['moto'])) $q->whereExists(fn ($s) => $s->select(DB::raw(1))->from('producto_compatibilidad as pc')->whereColumn('pc.producto_id', 'v.id')->where('pc.moto_modelo_id', $f['moto']));
        // Cada palabra debe aparecer en el nombre, SKU, barras, referencia, marca, categoría o en alguna moto compatible.
        foreach (preg_split('/\s+/', trim($f['q'] ?? ''), -1, PREG_SPLIT_NO_EMPTY) as $w) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $w) . '%';
            $q->where(fn ($s) => $s->whereRaw('unaccent(v.nombre) ILIKE unaccent(?)', [$like])->orWhere('v.sku', 'ILIKE', $like)->orWhere('v.codigo_barras', 'ILIKE', $like)
                ->orWhere('v.referencia_fabricante', 'ILIKE', $like)->orWhereRaw('unaccent(v.marca) ILIKE unaccent(?)', [$like])->orWhereRaw('unaccent(v.categoria) ILIKE unaccent(?)', [$like])
                ->orWhereExists(fn ($c) => $c->select(DB::raw(1))->from('v_compatibilidad as vc')->whereColumn('vc.producto_id', 'v.id')
                    ->whereRaw("unaccent(vc.marca || ' ' || vc.modelo) ILIKE unaccent(?)", [$like])));
        }

        $pag = $q->orderBy('v.nombre')->select(['v.*', 'a.id as alerta_id', DB::raw('(SELECT count(*) FROM producto_compatibilidad x WHERE x.producto_id = v.id) AS motos')])
            ->paginate(self::POR_PAGINA, ['*'], 'pagina');

        $tasa = (float) DB::table('v_tasa_actual')->value('tasa');
        $neg = DB::table('negocio')->first();
        $kpi = DB::selectOne("SELECT count(*) FILTER (WHERE activo) AS activos,
                COALESCE(sum(stock_actual * costo_usd) FILTER (WHERE activo AND stock_actual > 0), 0) AS valor_costo,
                COALESCE(sum(stock_actual * precio_venta_usd) FILTER (WHERE activo AND stock_actual > 0), 0) AS valor_venta,
                count(*) FILTER (WHERE activo AND stock_actual <= stock_minimo) AS stock_bajo, count(*) FILTER (WHERE activo AND stock_actual <= 0) AS sin_stock FROM productos");
        $alertas = DB::table('v_alertas_precio_pendientes')->get()->map(fn ($a) => [
            'id' => $a->alerta_id, 'producto_id' => $a->producto_id, 'sku' => $a->sku, 'nombre' => $a->nombre, 'costo' => (float) $a->costo_actual_usd,
            'precio_actual' => (float) $a->precio_actual_usd, 'precio_sugerido' => (float) $a->precio_sugerido_usd, 'variacion_pct' => (float) $a->variacion_pct]);

        return Inertia::render('Productos/Index', [
            ...$this->contexto(), 'tasa_usd' => $tasa, 'iva_pct' => (float) DB::scalar('SELECT fn_iva_pct()'), 'margen_defecto' => (float) $neg->margen_defecto_pct,
            'kpis' => ['activos' => (int) $kpi->activos, 'valor_costo' => round($kpi->valor_costo, 2), 'valor_venta' => round($kpi->valor_venta, 2), 'stock_bajo' => (int) $kpi->stock_bajo,
                'sin_stock' => (int) $kpi->sin_stock, 'precios_pendientes' => $alertas->count()],
            'catalogo' => [
                'unidades' => DB::table('unidades_medida')->where('activa', true)->orderBy('codigo')->get(['codigo', 'nombre', 'permite_fraccion']),
                'categorias' => DB::table('categorias')->orderBy('nombre')->get(['id', 'nombre', 'margen_pct', 'activa']),
                'marcas' => DB::table('marcas')->orderBy('nombre')->get(['id', 'nombre', 'activa']),
                'motos' => DB::table('motos_modelos')->orderBy('marca')->orderBy('modelo')->get()->map(fn ($m) => ['id' => $m->id, 'marca' => $m->marca, 'modelo' => $m->modelo, 'cc' => $m->cilindrada, 'etiqueta' => "{$m->marca} {$m->modelo}"]),
            ],
            'filtros' => array_filter($f, fn ($v) => $v !== null && $v !== ''),
            'filas' => $pag->getCollection()->map(fn ($p) => [
                'id' => $p->id, 'sku' => $p->sku, 'referencia' => $p->referencia_fabricante, 'nombre' => $p->nombre, 'categoria' => $p->categoria, 'marca' => $p->marca, 'unidad' => $p->unidad,
                'ubicacion' => $p->ubicacion_almacen, 'stock' => (float) $p->stock_actual, 'minimo' => (float) $p->stock_minimo, 'costo' => (float) $p->costo_usd, 'margen' => (float) $p->margen_pct,
                'precio' => (float) $p->precio_venta_usd, 'precio_ves' => (float) $p->precio_venta_ves, 'exento' => (bool) $p->exento_iva, 'activo' => (bool) $p->activo,
                'por_confirmar' => $p->alerta_id !== null, 'motos' => (int) $p->motos]),
            'meta' => ['total' => $pag->total(), 'pagina' => $pag->currentPage(), 'paginas' => $pag->lastPage(), 'desde' => $pag->firstItem() ?? 0, 'hasta' => $pag->lastItem() ?? 0],
            'alertas' => $alertas,
        ]);
    }

    /** JSON con todo lo del producto: se pide al abrir el panel, así el listado se mantiene liviano. */
    public function show(int $id)
    {
        $p = DB::table('productos')->find($id) ?? abort(404);
        $alerta = DB::table('alertas_precio')->where(['producto_id' => $id, 'estado' => 'PENDIENTE'])->first();
        return response()->json([
            'id' => $p->id, 'sku' => $p->sku, 'codigo_barras' => $p->codigo_barras, 'referencia' => $p->referencia_fabricante, 'nombre' => $p->nombre, 'descripcion' => $p->descripcion,
            'categoria_id' => $p->categoria_id, 'marca_id' => $p->marca_id, 'unidad' => $p->unidad, 'unidad_compra' => $p->unidad_compra, 'piezas_por_presentacion' => (float) $p->piezas_por_presentacion, 'ubicacion' => $p->ubicacion_almacen, 'costo' => (float) $p->costo_usd,
            'margen_pct' => $p->margen_pct !== null ? (float) $p->margen_pct : null, 'precio' => (float) $p->precio_venta_usd, 'exento' => (bool) $p->exento_iva, 'exonerado' => (bool) $p->exonerado_iva,
            'stock' => (float) $p->stock_actual, 'minimo' => (float) $p->stock_minimo, 'activo' => (bool) $p->activo,
            'por_confirmar' => (bool) $alerta, 'sugerido' => $alerta ? (float) $alerta->precio_sugerido_usd : null,
            'presentaciones' => DB::table('producto_presentaciones')->where(['producto_id' => $id, 'activa' => true])->orderBy('factor')->get()
                ->map(fn ($x) => ['id' => $x->id, 'codigo' => $x->codigo, 'nombre' => $x->nombre, 'factor' => (float) $x->factor, 'precio' => $x->precio_usd !== null ? (float) $x->precio_usd : null, 'barras' => $x->codigo_barras]),
            'compat' => DB::table('producto_compatibilidad')->where('producto_id', $id)->get()->map(fn ($c) => ['moto_id' => $c->moto_modelo_id, 'desde' => $c->anio_desde, 'hasta' => $c->anio_hasta]),
            'historial_precios' => DB::table('historial_precios')->where('producto_id', $id)->orderByDesc('fecha')->limit(8)->get()
                ->map(fn ($h) => ['fecha' => substr($h->fecha, 0, 10), 'anterior' => (float) $h->precio_anterior_usd, 'nuevo' => (float) $h->precio_nuevo_usd, 'motivo' => $h->motivo]),
            'kardex' => DB::table('movimientos_inventario')->where('producto_id', $id)->orderByDesc('fecha')->limit(10)->get()
                ->map(fn ($k) => ['fecha' => substr($k->fecha, 0, 10), 'tipo' => $k->tipo, 'cantidad' => (float) $k->cantidad, 'resultante' => (float) $k->stock_resultante]),
        ]);
    }

    public function store(Request $r)
    {
        $d = $this->validar($r);
        try {
            DB::transaction(function () use ($d, $r) {
                $this->sesion();
                $sinIva = $d['exento'] || $d['exonerado'];
                $precio = $d['precio'] ?? ($d['costo'] > 0 ? DB::scalar('SELECT fn_calcular_precio_usd(?, fn_margen_para(?, ?), ?)', [$d['costo'], $d['margen_pct'], $d['categoria_id'], $sinIva]) : 0);
                $id = DB::table('productos')->insertGetId($this->fila($d) + ['costo_usd' => $d['costo'], 'precio_venta_usd' => $precio, 'stock_actual' => 0]);
                $this->compatibilidad($id, $d['compat'] ?? []);
                if (($d['stock_inicial'] ?? 0) > 0) DB::statement('CALL sp_ajustar_stock(?, ?, ?, ?, true)', [$id, $d['stock_inicial'], 'Inventario inicial', auth()->id()]);
            });
        } catch (Throwable $e) { $this->errorBd($e); }
        return redirect('/productos')->with('ok', 'Producto creado.');
    }

    public function update(Request $r, int $id)
    {
        $d = $this->validar($r, $id);
        $act = DB::table('productos')->find($id) ?? abort(404);
        try {
            DB::transaction(function () use ($d, $id, $act) {
                $this->sesion();
                $sinIva = $d['exento'] || $d['exonerado'];
                $margenAntes = $act->margen_pct === null ? null : (float) $act->margen_pct;
                $cambioDeterminante = (float) $act->costo_usd !== (float) $d['costo'] || $margenAntes !== $d['margen_pct']
                    || $act->categoria_id != $d['categoria_id'] || (bool) $act->exento_iva !== $d['exento'] || (bool) $act->exonerado_iva !== $d['exonerado'];
                // Precio a mano → ese. Si cambió costo/margen/categoría/IVA → se recalcula. Si no, se respeta el vigente.
                $precio = $d['precio'] ?? ($cambioDeterminante ? DB::scalar('SELECT fn_calcular_precio_usd(?, fn_margen_para(?, ?), ?)', [$d['costo'], $d['margen_pct'], $d['categoria_id'], $sinIva]) : $act->precio_venta_usd);
                DB::select("SELECT set_config('tienda.motivo_precio', ?, true)", [$d['precio'] !== null ? 'MANUAL' : 'CAMBIO_MARGEN']);
                DB::table('productos')->where('id', $id)->update($this->fila($d) + ['costo_usd' => $d['costo'], 'precio_venta_usd' => $precio, 'activo' => $d['activo'] ?? true]);
                DB::select("SELECT set_config('tienda.motivo_precio', '', true)");
                $this->compatibilidad($id, $d['compat'] ?? []);
            });
        } catch (Throwable $e) { $this->errorBd($e); }
        return back()->with('ok', 'Cambios guardados.');
    }

    /** Ajuste manual de existencias: pasa por el kardex (sp_ajustar_stock). */
    public function ajustar(Request $r, int $id)
    {
        $d = $r->validate(['cantidad' => 'required|numeric|not_in:0', 'motivo' => 'required|string|min:3|max:200']);
        try { DB::statement('CALL sp_ajustar_stock(?, ?, ?, ?, false)', [$id, $d['cantidad'], $d['motivo'], auth()->id()]); }
        catch (Throwable $e) { throw ValidationException::withMessages(['ajuste' => $this->mensaje($e)]); }
        return back();
    }

    /** Presentaciones de venta (caja × 12, juego…): crear o editar. El precio vacío = precio de la pieza × piezas. */
    public function guardarPresentacion(Request $r, int $id)
    {
        $d = $r->validate(['nombre' => 'required|string|min:2|max:60', 'codigo' => 'required|string|max:10', 'factor' => 'required|numeric|gt:0',
            'precio' => 'nullable|numeric|gt:0', 'barras' => 'nullable|string|max:40', 'presentacion_id' => 'nullable|integer']);
        try {
            DB::scalar('SELECT fn_presentacion_guardar(?::bigint, ?::text, ?::text, ?::numeric, ?::numeric, ?::text, ?::bigint)',
                [$id, $d['codigo'], $d['nombre'], $d['factor'], $d['precio'] ?? null, $d['barras'] ?? null, $d['presentacion_id'] ?? null]);
        } catch (Throwable $e) {
            throw ValidationException::withMessages(['presentacion' => $this->mensaje($e)]);
        }
        return back();
    }

    /** No se borra (las ventas ya hechas la referencian): se desactiva. */
    public function quitarPresentacion(int $id, int $presentacion)
    {
        try {
            DB::statement('SELECT fn_presentacion_desactivar(?)', [$presentacion]);
        } catch (Throwable $e) {
            throw ValidationException::withMessages(['presentacion' => $this->mensaje($e)]);
        }
        return back();
    }

    public function resolverAlerta(Request $r, int $alerta)
    {
        $accion = $r->validate(['accion' => 'required|in:APLICAR,DESCARTAR'])['accion'];
        DB::statement('CALL sp_resolver_alerta_precio(?, ?, ?)', [$alerta, $accion, auth()->id()]);
        return back();
    }

    public function aplicarTodas()
    {
        DB::statement('CALL sp_aplicar_alertas_pendientes(?)', [auth()->id()]);
        return back()->with('ok', 'Precios actualizados.');
    }

    // ─── Etiquetas con código de barras (SQL base 01: productos.codigo_barras ya existe) ───

    /** Fila para el generador de etiquetas: precio final (con IVA si lo causa), igual que cobra el POS. */
    private function filaEtiqueta(object $p): array
    {
        $barras = trim((string) ($p->codigo_barras ?? ''));
        return ['id' => (int) $p->id, 'sku' => $p->sku, 'barras' => $barras !== '' ? $barras : null,
            'ean' => Ean13::valido($barras) ? $barras : null, 'nombre' => $p->nombre, 'marca' => $p->marca,
            'ubicacion' => $p->ubicacion_almacen, 'precio_usd' => (float) $p->precio_final_usd, 'precio_ves' => (float) $p->precio_final_ves];
    }

    private function idsEtiquetas(Request $r): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', (array) $r->input('ids', [])), fn ($v) => $v > 0)));
        if (! $ids || count($ids) > 500) {
            throw ValidationException::withMessages(['ids' => 'Selecciona entre 1 y 500 productos para las etiquetas.']);
        }
        return $ids;
    }

    /** POST /productos/etiquetas {ids:[…]} → datos para imprimir etiquetas (nombre, EAN, precio Bs/US$). */
    public function etiquetas(Request $r)
    {
        $filas = DB::select('SELECT id, sku, codigo_barras, nombre, marca, ubicacion_almacen, precio_final_usd, precio_final_ves
                               FROM v_productos_precios WHERE id = ANY(?::bigint[]) ORDER BY nombre', ['{' . implode(',', $this->idsEtiquetas($r)) . '}']);
        return response()->json(['productos' => array_map(fn ($p) => $this->filaEtiqueta($p), $filas)]);
    }

    /** POST /productos/barcodes {ids:[…]} → asigna un EAN-13 interno a los seleccionados sin código de barras y devuelve las etiquetas al día. */
    public function barcodes(Request $r)
    {
        $asignados = 0;
        foreach ($this->idsEtiquetas($r) as $id) {
            $asignados += DB::affectingStatement("UPDATE productos SET codigo_barras = ? WHERE id = ? AND (codigo_barras IS NULL OR codigo_barras = '')", [Ean13::codigoProducto($id), $id]);
        }
        return response()->json($this->etiquetas($r)->getData(true) + ['asignados' => $asignados]);
    }

    // ─────────────────────────────────────────────────────────────────────────

    private function validar(Request $r, ?int $id = null): array
    {
        $num = fn ($v) => $v === null || $v === '' ? null : (float) $v;
        $d = $r->validate([
            'sku' => 'required|string|max:40', 'codigo_barras' => 'nullable|string|max:40', 'referencia' => 'nullable|string|max:60', 'nombre' => 'required|string|max:200', 'descripcion' => 'nullable|string',
            'categoria_id' => 'nullable|exists:categorias,id', 'marca_id' => 'nullable|exists:marcas,id', 'unidad' => 'required|string|max:10', 'ubicacion' => 'nullable|string|max:60',
            'unidad_compra' => 'nullable|string|max:10', 'piezas_por_presentacion' => 'nullable|numeric|min:0.001|max:9999999',
            'costo' => 'required|numeric|min:0', 'margen_pct' => 'nullable|numeric|min:0|max:1000', 'precio' => 'nullable|numeric|min:0', 'exento' => 'boolean', 'exonerado' => 'boolean',
            'minimo' => 'nullable|numeric|min:0', 'stock_inicial' => 'nullable|numeric|min:0', 'activo' => 'boolean', 'compat' => 'array',
            'compat.*.moto_id' => 'required|exists:motos_modelos,id', 'compat.*.desde' => 'nullable|integer|between:1950,2100', 'compat.*.hasta' => 'nullable|integer|between:1950,2100',
        ], ['sku.required' => 'Cada producto necesita un SKU único.', 'nombre.required' => 'Escribe cómo se llama el repuesto.']);
        // Unicidad sin distinguir mayúsculas, igual que el índice uq_productos_sku.
        $dup = DB::table('productos')->whereRaw('upper(sku) = upper(?)', [$d['sku']])->when($id, fn ($q) => $q->where('id', '!=', $id))->exists();
        if ($dup) throw ValidationException::withMessages(['sku' => 'Ya existe un producto con ese SKU.']);
        if (! empty($d['codigo_barras']) && DB::table('productos')->where('codigo_barras', $d['codigo_barras'])->when($id, fn ($q) => $q->where('id', '!=', $id))->exists())
            throw ValidationException::withMessages(['codigo_barras' => 'Ese código de barras ya pertenece a otro producto.']);
        // Unidades contra el catálogo (tabla unidades_medida, archivo 23): unidad de venta y de compra.
        $uc = DB::table('unidades_medida')->where('activa', true)->pluck('codigo')->map(fn ($c) => strtoupper(trim($c)))->all();
        $d['unidad'] = strtoupper(trim($d['unidad']));
        if (! in_array($d['unidad'], $uc, true)) throw ValidationException::withMessages(['unidad' => 'La unidad de venta no está en el catálogo de unidades.']);
        $d['unidad_compra'] = $d['unidad_compra'] ?? null;
        if ($d['unidad_compra']) {
            $d['unidad_compra'] = strtoupper(trim($d['unidad_compra']));
            if (! in_array($d['unidad_compra'], $uc, true)) throw ValidationException::withMessages(['unidad_compra' => 'La unidad de compra no está en el catálogo de unidades.']);
            if ($d['unidad_compra'] === $d['unidad']) $d['unidad_compra'] = null;
        }
        $d['piezas_por_presentacion'] = $d['unidad_compra'] ? max(1, $num($d['piezas_por_presentacion'] ?? null) ?? 1) : 1;
        $d['exento'] = (bool) ($d['exento'] ?? false); $d['exonerado'] = (bool) ($d['exonerado'] ?? false);
        $d['margen_pct'] = $num($d['margen_pct'] ?? null); $d['precio'] = $num($d['precio'] ?? null); $d['categoria_id'] = $d['categoria_id'] ?? null;
        return $d;
    }

    private function fila(array $d): array
    {
        return ['sku' => strtoupper(trim($d['sku'])), 'codigo_barras' => $d['codigo_barras'] ?: null, 'referencia_fabricante' => $d['referencia'] ?: null, 'nombre' => trim($d['nombre']),
            'descripcion' => $d['descripcion'] ?: null, 'categoria_id' => $d['categoria_id'], 'marca_id' => $d['marca_id'] ?? null, 'unidad' => $d['unidad'], 'unidad_compra' => $d['unidad_compra'], 'piezas_por_presentacion' => $d['piezas_por_presentacion'], 'ubicacion_almacen' => $d['ubicacion'] ?: null,
            'margen_pct' => $d['margen_pct'], 'exento_iva' => $d['exento'], 'exonerado_iva' => $d['exonerado'], 'stock_minimo' => $d['minimo'] ?? 0];
    }

    private function compatibilidad(int $id, array $lista): void
    {
        DB::table('producto_compatibilidad')->where('producto_id', $id)->delete();
        foreach (collect($lista)->unique('moto_id') as $c)
            DB::table('producto_compatibilidad')->insert(['producto_id' => $id, 'moto_modelo_id' => $c['moto_id'], 'anio_desde' => $c['desde'] ?? null, 'anio_hasta' => $c['hasta'] ?? null]);
    }

    /** Para que historial_precios y historial_costos registren quién hizo el cambio. */
    private function sesion(): void
    {
        DB::select("SELECT set_config('tienda.usuario_id', ?, true)", [(string) auth()->id()]);
    }

    private function mensaje(Throwable $e): string
    {
        // Los errores del esquema (TV00x) ya vienen redactados para el usuario.
        return preg_match('/ERROR:\s*(.+?)(\n|CONTEXT|$)/s', $e->getMessage(), $m) ? trim($m[1]) : 'No se pudo completar la operación.';
    }

    private function errorBd(Throwable $e): never
    {
        throw ValidationException::withMessages(['nombre' => $this->mensaje($e)]);
    }
}
