<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Existencias y kardex (/kardex). Solo administradores.
 *   Existencias  → cada producto con su stock, mínimo, estado (agotado / bajo / bien), valor a costo y última entrada y salida
 *   Movimientos  → el kardex completo (movimientos_inventario): quién, cuándo, por qué y qué stock dejó, con filtros
 *   Ficha (JSON) → un producto: evolución del stock, movimientos, rotación de los últimos 30 días y para cuántos días alcanza
 *   Ajustar      → entrada, salida, conteo físico (el sistema calcula la diferencia) o inventario inicial; todo pasa por sp_ajustar_stock
 * El stock solo cambia por el kardex (trigger trg_kardex_aplicar): aquí nunca se actualiza productos.stock_actual.
 * Los métodos de datos son públicos para poder probarlos sin HTTP.
 */
class KardexController extends Controller
{
    use ContextoPagina;

    private const POR_PAGINA = 30;
    private const ESTADOS = ['todos', 'bajo', 'agotado', 'con_stock'];
    private const ORDENES = ['nombre', 'stock', 'valor', 'faltante'];
    private const TZ = 'America/Caracas';

    public function index(Request $r)
    {
        $this->soloAdmin();
        return Inertia::render('Kardex/Index', [...$this->contexto(), ...$this->datosPagina($r->query())]);
    }

    private function soloAdmin(): void
    {
        abort_if(strtoupper((string) (auth()->user()->rol ?? '')) !== 'ADMINISTRADOR', 403, 'Solo un administrador puede consultar el inventario.');
    }

    private function emisor(): array
    {
        $n = DB::selectOne('SELECT razon_social, nombre_comercial, rif, direccion_fiscal, telefono FROM negocio WHERE id = fn_negocio_actual()');
        return ['razon_social' => $n->razon_social ?? '', 'comercial' => $n->nombre_comercial ?? null, 'rif' => $n->rif ?? '', 'direccion' => $n->direccion_fiscal ?? '', 'telefono' => $n->telefono ?? ''];
    }

