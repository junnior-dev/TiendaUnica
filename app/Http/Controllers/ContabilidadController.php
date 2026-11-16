<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Contabilidad (/contabilidad): plan de cuentas, libro diario, libro mayor, libro de inventario. Solo administradores.
 * Usa lo que crea database/sql/10_contabilidad.sql:
 *   fn_libro_diario · fn_libro_mayor · fn_mayor_cuenta · fn_libro_inventario   → los reportes
 *   fn_crear_asiento                                                          → asientos manuales y de apertura
 *   contab_config.automatica                                                  → interruptor de los asientos automáticos de ventas y compras
 *   contab_parametros                                                         → qué cuenta usa cada asiento automático
 * Los métodos de datos son públicos para poder probarlos sin HTTP.
 */
class ContabilidadController extends Controller
{
    use ContextoPagina;

    private const VISTAS = ['resumen', 'diario', 'mayor', 'inventario', 'cuentas'];
    private const TIPOS = ['ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO'];
    private const ETIQUETAS = [
        'CAJA' => 'Cobros en efectivo', 'BANCOS' => 'Cobros por banco, pago móvil o punto de venta', 'VENTAS' => 'Ventas de mercancía', 'IVA_DEBITO' => 'IVA que cobras a tus clientes',
        'IVA_CREDITO' => 'IVA que pagas a tus proveedores', 'IGTF_POR_PAGAR' => 'IGTF cobrado', 'IGTF_POR_RECLAMAR' => 'IGTF devuelto por anulaciones', 'INVENTARIO' => 'Inventario de mercancía',
        'COSTO_VENTAS' => 'Costo de lo vendido', 'CUENTAS_POR_PAGAR' => 'Deudas con proveedores', 'REDONDEO' => 'Diferencias por redondeo',
    ];
    /** Las agrega 11_cierre_y_pagos.sql; solo se exigen cuando ese archivo está instalado. */
    private const ETIQUETAS_CIERRE = ['DIFERENCIAL_CAMBIARIO' => 'Ganancia o pérdida cambiaria', 'RESULTADOS_ACUM' => 'Resultados acumulados (cierre del ejercicio)'];

    /** Las agrega 19_regimen_y_apertura.sql (apertura e ISLR). No se exigen para activar la contabilidad automática. */
    private const ETIQUETAS_FISCAL = [
        'ACTIVOS_FIJOS' => 'Mobiliario y equipos (apertura)', 'OTRAS_CXC' => 'Otras cuentas por cobrar (apertura)', 'OTRAS_CXP' => 'Otras deudas (apertura)',
        'CAPITAL' => 'Capital', 'ISLR_POR_PAGAR' => 'ISLR retenido por pagar', 'GASTOS_GENERALES' => 'Gasto de servicios con retención de ISLR',
    ];

    public function index(Request $r)
    {
        $this->soloAdmin();
        return Inertia::render('Contabilidad/Index', [...$this->contexto(), ...$this->datos($r->query())]);
    }

    private function soloAdmin(): void
    {
        abort_if(strtoupper((string) (auth()->user()->rol ?? '')) !== 'ADMINISTRADOR', 403, 'Solo un administrador puede consultar la contabilidad.');
    }

    private function instalado(): bool
    {
        return (bool) DB::scalar("SELECT to_regclass('asientos') IS NOT NULL AND to_regclass('contab_parametros') IS NOT NULL AND to_regprocedure('fn_libro_mayor(date,date)') IS NOT NULL");
    }

    /** ¿Está instalado 11_cierre_y_pagos.sql? (cierre de ejercicio, bloqueo de períodos, ajuste cambiario) */
    private function cierreActivo(): bool
    {
        static $v = null;
        return $v ??= (bool) DB::scalar("SELECT to_regprocedure('fn_cierre_ejercicio(integer,bigint)') IS NOT NULL AND to_regclass('periodos_contables') IS NOT NULL");
    }

    /** Mayor del período SIN el asiento de cierre del ejercicio, para que el resultado del mes no «vea» el cierre anual. */
    private function mayorSinCierre(string $desde, string $hasta): array
    {
        return $this->cierreActivo() ? DB::select('SELECT * FROM fn_libro_mayor(?::date, ?::date, false)', [$desde, $hasta]) : DB::select('SELECT * FROM fn_libro_mayor(?, ?)', [$desde, $hasta]);
    }

    private function emisor(): array
    {
        $n = DB::selectOne('SELECT razon_social, nombre_comercial, rif, direccion_fiscal, telefono FROM negocio WHERE id = fn_negocio_actual()');
        return ['razon_social' => $n->razon_social ?? '', 'comercial' => $n->nombre_comercial ?? null, 'rif' => $n->rif ?? '', 'direccion' => $n->direccion_fiscal ?? '', 'telefono' => $n->telefono ?? ''];
    }

    private function parametrosRequeridos(): int { return count(self::ETIQUETAS) + ($this->cierreActivo() ? count(self::ETIQUETAS_CIERRE) : 0); }

    private static function num($v): float { return (float) $v; }

    /* ───────────── Datos de la página ───────────── */

    public function datos(array $q): array
    {
        $hoy = DB::scalar('SELECT fn_hoy()');
        $vista = in_array($q['vista'] ?? '', self::VISTAS, true) ? $q['vista'] : 'resumen';
        $mes = preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', (string) ($q['mes'] ?? '')) ? $q['mes'] : substr($hoy, 0, 7);
        if ($mes > substr($hoy, 0, 7)) $mes = substr($hoy, 0, 7);
        $desde = $mes . '-01';
        $hasta = DB::scalar("SELECT (date_trunc('month', ?::date) + interval '1 month - 1 day')::date", [$desde]);
        $base = ['instalado' => $this->instalado(), 'vista' => $vista, 'mes' => $mes, 'hoy' => $hoy, 'desde' => $desde, 'hasta' => $hasta, 'emisor' => $this->emisor()];
        if (!$base['instalado']) return $base;
        $base['automatica'] = (bool) DB::scalar('SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()');
        $base['parametros_ok'] = (int) DB::scalar('SELECT count(*) FROM contab_parametros') >= $this->parametrosRequeridos();
        $base['cierre_activo'] = $this->cierreActivo();
        $base['periodo_cerrado'] = $base['cierre_activo'] && (bool) DB::scalar('SELECT fn_periodo_cerrado(?::date)', [$desde]);
        $base['cuentas_mov'] = array_map(fn($c) => ['id' => (int) $c->id, 'codigo' => $c->codigo, 'nombre' => $c->nombre, 'tipo' => $c->tipo],
            DB::select('SELECT id, codigo, nombre, tipo FROM plan_cuentas WHERE permite_movimiento AND activa ORDER BY codigo'));
        return $base + [$vista => $this->{'vista' . ucfirst($vista)}($q, $desde, $hasta, $hoy)];
    }

