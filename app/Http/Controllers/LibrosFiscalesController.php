<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;

/**
 * Libros fiscales. Todo sale de las vistas y procedimientos de la base (v_libro_ventas, v_libro_compras, v_igtf_*,
 * parametros_fiscales, notas_ajuste, v_ventas_huecos). El código no recalcula impuestos: solo suma lo que la base ya fijó
 * con la tasa y la alícuota de cada operación. Los documentos ANULADOS se muestran pero nunca suman.
 *
 * Vistas (?vista=): resumen · ventas · compras · retenciones · igtf · notas · alicuotas      Mes (?mes=YYYY-MM)
 */
class LibrosFiscalesController extends Controller
{
    use ContextoPagina;

    private const VISTAS = ['resumen', 'ventas', 'compras', 'retenciones', 'igtf', 'notas', 'alicuotas', 'quincenal'];

    /** ¿Se ejecutó 08_retenciones_iva.sql? Sin él, el módulo funciona igual pero sin retenciones ni planillas. */
    private function hayRetenciones(): bool
    {
        static $hay = null;
        return $hay ??= (bool) DB::scalar("SELECT to_regclass('retenciones_iva') IS NOT NULL AND to_regclass('compras_importacion') IS NOT NULL");
    }

    /** ¿Se ejecutó 11_cierre_y_pagos.sql (retenciones enteradas por quincena)? Requiere también el 08. */
    private function hayEnteradas(): bool
    {
        static $hay = null;
        return $hay ??= $this->hayRetenciones() && (bool) DB::scalar("SELECT to_regclass('retenciones_enteradas') IS NOT NULL");
    }

    private function soloAdmin(): void
    {
        abort_unless(strtoupper((string) auth()->user()->rol) === 'ADMINISTRADOR', 403, 'Los libros fiscales son solo para administradores.');
    }

    public function index(Request $r)
    {
        $this->soloAdmin();
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $vista = in_array($r->query('vista'), self::VISTAS, true) ? $r->query('vista') : 'resumen';
        $mes = preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', (string) $r->query('mes')) ? $r->query('mes') : substr($hoy, 0, 7);
        if ($mes > substr($hoy, 0, 7)) {
            $mes = substr($hoy, 0, 7);
        }

        return Inertia::render('LibrosFiscales/Index', $this->contexto() + $this->datos($vista, $mes, $hoy, $this->quincenaPedida($r, $mes, $hoy)) + ['emisor' => $this->emisor()]);
    }

    private function emisor(): array
    {
        $n = DB::table('negocio')->first(['razon_social', 'nombre_comercial', 'rif', 'direccion_fiscal']);
        return ['razon_social' => $n->razon_social, 'comercial' => $n->nombre_comercial, 'rif' => $n->rif, 'direccion' => $n->direccion_fiscal];
    }

    /** Todo lo que necesita la pantalla para una vista y un mes. Separado de index() para poder probarlo sin HTTP. */
    public function datos(string $vista, string $mes, string $hoy, ?int $quincena = null): array
    {
        $desde = "$mes-01";
        $hasta = date('Y-m-t', strtotime($desde));
        $n = DB::table('negocio')->first();
        $base = [
            'vista' => $vista, 'mes' => $mes, 'hoy' => $hoy, 'desde' => $desde, 'hasta' => $hasta,
            'retenciones_activas' => $this->hayRetenciones(), 'enterar_activo' => $this->hayEnteradas(),
            'regimen' => [
                'especial' => (bool) $n->es_contribuyente_especial, 'cobra_igtf' => (bool) $n->cobra_igtf, 'recupera_credito' => (bool) $n->recupera_credito_fiscal,
                'igtf_base' => $n->igtf_base, 'reversa_igtf' => (bool) $n->reversa_igtf_en_anulacion,
                'iva_pct' => (float) DB::scalar('SELECT fn_iva_pct()'), 'igtf_pct' => (float) DB::scalar("SELECT fn_param_fiscal('IGTF_DIVISAS')"),
            ],
        ];
        return $base + match ($vista) {
            'ventas' => ['libro' => $this->libroVentas($desde, $hasta)],
            'compras' => ['libro' => $this->libroCompras($desde, $hasta)],
            'retenciones' => ['retenciones' => $this->retenciones($desde, $hasta) + ['quincenas' => $this->quincenas($desde, $hasta, $hoy)]],
            'igtf' => ['igtf' => $this->igtf($desde, $hasta)],
            'notas' => ['notas' => $this->notas($desde, $hasta)],
            'alicuotas' => ['alicuotas' => $this->alicuotas()],
            'quincenal' => ['quincenal' => $this->quincenal($mes, $quincena ?? $this->quincenaPorDefecto($mes, $hoy))],
            default => ['resumen' => $this->resumen($mes, $desde, $hasta)],
        };
    }

    private function quincenaPorDefecto(string $mes, string $hoy): int
    {
        return $mes === substr($hoy, 0, 7) && (int) substr($hoy, 8, 2) <= 15 ? 1 : 2;
    }

    private function quincenaPedida(Request $r, string $mes, string $hoy): int
    {
        return in_array((int) $r->query('quincena'), [1, 2], true) ? (int) $r->query('quincena') : $this->quincenaPorDefecto($mes, $hoy);
    }