    private function mensaje(\Throwable $e, string $porDefecto): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }

    /* ───────────── Filtros ───────────── */

    /** @return array{0:string,1:array} WHERE y parámetros de las existencias. */
    private function filtroExistencias(array $q): array
    {
        $texto = trim((string) ($q['q'] ?? ''));
        $estado = in_array($q['estado'] ?? '', self::ESTADOS, true) ? $q['estado'] : 'todos';
        $w = ['p.activo']; $b = [];
        if ($estado === 'bajo') $w[] = 'p.stock_actual > 0 AND p.stock_actual <= p.stock_minimo';
        elseif ($estado === 'agotado') $w[] = 'p.stock_actual <= 0';
        elseif ($estado === 'con_stock') $w[] = 'p.stock_actual > 0';
        if (! empty($q['categoria'])) { $w[] = 'p.categoria_id = ?'; $b[] = (int) $q['categoria']; }
        foreach (preg_split('/\s+/', $texto, -1, PREG_SPLIT_NO_EMPTY) as $x) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $x) . '%';
            $w[] = "(unaccent(p.nombre) ILIKE unaccent(?) OR p.sku ILIKE ? OR COALESCE(p.codigo_barras, '') ILIKE ? OR COALESCE(p.referencia_fabricante, '') ILIKE ? OR unaccent(COALESCE(p.ubicacion_almacen, '')) ILIKE unaccent(?))";
            array_push($b, $like, $like, $like, $like, $like);
        }
        return [implode(' AND ', $w), $b];
    }

    private function ordenExistencias(array $q): string
    {
        $o = in_array($q['orden'] ?? '', self::ORDENES, true) ? $q['orden'] : 'nombre';
        return ['nombre' => 'p.nombre', 'stock' => 'p.stock_actual, p.nombre', 'valor' => '(p.stock_actual * p.costo_usd) DESC, p.nombre', 'faltante' => '(p.stock_minimo - p.stock_actual) DESC, p.nombre'][$o];
    }

    private function periodo(array $q, string $hoy): array
    {
        $ok = fn ($v) => is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) && strtotime($v) !== false;
        $hasta = $ok($q['hasta'] ?? null) ? $q['hasta'] : $hoy;
        $desde = $ok($q['desde'] ?? null) ? $q['desde'] : date('Y-m-d', strtotime($hasta . ' -29 days'));
        return $desde > $hasta ? [$hasta, $desde] : [$desde, $hasta];
    }

    /** @return array{0:string,1:array,2:array} WHERE, parámetros y filtros normalizados de los movimientos. */
    private function filtroMovimientos(array $q, string $hoy): array
    {
        [$desde, $hasta] = $this->periodo($q, $hoy);
        $tipos = ['COMPRA', 'VENTA', 'ANULACION_VENTA', 'ANULACION_COMPRA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'INVENTARIO_INICIAL', 'DEVOLUCION_CLIENTE'];
        $tipo = (string) ($q['tipo'] ?? 'todos');
        if (! in_array($tipo, array_merge(['todos', 'entradas', 'salidas'], $tipos), true)) $tipo = 'todos';
        $w = ["(mi.fecha AT TIME ZONE '" . self::TZ . "')::date BETWEEN ? AND ?"]; $b = [$desde, $hasta];
        if ($tipo === 'entradas') $w[] = 'mi.cantidad > 0'; elseif ($tipo === 'salidas') $w[] = 'mi.cantidad < 0'; elseif ($tipo !== 'todos') { $w[] = 'mi.tipo = ?'; $b[] = $tipo; }
        $producto = ! empty($q['producto']) ? (int) $q['producto'] : null;
        if ($producto) { $w[] = 'mi.producto_id = ?'; $b[] = $producto; }
        $texto = trim((string) ($q['q'] ?? ''));
        foreach (preg_split('/\s+/', $texto, -1, PREG_SPLIT_NO_EMPTY) as $x) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $x) . '%';
            $w[] = '(unaccent(p.nombre) ILIKE unaccent(?) OR p.sku ILIKE ? OR unaccent(COALESCE(mi.motivo, \'\')) ILIKE unaccent(?))';
            array_push($b, $like, $like, $like);
        }
        return [implode(' AND ', $w), $b, ['desde' => $desde, 'hasta' => $hasta, 'tipo' => $tipo, 'producto' => $producto, 'q' => $texto]];
    }

    private const MOV_SQL = "SELECT mi.id, to_char(mi.fecha AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD HH24:MI') AS fecha, mi.producto_id, p.sku, p.nombre, p.unidad, mi.tipo, mi.cantidad, mi.stock_resultante, mi.referencia_tipo, mi.motivo,
                                   u.nombre_completo AS usuario,
                                   CASE mi.referencia_tipo WHEN 'VENTA' THEN 'Venta N.º ' || lpad(v.numero::text, 6, '0') WHEN 'COMPRA' THEN 'Compra ' || c.numero_factura WHEN 'NOTA_CREDITO' THEN 'Nota de crédito ' || n.numero END AS origen
                              FROM movimientos_inventario mi JOIN productos p ON p.id = mi.producto_id
                              LEFT JOIN usuarios u ON u.id = mi.usuario_id
                              LEFT JOIN ventas v ON mi.referencia_tipo = 'VENTA' AND v.id = mi.referencia_id
                              LEFT JOIN compras c ON mi.referencia_tipo = 'COMPRA' AND c.id = mi.referencia_id
                              LEFT JOIN notas_ajuste n ON mi.referencia_tipo = 'NOTA_CREDITO' AND n.id = mi.referencia_id";

    private function movimiento(object $m): array
    {
        return ['id' => (int) $m->id, 'fecha' => $m->fecha, 'producto_id' => (int) $m->producto_id, 'sku' => $m->sku, 'nombre' => $m->nombre, 'unidad' => $m->unidad, 'tipo' => $m->tipo,
            'cantidad' => (float) $m->cantidad, 'stock' => $m->stock_resultante === null ? null : (float) $m->stock_resultante, 'origen' => $m->origen, 'motivo' => $m->motivo, 'usuario' => $m->usuario];
    }

    private function filaExistencia(object $p): array
    {
        $stock = (float) $p->stock_actual; $min = (float) $p->stock_minimo;
        return ['id' => (int) $p->id, 'sku' => $p->sku, 'nombre' => $p->nombre, 'categoria' => $p->categoria, 'marca' => $p->marca, 'unidad' => $p->unidad, 'ubicacion' => $p->ubicacion_almacen,
            'stock' => $stock, 'minimo' => $min, 'costo_usd' => (float) $p->costo_usd, 'valor_usd' => round($stock * (float) $p->costo_usd, 2),
            'estado' => $stock <= 0 ? 'agotado' : ($stock <= $min ? 'bajo' : 'bien'),
            'ult_entrada' => $p->ult_entrada, 'ult_salida' => $p->ult_salida];
    }

    private const EXIST_SQL = "SELECT p.id, p.sku, p.nombre, p.unidad, p.ubicacion_almacen, p.stock_actual, p.stock_minimo, p.costo_usd, c.nombre AS categoria, m.nombre AS marca,
                                      to_char(x.ult_entrada AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD') AS ult_entrada, to_char(x.ult_salida AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD') AS ult_salida
                                 FROM productos p LEFT JOIN categorias c ON c.id = p.categoria_id LEFT JOIN marcas m ON m.id = p.marca_id
                                 LEFT JOIN (SELECT producto_id, max(fecha) FILTER (WHERE cantidad > 0) AS ult_entrada, max(fecha) FILTER (WHERE cantidad < 0) AS ult_salida FROM movimientos_inventario GROUP BY producto_id) x ON x.producto_id = p.id";

    /* ───────────── Datos de la página ───────────── */

    public function datosPagina(array $q): array
    {
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $vista = ($q['vista'] ?? '') === 'movimientos' ? 'movimientos' : 'existencias';
        $pagina = max(1, (int) ($q['pagina'] ?? 1));
        $off = ($pagina - 1) * self::POR_PAGINA;

        $k = DB::selectOne("SELECT COALESCE(sum(stock_actual * costo_usd) FILTER (WHERE stock_actual > 0), 0) AS costo, COALESCE(sum(stock_actual * precio_venta_usd) FILTER (WHERE stock_actual > 0), 0) AS venta,
                                   COALESCE(sum(stock_actual) FILTER (WHERE stock_actual > 0), 0) AS unidades, count(*) FILTER (WHERE stock_actual > 0) AS con_stock,
                                   count(*) FILTER (WHERE stock_actual > 0 AND stock_actual <= stock_minimo) AS bajo, count(*) FILTER (WHERE stock_actual <= 0) AS agotados, count(*) AS total
                              FROM productos WHERE activo");
        $tasa = (float) DB::scalar('SELECT tasa FROM v_tasa_actual');
        $base = [
            'vista' => $vista, 'hoy' => $hoy, 'emisor' => $this->emisor(), 'tasa' => $tasa, 'por_pagina' => self::POR_PAGINA, 'pagina' => $pagina,
            'resumen' => ['valor_costo_usd' => round((float) $k->costo, 2), 'valor_venta_usd' => round((float) $k->venta, 2), 'unidades' => (float) $k->unidades, 'con_stock' => (int) $k->con_stock,
                'bajo' => (int) $k->bajo, 'agotados' => (int) $k->agotados, 'total' => (int) $k->total],
            'categorias' => array_map(fn ($c) => ['id' => (int) $c->id, 'nombre' => $c->nombre], DB::select('SELECT id, nombre FROM categorias ORDER BY nombre')),
        ];

        if ($vista === 'existencias') {
            [$w, $b] = $this->filtroExistencias($q);
            $total = (int) DB::scalar("SELECT count(*) FROM productos p WHERE {$w}", $b);
            $filas = DB::select(self::EXIST_SQL . " WHERE {$w} ORDER BY " . $this->ordenExistencias($q) . ' LIMIT ? OFFSET ?', array_merge($b, [self::POR_PAGINA, $off]));
            return $base + [
                'filtros' => ['q' => trim((string) ($q['q'] ?? '')), 'estado' => in_array($q['estado'] ?? '', self::ESTADOS, true) ? $q['estado'] : 'todos', 'categoria' => ! empty($q['categoria']) ? (int) $q['categoria'] : null, 'orden' => in_array($q['orden'] ?? '', self::ORDENES, true) ? $q['orden'] : 'nombre'],
                'total' => $total, 'filas' => array_map(fn ($p) => $this->filaExistencia($p), $filas),
            ];
        }

        [$w, $b, $f] = $this->filtroMovimientos($q, $hoy);
        $r = DB::selectOne("SELECT count(*) AS n, COALESCE(sum(mi.cantidad) FILTER (WHERE mi.cantidad > 0), 0) AS entradas, COALESCE(-sum(mi.cantidad) FILTER (WHERE mi.cantidad < 0), 0) AS salidas
                              FROM movimientos_inventario mi JOIN productos p ON p.id = mi.producto_id WHERE {$w}", $b);
        $filas = DB::select(self::MOV_SQL . " WHERE {$w} ORDER BY mi.fecha DESC, mi.id DESC LIMIT ? OFFSET ?", array_merge($b, [self::POR_PAGINA, $off]));
        $prod = $f['producto'] ? DB::selectOne('SELECT id, sku, nombre FROM productos WHERE id = ?', [$f['producto']]) : null;
        return $base + [
            'filtros' => $f + ['producto_nombre' => $prod ? "{$prod->nombre} ({$prod->sku})" : null],
            'total' => (int) $r->n, 'periodo' => ['entradas' => (float) $r->entradas, 'salidas' => (float) $r->salidas, 'neto' => (float) $r->entradas - (float) $r->salidas],
            'filas' => array_map(fn ($m) => $this->movimiento($m), $filas),
        ];
    }

    /** Todas las filas del filtro actual (sin paginar) para el PDF y el CSV. */
    public function reporte(array $q): array
    {
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        if (($q['vista'] ?? '') === 'movimientos') {
            [$w, $b, $f] = $this->filtroMovimientos($q, $hoy);
            $filas = DB::select(self::MOV_SQL . " WHERE {$w} ORDER BY mi.fecha DESC, mi.id DESC LIMIT 5000", $b);
            return ['vista' => 'movimientos', 'filtros' => $f, 'filas' => array_map(fn ($m) => $this->movimiento($m), $filas), 'tasa' => (float) DB::scalar('SELECT tasa FROM v_tasa_actual')];
        }
        [$w, $b] = $this->filtroExistencias($q);
        $filas = DB::select(self::EXIST_SQL . " WHERE {$w} ORDER BY " . $this->ordenExistencias($q) . ' LIMIT 5000', $b);
        return ['vista' => 'existencias', 'filas' => array_map(fn ($p) => $this->filaExistencia($p), $filas), 'tasa' => (float) DB::scalar('SELECT tasa FROM v_tasa_actual')];
    }

    public function reporteJson(Request $r)
    {
        $this->soloAdmin();
        return response()->json($this->reporte($r->query()));
    }

    /* ───────────── Ficha de un producto ───────────── */

    public function ficha(int $id): ?array
    {
        $p = DB::selectOne(self::EXIST_SQL . ' WHERE p.id = ?', [$id]);
        if (! $p) return null;
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $movs = DB::select(self::MOV_SQL . ' WHERE mi.producto_id = ? ORDER BY mi.fecha DESC, mi.id DESC LIMIT 40', [$id]);
        $r = DB::selectOne("SELECT COALESCE(sum(cantidad) FILTER (WHERE cantidad > 0), 0) AS entradas, COALESCE(-sum(cantidad) FILTER (WHERE cantidad < 0 AND tipo IN ('VENTA', 'AJUSTE_SALIDA')), 0) AS salidas,
                                   COALESCE(-sum(cantidad) FILTER (WHERE tipo = 'VENTA'), 0) AS vendidas
                              FROM movimientos_inventario WHERE producto_id = ? AND (fecha AT TIME ZONE '" . self::TZ . "')::date > ?::date - 30", [$id, $hoy]);
        $stock = (float) $p->stock_actual; $vendidas = (float) $r->vendidas;
        $fila = $this->filaExistencia($p);
        return ['producto' => $fila + ['movimientos_total' => (int) DB::scalar('SELECT count(*) FROM movimientos_inventario WHERE producto_id = ?', [$id])],
            'serie' => array_map(fn ($m) => ['fecha' => $m->fecha, 'stock' => $m->stock_resultante === null ? null : (float) $m->stock_resultante], array_reverse($movs)),
            'movimientos' => array_map(fn ($m) => $this->movimiento($m), $movs),
            'ultimos_30' => ['entradas' => (float) $r->entradas, 'vendidas' => $vendidas, 'salidas' => (float) $r->salidas],
            'cobertura_dias' => $vendidas > 0 && $stock > 0 ? (int) floor($stock / ($vendidas / 30)) : null];
    }

    public function fichaJson(int $id)
    {
        $this->soloAdmin();
        $f = $this->ficha($id);
        return $f ? response()->json($f) : response()->json(['message' => 'Ese producto no existe.'], 404);
    }

    /** Búsqueda de productos para el ajuste. */
    public function buscar(Request $r)
    {
        $this->soloAdmin();
        $w = ['p.activo']; $b = [];
        foreach (preg_split('/\s+/', trim((string) $r->query('q', '')), -1, PREG_SPLIT_NO_EMPTY) as $x) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $x) . '%';
            $w[] = "(unaccent(p.nombre) ILIKE unaccent(?) OR p.sku ILIKE ? OR COALESCE(p.codigo_barras, '') ILIKE ?)";
            array_push($b, $like, $like, $like);
        }
        $filas = DB::select("SELECT p.id, p.sku, p.nombre, p.unidad, p.stock_actual, p.costo_usd FROM productos p WHERE " . implode(' AND ', $w) . ' ORDER BY p.nombre LIMIT 8', $b);
        return response()->json(array_map(fn ($p) => ['id' => (int) $p->id, 'sku' => $p->sku, 'nombre' => $p->nombre, 'unidad' => $p->unidad, 'stock' => (float) $p->stock_actual, 'costo_usd' => (float) $p->costo_usd], $filas));
    }

    /* ───────────── Ajuste de existencias ───────────── */

    /**
     * Modos: ENTRADA (suma), SALIDA (resta), CONTEO (llevas lo contado; el sistema calcula la diferencia) e INICIAL (primer stock del producto).
     * Devuelve [datos, código HTTP]. Si falta stock o algo no cuadra, el mensaje viene de la base.
     */
    public function aplicarAjuste(array $d, ?int $usuario): array
    {
        $id = (int) $d['producto_id'];
        $modo = $d['modo'];
        $cant = (float) $d['cantidad'];
        $motivo = trim((string) $d['motivo']);
        try {
            return DB::transaction(function () use ($id, $modo, $cant, $motivo, $usuario) {
                $p = DB::selectOne('SELECT id, nombre, stock_actual FROM productos WHERE id = ? AND activo FOR UPDATE', [$id]);
                if (! $p) return [['message' => 'Ese producto no existe o está desactivado.', 'errors' => ['producto_id' => ['Elige un producto de la lista.']]], 422];
                $stock = (float) $p->stock_actual;
                $delta = match ($modo) { 'ENTRADA', 'INICIAL' => $cant, 'SALIDA' => -$cant, 'CONTEO' => round($cant - $stock, 3) };
                if (abs($delta) < 0.0005) {
                    $m = $modo === 'CONTEO' ? 'El conteo coincide con lo que dice el sistema: no hay nada que ajustar.' : 'La cantidad debe ser mayor que cero.';
                    return [['message' => $m, 'errors' => ['cantidad' => [$m]]], 422];
                }
                DB::statement('CALL sp_ajustar_stock(?, ?, ?, ?, ?::boolean)', [$id, $delta, $motivo, $usuario, $modo === 'INICIAL' ? 'true' : 'false']);
                return [['ok' => true, 'delta' => $delta, 'stock_antes' => $stock, 'stock_despues' => round($stock + $delta, 3), 'ficha' => $this->ficha($id)], 200];
            });
        } catch (QueryException $e) {
            $m = $this->mensaje($e, 'No se pudo registrar el ajuste.');
            return [['message' => $m, 'errors' => ['cantidad' => [$m]]], 422];
        }
    }

    public function ajustar(Request $r)
    {
        $this->soloAdmin();
        $d = $r->validate([
            'producto_id' => 'required|integer', 'modo' => 'required|in:ENTRADA,SALIDA,CONTEO,INICIAL',
            'cantidad' => 'required|numeric|min:0|max:99999999', 'motivo' => 'required|string|min:3|max:200',
        ], ['cantidad.required' => 'Escribe la cantidad.', 'motivo.required' => 'Cuéntanos el motivo del ajuste.', 'motivo.min' => 'Escribe un motivo un poco más claro (mínimo 3 letras).']);
        if ($d['modo'] !== 'CONTEO' && (float) $d['cantidad'] <= 0) {
            return response()->json(['message' => 'La cantidad debe ser mayor que cero.', 'errors' => ['cantidad' => ['La cantidad debe ser mayor que cero.']]], 422);
        }
        [$datos, $codigo] = $this->aplicarAjuste($d, auth()->id());
        return response()->json($datos, $codigo);
    }
}
