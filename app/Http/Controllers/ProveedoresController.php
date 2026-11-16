<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Proveedores (/proveedores): directorio y expediente de cada proveedor. Solo administradores.
 *   Lista            → proveedores con lo comprado en 12 meses (compras REGISTRADAS; las anuladas no cuentan)
 *   Expediente (JSON)→ compras, ritmo mensual, productos que más se le compran, retenciones pendientes
 *   Altas y cambios  → el RIF lo valida fn_validar_rif; una vez que hay compras el RIF ya no se cambia (está en los libros fiscales)
 *   Eliminar         → solo si nunca se le compró; si no, se desactiva (deja de salir al registrar compras, el historial se conserva)
 * Los métodos de datos son públicos para poder probarlos sin HTTP.
 */
class ProveedoresController extends Controller
{
    use ContextoPagina;

    private const ORDENES = ['nombre', 'compras', 'reciente'];

    public function index(Request $r)
    {
        $this->soloAdmin();
        return Inertia::render('Proveedores/Index', [...$this->contexto(), ...$this->datosPagina($r->query())]);
    }

    private function soloAdmin(): void
    {
        abort_if(strtoupper((string) (auth()->user()->rol ?? '')) !== 'ADMINISTRADOR', 403, 'Solo un administrador puede consultar los proveedores.');
    }

    private function emisor(): array
    {
        $n = DB::selectOne('SELECT razon_social, nombre_comercial, rif, direccion_fiscal, telefono FROM negocio WHERE id = fn_negocio_actual()');
        return ['razon_social' => $n->razon_social ?? '', 'comercial' => $n->nombre_comercial ?? null, 'rif' => $n->rif ?? '', 'direccion' => $n->direccion_fiscal ?? '', 'telefono' => $n->telefono ?? ''];
    }

    /** ¿Está instalado 11_cierre_y_pagos.sql (compras a crédito y pagos a proveedores)? */
    private function hayCxp(): bool
    {
        return (bool) DB::scalar("SELECT to_regclass('pagos_proveedor') IS NOT NULL");
    }

    private function hayRetenciones(): bool
    {
        return (bool) DB::scalar("SELECT to_regclass('retenciones_iva') IS NOT NULL AND to_regclass('compras_importacion') IS NOT NULL");
    }

    /* ───────────── Datos de la página ───────────── */

