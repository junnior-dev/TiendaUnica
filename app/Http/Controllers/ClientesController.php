<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Clientes (/clientes): directorio y ficha de cada cliente. Solo administradores.
 *   Lista            → clientes con lo que han comprado (ventas COMPLETADAS; las anuladas no cuentan)
 *   Ficha (JSON)     → compras, ritmo mensual, productos que más compra, cómo suele pagar, retenciones que te practicó
 *   Altas y cambios  → cédula/RIF/pasaporte validados igual que en el punto de venta; una vez que hay ventas el documento ya no se cambia (está en los libros fiscales)
 *   Eliminar         → solo si nunca se le vendió; si no, se desactiva (deja de salir en el punto de venta, el historial se conserva)
 * Los métodos de datos son públicos para poder probarlos sin HTTP.
 */
class ClientesController extends Controller
{
    use ContextoPagina;

    private const ORDENES = ['nombre', 'compras', 'reciente'];
    private const DORMIDO_DIAS = 90;

    public function index(Request $r)
    {
        $this->soloAdmin();
        return Inertia::render('Clientes/Index', [...$this->contexto(), ...$this->datosPagina($r->query())]);
    }

    private function soloAdmin(): void
    {
        abort_if(strtoupper((string) (auth()->user()->rol ?? '')) !== 'ADMINISTRADOR', 403, 'Solo un administrador puede consultar los clientes.');
    }

    private function emisor(): array
    {
        $n = DB::selectOne('SELECT razon_social, nombre_comercial, rif, direccion_fiscal, telefono FROM negocio WHERE id = fn_negocio_actual()');
        return ['razon_social' => $n->razon_social ?? '', 'comercial' => $n->nombre_comercial ?? null, 'rif' => $n->rif ?? '', 'direccion' => $n->direccion_fiscal ?? '', 'telefono' => $n->telefono ?? ''];
    }

    private function hayRetenciones(): bool
    {
        return (bool) DB::scalar("SELECT to_regclass('retenciones_iva') IS NOT NULL");
    }

    /** V-12345678 · J-29876543-2 · P-AB12345 */
    public static function rotulo(string $tipo, string $doc): string
    {
        $tipo = trim($tipo);
        return in_array($tipo, ['J', 'G', 'C'], true) && preg_match('/^\d{9}$/', $doc) ? "{$tipo}-" . substr($doc, 0, 8) . '-' . substr($doc, 8) : "{$tipo}-{$doc}";
    }

    /* ───────────── Datos de la página ───────────── */

