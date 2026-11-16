<?php

/*
 * FlujoVentaTest · el flujo completo de venta POR LA PILA LARAVEL (request →
 * middleware → controlador → funciones de la base → respuesta), con sus efectos
 * verificados en la base: apertura de caja, búsqueda, cotización, venta al
 * contado y anulación con retorno de stock.
 */

use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->actingAs(\App\Models\Usuario::find(adminId()));

    // Turno abierto para poder vender (si el clon ya lo trae, se usa ese).
    $activa = DB::selectOne('SELECT tienda.fn_apertura_activa(?) AS a', [adminId()])->a;
    if ($activa === null) {
        $this->post('/caja/apertura', ['fondo_inicial_usd' => 100, 'fondo_inicial_ves' => 3650])
            ->assertOk();
    }

    $this->producto = productoActivo();
    asegurarStock($this->producto);
    $this->metodoBs = (int) DB::table('metodos_pago')->where('nombre', 'Pago móvil')->value('id');
    $this->metodoUsd = (int) DB::table('metodos_pago')->where('es_divisa', true)->where('aplica_igtf', false)->value('id')
        ?? (int) DB::table('metodos_pago')->where('nombre', 'Zelle')->value('id');
});

it('la apertura de caja queda registrada con su fondo', function () {
    $apertura = DB::selectOne("SELECT * FROM tienda.aperturas_caja WHERE usuario_id = ? AND estado = 'ABIERTA'", [adminId()]);
    expect($apertura)->not->toBeNull()
        ->and((float) $apertura->fondo_inicial_usd)->toBeGreaterThanOrEqual(100.0);
});

it('cotiza la venta con la tasa del día antes de cobrar', function () {
    $items = itemsVenta($this->producto);

    $this->postJson('/caja/cotizar', ['items' => $items])
        ->assertOk()
        ->assertJsonPath('total_usd', fn ($v) => (float) $v > 0)
        ->assertJsonPath('iva_pct', fn ($v) => (float) $v === 16.0)
        ->assertJsonPath('tasa', fn ($v) => (float) $v > 0);
});

it('registra la venta completa con stock, kardex y pagos', function () {
    $items = itemsVenta($this->producto);
    $stockAntes = (float) DB::table('productos')->where('id', $this->producto->id)->value('stock_actual');

    $cot = $this->postJson('/caja/cotizar', ['items' => $items])->assertOk()->json();

    $resp = $this->postJson('/caja/venta', [
        'items' => $items,
        'pagos' => [['metodo_pago_id' => $this->metodoBs, 'monto' => $cot['total_ves'], 'referencia' => 'PEST-V1']],
        'cliente_id' => null,
        'es_credito' => false,
    ])->assertOk();

    $ventaId = $resp->json('id');
    expect($ventaId)->toBeGreaterThan(0);

    // La venta existe, COMPLETADA, con su número y su pago.
    $venta = DB::selectOne('SELECT estado, numero, total_usd, usuario_id FROM tienda.ventas WHERE id = ?', [$ventaId]);
    expect($venta->estado)->toBe('COMPLETADA')
        ->and($venta->numero)->toBeGreaterThan(0)
        ->and(abs((float) $venta->total_usd - (float) $cot['total_usd']))->toBeLessThan(0.01)
        ->and((int) $venta->usuario_id)->toBe(adminId());

    // El stock bajó y el kardex dejó su salida firmada.
    $stockDespues = (float) DB::table('productos')->where('id', $this->producto->id)->value('stock_actual');
    expect($stockDespues)->toBe($stockAntes - 1.0)
        ->and(DB::table('movimientos_inventario')
            ->where('producto_id', $this->producto->id)
            ->where('referencia_tipo', 'VENTA')
            ->where('referencia_id', $ventaId)->exists())->toBeTrue();

    // Y el documento consultable por id responde al punto de venta.
    $this->getJson("/caja/venta/{$ventaId}")->assertOk();
});

it('anula la venta por HTTP y devuelve la mercancía al stock', function () {
    $items = itemsVenta($this->producto);
    $stockAntes = (float) DB::table('productos')->where('id', $this->producto->id)->value('stock_actual');

    $cot = $this->postJson('/caja/cotizar', ['items' => $items])->json();
    $ventaId = $this->postJson('/caja/venta', [
        'items' => $items,
        'pagos' => [['metodo_pago_id' => $this->metodoBs, 'monto' => $cot['total_ves'], 'referencia' => 'PEST-V2']],
        'es_credito' => false,
    ])->json('id');

    $this->postJson("/ventas/{$ventaId}/anular", ['motivo' => 'Anulación de prueba Pest'])
        ->assertOk();

    expect(DB::selectOne('SELECT estado FROM tienda.ventas WHERE id = ?', [$ventaId])->estado)->toBe('ANULADA')
        ->and((float) DB::table('productos')->where('id', $this->producto->id)->value('stock_actual'))
        ->toBe($stockAntes);
});

it('rechaza una venta sin pagos que cubran el total (TV004 controlado)', function () {
    $items = itemsVenta($this->producto);

    $this->postJson('/caja/venta', [
        'items' => $items,
        'pagos' => [['metodo_pago_id' => $this->metodoBs, 'monto' => 0.01, 'referencia' => 'PEST-BAD']],
        'es_credito' => false,
    ])->assertStatus(422);

    // Y la venta rechazada NO quedó en la base.
    expect(DB::table('ventas')->where('observaciones', 'like', '%PEST-BAD%')->exists())->toBeFalse();
});

