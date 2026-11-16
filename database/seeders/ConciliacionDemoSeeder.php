<?php

namespace Database\Seeders;

use App\Http\Controllers\ConciliacionController;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * DATOS DE PRUEBA para ver la conciliación y sus PDF sin registrar ventas reales.
 *     php artisan db:seed --class=ConciliacionDemoSeeder
 *
 * ⚠ Solo para bases de prueba. Los asientos son INMUTABLES por diseño: lo que este seeder registre no se puede borrar después
 *   (por eso todo lleva «[DEMO]» en el concepto y se niega a correr en producción o dos veces). Úsalo en una copia de la base.
 *
 * Crea, para el mes pasado: asientos en Bancos (lotes del punto de venta, depósitos, pagos a proveedores, uno en tránsito y un cheque
 * en circulación), un estado de cuenta del banco con sus desfases de fechas, una comisión y una nota de crédito del banco, la
 * conciliación ya cruzada (queda en borrador y CUADRA: ciérrala desde la pantalla), y declaraciones del SENIAT con diferencias
 * a propósito (redondeo, no cuadra, sin declarar) para ver el semáforo.
 */
class ConciliacionDemoSeeder extends Seeder
{
    public function run(): void
    {
        if (app()->environment('production')) throw new RuntimeException('Este seeder crea asientos inmutables: no se ejecuta en producción.');
        if (DB::scalar("SELECT count(*) FROM asientos WHERE concepto LIKE '[DEMO]%'") > 0) throw new RuntimeException('Los datos de demostración ya existen en esta base.');
        $c = app(ConciliacionController::class);
        $yo = (int) DB::scalar("SELECT id FROM usuarios WHERE rol = 'ADMINISTRADOR' AND activo ORDER BY id LIMIT 1");
        $hoy = DB::scalar('SELECT fn_hoy()');
        $ini = strtotime(substr($hoy, 0, 7) . '-01 -1 month');
        $mes = date('Y-m', $ini); $d = fn (int $dia) => sprintf('%s-%02d', $mes, $dia);
        $bancos = (int) DB::scalar("SELECT fn_cuenta_param('BANCOS')"); $ventas = (int) DB::scalar("SELECT fn_cuenta_param('VENTAS')"); $cxp = (int) DB::scalar("SELECT fn_cuenta_param('CUENTAS_POR_PAGAR')");

        // Libro: [día, concepto, monto (+ entra / − sale)]
        $libro = [[3, 'Lote punto de venta 1', 1250.40], [3, 'Lote punto de venta 2', 480.00], [6, 'Depósito de clientes', 3200.00], [9, 'Transferencia cliente Pedro Vivas', 860.75],
            [12, 'Pago a Repuestos Andinos', -2100.00], [15, 'Lote punto de venta', 2415.30], [18, 'Pago a Lubricantes del Táchira', -640.00], [22, 'Depósito de clientes', 1980.00],
            [25, 'Pago de servicios', -310.50], [29, 'Depósito en tránsito', 1150.00], [30, 'Cheque en circulación', -780.00]];
        foreach ($libro as [$dia, $concepto, $m]) {
            $lineas = [['cuenta_id' => $bancos, 'debe' => max($m, 0), 'haber' => max(-$m, 0)], ['cuenta_id' => $m > 0 ? $ventas : $cxp, 'debe' => max(-$m, 0), 'haber' => max($m, 0)]];
            DB::select("SELECT fn_crear_asiento(?, ?, 'MANUAL', NULL, ?::jsonb, ?)", [$d($dia), "[DEMO] $concepto", json_encode($lineas), $yo]);
        }

        // Banco: lo mismo con desfases de fechas (el banco acredita con retraso) + lo que solo el banco conoce
        $extracto = [[4, 'LOTE POS 1+2', 'LP0004', 1730.40], [6, 'DEPOSITO TAQUILLA', 'D70012', 3200.00], [10, 'TRANSF RECIBIDA P VIVAS', 'T88121', 860.75], [14, 'PAGO PROVEEDOR REPUESTOS ANDINOS', 'T90311', -2100.00],
            [17, 'LOTE POS', 'LP0017', 2415.30], [21, 'PAGO PROV LUBRICANTES', 'T91550', -640.00], [22, 'DEPOSITO TAQUILLA', 'D70188', 1980.00], [26, 'PAGO SERVICIOS', 'T92004', -310.50],
            [28, 'COMISION MANTENIMIENTO CUENTA', 'CM0001', -45.60], [30, 'INTERESES GANADOS', 'NC0007', 12.35]];
        [$r, $cod] = $c->crear(['banco' => 'Banesco', 'cuenta_bancaria' => '4455', 'desde' => $d(1), 'hasta' => date('Y-m-t', $ini), 'cuenta_id' => $bancos, 'tolerancia_dias' => 2], $yo);
        if ($cod !== 200) throw new RuntimeException($r['message'] ?? 'No se pudo crear la conciliación de demostración.');
        $id = $r['id'];
        [$r, $cod] = $c->importar($id, ['archivo' => 'estado-de-cuenta-demo.csv', 'lineas' => array_map(fn ($x) => ['fecha' => $d($x[0]), 'descripcion' => $x[1], 'referencia' => $x[2], 'monto' => $x[3]], $extracto)]);
        if ($cod !== 200) throw new RuntimeException($r['message'] ?? 'No se pudo importar el estado de cuenta de demostración.');
        $c->cruzarAuto($id, ['dias' => 2], $yo);
        $det = $c->detalle($id);
        $pend = fn (string $ref) => collect($det['movimientos'])->firstWhere('referencia', $ref);
        $lib = fn (string $texto) => collect($det['libro'])->first(fn ($l) => str_contains($l['concepto'], $texto) && $l['estado'] === 'SIN_CRUZAR');
        // Viernes → lunes (3 días): sobrepasa la tolerancia, se empareja a mano
        if (($l = $pend('T91550')) && $l['estado'] === 'PENDIENTE' && ($a = $lib('Lubricantes'))) $c->cruzarManual($id, ['linea_id' => $l['id'], 'asientos' => [$a['id']]], $yo);
        if ($l = $pend('CM0001')) $c->clasificar($id, ['linea_id' => $l['id'], 'clase' => 'COMISION', 'nota' => 'Comisión mensual de la cuenta']);
        if ($l = $pend('NC0007')) $c->clasificar($id, ['linea_id' => $l['id'], 'clase' => 'INTERES', 'nota' => 'Intereses del mes']);
        // Saldo del estado de cuenta tal como lo mostraría el banco: libros ajustado − lo que está en tránsito
        $res = $c->detalle($id)['resumen'];
        $c->editar($id, ['saldo_banco_final' => round($res['saldo_libros_ajustado'] - $res['depositos_transito'] - $res['pagos_transito'], 2), 'observaciones' => 'Datos de demostración.']);

        // Declaraciones del SENIAT con diferencias a propósito
        $s = $c->sistemaPeriodo($mes, null); $f = fn ($v) => round($v, 2);
        $c->guardarDeclaracion(['tipo' => 'FORMA_30', 'periodicidad' => 'MENSUAL', 'mes' => $mes, 'numero_planilla' => 'DEMO-0001', 'fecha_presentacion' => date('Y-m-d', strtotime("$mes-01 +1 month +4 days")), 'montos' => [
            'BASE_VENTAS_GRAVADAS' => $s['BASE_VENTAS_GRAVADAS'], 'VENTAS_NO_GRAVADAS' => $s['VENTAS_NO_GRAVADAS'], 'DEBITO_FISCAL' => $f($s['DEBITO_FISCAL'] + 0.40), 'BASE_COMPRAS' => $s['BASE_COMPRAS'],
            'CREDITO_FISCAL' => $f($s['CREDITO_FISCAL'] + 25), 'RETENCIONES_SOPORTADAS' => $s['RETENCIONES_SOPORTADAS'], 'IVA_A_PAGAR' => $s['IVA_A_PAGAR'], 'EXCEDENTE_CREDITO' => $s['EXCEDENTE_CREDITO']]], $yo);
        $c->guardarDeclaracion(['tipo' => 'IGTF', 'periodicidad' => 'MENSUAL', 'mes' => $mes, 'numero_planilla' => 'DEMO-0002', 'montos' => ['BASE_DIVISAS_USD' => $s['BASE_DIVISAS_USD'], 'IGTF_BS' => $s['IGTF_BS']]], $yo);
        // «Retenciones de IVA» queda sin declarar a propósito.
    }
}