    public function datosPagina(array $q): array
    {
        $texto = trim((string) ($q['q'] ?? ''));
        $estado = in_array($q['estado'] ?? '', ['activos', 'inactivos', 'todos'], true) ? $q['estado'] : 'activos';
        $orden = in_array($q['orden'] ?? '', self::ORDENES, true) ? $q['orden'] : 'nombre';
        $ver = ($q['ver'] ?? '') === 'dormidos' ? 'dormidos' : null;
        $dias = self::DORMIDO_DIAS;

        $w = ['TRUE']; $b = [];
        if ($estado === 'activos') $w[] = 'c.activo'; elseif ($estado === 'inactivos') $w[] = 'NOT c.activo';
        if ($ver === 'dormidos') $w[] = "c.activo AND a.ultima IS NOT NULL AND a.ultima < fn_hoy() - {$dias}";
        foreach (preg_split('/\s+/', $texto, -1, PREG_SPLIT_NO_EMPTY) as $x) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $x) . '%';
            $solo = '%' . strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $x)) . '%';
            $w[] = '(unaccent(c.nombre) ILIKE unaccent(?) OR (c.tipo_documento || c.documento) ILIKE ? OR c.documento ILIKE ? OR COALESCE(c.telefono, \'\') ILIKE ? OR unaccent(COALESCE(c.correo, \'\')) ILIKE unaccent(?))';
            array_push($b, $like, $solo, $solo, $like, $like);
        }
        $ord = ['nombre' => 'c.nombre', 'compras' => 'COALESCE(a.usd, 0) DESC, c.nombre', 'reciente' => 'a.ultima DESC NULLS LAST, c.nombre'][$orden];
        $filas = DB::select("SELECT c.id, c.tipo_documento, c.documento, c.nombre, c.telefono, c.correo, c.activo, COALESCE(a.n, 0) AS compras, COALESCE(a.usd, 0) AS usd, a.ultima
                               FROM clientes c
                               LEFT JOIN (SELECT cliente_id, count(*) AS n, sum(total_usd) AS usd, max(COALESCE(fecha_valor, fecha_hora::date)) AS ultima FROM ventas WHERE estado = 'COMPLETADA' AND cliente_id IS NOT NULL GROUP BY cliente_id) a ON a.cliente_id = c.id
                              WHERE " . implode(' AND ', $w) . " ORDER BY {$ord} LIMIT 500", $b);

        $hoy = DB::scalar('SELECT fn_hoy()');
        $k = DB::selectOne("SELECT (SELECT count(*) FROM clientes WHERE activo) AS activos, (SELECT count(*) FROM clientes WHERE NOT activo) AS inactivos,
                                   (SELECT count(*) FROM clientes WHERE activo AND date_trunc('month', created_at AT TIME ZONE 'America/Caracas') = date_trunc('month', fn_hoy()::timestamp)) AS nuevos_mes,
                                   (SELECT count(*) FROM clientes c WHERE c.activo AND EXISTS (SELECT 1 FROM ventas v WHERE v.cliente_id = c.id AND v.estado = 'COMPLETADA')
                                       AND (SELECT max(COALESCE(v.fecha_valor, v.fecha_hora::date)) FROM ventas v WHERE v.cliente_id = c.id AND v.estado = 'COMPLETADA') < fn_hoy() - {$dias}) AS dormidos,
                                   COALESCE(sum(v.total_usd) FILTER (WHERE v.cliente_id IS NOT NULL), 0) AS usd_cli, COALESCE(sum(v.total_usd), 0) AS usd_todo, count(v.id) FILTER (WHERE v.cliente_id IS NOT NULL) AS n_cli
                              FROM (SELECT 1) x LEFT JOIN ventas v ON v.estado = 'COMPLETADA' AND COALESCE(v.fecha_valor, v.fecha_hora::date) > fn_hoy() - 365");
        $top = DB::selectOne("SELECT c.nombre, sum(v.total_usd) AS usd FROM ventas v JOIN clientes c ON c.id = v.cliente_id
                               WHERE v.estado = 'COMPLETADA' AND COALESCE(v.fecha_valor, v.fecha_hora::date) > fn_hoy() - 365 GROUP BY c.id ORDER BY usd DESC LIMIT 1");
        $todo = (float) $k->usd_todo;

        return [
            'filtros' => ['q' => $texto, 'estado' => $estado, 'orden' => $orden, 'ver' => $ver],
            'hoy' => $hoy, 'dormido_dias' => $dias, 'emisor' => $this->emisor(),
            'resumen' => ['activos' => (int) $k->activos, 'inactivos' => (int) $k->inactivos, 'nuevos_mes' => (int) $k->nuevos_mes, 'dormidos' => (int) $k->dormidos,
                'usd_12m' => round((float) $k->usd_cli, 2), 'ventas_12m' => (int) $k->n_cli, 'pct_identificados' => $todo > 0 ? round((float) $k->usd_cli / $todo * 100, 1) : null,
                'mejor' => $top ? ['nombre' => $top->nombre, 'usd' => round((float) $top->usd, 2)] : null],
            'filas' => array_map(fn ($c) => $this->fila($c, $hoy), $filas),
        ];
    }

    private function fila(object $c, string $hoy): array
    {
        $dormido = $c->activo && $c->ultima && (strtotime($hoy) - strtotime($c->ultima)) / 86400 > self::DORMIDO_DIAS;
        return ['id' => (int) $c->id, 'tipo' => trim($c->tipo_documento), 'doc' => self::rotulo($c->tipo_documento, $c->documento), 'nombre' => $c->nombre, 'telefono' => $c->telefono, 'correo' => $c->correo,
            'activo' => (bool) $c->activo, 'compras' => (int) $c->compras, 'usd' => round((float) $c->usd, 2), 'ultima' => $c->ultima, 'dormido' => $dormido];
    }

    /** Ficha completa de un cliente. */
    public function detalle(int $id): ?array
    {
        $c = DB::selectOne('SELECT * FROM clientes WHERE id = ?', [$id]);
        if (! $c) return null;
        $hoy = DB::scalar('SELECT fn_hoy()');
        $s = DB::selectOne("SELECT count(*) FILTER (WHERE v.estado = 'COMPLETADA') AS n, count(*) FILTER (WHERE v.estado = 'ANULADA') AS anuladas,
                                   COALESCE(sum(v.total_usd) FILTER (WHERE v.estado = 'COMPLETADA'), 0) AS usd,
                                   min(COALESCE(v.fecha_valor, v.fecha_hora::date)) FILTER (WHERE v.estado = 'COMPLETADA') AS primera,
                                   max(COALESCE(v.fecha_valor, v.fecha_hora::date)) FILTER (WHERE v.estado = 'COMPLETADA') AS ultima
                              FROM ventas v WHERE v.cliente_id = ?", [$id]);
        $n = (int) $s->n;

        $meses = DB::select("SELECT to_char(m, 'YYYY-MM') AS mes, COALESCE(sum(v.total_usd), 0) AS usd, count(v.id) AS n
                               FROM generate_series(date_trunc('month', ?::date) - interval '11 months', date_trunc('month', ?::date), interval '1 month') m
                               LEFT JOIN ventas v ON v.cliente_id = ? AND v.estado = 'COMPLETADA' AND date_trunc('month', COALESCE(v.fecha_valor, v.fecha_hora::date)) = m
                              GROUP BY m ORDER BY m", [$hoy, $hoy, $id]);
        $recientes = DB::select("SELECT v.id, COALESCE(v.fecha_valor, v.fecha_hora::date) AS fecha, v.numero, v.numero_factura_fiscal, v.total_usd, v.estado
                                   FROM ventas v WHERE v.cliente_id = ? ORDER BY COALESCE(v.fecha_valor, v.fecha_hora::date) DESC, v.id DESC LIMIT 8", [$id]);
        $prods = DB::select("SELECT pr.id, pr.nombre, pr.sku, sum(d.cantidad) AS unidades, sum(COALESCE(d.total_usd, 0)) AS usd
                               FROM detalle_venta d JOIN ventas v ON v.id = d.venta_id JOIN productos pr ON pr.id = d.producto_id
                              WHERE v.cliente_id = ? AND v.estado = 'COMPLETADA' GROUP BY pr.id ORDER BY usd DESC LIMIT 5", [$id]);
        $pagos = DB::select("SELECT m.nombre, count(DISTINCT p.venta_id) AS n FROM pagos_venta p JOIN ventas v ON v.id = p.venta_id JOIN metodos_pago m ON m.id = p.metodo_pago_id
                              WHERE v.cliente_id = ? AND v.estado = 'COMPLETADA' GROUP BY m.id, m.nombre ORDER BY n DESC, m.nombre LIMIT 3", [$id]);
        $ret = null;
        if ($this->hayRetenciones()) {
            $r = DB::selectOne("SELECT count(*) AS n, COALESCE(sum(r.iva_retenido_ves), 0) AS ves FROM retenciones_iva r JOIN ventas v ON v.id = r.venta_id
                                 WHERE r.sentido = 'VENTA' AND r.estado = 'ACTIVA' AND v.cliente_id = ?", [$id]);
            $ret = ['n' => (int) $r->n, 'ves' => round((float) $r->ves, 2)];
        }
        $cada = $n >= 3 && $s->primera && $s->ultima ? (int) round((strtotime($s->ultima) - strtotime($s->primera)) / 86400 / ($n - 1)) : null;
        $sin = $s->ultima ? (int) round((strtotime($hoy) - strtotime($s->ultima)) / 86400) : null;
        $total = max(array_sum(array_map(fn ($x) => (int) $x->n, $pagos)), 1);

        return [
            'id' => (int) $c->id, 'tipo' => trim($c->tipo_documento), 'documento' => $c->documento, 'doc' => self::rotulo($c->tipo_documento, $c->documento), 'nombre' => $c->nombre,
            'telefono' => $c->telefono, 'correo' => $c->correo, 'direccion' => $c->direccion, 'activo' => (bool) $c->activo, 'desde' => substr((string) $c->created_at, 0, 10),
            'compras' => $n, 'anuladas' => (int) $s->anuladas, 'usd' => round((float) $s->usd, 2), 'promedio_usd' => $n ? round((float) $s->usd / $n, 2) : 0.0, 'primera' => $s->primera, 'ultima' => $s->ultima,
            'cada_dias' => $cada, 'dias_sin_comprar' => $sin, 'dormido' => (bool) $c->activo && $sin !== null && $sin > self::DORMIDO_DIAS,
            'puede_eliminar' => ((int) $s->n + (int) $s->anuladas) === 0, 'retenciones' => $ret,
            'meses' => array_map(fn ($m) => ['mes' => $m->mes, 'usd' => round((float) $m->usd, 2), 'n' => (int) $m->n], $meses),
            'recientes' => array_map(fn ($v) => ['id' => (int) $v->id, 'fecha' => $v->fecha, 'numero' => (int) $v->numero, 'factura' => $v->numero_factura_fiscal, 'total_usd' => (float) $v->total_usd, 'estado' => $v->estado], $recientes),
            'productos' => array_map(fn ($x) => ['id' => (int) $x->id, 'nombre' => $x->nombre, 'sku' => $x->sku, 'unidades' => (float) $x->unidades, 'usd' => round((float) $x->usd, 2)], $prods),
            'paga_con' => array_map(fn ($x) => ['nombre' => $x->nombre, 'pct' => (int) round((int) $x->n / $total * 100)], $pagos),
        ];
    }

    public function show(int $id)
    {
        $this->soloAdmin();
        $d = $this->detalle($id);
        return $d ? response()->json($d) : $this->error('Ese cliente ya no existe.', 404);
    }

    /* ───────────── Altas, cambios, estado y baja (JSON) ───────────── */

    /** @return array{0: ?array, 1: mixed} [datos, respuesta de error] */
    private function validar(Request $r, ?int $id = null): array
    {
        $d = $r->validate([
            'tipo' => 'required|in:V,E,J,G,P,C', 'documento' => 'required|string|max:30', 'nombre' => 'required|string|min:2|max:200',
            'telefono' => 'nullable|string|max:40', 'correo' => 'nullable|email|max:150', 'direccion' => 'nullable|string|max:300',
        ], ['tipo.required' => 'Elige el tipo de documento.', 'nombre.required' => 'Escribe el nombre o la razón social.', 'nombre.min' => 'El nombre es muy corto.', 'documento.required' => 'Escribe la cédula o el RIF.', 'correo.email' => 'Ese correo no parece válido.']);
        $tipo = $d['tipo'];
        $doc = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $d['documento']));
        if (in_array($tipo, ['J', 'G', 'C', 'V', 'E'], true) && str_starts_with($doc, $tipo) && strlen($doc) > 1 && ctype_digit(substr($doc, 1))) $doc = substr($doc, 1); // quitó la letra repetida: «J-298765432»
        $falla = fn (string $m) => [null, $this->error($m, 422, ['documento' => [$m]])];
        if (in_array($tipo, ['V', 'E'], true) && ! preg_match('/^\d{5,9}$/', $doc)) return $falla('La cédula tiene entre 5 y 9 números.');
        if (in_array($tipo, ['J', 'G', 'C'], true) && (! preg_match('/^\d{9}$/', $doc) || ! DB::scalar('SELECT fn_validar_rif(?)', [$tipo . $doc]))) return $falla('El RIF no es válido: revisa el último dígito. Ejemplo: J-12345678-4.');
        if ($tipo === 'P' && ! preg_match('/^[A-Z0-9]{5,20}$/', $doc)) return $falla('El pasaporte tiene entre 5 y 20 letras o números.');
        if (DB::selectOne('SELECT 1 AS x FROM clientes WHERE tipo_documento = ? AND documento = ? AND id <> ?', [$tipo, $doc, $id ?? 0])) return $falla('Ya tienes un cliente con ese documento.');
        $n = fn ($v) => ($v = trim((string) $v)) === '' ? null : $v;
        return [['tipo' => $tipo, 'documento' => $doc, 'nombre' => trim($d['nombre']), 'telefono' => $n($d['telefono'] ?? null), 'correo' => $n($d['correo'] ?? null), 'direccion' => $n($d['direccion'] ?? null)], null];
    }

    public function store(Request $r)
    {
        $this->soloAdmin();
        [$d, $err] = $this->validar($r); if ($err) return $err;
        try {
            $id = (int) DB::scalar('INSERT INTO clientes (tipo_documento, documento, nombre, telefono, correo, direccion) VALUES (?, ?, ?, ?, ?, ?) RETURNING id', [$d['tipo'], $d['documento'], $d['nombre'], $d['telefono'], $d['correo'], $d['direccion']]);
        } catch (QueryException $e) { return $this->error($this->mensaje($e, 'No se pudo guardar el cliente.')); }
        return response()->json(['ok' => true, 'id' => $id, 'detalle' => $this->detalle($id)]);
    }

    public function update(Request $r, $id)
    {
        $this->soloAdmin(); $id = (int) $id;
        $actual = DB::selectOne('SELECT tipo_documento, documento FROM clientes WHERE id = ?', [$id]);
        if (! $actual) return $this->error('Ese cliente ya no existe.', 404);
        [$d, $err] = $this->validar($r, $id); if ($err) return $err;
        $conVentas = (bool) DB::scalar('SELECT EXISTS (SELECT 1 FROM ventas WHERE cliente_id = ?)', [$id]);
        if ($conVentas && ($d['tipo'] !== trim($actual->tipo_documento) || $d['documento'] !== $actual->documento)) {
            return $this->error('Este cliente ya tiene ventas: su documento aparece en tus libros fiscales y no se puede cambiar.', 422, ['documento' => ['El documento no se puede cambiar porque ya tiene ventas.']]);
        }
        try {
            DB::update('UPDATE clientes SET tipo_documento = ?, documento = ?, nombre = ?, telefono = ?, correo = ?, direccion = ? WHERE id = ?', [$d['tipo'], $d['documento'], $d['nombre'], $d['telefono'], $d['correo'], $d['direccion'], $id]);
        } catch (QueryException $e) { return $this->error($this->mensaje($e, 'No se pudo guardar el cliente.')); }
        return response()->json(['ok' => true, 'id' => $id, 'detalle' => $this->detalle($id)]);
    }

    public function estado(Request $r, $id)
    {
        $this->soloAdmin(); $id = (int) $id;
        if (! DB::scalar('SELECT 1 FROM clientes WHERE id = ?', [$id])) return $this->error('Ese cliente ya no existe.', 404);
        DB::update('UPDATE clientes SET activo = ? WHERE id = ?', [$r->boolean('activo'), $id]);
        return response()->json(['ok' => true, 'id' => $id, 'detalle' => $this->detalle($id)]);
    }

    public function destroy($id)
    {
        $this->soloAdmin(); $id = (int) $id;
        if (! DB::scalar('SELECT 1 FROM clientes WHERE id = ?', [$id])) return $this->error('Ese cliente ya no existe.', 404);
        if (DB::scalar('SELECT EXISTS (SELECT 1 FROM ventas WHERE cliente_id = ?)', [$id])) return $this->error('Este cliente tiene ventas registradas: no se puede eliminar. Puedes desactivarlo.');
        try { DB::delete('DELETE FROM clientes WHERE id = ?', [$id]); } catch (QueryException $e) { return $this->error($this->mensaje($e, 'No se pudo eliminar el cliente.')); }
        return response()->json(['ok' => true, 'id' => $id]);
    }

    private function error(string $m, int $status = 422, array $errors = [])
    {
        return response()->json(['message' => $m] + ($errors ? ['errors' => $errors] : []), $status);
    }

    private function mensaje(QueryException $e, string $porDefecto): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }
}
