<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Cuentas por cobrar a clientes (database/sql/15_cuentas_por_cobrar.sql). Las ventas a crédito las crea fn_registrar_venta;
 * aquí solo se consulta y se cobra. El cobro (tasa del día, saldo, asiento contable, movimiento de caja) lo hace
 * fn_registrar_pago_cobrar con bloqueo de la cuenta; la anulación, fn_anular_pago_cobrar.
 */
class CuentasPorCobrarController extends Controller
{
    use ContextoPagina;

    /** Solo para lo que el cajero no debe hacer: anular un cobro. Ver las deudas y cobrarlas sí puede (Permisos::MODULOS «cxc»). */
    private function soloAdmin(): void
    {
        abort_if(strtoupper((string) (auth()->user()->rol ?? '')) !== 'ADMINISTRADOR', 403, 'Solo un administrador puede anular un cobro.');
    }

    public function index(Request $r)
    {
        $estado = in_array($r->query('estado'), ['PENDIENTE', 'PAGADA', 'ANULADA', 'TODAS'], true) ? $r->query('estado') : 'PENDIENTE';
        $cliente = (int) $r->query('cliente', 0);
        $vencidas = (bool) $r->query('vencidas', false);
        $q = trim((string) $r->query('q', ''));

        $where = ['1 = 1'];
        $par = [];
        if ($estado !== 'TODAS') { $where[] = 'estado = ?'; $par[] = $estado; }
        if ($cliente) { $where[] = 'cliente_id = ?'; $par[] = $cliente; }
        if ($vencidas) { $where[] = 'vencida'; }
        if ($q !== '') { $where[] = '(unaccent(cliente) ILIKE unaccent(?) OR documento ILIKE ? OR venta_numero::text = ?)'; $par[] = "%{$q}%"; $par[] = "%{$q}%"; $par[] = $q; }
        $cond = implode(' AND ', $where);

        $filas = DB::select("SELECT * FROM v_cuentas_por_cobrar WHERE {$cond} ORDER BY (estado = 'PENDIENTE') DESC, fecha_vencimiento, id LIMIT 300", $par);
        $tot = DB::selectOne("SELECT count(*) AS n, COALESCE(sum(saldo_usd), 0) AS saldo_usd, COALESCE(sum(saldo_ves), 0) AS saldo_ves,
                                     COALESCE(sum(saldo_usd) FILTER (WHERE vencida), 0) AS vencido_usd, count(*) FILTER (WHERE vencida) AS n_vencidas
                                FROM v_cuentas_por_cobrar WHERE {$cond}", $par);

        return Inertia::render('CuentasPorCobrar/Index', $this->contexto() + [
            'hoy' => (string) DB::scalar('SELECT fn_hoy()'),
            'filtros' => ['estado' => $estado, 'cliente' => $cliente ?: '', 'vencidas' => $vencidas, 'q' => $q],
            'totales' => ['n' => (int) $tot->n, 'saldo_usd' => (float) $tot->saldo_usd, 'saldo_ves' => (float) $tot->saldo_ves, 'vencido_usd' => (float) $tot->vencido_usd, 'n_vencidas' => (int) $tot->n_vencidas],
            'cuentas' => array_map(fn ($c) => $this->fila($c), $filas),
            'clientes' => DB::select("SELECT DISTINCT cl.id, cl.nombre FROM clientes cl JOIN cuentas_por_cobrar c ON c.cliente_id = cl.id ORDER BY cl.nombre"),
            'monedas' => array_map(fn ($m) => trim($m->codigo), DB::select("SELECT codigo FROM monedas WHERE activa ORDER BY array_position(ARRAY['USD','VES','EUR','COP'], trim(codigo)::text), codigo")),
            'caja_abierta' => (bool) DB::scalar('SELECT fn_apertura_activa(?)', [auth()->id()]),
            'metodos' => $this->metodos(),
        ]);
    }

    private function fila(object $c): array
    {
        return ['id' => (int) $c->id, 'cliente_id' => (int) $c->cliente_id, 'cliente' => $c->cliente, 'documento' => $c->documento, 'venta_id' => $c->venta_id ? (int) $c->venta_id : null,
            'venta' => $c->venta_numero ? (int) $c->venta_numero : null, 'factura' => $c->factura, 'fecha_venta' => $c->fecha_venta,
            'original_usd' => (float) $c->monto_original_usd, 'original_ves' => (float) $c->monto_original_ves, 'saldo_usd' => (float) $c->saldo_usd, 'saldo_ves' => (float) $c->saldo_ves,
            'vence' => $c->fecha_vencimiento, 'estado' => $c->estado, 'vencida' => (bool) $c->vencida, 'dias' => (int) $c->dias_para_vencer];
    }

    /** Detalle de una cuenta con sus cobros. */
    public function show($id)
    {
        $c = DB::selectOne('SELECT * FROM v_cuentas_por_cobrar WHERE id = ?', [(int) $id]);
        if (! $c) {
            return response()->json(['message' => 'Esa cuenta no existe.'], 404);
        }
        return response()->json(['cuenta' => $this->fila($c), 'pagos' => $this->pagos((int) $id)]);
    }

    private function pagos(int $cuentaId): array
    {
        return array_map(fn ($p) => ['id' => (int) $p->id, 'fecha' => $p->fecha, 'moneda' => trim($p->moneda), 'monto' => (float) $p->monto, 'monto_usd' => (float) $p->monto_usd, 'monto_ves' => (float) $p->monto_ves,
            'tasa_usd' => (float) $p->tasa_usd, 'referencia' => $p->referencia, 'efectivo' => (bool) $p->es_efectivo, 'igtf' => (float) ($p->igtf_monto ?? 0), 'estado' => $p->estado, 'motivo' => $p->motivo_anulacion, 'por' => $p->por],
            DB::select('SELECT p.*, u.nombre_completo AS por FROM pagos_cobrar p JOIN usuarios u ON u.id = p.usuario_id WHERE p.cuenta_por_cobrar_id = ? ORDER BY p.fecha DESC, p.id DESC', [$cuentaId]));
    }

    /** Registra un cobro. El monto no puede pasar del saldo (lo valida también la función, con el cobro ya convertido a USD). */
    public function pagar(Request $r)
    {
        $d = $r->validate([
            'cuenta_id' => 'required|integer', 'metodo_pago_id' => 'required|integer', 'monto' => 'required|numeric|gt:0|max:999999999999',
            'fecha' => 'required|date_format:Y-m-d|before_or_equal:today', 'referencia' => 'nullable|string|max:60',
        ], ['metodo_pago_id.required' => 'Elige cómo te pagó el cliente.', 'monto.required' => 'Escribe el monto cobrado.', 'monto.gt' => 'El monto debe ser mayor que cero.', 'fecha.before_or_equal' => 'La fecha del cobro no puede ser futura.']);
        try {
            $id = (int) DB::transaction(fn () => DB::scalar('SELECT fn_registrar_pago_cobrar(?::bigint, ?::date, NULL::char(3), ?::numeric, ?::text, ?::bigint, ?::bigint)',
                [$d['cuenta_id'], $d['fecha'], $d['monto'], $d['referencia'] ?? null, auth()->id(), $d['metodo_pago_id']]));   // la moneda sale del método de pago
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo registrar el cobro.')], 422);
        }
        return response()->json(['id' => $id, 'cuenta' => $this->fila(DB::selectOne('SELECT * FROM v_cuentas_por_cobrar WHERE id = ?', [$d['cuenta_id']])), 'pagos' => $this->pagos((int) $d['cuenta_id'])]);
    }

    public function anularPago(Request $r, $pagoId)
    {
        $this->soloAdmin();
        $v = $r->validate(['motivo' => 'required|string|min:3|max:300'], ['motivo.required' => 'Escribe el motivo de la anulación.', 'motivo.min' => 'Escribe el motivo de la anulación.']);
        $cuenta = (int) DB::scalar('SELECT cuenta_por_cobrar_id FROM pagos_cobrar WHERE id = ?', [(int) $pagoId]);
        if (! $cuenta) {
            return response()->json(['message' => 'Ese cobro no existe.'], 404);
        }
        try {
            DB::transaction(fn () => DB::statement('SELECT fn_anular_pago_cobrar(?::bigint, ?::text, ?::bigint)', [(int) $pagoId, $v['motivo'], auth()->id()]));
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo anular el cobro.')], 422);
        }
        return response()->json(['cuenta' => $this->fila(DB::selectOne('SELECT * FROM v_cuentas_por_cobrar WHERE id = ?', [$cuenta])), 'pagos' => $this->pagos($cuenta)]);
    }

    /** Recibo de cobro / comprobante de percepción de IGTF (datos; el PDF se arma en el navegador, lib/pdfComprobanteCobro.js). */
    public function comprobante($pagoId)
    {
        if (! DB::scalar('SELECT 1 FROM pagos_cobrar WHERE id = ?', [(int) $pagoId])) {
            return response()->json(['message' => 'Ese cobro no existe.'], 404);
        }
        $c = json_decode(DB::scalar('SELECT fn_comprobante_cobro(?)::text', [(int) $pagoId]), true);
        $n = DB::selectOne('SELECT razon_social, nombre_comercial, rif, direccion_fiscal FROM negocio WHERE id = fn_negocio_actual()');
        $c['emisor'] = ['razon_social' => $n->razon_social, 'comercial' => $n->nombre_comercial, 'rif' => $n->rif, 'direccion' => $n->direccion_fiscal];
        return response()->json($c);
    }

    /** Estado de cuenta de un cliente: todas sus cuentas, antigüedad de lo vencido y cobros. Lo usa la ficha del cliente. */
    public function estadoCuenta($clienteId)
    {
        $cl = DB::selectOne('SELECT id, tipo_documento, documento, nombre FROM clientes WHERE id = ?', [(int) $clienteId]);
        if (! $cl) {
            return response()->json(['message' => 'Ese cliente no existe.'], 404);
        }
        $cuentas = DB::select('SELECT * FROM v_cuentas_por_cobrar WHERE cliente_id = ? ORDER BY (estado = \'PENDIENTE\') DESC, fecha_vencimiento, id', [$cl->id]);
        $edad = ['al_dia' => 0.0, 'd1_30' => 0.0, 'd31_60' => 0.0, 'd61_mas' => 0.0];
        $saldo = $saldoVes = 0.0;
        foreach ($cuentas as $c) {
            if ($c->estado !== 'PENDIENTE') {
                continue;
            }
            $saldo += (float) $c->saldo_usd;
            $saldoVes += (float) $c->saldo_ves;
            $atraso = -(int) $c->dias_para_vencer;
            $k = $atraso <= 0 ? 'al_dia' : ($atraso <= 30 ? 'd1_30' : ($atraso <= 60 ? 'd31_60' : 'd61_mas'));
            $edad[$k] += (float) $c->saldo_usd;
        }
        $pagos = DB::select('SELECT p.id, p.fecha, p.moneda, p.monto, p.monto_usd, p.estado, p.referencia, c.venta_id FROM pagos_cobrar p JOIN cuentas_por_cobrar c ON c.id = p.cuenta_por_cobrar_id
                              WHERE c.cliente_id = ? ORDER BY p.fecha DESC, p.id DESC LIMIT 100', [$cl->id]);
        return response()->json([
            'cliente' => ['id' => (int) $cl->id, 'nombre' => $cl->nombre, 'documento' => trim($cl->tipo_documento) . '-' . $cl->documento],
            'hoy' => (string) DB::scalar('SELECT fn_hoy()'), 'caja_abierta' => (bool) DB::scalar('SELECT fn_apertura_activa(?)', [auth()->id()]), 'metodos' => $this->metodos(),
            'monedas' => array_map(fn ($m) => trim($m->codigo), DB::select("SELECT codigo FROM monedas WHERE activa ORDER BY array_position(ARRAY['USD','VES','EUR','COP'], trim(codigo)::text), codigo")),
            'saldo_usd' => round($saldo, 2), 'saldo_ves' => round($saldoVes, 2), 'antiguedad' => array_map(fn ($x) => round($x, 2), $edad),
            'cuentas' => array_map(fn ($c) => $this->fila($c), $cuentas),
            'pagos' => array_map(fn ($p) => ['id' => (int) $p->id, 'fecha' => $p->fecha, 'moneda' => trim($p->moneda), 'monto' => (float) $p->monto, 'monto_usd' => (float) $p->monto_usd, 'estado' => $p->estado, 'referencia' => $p->referencia], $pagos),
        ]);
    }

    /**
     * Métodos con los que se puede cobrar. El IGTF y el efectivo salen de la configuración del método (metodos_pago.aplica_igtf / es_efectivo),
     * no de lo que escriba el cajero. igtf_pct sirve solo para la vista previa: el valor real lo calcula fn_registrar_pago_cobrar.
     */
    private function metodos(): array
    {
        $cobra = (bool) DB::scalar('SELECT cobra_igtf FROM negocio WHERE id = fn_negocio_actual()');
        $pct = $cobra ? (float) DB::scalar('SELECT fn_igtf_pct(fn_hoy())') : 0.0;
        $f = DB::select("SELECT m.id, m.nombre, trim(m.moneda) AS moneda, m.requiere_referencia, m.es_efectivo, m.aplica_igtf
                           FROM metodos_pago m JOIN monedas mo ON mo.codigo = m.moneda
                          WHERE m.activo AND mo.activa
                          ORDER BY array_position(ARRAY['USD','VES','EUR','COP'], trim(m.moneda)::text), m.nombre");
        return array_map(fn ($m) => ['id' => (int) $m->id, 'nombre' => $m->nombre, 'moneda' => $m->moneda, 'referencia' => (bool) $m->requiere_referencia,
            'efectivo' => (bool) $m->es_efectivo, 'igtf_pct' => ($cobra && $m->aplica_igtf) ? $pct : 0.0], $f);
    }

    private function mensaje(QueryException $e, string $porDefecto): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }
}