    private function vistaResumen(array $q, string $desde, string $hasta, string $hoy): array
    {
        $cod = []; foreach (DB::select('SELECT p.clave, c.codigo FROM contab_parametros p JOIN plan_cuentas c ON c.id = p.cuenta_id') as $p) $cod[$p->clave] = $p->codigo;
        $ingresos = 0.0; $gastos = 0.0; $costo = 0.0; $saldo = []; $resultados = [];
        foreach ($this->mayorSinCierre($desde, $hasta) as $c) {
            $saldo[$c->codigo] = (float) $c->saldo_final;
            if (!in_array($c->tipo, ['INGRESO', 'GASTO'], true) || ((float) $c->debitos == 0 && (float) $c->creditos == 0)) continue;
            $monto = round($c->tipo === 'INGRESO' ? $c->creditos - $c->debitos : $c->debitos - $c->creditos, 2);
            if ($c->tipo === 'INGRESO') $ingresos += $monto; else $gastos += $monto;
            if ($c->codigo === ($cod['COSTO_VENTAS'] ?? null)) $costo = $monto;
            $resultados[] = ['codigo' => $c->codigo, 'cuenta' => $c->cuenta, 'tipo' => $c->tipo, 'monto' => $monto];
        }
        $t = DB::selectOne('SELECT COALESCE(sum(d.debe),0) AS debe, COALESCE(sum(d.haber),0) AS haber FROM asiento_detalle d JOIN asientos a ON a.id = d.asiento_id WHERE a.fecha <= ?', [$hasta]);
        return [
            'asientos' => (int) DB::scalar('SELECT count(*) FROM asientos WHERE fecha BETWEEN ? AND ?', [$desde, $hasta]),
            'ingresos' => round($ingresos, 2), 'costo_ventas' => round($costo, 2), 'gastos' => round($gastos, 2), 'resultado' => round($ingresos - $gastos, 2),
            'inventario' => $saldo[$cod['INVENTARIO'] ?? ''] ?? 0.0, 'iva_debito' => $saldo[$cod['IVA_DEBITO'] ?? ''] ?? 0.0, 'iva_credito' => $saldo[$cod['IVA_CREDITO'] ?? ''] ?? 0.0,
            'comprobacion' => ['debe' => round((float) $t->debe, 2), 'haber' => round((float) $t->haber, 2)],
            'resultados' => $resultados,
            'sin_asiento' => [
                'ventas' => (int) DB::scalar("SELECT count(*) FROM ventas v WHERE v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM asientos a WHERE a.origen_tipo = 'VENTA' AND a.origen_id = v.id)", [$desde, $hasta]),
                'compras' => (int) DB::scalar("SELECT count(*) FROM compras c WHERE c.estado = 'REGISTRADA' AND c.fecha_factura BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM asientos a WHERE a.origen_tipo = 'COMPRA' AND a.origen_id = c.id)", [$desde, $hasta]),
            ],
            'recientes' => array_map(fn($a) => ['id' => (int) $a->id, 'numero' => (int) $a->numero_asiento, 'fecha' => $a->fecha, 'concepto' => $a->concepto, 'total' => (float) $a->total_debe],
                DB::select('SELECT id, numero_asiento, fecha, concepto, total_debe FROM asientos ORDER BY numero_asiento DESC LIMIT 5')),
        ];
    }