    public function datosPagina(array $q): array
    {
        $texto = trim((string) ($q['q'] ?? ''));
        $estado = in_array($q['estado'] ?? '', ['activos', 'inactivos', 'todos'], true) ? $q['estado'] : 'activos';
        $orden = in_array($q['orden'] ?? '', self::ORDENES, true) ? $q['orden'] : 'nombre';
        $ver = ctype_digit((string) ($q['ver'] ?? '')) ? (int) $q['ver'] : null;

        $w = ['TRUE']; $b = [];
        if ($estado === 'activos') $w[] = 'p.activo'; elseif ($estado === 'inactivos') $w[] = 'NOT p.activo';
        foreach (preg_split('/\s+/', $texto, -1, PREG_SPLIT_NO_EMPTY) as $x) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $x) . '%';
            $w[] = '(unaccent(p.razon_social) ILIKE unaccent(?) OR p.rif ILIKE ? OR COALESCE(p.telefono, \'\') ILIKE ? OR unaccent(COALESCE(p.correo, \'\')) ILIKE unaccent(?))';
            array_push($b, $like, $like, $like, $like);
        }
        $ord = ['nombre' => 'p.razon_social', 'compras' => 'COALESCE(a.usd, 0) DESC, p.razon_social', 'reciente' => 'a.ultima DESC NULLS LAST, p.razon_social'][$orden];
        $filas = DB::select("SELECT p.id, p.rif, p.razon_social, p.telefono, p.correo, p.activo, COALESCE(a.n, 0) AS compras, COALESCE(a.usd, 0) AS usd, a.ultima
                               FROM proveedores p
                               LEFT JOIN (SELECT proveedor_id, count(*) AS n, sum(total_usd) AS usd, max(fecha_factura) AS ultima FROM compras WHERE estado = 'REGISTRADA' GROUP BY proveedor_id) a ON a.proveedor_id = p.id
                              WHERE " . implode(' AND ', $w) . " ORDER BY {$ord} LIMIT 500", $b);

        $k = DB::selectOne("SELECT (SELECT count(*) FROM proveedores WHERE activo) AS activos, (SELECT count(*) FROM proveedores WHERE NOT activo) AS inactivos,
                                   (SELECT count(*) FROM proveedores p WHERE p.activo AND NOT EXISTS (SELECT 1 FROM compras c WHERE c.proveedor_id = p.id AND c.estado = 'REGISTRADA')) AS sin_compras,
                                   COALESCE(sum(total_usd), 0) AS usd, count(*) AS n
                              FROM compras WHERE estado = 'REGISTRADA' AND fecha_factura > fn_hoy() - 365");
        $top = DB::selectOne("SELECT p.razon_social, sum(c.total_usd) AS usd FROM compras c JOIN proveedores p ON p.id = c.proveedor_id
                               WHERE c.estado = 'REGISTRADA' AND c.fecha_factura > fn_hoy() - 365 GROUP BY p.id ORDER BY usd DESC LIMIT 1");
        $total = (float) $k->usd;
        $principal = $top && $total > 0 ? ['nombre' => $top->razon_social, 'pct' => round((float) $top->usd / $total * 100, 1)] : null;
        $hoy = DB::scalar('SELECT fn_hoy()');

        return [
            'filtros' => ['q' => $texto, 'estado' => $estado, 'orden' => $orden, 'ver' => $ver],
            'hoy' => $hoy, 'emisor' => $this->emisor(), 'cxp' => $this->hayCxp(),
            'resumen' => ['activos' => (int) $k->activos, 'inactivos' => (int) $k->inactivos, 'sin_compras' => (int) $k->sin_compras, 'usd_12m' => round($total, 2), 'compras_12m' => (int) $k->n, 'principal' => $principal],
            'filas' => array_map(fn ($p) => $this->fila($p), $filas),
        ];
    }

    private function fila(object $p): array
    {
        return ['id' => (int) $p->id, 'rif' => $p->rif, 'nombre' => $p->razon_social, 'telefono' => $p->telefono, 'correo' => $p->correo, 'activo' => (bool) $p->activo,
            'compras' => (int) $p->compras, 'usd' => round((float) $p->usd, 2), 'ultima' => $p->ultima];
    }

    /** Expediente completo de un proveedor. */
    public function detalle(int $id): ?array
    {
        $p = DB::selectOne('SELECT * FROM proveedores WHERE id = ?', [$id]);
        if (! $p) return null;
        $hoy = DB::scalar('SELECT fn_hoy()');
        $s = DB::selectOne("SELECT count(*) FILTER (WHERE c.estado = 'REGISTRADA') AS n, count(*) FILTER (WHERE c.estado = 'ANULADA') AS anuladas,
                                   COALESCE(sum(c.total_usd) FILTER (WHERE c.estado = 'REGISTRADA'), 0) AS usd, min(c.fecha_factura) FILTER (WHERE c.estado = 'REGISTRADA') AS primera,
                                   max(c.fecha_factura) FILTER (WHERE c.estado = 'REGISTRADA') AS ultima, COALESCE(sum(l.credito_fiscal_ves) FILTER (WHERE c.estado = 'REGISTRADA'), 0) AS credito_ves
                              FROM compras c LEFT JOIN v_libro_compras l ON l.compra_id = c.id WHERE c.proveedor_id = ?", [$id]);
        $n = (int) $s->n;

        // Últimos 12 meses (incluye los meses sin compras, para que el gráfico sea honesto).
        $meses = DB::select("SELECT to_char(m, 'YYYY-MM') AS mes, COALESCE(sum(c.total_usd), 0) AS usd, count(c.id) AS n
                               FROM generate_series(date_trunc('month', ?::date) - interval '11 months', date_trunc('month', ?::date), interval '1 month') m
                               LEFT JOIN compras c ON c.proveedor_id = ? AND c.estado = 'REGISTRADA' AND date_trunc('month', c.fecha_factura) = m
                              GROUP BY m ORDER BY m", [$hoy, $hoy, $id]);

        $ret = $this->hayRetenciones();
        $recientes = DB::select("SELECT c.id, c.fecha_factura, c.numero_factura, c.numero_control, c.moneda, c.total, c.total_usd, c.estado,
                                        " . ($ret ? 'r.porcentaje AS ret_pct, (i.compra_id IS NOT NULL) AS importacion' : 'NULL::numeric AS ret_pct, FALSE AS importacion') . "
                                   FROM compras c " . ($ret ? "LEFT JOIN retenciones_iva r ON r.compra_id = c.id AND r.estado = 'ACTIVA' LEFT JOIN compras_importacion i ON i.compra_id = c.id " : '') . "
                                  WHERE c.proveedor_id = ? ORDER BY c.fecha_factura DESC, c.id DESC LIMIT 8", [$id]);
        $prods = DB::select("SELECT pr.id, pr.nombre, pr.sku, sum(d.cantidad) AS unidades, sum(d.cantidad * COALESCE(d.costo_unitario_usd, 0)) AS usd
                               FROM compra_detalle d JOIN compras c ON c.id = d.compra_id JOIN productos pr ON pr.id = d.producto_id
                              WHERE c.proveedor_id = ? AND c.estado = 'REGISTRADA' GROUP BY pr.id ORDER BY usd DESC LIMIT 5", [$id]);

        $esp = (bool) DB::scalar('SELECT es_contribuyente_especial FROM negocio WHERE id = fn_negocio_actual()');
        $pend = null;
        if ($ret && $esp) {
            $pend = (int) DB::scalar("SELECT count(*) FROM compras c WHERE c.proveedor_id = ? AND c.estado = 'REGISTRADA' AND c.monto_iva > 0
                                       AND NOT EXISTS (SELECT 1 FROM retenciones_iva r WHERE r.compra_id = c.id AND r.estado = 'ACTIVA') AND NOT EXISTS (SELECT 1 FROM compras_importacion i WHERE i.compra_id = c.id)", [$id]);
        }
        // Cada cuántos días se le compra, en promedio (solo con 3 compras o más, para no inventar un ritmo).
        $cada = $n >= 3 && $s->primera && $s->ultima ? (int) round((strtotime($s->ultima) - strtotime($s->primera)) / 86400 / ($n - 1)) : null;

        return [
            'id' => (int) $p->id, 'rif' => $p->rif, 'nombre' => $p->razon_social, 'telefono' => $p->telefono, 'correo' => $p->correo, 'direccion' => $p->direccion, 'activo' => (bool) $p->activo,
            'desde' => substr((string) $p->created_at, 0, 10), 'rif_valido' => (bool) DB::scalar('SELECT fn_validar_rif(?)', [$p->rif]),
            'compras' => $n, 'anuladas' => (int) $s->anuladas, 'usd' => round((float) $s->usd, 2), 'promedio_usd' => $n ? round((float) $s->usd / $n, 2) : 0.0, 'primera' => $s->primera, 'ultima' => $s->ultima,
            'credito_ves' => round((float) $s->credito_ves, 2), 'cada_dias' => $cada, 'retenciones_pendientes' => $pend, 'puede_eliminar' => ((int) $s->n + (int) $s->anuladas) === 0,
            'meses' => array_map(fn ($m) => ['mes' => $m->mes, 'usd' => round((float) $m->usd, 2), 'n' => (int) $m->n], $meses),
            'recientes' => array_map(fn ($c) => ['id' => (int) $c->id, 'fecha' => $c->fecha_factura, 'factura' => $c->numero_factura, 'control' => $c->numero_control, 'moneda' => trim($c->moneda), 'total' => (float) $c->total,
                'total_usd' => (float) $c->total_usd, 'estado' => $c->estado, 'ret_pct' => $c->ret_pct === null ? null : (float) $c->ret_pct, 'importacion' => (bool) $c->importacion], $recientes),
            'productos' => array_map(fn ($x) => ['id' => (int) $x->id, 'nombre' => $x->nombre, 'sku' => $x->sku, 'unidades' => (float) $x->unidades, 'usd' => round((float) $x->usd, 2)], $prods),
            'dias_credito' => $this->hayCxp() ? (int) $p->dias_credito : null,
            'cxp' => $this->hayCxp() ? $this->resumenCxp($id, $hoy) : null,
        ];
    }


    /* ───────────── Cuentas por pagar: estado de cuenta, pagos ───────────── */

    /** Lo que se le debe, lo vencido y lo próximo a vencer. */
    private function resumenCxp(int $id, string $hoy): array
    {
        $r = DB::selectOne("SELECT count(*) FILTER (WHERE saldo_usd > 0) AS pendientes, COALESCE(sum(saldo_usd) FILTER (WHERE saldo_usd > 0), 0) AS saldo,
                                   COALESCE(sum(saldo_usd) FILTER (WHERE saldo_usd > 0 AND dias_para_vencer < 0), 0) AS vencido, count(*) AS a_credito
                              FROM v_cuentas_por_pagar WHERE proveedor_id = ?", [$id]);
        $prox = DB::selectOne("SELECT numero_factura, fecha_vencimiento, dias_para_vencer, saldo_usd FROM v_cuentas_por_pagar WHERE proveedor_id = ? AND saldo_usd > 0 ORDER BY fecha_vencimiento, compra_id LIMIT 1", [$id]);
        return ['a_credito' => (int) $r->a_credito, 'pendientes' => (int) $r->pendientes, 'saldo_usd' => round((float) $r->saldo, 2), 'vencido_usd' => round((float) $r->vencido, 2),
            'proxima' => $prox ? ['factura' => $prox->numero_factura, 'vence' => $prox->fecha_vencimiento, 'dias' => (int) $prox->dias_para_vencer, 'saldo_usd' => round((float) $prox->saldo_usd, 2)] : null];
    }

    /** Estado de cuenta: todas las facturas del proveedor con su saldo, la antigüedad de lo vencido y los pagos. */
    public function estadoCuenta(int $id): ?array
    {
        $p = DB::selectOne('SELECT id, rif, razon_social, telefono, dias_credito FROM proveedores WHERE id = ?', [$id]);
        if (! $p || ! $this->hayCxp()) return null;
        $hoy = DB::scalar('SELECT fn_hoy()');
        $filas = DB::select("SELECT c.id, c.numero_factura, c.fecha_factura, c.condicion_pago, c.fecha_vencimiento, c.total_usd, c.estado,
                                    COALESCE(v.pagado_usd, 0) AS pagado, COALESCE(v.saldo_usd, 0) AS saldo, v.dias_para_vencer
                               FROM compras c LEFT JOIN v_cuentas_por_pagar v ON v.compra_id = c.id
                              WHERE c.proveedor_id = ? ORDER BY c.fecha_factura DESC, c.id DESC LIMIT 300", [$id]);
        $ant = ['por_vencer' => 0.0, 'd1_30' => 0.0, 'd31_60' => 0.0, 'd61_90' => 0.0, 'd90_mas' => 0.0];
        $out = []; $tot = ['facturado' => 0.0, 'pagado' => 0.0, 'saldo' => 0.0];
        foreach ($filas as $f) {
            $credito = $f->condicion_pago === 'CREDITO'; $anulada = $f->estado === 'ANULADA';
            $saldo = $credito && ! $anulada ? round((float) $f->saldo, 2) : 0.0; $dias = $f->dias_para_vencer === null ? null : (int) $f->dias_para_vencer;
            $sit = $anulada ? 'anulada' : (! $credito ? 'contado' : ($saldo <= 0 ? 'pagada' : ($dias < 0 ? 'vencida' : ($dias <= 7 ? 'por_vencer' : 'al_dia'))));
            if ($saldo > 0) {
                $k = $dias >= 0 ? 'por_vencer' : (-$dias <= 30 ? 'd1_30' : (-$dias <= 60 ? 'd31_60' : (-$dias <= 90 ? 'd61_90' : 'd90_mas')));
                $ant[$k] += $saldo;
            }
            if (! $anulada) { $tot['facturado'] += (float) $f->total_usd; $tot['pagado'] += $credito ? (float) $f->pagado : (float) $f->total_usd; $tot['saldo'] += $saldo; }
            $out[] = ['id' => (int) $f->id, 'factura' => $f->numero_factura, 'fecha' => $f->fecha_factura, 'vence' => $f->fecha_vencimiento, 'condicion' => $f->condicion_pago, 'total_usd' => (float) $f->total_usd,
                'pagado_usd' => $credito ? round((float) $f->pagado, 2) : (float) $f->total_usd, 'saldo_usd' => $saldo, 'dias' => $dias, 'situacion' => $sit];
        }
        $pagos = DB::select("SELECT p.id, p.fecha, p.moneda, p.monto, p.monto_usd, p.referencia, p.fondos, p.estado, p.observaciones, p.motivo_anulacion,
                                    (SELECT string_agg(c.numero_factura || ' (US$ ' || to_char(a.monto_usd, 'FM999G990D00') || ')', ', ' ORDER BY a.id) FROM pagos_proveedor_aplicacion a JOIN compras c ON c.id = a.compra_id WHERE a.pago_id = p.id) AS aplicado
                               FROM pagos_proveedor p WHERE p.proveedor_id = ? ORDER BY p.fecha DESC, p.id DESC LIMIT 100", [$id]);
        return [
            'proveedor' => ['id' => (int) $p->id, 'rif' => $p->rif, 'nombre' => $p->razon_social, 'telefono' => $p->telefono, 'dias_credito' => (int) $p->dias_credito],
            'hoy' => $hoy, 'emisor' => $this->emisor(), 'filas' => $out,
            'totales' => array_map(fn ($x) => round($x, 2), $tot), 'antiguedad' => array_map(fn ($x) => round($x, 2), $ant),
            'pagos' => array_map(fn ($x) => ['id' => (int) $x->id, 'fecha' => $x->fecha, 'moneda' => trim($x->moneda), 'monto' => (float) $x->monto, 'monto_usd' => (float) $x->monto_usd, 'referencia' => $x->referencia,
                'fondos' => $x->fondos, 'estado' => $x->estado, 'aplicado' => $x->aplicado, 'motivo_anulacion' => $x->motivo_anulacion], $pagos),
            'pendientes' => array_values(array_map(fn ($f) => ['id' => $f['id'], 'factura' => $f['factura'], 'saldo_usd' => $f['saldo_usd'], 'vence' => $f['vence'], 'dias' => $f['dias']], array_filter($out, fn ($f) => $f['saldo_usd'] > 0))),
            'monedas' => array_map(fn ($m) => ['codigo' => trim($m->codigo), 'nombre' => $m->nombre], DB::select('SELECT codigo, nombre FROM monedas WHERE activa ORDER BY (codigo = \'USD\') DESC, (codigo = \'VES\') DESC, codigo')),
        ];
    }

    public function cuenta(int $id)
    {
        $this->soloAdmin();
        $d = $this->estadoCuenta($id);
        return $d ? response()->json($d) : $this->error('Falta instalar 11_cierre_y_pagos.sql o el proveedor ya no existe.', 404);
    }

    /** Datos del expediente en PDF: ficha, lo comprado en el año y las últimas 20 compras. */
    public function expedienteDatos(int $id): ?array
    {
        $d = $this->detalle($id);
        if (! $d) return null;
        $hoy = DB::scalar('SELECT fn_hoy()'); $anio = (int) substr($hoy, 0, 4);
        $a = DB::selectOne("SELECT count(*) AS n, COALESCE(sum(total_usd), 0) AS usd FROM compras WHERE proveedor_id = ? AND estado = 'REGISTRADA' AND extract(year FROM fecha_factura) = ?", [$id, $anio]);
        $ult = DB::select("SELECT c.fecha_factura, c.numero_factura, c.numero_control, c.moneda, c.total, c.total_usd, c.estado FROM compras c WHERE c.proveedor_id = ? ORDER BY c.fecha_factura DESC, c.id DESC LIMIT 20", [$id]);
        return ['detalle' => $d, 'hoy' => $hoy, 'emisor' => $this->emisor(), 'anio' => $anio, 'compras_anio' => (int) $a->n, 'usd_anio' => round((float) $a->usd, 2),
            'ultimas' => array_map(fn ($c) => ['fecha' => $c->fecha_factura, 'factura' => $c->numero_factura, 'control' => $c->numero_control, 'moneda' => trim($c->moneda), 'total' => (float) $c->total, 'total_usd' => (float) $c->total_usd, 'estado' => $c->estado], $ult)];
    }

    public function expediente(int $id)
    {
        $this->soloAdmin();
        $d = $this->expedienteDatos($id);
        return $d ? response()->json($d) : $this->error('Ese proveedor ya no existe.', 404);
    }

    /** Cuánto vale un pago en USD y en Bs con la tasa de esa fecha (para mostrarlo mientras se escribe). */
    public function cotizarPago(Request $r)
    {
        $this->soloAdmin();
        $m = strtoupper((string) $r->query('moneda', 'USD')); $f = (string) $r->query('fecha', '');
        $monto = (float) $r->query('monto', 0);
        if (! preg_match('/^[A-Z]{3}$/', $m) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $f)) return response()->json(['ok' => false, 'mensaje' => 'Elige la moneda y la fecha.']);
        try {
            $tUsd = $m === 'USD' ? 1.0 : (float) DB::scalar('SELECT fn_tasa_par(?, ?, ?::date)', [$m, 'USD', $f]);
            $tVes = $m === 'VES' ? 1.0 : (float) DB::scalar('SELECT fn_tasa_par(?, ?, ?::date)', [$m, 'VES', $f]);
        } catch (QueryException $e) { return response()->json(['ok' => false, 'mensaje' => $this->mensaje($e, 'No hay tasa de cambio para esa fecha.')]); }
        return response()->json(['ok' => true, 'tasa_usd' => $tUsd, 'tasa_ves' => $tVes, 'monto_usd' => round($monto * $tUsd, 2), 'monto_ves' => round($monto * $tVes, 2)]);
    }

    public function pagar(Request $r, $id)
    {
        $this->soloAdmin(); $id = (int) $id;
        if (! $this->hayCxp()) return $this->error('Falta ejecutar 11_cierre_y_pagos.sql en la base de datos.');
        if (! DB::scalar('SELECT 1 FROM proveedores WHERE id = ?', [$id])) return $this->error('Ese proveedor ya no existe.', 404);
        $v = $r->validate(['fecha' => 'required|date_format:Y-m-d|before_or_equal:today', 'moneda' => 'required|string|size:3', 'monto' => 'required|numeric|gt:0|max:999999999999', 'referencia' => 'nullable|string|max:60',
            'fondos' => 'required|in:CAJA,BANCOS', 'compra_id' => 'nullable|integer', 'observaciones' => 'nullable|string|max:300'],
            ['fecha.required' => 'Elige la fecha del pago.', 'fecha.before_or_equal' => 'La fecha del pago no puede ser futura.', 'monto.required' => 'Escribe el monto pagado.', 'monto.gt' => 'El monto debe ser mayor que cero.', 'fondos.required' => 'Indica si salió de caja o de bancos.']);
        try {
            $pid = (int) DB::transaction(fn () => DB::scalar('SELECT fn_registrar_pago_proveedor(?::bigint, ?::date, ?::char(3), ?::numeric, ?::text, ?::text, ?::bigint, ?::bigint, ?::text)',
                [$id, $v['fecha'], strtoupper($v['moneda']), $v['monto'], $v['referencia'] ?? null, $v['fondos'], $v['compra_id'] ?? null, auth()->id(), $v['observaciones'] ?? null]));
        } catch (QueryException $e) { return $this->error($this->mensaje($e, 'No se pudo registrar el pago.')); }
        $asiento = (bool) DB::scalar("SELECT EXISTS (SELECT 1 FROM asientos WHERE origen_tipo = 'PAGO_PROVEEDOR' AND origen_id = ?)", [$pid]);
        return response()->json(['ok' => true, 'id' => $pid, 'con_asiento' => $asiento, 'detalle' => $this->detalle($id), 'cuenta' => $this->estadoCuenta($id)]);
    }

    public function pagoAnular(Request $r, $id, $pago)
    {
        $this->soloAdmin(); $id = (int) $id; $pago = (int) $pago;
        $v = $r->validate(['motivo' => 'required|string|min:3|max:200'], ['motivo.required' => 'Escribe el motivo de la anulación.', 'motivo.min' => 'Escribe el motivo de la anulación.']);
        if (! DB::scalar('SELECT 1 FROM pagos_proveedor WHERE id = ? AND proveedor_id = ?', [$pago, $id])) return $this->error('Ese pago no existe.', 404);
        try { DB::transaction(fn () => DB::statement('SELECT fn_anular_pago_proveedor(?::bigint, ?::text, ?::bigint)', [$pago, $v['motivo'], auth()->id()])); }
        catch (QueryException $e) { return $this->error($this->mensaje($e, 'No se pudo anular el pago.')); }
        return response()->json(['ok' => true, 'detalle' => $this->detalle($id), 'cuenta' => $this->estadoCuenta($id)]);
    }

    public function show(int $id)
    {
        $this->soloAdmin();
        $d = $this->detalle($id);
        return $d ? response()->json($d) : $this->error('Ese proveedor ya no existe.', 404);
    }

    /* ───────────── Altas, cambios, estado y baja (JSON) ───────────── */

    private function validar(Request $r, ?int $id = null)
    {
        $d = $r->validate([
            'rif' => ['required', 'regex:/^[JGVECPjgvecp]-?[0-9]{8}-?[0-9]$/'], 'razon_social' => 'required|string|min:2|max:200',
            'telefono' => 'nullable|string|max:40', 'correo' => 'nullable|email|max:150', 'direccion' => 'nullable|string|max:300', 'dias_credito' => 'nullable|integer|min:0|max:365',
        ], ['dias_credito.max' => 'Los días de crédito van de 0 a 365.', 'dias_credito.integer' => 'Escribe los días de crédito con números enteros.', 'rif.required' => 'Escribe el RIF del proveedor.', 'rif.regex' => 'El RIF no tiene el formato correcto. Ejemplo: J-12345678-4.', 'razon_social.required' => 'Escribe el nombre o razón social.', 'razon_social.min' => 'El nombre es muy corto.', 'correo.email' => 'Ese correo no parece válido.']);
        $rif = strtoupper(trim($d['rif']));
        if (! preg_match('/^[JGVECP]-/', $rif)) $rif = substr($rif, 0, 1) . '-' . substr($rif, 1, 8) . '-' . substr($rif, 9);
        if (! DB::scalar('SELECT fn_validar_rif(?)', [$rif])) return $this->error('El RIF no es válido: revisa el último dígito.', 422, ['rif' => ['El RIF no es válido: revisa el último dígito.']]);
        if (DB::selectOne('SELECT 1 AS x FROM proveedores WHERE upper(rif) = upper(?) AND id <> ?', [$rif, $id ?? 0])) return $this->error('Ya tienes un proveedor con ese RIF.', 422, ['rif' => ['Ya tienes un proveedor con ese RIF.']]);
        $n = fn ($v) => ($v = trim((string) $v)) === '' ? null : $v;
        return ['rif' => $rif, 'razon_social' => trim($d['razon_social']), 'telefono' => $n($d['telefono'] ?? null), 'correo' => $n($d['correo'] ?? null), 'direccion' => $n($d['direccion'] ?? null), 'dias_credito' => (int) ($d['dias_credito'] ?? 0)];
    }

    public function store(Request $r)
    {
        $this->soloAdmin();
        $d = $this->validar($r); if (isset($d->original) || is_object($d)) return $d;
        try {
            $id = (int) DB::scalar('INSERT INTO proveedores (rif, razon_social, telefono, correo, direccion) VALUES (?, ?, ?, ?, ?) RETURNING id', [$d['rif'], $d['razon_social'], $d['telefono'], $d['correo'], $d['direccion']]);
            if ($this->hayCxp()) DB::update('UPDATE proveedores SET dias_credito = ? WHERE id = ?', [$d['dias_credito'], $id]);
        } catch (QueryException $e) { return $this->error($this->mensaje($e, 'No se pudo guardar el proveedor.')); }
        return response()->json(['ok' => true, 'id' => $id, 'detalle' => $this->detalle($id)]);
    }

    public function update(Request $r, $id)
    {
        $this->soloAdmin(); $id = (int) $id;
        $actual = DB::selectOne('SELECT rif FROM proveedores WHERE id = ?', [$id]);
        if (! $actual) return $this->error('Ese proveedor ya no existe.', 404);
        $d = $this->validar($r, $id); if (isset($d->original) || is_object($d)) return $d;
        $tieneCompras = (bool) DB::scalar('SELECT EXISTS (SELECT 1 FROM compras WHERE proveedor_id = ?)', [$id]);
        if ($tieneCompras && strtoupper($d['rif']) !== strtoupper($actual->rif)) {
            return $this->error('Este proveedor ya tiene compras: su RIF aparece en los libros fiscales y no se puede cambiar.', 422, ['rif' => ['El RIF no se puede cambiar porque ya tiene compras.']]);
        }
        try {
            DB::update('UPDATE proveedores SET rif = ?, razon_social = ?, telefono = ?, correo = ?, direccion = ? WHERE id = ?', [$d['rif'], $d['razon_social'], $d['telefono'], $d['correo'], $d['direccion'], $id]);
            if ($this->hayCxp()) DB::update('UPDATE proveedores SET dias_credito = ? WHERE id = ?', [$d['dias_credito'], $id]);
        } catch (QueryException $e) { return $this->error($this->mensaje($e, 'No se pudo guardar el proveedor.')); }
        return response()->json(['ok' => true, 'id' => $id, 'detalle' => $this->detalle($id)]);
    }

    public function estado(Request $r, $id)
    {
        $this->soloAdmin(); $id = (int) $id;
        if (! DB::scalar('SELECT 1 FROM proveedores WHERE id = ?', [$id])) return $this->error('Ese proveedor ya no existe.', 404);
        DB::update('UPDATE proveedores SET activo = ? WHERE id = ?', [$r->boolean('activo'), $id]);
        return response()->json(['ok' => true, 'id' => $id, 'detalle' => $this->detalle($id)]);
    }

    public function destroy($id)
    {
        $this->soloAdmin(); $id = (int) $id;
        if (! DB::scalar('SELECT 1 FROM proveedores WHERE id = ?', [$id])) return $this->error('Ese proveedor ya no existe.', 404);
        if (DB::scalar('SELECT EXISTS (SELECT 1 FROM compras WHERE proveedor_id = ?)', [$id])) return $this->error('Este proveedor tiene compras registradas: no se puede eliminar. Puedes desactivarlo.');
        try { DB::delete('DELETE FROM proveedores WHERE id = ?', [$id]); } catch (QueryException $e) { return $this->error($this->mensaje($e, 'No se pudo eliminar el proveedor.')); }
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
