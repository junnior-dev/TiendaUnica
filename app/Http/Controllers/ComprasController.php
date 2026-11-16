<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Compras (/compras): facturas de proveedores que suben el inventario. Solo administradores.
 *   fn_registrar_compra   → crea la compra; los disparadores de la base calculan tasa, IVA por línea, costo en USD,
 *                           totales, kardex (suma stock) y, según negocio.politica_costo_nuevo, el precio o una alerta de precio
 *   sp_anular_compra      → descuenta del inventario lo que entró (movimiento ANULACION_COMPRA)
 *   sp_registrar_retencion_iva('COMPRA', …) · sp_registrar_importacion → de 08_retenciones_iva.sql (opcionales)
 *   proveedores           → alta rápida desde la compra; el módulo Proveedores completo viene aparte
 * Los métodos de datos son públicos para poder probarlos sin HTTP.
 */
class ComprasController extends Controller
{
    use ContextoPagina;

    private const POR_PAGINA = 20;

    /* ───────────── Páginas ───────────── */

    public function index(Request $r)
    {
        $this->soloAdmin();
        return Inertia::render('Compras/Index', [...$this->contexto(), ...$this->datosPagina($r->query())]);
    }

    public function nueva()
    {
        $this->soloAdmin();
        return Inertia::render('Compras/Nueva', [...$this->contexto(), ...$this->datosNueva()]);
    }

    private function soloAdmin(): void
    {
        abort_if(strtoupper((string) (auth()->user()->rol ?? '')) !== 'ADMINISTRADOR', 403, 'Solo un administrador puede registrar o consultar compras.');
    }

    /** ¿Está instalado 11_cierre_y_pagos.sql (compras a crédito)? */
    private function hayCxp(): bool
    {
        return (bool) DB::scalar("SELECT to_regclass('pagos_proveedor') IS NOT NULL");
    }

    private function hayRetenciones(): bool
    {
        return \App\Support\Tenant::fiscal() && (bool) DB::scalar("SELECT to_regclass('retenciones_iva') IS NOT NULL AND to_regclass('compras_importacion') IS NOT NULL");
    }

    private function emisor(): array
    {
        $n = DB::selectOne('SELECT razon_social, nombre_comercial, rif, direccion_fiscal, telefono FROM negocio WHERE id = fn_negocio_actual()');
        return ['razon_social' => $n->razon_social ?? '', 'comercial' => $n->nombre_comercial ?? null, 'rif' => $n->rif ?? '', 'direccion' => $n->direccion_fiscal ?? '', 'telefono' => $n->telefono ?? ''];
    }

    /** Todas las compras del filtro actual (sin paginar), para el reporte en PDF. */
    public function reporteDatos(array $q): array
    {
        $d = $this->datosPagina($q + ['pagina' => 1], 5000);
        return ['filtros' => $d['filtros'], 'resumen' => $d['resumen'], 'filas' => $d['filas'], 'proveedor' => $d['filtros']['proveedor'] ? (collect($d['proveedores'])->firstWhere('id', (int) $d['filtros']['proveedor'])['nombre'] ?? null) : null,
                'especial' => $d['especial'], 'retenciones_activas' => $d['retenciones_activas'], 'emisor' => $this->emisor()];
    }

    public function reporte(Request $r)
    {
        $this->soloAdmin();
        return response()->json($this->reporteDatos($r->query()));
    }

    private function negocio(): object
    {
        return DB::selectOne('SELECT es_contribuyente_especial, recupera_credito_fiscal, metodo_costo, politica_costo_nuevo FROM negocio WHERE id = fn_negocio_actual()');
    }

    /* ───────────── Lista ───────────── */