    private function vistaDiario(array $q, string $desde, string $hasta, string $hoy): array
    {
        $as = DB::select('SELECT id, numero_asiento, fecha, concepto, total_debe, origen_tipo, origen_id FROM asientos WHERE fecha BETWEEN ? AND ? ORDER BY fecha, numero_asiento LIMIT 500', [$desde, $hasta]);
        $lin = [];
        foreach (DB::select('SELECT d.asiento_id, c.codigo, c.nombre AS cuenta, d.debe, d.haber, d.glosa FROM asiento_detalle d JOIN plan_cuentas c ON c.id = d.cuenta_id JOIN asientos a ON a.id = d.asiento_id
                              WHERE a.fecha BETWEEN ? AND ? ORDER BY d.asiento_id, d.haber > 0, d.id', [$desde, $hasta]) as $l) {
            $lin[$l->asiento_id][] = ['codigo' => $l->codigo, 'cuenta' => $l->cuenta, 'debe' => (float) $l->debe, 'haber' => (float) $l->haber, 'glosa' => $l->glosa];
        }
        $filas = array_map(fn($a) => ['id' => (int) $a->id, 'numero' => (int) $a->numero_asiento, 'fecha' => $a->fecha, 'concepto' => $a->concepto, 'total' => (float) $a->total_debe,
            'origen' => $a->origen_tipo, 'origen_id' => $a->origen_id ? (int) $a->origen_id : null, 'lineas' => $lin[$a->id] ?? []], $as);
        return ['filas' => $filas, 'total' => round(array_sum(array_column($filas, 'total')), 2)];
    }

    private function vistaMayor(array $q, string $desde, string $hasta, string $hoy): array
    {
        $filas = array_map(fn($c) => ['codigo' => $c->codigo, 'cuenta' => $c->cuenta, 'tipo' => $c->tipo, 'naturaleza' => $c->naturaleza, 'inicial' => (float) $c->saldo_inicial,
            'debitos' => (float) $c->debitos, 'creditos' => (float) $c->creditos, 'final' => (float) $c->saldo_final], DB::select('SELECT * FROM fn_libro_mayor(?, ?)', [$desde, $hasta]));
        $cuenta = preg_match('/^\d+(\.\d+)*$/', (string) ($q['cuenta'] ?? '')) ? $q['cuenta'] : null;
        $detalle = null;
        if ($cuenta && ($c = DB::selectOne('SELECT codigo, nombre, tipo FROM plan_cuentas WHERE codigo = ?', [$cuenta]))) {
            $fila = null; foreach ($filas as $f) if ($f['codigo'] === $cuenta) $fila = $f;
            $detalle = ['codigo' => $c->codigo, 'cuenta' => $c->nombre, 'tipo' => $c->tipo, 'inicial' => $fila['inicial'] ?? 0.0,
                'movimientos' => array_map(fn($m) => ['fecha' => $m->fecha, 'numero' => (int) $m->numero_asiento, 'concepto' => $m->concepto, 'debe' => (float) $m->debe, 'haber' => (float) $m->haber, 'saldo' => (float) $m->saldo],
                    DB::select('SELECT * FROM fn_mayor_cuenta(?, ?, ?)', [$cuenta, $desde, $hasta]))];
        }
        $tot = ['debitos' => round(array_sum(array_column($filas, 'debitos')), 2), 'creditos' => round(array_sum(array_column($filas, 'creditos')), 2)];
        return ['filas' => $filas, 'totales' => $tot, 'detalle' => $detalle];
    }

    private function vistaInventario(array $q, string $desde, string $hasta, string $hoy): array
    {
        $corte = $hasta > $hoy ? $hoy : $hasta;
        $filas = array_map(fn($c) => ['categoria' => $c->categoria, 'total' => (bool) $c->es_total, 'productos' => (int) $c->productos, 'unidades' => (float) $c->unidades, 'costo' => $c->costo_promedio_usd === null ? null : (float) $c->costo_promedio_usd,
            'valor_usd' => (float) $c->valor_usd, 'valor_ves' => $c->valor_ves === null ? null : (float) $c->valor_ves], DB::select('SELECT * FROM fn_libro_inventario(?)', [$corte]));
        $contable = (float) DB::scalar("SELECT COALESCE((SELECT m.saldo_final FROM fn_libro_mayor('2000-01-01', ?) m WHERE m.codigo = (SELECT c.codigo FROM contab_parametros p JOIN plan_cuentas c ON c.id = p.cuenta_id WHERE p.clave = 'INVENTARIO')), 0)", [$corte]);
        return ['corte' => $corte, 'contable_ves' => $contable, 'filas' => $filas, 'sin_tasa' => count(array_filter($filas, fn($f) => $f['valor_ves'] === null && $f['productos'] > 0)) > 0];
    }

    private function vistaCuentas(array $q, string $desde, string $hasta, string $hoy): array
    {
        $cuentas = array_map(fn($c) => ['id' => (int) $c->id, 'codigo' => $c->codigo, 'nombre' => $c->nombre, 'tipo' => $c->tipo, 'padre_id' => $c->cuenta_padre_id ? (int) $c->cuenta_padre_id : null,
            'mov' => (bool) $c->permite_movimiento, 'activa' => (bool) $c->activa, 'usos' => (int) $c->usos, 'hijas' => (int) $c->hijas],
            DB::select('SELECT c.*, (SELECT count(*) FROM asiento_detalle d WHERE d.cuenta_id = c.id) AS usos, (SELECT count(*) FROM plan_cuentas h WHERE h.cuenta_padre_id = c.id) AS hijas FROM plan_cuentas c ORDER BY c.codigo'));
        $par = array_map(fn($p) => ['clave' => $p->clave, 'etiqueta' => self::ETIQUETAS[$p->clave] ?? self::ETIQUETAS_CIERRE[$p->clave] ?? self::ETIQUETAS_FISCAL[$p->clave] ?? $p->clave, 'cuenta_id' => (int) $p->cuenta_id, 'nota' => $p->nota],
            DB::select('SELECT clave, cuenta_id, nota FROM contab_parametros ORDER BY array_position(ARRAY[\'CAJA\',\'BANCOS\',\'VENTAS\',\'IVA_DEBITO\',\'IGTF_POR_PAGAR\',\'COSTO_VENTAS\',\'INVENTARIO\',\'IVA_CREDITO\',\'CUENTAS_POR_PAGAR\',\'IGTF_POR_RECLAMAR\',\'REDONDEO\',\'DIFERENCIAL_CAMBIARIO\',\'RESULTADOS_ACUM\'], clave)'));
        return ['cuentas' => $cuentas, 'parametros' => $par];
    }

    /* ───────────── Datos completos para los PDF (libros y estados) ───────────── */

    /** GET /contabilidad/reporte?tipo=diario|mayor|inventario|estados&mes=YYYY-MM · JSON con todo lo que el PDF necesita, sin límites de pantalla. */
    public function reporte(Request $r)
    {
        $this->soloAdmin();
        if (!$this->instalado()) return $this->error('La contabilidad todavía no está instalada.');
        $q = $r->query();
        $tipo = $q['tipo'] ?? '';
        if (!in_array($tipo, ['diario', 'mayor', 'inventario', 'estados'], true)) return $this->error('Elige un reporte válido.');
        $hoy = DB::scalar('SELECT fn_hoy()');
        $mes = preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', (string) ($q['mes'] ?? '')) ? $q['mes'] : substr($hoy, 0, 7);
        if ($mes > substr($hoy, 0, 7)) $mes = substr($hoy, 0, 7);
        $desde = $mes . '-01';
        $hasta = DB::scalar("SELECT (date_trunc('month', ?::date) + interval '1 month - 1 day')::date", [$desde]);
        $corte = $hasta > $hoy ? $hoy : $hasta;
        return response()->json(['ok' => true, 'tipo' => $tipo, 'mes' => $mes, 'desde' => $desde, 'hasta' => $hasta, 'corte' => $corte, 'emisor' => $this->emisor()] + $this->{'reporte' . ucfirst($tipo)}($desde, $hasta, $corte));
    }

    public function reporteDatos(string $tipo, string $mes): array
    {
        $hoy = DB::scalar('SELECT fn_hoy()');
        $desde = $mes . '-01';
        $hasta = DB::scalar("SELECT (date_trunc('month', ?::date) + interval '1 month - 1 day')::date", [$desde]);
        $corte = $hasta > $hoy ? $hoy : $hasta;
        return ['tipo' => $tipo, 'mes' => $mes, 'desde' => $desde, 'hasta' => $hasta, 'corte' => $corte, 'emisor' => $this->emisor()] + $this->{'reporte' . ucfirst($tipo)}($desde, $hasta, $corte);
    }

    private function reporteDiario(string $desde, string $hasta, string $corte): array
    {
        $as = DB::select('SELECT id, numero_asiento, fecha, concepto, total_debe FROM asientos WHERE fecha BETWEEN ? AND ? ORDER BY fecha, numero_asiento', [$desde, $hasta]);
        $lin = [];
        foreach (DB::select('SELECT d.asiento_id, c.codigo, c.nombre AS cuenta, d.debe, d.haber, d.glosa FROM asiento_detalle d JOIN plan_cuentas c ON c.id = d.cuenta_id JOIN asientos a ON a.id = d.asiento_id
                              WHERE a.fecha BETWEEN ? AND ? ORDER BY d.asiento_id, d.haber > 0, d.id', [$desde, $hasta]) as $l) {
            $lin[$l->asiento_id][] = ['codigo' => $l->codigo, 'cuenta' => $l->cuenta, 'debe' => (float) $l->debe, 'haber' => (float) $l->haber, 'glosa' => $l->glosa];
        }
        $filas = array_map(fn($a) => ['numero' => (int) $a->numero_asiento, 'fecha' => $a->fecha, 'concepto' => $a->concepto, 'total' => (float) $a->total_debe, 'lineas' => $lin[$a->id] ?? []], $as);
        return ['filas' => $filas, 'total' => round(array_sum(array_column($filas, 'total')), 2)];
    }

    /** Mayor analítico completo: cada cuenta con movimiento (o saldo) con su saldo inicial, movimientos y saldo final. */
    private function reporteMayor(string $desde, string $hasta, string $corte): array
    {
        $cuentas = [];
        foreach (DB::select('SELECT * FROM fn_libro_mayor(?, ?)', [$desde, $hasta]) as $c) {
            if ((float) $c->saldo_inicial == 0.0 && (float) $c->debitos == 0.0 && (float) $c->creditos == 0.0) continue;
            $cuentas[] = ['codigo' => $c->codigo, 'cuenta' => $c->cuenta, 'tipo' => $c->tipo, 'naturaleza' => $c->naturaleza, 'inicial' => (float) $c->saldo_inicial, 'debitos' => (float) $c->debitos, 'creditos' => (float) $c->creditos, 'final' => (float) $c->saldo_final,
                'movimientos' => array_map(fn($m) => ['fecha' => $m->fecha, 'numero' => (int) $m->numero_asiento, 'concepto' => $m->concepto, 'debe' => (float) $m->debe, 'haber' => (float) $m->haber, 'saldo' => (float) $m->saldo],
                    DB::select('SELECT * FROM fn_mayor_cuenta(?, ?, ?)', [$c->codigo, $desde, $hasta]))];
        }
        return ['cuentas' => $cuentas];
    }

    private function reporteInventario(string $desde, string $hasta, string $corte): array
    {
        $filas = array_map(fn($p) => ['categoria' => $p->categoria, 'sku' => $p->sku, 'producto' => $p->producto, 'unidad' => $p->unidad, 'existencia' => (float) $p->existencia, 'costo' => (float) $p->costo_usd,
            'valor_usd' => (float) $p->valor_usd, 'valor_ves' => $p->valor_ves === null ? null : (float) $p->valor_ves], DB::select('SELECT * FROM fn_libro_inventario_detalle(?)', [$corte]));
        $tasa = null; try { $tasa = DB::scalar('SELECT (fn_tasa_aplicable(?::date)).tasa', [$corte]); } catch (\Throwable $e) { $tasa = null; }
        return ['filas' => $filas, 'tasa' => $tasa === null ? null : (float) $tasa, 'sin_tasa' => $tasa === null && count($filas) > 0];
    }

    /** Balance de comprobación del mes, estado de resultados del mes y balance general acumulado al cierre. */
    private function reporteEstados(string $desde, string $hasta, string $corte): array
    {
        $map = fn($c) => ['codigo' => $c->codigo, 'cuenta' => $c->cuenta, 'tipo' => $c->tipo, 'inicial' => (float) $c->saldo_inicial, 'debitos' => (float) $c->debitos, 'creditos' => (float) $c->creditos, 'final' => (float) $c->saldo_final];
        $mes = array_map($map, DB::select('SELECT * FROM fn_libro_mayor(?, ?)', [$desde, $hasta]));
        $mesRes = array_map($map, $this->mayorSinCierre($desde, $hasta));
        $acum = array_map($map, DB::select("SELECT * FROM fn_libro_mayor('2000-01-01', ?)", [$hasta]));
        $res = fn($lista, $tipos) => array_values(array_filter($lista, fn($c) => in_array($c['tipo'], $tipos, true) && ($c['final'] != 0.0)));
        $periodo = fn($tipo) => array_values(array_filter(array_map(fn($c) => ['codigo' => $c['codigo'], 'cuenta' => $c['cuenta'], 'monto' => round($tipo === 'INGRESO' ? $c['creditos'] - $c['debitos'] : $c['debitos'] - $c['creditos'], 2)],
            array_filter($mesRes, fn($c) => $c['tipo'] === $tipo)), fn($c) => $c['monto'] != 0.0));
        $ing = round(array_sum(array_column($periodo('INGRESO'), 'monto')), 2); $gas = round(array_sum(array_column($periodo('GASTO'), 'monto')), 2);
        $ingAc = round(array_sum(array_map(fn($c) => $c['final'], $res($acum, ['INGRESO']))), 2); $gasAc = round(array_sum(array_map(fn($c) => $c['final'], $res($acum, ['GASTO']))), 2);
        return [
            'comprobacion' => $mes,
            'resultados' => ['ingresos' => $periodo('INGRESO'), 'gastos' => $periodo('GASTO'), 'total_ingresos' => $ing, 'total_gastos' => $gas, 'resultado' => round($ing - $gas, 2)],
            'balance' => ['activos' => $res($acum, ['ACTIVO']), 'pasivos' => $res($acum, ['PASIVO']), 'patrimonio' => $res($acum, ['PATRIMONIO']), 'resultado_acumulado' => round($ingAc - $gasAc, 2)],
        ];
    }

    /* ───────────── Acciones (JSON) ───────────── */

    public function automatica(Request $r)
    {
        $this->soloAdmin();
        $v = $r->validate(['activa' => 'required|boolean']);
        if ($v['activa'] && (int) DB::scalar('SELECT count(*) FROM contab_parametros') < $this->parametrosRequeridos()) return $this->error('Faltan cuentas por configurar en «Cuentas del sistema».');
        DB::statement('UPDATE contab_config SET automatica = ?::boolean WHERE id = fn_negocio_actual()', [$v['activa']]);
        return response()->json(['ok' => true, 'automatica' => (bool) $v['activa']]);
    }

    public function asientoStore(Request $r)
    {
        $this->soloAdmin();
        $v = $r->validate(['fecha' => 'required|date', 'concepto' => 'required|string|max:200', 'tipo' => 'nullable|in:MANUAL,APERTURA', 'lineas' => 'required|array|min:2',
            'lineas.*.cuenta_id' => 'required|integer', 'lineas.*.debe' => 'nullable|numeric|min:0', 'lineas.*.haber' => 'nullable|numeric|min:0', 'lineas.*.glosa' => 'nullable|string|max:200']);
        if ($v['fecha'] > DB::scalar('SELECT fn_hoy()')) return $this->error('La fecha del asiento no puede ser futura.');
        $lineas = array_map(fn($l) => ['cuenta_id' => (int) $l['cuenta_id'], 'debe' => round((float) ($l['debe'] ?? 0), 2), 'haber' => round((float) ($l['haber'] ?? 0), 2), 'glosa' => $l['glosa'] ?? null], $v['lineas']);
        foreach ($lineas as $l) if (($l['debe'] > 0) === ($l['haber'] > 0)) return $this->error('Cada línea debe tener un monto en el debe o en el haber, no en los dos.');
        try {
            $id = DB::transaction(fn() => (int) DB::scalar('SELECT fn_crear_asiento(?::date, ?::text, ?::text, NULL, ?::jsonb, ?::bigint)', [$v['fecha'], $v['concepto'], $v['tipo'] ?? 'MANUAL', json_encode($lineas), auth()->id()]));
        } catch (QueryException $e) { return $this->error($this->mensaje($e)); }
        return response()->json(['ok' => true, 'id' => $id, 'numero' => (int) DB::scalar('SELECT numero_asiento FROM asientos WHERE id = ?', [$id])]);
    }

    /* ───────────── Asiento de apertura (19_regimen_y_apertura.sql) ───────────── */

    /** Lo que el sistema ya sabe para esa fecha: inventario a costo (kardex), tasa y si la apertura ya existe. */
    public function aperturaVer(Request $r)
    {
        $this->soloAdmin();
        if (!DB::scalar("SELECT to_regproc('fn_crear_apertura') IS NOT NULL")) return $this->error('Falta ejecutar 19_regimen_y_apertura.sql en la base de datos.');
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $f = (string) $r->query('fecha', $hoy);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $f) || $f > $hoy) $f = $hoy;
        $v = json_decode(DB::scalar('SELECT fn_apertura_vista(?::date)', [$f]), true);
        return response()->json(['fecha' => $f, 'hoy' => $hoy] + $v);
    }

