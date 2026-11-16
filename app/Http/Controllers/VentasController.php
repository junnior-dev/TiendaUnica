<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Ventas (/ventas): historial, detalle, anulación y notas de crédito/débito. No calcula nada fiscal por su cuenta.
 *   ventas, pagos_venta, notas_ajuste             → lectura
 *   sp_anular_venta                               → devuelve el stock, deja constancia del IGTF y marca la venta como anulada
 *   sp_registrar_nota_ajuste                      → nota de crédito (C) o débito (D) sobre una venta completada
 *   fn_emitir_factura_fiscal / sp_asignar_factura → los reutiliza el POS (rutas /caja/venta/{id}/emitir y /factura)
 * Un cajero solo ve sus propias ventas; anular y emitir notas es de administradores.
 * Los métodos de datos son públicos para poder probarlos sin HTTP.
 */
class VentasController extends Controller
{
    use ContextoPagina;

    private const POR_PAGINA = 20;

    public function index(Request $r)
    {
        return Inertia::render('Ventas/Index', [...$this->contexto(), ...$this->datosPagina($r->query())]);
    }

    private function esAdmin(): bool
    {
        return (auth()->user()->rol ?? '') === 'ADMINISTRADOR';
    }

    /** Fechas «desde» y «hasta» del período elegido (por defecto, hoy). */
    private function rango(array $q): array
    {
        $hoy = new \DateTimeImmutable((string) DB::scalar('SELECT fn_hoy()'));
        $p = in_array($q['periodo'] ?? '', ['hoy', 'ayer', 'semana', 'mes', 'rango'], true) ? $q['periodo'] : 'hoy';
        $ok = fn ($s) => is_string($s) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) && checkdate((int) substr($s, 5, 2), (int) substr($s, 8, 2), (int) substr($s, 0, 4));
        switch ($p) {
            case 'ayer':
                $d = $h = $hoy->modify('-1 day');
                break;
            case 'semana':
                $d = $hoy->modify('monday this week');
                $h = $hoy;
                break;
            case 'mes':
                $d = $hoy->modify('first day of this month');
                $h = $hoy;
                break;
            case 'rango':
                $d = $ok($q['desde'] ?? null) ? new \DateTimeImmutable($q['desde']) : $hoy->modify('-6 days');
                $h = $ok($q['hasta'] ?? null) ? new \DateTimeImmutable($q['hasta']) : $hoy;
                if ($h < $d) {
                    [$d, $h] = [$h, $d];
                }
                break;
            default:
                $d = $h = $hoy;
        }
        return [$p, $d->format('Y-m-d'), $h->format('Y-m-d'), $hoy->format('Y-m-d')];
    }

    public function datosPagina(array $q): array
    {
        [$periodo, $desde, $hasta, $hoy] = $this->rango($q);
        $admin = $this->esAdmin();
        $texto = trim((string) ($q['q'] ?? ''));
        $estado = in_array($q['estado'] ?? '', ['COMPLETADA', 'ANULADA'], true) ? $q['estado'] : '';
        $soloSinFactura = ($q['factura'] ?? '') === 'sin';
        $cajero = $admin && ctype_digit((string) ($q['cajero'] ?? '')) ? (int) $q['cajero'] : null;
        $pagina = max(1, (int) ($q['pagina'] ?? 1));

        // Filtro común (período, búsqueda y cajero): lo usan los totales y la lista.
        $where = ['v.fecha_valor BETWEEN ? AND ?']; $b = [$desde, $hasta];
        if (! $admin) {
            $where[] = 'v.usuario_id = ?'; $b[] = auth()->id();
        } elseif ($cajero) {
            $where[] = 'v.usuario_id = ?'; $b[] = $cajero;
        }
        if ($texto !== '') {
            foreach (preg_split('/\s+/', preg_replace('/^(?:#|N\s*[.º°]+\s*)/iu', '', $texto), -1, PREG_SPLIT_NO_EMPTY) as $w) {
                $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $w) . '%';
                $num = ctype_digit($w) ? (int) $w : -1;
                $where[] = "(unaccent(COALESCE(c.nombre, 'Consumidor final')) ILIKE unaccent(?) OR v.numero_factura_fiscal ILIKE ? OR c.documento ILIKE ? OR v.numero = ?)";
                array_push($b, $like, $like, $like, $num);
            }
        }
        $base = 'FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id WHERE ' . implode(' AND ', $where);

        $k = DB::selectOne("SELECT count(*) FILTER (WHERE v.estado = 'COMPLETADA') AS n,
                                   COALESCE(sum(v.total_cobrar_ves) FILTER (WHERE v.estado = 'COMPLETADA'), 0) AS ves,
                                   COALESCE(sum(v.total_cobrar_usd) FILTER (WHERE v.estado = 'COMPLETADA'), 0) AS usd,
                                   COALESCE(sum(v.igtf_ves) FILTER (WHERE v.estado = 'COMPLETADA'), 0) AS igtf_ves,
                                   COALESCE(sum(v.igtf_usd) FILTER (WHERE v.estado = 'COMPLETADA'), 0) AS igtf_usd,
                                   count(*) FILTER (WHERE v.estado = 'ANULADA') AS anuladas,
                                   count(*) FILTER (WHERE v.estado = 'COMPLETADA' AND v.numero_factura_fiscal IS NULL) AS sin_factura {$base}", $b);
        $monedas = DB::select("SELECT trim(p.moneda) AS moneda, COALESCE(sum(p.monto_usd), 0) AS usd, count(*) AS pagos
                                 FROM pagos_venta p JOIN ventas v ON v.id = p.venta_id LEFT JOIN clientes c ON c.id = v.cliente_id
                                WHERE v.estado = 'COMPLETADA' AND " . implode(' AND ', $where) . ' GROUP BY 1 ORDER BY 2 DESC', $b);

        $w2 = $where; $b2 = $b;
        if ($estado) {
            $w2[] = 'v.estado = ?'; $b2[] = $estado;
        }
        if ($soloSinFactura) {
            $w2[] = "v.estado = 'COMPLETADA' AND v.numero_factura_fiscal IS NULL";
        }
        $from2 = 'FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id LEFT JOIN usuarios u ON u.id = v.usuario_id WHERE ' . implode(' AND ', $w2);
        $total = (int) DB::scalar("SELECT count(*) {$from2}", $b2);
        $paginas = max(1, (int) ceil($total / self::POR_PAGINA));
        $pagina = min($pagina, $paginas);
        $filas = DB::select("SELECT v.id, v.numero, v.fecha_valor::text AS fecha, to_char(v.fecha_hora AT TIME ZONE 'America/Caracas', 'HH24:MI') AS hora,
                                    COALESCE(c.nombre, 'Consumidor final') AS cliente, CASE WHEN c.id IS NULL THEN NULL ELSE c.tipo_documento || '-' || c.documento END AS documento,
                                    v.numero_factura_fiscal AS factura, v.estado, v.total_cobrar_ves, v.total_cobrar_usd, v.igtf_usd, u.nombre_completo AS cajero,
                                    (SELECT string_agg(m.nombre, '|' ORDER BY p.id) FROM pagos_venta p JOIN metodos_pago m ON m.id = p.metodo_pago_id WHERE p.venta_id = v.id) AS pagos,
                                    (SELECT count(*) FROM notas_ajuste n WHERE n.venta_id = v.id) AS notas
                               {$from2} ORDER BY v.id DESC LIMIT ? OFFSET ?", array_merge($b2, [self::POR_PAGINA, ($pagina - 1) * self::POR_PAGINA]));

        $f = fn ($x) => (float) $x;
        $neg = DB::selectOne('SELECT es_contribuyente_especial, cobra_igtf FROM negocio WHERE id = fn_negocio_actual()');
        return [
            'filtros' => ['periodo' => $periodo, 'desde' => $desde, 'hasta' => $hasta, 'hoy' => $hoy, 'q' => $texto, 'estado' => $estado, 'factura' => $soloSinFactura ? 'sin' : '', 'cajero' => $cajero],
            'resumen' => [
                'ventas' => (int) $k->n, 'total_ves' => $f($k->ves), 'total_usd' => $f($k->usd), 'igtf_ves' => $f($k->igtf_ves), 'igtf_usd' => $f($k->igtf_usd),
                'anuladas' => (int) $k->anuladas, 'sin_factura' => (int) $k->sin_factura,
                'monedas' => array_map(fn ($m) => ['moneda' => $m->moneda, 'usd' => $f($m->usd), 'pagos' => (int) $m->pagos], $monedas),
            ],
            'filas' => array_map(fn ($v) => [
                'id' => (int) $v->id, 'numero' => (int) $v->numero, 'fecha' => $v->fecha, 'hora' => $v->hora, 'cliente' => $v->cliente, 'documento' => $v->documento, 'factura' => $v->factura,
                'estado' => $v->estado, 'total_ves' => $f($v->total_cobrar_ves), 'total_usd' => $f($v->total_cobrar_usd), 'igtf_usd' => $f($v->igtf_usd), 'cajero' => $v->cajero,
                'pagos' => $v->pagos ? array_values(array_unique(explode('|', $v->pagos))) : [], 'notas' => (int) $v->notas,
            ], $filas),
            'meta' => ['pagina' => $pagina, 'paginas' => $paginas, 'total' => $total, 'por_pagina' => self::POR_PAGINA],
            'cajeros' => $admin ? array_map(fn ($u) => ['id' => (int) $u->id, 'nombre' => $u->nombre_completo], DB::select('SELECT id, nombre_completo FROM usuarios ORDER BY nombre_completo')) : [],
            'es_admin' => $admin,
            'factura_automatica' => (new CajaController())->facturaAutomatica(),
            'regimen' => ['especial' => (bool) ($neg->es_contribuyente_especial ?? false), 'cobra_igtf' => (bool) ($neg->cobra_igtf ?? false)],
        ];
    }

    /* ───────────── Detalle de una venta ───────────── */

    public function show(int $id)
    {
        $d = $this->detalleDatos($id);
        abort_if(! $d, 404, 'No encontramos esa venta.');
        return response()->json($d);
    }

    public function detalleDatos(int $id): ?array
    {
        $d = (new CajaController())->documentoDatos($id);
        if (! $d) {
            return null;
        }
        $v = DB::selectOne("SELECT v.usuario_id, v.estado, to_char(v.anulada_en AT TIME ZONE 'America/Caracas', 'DD/MM/YYYY HH24:MI') AS anulada_txt, v.motivo_anulacion, ua.nombre_completo AS anulada_por
                              FROM ventas v LEFT JOIN usuarios ua ON ua.id = v.anulada_por WHERE v.id = ?", [$id]);
        $admin = $this->esAdmin();
        if (! $admin && (int) $v->usuario_id !== (int) auth()->id()) {
            return null;
        }
        $notas = DB::select("SELECT n.tipo, n.numero, to_char(n.fecha, 'DD/MM/YYYY') AS fecha, n.base_ves, n.iva_ves, n.total_ves, n.motivo FROM notas_ajuste n WHERE n.venta_id = ? ORDER BY n.id", [$id]);
        $f = fn ($x) => (float) $x;
        $acreditado = array_sum(array_map(fn ($n) => $n->tipo === 'C' ? $f($n->base_ves) : 0, $notas));
        $d['anulacion'] = $v->estado === 'ANULADA' ? ['fecha' => $v->anulada_txt, 'por' => $v->anulada_por, 'motivo' => $v->motivo_anulacion] : null;
        $d['notas'] = array_map(fn ($n) => ['tipo' => $n->tipo, 'numero' => $n->numero, 'fecha' => $n->fecha, 'base_ves' => $f($n->base_ves), 'iva_ves' => $f($n->iva_ves), 'total_ves' => $f($n->total_ves), 'motivo' => $n->motivo], $notas);
        $d['acreditable_ves'] = max(0, round($d['totales']['base_ves'] + $d['totales']['exento_ves'] - $acreditado, 2));
        // Venta a crédito con deuda pendiente: una nota de crédito baja esa deuda (SQL 16) y solo el excedente es devolución en dinero.
        $cx = DB::selectOne("SELECT saldo_usd, saldo_ves FROM cuentas_por_cobrar WHERE venta_id = ? AND estado = 'PENDIENTE'", [$id]);
        $d['deuda'] = $cx ? ['saldo_usd' => $f($cx->saldo_usd), 'saldo_ves' => $f($cx->saldo_ves)] : null;
        $d['siguiente_nota'] = ['C' => $this->siguienteNota('C'), 'D' => $this->siguienteNota('D')];
        $d['puede'] = ['anular' => $admin && $v->estado === 'COMPLETADA', 'nota' => $admin && $v->estado === 'COMPLETADA', 'factura' => $v->estado === 'COMPLETADA' && ! $d['factura']];
        $d['factura_automatica'] = (new CajaController())->facturaAutomatica();
        $d['devolucion_activa'] = $this->hayDevolucion();
        return $d;
    }

    /* ───────────── Devolución de mercancía con nota de crédito (12_devolucion_notas.sql) ───────────── */

    public function hayDevolucion(): bool
    {
        return (bool) DB::scalar("SELECT to_regprocedure('fn_devolvibles_venta(bigint)') IS NOT NULL");
    }

    /** Productos de la venta con lo vendido, lo ya devuelto y lo que aún se puede devolver; null si falta el SQL 12. */
    public function devolvibles(int $ventaId): ?array
    {
        if (! $this->hayDevolucion()) {
            return null;
        }
        return array_map(fn ($r) => [
            'producto_id' => (int) $r->producto_id, 'sku' => $r->sku, 'nombre' => $r->nombre,
            'vendida' => (float) $r->vendida, 'devuelta' => (float) $r->devuelta, 'disponible' => (float) $r->disponible,
            'costo_usd' => (float) $r->costo_unitario_usd, 'tasa' => (float) $r->tasa_cambio,
        ], DB::select('SELECT * FROM fn_devolvibles_venta(?)', [$ventaId]));
    }

    public function devolviblesJson(int $id)
    {
        abort_if(! $this->esAdmin(), 403, 'Solo un administrador puede emitir notas.');
        return response()->json(['activo' => $this->hayDevolucion(), 'productos' => $this->devolvibles($id) ?? []]);
    }

    /** Valida la devolución pedida contra lo vendido. Devuelve [devuelve, json_para_el_procedimiento, mensaje_de_error]. */
    public function prepararDevolucion(array $d, int $ventaId): array
    {
        if (! filter_var($d['devuelve_inventario'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return [false, null, null];
        }
        if (($d['tipo'] ?? '') !== 'C') {
            return [false, null, 'Solo una nota de crédito puede devolver mercancía al inventario.'];
        }
        if (! $this->hayDevolucion()) {
            return [false, null, 'Falta ejecutar 12_devolucion_notas.sql en la base de datos.'];
        }
        $pedidos = [];
        foreach ((array) ($d['productos'] ?? []) as $p) {
            $id = (int) ($p['producto_id'] ?? 0);
            $c = (float) ($p['cantidad'] ?? 0);
            if ($id > 0 && $c > 0) {
                $pedidos[$id] = ($pedidos[$id] ?? 0) + $c;
            }
        }
        if (! $pedidos) {
            return [false, null, 'Elige al menos un producto que devuelve el cliente.'];
        }
        $disp = [];
        foreach ($this->devolvibles($ventaId) as $x) {
            $disp[$x['producto_id']] = $x;
        }
        $fmt = fn ($n) => rtrim(rtrim(number_format($n, 3, ',', '.'), '0'), ',');
        foreach ($pedidos as $id => $c) {
            if (! isset($disp[$id])) {
                return [false, null, 'Uno de los productos no forma parte de esta venta.'];
            }
            if ($c > $disp[$id]['disponible'] + 0.0005) {
                $x = $disp[$id];
                return [false, null, "No puedes devolver {$fmt($c)} de «{$x['nombre']}»: se vendieron {$fmt($x['vendida'])}" . ($x['devuelta'] > 0 ? ", ya se devolvieron {$fmt($x['devuelta'])}" : '') . " y quedan {$fmt($x['disponible'])} por devolver."];
            }
        }
        return [true, json_encode(array_map(fn ($id, $c) => ['producto_id' => $id, 'cantidad' => $c], array_keys($pedidos), $pedidos)), null];
    }

    /**
     * Llama a sp_registrar_nota_ajuste (con o sin devolución, según lo que tenga instalada la base).
     * $dinero = ['metodo_pago_id' => int, 'monto' => ?float, 'referencia' => ?string]: devuelve el dinero al cliente y lo anota como EGRESO del turno
     * (fn_devolver_nota_en_caja, 18_devolucion_en_caja.sql). Va en la MISMA transacción que la nota: si no hay turno abierto o el monto excede lo
     * reembolsable, la nota tampoco queda registrada. Solo para notas de crédito.
     */
    public function registrarNota(string $tipo, int $ventaId, string $numero, float $base, string $motivo, ?string $control, ?string $fecha, bool $devuelve, ?string $json, ?array $dinero = null): void
    {
        DB::transaction(function () use ($tipo, $ventaId, $numero, $base, $motivo, $control, $fecha, $devuelve, $json, $dinero) {
            if (! $devuelve && ! $this->hayDevolucion()) {
                DB::statement('CALL sp_registrar_nota_ajuste(?, ?, ?, ?, ?, ?, ?, ?)', [$tipo, $ventaId, $numero, $base, $motivo, auth()->id(), $control, $fecha]);
            } else {
                DB::statement('CALL sp_registrar_nota_ajuste(?, ?, ?, ?, ?, ?, ?, ?, ?::boolean, ?::jsonb)', [$tipo, $ventaId, $numero, $base, $motivo, auth()->id(), $control, $fecha, $devuelve ? 'true' : 'false', $json]);
            }
            if ($tipo === 'C' && $dinero && ! empty($dinero['metodo_pago_id'])) {
                $notaId = (int) DB::scalar('SELECT id FROM notas_ajuste WHERE tipo = ? AND numero = ?', [$tipo, $numero]);
                DB::scalar('SELECT fn_devolver_nota_en_caja(?::bigint, ?::bigint, ?::numeric, ?::bigint, ?::text)',
                    [$notaId, (int) $dinero['metodo_pago_id'], isset($dinero['monto']) && $dinero['monto'] !== '' ? (float) $dinero['monto'] : null, auth()->id(), $dinero['referencia'] ?? null]);
            }
        });
    }

    /** Métodos con los que se puede devolver dinero y si quien emite la nota tiene turno abierto (el efectivo lo exige). */
    public function metodosDevolucion()
    {
        abort_if(! $this->esAdmin(), 403, 'Solo un administrador puede emitir notas.');
        $ok = DB::scalar('SELECT 1 FROM information_schema.routines WHERE routine_schema = ? AND routine_name = ?', ['tienda', 'fn_devolver_nota_en_caja']);
        return response()->json([
            'activo' => (bool) $ok,
            'turno' => $ok ? DB::scalar('SELECT fn_apertura_activa(?)', [auth()->id()]) !== null : false,
            'metodos' => $ok ? array_map(fn ($m) => ['id' => $m->id, 'nombre' => $m->nombre, 'moneda' => $m->moneda, 'efectivo' => (bool) $m->es_efectivo, 'referencia' => (bool) $m->requiere_referencia],
                DB::select('SELECT id, nombre, trim(moneda) AS moneda, es_efectivo, requiere_referencia FROM metodos_pago WHERE activo ORDER BY es_efectivo DESC, nombre')) : [],
        ]);
    }

    /** NC-00000001 / ND-00000001: el siguiente número libre, que se puede cambiar al registrar la nota. */
    private function siguienteNota(string $tipo): string
    {
        $pre = $tipo === 'C' ? 'NC-' : 'ND-';
        $n = (int) DB::scalar("SELECT COALESCE(max(substring(numero FROM '^" . $pre . "(\\d+)$')::bigint), 0) + 1 FROM notas_ajuste WHERE tipo = ?", [$tipo]);
        return $pre . str_pad((string) $n, 8, '0', STR_PAD_LEFT);
    }

    /* ───────────── Anular ───────────── */

    public function anular(Request $r, int $id)
    {
        abort_if(! $this->esAdmin(), 403, 'Solo un administrador puede anular ventas.');
        $d = $r->validate(['motivo' => 'required|string|min:3|max:300'], ['motivo.required' => 'Cuéntanos por qué se anula la venta.', 'motivo.min' => 'Escribe un motivo un poco más claro (mínimo 3 letras).']);
        try {
            DB::statement('CALL sp_anular_venta(?, ?, ?)', [$id, auth()->id(), $d['motivo']]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo anular la venta.')], 422);
        }
        return response()->json($this->detalleDatos($id));
    }

    /* ───────────── Notas de crédito y débito ───────────── */

    public function nota(Request $r, int $id)
    {
        abort_if(! $this->esAdmin(), 403, 'Solo un administrador puede emitir notas.');
        $d = $r->validate([
            'tipo' => 'required|in:C,D', 'base_ves' => 'required|numeric|gt:0', 'motivo' => 'required|string|min:3|max:300', 'numero' => 'nullable|string|max:40',
            'devuelve_inventario' => 'nullable|boolean', 'productos' => 'nullable|array', 'productos.*.producto_id' => 'required_with:productos|integer', 'productos.*.cantidad' => 'required_with:productos|numeric|gt:0',
            'devolucion' => 'nullable|array', 'devolucion.metodo_pago_id' => 'required_with:devolucion|integer', 'devolucion.monto' => 'nullable|numeric|gt:0', 'devolucion.referencia' => 'nullable|string|max:60',
        ], ['base_ves.required' => 'Escribe el monto de la nota.', 'base_ves.gt' => 'El monto debe ser mayor que cero.', 'motivo.required' => 'Escribe el motivo de la nota.', 'motivo.min' => 'Escribe un motivo un poco más claro (mínimo 3 letras).']);
        $det = $this->detalleDatos($id);
        if (! $det || $det['estado'] !== 'COMPLETADA') {
            return response()->json(['message' => 'Esta venta no existe o está anulada.'], 422);
        }
        $base = round((float) $d['base_ves'], 2);
        if ($d['tipo'] === 'C' && $base > $det['acreditable_ves'] + 0.005) {
            $msg = $det['acreditable_ves'] > 0 ? 'Solo puedes acreditar hasta Bs ' . number_format($det['acreditable_ves'], 2, ',', '.') . ' (lo demás ya está en otras notas de crédito).' : 'Esta venta ya tiene notas de crédito por todo su monto.';
            return response()->json(['message' => $msg, 'errors' => ['base_ves' => [$msg]]], 422);
        }
        [$devuelve, $json, $errDev] = $this->prepararDevolucion($d, $id);
        if ($errDev) {
            return response()->json(['message' => $errDev, 'errors' => ['productos' => [$errDev]]], 422);
        }
        $numero = trim((string) ($d['numero'] ?? '')) ?: $this->siguienteNota($d['tipo']);
        try {
            $this->registrarNota($d['tipo'], $id, $numero, $base, $d['motivo'], null, null, $devuelve, $json, $d['devolucion'] ?? null);
        } catch (QueryException $e) {
            $m = $e->getCode() === '23505' ? "Ya existe una nota con el número {$numero}. Usa otro." : $this->mensaje($e, 'No se pudo registrar la nota.');
            return response()->json(['message' => $m, 'errors' => ['numero' => [$m]]], 422);
        }
        return response()->json($this->detalleDatos($id));
    }

    private function mensaje(QueryException $e, string $porDefecto): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }
}