    private function rango(array $q): array
    {
        $hoy = new \DateTimeImmutable((string) DB::scalar('SELECT fn_hoy()'));
        $p = in_array($q['periodo'] ?? '', ['semana', 'mes', 'mespasado', 'anio', 'rango'], true) ? $q['periodo'] : 'mes';
        $ok = fn ($s) => is_string($s) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) && checkdate((int) substr($s, 5, 2), (int) substr($s, 8, 2), (int) substr($s, 0, 4));
        switch ($p) {
            case 'semana':
                $d = $hoy->modify('monday this week'); $h = $hoy; break;
            case 'mespasado':
                $d = $hoy->modify('first day of last month'); $h = $hoy->modify('last day of last month'); break;
            case 'anio':
                $d = $hoy->setDate((int) $hoy->format('Y'), 1, 1); $h = $hoy; break;
            case 'rango':
                $d = $ok($q['desde'] ?? null) ? new \DateTimeImmutable($q['desde']) : $hoy->modify('-29 days');
                $h = $ok($q['hasta'] ?? null) ? new \DateTimeImmutable($q['hasta']) : $hoy;
                if ($h < $d) { [$d, $h] = [$h, $d]; }
                break;
            default:
                $d = $hoy->modify('first day of this month'); $h = $hoy;
        }
        return [$p, $d->format('Y-m-d'), $h->format('Y-m-d'), $hoy->format('Y-m-d')];
    }

    public function datosPagina(array $q, ?int $porPagina = null): array
    {
        $porPagina ??= self::POR_PAGINA;
        [$periodo, $desde, $hasta, $hoy] = $this->rango($q);
        $ret = $this->hayRetenciones();
        $n = $this->negocio();
        $especial = (bool) $n->es_contribuyente_especial;
        $texto = trim((string) ($q['q'] ?? ''));
        $estado = in_array($q['estado'] ?? '', ['REGISTRADA', 'ANULADA'], true) ? $q['estado'] : '';
        $proveedor = ctype_digit((string) ($q['proveedor'] ?? '')) ? (int) $q['proveedor'] : null;
        $soloPend = $especial && $ret && ($q['retencion'] ?? '') === 'pendiente';
        $pagina = max(1, (int) ($q['pagina'] ?? 1));

        $where = ['c.fecha_factura BETWEEN ? AND ?']; $b = [$desde, $hasta];
        if ($proveedor) { $where[] = 'c.proveedor_id = ?'; $b[] = $proveedor; }
        foreach (preg_split('/\s+/', $texto, -1, PREG_SPLIT_NO_EMPTY) as $w) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $w) . '%';
            $where[] = '(unaccent(p.razon_social) ILIKE unaccent(?) OR p.rif ILIKE ? OR c.numero_factura ILIKE ? OR c.numero_control ILIKE ?)';
            array_push($b, $like, $like, $like, $like);
        }
        $pendiente = $ret
            ? "(c.estado = 'REGISTRADA' AND c.monto_iva > 0 AND NOT EXISTS (SELECT 1 FROM retenciones_iva r WHERE r.compra_id = c.id AND r.estado = 'ACTIVA') AND NOT EXISTS (SELECT 1 FROM compras_importacion i WHERE i.compra_id = c.id))"
            : 'FALSE';

        $k = DB::selectOne("SELECT count(*) FILTER (WHERE c.estado = 'REGISTRADA') AS n,
                                   COALESCE(sum(c.total_usd) FILTER (WHERE c.estado = 'REGISTRADA'), 0) AS usd,
                                   COALESCE(sum(l.credito_fiscal_ves) FILTER (WHERE c.estado = 'REGISTRADA'), 0) AS credito_ves,
                                   count(*) FILTER (WHERE c.estado = 'ANULADA') AS anuladas,
                                   count(*) FILTER (WHERE {$pendiente}) AS pendientes
                            FROM compras c JOIN proveedores p ON p.id = c.proveedor_id LEFT JOIN v_libro_compras l ON l.compra_id = c.id WHERE " . implode(' AND ', $where), $b);

        $w2 = $where; $b2 = $b;
        if ($estado) { $w2[] = 'c.estado = ?'; $b2[] = $estado; }
        if ($soloPend) { $w2[] = $pendiente; }
        $from2 = 'FROM compras c JOIN proveedores p ON p.id = c.proveedor_id ' . ($ret ? "LEFT JOIN retenciones_iva r ON r.compra_id = c.id AND r.estado = 'ACTIVA' LEFT JOIN compras_importacion i ON i.compra_id = c.id " : '') . 'WHERE ' . implode(' AND ', $w2);
        $total = (int) DB::scalar("SELECT count(*) {$from2}", $b2);
        $paginas = max(1, (int) ceil($total / $porPagina));
        $pagina = min($pagina, $paginas);
        $filas = DB::select("SELECT c.id, c.fecha_factura, c.numero_factura, c.numero_control, c.moneda, c.total, c.total_usd, c.monto_iva, c.estado, c.aplica_credito_fiscal,
                                    p.razon_social, p.rif, (SELECT count(*) FROM compra_detalle d WHERE d.compra_id = c.id) AS lineas,
                                    " . ($ret ? 'r.porcentaje AS ret_pct, (i.compra_id IS NOT NULL) AS importacion' : 'NULL::numeric AS ret_pct, FALSE AS importacion') . "
                             {$from2} ORDER BY c.fecha_factura DESC, c.id DESC LIMIT ? OFFSET ?", array_merge($b2, [$porPagina, ($pagina - 1) * $porPagina]));

        return [
            'filtros' => ['periodo' => $periodo, 'desde' => $desde, 'hasta' => $hasta, 'hoy' => $hoy, 'q' => $texto, 'estado' => $estado, 'proveedor' => $proveedor ?: '', 'retencion' => $soloPend ? 'pendiente' : ''],
            'resumen' => ['compras' => (int) $k->n, 'total_usd' => (float) $k->usd, 'credito_ves' => (float) $k->credito_ves, 'anuladas' => (int) $k->anuladas, 'pendientes' => (int) $k->pendientes],
            'filas' => array_map(fn ($f) => [
                'id' => (int) $f->id, 'fecha' => $f->fecha_factura, 'proveedor' => $f->razon_social, 'rif' => $f->rif, 'factura' => $f->numero_factura, 'control' => $f->numero_control,
                'moneda' => trim($f->moneda), 'total' => (float) $f->total, 'total_usd' => (float) $f->total_usd, 'iva' => (float) $f->monto_iva, 'estado' => $f->estado, 'lineas' => (int) $f->lineas,
                'credito' => (bool) $f->aplica_credito_fiscal, 'retencion_pct' => $f->ret_pct !== null ? (float) $f->ret_pct : null, 'importacion' => (bool) $f->importacion,
            ], $filas),
            'meta' => ['pagina' => $pagina, 'paginas' => $paginas, 'total' => $total, 'por_pagina' => $porPagina],
            'proveedores' => array_map(fn ($p) => ['id' => (int) $p->id, 'nombre' => $p->razon_social], DB::select('SELECT id, razon_social FROM proveedores ORDER BY razon_social')),
            'especial' => $especial, 'retenciones_activas' => $ret,
        ];
    }

    /* ───────────── Nueva compra ───────────── */

    public function datosNueva(): array
    {
        $n = $this->negocio();
        return [
            'hoy' => DB::scalar('SELECT fn_hoy()'),
            'especial' => (bool) $n->es_contribuyente_especial, 'credito_fiscal' => (bool) $n->recupera_credito_fiscal,
            'metodo_costo' => $n->metodo_costo, 'politica_costo' => $n->politica_costo_nuevo,
            'retenciones_activas' => $this->hayRetenciones(),
            'alicuotas_iva' => array_map(fn ($a) => ['desde' => $a->vigente_desde, 'hasta' => $a->vigente_hasta, 'pct' => (float) $a->porcentaje],
                DB::select("SELECT vigente_desde, vigente_hasta, porcentaje FROM parametros_fiscales WHERE codigo = 'IVA_GENERAL' ORDER BY vigente_desde")),
            'cxp' => $this->hayCxp(),
            'proveedores_frecuentes' => $this->proveedoresDatos('', true),
        ];
    }

    public function proveedoresDatos(string $q, bool $frecuentes = false): array
    {
        $q = trim($q); $b = []; $w = ['p.activo'];
        foreach (preg_split('/\s+/', $q, -1, PREG_SPLIT_NO_EMPTY) as $x) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $x) . '%';
            $w[] = '(unaccent(p.razon_social) ILIKE unaccent(?) OR p.rif ILIKE ?)'; array_push($b, $like, $like);
        }
        $orden = $frecuentes ? 'max(c.fecha_factura) DESC NULLS LAST, p.razon_social' : 'p.razon_social';
        $filas = DB::select('SELECT p.id, p.rif, p.razon_social, p.telefono, ' . ($this->hayCxp() ? 'p.dias_credito' : '0') . ' AS dias_credito, count(c.id) AS compras, max(c.fecha_factura) AS ultima FROM proveedores p LEFT JOIN compras c ON c.proveedor_id = p.id AND c.estado = \'REGISTRADA\'
                             WHERE ' . implode(' AND ', $w) . " GROUP BY p.id ORDER BY {$orden} LIMIT " . ($frecuentes ? 8 : 10), $b);
        return array_map(fn ($p) => ['id' => (int) $p->id, 'rif' => $p->rif, 'nombre' => $p->razon_social, 'telefono' => $p->telefono, 'compras' => (int) $p->compras, 'ultima' => $p->ultima, 'dias_credito' => (int) $p->dias_credito], $filas);
    }

    public function proveedores(Request $r)
    {
        $this->soloAdmin();
        return response()->json($this->proveedoresDatos((string) $r->query('q', '')));
    }

    public function proveedorStore(Request $r)
    {
        $this->soloAdmin();
        $d = $r->validate([
            'rif' => ['required', 'regex:/^[JGVECPjgvecp]-?[0-9]{8}-?[0-9]$/'], 'razon_social' => 'required|string|min:2|max:200',
            'telefono' => 'nullable|string|max:40', 'correo' => 'nullable|email|max:150', 'direccion' => 'nullable|string|max:300',
        ], ['rif.required' => 'Escribe el RIF del proveedor.', 'rif.regex' => 'El RIF no tiene el formato correcto. Ejemplo: J-12345678-4.', 'razon_social.required' => 'Escribe el nombre o razón social.', 'correo.email' => 'Ese correo no parece válido.']);
        $rif = strtoupper($d['rif']);
        if (! preg_match('/^[JGVECPjgvecp]-/', $rif)) { $rif = substr($rif, 0, 1) . '-' . substr($rif, 1, 8) . '-' . substr($rif, 9); }
        if (! DB::scalar('SELECT fn_validar_rif(?)', [$rif])) {
            return response()->json(['message' => 'El RIF no es válido: revisa el último dígito.', 'errors' => ['rif' => ['El RIF no es válido: revisa el último dígito.']]], 422);
        }
        if (DB::selectOne('SELECT 1 AS x FROM proveedores WHERE upper(rif) = upper(?)', [$rif])) {
            return response()->json(['message' => 'Ya tienes un proveedor con ese RIF.', 'errors' => ['rif' => ['Ya tienes un proveedor con ese RIF.']]], 422);
        }
        try {
            $id = DB::scalar('INSERT INTO proveedores (rif, razon_social, telefono, correo, direccion) VALUES (?, ?, ?, ?, ?) RETURNING id',
                [$rif, trim($d['razon_social']), $d['telefono'] ?? null, $d['correo'] ?? null, $d['direccion'] ?? null]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo guardar el proveedor.')], 422);
        }
        return response()->json(['id' => (int) $id, 'rif' => $rif, 'nombre' => trim($d['razon_social']), 'telefono' => $d['telefono'] ?? null, 'compras' => 0, 'ultima' => null]);
    }

    public function productosDatos(string $q): array
    {
        $q = trim($q);
        if ($q === '') { return []; }
        $where = ['p.activo']; $b = [];
        foreach (preg_split('/\s+/', $q, -1, PREG_SPLIT_NO_EMPTY) as $w) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $w) . '%';
            $where[] = '(unaccent(p.nombre) ILIKE unaccent(?) OR p.sku ILIKE ? OR p.codigo_barras ILIKE ? OR p.referencia_fabricante ILIKE ? OR unaccent(COALESCE(m.nombre, \'\')) ILIKE unaccent(?))';
            array_push($b, $like, $like, $like, $like, $like);
        }
        $filas = DB::select('SELECT p.id, p.sku, p.codigo_barras, p.nombre, p.unidad, p.unidad_compra, p.piezas_por_presentacion, p.stock_actual, p.costo_usd, p.precio_venta_usd, (p.exento_iva OR p.exonerado_iva) AS exento, m.nombre AS marca,
                                    (p.codigo_barras = ? OR upper(p.sku) = upper(?)) AS exacto
                             FROM productos p LEFT JOIN marcas m ON m.id = p.marca_id WHERE ' . implode(' AND ', $where) . ' ORDER BY exacto DESC, p.nombre LIMIT 10', [$q, $q, ...$b]);
        return array_map(fn ($p) => ['id' => (int) $p->id, 'sku' => $p->sku, 'barras' => $p->codigo_barras, 'nombre' => $p->nombre, 'marca' => $p->marca, 'unidad' => trim($p->unidad), 'unidad_compra' => $p->unidad_compra !== null ? trim($p->unidad_compra) : null, 'piezas_por_presentacion' => (float) $p->piezas_por_presentacion,
            'stock' => (float) $p->stock_actual, 'costo_usd' => (float) $p->costo_usd, 'precio_usd' => (float) $p->precio_venta_usd, 'exento' => (bool) $p->exento, 'exacto' => (bool) $p->exacto], $filas);
    }

    public function productos(Request $r)
    {
        $this->soloAdmin();
        return response()->json($this->productosDatos((string) $r->query('q', '')));
    }

    /** Tasa que usará la compra en bolívares para esa fecha de factura, o el motivo por el que no se puede registrar. */
    public function tasa(Request $r)
    {
        $this->soloAdmin();
        $f = (string) $r->query('fecha', '');
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $f)) { return response()->json(['ok' => false, 'mensaje' => 'Elige la fecha de la factura.']); }
        try {
            $t = DB::selectOne('SELECT tasa, fecha_valor FROM fn_tasa_aplicable(?::date)', [$f]);
            return response()->json(['ok' => true, 'tasa' => (float) $t->tasa, 'fecha' => $t->fecha_valor]);
        } catch (QueryException $e) {
            return response()->json(['ok' => false, 'mensaje' => $this->mensaje($e, 'No hay una tasa de cambio para esa fecha.')]);
        }
    }

    /** ¿Ya registraste esa factura de ese proveedor? (la base no admite repetidas). */
    public function duplicada(Request $r)
    {
        $this->soloAdmin();
        $c = DB::selectOne('SELECT id, fecha_factura, estado FROM compras WHERE proveedor_id = ? AND numero_factura = ?', [(int) $r->query('proveedor'), trim((string) $r->query('factura'))]);
        return response()->json($c ? ['existe' => true, 'id' => (int) $c->id, 'fecha' => $c->fecha_factura, 'estado' => $c->estado] : ['existe' => false]);
    }

    /**
     * Vista previa, sin guardar nada, de lo que hará la compra con el costo y el precio de cada producto
     * (usa las mismas funciones de la base que los disparadores, con la regla de costo y la política de precios del negocio).
     */
    public function simular(Request $r)
    {
        $this->soloAdmin();
        $d = $r->validate(['moneda' => 'required|in:USD,VES', 'fecha' => 'required|date_format:Y-m-d', 'credito_fiscal' => 'nullable|boolean', 'items' => 'required|array|min:1|max:200',
            'items.*.producto_id' => 'required|integer', 'items.*.cantidad' => 'required|numeric|gt:0', 'items.*.costo_unitario' => 'required|numeric|min:0', 'items.*.exento' => 'nullable|boolean']);
        $n = $this->negocio();
        $credito = array_key_exists('credito_fiscal', $d) && $d['credito_fiscal'] !== null ? (bool) $d['credito_fiscal'] : (bool) $n->recupera_credito_fiscal;
        try {
            $tasa = $d['moneda'] === 'USD' ? 1.0 : (float) DB::scalar('SELECT tasa FROM fn_tasa_aplicable(?::date)', [$d['fecha']]);
        } catch (QueryException $e) {
            return response()->json(['ok' => false, 'mensaje' => $this->mensaje($e, 'No hay tasa de cambio para esa fecha.')]);
        }
        $iva = (float) DB::scalar('SELECT fn_iva_pct(?::date)', [$d['fecha']]);
        $out = [];
        foreach ($d['items'] as $it) {
            $p = DB::selectOne('SELECT id, stock_actual, costo_usd, precio_venta_usd, categoria_id, margen_pct, (exento_iva OR exonerado_iva) AS exento FROM productos WHERE id = ?', [(int) $it['producto_id']]);
            if (! $p) { continue; }
            $exento = array_key_exists('exento', $it) && $it['exento'] !== null ? (bool) $it['exento'] : (bool) $p->exento;
            $pct = $exento ? 0.0 : $iva;
            $costoUsd = round((float) $it['costo_unitario'] / $tasa, 4);
            $inv = $credito ? $costoUsd : round($costoUsd * (1 + $pct / 100), 4);
            $stock = (float) $p->stock_actual;
            $nuevo = ($n->metodo_costo === 'PROMEDIO' && $stock > 0) ? round(($stock * (float) $p->costo_usd + (float) $it['cantidad'] * $inv) / ($stock + (float) $it['cantidad']), 4) : $inv;
            $margen = (float) DB::scalar('SELECT fn_margen_para(?, ?)', [$p->margen_pct, $p->categoria_id]);
            $sug = (float) DB::scalar('SELECT fn_calcular_precio_usd(?, ?, ?)', [$nuevo, $margen, $exento ? 't' : 'f']);
            $out[(int) $p->id] = ['costo_actual_usd' => (float) $p->costo_usd, 'costo_nuevo_usd' => $nuevo, 'precio_actual_usd' => (float) $p->precio_venta_usd, 'precio_sugerido_usd' => $sug, 'margen_pct' => $margen];
        }
        return response()->json(['ok' => true, 'tasa' => $tasa, 'productos' => $out]);
    }

    /* ───────────── Registrar ───────────── */

    public function store(Request $r)
    {
        $this->soloAdmin();
        $d = $r->validate([
            'proveedor_id' => 'required|integer', 'numero_factura' => 'required|string|max:40', 'numero_control' => 'nullable|string|max:40',
            'fecha_factura' => 'required|date_format:Y-m-d|before_or_equal:today', 'moneda' => 'required|in:USD,VES', 'credito_fiscal' => 'nullable|boolean',
            'observaciones' => 'nullable|string|max:500', 'condicion' => 'nullable|in:CONTADO,CREDITO', 'dias_credito' => 'nullable|integer|min:0|max:365', 'items' => 'required|array|min:1|max:200',
            'items.*.producto_id' => 'required|integer', 'items.*.cantidad' => 'required|numeric|gt:0|max:99999999', 'items.*.costo_unitario' => 'required|numeric|min:0|max:999999999999', 'items.*.exento' => 'nullable|boolean',
        ], [
            'numero_factura.required' => 'Escribe el número de la factura del proveedor.', 'fecha_factura.required' => 'Elige la fecha de la factura.', 'fecha_factura.before_or_equal' => 'La fecha de la factura no puede ser futura.',
            'items.required' => 'Agrega al menos un producto.', 'items.min' => 'Agrega al menos un producto.',
        ]);
        $items = array_map(fn ($i) => ['producto_id' => (int) $i['producto_id'], 'cantidad' => (float) $i['cantidad'], 'costo_unitario' => (float) $i['costo_unitario'],
            'exento' => array_key_exists('exento', $i) && $i['exento'] !== null ? (bool) $i['exento'] : null], $d['items']);
        $credito = array_key_exists('credito_fiscal', $d) ? $d['credito_fiscal'] : null;

        try {
            $id = (int) DB::transaction(function () use ($d, $items, $credito) {
                $cid = (int) DB::scalar('SELECT fn_registrar_compra(?::bigint, ?::text, ?::date, ?::char(3), ?::jsonb, ?::bigint, ?::text, ?::boolean, ?::text)', [
                (int) $d['proveedor_id'], $d['numero_factura'], $d['fecha_factura'], $d['moneda'], json_encode($items), auth()->id(),
                $d['numero_control'] ?? null, $credito === null ? null : ($credito ? 't' : 'f'), $d['observaciones'] ?? null,
                ]);
                // A crédito: queda por pagar hasta la fecha de la factura + los días (en la misma transacción que crea la compra).
                if (($d['condicion'] ?? 'CONTADO') === 'CREDITO' && $this->hayCxp()) DB::statement('SELECT fn_compra_a_credito(?::bigint, ?::int)', [$cid, (int) ($d['dias_credito'] ?? 0)]);
                return $cid;
            });
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo registrar la compra. Revisa los datos e inténtalo otra vez.', 'compras_proveedor_id_numero_factura_key', 'Ya registraste esa factura de ese proveedor.')], 422);
        }
        return response()->json(['id' => $id, 'resumen' => $this->resumenRegistro($id)]);
    }

    /** Lo que pasó al guardar: totales, stock sumado y precios que conviene revisar. */
    public function resumenRegistro(int $id): array
    {
        $c = DB::selectOne('SELECT c.id, c.numero_factura, c.moneda, c.total, c.total_usd, c.monto_iva, c.tasa_cambio, c.fecha_factura, p.razon_social FROM compras c JOIN proveedores p ON p.id = c.proveedor_id WHERE c.id = ?', [$id]);
        $n = $this->negocio();
        $lineas = DB::select('SELECT d.producto_id, pr.sku, pr.nombre, d.cantidad, pr.stock_actual FROM compra_detalle d JOIN productos pr ON pr.id = d.producto_id WHERE d.compra_id = ? ORDER BY d.id', [$id]);
        $alertas = DB::select("SELECT a.producto_id, pr.nombre, a.costo_nuevo_usd, a.precio_actual_usd, a.precio_sugerido_usd FROM alertas_precio a JOIN productos pr ON pr.id = a.producto_id
                               JOIN compra_detalle d ON d.id = a.compra_detalle_id WHERE d.compra_id = ? AND a.estado = 'PENDIENTE' ORDER BY pr.nombre", [$id]);
        $ret = $this->hayRetenciones() && $n->es_contribuyente_especial && (float) $c->monto_iva > 0;
        return [
            'id' => (int) $c->id, 'proveedor' => $c->razon_social, 'factura' => $c->numero_factura, 'fecha' => $c->fecha_factura, 'moneda' => trim($c->moneda), 'total' => (float) $c->total, 'total_usd' => (float) $c->total_usd,
            'productos' => count($lineas), 'unidades' => array_sum(array_map(fn ($l) => (float) $l->cantidad, $lineas)),
            'lineas' => array_map(fn ($l) => ['nombre' => $l->nombre, 'sku' => $l->sku, 'cantidad' => (float) $l->cantidad, 'stock' => (float) $l->stock_actual], $lineas),
            'politica_costo' => $n->politica_costo_nuevo,
            'alertas' => array_map(fn ($a) => ['producto_id' => (int) $a->producto_id, 'nombre' => $a->nombre, 'costo_usd' => (float) $a->costo_nuevo_usd, 'precio_actual_usd' => (float) $a->precio_actual_usd, 'precio_sugerido_usd' => (float) $a->precio_sugerido_usd], $alertas),
            'puede_retener' => $ret,
        ];
    }

    /* ───────────── Detalle ───────────── */

    public function show(int $id)
    {
        $this->soloAdmin();
        $d = $this->detalleDatos($id);
        abort_if($d === null, 404);
        return response()->json($d);
    }

    public function detalleDatos(int $id): ?array
    {
        $c = DB::selectOne('SELECT c.*, p.razon_social, p.rif, p.telefono, p.correo, u.nombre_completo AS por, ua.nombre_completo AS anulada_nombre
                            FROM compras c JOIN proveedores p ON p.id = c.proveedor_id LEFT JOIN usuarios u ON u.id = c.usuario_id LEFT JOIN usuarios ua ON ua.id = c.anulada_por WHERE c.id = ?', [$id]);
        if (! $c) { return null; }
        $n = $this->negocio();
        $ret = $this->hayRetenciones();
        $items = DB::select('SELECT d.producto_id, pr.sku, pr.nombre, d.cantidad, d.costo_unitario, d.exento, d.iva_pct, d.base, d.monto_iva, d.costo_unitario_usd
                             FROM compra_detalle d JOIN productos pr ON pr.id = d.producto_id WHERE d.compra_id = ? ORDER BY d.id', [$id]);
        $retencion = $ret ? DB::selectOne("SELECT id, numero_comprobante, fecha_emision, porcentaje, iva_documento_ves, iva_retenido_ves FROM retenciones_iva WHERE compra_id = ? AND estado = 'ACTIVA'", [$id]) : null;
        $imp = $ret ? DB::selectOne('SELECT numero_planilla, fecha_planilla, aduana FROM compras_importacion WHERE compra_id = ?', [$id]) : null;
        $alertas = DB::select("SELECT pr.nombre, a.costo_nuevo_usd, a.precio_actual_usd, a.precio_sugerido_usd FROM alertas_precio a JOIN productos pr ON pr.id = a.producto_id
                               JOIN compra_detalle d ON d.id = a.compra_detalle_id WHERE d.compra_id = ? AND a.estado = 'PENDIENTE' ORDER BY pr.nombre", [$id]);
        $ivaVes = round((float) (DB::scalar('SELECT iva_ves FROM v_libro_compras WHERE compra_id = ?', [$id]) ?? 0), 2);
        $reg = $c->estado === 'REGISTRADA';
        return [
            'id' => (int) $c->id, 'estado' => $c->estado, 'fecha' => $c->fecha_factura, 'factura' => $c->numero_factura, 'control' => $c->numero_control, 'moneda' => trim($c->moneda),
            'tasa' => (float) $c->tasa_cambio, 'tasa_fecha' => $c->tasa_fecha_valor, 'credito' => (bool) $c->aplica_credito_fiscal, 'observaciones' => $c->observaciones,
            'base' => (float) $c->base_imponible, 'exento' => (float) $c->base_exenta, 'iva' => (float) $c->monto_iva, 'total' => (float) $c->total, 'total_usd' => (float) $c->total_usd,
            'iva_ves' => $ivaVes, 'registrada_por' => $c->por, 'registrada_en' => $c->created_at,
            'proveedor' => ['id' => (int) $c->proveedor_id, 'nombre' => $c->razon_social, 'rif' => $c->rif, 'telefono' => $c->telefono, 'correo' => $c->correo],
            'items' => array_map(fn ($i) => ['producto_id' => (int) $i->producto_id, 'sku' => $i->sku, 'nombre' => $i->nombre, 'cantidad' => (float) $i->cantidad, 'costo' => (float) $i->costo_unitario,
                'exento' => (bool) $i->exento, 'iva_pct' => (float) $i->iva_pct, 'base' => (float) $i->base, 'iva' => (float) $i->monto_iva, 'costo_usd' => (float) $i->costo_unitario_usd], $items),
            'anulacion' => $c->estado === 'ANULADA' ? ['fecha' => $c->anulada_en, 'por' => $c->anulada_nombre, 'motivo' => $c->motivo_anulacion] : null,
            'retencion' => $retencion ? ['id' => (int) $retencion->id, 'comprobante' => $retencion->numero_comprobante, 'fecha' => $retencion->fecha_emision, 'porcentaje' => (float) $retencion->porcentaje,
                'iva_documento_ves' => (float) $retencion->iva_documento_ves, 'iva_retenido_ves' => (float) $retencion->iva_retenido_ves] : null,
            'importacion' => $imp ? ['planilla' => $imp->numero_planilla, 'fecha' => $imp->fecha_planilla, 'aduana' => $imp->aduana] : null,
            'alertas' => array_map(fn ($a) => ['nombre' => $a->nombre, 'costo_usd' => (float) $a->costo_nuevo_usd, 'precio_actual_usd' => (float) $a->precio_actual_usd, 'precio_sugerido_usd' => (float) $a->precio_sugerido_usd], $alertas),
            'especial' => (bool) $n->es_contribuyente_especial, 'retenciones_activas' => $ret, 'emisor' => $this->emisor(),
            'puede' => ['anular' => $reg, 'retener' => $reg && $ret && (bool) $n->es_contribuyente_especial && $ivaVes > 0 && ! $retencion && ! $imp, 'planilla' => $reg && $ret && ! $imp && ! $retencion],
        ];
    }

    /* ───────────── Acciones sobre una compra ───────────── */

    public function anular(Request $r, int $id)
    {
        $this->soloAdmin();
        $d = $r->validate(['motivo' => 'required|string|min:3|max:300'], ['motivo.required' => 'Cuéntanos el motivo de la anulación.', 'motivo.min' => 'Cuéntanos el motivo de la anulación.']);
        try {
            DB::statement('CALL sp_anular_compra(?, ?, ?)', [$id, auth()->id(), $d['motivo']]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo anular la compra.')], 422);
        }
        return response()->json($this->detalleDatos($id));
    }

    public function retencion(Request $r, int $id)
    {
        $this->soloAdmin();
        abort_unless($this->hayRetenciones(), 422, 'Falta ejecutar 08_retenciones_iva.sql en la base de datos.');
        $d = $r->validate(['fecha' => 'required|date_format:Y-m-d', 'porcentaje' => 'required|in:75,100', 'comprobante' => 'nullable|string|max:40', 'observaciones' => 'nullable|string|max:300'],
            ['fecha.required' => 'Elige la fecha del comprobante.', 'porcentaje.in' => 'Elige 75 % o 100 %.']);
        try {
            DB::statement('CALL sp_registrar_retencion_iva(?, ?, ?, ?, ?, ?, ?, ?)', ['COMPRA', $id, ($d['comprobante'] ?? '') !== '' ? $d['comprobante'] : null, $d['fecha'], $d['porcentaje'], auth()->id(), null, $d['observaciones'] ?? null]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo registrar la retención.')], 422);
        }
        return response()->json($this->detalleDatos($id));
    }

    public function retencionAnular(Request $r, int $id)
    {
        $this->soloAdmin();
        abort_unless($this->hayRetenciones(), 422, 'Falta ejecutar 08_retenciones_iva.sql en la base de datos.');
        $d = $r->validate(['motivo' => 'required|string|min:3|max:300'], ['motivo.required' => 'Cuéntanos el motivo.', 'motivo.min' => 'Cuéntanos el motivo.']);
        $rid = DB::scalar("SELECT id FROM retenciones_iva WHERE compra_id = ? AND estado = 'ACTIVA'", [$id]);
        abort_if(! $rid, 422, 'Esta compra no tiene una retención activa.');
        try {
            DB::statement('CALL sp_anular_retencion_iva(?, ?, ?)', [$rid, auth()->id(), $d['motivo']]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo anular la retención.')], 422);
        }
        return response()->json($this->detalleDatos($id));
    }

    public function importacion(Request $r, int $id)
    {
        $this->soloAdmin();
        abort_unless($this->hayRetenciones(), 422, 'Falta ejecutar 08_retenciones_iva.sql en la base de datos.');
        $d = $r->validate(['planilla' => 'required|string|max:40', 'fecha' => 'required|date_format:Y-m-d', 'aduana' => 'nullable|string|max:120'], ['planilla.required' => 'Escribe el número de la planilla.', 'fecha.required' => 'Elige la fecha de la planilla.']);
        try {
            DB::statement('CALL sp_registrar_importacion(?, ?, ?, ?, ?)', [$id, $d['planilla'], $d['fecha'], $d['aduana'] ?? null, auth()->id()]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo registrar la planilla.')], 422);
        }
        return response()->json($this->detalleDatos($id));
    }

    /** Los procedimientos de la base lanzan mensajes en español (TV005/TV006): se muestran tal cual. */
    private function mensaje(QueryException $e, string $porDefecto, ?string $restriccion = null, ?string $textoRestriccion = null): string
    {
        if ($restriccion && str_contains($e->getMessage(), $restriccion)) { return $textoRestriccion ?? $porDefecto; }
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }
}