    public function aperturaStore(Request $r)
    {
        $this->soloAdmin();
        $m = 'nullable|numeric|min:0|max:999999999999';
        $v = $r->validate(['fecha' => 'required|date_format:Y-m-d', 'caja_ves' => $m, 'caja_usd' => $m, 'bancos_ves' => $m, 'bancos_usd' => $m, 'activos_fijos_ves' => $m, 'otras_cxc_ves' => $m, 'deudas_ves' => $m]);
        try {
            $id = DB::transaction(fn () => (int) DB::scalar('SELECT fn_crear_apertura(?::date, ?::numeric, ?::numeric, ?::numeric, ?::numeric, ?::numeric, ?::numeric, ?::numeric, ?::bigint)', [
                $v['fecha'], $v['caja_ves'] ?? 0, $v['caja_usd'] ?? 0, $v['bancos_ves'] ?? 0, $v['bancos_usd'] ?? 0, $v['activos_fijos_ves'] ?? 0, $v['otras_cxc_ves'] ?? 0, $v['deudas_ves'] ?? 0, auth()->id()]));
        } catch (QueryException $e) { return $this->error($this->mensaje($e)); }
        return response()->json(['ok' => true, 'id' => $id, 'numero' => (int) DB::scalar('SELECT numero_asiento FROM asientos WHERE id = ?', [$id])]);
    }