    /**
     * Resumen quincenal para preparar la declaración de IVA (Forma 30) y enterar las retenciones.
     * Quincena 1 = del 01 al 15; quincena 2 = del 16 al último día del mes. Todo en Bs con los montos ya congelados en las vistas
     * (cada venta con la tasa de su día; las compras en USD con la última tasa publicada hasta su fecha): nada se recalcula con la tasa de hoy.
     * Las facturas ANULADAS no suman; las notas de crédito vienen en negativo en la vista y las de débito en positivo.
     * Es un apoyo para llenar la declaración: no incluye excedentes de períodos anteriores ni otros ajustes; confírmalo con tu contador.
     */
    public function quincenal(string $mes, int $quincena): array
    {
        $desde = $quincena === 1 ? "$mes-01" : "$mes-16";
        $hasta = $quincena === 1 ? "$mes-15" : date('Y-m-t', strtotime("$mes-01"));
        $v = DB::selectOne("
            SELECT count(*) FILTER (WHERE tipo_documento = 'FACTURA') AS n_fac,
                   COALESCE(sum(base_imponible_ves) FILTER (WHERE tipo_documento = 'FACTURA'), 0) AS fac_base, COALESCE(sum(exento_ves) FILTER (WHERE tipo_documento = 'FACTURA'), 0) AS fac_exento,
                   COALESCE(sum(exonerado_ves) FILTER (WHERE tipo_documento = 'FACTURA'), 0) AS fac_exonerado, COALESCE(sum(iva_ves) FILTER (WHERE tipo_documento = 'FACTURA'), 0) AS fac_iva,
                   COALESCE(sum(total_ves) FILTER (WHERE tipo_documento = 'FACTURA'), 0) AS fac_total,
                   count(*) FILTER (WHERE tipo_documento = 'NOTA_CREDITO') AS n_nc, COALESCE(sum(base_imponible_ves) FILTER (WHERE tipo_documento = 'NOTA_CREDITO'), 0) AS nc_base,
                   COALESCE(sum(iva_ves) FILTER (WHERE tipo_documento = 'NOTA_CREDITO'), 0) AS nc_iva, COALESCE(sum(total_ves) FILTER (WHERE tipo_documento = 'NOTA_CREDITO'), 0) AS nc_total,
                   count(*) FILTER (WHERE tipo_documento = 'NOTA_DEBITO') AS n_nd, COALESCE(sum(base_imponible_ves) FILTER (WHERE tipo_documento = 'NOTA_DEBITO'), 0) AS nd_base,
                   COALESCE(sum(iva_ves) FILTER (WHERE tipo_documento = 'NOTA_DEBITO'), 0) AS nd_iva, COALESCE(sum(total_ves) FILTER (WHERE tipo_documento = 'NOTA_DEBITO'), 0) AS nd_total
              FROM v_libro_ventas WHERE fecha BETWEEN ? AND ? AND estado <> 'ANULADA'", [$desde, $hasta]);
        $c = DB::selectOne("
            SELECT count(*) AS n, COALESCE(sum(base_imponible_ves), 0) AS base, COALESCE(sum(exento_ves), 0) AS exento, COALESCE(sum(iva_ves), 0) AS iva, COALESCE(sum(credito_fiscal_ves), 0) AS cf,
                   COALESCE(sum(iva_ves - credito_fiscal_ves), 0) AS al_costo, count(*) FILTER (WHERE base_imponible_ves IS NULL) AS sin_tasa
              FROM v_libro_compras WHERE fecha BETWEEN ? AND ? AND estado = 'REGISTRADA'", [$desde, $hasta]);
        $g = DB::selectOne("SELECT COALESCE(sum(base_divisas_usd), 0) AS base_usd, COALESCE(sum(igtf_usd), 0) AS usd, COALESCE(sum(igtf_ves), 0) AS ves, COALESCE(sum(igtf_de_ventas_anuladas_ves), 0) AS anul
                              FROM v_igtf_a_declarar WHERE fecha BETWEEN ? AND ?", [$desde, $hasta]);
        $rv = (float) DB::scalar('SELECT COALESCE(sum(igtf_ves), 0) FROM reversiones_igtf WHERE fecha BETWEEN ? AND ?', [$desde, $hasta]);
        $h = $this->hayRetenciones();
        $rt = $h ? DB::selectOne("
            SELECT COALESCE(sum(iva_retenido_ves) FILTER (WHERE sentido = 'COMPRA'), 0) AS practicada, count(*) FILTER (WHERE sentido = 'COMPRA') AS n_p,
                   COALESCE(sum(iva_retenido_ves) FILTER (WHERE sentido = 'VENTA'), 0) AS sufrida, count(*) FILTER (WHERE sentido = 'VENTA') AS n_s
              FROM retenciones_iva WHERE estado = 'ACTIVA' AND fecha_emision BETWEEN ? AND ?", [$desde, $hasta]) : null;
        $ent = null;
        if ($h && $this->hayEnteradas()) {
            $ent = DB::selectOne('SELECT enterada, fecha_pago::text AS fecha_pago, referencia FROM fn_retenciones_por_quincena(?::date, ?::date) WHERE quincena = ?', [$desde, $hasta, $quincena]);
        }
        $debito = $this->f($v->fac_iva + $v->nc_iva + $v->nd_iva);
        $credito = $this->f($c->cf);
        $sufrida = $this->f($rt->sufrida ?? 0);
        $neto = round($debito - $credito - $sufrida, 2);
        $igtfNeto = round((float) $g->ves - $rv, 2);

        return [
            'mes' => $mes, 'quincena' => $quincena, 'desde' => $desde, 'hasta' => $hasta, 'regimen_especial' => (bool) DB::scalar('SELECT es_contribuyente_especial FROM negocio WHERE id = fn_negocio_actual()'),
            'ventas' => [
                'facturas' => ['cantidad' => (int) $v->n_fac, 'base' => $this->f($v->fac_base), 'exento' => $this->f($v->fac_exento), 'exonerado' => $this->f($v->fac_exonerado), 'iva' => $this->f($v->fac_iva), 'total' => $this->f($v->fac_total)],
                'notas_credito' => ['cantidad' => (int) $v->n_nc, 'base' => $this->f($v->nc_base), 'iva' => $this->f($v->nc_iva), 'total' => $this->f($v->nc_total)],
                'notas_debito' => ['cantidad' => (int) $v->n_nd, 'base' => $this->f($v->nd_base), 'iva' => $this->f($v->nd_iva), 'total' => $this->f($v->nd_total)],
                'base_gravada' => $this->f($v->fac_base + $v->nc_base + $v->nd_base), 'base_exenta' => $this->f($v->fac_exento), 'base_exonerada' => $this->f($v->fac_exonerado),
                'iva_debito' => $debito,
            ],
            'compras' => ['cantidad' => (int) $c->n, 'base' => $this->f($c->base), 'exento' => $this->f($c->exento), 'iva' => $this->f($c->iva), 'iva_credito' => $credito, 'iva_al_costo' => $this->f($c->al_costo), 'sin_tasa' => (int) $c->sin_tasa],
            'retenciones' => ['activas' => $h, 'practicadas' => $this->f($rt->practicada ?? 0), 'comprobantes_practicados' => (int) ($rt->n_p ?? 0), 'sufridas' => $sufrida, 'comprobantes_sufridos' => (int) ($rt->n_s ?? 0),
                'enterada' => $ent ? (bool) $ent->enterada : null, 'fecha_pago' => $ent->fecha_pago ?? null, 'referencia' => $ent->referencia ?? null],
            'igtf' => ['base_divisas_usd' => $this->f($g->base_usd), 'igtf_usd' => $this->f($g->usd), 'igtf_ves' => $this->f($g->ves), 'de_ventas_anuladas_ves' => $this->f($g->anul), 'revertido_ves' => $this->f($rv), 'neto_ves' => $igtfNeto],
            'resultado' => ['iva_debito' => $debito, 'iva_credito' => $credito, 'retenciones_sufridas' => $sufrida, 'iva_a_pagar' => max($neto, 0.0), 'excedente' => $neto < 0 ? -$neto : 0.0],
        ];
    }

    /** GET /libros-fiscales/quincenal?mes=YYYY-MM&quincena=1|2 */
    public function resumenQuincenal(Request $request)
    {
        $this->soloAdmin();
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $mes = $this->mesPedido($request, $hoy);
        return response()->json($this->quincenal($mes, $this->quincenaPedida($request, $mes, $hoy)));
    }

    private function f(float|string|null $v): float
    {
        return round((float) $v, 2);
    }

    private function libroVentas(string $desde, string $hasta): array
    {
        $h = $this->hayRetenciones();
        $filas = DB::select("
            SELECT l.fecha::text AS fecha, l.tipo_documento AS tipo, l.numero, l.numero_factura_fiscal AS factura, l.numero_control AS control,
                   l.documento_afectado AS afecta, l.cliente, l.rif_cedula AS rif, l.estado, l.tasa_cambio AS tasa,
                   l.base_imponible_ves AS base, l.exento_ves AS exento, l.exonerado_ves AS exonerado, l.iva_ves AS iva, l.total_ves AS total, l.igtf_ves AS igtf,
                   l.monedas_pago AS monedas, v.id AS venta_id, " . ($h ? 'r.iva_retenido_ves AS ret, r.numero_comprobante AS comp, r.id AS ret_id' : 'NULL::numeric AS ret, NULL::text AS comp, NULL::bigint AS ret_id') . "
              FROM v_libro_ventas l LEFT JOIN ventas v ON l.tipo_documento = 'FACTURA' AND v.numero::text = l.numero
              " . ($h ? "LEFT JOIN retenciones_iva r ON r.venta_id = v.id AND r.estado = 'ACTIVA'" : '') . "
             WHERE l.fecha BETWEEN ? AND ? ORDER BY l.fecha, l.tipo_documento, l.numero::text", [$desde, $hasta]);
        $out = [];
        $t = ['base' => 0, 'exento' => 0, 'exonerado' => 0, 'iva' => 0, 'total' => 0, 'igtf' => 0, 'retenido' => 0, 'facturas' => 0, 'notas' => 0, 'anuladas' => 0];
        foreach ($filas as $x) {
            $anulada = $x->estado === 'ANULADA';
            foreach (['base', 'exento', 'exonerado', 'iva', 'total', 'igtf'] as $k) {
                $t[$k] += $anulada ? 0 : (float) $x->$k;
            }
            $t['retenido'] += $anulada ? 0 : (float) $x->ret;
            $anulada ? $t['anuladas']++ : ($x->tipo === 'FACTURA' ? $t['facturas']++ : $t['notas']++);
            $out[] = ['fecha' => $x->fecha, 'tipo' => $x->tipo, 'tx' => $this->tipoTransaccion($x->tipo, $x->estado), 'numero' => (string) $x->numero, 'factura' => $x->factura, 'control' => $x->control,
                'afecta' => $x->afecta ?? ($anulada ? ($x->factura ?: $x->numero) : null), 'ret' => $x->ret === null ? null : $this->f($x->ret), 'comprobante' => $x->comp, 'ret_id' => $x->ret_id,
                'cliente' => $x->cliente, 'rif' => $x->rif, 'estado' => $x->estado, 'tasa' => (float) $x->tasa, 'base' => $this->f($x->base), 'exento' => $this->f($x->exento),
                'exonerado' => $this->f($x->exonerado), 'iva' => $this->f($x->iva), 'total' => $this->f($x->total), 'igtf' => $this->f($x->igtf), 'monedas' => $x->monedas, 'venta_id' => $x->venta_id];
        }
        return ['filas' => $out, 'totales' => array_map(fn ($v) => is_float($v) || is_int($v) ? round($v, 2) : $v, $t),
            'sin_factura' => count(array_filter($out, fn ($f) => $f['tipo'] === 'FACTURA' && $f['estado'] === 'COMPLETADA' && ! $f['factura']))];
    }

    /**
     * Tipo de transacción del libro (Reglamento de la Ley de IVA): 01 registro, 02 complemento, 03 anulación, 04 ajuste.
     * Factura = 01 · nota de débito = 02 · factura anulada = 03 · nota de crédito = 04. Confirma esta asignación con tu contador.
     */
    private function tipoTransaccion(string $tipo, string $estado): string
    {
        return $estado === 'ANULADA' ? '03' : match ($tipo) { 'NOTA_DEBITO' => '02', 'NOTA_CREDITO' => '04', default => '01' };
    }

    private function libroCompras(string $desde, string $hasta): array
    {
        $h = $this->hayRetenciones();
        $filas = DB::select("
            SELECT l.fecha::text AS fecha, l.compra_id, l.rif_proveedor AS rif, l.proveedor, l.numero_factura AS factura, l.numero_control AS control, l.estado, l.moneda,
                   l.aplica_credito_fiscal AS credito, COALESCE(l.base_imponible_ves, 0) AS base, COALESCE(l.exento_ves, 0) AS exento, COALESCE(l.iva_ves, 0) AS iva,
                   COALESCE(l.credito_fiscal_ves, 0) AS cf, COALESCE(l.total_ves, 0) AS total, (l.base_imponible_ves IS NULL) AS sin_tasa, "
                   . ($h ? 'r.iva_retenido_ves AS ret, r.numero_comprobante AS comp, r.id AS ret_id, i.numero_planilla AS planilla, i.fecha_planilla::text AS planilla_fecha, i.aduana'
                         : 'NULL::numeric AS ret, NULL::text AS comp, NULL::bigint AS ret_id, NULL::text AS planilla, NULL::text AS planilla_fecha, NULL::text AS aduana') . "
              FROM v_libro_compras l "
                   . ($h ? "LEFT JOIN retenciones_iva r ON r.compra_id = l.compra_id AND r.estado = 'ACTIVA' LEFT JOIN compras_importacion i ON i.compra_id = l.compra_id" : '') . "
             WHERE l.fecha BETWEEN ? AND ? ORDER BY l.fecha, l.compra_id", [$desde, $hasta]);
        $t = ['base' => 0, 'exento' => 0, 'iva' => 0, 'cf' => 0, 'al_costo' => 0, 'total' => 0, 'retenido' => 0, 'facturas' => 0, 'anuladas' => 0];
        $out = [];
        foreach ($filas as $x) {
            $reg = $x->estado === 'REGISTRADA';
            if ($reg) {
                foreach (['base', 'exento', 'iva', 'cf', 'total'] as $k) {
                    $t[$k] += (float) $x->$k;
                }
                $t['al_costo'] += (float) $x->iva - (float) $x->cf;
                $t['retenido'] += (float) $x->ret;
                $t['facturas']++;
            } else {
                $t['anuladas']++;
            }
            $out[] = ['fecha' => $x->fecha, 'id' => $x->compra_id, 'tx' => $reg ? '01' : '03', 'rif' => $x->rif, 'proveedor' => $x->proveedor, 'factura' => $x->factura, 'control' => $x->control, 'estado' => $x->estado,
                'moneda' => trim($x->moneda), 'credito' => (bool) $x->credito, 'base' => $this->f($x->base), 'exento' => $this->f($x->exento), 'iva' => $this->f($x->iva),
                'cf' => $this->f($x->cf), 'total' => $this->f($x->total), 'sin_tasa' => (bool) $x->sin_tasa,
                'ret' => $x->ret === null ? null : $this->f($x->ret), 'comprobante' => $x->comp, 'ret_id' => $x->ret_id,
                'planilla' => $x->planilla, 'planilla_fecha' => $x->planilla_fecha, 'aduana' => $x->aduana];
        }
        return ['filas' => $out, 'totales' => array_map(fn ($v) => round($v, 2), $t)];
    }

    /** Comprobantes de retención del mes (los que practicas a proveedores y los que te practicaron clientes). */
    private function retenciones(string $desde, string $hasta): array
    {
        if (! $this->hayRetenciones()) {
            return ['filas' => [], 'totales' => ['practicada' => 0, 'sufrida' => 0, 'cantidad' => 0]];
        }
        $filas = DB::select("
            SELECT id, sentido, estado, numero_comprobante AS comprobante, fecha_emision::text AS fecha, porcentaje, iva_documento_ves AS iva, iva_retenido_ves AS retenido, documento, tercero
              FROM v_retenciones_iva WHERE fecha_emision BETWEEN ? AND ? ORDER BY fecha_emision, id", [$desde, $hasta]);
        $t = ['practicada' => 0, 'sufrida' => 0, 'cantidad' => 0];
        foreach ($filas as $x) {
            if ($x->estado === 'ACTIVA') {
                $t[$x->sentido === 'COMPRA' ? 'practicada' : 'sufrida'] += (float) $x->retenido;
                $t['cantidad']++;
            }
        }
        return ['filas' => array_map(fn ($x) => ['id' => $x->id, 'sentido' => $x->sentido, 'estado' => $x->estado, 'comprobante' => $x->comprobante, 'fecha' => $x->fecha, 'pct' => (float) $x->porcentaje,
            'iva' => $this->f($x->iva), 'retenido' => $this->f($x->retenido), 'documento' => $x->documento, 'tercero' => $x->tercero], $filas), 'totales' => array_map(fn ($v) => round($v, 2), $t)];
    }

    /**
     * Retenciones que TÚ practicas a proveedores (sentido COMPRA), agrupadas por quincena de emisión del comprobante (1–15 y 16–fin de mes),
     * con lo que se debe enterar al SENIAT. Muestra las del mes elegido y cuántas quincenas anteriores siguen sin marcar.
     * El plazo para enterarlas NO se fija aquí: lo define el calendario del SENIAT; confirma las fechas con tu contador.
     */
    public function quincenas(string $desde, string $hasta, string $hoy): array
    {
        if (! $this->hayEnteradas()) {
            return ['activo' => false, 'filas' => [], 'anteriores_pendientes' => 0, 'anteriores_monto' => 0];
        }
        $todas = DB::select('SELECT * FROM fn_retenciones_por_quincena(?::date, ?::date)', [date('Y-m-01', strtotime($desde . ' -12 months')), $hasta]);
        $fila = fn ($x) => ['anio' => (int) $x->anio, 'mes' => (int) $x->mes, 'quincena' => (int) $x->quincena, 'desde' => $x->desde, 'hasta' => $x->hasta, 'comprobantes' => (int) $x->comprobantes,
            'monto' => $this->f($x->iva_retenido_ves), 'enterada' => (bool) $x->enterada, 'enterado_id' => $x->enterado_id ? (int) $x->enterado_id : null, 'fecha_pago' => $x->fecha_pago,
            'referencia' => $x->referencia, 'monto_enterado' => $x->monto_enterado === null ? null : $this->f($x->monto_enterado), 'cerrada' => $x->hasta < $hoy];
        $mes = array_values(array_map($fila, array_filter($todas, fn ($x) => $x->desde >= $desde && $x->desde <= $hasta)));
        $ant = array_filter($todas, fn ($x) => $x->desde < $desde && ! $x->enterada);
        return ['activo' => true, 'filas' => $mes, 'anteriores_pendientes' => count($ant), 'anteriores_monto' => $this->f(array_sum(array_map(fn ($x) => (float) $x->iva_retenido_ves, $ant))),
            'anteriores' => array_values(array_map($fila, $ant))];
    }

    private function igtf(string $desde, string $hasta): array
    {
        $dias = DB::select("
            SELECT fecha::text AS fecha, base_divisas_usd AS base_usd, igtf_usd, igtf_ves, igtf_de_ventas_anuladas_usd AS anul_usd, igtf_de_ventas_anuladas_ves AS anul_ves
              FROM v_igtf_a_declarar WHERE fecha BETWEEN ? AND ? ORDER BY fecha", [$desde, $hasta]);
        $rev = DB::select("
            SELECT r.fecha::text AS fecha, v.numero, r.igtf_usd, r.igtf_ves, r.motivo
              FROM reversiones_igtf r JOIN ventas v ON v.id = r.venta_id WHERE r.fecha BETWEEN ? AND ? ORDER BY r.fecha, v.numero", [$desde, $hasta]);
        $t = ['base_usd' => 0, 'igtf_usd' => 0, 'igtf_ves' => 0, 'rev_usd' => 0, 'rev_ves' => 0];
        foreach ($dias as $d) {
            $t['base_usd'] += (float) $d->base_usd;
            $t['igtf_usd'] += (float) $d->igtf_usd;
            $t['igtf_ves'] += (float) $d->igtf_ves;
        }
        foreach ($rev as $x) {
            $t['rev_usd'] += (float) $x->igtf_usd;
            $t['rev_ves'] += (float) $x->igtf_ves;
        }
        return [
            'dias' => array_map(fn ($d) => ['fecha' => $d->fecha, 'base_usd' => $this->f($d->base_usd), 'igtf_usd' => $this->f($d->igtf_usd), 'igtf_ves' => $this->f($d->igtf_ves), 'anul_usd' => $this->f($d->anul_usd), 'anul_ves' => $this->f($d->anul_ves)], $dias),
            'reversiones' => array_map(fn ($x) => ['fecha' => $x->fecha, 'numero' => (int) $x->numero, 'igtf_usd' => $this->f($x->igtf_usd), 'igtf_ves' => $this->f($x->igtf_ves), 'motivo' => $x->motivo], $rev),
            'totales' => array_map(fn ($v) => round($v, 2), $t),
        ];
    }

    private function notas(string $desde, string $hasta): array
    {
        $filas = DB::select("
            SELECT n.id, n.tipo, n.numero, n.numero_control AS control, n.fecha::text AS fecha, n.iva_pct, n.base_ves AS base, n.iva_ves AS iva, n.total_ves AS total, n.motivo,
                   COALESCE(v.numero_factura_fiscal, v.numero::text) AS afecta, COALESCE(c.nombre, 'Consumidor final') AS cliente, u.nombre_completo AS por
              FROM notas_ajuste n JOIN ventas v ON v.id = n.venta_id LEFT JOIN clientes c ON c.id = v.cliente_id LEFT JOIN usuarios u ON u.id = n.usuario_id
             WHERE n.fecha BETWEEN ? AND ? ORDER BY n.fecha, n.id", [$desde, $hasta]);
        return ['filas' => array_map(fn ($x) => ['id' => $x->id, 'tipo' => $x->tipo, 'numero' => $x->numero, 'control' => $x->control, 'fecha' => $x->fecha, 'iva_pct' => (float) $x->iva_pct,
            'base' => $this->f($x->base), 'iva' => $this->f($x->iva), 'total' => $this->f($x->total), 'motivo' => $x->motivo, 'afecta' => $x->afecta, 'cliente' => $x->cliente, 'por' => $x->por], $filas)];
    }

    private function alicuotas(): array
    {
        $filas = DB::select("
            SELECT p.id, p.codigo, p.porcentaje, p.vigente_desde::text AS desde, p.vigente_hasta::text AS hasta, p.nota, u.nombre_completo AS por
              FROM parametros_fiscales p LEFT JOIN usuarios u ON u.id = p.creado_por ORDER BY p.codigo, p.vigente_desde DESC");
        return ['filas' => array_map(fn ($x) => ['id' => $x->id, 'codigo' => $x->codigo, 'pct' => (float) $x->porcentaje, 'desde' => $x->desde, 'hasta' => $x->hasta, 'nota' => $x->nota, 'por' => $x->por], $filas)];
    }

    /** Declaración del mes: IVA débito (ventas) − crédito fiscal (compras), IGTF y avisos de lo que falta ordenar. */
    private function resumen(string $mes, string $desde, string $hasta): array
    {
        $v = DB::selectOne("
            SELECT COALESCE(sum(base_imponible_ves), 0) AS base, COALESCE(sum(exento_ves), 0) AS exento, COALESCE(sum(exonerado_ves), 0) AS exonerado, COALESCE(sum(iva_ves), 0) AS iva,
                   COALESCE(sum(total_ves), 0) AS total, count(*) FILTER (WHERE tipo_documento = 'FACTURA') AS facturas, count(*) FILTER (WHERE tipo_documento <> 'FACTURA') AS notas,
                   COALESCE(sum(iva_ves) FILTER (WHERE tipo_documento = 'NOTA_CREDITO'), 0) AS iva_nc, COALESCE(sum(iva_ves) FILTER (WHERE tipo_documento = 'NOTA_DEBITO'), 0) AS iva_nd
              FROM v_libro_ventas WHERE fecha BETWEEN ? AND ? AND estado <> 'ANULADA'", [$desde, $hasta]);
        $c = DB::selectOne("
            SELECT COALESCE(sum(base_imponible_ves), 0) AS base, COALESCE(sum(iva_ves), 0) AS iva, COALESCE(sum(credito_fiscal_ves), 0) AS cf, count(*) AS facturas,
                   count(*) FILTER (WHERE NOT aplica_credito_fiscal) AS sin_credito, COALESCE(sum(iva_ves - credito_fiscal_ves), 0) AS al_costo
              FROM v_libro_compras WHERE fecha BETWEEN ? AND ? AND estado = 'REGISTRADA'", [$desde, $hasta]);
        $g = DB::selectOne("
            SELECT COALESCE(sum(igtf_usd), 0) AS usd, COALESCE(sum(igtf_ves), 0) AS ves, COALESCE(sum(igtf_de_ventas_anuladas_ves), 0) AS anul_ves
              FROM v_igtf_a_declarar WHERE fecha BETWEEN ? AND ?", [$desde, $hasta]);
        $rv = DB::selectOne('SELECT COALESCE(sum(igtf_ves), 0) AS ves, count(*) AS n FROM reversiones_igtf WHERE fecha BETWEEN ? AND ?', [$desde, $hasta]);
        $sinFactura = (int) DB::scalar("SELECT count(*) FROM ventas WHERE estado = 'COMPLETADA' AND numero_factura_fiscal IS NULL AND fecha_valor BETWEEN ? AND ?", [$desde, $hasta]);
        $huecos = array_map(fn ($h) => ['numero' => (int) $h->numero_faltante, 'anterior' => (int) $h->numero_anterior, 'siguiente' => (int) $h->numero_siguiente], DB::select('SELECT numero_faltante, numero_anterior, numero_siguiente FROM v_ventas_huecos ORDER BY 1 DESC LIMIT 20'));
        $sinTasa = (int) DB::scalar("SELECT count(*) FROM v_libro_compras WHERE fecha BETWEEN ? AND ? AND estado = 'REGISTRADA' AND base_imponible_ves IS NULL", [$desde, $hasta]);
        $h = $this->hayRetenciones();
        $rt = $h ? DB::selectOne("
            SELECT COALESCE(sum(iva_retenido_ves) FILTER (WHERE sentido = 'VENTA'), 0) AS sufrida, COALESCE(sum(iva_retenido_ves) FILTER (WHERE sentido = 'COMPRA'), 0) AS practicada,
                   count(*) AS n FROM retenciones_iva WHERE estado = 'ACTIVA' AND fecha_emision BETWEEN ? AND ?", [$desde, $hasta]) : null;
        // Compras con IVA de un contribuyente especial que aún no tienen comprobante de retención.
        $sinRetencion = ($h && DB::scalar('SELECT es_contribuyente_especial FROM negocio WHERE id = fn_negocio_actual()'))
            ? (int) DB::scalar("SELECT count(*) FROM v_libro_compras l WHERE l.fecha BETWEEN ? AND ? AND l.estado = 'REGISTRADA' AND COALESCE(l.iva_ves, 0) > 0
                                AND NOT EXISTS (SELECT 1 FROM retenciones_iva r WHERE r.compra_id = l.compra_id AND r.estado = 'ACTIVA')
                                AND NOT EXISTS (SELECT 1 FROM compras_importacion i WHERE i.compra_id = l.compra_id)", [$desde, $hasta]) : 0;

        $debito = $this->f($v->iva);
        $credito = $this->f($c->cf);

        // Los últimos 12 meses (hasta el mes elegido): débito, crédito y saldo de cada uno.
        $serie = DB::select("
            WITH m AS (SELECT generate_series(date_trunc('month', ?::date) - interval '11 months', date_trunc('month', ?::date), interval '1 month')::date AS p),
            d AS (SELECT date_trunc('month', fecha)::date AS p, sum(iva_ves) AS x FROM v_libro_ventas WHERE estado <> 'ANULADA' GROUP BY 1),
            c AS (SELECT date_trunc('month', fecha)::date AS p, sum(credito_fiscal_ves) AS x FROM v_libro_compras WHERE estado = 'REGISTRADA' GROUP BY 1),
            r AS (SELECT date_trunc('month', fecha_emision)::date AS p, sum(iva_retenido_ves) AS x FROM " . ($h ? "retenciones_iva WHERE estado = 'ACTIVA' AND sentido = 'VENTA'" : "(SELECT NULL::date AS fecha_emision, NULL::numeric AS iva_retenido_ves WHERE FALSE) z") . " GROUP BY 1)
            SELECT to_char(m.p, 'YYYY-MM') AS mes, COALESCE(d.x, 0) AS debito, COALESCE(c.x, 0) AS credito, COALESCE(r.x, 0) AS retenido
              FROM m LEFT JOIN d ON d.p = m.p LEFT JOIN c ON c.p = m.p LEFT JOIN r ON r.p = m.p ORDER BY m.p", [$desde, $desde]);

        // Excedente de crédito: si el crédito de un mes supera al débito, la diferencia pasa al mes siguiente (orientativo; confirma con tu contador).
        $serieCalc = [];
        $arrastre = 0.0;
        foreach ($serie as $x) {
            $deb = (float) $x->debito;
            $cre = (float) $x->credito;
            $ret = (float) $x->retenido;
            $neto = $deb - $cre - $ret - $arrastre;
            $serieCalc[] = ['mes' => $x->mes, 'debito' => $this->f($deb), 'credito' => $this->f($cre), 'retenido' => $this->f($ret), 'arrastre' => $this->f($arrastre), 'a_pagar' => $this->f(max(0, $neto)), 'excedente' => $this->f(max(0, -$neto))];
            $arrastre = max(0, -$neto);
        }
        $ult = end($serieCalc);

        return [
            'iva' => [
                'excedente_anterior' => $ult['arrastre'], 'a_pagar' => $ult['a_pagar'], 'excedente' => $ult['excedente'],
                'base' => $this->f($v->base), 'exento' => $this->f($v->exento), 'exonerado' => $this->f($v->exonerado), 'debito' => $debito, 'facturas' => (int) $v->facturas, 'notas' => (int) $v->notas,
                'iva_nc' => $this->f($v->iva_nc), 'iva_nd' => $this->f($v->iva_nd),
                'compras_base' => $this->f($c->base), 'compras_iva' => $this->f($c->iva), 'credito' => $credito, 'compras' => (int) $c->facturas, 'compras_sin_credito' => (int) $c->sin_credito, 'al_costo' => $this->f($c->al_costo),
                'saldo' => round($debito - $credito, 2),
                'ret_sufrida' => $this->f($rt->sufrida ?? 0), 'ret_practicada' => $this->f($rt->practicada ?? 0), 'ret_cantidad' => (int) ($rt->n ?? 0),
            ],
            'igtf' => ['usd' => $this->f($g->usd), 'ves' => $this->f($g->ves), 'anuladas_ves' => $this->f($g->anul_ves), 'revertido_ves' => $this->f($rv->ves), 'reversiones' => (int) $rv->n],
            'avisos' => ['sin_factura' => $sinFactura, 'huecos' => $huecos, 'compras_sin_tasa' => $sinTasa, 'sin_retencion' => $sinRetencion],
            'serie' => $serieCalc,
        ];
    }

    /**
     * Revisión previa a declarar: cada punto trae estado (ok · aviso · bad), qué pasa y a dónde ir a corregirlo.
     * Lo que NO puede comprobar el sistema (que lo declarado en el portal coincida) se dice con claridad en el IGTF.
     */
    public function cierre(string $mes, string $hoy): array
    {
        $desde = "$mes-01";
        $hasta = date('Y-m-t', strtotime($desde));
        $n = DB::table('negocio')->first();
        $items = [];
        $pl = fn (int $c, string $uno, string $varios) => $c === 1 ? $uno : $varios;
        $lf = fn (string $vista) => "/libros-fiscales?vista=$vista&mes=$mes";

        // 1 · Ventas sin factura fiscal
        $sf = (int) DB::scalar("SELECT count(*) FROM ventas WHERE estado = 'COMPLETADA' AND numero_factura_fiscal IS NULL AND fecha_valor BETWEEN ? AND ?", [$desde, $hasta]);
        $items[] = $sf > 0
            ? ['clave' => 'ventas_sin_factura', 'estado' => 'bad', 'titulo' => "Tienes $sf " . $pl($sf, 'venta sin factura fiscal', 'ventas sin factura fiscal'), 'detalle' => 'Asígnales su número de factura y de control antes de declarar: el Libro de Ventas las muestra incompletas.', 'enlace' => $lf('ventas'), 'accion' => 'Ir a las ventas']
            : ['clave' => 'ventas_sin_factura', 'estado' => 'ok', 'titulo' => 'Todas las ventas tienen factura fiscal', 'detalle' => null, 'enlace' => null, 'accion' => null];

        // 2 · Compras con IVA sin retención (solo contribuyente especial)
        if ($this->hayRetenciones() && $n->es_contribuyente_especial) {
            $sr = (int) DB::scalar("SELECT count(*) FROM v_libro_compras l WHERE l.fecha BETWEEN ? AND ? AND l.estado = 'REGISTRADA' AND COALESCE(l.iva_ves, 0) > 0
                                    AND NOT EXISTS (SELECT 1 FROM retenciones_iva r WHERE r.compra_id = l.compra_id AND r.estado = 'ACTIVA')
                                    AND NOT EXISTS (SELECT 1 FROM compras_importacion i WHERE i.compra_id = l.compra_id)", [$desde, $hasta]);
            $items[] = $sr > 0
                ? ['clave' => 'compras_sin_retencion', 'estado' => 'bad', 'titulo' => "Tienes $sr " . $pl($sr, 'factura de compra sin retención de IVA', 'facturas de compras sin retención de IVA'), 'detalle' => 'Como contribuyente especial debes retener y emitir el comprobante.', 'enlace' => "/compras?periodo=rango&desde=$desde&hasta=$hasta&retencion=pendiente", 'accion' => 'Ir a las compras']
                : ['clave' => 'compras_sin_retencion', 'estado' => 'ok', 'titulo' => 'Todas las compras con IVA tienen su retención', 'detalle' => null, 'enlace' => null, 'accion' => null];
        }

        // 3 · Compras sin tasa del día (salen en 0 Bs)
        $st = (int) DB::scalar("SELECT count(*) FROM v_libro_compras WHERE fecha BETWEEN ? AND ? AND estado = 'REGISTRADA' AND base_imponible_ves IS NULL", [$desde, $hasta]);
        $items[] = $st > 0
            ? ['clave' => 'compras_sin_tasa', 'estado' => 'bad', 'titulo' => "Tienes $st " . $pl($st, 'compra sin tasa de cambio', 'compras sin tasa de cambio'), 'detalle' => 'Aparecen en 0 Bs en el libro. Registra la tasa de esa fecha en Tasas de cambio.', 'enlace' => '/tasas', 'accion' => 'Ir a Tasas']
            : ['clave' => 'compras_sin_tasa', 'estado' => 'ok', 'titulo' => 'Todas las compras tienen su tasa de cambio', 'detalle' => null, 'enlace' => null, 'accion' => null];

        // 4 · Huecos en la numeración de ventas
        $hu = DB::select('SELECT numero_faltante FROM v_ventas_huecos ORDER BY 1 DESC LIMIT 20');
        $items[] = $hu
            ? ['clave' => 'huecos', 'estado' => 'aviso', 'titulo' => 'Faltan números en la secuencia de ventas: ' . implode(', ', array_map(fn ($h) => 'N.º ' . $h->numero_faltante, array_slice($hu, 0, 5))) . (count($hu) > 5 ? '…' : ''), 'detalle' => 'Son operaciones que no se completaron; el sistema no reutiliza el número. Conserva la explicación por si el SENIAT la pide.', 'enlace' => $lf('resumen'), 'accion' => 'Ver el resumen']
            : ['clave' => 'huecos', 'estado' => 'ok', 'titulo' => 'La numeración de ventas no tiene huecos', 'detalle' => null, 'enlace' => null, 'accion' => null];

        // 5 · IGTF del libro contra lo cobrado en las ventas (sí se puede comparar; contra el portal del SENIAT no)
        $libro = (float) DB::scalar('SELECT COALESCE(sum(igtf_ves), 0) FROM v_igtf_a_declarar WHERE fecha BETWEEN ? AND ?', [$desde, $hasta]);
        // Cada venta guarda su IGTF y cada pago el suyo; el libro suma los pagos. Si no cuadran, hay un registro dañado. Las ventas anuladas cuentan en ambos lados.
        $cobrado = (float) DB::scalar('SELECT COALESCE(sum(igtf_ves), 0) FROM ventas WHERE fecha_valor BETWEEN ? AND ?', [$desde, $hasta]);
        // Desde el SQL 16 el IGTF de los cobros de cuentas por cobrar en divisas también entra al libro: se suma de su tabla para comparar.
        if (DB::scalar("SELECT to_regclass('pagos_cobrar') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pagos_cobrar' AND column_name = 'igtf_ves')")) {
            $cobrado += (float) DB::scalar('SELECT COALESCE(sum(igtf_ves), 0) FROM pagos_cobrar WHERE fecha BETWEEN ? AND ?', [$desde, $hasta]);
        }
        $anul = (float) DB::scalar('SELECT COALESCE(sum(igtf_de_ventas_anuladas_ves), 0) FROM v_igtf_a_declarar WHERE fecha BETWEEN ? AND ?', [$desde, $hasta]);
        $rev = (float) DB::scalar('SELECT COALESCE(sum(igtf_ves), 0) FROM reversiones_igtf WHERE fecha BETWEEN ? AND ?', [$desde, $hasta]);
        $dif = round($cobrado - $libro, 2);
        $items[] = abs($dif) > 0.05
            ? ['clave' => 'igtf', 'estado' => 'bad', 'titulo' => 'El IGTF cobrado no coincide con el del libro: diferencia de Bs ' . number_format(abs($dif), 2, ',', '.'), 'detalle' => 'Cobrado en ventas y cobros a crédito: Bs ' . number_format($cobrado, 2, ',', '.') . ' · En el libro de IGTF: Bs ' . number_format($libro, 2, ',', '.') . '. Revisa las ventas del mes y sus anulaciones.', 'enlace' => $lf('igtf'), 'accion' => 'Ver el IGTF']
            : ['clave' => 'igtf', 'estado' => 'ok', 'titulo' => 'El IGTF cobrado coincide con el del libro', 'detalle' => 'Bs ' . number_format($libro, 2, ',', '.') . ' a declarar' . ($anul > 0 ? ', de los cuales Bs ' . number_format($anul, 2, ',', '.') . ' vienen de ventas anuladas' . ($rev > 0 ? ' (ya revertidos Bs ' . number_format($rev, 2, ',', '.') . ')' : ' y siguen sin revertir') : '') . '. Se compara con lo registrado en tus ventas; lo que pagaste en el portal del SENIAT no lo puede ver el sistema.', 'enlace' => null, 'accion' => null];

        // 6 · Quincenas de retención ya vencidas sin marcar como enteradas
        if ($this->hayEnteradas()) {
            $qq = $this->quincenas($desde, $hasta, $hoy);
            $q = array_filter(array_merge($qq['anteriores'] ?? [], $qq['filas']), fn ($x) => $x['cerrada'] && ! $x['enterada']);
            $tot = array_sum(array_column($q, 'monto'));
            $items[] = $q
                ? ['clave' => 'quincenas', 'estado' => 'aviso', 'titulo' => count($q) . ' ' . $pl(count($q), 'quincena de retenciones sin marcar como enterada', 'quincenas de retenciones sin marcar como enteradas') . ': Bs ' . number_format($tot, 2, ',', '.'), 'detalle' => 'Cuando pagues lo retenido al SENIAT, márcalo en la pestaña Retenciones. Confirma con tu contador el plazo de cada quincena.', 'enlace' => $lf('retenciones'), 'accion' => 'Ir a Retenciones']
                : ['clave' => 'quincenas', 'estado' => 'ok', 'titulo' => 'Las retenciones practicadas están al día', 'detalle' => null, 'enlace' => null, 'accion' => null];
        }

        // 7 · Retenciones de ISLR de meses ya cerrados sin enterar (20_retenciones_islr.sql)
        if (DB::scalar("SELECT to_regclass('retenciones_islr') IS NOT NULL")) {
            $pend = DB::selectOne("SELECT count(*) AS n, COALESCE(sum(retenido_ves), 0) AS total FROM retenciones_islr WHERE estado = 'ACTIVA' AND entero_id IS NULL AND fecha < ?::date", [$desde]);
            $items[] = (int) $pend->n > 0
                ? ['clave' => 'islr_por_enterar', 'estado' => 'aviso', 'titulo' => "Tienes {$pend->n} " . $pl((int) $pend->n, 'retención de ISLR de meses anteriores sin enterar', 'retenciones de ISLR de meses anteriores sin enterar') . ': Bs ' . number_format((float) $pend->total, 2, ',', '.'), 'detalle' => 'Cuando pagues lo retenido al SENIAT, regístralo para que el control y el asiento queden al día.', 'enlace' => '/retenciones-islr', 'accion' => 'Ir a ISLR']
                : ['clave' => 'islr_por_enterar', 'estado' => 'ok', 'titulo' => 'Las retenciones de ISLR de meses anteriores están enteradas', 'detalle' => null, 'enlace' => null, 'accion' => null];
        }

        // 8 · Declaraciones del calendario fiscal vencidas sin marcar como presentadas (solo contribuyente especial; 21_calendario_fiscal.sql)
        $venc = array_filter(CalendarioFiscalController::proximos(40), fn ($v) => !$v['presentada'] && $v['dias'] < 0);
        if ($n->es_contribuyente_especial && DB::scalar("SELECT to_regproc('fn_proximos_vencimientos') IS NOT NULL")) {
            $items[] = $venc
                ? ['clave' => 'declaraciones_vencidas', 'estado' => 'aviso', 'titulo' => count($venc) . ' ' . $pl(count($venc), 'declaración vencida sin marcar como presentada', 'declaraciones vencidas sin marcar como presentadas'), 'detalle' => 'Si ya la presentaste, márcala en el Panel. Si no, hazlo cuanto antes: pueden aplicar multas e intereses (confírmalo con tu contador).', 'enlace' => '/dashboard', 'accion' => 'Ir al Panel']
                : ['clave' => 'declaraciones_vencidas', 'estado' => 'ok', 'titulo' => 'No tienes declaraciones vencidas sin marcar', 'detalle' => null, 'enlace' => null, 'accion' => null];
        }

        // 9 · Asiento de apertura (19_regimen_y_apertura.sql): sin él los balances no parten de la situación real del negocio
        if (DB::scalar("SELECT to_regclass('asientos') IS NOT NULL") && DB::scalar("SELECT to_regproc('fn_crear_apertura') IS NOT NULL")) {
            $items[] = DB::scalar("SELECT EXISTS (SELECT 1 FROM asientos WHERE origen_tipo = 'APERTURA')")
                ? ['clave' => 'apertura', 'estado' => 'ok', 'titulo' => 'El asiento de apertura está registrado', 'detalle' => null, 'enlace' => null, 'accion' => null]
                : ['clave' => 'apertura', 'estado' => 'aviso', 'titulo' => 'Falta el asiento de apertura de la contabilidad', 'detalle' => 'Es el primer asiento del Libro Diario: con él el balance parte de lo que tenías (caja, bancos, inventario, deudas y capital).', 'enlace' => '/contabilidad', 'accion' => 'Ir a Contabilidad'];
        }

        $malos = count(array_filter($items, fn ($i) => $i['estado'] === 'bad'));
        $avisos = count(array_filter($items, fn ($i) => $i['estado'] === 'aviso'));
        return ['mes' => $mes, 'semaforo' => $malos ? 'rojo' : ($avisos ? 'ambar' : 'verde'), 'problemas' => $malos, 'avisos' => $avisos, 'items' => $items];
    }

    /** Todo lo que lleva el paquete de declaración del mes: resumen de IVA, libros de ventas y compras, retenciones e IGTF. */
    public function paquete(string $mes, string $hoy): array
    {
        $desde = "$mes-01";
        $hasta = date('Y-m-t', strtotime($desde));
        $d = $this->datos('resumen', $mes, $hoy);
        return ['mes' => $mes, 'hoy' => $hoy, 'desde' => $desde, 'hasta' => $hasta, 'emisor' => $this->emisor(), 'regimen' => $d['regimen'], 'resumen' => $d['resumen'],
            'ventas' => $this->libroVentas($desde, $hasta), 'compras' => $this->libroCompras($desde, $hasta), 'retenciones' => $this->retenciones($desde, $hasta), 'igtf' => $this->igtf($desde, $hasta)];
    }

    private function mesPedido(Request $r, string $hoy): string
    {
        $mes = preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', (string) $r->query('mes')) ? $r->query('mes') : substr($hoy, 0, 7);
        return min($mes, substr($hoy, 0, 7));
    }

    public function cierreFiscal(Request $r)
    {
        $this->soloAdmin();
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        return response()->json($this->cierre($this->mesPedido($r, $hoy), $hoy));
    }

    public function paqueteDatos(Request $r)
    {
        $this->soloAdmin();
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        return response()->json($this->paquete($this->mesPedido($r, $hoy), $hoy));
    }

    /** Marca una quincena como enterada (pagada al SENIAT). No mueve dinero ni crea asientos: es el control de lo que ya pagaste. */
    public function enterar(Request $r)
    {
        $this->soloAdmin();
        abort_unless($this->hayEnteradas(), 422, 'Falta ejecutar 11_cierre_y_pagos.sql en la base de datos.');
        $d = $r->validate(['anio' => 'required|integer|between:2000,2100', 'mes' => 'required|integer|between:1,12', 'quincena' => 'required|integer|in:1,2',
            'fecha_pago' => 'required|date_format:Y-m-d', 'referencia' => 'nullable|string|max:60', 'observaciones' => 'nullable|string|max:300']);
        try {
            DB::statement('SELECT fn_enterar_retenciones(?, ?, ?, ?, ?, ?, ?)', [$d['anio'], $d['mes'], $d['quincena'], $d['fecha_pago'], $d['referencia'] ?? null, auth()->id(), $d['observaciones'] ?? null]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'Esa quincena ya está marcada como enterada.')], 422);
        }
        return $this->quincenasJson($r);
    }

    public function desmarcarEnterada(Request $r, int $id)
    {
        $this->soloAdmin();
        abort_unless($this->hayEnteradas(), 422, 'Falta ejecutar 11_cierre_y_pagos.sql en la base de datos.');
        $d = $r->validate(['motivo' => 'required|string|min:3|max:300']);
        try {
            DB::statement('SELECT fn_desmarcar_enterada(?, ?)', [$id, $d['motivo']]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo desmarcar.')], 422);
        }
        return $this->quincenasJson($r);
    }

    private function quincenasJson(Request $r)
    {
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $mes = $this->mesPedido($r, $hoy);
        return response()->json(['ok' => true, 'quincenas' => $this->quincenas("$mes-01", date('Y-m-t', strtotime("$mes-01")), $hoy)]);
    }

    /* ───────── Acciones ───────── */

    /** Ventas recientes para elegir a cuál se le pone una nota o una factura fiscal. */
    public function buscarVentas(Request $r)
    {
        $this->soloAdmin();
        $q = trim((string) $r->query('q'));
        $f = DB::table('ventas as v')->leftJoin('clientes as c', 'c.id', '=', 'v.cliente_id')->where('v.estado', 'COMPLETADA')
            ->when($q !== '', fn ($w) => $w->where(fn ($x) => $x->whereRaw('v.numero::text LIKE ?', ["$q%"])->orWhere('v.numero_factura_fiscal', 'ILIKE', "%$q%")->orWhere('c.nombre', 'ILIKE', "%$q%")))
            ->orderByDesc('v.numero')->limit(15)
            ->get(['v.id', 'v.numero', 'v.numero_factura_fiscal as factura', 'v.fecha_valor as fecha', 'v.iva_pct', 'v.total_ves', DB::raw("COALESCE(c.nombre, 'Consumidor final') AS cliente")]);
        return response()->json($f->map(fn ($x) => ['id' => $x->id, 'numero' => $x->numero, 'factura' => $x->factura, 'fecha' => $x->fecha, 'iva_pct' => (float) $x->iva_pct, 'total_ves' => (float) $x->total_ves, 'cliente' => $x->cliente]));
    }

    public function asignarFactura(Request $r, int $id)
    {
        $this->soloAdmin();
        $d = $r->validate(['factura' => 'required|string|max:40', 'control' => 'nullable|string|max:40']);
        try {
            DB::statement('CALL sp_asignar_factura_fiscal(?, ?, ?)', [$id, $d['factura'], $d['control'] ?? null]);
        } catch (QueryException $e) {
            throw ValidationException::withMessages(['factura' => $this->mensaje($e, 'Ese número de factura ya está en uso.')]);
        }
        return back()->with('ok', 'Factura fiscal asignada.');
    }

    public function notaStore(Request $r)
    {
        $this->soloAdmin();
        $d = $r->validate([
            'tipo' => 'required|in:C,D', 'venta_id' => 'required|integer', 'numero' => 'required|string|max:40', 'control' => 'nullable|string|max:40',
            'fecha' => 'nullable|date_format:Y-m-d', 'base' => 'required|numeric|gt:0|max:999999999999', 'motivo' => 'required|string|min:3|max:300',
            'devuelve_inventario' => 'nullable|boolean', 'productos' => 'nullable|array', 'productos.*.producto_id' => 'required_with:productos|integer', 'productos.*.cantidad' => 'required_with:productos|numeric|gt:0',
            'devolucion' => 'nullable|array', 'devolucion.metodo_pago_id' => 'required_with:devolucion|integer', 'devolucion.monto' => 'nullable|numeric|gt:0', 'devolucion.referencia' => 'nullable|string|max:60',
        ]);
        $ventas = new VentasController();
        [$devuelve, $json, $errDev] = $ventas->prepararDevolucion($d, (int) $d['venta_id']);
        if ($errDev) {
            throw ValidationException::withMessages(['productos' => $errDev]);
        }
        try {
            $ventas->registrarNota($d['tipo'], (int) $d['venta_id'], $d['numero'], (float) $d['base'], $d['motivo'], $d['control'] ?? null, $d['fecha'] ?? null, $devuelve, $json, $d['devolucion'] ?? null);
        } catch (QueryException $e) {
            throw ValidationException::withMessages($e->getCode() === '23505' ? ['numero' => 'Ya existe una nota de ese tipo con ese número.'] : ['general' => $this->mensaje($e, 'No se pudo registrar la nota.')]);
        }
        return back()->with('ok', $d['tipo'] === 'C' ? ($devuelve ? 'Nota de crédito registrada y mercancía devuelta al inventario.' : 'Nota de crédito registrada.') . (! empty($d['devolucion']['metodo_pago_id']) ? ' El dinero devuelto quedó anotado en tu caja.' : '') : 'Nota de débito registrada.');
    }

    /** Retención de IVA: COMPRA = la practicas tú a un proveedor; VENTA = te la practicó un cliente. */
    public function retencionStore(Request $r)
    {
        $this->soloAdmin();
        abort_unless($this->hayRetenciones(), 422, 'Falta ejecutar 08_retenciones_iva.sql en la base de datos.');
        $d = $r->validate([
            'sentido' => 'required|in:COMPRA,VENTA', 'documento_id' => 'required|integer', 'comprobante' => 'required_if:sentido,VENTA|nullable|string|max:40', 'fecha' => 'required|date_format:Y-m-d',
            'porcentaje' => 'required|in:75,100', 'retenido' => 'nullable|numeric|gt:0|max:999999999999', 'observaciones' => 'nullable|string|max:300',
        ]);
        try {
            DB::statement('CALL sp_registrar_retencion_iva(?, ?, ?, ?, ?, ?, ?, ?)', [$d['sentido'], $d['documento_id'], $d['comprobante'] ?? null, $d['fecha'], $d['porcentaje'], auth()->id(), $d['retenido'] ?? null, $d['observaciones'] ?? null]);
        } catch (QueryException $e) {
            throw ValidationException::withMessages(['comprobante' => $this->mensaje($e, 'Ya existe una retención para esa factura o ese comprobante.')]);
        }
        $num = $d['sentido'] === 'COMPRA'
            ? DB::scalar("SELECT numero_comprobante FROM retenciones_iva WHERE compra_id = ? AND estado = 'ACTIVA'", [$d['documento_id']])
            : null;
        return back()->with('ok', $num ? "Retención registrada. Comprobante N.º {$num}." : 'Retención de IVA registrada.');
    }

    public function retencionAnular(Request $r, int $id)
    {
        $this->soloAdmin();
        abort_unless($this->hayRetenciones(), 422, 'Falta ejecutar 08_retenciones_iva.sql en la base de datos.');
        $d = $r->validate(['motivo' => 'required|string|min:3|max:300']);
        try {
            DB::statement('CALL sp_anular_retencion_iva(?, ?, ?)', [$id, auth()->id(), $d['motivo']]);
        } catch (QueryException $e) {
            throw ValidationException::withMessages(['motivo' => $this->mensaje($e, 'No se pudo anular la retención.')]);
        }
        return back()->with('ok', 'Retención anulada.');
    }

    public function importacionStore(Request $r, int $id)
    {
        $this->soloAdmin();
        abort_unless($this->hayRetenciones(), 422, 'Falta ejecutar 08_retenciones_iva.sql en la base de datos.');
        $d = $r->validate(['planilla' => 'required|string|max:40', 'fecha' => 'required|date_format:Y-m-d', 'aduana' => 'nullable|string|max:120']);
        try {
            DB::statement('CALL sp_registrar_importacion(?, ?, ?, ?, ?)', [$id, $d['planilla'], $d['fecha'], $d['aduana'] ?? null, auth()->id()]);
        } catch (QueryException $e) {
            throw ValidationException::withMessages(['planilla' => $this->mensaje($e, 'Esa planilla ya está registrada.')]);
        }
        return back()->with('ok', 'Planilla de importación registrada.');
    }

    public function alicuotaUpdate(Request $r)
    {
        $this->soloAdmin();
        $d = $r->validate(['codigo' => 'required|in:IVA_GENERAL,IGTF_DIVISAS', 'pct' => 'required|numeric|min:0|max:100', 'desde' => 'required|date_format:Y-m-d', 'nota' => 'required|string|min:3|max:300']);
        try {
            DB::statement('CALL sp_cambiar_alicuota(?, ?, ?, ?, ?)', [$d['codigo'], $d['pct'], $d['desde'], $d['nota'], auth()->id()]);
        } catch (QueryException $e) {
            throw ValidationException::withMessages(['pct' => $this->mensaje($e, 'No se pudo cambiar la alícuota.')]);
        }
        return back()->with('ok', 'Alícuota actualizada.');
    }

    /** Los procedimientos de la base lanzan mensajes en español claros (TV005/TV006): se los mostramos tal cual. */
    private function mensaje(QueryException $e, string $porDefecto): string
    {
        if ($e->getCode() === '23505') {
            return $porDefecto;
        }
        if (preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|$)/su', $e->getMessage(), $m) && in_array(substr((string) $e->getCode(), 0, 2), ['TV'], true)) {
            return trim($m[1]);
        }
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }
}
