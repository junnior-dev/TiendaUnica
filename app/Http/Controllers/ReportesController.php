<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Reportes de gestión. Los datos salen de SQL (sin recalcular nada en PHP); el PDF lo arma el navegador con jsPDF (lib/pdfReportes.js),
 * igual que los demás informes. Cada método devuelve JSON con las filas, los totales y el rango usado.
 *   rentabilidad()      utilidad por producto: ingreso (base sin IVA) − costo congelado en cada línea vendida
 *   comprasGlobal()     compras por proveedor en el rango (las anuladas no cuentan)
 *   movimientosCaja()   ingresos y egresos de caja: cobros de ventas, cobros de cuentas por cobrar y movimientos manuales
 */
class ReportesController extends Controller
{
    use ContextoPagina;

    private function soloAdmin(): void
    {
        abort_unless(strtoupper((string) auth()->user()->rol) === 'ADMINISTRADOR', 403, 'Los reportes son solo para administradores.');
    }

    public function index()
    {
        $this->soloAdmin();
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        return Inertia::render('Reportes/Index', $this->contexto() + [
            'hoy' => $hoy, 'inicio_mes' => substr($hoy, 0, 8) . '01',
            'emisor' => $this->emisor(),
            'aperturas' => array_map(fn ($a) => ['id' => (int) $a->id, 'etiqueta' => sprintf('Turno %d · %s · %s%s', $a->id, $a->cajero, $a->cuando, $a->estado === 'ABIERTA' ? ' (abierto)' : '')],
                DB::select("SELECT a.id, u.nombre_completo AS cajero, a.estado, to_char(a.fecha_apertura AT TIME ZONE 'America/Caracas', 'DD/MM/YYYY HH24:MI') AS cuando
                              FROM aperturas_caja a JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.id DESC LIMIT 60")),
        ]);
    }

    private function emisor(): array
    {
        $n = DB::table('negocio')->first(['razon_social', 'nombre_comercial', 'rif', 'direccion_fiscal']);
        return ['razon_social' => $n->razon_social, 'comercial' => $n->nombre_comercial, 'rif' => $n->rif, 'direccion' => $n->direccion_fiscal];
    }

    /** [desde, hasta] válidos (por defecto el mes en curso; nunca más de 5 años). */
    private function rango(Request $r): array
    {
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $f = fn ($v) => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $v) && strtotime($v) !== false ? $v : null;
        $desde = $f($r->query('desde')) ?? substr($hoy, 0, 8) . '01';
        $hasta = $f($r->query('hasta')) ?? $hoy;
        if ($desde > $hasta) {
            [$desde, $hasta] = [$hasta, $desde];
        }
        if ((strtotime($hasta) - strtotime($desde)) / 86400 > 1830) {
            $desde = date('Y-m-d', strtotime($hasta . ' -1830 days'));
        }
        return [$desde, $hasta];
    }

    /**
     * 5A · Rentabilidad por producto. Margen = utilidad / ingreso.
     * Descuenta las notas de crédito (y suma las de débito) con fecha en el período:
     *   · Ingreso: la base de cada nota en USD (base_ves ÷ tasa de la venta original). Si la nota devolvió mercancía, se reparte entre
     *     los productos devueltos según su valor; si no tiene productos (descuento, ajuste), va a la fila «Notas sin producto».
     *   · Costo: solo lo que volvió al inventario (cantidad devuelta × costo promedio congelado en esa venta).
     * Así el total de ingreso cuadra con el libro de ventas. Una nota del período sobre una venta de otro período resta aquí igual.
     */
    public function rentabilidad(Request $r)
    {
        $this->soloAdmin();
        [$desde, $hasta] = $this->rango($r);
        $filas = DB::select("
            SELECT p.id, p.sku, p.nombre, COALESCE(sum(d.cantidad), 0) AS unidades,
                   COALESCE(sum(d.base_usd), 0) AS ingreso_usd,
                   COALESCE(sum(ROUND(d.cantidad * d.costo_unitario_usd, 2)), 0) AS costo_usd
              FROM detalle_venta d JOIN ventas v ON v.id = d.venta_id JOIN productos p ON p.id = d.producto_id
             WHERE v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN ? AND ?
             GROUP BY p.id, p.sku, p.nombre", [$desde, $hasta]);

        $porProducto = [];
        foreach ($filas as $f) {
            $porProducto[(int) $f->id] = ['id' => (int) $f->id, 'sku' => $f->sku, 'producto' => $f->nombre, 'unidades' => (float) $f->unidades,
                'ingreso_usd' => (float) $f->ingreso_usd, 'costo_usd' => (float) $f->costo_usd];
        }

        // Notas de crédito con productos devueltos: ingreso repartido por valor devuelto + costo devuelto + unidades.
        $devueltos = DB::select("
            WITH linea AS (
                SELECT d.venta_id, d.producto_id, sum(d.cantidad) AS cant, sum(d.base_usd) AS ing, sum(ROUND(d.cantidad * d.costo_unitario_usd, 2)) AS cos
                  FROM detalle_venta d GROUP BY d.venta_id, d.producto_id
            ), dev AS (
                SELECT nd.nota_id, nd.producto_id, nd.cantidad, n.base_ves, v.tasa_cambio,
                       nd.cantidad * l.ing / l.cant AS valor, nd.cantidad * l.cos / l.cant AS costo
                  FROM notas_ajuste_detalle nd
                  JOIN notas_ajuste n ON n.id = nd.nota_id AND n.tipo = 'C' AND n.fecha BETWEEN ? AND ?
                  JOIN ventas v ON v.id = n.venta_id AND v.estado = 'COMPLETADA'
                  JOIN linea l ON l.venta_id = n.venta_id AND l.producto_id = nd.producto_id AND l.cant > 0
            )
            SELECT dev.producto_id, p.sku, p.nombre, sum(dev.cantidad) AS unidades,
                   sum((dev.base_ves / dev.tasa_cambio) * dev.valor / NULLIF(sum(dev.valor) OVER (PARTITION BY dev.nota_id), 0)) AS ingreso_usd,
                   sum(dev.costo) AS costo_usd
              FROM dev JOIN productos p ON p.id = dev.producto_id
             GROUP BY dev.producto_id, p.sku, p.nombre", [$desde, $hasta]);
        foreach ($devueltos as $d) {
            $id = (int) $d->producto_id;
            $porProducto[$id] ??= ['id' => $id, 'sku' => $d->sku, 'producto' => $d->nombre, 'unidades' => 0.0, 'ingreso_usd' => 0.0, 'costo_usd' => 0.0];
            $porProducto[$id]['unidades'] -= (float) $d->unidades;
            $porProducto[$id]['ingreso_usd'] -= (float) $d->ingreso_usd;
            $porProducto[$id]['costo_usd'] -= (float) $d->costo_usd;
        }

        // Notas sin productos (descuentos y ajustes): créditos restan, débitos suman. No mueven inventario, solo ingreso.
        $sinProducto = (float) DB::scalar("
            SELECT COALESCE(sum(CASE WHEN n.tipo = 'C' THEN -1 ELSE 1 END * n.base_ves / v.tasa_cambio), 0)
              FROM notas_ajuste n JOIN ventas v ON v.id = n.venta_id AND v.estado = 'COMPLETADA'
             WHERE n.fecha BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM notas_ajuste_detalle nd WHERE nd.nota_id = n.id)", [$desde, $hasta]);

        $out = [];
        foreach ($porProducto as $f) {
            $ing = round($f['ingreso_usd'], 2);
            $cos = round($f['costo_usd'], 2);
            $ut = round($ing - $cos, 2);
            $out[] = ['id' => $f['id'], 'sku' => $f['sku'], 'producto' => $f['producto'], 'unidades' => round($f['unidades'], 3), 'ingreso_usd' => $ing, 'costo_usd' => $cos,
                'utilidad_usd' => $ut, 'margen_pct' => $ing > 0 ? round($ut / $ing * 100, 2) : null];
        }
        usort($out, fn ($a, $b) => [$b['utilidad_usd'], $a['producto']] <=> [$a['utilidad_usd'], $b['producto']]);
        if (abs($sinProducto) >= 0.005) {
            $ing = round($sinProducto, 2);
            $out[] = ['id' => 0, 'sku' => '—', 'producto' => 'Notas de crédito y débito sin producto', 'unidades' => 0.0, 'ingreso_usd' => $ing, 'costo_usd' => 0.0,
                'utilidad_usd' => $ing, 'margen_pct' => null];
        }
        $ing = round(array_sum(array_column($out, 'ingreso_usd')), 2);
        $cos = round(array_sum(array_column($out, 'costo_usd')), 2);
        return response()->json(['desde' => $desde, 'hasta' => $hasta, 'filas' => $out, 'emisor' => $this->emisor(), 'generado_por' => auth()->user()->nombre_completo,
            'totales' => ['unidades' => round(array_sum(array_column($out, 'unidades')), 3), 'ingreso_usd' => $ing, 'costo_usd' => $cos, 'utilidad_usd' => round($ing - $cos, 2), 'margen_pct' => $ing > 0 ? round(($ing - $cos) / $ing * 100, 2) : null]]);
    }

    /** 5B · Compras por proveedor. Total Bs = lo que ya calcula v_libro_compras (tasa de la fecha de la factura). */
    public function comprasGlobal(Request $r)
    {
        $this->soloAdmin();
        [$desde, $hasta] = $this->rango($r);
        $filas = DB::select("
            SELECT pr.id, pr.rif, pr.razon_social, count(*) AS facturas, COALESCE(sum(c.total_usd), 0) AS total_usd, sum(l.total_ves) AS total_ves,
                   count(*) FILTER (WHERE l.total_ves IS NULL) AS sin_tasa
              FROM compras c JOIN proveedores pr ON pr.id = c.proveedor_id LEFT JOIN v_libro_compras l ON l.compra_id = c.id
             WHERE c.estado = 'REGISTRADA' AND c.fecha_factura BETWEEN ? AND ?
             GROUP BY pr.id, pr.rif, pr.razon_social ORDER BY sum(c.total_usd) DESC, pr.razon_social", [$desde, $hasta]);
        $out = array_map(fn ($f) => ['id' => (int) $f->id, 'rif' => $f->rif, 'proveedor' => $f->razon_social, 'facturas' => (int) $f->facturas,
            'total_usd' => round((float) $f->total_usd, 2), 'total_ves' => round((float) $f->total_ves, 2), 'sin_tasa' => (int) $f->sin_tasa], $filas);
        return response()->json(['desde' => $desde, 'hasta' => $hasta, 'filas' => $out, 'emisor' => $this->emisor(), 'generado_por' => auth()->user()->nombre_completo,
            'totales' => ['facturas' => array_sum(array_column($out, 'facturas')), 'total_usd' => round(array_sum(array_column($out, 'total_usd')), 2), 'total_ves' => round(array_sum(array_column($out, 'total_ves')), 2), 'sin_tasa' => array_sum(array_column($out, 'sin_tasa'))]]);
    }

    /**
     * 5C · Movimientos de caja detallados, por turno (?apertura=ID) o por rango (?desde&hasta).
     *   INGRESO: pagos de ventas (con IGTF) + cobros de cuentas por cobrar activos     EGRESO: movimientos manuales activos
     * Los cobros anulados y los movimientos anulados no se listan; los vueltos ya están descontados del pago (se ven en el Corte Z).
     */
    public function movimientosCaja(Request $r)
    {
        $this->soloAdmin();
        $ap = (int) $r->query('apertura', 0);
        $etiqueta = null;
        if ($ap) {
            $a = DB::selectOne("SELECT a.*, u.nombre_completo AS cajero FROM aperturas_caja a JOIN usuarios u ON u.id = a.usuario_id WHERE a.id = ?", [$ap]);
            if (! $a) {
                return response()->json(['message' => 'Ese turno no existe.'], 404);
            }
            $etiqueta = sprintf('Turno %d · %s', $a->id, $a->cajero);
            $ini = $a->fecha_apertura;
            $fin = $a->fecha_cierre ?? now()->addMinute()->toDateTimeString();
            $desde = $hasta = null;
            $ventasW = ['v.usuario_id = ? AND v.fecha_hora >= ? AND v.fecha_hora <= ?', [$a->usuario_id, $ini, $fin]];
            $cobrosW = ['p.usuario_id = ? AND p.created_at >= ? AND p.created_at <= ?', [$a->usuario_id, $ini, $fin]];
            $manualW = ['m.apertura_id = ?', [$ap]];
        } else {
            [$desde, $hasta] = $this->rango($r);
            $ventasW = ['v.fecha_valor BETWEEN ? AND ?', [$desde, $hasta]];
            $cobrosW = ['p.fecha BETWEEN ? AND ?', [$desde, $hasta]];
            $manualW = ["(m.created_at AT TIME ZONE 'America/Caracas')::date BETWEEN ? AND ?", [$desde, $hasta]];
        }

        $filas = DB::select("
            SELECT * FROM (
              SELECT (v.fecha_hora AT TIME ZONE 'America/Caracas') AS cuando, 'INGRESO' AS tipo,
                     'Venta N.º ' || v.numero || ' · ' || mp.nombre AS concepto, pv.monto_cobrado AS monto, trim(pv.moneda) AS moneda,
                     pv.monto_usd + COALESCE(pv.igtf_usd, 0) AS usd, pv.monto_ves + COALESCE(pv.igtf_ves, 0) AS ves, 'VENTA' AS origen
                FROM pagos_venta pv JOIN ventas v ON v.id = pv.venta_id JOIN metodos_pago mp ON mp.id = pv.metodo_pago_id
               WHERE v.estado = 'COMPLETADA' AND {$ventasW[0]}
              UNION ALL
              SELECT p.created_at AT TIME ZONE 'America/Caracas', 'INGRESO', 'Cobro cuenta por cobrar N.º ' || p.cuenta_por_cobrar_id || ' · ' || cl.nombre, p.monto, trim(p.moneda), p.monto_usd, p.monto_ves, 'COBRO_CXC'
                FROM pagos_cobrar p JOIN cuentas_por_cobrar c ON c.id = p.cuenta_por_cobrar_id JOIN clientes cl ON cl.id = c.cliente_id
               WHERE p.estado = 'ACTIVO' AND {$cobrosW[0]}
              UNION ALL
              SELECT m.created_at AT TIME ZONE 'America/Caracas', m.tipo, m.concepto, m.monto, trim(m.moneda), m.monto_usd, m.monto_ves, 'MANUAL'
                FROM movimientos_caja m WHERE m.estado = 'ACTIVO' AND m.origen = 'MANUAL' AND {$manualW[0]}
            ) x ORDER BY cuando", array_merge($ventasW[1], $cobrosW[1], $manualW[1]));

        $out = array_map(fn ($f) => ['fecha' => substr((string) $f->cuando, 0, 16), 'tipo' => $f->tipo, 'concepto' => $f->concepto, 'monto' => (float) $f->monto, 'moneda' => $f->moneda,
            'usd' => (float) $f->usd, 'ves' => (float) $f->ves, 'origen' => $f->origen], $filas);
        $suma = fn ($t, $c) => round(array_sum(array_map(fn ($x) => $x[$c], array_filter($out, fn ($x) => $x['tipo'] === $t))), 2);
        return response()->json(['desde' => $desde, 'hasta' => $hasta, 'apertura' => $ap ?: null, 'etiqueta' => $etiqueta, 'filas' => $out, 'emisor' => $this->emisor(), 'generado_por' => auth()->user()->nombre_completo,
            'totales' => ['ingresos_usd' => $suma('INGRESO', 'usd'), 'ingresos_ves' => $suma('INGRESO', 'ves'), 'egresos_usd' => $suma('EGRESO', 'usd'), 'egresos_ves' => $suma('EGRESO', 'ves'),
                'neto_usd' => round($suma('INGRESO', 'usd') - $suma('EGRESO', 'usd'), 2), 'neto_ves' => round($suma('INGRESO', 'ves') - $suma('EGRESO', 'ves'), 2)]]);
    }

    /**
     * 5D · Análisis ABC de lo vendido (fn_analisis_abc del archivo 28): A = 80 % del valor, B = hasta 95 %, C = el resto.
     * Se clasifica por ingreso (VALOR) o por unidades vendidas (UNIDADES).
     */
    public function abc(Request $r)
    {
        $this->soloAdmin();
        [$desde, $hasta] = $this->rango($r);
        $por = strtoupper($r->query('por', 'VALOR')) === 'UNIDADES' ? 'UNIDADES' : 'VALOR';
        $filas = DB::select('SELECT * FROM fn_analisis_abc(?::date, ?::date, ?::text)', [$desde, $hasta, $por]);
        $out = array_map(fn ($f) => ['clase' => $f->clase, 'sku' => $f->sku, 'producto' => $f->nombre, 'categoria' => $f->categoria,
            'unidades' => round((float) $f->unidades, 3), 'ingreso_usd' => round((float) $f->ingreso_usd, 2), 'costo_usd' => round((float) $f->costo_usd, 2),
            'utilidad_usd' => round((float) $f->utilidad_usd, 2), 'margen_pct' => $f->margen_pct !== null ? round((float) $f->margen_pct, 2) : null,
            'participacion_pct' => round((float) $f->participacion_pct, 2), 'acumulado_pct' => round((float) $f->acumulado_pct, 2)], $filas);
        $tot = ['A' => 0, 'B' => 0, 'C' => 0];
        foreach ($out as $x) {
            $tot[$x['clase']]++;
        }
        return response()->json(['desde' => $desde, 'hasta' => $hasta, 'por' => $por, 'filas' => $out, 'emisor' => $this->emisor(), 'generado_por' => auth()->user()->nombre_completo,
            'totales' => ['productos' => count($out), 'clase_a' => $tot['A'], 'clase_b' => $tot['B'], 'clase_c' => $tot['C'],
                'ingreso_usd' => round(array_sum(array_column($out, 'ingreso_usd')), 2), 'utilidad_usd' => round(array_sum(array_column($out, 'utilidad_usd')), 2)]]);
    }

    /** 5E · Rotación de inventario (fn_rotacion_inventario del 28): días para agotar, valor parado y piezas muertas. */
    public function rotacion(Request $r)
    {
        $this->soloAdmin();
        [$desde, $hasta] = $this->rango($r);
        $filas = DB::select('SELECT * FROM fn_rotacion_inventario(?::date, ?::date)', [$desde, $hasta]);
        $out = array_map(fn ($f) => ['sku' => $f->sku, 'producto' => $f->nombre, 'categoria' => $f->categoria, 'marca' => $f->marca,
            'stock' => round((float) $f->stock_actual, 3), 'valor_stock_usd' => round((float) $f->valor_stock_usd, 2),
            'unidades_vendidas' => round((float) $f->unidades_vendidas, 3),
            'dias_para_agotar' => $f->dias_para_agotar !== null ? round((float) $f->dias_para_agotar, 1) : null,
            'dias_sin_venta' => $f->dias_sin_venta !== null ? (int) $f->dias_sin_venta : null,
            'estado' => $f->estado_rotacion], $filas);
        $parado = round(array_sum(array_column($out, 'valor_stock_usd')), 2);
        $muertos = array_filter($out, fn ($x) => str_starts_with($x['estado'], 'MUERTO'));
        return response()->json(['desde' => $desde, 'hasta' => $hasta, 'filas' => $out, 'emisor' => $this->emisor(), 'generado_por' => auth()->user()->nombre_completo,
            'totales' => ['productos' => count($out), 'valor_parado_usd' => $parado, 'muertos' => count($muertos),
                'valor_muerto_usd' => round(array_sum(array_column($muertos, 'valor_stock_usd')), 2)]]);
    }

    /** 5F · Rentabilidad por categoría (fn_rentabilidad_categoria del 28). */
    public function rentabilidadCategoria(Request $r)
    {
        $this->soloAdmin();
        [$desde, $hasta] = $this->rango($r);
        $filas = DB::select('SELECT * FROM fn_rentabilidad_categoria(?::date, ?::date)', [$desde, $hasta]);
        $out = array_map(fn ($f) => ['categoria_id' => (int) $f->categoria_id, 'categoria' => $f->categoria,
            'unidades' => round((float) $f->unidades, 3), 'ingreso_usd' => round((float) $f->ingreso_usd, 2),
            'costo_usd' => round((float) $f->costo_usd, 2), 'utilidad_usd' => round((float) $f->utilidad_usd, 2),
            'margen_pct' => $f->margen_pct !== null ? round((float) $f->margen_pct, 2) : null,
            'participacion_pct' => round((float) $f->participacion_pct, 2)], $filas);
        $ing = round(array_sum(array_column($out, 'ingreso_usd')), 2);
        $cos = round(array_sum(array_column($out, 'costo_usd')), 2);
        return response()->json(['desde' => $desde, 'hasta' => $hasta, 'filas' => $out, 'emisor' => $this->emisor(), 'generado_por' => auth()->user()->nombre_completo,
            'totales' => ['categorias' => count($out), 'unidades' => round(array_sum(array_column($out, 'unidades')), 3),
                'ingreso_usd' => $ing, 'costo_usd' => $cos, 'utilidad_usd' => round($ing - $cos, 2),
                'margen_pct' => $ing > 0 ? round(($ing - $cos) / $ing * 100, 2) : null]]);
    }

    /** 5G · Rentabilidad por cliente (fn_rentabilidad_cliente del 28): ticket promedio, margen y días sin comprar. */
    public function rentabilidadCliente(Request $r)
    {
        $this->soloAdmin();
        [$desde, $hasta] = $this->rango($r);
        $filas = DB::select('SELECT * FROM fn_rentabilidad_cliente(?::date, ?::date)', [$desde, $hasta]);
        $out = array_map(fn ($f) => ['cliente_id' => (int) $f->cliente_id, 'cliente' => $f->cliente, 'documento' => $f->documento,
            'ventas' => (int) $f->ventas, 'unidades' => round((float) $f->unidades, 3), 'ingreso_usd' => round((float) $f->ingreso_usd, 2),
            'costo_usd' => round((float) $f->costo_usd, 2), 'utilidad_usd' => round((float) $f->utilidad_usd, 2),
            'margen_pct' => $f->margen_pct !== null ? round((float) $f->margen_pct, 2) : null,
            'ticket_promedio_usd' => $f->ticket_promedio_usd !== null ? round((float) $f->ticket_promedio_usd, 2) : null,
            'ultima_compra' => $f->ultima_compra, 'dias_sin_comprar' => $f->dias_sin_comprar !== null ? (int) $f->dias_sin_comprar : null], $filas);
        $ing = round(array_sum(array_column($out, 'ingreso_usd')), 2);
        $cos = round(array_sum(array_column($out, 'costo_usd')), 2);
        return response()->json(['desde' => $desde, 'hasta' => $hasta, 'filas' => $out, 'emisor' => $this->emisor(), 'generado_por' => auth()->user()->nombre_completo,
            'totales' => ['clientes' => count($out), 'ventas' => array_sum(array_column($out, 'ventas')), 'ingreso_usd' => $ing, 'costo_usd' => $cos,
                'utilidad_usd' => round($ing - $cos, 2), 'margen_pct' => $ing > 0 ? round(($ing - $cos) / $ing * 100, 2) : null]]);
    }
}