    public function cuentaStore(Request $r)
    {
        $this->soloAdmin();
        $v = $r->validate(['codigo' => ['required', 'regex:/^\d+(\.\d+)*$/'], 'nombre' => 'required|string|max:120', 'tipo' => 'required|in:' . implode(',', self::TIPOS), 'cuenta_padre_id' => 'nullable|integer', 'permite_movimiento' => 'required|boolean']);
        if ($v['cuenta_padre_id'] ?? null) {
            $p = DB::selectOne('SELECT codigo, tipo, (SELECT count(*) FROM asiento_detalle WHERE cuenta_id = plan_cuentas.id) AS usos FROM plan_cuentas WHERE id = ?', [$v['cuenta_padre_id']]);
            if (!$p) return $this->error('La cuenta superior no existe.');
            if ($p->tipo !== $v['tipo']) return $this->error("Esta cuenta cuelga de {$p->codigo}, que es de tipo " . strtolower($p->tipo) . '. Usa el mismo tipo.');
            if ((int) $p->usos > 0) return $this->error("La cuenta {$p->codigo} ya tiene movimientos y no puede tener cuentas hijas.");
            if (!str_starts_with($v['codigo'], $p->codigo . '.')) return $this->error("El código debe empezar por {$p->codigo}. (por ejemplo {$p->codigo}.01).");
        }
        if (DB::scalar('SELECT 1 FROM plan_cuentas WHERE codigo = ?', [$v['codigo']])) return $this->error('Ya existe una cuenta con ese código.');
        try {
            $id = (int) DB::scalar('INSERT INTO plan_cuentas (codigo, nombre, tipo, cuenta_padre_id, permite_movimiento) VALUES (?, ?, ?, ?::bigint, ?::boolean) RETURNING id',
                [$v['codigo'], trim($v['nombre']), $v['tipo'], $v['cuenta_padre_id'] ?? null, $v['permite_movimiento']]);
        } catch (QueryException $e) { return $this->error($this->mensaje($e)); }
        return response()->json(['ok' => true, 'id' => $id, ...$this->vistaCuentas([], '', '', '')]);
    }

