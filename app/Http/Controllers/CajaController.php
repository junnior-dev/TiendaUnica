<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Punto de venta (/caja). No calcula nada fiscal por su cuenta: usa tus funciones de la base de datos.
 *   fn_cotizar_venta + fn_calcular_linea_venta → totales mientras se arma la venta
 *   fn_registrar_venta                         → guarda líneas, pagos mixtos, IGTF y descuenta stock en una transacción
 *   sp_asignar_factura_fiscal                  → fija el número de factura y de control emitidos por el medio de facturación
 * El precio, el costo, la tasa y las alícuotas los fija la base de datos; la pantalla solo envía producto, cantidad y descuento.
 * Los métodos de datos son públicos para poder probarlos sin HTTP.
 */
class CajaController extends Controller
{
    use ContextoPagina;

    public function index()
    {
        return Inertia::render('Caja/Index', [...$this->contexto(), ...$this->datosPagina()]);
    }

    /** Configuración que necesita la pantalla: régimen, tasas del día, métodos de pago y últimas ventas. */
    public function datosPagina(): array
    {
        $neg = DB::selectOne('SELECT * FROM negocio WHERE id = fn_negocio_actual()');
        $tasas = DB::select("SELECT moneda_origen AS moneda, tasa, fecha_valor::text AS fecha, vigente, fuente FROM v_tasas_actuales WHERE moneda_destino = 'VES' AND moneda_origen IN ('USD','EUR','COP')");
        $porMoneda = [];
        foreach ($tasas as $t) {
            $porMoneda[$t->moneda] = ['tasa' => (float) $t->tasa, 'fecha' => $t->fecha, 'vigente' => (bool) $t->vigente, 'fuente' => $t->fuente];
        }
        $metodos = DB::select("SELECT m.id, m.nombre, m.moneda, m.es_divisa, m.aplica_igtf, m.requiere_referencia FROM metodos_pago m JOIN monedas mo ON mo.codigo = m.moneda
                                WHERE m.activo AND mo.activa ORDER BY m.es_divisa, m.id");
        $estado = ! $neg || ! $neg->configurado_en ? 'sin_configurar' : (! isset($porMoneda['USD']) || ! $porMoneda['USD']['vigente'] ? 'sin_tasa' : 'ok');

        return [
            'estado' => $estado,
            'apertura' => app(AperturaCajaController::class)->activa(),
            'emisor' => ['razon_social' => $neg->razon_social ?? '', 'nombre_comercial' => $neg->nombre_comercial ?? null, 'rif' => $neg->rif ?? '', 'direccion' => $neg->direccion_fiscal ?? '', 'telefono' => $neg->telefono ?? ''],
            'regimen' => [
                'especial' => (bool) ($neg->es_contribuyente_especial ?? false), 'cobra_igtf' => (bool) ($neg->cobra_igtf ?? false), 'igtf_base' => $neg->igtf_base ?? 'CON_IVA',
                'precios_incluyen_iva' => (bool) ($neg->precios_incluyen_iva ?? false), 'stock_negativo' => (bool) ($neg->permitir_stock_negativo ?? false),
                'tolerancia' => (float) ($neg->tolerancia_pago_usd ?? 0.01),
                'iva_pct' => (float) DB::scalar('SELECT fn_iva_pct()'),
                'igtf_pct' => ($neg->cobra_igtf ?? false) ? (float) DB::scalar('SELECT fn_igtf_pct()') : 0.0,
            ],
            'tasas' => $porMoneda,
            'factura_automatica' => $this->facturaAutomatica(),
            'metodos' => array_map(fn ($m) => ['id' => (int) $m->id, 'nombre' => $m->nombre, 'moneda' => trim($m->moneda), 'divisa' => (bool) $m->es_divisa, 'igtf' => (bool) $m->aplica_igtf, 'referencia' => (bool) $m->requiere_referencia], $metodos),
            'recientes' => $this->recientes(),
        ];
    }

    public function recientes(): array
    {
        $admin = (auth()->user()->rol ?? '') === 'ADMINISTRADOR';
        $filas = DB::select("SELECT v.id, v.numero, to_char(v.fecha_hora AT TIME ZONE 'America/Caracas', 'HH24:MI') AS hora, COALESCE(c.nombre, 'Consumidor final') AS cliente, v.total_usd, v.total_cobrar_ves,
                                    v.estado, v.numero_factura_fiscal AS factura
                               FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id
                              WHERE v.fecha_valor = fn_hoy() " . ($admin ? '' : 'AND v.usuario_id = ?') . ' ORDER BY v.id DESC LIMIT 8', $admin ? [] : [auth()->id()]);
        return array_map(fn ($v) => ['id' => (int) $v->id, 'numero' => (int) $v->numero, 'hora' => $v->hora, 'cliente' => $v->cliente, 'total_usd' => (float) $v->total_usd,
            'total_ves' => (float) $v->total_cobrar_ves, 'estado' => $v->estado, 'factura' => $v->factura], $filas);
    }

    /* ───────────── Búsqueda de productos (texto, SKU, código de barras, moto compatible) ───────────── */

    public function buscar(Request $r)
    {
        return response()->json($this->buscarDatos((string) $r->query('q', ''), $r->boolean('exacto')));
    }

    public function buscarDatos(string $q, bool $soloExacto = false): array
    {
        $q = trim($q);
        if ($q === '') {
            return [];
        }
        $cols = 'v.id, v.sku, v.codigo_barras, v.nombre, v.marca, v.categoria, v.ubicacion_almacen, v.unidad, v.stock_actual, v.exento_iva, v.exonerado_iva, v.precio_venta_usd, v.precio_final_usd, v.precio_final_ves';
        if ($soloExacto) {
            $filas = DB::select("SELECT {$cols}, TRUE AS exacto FROM v_productos_precios v WHERE v.activo AND (v.codigo_barras = ? OR upper(v.sku) = upper(?)
                    OR EXISTS (SELECT 1 FROM producto_presentaciones pp WHERE pp.producto_id = v.id AND pp.activa AND pp.codigo_barras = ?)) LIMIT 2", [$q, $q, $q]);
        } else {
            $where = ['v.activo']; $b = [];
            foreach (preg_split('/\s+/', $q, -1, PREG_SPLIT_NO_EMPTY) as $w) {
                $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $w) . '%';
                $where[] = "(unaccent(v.nombre) ILIKE unaccent(?) OR v.sku ILIKE ? OR v.codigo_barras ILIKE ? OR v.referencia_fabricante ILIKE ? OR unaccent(COALESCE(v.marca, '')) ILIKE unaccent(?)
                             OR unaccent(COALESCE(v.categoria, '')) ILIKE unaccent(?)
                             OR EXISTS (SELECT 1 FROM v_compatibilidad vc WHERE vc.producto_id = v.id AND unaccent(vc.marca || ' ' || vc.modelo) ILIKE unaccent(?)))";
                array_push($b, $like, $like, $like, $like, $like, $like, $like);
            }
            $filas = DB::select("SELECT {$cols}, (v.codigo_barras = ? OR upper(v.sku) = upper(?)) AS exacto FROM v_productos_precios v WHERE " . implode(' AND ', $where)
                . ' ORDER BY exacto DESC, (v.stock_actual > 0) DESC, v.nombre LIMIT 12', [$q, $q, ...$b]);  // los dos primeros son los del campo «exacto»
        }
        $pres = $this->presentacionesDe(array_map(fn ($p) => (int) $p->id, $filas));
        return array_map(fn ($p) => [
            'presentaciones' => $pres[(int) $p->id] ?? [],
            'id' => (int) $p->id, 'sku' => $p->sku, 'barras' => $p->codigo_barras, 'nombre' => $p->nombre, 'marca' => $p->marca, 'categoria' => $p->categoria, 'ubicacion' => $p->ubicacion_almacen,
            'unidad' => trim($p->unidad), 'stock' => (float) $p->stock_actual, 'exento' => (bool) ($p->exento_iva || $p->exonerado_iva), 'precio_usd' => (float) $p->precio_venta_usd,
            'final_usd' => (float) $p->precio_final_usd, 'final_ves' => (float) $p->precio_final_ves, 'exacto' => (bool) $p->exacto,
        ], $filas);
    }