    public function cuentaUpdate(Request $r, $id)
    {
        $this->soloAdmin();
        $v = $r->validate(['nombre' => 'required|string|max:120', 'activa' => 'required|boolean']);
        if (!$v['activa'] && DB::scalar('SELECT 1 FROM contab_parametros WHERE cuenta_id = ?', [$id])) return $this->error('Esta cuenta la usan los asientos automáticos. Cambia primero la cuenta en «Cuentas del sistema».');
        $n = DB::update('UPDATE plan_cuentas SET nombre = ?, activa = ?::boolean WHERE id = ?', [trim($v['nombre']), $v['activa'], $id]);
        if (!$n) return $this->error('No encontramos esa cuenta.');
        return response()->json(['ok' => true, ...$this->vistaCuentas([], '', '', '')]);
    }

    public function parametroUpdate(Request $r, $clave)
    {
        $this->soloAdmin();
        $v = $r->validate(['cuenta_id' => 'required|integer']);
        if (!isset(self::ETIQUETAS[$clave]) && !($this->cierreActivo() && isset(self::ETIQUETAS_CIERRE[$clave])) && !isset(self::ETIQUETAS_FISCAL[$clave])) return $this->error('Esa función no existe.');
        $c = DB::selectOne('SELECT codigo, permite_movimiento, activa FROM plan_cuentas WHERE id = ?', [$v['cuenta_id']]);
        if (!$c || !$c->permite_movimiento || !$c->activa) return $this->error('Elige una cuenta activa que acepte movimientos.');
        DB::statement('INSERT INTO contab_parametros (clave, cuenta_id) VALUES (?, ?::bigint) ON CONFLICT (clave) DO UPDATE SET cuenta_id = EXCLUDED.cuenta_id', [$clave, $v['cuenta_id']]);
        return response()->json(['ok' => true, ...$this->vistaCuentas([], '', '', '')]);
    }

    /* ───────────── Cierre de ejercicio, períodos, ajuste cambiario, exportación (11_cierre_y_pagos.sql) ───────────── */

    private function requiereCierre(): void
    {
        abort_unless($this->cierreActivo(), 422, 'Falta ejecutar 11_cierre_y_pagos.sql en la base de datos.');
    }

    private function sqlError(QueryException $e): string
    {
        return $this->mensaje($e);
    }

    /** Estado de los 12 meses de un año: abierto o cerrado, y si ya tiene su ajuste cambiario. Más el estado del cierre del ejercicio. */
    public function periodos(?int $anio = null): array
    {
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $anio = $anio && $anio >= 2000 && $anio <= (int) substr($hoy, 0, 4) ? $anio : (int) substr($hoy, 0, 4);
        $cerr = []; foreach (DB::select("SELECT periodo, cerrado_en, nota FROM periodos_contables WHERE estado = 'CERRADO' AND date_part('year', periodo) = ?", [$anio]) as $c) $cerr[$c->periodo] = $c;
        $aj = DB::select("SELECT origen_id FROM asientos WHERE origen_tipo = 'AJUSTE_CAMBIARIO' AND origen_id BETWEEN ? AND ?", [$anio * 100 + 1, $anio * 100 + 12]);
        $ajustes = array_map(fn($a) => (int) $a->origen_id, $aj);
        $meses = [];
        for ($m = 1; $m <= 12; $m++) {
            $p = sprintf('%d-%02d-01', $anio, $m);
            $fin = date('Y-m-t', strtotime($p));
            $meses[] = ['mes' => $m, 'periodo' => $p, 'terminado' => $fin < $hoy, 'cerrado' => isset($cerr[$p]), 'cerrado_en' => $cerr[$p]->cerrado_en ?? null, 'nota' => $cerr[$p]->nota ?? null,
                'asientos' => (int) DB::scalar('SELECT count(*) FROM asientos WHERE fecha BETWEEN ? AND ?', [$p, $fin]), 'ajuste' => in_array($anio * 100 + $m, $ajustes, true)];
        }
        $cierreAsiento = DB::selectOne("SELECT id, numero_asiento, fecha FROM asientos WHERE origen_tipo = 'CIERRE' AND origen_id = ?", [$anio]);
        return ['anio' => $anio, 'hoy' => $hoy, 'meses' => $meses, 'ejercicio' => ['cerrado' => (bool) $cierreAsiento, 'numero' => $cierreAsiento ? (int) $cierreAsiento->numero_asiento : null, 'terminado' => "$anio-12-31" < $hoy],
            'anios' => array_map(fn($a) => (int) $a->y, DB::select("SELECT DISTINCT date_part('year', fecha)::int AS y FROM asientos UNION SELECT date_part('year', fn_hoy())::int ORDER BY 1 DESC"))];
    }

    public function periodosVer(Request $r)
    {
        $this->soloAdmin(); $this->requiereCierre();
        return response()->json($this->periodos((int) $r->query('anio')));
    }

    public function periodoCerrar(Request $r)
    {
        $this->soloAdmin(); $this->requiereCierre();
        $v = $r->validate(['periodo' => ['required', 'regex:/^\d{4}-(0[1-9]|1[0-2])(-01)?$/'], 'nota' => 'nullable|string|max:200']);
        $p = substr($v['periodo'], 0, 7) . '-01';
        try { DB::statement('SELECT fn_cerrar_periodo(?::date, ?::bigint, ?::text)', [$p, auth()->id(), $v['nota'] ?? null]); }
        catch (QueryException $e) { return $this->error($this->sqlError($e)); }
        return response()->json(['ok' => true, ...$this->periodos((int) substr($p, 0, 4))]);
    }

    public function periodoReabrir(Request $r)
    {
        $this->soloAdmin(); $this->requiereCierre();
        $v = $r->validate(['periodo' => ['required', 'regex:/^\d{4}-(0[1-9]|1[0-2])(-01)?$/'], 'motivo' => 'required|string|min:5|max:200']);
        $p = substr($v['periodo'], 0, 7) . '-01';
        try { DB::statement('SELECT fn_reabrir_periodo(?::date, ?::bigint, ?::text)', [$p, auth()->id(), $v['motivo']]); }
        catch (QueryException $e) { return $this->error($this->sqlError($e)); }
        return response()->json(['ok' => true, ...$this->periodos((int) substr($p, 0, 4))]);
    }

    /** Vista previa del asiento de cierre del ejercicio: debita los ingresos, acredita los gastos y lleva la diferencia a Resultados acumulados (3.1.02). */
    public function cierreEjercicioDatos(int $anio): array
    {
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $lineas = array_map(fn($l) => ['codigo' => $l->codigo, 'cuenta' => $l->nombre, 'tipo' => $l->tipo, 'debe' => (float) $l->debe, 'haber' => (float) $l->haber], DB::select('SELECT * FROM fn_cierre_ejercicio_vista(?)', [$anio]));
        $dl = round(array_sum(array_column($lineas, 'debe')), 2); $cl = round(array_sum(array_column($lineas, 'haber')), 2);
        $res = DB::selectOne("SELECT c.codigo, c.nombre FROM contab_parametros p JOIN plan_cuentas c ON c.id = p.cuenta_id WHERE p.clave = 'RESULTADOS_ACUM'");
        $dif = round($dl - $cl, 2);   // >0: ingresos > gastos → utilidad
        $ya = DB::selectOne("SELECT numero_asiento FROM asientos WHERE origen_tipo = 'CIERRE' AND origen_id = ?", [$anio]);
        $previo = null;
        foreach (DB::select("SELECT DISTINCT date_part('year', fecha)::int AS y FROM asientos WHERE date_part('year', fecha) < ? ORDER BY 1", [$anio]) as $y) {
            if (DB::scalar('SELECT count(*) FROM fn_cierre_ejercicio_vista(?)', [$y->y]) > 0 && !DB::scalar("SELECT 1 FROM asientos WHERE origen_tipo = 'CIERRE' AND origen_id = ?", [$y->y])) { $previo = (int) $y->y; break; }
        }
        $bloqueo = $ya ? "El ejercicio $anio ya fue cerrado (asiento N.º {$ya->numero_asiento})." : ("$anio-12-31" >= $hoy ? "El ejercicio $anio todavía no termina: se cierra después del 31 de diciembre." : ($previo ? "Primero cierra el ejercicio $previo: tiene ingresos o gastos sin cerrar." : (!$lineas ? "El ejercicio $anio no tiene ingresos ni gastos que cerrar." : null)));
        return ['anio' => $anio, 'fecha' => "$anio-12-31", 'lineas' => $lineas, 'resumen' => ['ingresos' => $dl, 'gastos' => $cl, 'resultado' => $dif, 'tipo' => $dif > 0 ? 'utilidad' : ($dif < 0 ? 'perdida' : 'nulo')],
            'destino' => $res ? ['codigo' => $res->codigo, 'nombre' => $res->nombre] : null, 'bloqueo' => $bloqueo, 'cerrado' => (bool) $ya, 'numero' => $ya ? (int) $ya->numero_asiento : null,
            'meses_abiertos' => (int) DB::scalar("SELECT count(*) FROM generate_series(1, 12) m WHERE NOT fn_periodo_cerrado(make_date(?, m, 1))", [$anio])];
    }

    public function cierreEjercicioVer(Request $r)
    {
        $this->soloAdmin(); $this->requiereCierre();
        $hoy = (int) substr((string) DB::scalar('SELECT fn_hoy()'), 0, 4);
        $a = (int) $r->query('anio', $hoy - 1);
        return response()->json($this->cierreEjercicioDatos($a >= 2000 && $a <= $hoy ? $a : $hoy - 1));
    }

    public function cierreEjercicioStore(Request $r)
    {
        $this->soloAdmin(); $this->requiereCierre();
        $v = $r->validate(['anio' => 'required|integer|between:2000,2100']);
        try { $id = (int) DB::scalar('SELECT fn_cierre_ejercicio(?::int, ?::bigint)', [$v['anio'], auth()->id()]); }
        catch (QueryException $e) { return $this->error($this->sqlError($e)); }
        return response()->json(['ok' => true, 'numero' => (int) DB::scalar('SELECT numero_asiento FROM asientos WHERE id = ?', [$id]), 'cierre' => $this->cierreEjercicioDatos($v['anio'])]);
    }