    /* ───────────── Clientes ───────────── */

    public function clientes(Request $r)
    {
        return response()->json($this->clientesDatos((string) $r->query('q', '')));
    }

    public function clientesDatos(string $q): array
    {
        $q = trim($q);
        if (mb_strlen($q) < 2) {
            return [];
        }
        $solo = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $q));
        $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $q) . '%';
        $filas = DB::select("SELECT id, tipo_documento, documento, nombre, telefono, direccion FROM clientes
                              WHERE activo AND (unaccent(nombre) ILIKE unaccent(?) OR (? <> '' AND (tipo_documento || documento) ILIKE ?) OR (? <> '' AND documento ILIKE ?))
                              ORDER BY nombre LIMIT 8", [$like, $solo, "%{$solo}%", $solo, "%{$solo}%"]);
        return array_map(fn ($c) => ['id' => (int) $c->id, 'tipo' => trim($c->tipo_documento), 'documento' => $c->documento, 'nombre' => $c->nombre, 'telefono' => $c->telefono, 'direccion' => $c->direccion], $filas);
    }

    public function clienteStore(Request $r)
    {
        $d = $r->validate([
            'tipo' => 'required|in:V,E,J,G,P,C', 'documento' => 'required|string|max:20', 'nombre' => 'required|string|min:2|max:200',
            'telefono' => 'nullable|string|max:40', 'direccion' => 'nullable|string|max:300',
        ], ['nombre.required' => 'Escribe el nombre o la razón social.', 'documento.required' => 'Escribe la cédula o el RIF.']);
        $doc = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $d['documento']));
        $tipo = $d['tipo'];
        if (in_array($tipo, ['V', 'E'], true) && ! preg_match('/^\d{5,9}$/', $doc)) {
            return response()->json(['message' => 'La cédula tiene entre 5 y 9 números.', 'errors' => ['documento' => ['La cédula tiene entre 5 y 9 números.']]], 422);
        }
        if (in_array($tipo, ['J', 'G', 'C'], true)) {
            if (! preg_match('/^\d{9}$/', $doc) || ! DB::scalar('SELECT fn_validar_rif(?)', [$tipo . $doc])) {
                return response()->json(['message' => 'El RIF no es válido. Ejemplo: J-12345678-4.', 'errors' => ['documento' => ['El RIF no es válido (revisa el dígito final). Ejemplo: J-12345678-4.']]], 422);
            }
        }
        if ($tipo === 'P' && ! preg_match('/^[A-Z0-9]{5,20}$/', $doc)) {
            return response()->json(['message' => 'El pasaporte tiene entre 5 y 20 letras o números.', 'errors' => ['documento' => ['El pasaporte tiene entre 5 y 20 letras o números.']]], 422);
        }
        $ya = DB::selectOne('SELECT id, tipo_documento, documento, nombre, telefono, direccion FROM clientes WHERE tipo_documento = ? AND documento = ?', [$tipo, $doc]);
        if ($ya) {
            return response()->json(['cliente' => ['id' => (int) $ya->id, 'tipo' => trim($ya->tipo_documento), 'documento' => $ya->documento, 'nombre' => $ya->nombre, 'telefono' => $ya->telefono, 'direccion' => $ya->direccion], 'existente' => true]);
        }
        $c = DB::selectOne('INSERT INTO clientes (tipo_documento, documento, nombre, telefono, direccion) VALUES (?, ?, ?, ?, ?) RETURNING id', [$tipo, $doc, trim($d['nombre']), $d['telefono'] ?? null, $d['direccion'] ?? null]);
        return response()->json(['cliente' => ['id' => (int) $c->id, 'tipo' => $tipo, 'documento' => $doc, 'nombre' => trim($d['nombre']), 'telefono' => $d['telefono'] ?? null, 'direccion' => $d['direccion'] ?? null], 'existente' => false]);
    }

    /* ───────────── Totales mientras se arma la venta ───────────── */

    public function cotizar(Request $r)
    {
        try {
            return response()->json($this->cotizarDatos($this->items($r->input('items', []))));
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo calcular la venta.')], 422);
        }
    }

    /**
     * Presentaciones activas de varios productos, con el precio final de UNA presentación (IVA y Bs incluidos, igual que la línea de venta).
     * Devuelve [producto_id => [{id, codigo, nombre, factor, barras, final_usd, final_ves}]].
     */
    private function presentacionesDe(array $ids): array
    {
        if (! $ids) {
            return [];
        }
        $in = implode(',', array_fill(0, count($ids), '?'));
        $filas = DB::select("SELECT pp.id, pp.producto_id, pp.codigo, pp.nombre, pp.factor, pp.codigo_barras, l.total_usd, l.total_ves
                               FROM producto_presentaciones pp JOIN productos p ON p.id = pp.producto_id CROSS JOIN negocio n
                               CROSS JOIN LATERAL fn_calcular_linea_venta(1, COALESCE(pp.precio_usd, ROUND(p.precio_venta_usd * pp.factor, 4)), 0, p.exento_iva OR p.exonerado_iva, fn_iva_pct(), n.precios_incluyen_iva, (fn_tasa_aplicable()).tasa) l
                              WHERE pp.activa AND pp.producto_id IN ({$in}) ORDER BY pp.factor, pp.id", $ids);
        $out = [];
        foreach ($filas as $f) {
            $out[(int) $f->producto_id][] = ['id' => (int) $f->id, 'codigo' => $f->codigo, 'nombre' => $f->nombre, 'factor' => (float) $f->factor,
                'barras' => $f->codigo_barras, 'final_usd' => (float) $f->total_usd, 'final_ves' => (float) $f->total_ves];
        }
        return $out;
    }

    public function cotizarDatos(array $items): array
    {
        if (! $items) {
            return ['vacio' => true];
        }
        $json = json_encode($items);
        $t = DB::selectOne('SELECT * FROM fn_cotizar_venta(?::jsonb)', [$json]);
        $lineas = DB::select('SELECT e.ord, x.producto_id, l.base_usd, l.iva_usd, l.total_usd, l.base_ves, l.iva_ves, l.total_ves
                                FROM jsonb_array_elements(?::jsonb) WITH ORDINALITY AS e(j, ord) CROSS JOIN LATERAL jsonb_to_record(e.j) AS x(producto_id bigint, cantidad numeric, descuento_pct numeric, presentacion_id bigint)
                                JOIN productos p ON p.id = x.producto_id CROSS JOIN negocio n
                                LEFT JOIN producto_presentaciones pp ON pp.id = x.presentacion_id AND pp.producto_id = x.producto_id
                                CROSS JOIN LATERAL fn_calcular_linea_venta(x.cantidad, COALESCE(pp.precio_usd, ROUND(p.precio_venta_usd * pp.factor, 4), p.precio_venta_usd), COALESCE(x.descuento_pct, 0), p.exento_iva OR p.exonerado_iva, fn_iva_pct(), n.precios_incluyen_iva, (fn_tasa_aplicable()).tasa) l
                               ORDER BY e.ord', [$json]);
        $f = fn ($v) => (float) $v;
        return [
            'tasa' => $f($t->tasa_cambio), 'tasa_fecha' => $t->tasa_fecha_valor, 'iva_pct' => $f($t->iva_pct),
            'base_usd' => $f($t->base_usd), 'exento_usd' => $f($t->exento_usd), 'iva_usd' => $f($t->iva_usd), 'total_usd' => $f($t->total_usd),
            'base_ves' => $f($t->base_ves), 'exento_ves' => $f($t->exento_ves), 'iva_ves' => $f($t->iva_ves), 'total_ves' => $f($t->total_ves),
            'lineas' => array_map(fn ($l) => ['producto_id' => (int) $l->producto_id, 'clave' => (int) $l->ord - 1, 'total_usd' => $f($l->total_usd), 'total_ves' => $f($l->total_ves)], $lineas),
        ];
    }

    /* ───────────── Registrar la venta ───────────── */

    public function registrar(Request $r)
    {
        $r->validate(['pagos' => 'nullable|array', 'items' => 'required|array|min:1', 'es_credito' => 'nullable|boolean', 'dias_credito' => 'nullable|integer|between:0,365', 'cliente_id' => 'nullable|integer',
            'tipo_emision' => 'nullable|in:PRESENCIAL,DIGITAL,MAQUINA_FISCAL', 'observaciones' => 'nullable|string|max:300'],
            ['items.required' => 'Agrega al menos un producto.']);
        try {
            return response()->json($this->registrarDatos($r->input('items'), (array) $r->input('pagos', []), $r->input('cliente_id'), $r->input('observaciones'),
                $r->input('tipo_emision', 'PRESENCIAL'), (bool) $r->input('es_credito', false), (int) $r->input('dias_credito', 30)));
        } catch (VentaInvalida $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo registrar la venta.')], 422);
        }
    }

    /** ¿Este cliente ya debe algo? La caja lo avisa al elegirlo (no bloquea la venta). */
    public function creditoVerificar(Request $r)
    {
        $id = (int) $r->query('cliente_id', 0);
        $f = DB::selectOne("SELECT count(*) AS n, COALESCE(sum(saldo_usd), 0) AS saldo, count(*) FILTER (WHERE fecha_vencimiento < fn_hoy()) AS vencidas
                              FROM cuentas_por_cobrar WHERE cliente_id = ? AND estado = 'PENDIENTE'", [$id]);
        return response()->json(['tiene_deuda' => (int) $f->n > 0, 'cuentas' => (int) $f->n, 'saldo_usd' => round((float) $f->saldo, 2), 'vencidas' => (int) $f->vencidas]);
    }

    public function registrarDatos(array $items, array $pagos, $clienteId, ?string $obs, string $tipoEmision = 'PRESENCIAL', bool $esCredito = false, int $diasCredito = 30): array
    {
        // Sin turno abierto no se vende: el efectivo de la venta tiene que caer en un cierre de caja.
        if (! DB::scalar('SELECT fn_apertura_activa(?)', [auth()->id()])) {
            throw new VentaInvalida('Debe abrir la caja para poder vender.');
        }
        $its = $this->items($items);
        $pgs = [];
        foreach ($pagos as $p) {
            $monto = round((float) ($p['monto'] ?? 0), 2);
            if ($monto <= 0 || empty($p['metodo_pago_id'])) {
                continue;
            }
            $pgs[] = array_filter([
                'metodo_pago_id' => (int) $p['metodo_pago_id'], 'monto' => $monto, 'referencia' => isset($p['referencia']) ? trim((string) $p['referencia']) : null,
                'monto_entregado' => isset($p['monto_entregado']) ? round((float) $p['monto_entregado'], 2) : null, 'vuelto_monto' => isset($p['vuelto_monto']) ? round((float) $p['vuelto_monto'], 2) : null,
                'vuelto_moneda' => $p['vuelto_moneda'] ?? null,
            ], fn ($v) => $v !== null && $v !== '');
        }
        $this->validarAntes($its, $pgs, $esCredito, $clienteId ? (int) $clienteId : null);
        $id = (int) DB::scalar('SELECT fn_registrar_venta(?::bigint, ?::jsonb, ?::jsonb, ?::bigint, ?::text, ?::text, ?::boolean, ?::integer)', [auth()->id(), json_encode($its), json_encode($pgs), $clienteId ?: null, $obs ?: null, $tipoEmision, $esCredito ? 'true' : 'false', max(0, min(365, $diasCredito))]);
        $aviso = null;
        if ($this->facturaAutomatica()) {
            $aviso = $this->emitirAutomatica($id); // la venta ya quedó registrada; si la factura falla, se puede emitir después sin perder nada
        }
        $doc = $this->documentoDatos($id);
        $doc['aviso_emision'] = $aviso;
        return $doc;
    }

    /**
     * Revisa stock, referencias y cuadre de pagos ANTES de llamar a fn_registrar_venta. La secuencia del número de venta no se devuelve
     * cuando una transacción falla (ver v_ventas_huecos): validar aquí evita dejar huecos en la numeración por errores que se pueden prever.
     * Los errores imprevistos (dos cajas vendiendo el último repuesto a la vez) los sigue frenando la base de datos.
     */
    private function validarAntes(array $items, array $pagos, bool $esCredito = false, ?int $clienteId = null): void
    {
        if (! $items) {
            throw new VentaInvalida('Agrega al menos un producto.');
        }
        if ($esCredito) {
            if (! $clienteId) {
                throw new VentaInvalida('Una venta a crédito necesita un cliente: elige uno (no vale «Consumidor final»).');
            }
            if (! DB::selectOne('SELECT 1 FROM clientes WHERE id = ? AND activo', [$clienteId])) {
                throw new VentaInvalida('El cliente elegido no existe o está inactivo.');
            }
        } elseif (! $pagos) {
            throw new VentaInvalida('Indica al menos un pago.');
        }
        $neg = DB::selectOne('SELECT permitir_stock_negativo, tolerancia_pago_usd, configurado_en FROM negocio WHERE id = fn_negocio_actual()');
        if (! $neg->configurado_en) {
            throw new VentaInvalida('El negocio aún no está configurado: termina el asistente de primer inicio.');
        }
        if (! $neg->permitir_stock_negativo) {
            $pedido = [];
            foreach ($items as $i) {
                $pedido[$i['producto_id']] = ($pedido[$i['producto_id']] ?? 0) + $i['cantidad'];
            }
            foreach ($pedido as $pid => $cant) {
                $p = DB::selectOne('SELECT nombre, sku, stock_actual, activo FROM productos WHERE id = ?', [$pid]);
                if (! $p || ! $p->activo) {
                    throw new VentaInvalida('Uno de los productos ya no está disponible. Quítalo de la venta.');
                }
                if ((float) $p->stock_actual < $cant) {
                    throw new VentaInvalida(sprintf('No hay suficiente "%s" (%s): quedan %s y pides %s.', $p->nombre, $p->sku, rtrim(rtrim(number_format((float) $p->stock_actual, 3, ',', '.'), '0'), ','), rtrim(rtrim(number_format($cant, 3, ',', '.'), '0'), ',')));
                }
            }
        }
        $cot = $this->cotizarDatos($items);
        $tasa = $cot['tasa'];
        $pagadoUsd = 0.0;
        foreach ($pagos as $p) {
            $m = DB::selectOne('SELECT nombre, moneda, requiere_referencia, activo FROM metodos_pago WHERE id = ?', [$p['metodo_pago_id']]);
            if (! $m || ! $m->activo) {
                throw new VentaInvalida('Uno de los métodos de pago ya no está activo.');
            }
            if ($m->requiere_referencia && trim((string) ($p['referencia'] ?? '')) === '') {
                throw new VentaInvalida("«{$m->nombre}» necesita el número de referencia.");
            }
            $mon = trim($m->moneda);
            if ($mon === 'USD') {
                $pagadoUsd += $p['monto'];
            } elseif ($mon === 'VES') {
                $pagadoUsd += round($p['monto'] / $tasa, 2);
            } else {
                $directa = (float) DB::scalar("SELECT (fn_tasa_aplicable(NULL, ?, 'VES')).tasa", [$mon]);
                $pagadoUsd += round(round($p['monto'] * $directa, 2) / $tasa, 2);
            }
        }
        // A crédito solo se exige que no se pague de más; al contado, que los pagos cuadren con el total.
        if ($esCredito && $pagadoUsd - $cot['total_usd'] > (float) $neg->tolerancia_pago_usd + 1e-9) {
            throw new VentaInvalida(sprintf('El abono supera el total en USD %s.', number_format($pagadoUsd - $cot['total_usd'], 2, ',', '.')));
        }
        if (! $esCredito && abs($pagadoUsd - $cot['total_usd']) > (float) $neg->tolerancia_pago_usd + 1e-9) {
            $dif = $cot['total_usd'] - $pagadoUsd;
            throw new VentaInvalida(sprintf($dif > 0 ? 'Faltan USD %s para completar el pago.' : 'Los pagos superan el total en USD %s.', number_format(abs($dif), 2, ',', '.')));
        }
    }

    /** Asigna el número de factura fiscal (y de control) emitido por el medio de facturación. Una sola vez por venta. */
    public function factura(Request $r, int $id)
    {
        $d = $r->validate(['factura' => 'required|string|max:40', 'control' => 'nullable|string|max:40'], ['factura.required' => 'Escribe el número de la factura.']);
        try {
            DB::statement('CALL sp_asignar_factura_fiscal(?, ?, ?)', [$id, $d['factura'], $d['control'] ?? null]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'Ese número de factura ya está en uso.'), 'errors' => ['factura' => [$this->mensaje($e, 'Ese número de factura ya está en uso.')]]], 422);
        }
        return response()->json($this->documentoDatos($id));
    }

    /* ───────── Factura automática (09_numeracion_fiscal.sql) ───────── */

    /** True si existe el contador de numeración y está en modo automático. Si no ejecutaste el 09, el POS pide el número a mano. */
    public function facturaAutomatica(): bool
    {
        if (! DB::scalar("SELECT to_regclass('numeracion_fiscal') IS NOT NULL")) {
            return false;
        }
        return (bool) DB::scalar('SELECT automatica FROM numeracion_fiscal WHERE id = fn_negocio_actual()');
    }

    /** Emite la factura de una venta ya registrada. Devuelve null si salió bien o un mensaje si no se pudo. */
    private function emitirAutomatica(int $id): ?string
    {
        try {
            DB::selectOne('SELECT * FROM fn_emitir_factura_fiscal(?)', [$id]);
            return null;
        } catch (QueryException $e) {
            return $this->mensaje($e, 'La venta se registró, pero no se pudo emitir la factura. Inténtalo de nuevo.');
        }
    }

    public function emitir(int $id)
    {
        abort_if(! $this->facturaAutomatica(), 422, 'La emisión automática está desactivada.');
        $aviso = $this->emitirAutomatica($id);
        if ($aviso) {
            return response()->json(['message' => $aviso], 422);
        }
        return response()->json($this->documentoDatos($id));
    }

    public function documento(int $id)
    {
        $d = $this->documentoDatos($id);
        abort_if(! $d, 404);
        return response()->json($d);
    }

    /** Todo lo necesario para imprimir la factura, la nota de venta o el ticket. */
    public function documentoDatos(int $id): ?array
    {
        $v = DB::selectOne("SELECT v.*, to_char(v.fecha_hora AT TIME ZONE 'America/Caracas', 'DD/MM/YYYY') AS f_txt, to_char(v.fecha_hora AT TIME ZONE 'America/Caracas', 'HH24:MI') AS h_txt,
                                   c.tipo_documento AS c_tipo, c.documento AS c_doc, c.nombre AS c_nombre, c.telefono AS c_tel, c.direccion AS c_dir, u.nombre_completo AS cajero
                              FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id LEFT JOIN usuarios u ON u.id = v.usuario_id WHERE v.id = ?", [$id]);
        if (! $v) {
            return null;
        }
        $neg = DB::selectOne('SELECT * FROM negocio WHERE id = fn_negocio_actual()');
        $f = fn ($x) => $x === null ? null : (float) $x;
        $lineas = DB::select("SELECT p.sku, COALESCE(d.descripcion, p.nombre) AS descripcion, CASE WHEN d.presentacion_id IS NULL THEN trim(p.unidad) ELSE d.presentacion_codigo END AS unidad, COALESCE(d.cantidad_presentacion, d.cantidad) AS cantidad, COALESCE(d.precio_presentacion_usd, d.precio_unitario_usd) AS precio_unitario_usd, d.descuento_pct, d.alicuota_codigo, d.base_usd, d.iva_usd, d.total_usd, d.base_ves, d.iva_ves, d.total_ves
                                FROM detalle_venta d JOIN productos p ON p.id = d.producto_id WHERE d.venta_id = ? ORDER BY d.id", [$id]);
        $pagos = DB::select('SELECT m.nombre, p.moneda, p.monto, p.referencia, p.igtf_monto, p.monto_cobrado, p.monto_usd, p.monto_ves, p.monto_entregado, p.vuelto_monto, p.vuelto_moneda
                               FROM pagos_venta p JOIN metodos_pago m ON m.id = p.metodo_pago_id WHERE p.venta_id = ? ORDER BY p.id', [$id]);
        $otras = DB::select('SELECT moneda, tasa FROM ventas_tasas WHERE venta_id = ?', [$id]);
        $tasas = ['USD' => $f($v->tasa_cambio)];
        foreach ($otras as $o) {
            $tasas[trim($o->moneda)] = $f($o->tasa);
        }
        return [
            'id' => (int) $v->id, 'numero' => (int) $v->numero, 'fecha' => $v->f_txt, 'hora' => $v->h_txt, 'estado' => $v->estado, 'tipo_emision' => $v->tipo_emision, 'cajero' => $v->cajero,
            'factura' => $v->numero_factura_fiscal, 'control' => $v->numero_control, 'observaciones' => $v->observaciones,
            'credito' => ['es' => (bool) $v->es_credito, 'saldo_usd' => $f($v->saldo_pendiente_usd),
                'vence' => $v->es_credito ? DB::scalar('SELECT to_char(min(fecha_vencimiento), \'DD/MM/YYYY\') FROM cuentas_por_cobrar WHERE venta_id = ?', [$id]) : null],
            'cliente' => $v->c_nombre ? ['tipo' => trim($v->c_tipo), 'documento' => $v->c_doc, 'nombre' => $v->c_nombre, 'telefono' => $v->c_tel, 'direccion' => $v->c_dir] : null,
            'emisor' => ['razon_social' => $neg->razon_social, 'nombre_comercial' => $neg->nombre_comercial, 'rif' => $neg->rif, 'direccion' => $neg->direccion_fiscal, 'telefono' => $neg->telefono],
            'regimen' => ['especial' => (bool) $neg->es_contribuyente_especial, 'cobra_igtf' => (bool) $v->cobra_igtf, 'igtf_pct' => $f($v->igtf_pct), 'iva_pct' => $f($v->iva_pct), 'precios_incluyen_iva' => (bool) $v->precios_incluyen_iva],
            'tasas' => $tasas, 'tasa_fecha' => $v->tasa_fecha_valor,
            'totales' => array_map($f, ['base_usd' => $v->base_usd, 'exento_usd' => $v->exento_usd, 'iva_usd' => $v->iva_usd, 'total_usd' => $v->total_usd, 'igtf_usd' => $v->igtf_usd, 'total_cobrar_usd' => $v->total_cobrar_usd,
                'base_ves' => $v->base_ves, 'exento_ves' => $v->exento_ves, 'iva_ves' => $v->iva_ves, 'total_ves' => $v->total_ves, 'igtf_ves' => $v->igtf_ves, 'total_cobrar_ves' => $v->total_cobrar_ves]),
            'lineas' => array_map(fn ($l) => ['sku' => $l->sku, 'descripcion' => $l->descripcion, 'unidad' => $l->unidad, 'cantidad' => $f($l->cantidad), 'precio_usd' => $f($l->precio_unitario_usd), 'descuento_pct' => $f($l->descuento_pct),
                'alicuota' => $l->alicuota_codigo === 'IVA_GENERAL' ? 'G' : ($l->alicuota_codigo === 'EXONERADO' ? 'X' : 'E'),
                'base_usd' => $f($l->base_usd), 'iva_usd' => $f($l->iva_usd), 'total_usd' => $f($l->total_usd), 'base_ves' => $f($l->base_ves), 'iva_ves' => $f($l->iva_ves), 'total_ves' => $f($l->total_ves)], $lineas),
            'pagos' => array_map(fn ($p) => ['metodo' => $p->nombre, 'moneda' => trim($p->moneda), 'monto' => $f($p->monto), 'referencia' => $p->referencia, 'igtf' => $f($p->igtf_monto), 'cobrado' => $f($p->monto_cobrado),
                'usd' => $f($p->monto_usd), 'ves' => $f($p->monto_ves), 'entregado' => $f($p->monto_entregado), 'vuelto' => $f($p->vuelto_monto), 'vuelto_moneda' => $p->vuelto_moneda ? trim($p->vuelto_moneda) : null], $pagos),
        ];
    }

    /** Solo producto, cantidad y descuento: lo demás lo decide la base de datos. Une líneas repetidas del mismo producto y descuento. */
    private function items(array $items): array
    {
        $out = [];
        foreach ($items as $i) {
            $pid = (int) ($i['producto_id'] ?? 0);
            $cant = round((float) ($i['cantidad'] ?? 0), 3);
            $desc = max(0, min(100, round((float) ($i['descuento_pct'] ?? 0), 2)));
            $pres = (int) ($i['presentacion_id'] ?? 0);
            if ($pid > 0 && $cant > 0) {
                $out[] = ['producto_id' => $pid, 'cantidad' => $cant, 'descuento_pct' => $desc] + ($pres > 0 ? ['presentacion_id' => $pres] : []);
            }
        }
        return $out;
    }

    private function mensaje(QueryException $e, string $porDefecto): string
    {
        if ($e->getCode() === '23505') {
            return $porDefecto;
        }
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }
}

/** Venta rechazada antes de tocar la base de datos (no consume número de venta). */
class VentaInvalida extends \RuntimeException
{
}