    /**
     * Ajuste por diferencial cambiario del inventario al cierre de un mes: compara el inventario valorado a la tasa del cierre con su saldo contable.
     * Es un ajuste de un activo no monetario: la forma de reconocerlo depende de tu política contable; confírmala con tu contador.
     */
    public function ajusteDatos(string $mes): array
    {
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $fin = min(date('Y-m-t', strtotime("$mes-01")), $hoy);
        $c = DB::selectOne('SELECT * FROM fn_ajuste_cambiario_calculo(?::date)', [$fin]);
        $clave = (int) str_replace('-', '', $mes);
        $ya = DB::selectOne("SELECT numero_asiento FROM asientos WHERE origen_tipo = 'AJUSTE_CAMBIARIO' AND origen_id = ?", [$clave]);
        $dif = round((float) $c->diferencia_ves, 2);
        $sinAsientos = (int) DB::scalar("SELECT count(*) FROM asientos WHERE origen_tipo IN ('VENTA','COMPRA','APERTURA')") === 0;
        $bloqueo = $ya ? "Ya registraste el ajuste cambiario de este mes (asiento N.º {$ya->numero_asiento})." : ((float) $c->valor_fisico_ves == 0.0 ? 'No hay inventario valorado a esa fecha: revisa que exista la tasa del día.' : ($dif == 0.0 ? 'No hay diferencia que ajustar: el inventario contable ya coincide.' : (DB::scalar('SELECT fn_periodo_cerrado(?::date)', [$fin]) ? 'Ese mes está cerrado: reábrelo para registrar el ajuste.' : null)));
        return ['mes' => $mes, 'fecha' => $fin, 'fisico_ves' => (float) $c->valor_fisico_ves, 'contable_ves' => (float) $c->saldo_contable_ves, 'diferencia_ves' => $dif, 'valor_usd' => (float) $c->valor_usd, 'tasa' => $c->tasa === null ? null : (float) $c->tasa,
            'sentido' => $dif > 0 ? 'ganancia' : ($dif < 0 ? 'perdida' : 'nulo'), 'bloqueo' => $bloqueo, 'registrado' => (bool) $ya, 'numero' => $ya ? (int) $ya->numero_asiento : null,
            'aviso_apertura' => $sinAsientos || abs($dif) > 0.5 * max((float) $c->valor_fisico_ves, 1)];
    }

    public function ajusteVer(Request $r)
    {
        $this->soloAdmin(); $this->requiereCierre();
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $mes = preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', (string) $r->query('mes')) ? $r->query('mes') : substr($hoy, 0, 7);
        return response()->json($this->ajusteDatos(min($mes, substr($hoy, 0, 7))));
    }

    public function ajusteStore(Request $r)
    {
        $this->soloAdmin(); $this->requiereCierre();
        $v = $r->validate(['mes' => ['required', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/']]);
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $fin = min(date('Y-m-t', strtotime($v['mes'] . '-01')), $hoy);
        try { $id = (int) DB::scalar('SELECT fn_ajuste_cambiario(?::date, ?::bigint)', [$fin, auth()->id()]); }
        catch (QueryException $e) { return $this->error($this->sqlError($e)); }
        return response()->json(['ok' => true, 'numero' => (int) DB::scalar('SELECT numero_asiento FROM asientos WHERE id = ?', [$id]), 'ajuste' => $this->ajusteDatos($v['mes'])]);
    }

    /**
     * Filas del libro diario para el contador: una por línea de asiento con exactamente Fecha, Asiento, Código de Cuenta, Debe y Haber.
     * csv → separado por «;» y coma decimal, se abre directo en Excel en español. txt → tabulador, punto decimal y fecha AAAA-MM-DD, para importar a otros programas.
     */
    public function exportarFilas(string $desde, string $hasta): array
    {
        return DB::select('SELECT a.fecha, a.numero_asiento, c.codigo, d.debe, d.haber FROM asiento_detalle d JOIN asientos a ON a.id = d.asiento_id JOIN plan_cuentas c ON c.id = d.cuenta_id
                            WHERE a.fecha BETWEEN ?::date AND ?::date ORDER BY a.fecha, a.numero_asiento, d.haber > 0, d.id', [$desde, $hasta]);
    }

    public function exportar(Request $r)
    {
        $this->soloAdmin();
        $v = $r->validate(['desde' => 'required|date_format:Y-m-d', 'hasta' => 'required|date_format:Y-m-d|after_or_equal:desde', 'formato' => 'required|in:csv,txt']);
        $filas = $this->exportarFilas($v['desde'], $v['hasta']);
        $csv = $v['formato'] === 'csv';
        $sep = $csv ? ';' : "\t";
        $num = fn($x) => $csv ? number_format((float) $x, 2, ',', '') : number_format((float) $x, 2, '.', '');
        $fch = fn($f) => $csv ? date('d/m/Y', strtotime($f)) : $f;
        $cuerpo = ($csv ? "\xEF\xBB\xBF" : '') . implode($sep, ['Fecha', 'Asiento', 'Código de Cuenta', 'Debe', 'Haber']) . "\r\n";
        foreach ($filas as $f) $cuerpo .= implode($sep, [$fch($f->fecha), $f->numero_asiento, $f->codigo, $num($f->debe), $num($f->haber)]) . "\r\n";
        $nombre = "libro-diario_{$v['desde']}_{$v['hasta']}." . $v['formato'];
        return response($cuerpo, 200, ['Content-Type' => ($csv ? 'text/csv' : 'text/plain') . '; charset=UTF-8', 'Content-Disposition' => "attachment; filename=\"$nombre\"", 'Cache-Control' => 'no-store']);
    }

    private function error(string $m)
    {
        return response()->json(['message' => $m], 422);
    }

    private function mensaje(QueryException $e): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\n|$)/u', $e->getMessage(), $m) ? trim($m[1]) : 'No se pudo guardar. Inténtalo de nuevo.';
    }
}
