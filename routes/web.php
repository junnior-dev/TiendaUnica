<?php

use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\CategoriasController;
use App\Http\Controllers\CajaController;
use App\Http\Controllers\AperturaCajaController;
use App\Http\Controllers\CuentasPorCobrarController;
use App\Http\Controllers\MovimientosCajaController;
use App\Http\Controllers\ReportesController;
use App\Http\Controllers\VentasController;
use App\Http\Controllers\ComprasController;
use App\Http\Controllers\ConciliacionController;
use App\Http\Controllers\ContabilidadController;
use App\Http\Controllers\ConfiguracionController;
use App\Http\Controllers\CierreCajaController;
use App\Http\Controllers\LibrosFiscalesController;
use App\Http\Controllers\CompatibilidadController;
use App\Http\Controllers\MarcasController;
use App\Http\Controllers\MetodosPagoController;
use App\Http\Controllers\ModelosController;
use App\Http\Controllers\ProductosController;
use App\Http\Controllers\ClientesController;
use App\Http\Controllers\KardexController;
use App\Http\Controllers\ProveedoresController;
use App\Http\Controllers\TasasController;
use App\Http\Controllers\EncargosController;
use App\Http\Controllers\CombosController;
use App\Http\Controllers\OrdenesCompraController;
use App\Http\Controllers\ConteosController;
use Illuminate\Support\Facades\Route;

Route::middleware('guest')->group(function () {
    Route::get('/login', [LoginController::class, 'create'])->name('login');
    // Auditoría M-2: límite de intentos por IP contra fuerza bruta.
    Route::post('/login', [LoginController::class, 'store'])->middleware('throttle:5,1');
    Route::get('/registro', [RegisterController::class, 'create']);
    Route::post('/registro', [RegisterController::class, 'store'])->middleware('throttle:5,1');
});
Route::post('/logout', [LoginController::class, 'destroy'])->middleware(['throttle:auth', 'auth']);
// Auditoría (mejora 2): throttle global del usuario autenticado (60/min) para
// TODO el grupo privado; los login/registro ya llevan los suyos.
Route::middleware(['throttle:auth', 'auth', \App\Http\Middleware\AccesoPorRol::class, \App\Http\Middleware\ModuloFiscal::class])->group(function () {
    Route::get('/', fn () => redirect(\App\Support\Permisos::inicio(auth()->user()->rol)));
    Route::get('/cuenta/contrasena', [\App\Http\Controllers\CuentaController::class, 'contrasena']);
    Route::post('/cuenta/contrasena', [\App\Http\Controllers\CuentaController::class, 'guardar']);
    Route::get('/usuarios', [\App\Http\Controllers\UsuariosController::class, 'index']);
    Route::post('/usuarios', [\App\Http\Controllers\UsuariosController::class, 'store']);
    Route::put('/usuarios/{id}', [\App\Http\Controllers\UsuariosController::class, 'update'])->whereNumber('id');
    Route::post('/usuarios/{id}/contrasena', [\App\Http\Controllers\UsuariosController::class, 'restablecer'])->whereNumber('id');
    Route::patch('/usuarios/{id}/estado', [\App\Http\Controllers\UsuariosController::class, 'estado'])->whereNumber('id');
    Route::get('/dashboard', DashboardController::class);
    Route::get('/productos', [ProductosController::class, 'index']);
    Route::get('/productos/{id}', [ProductosController::class, 'show'])->whereNumber('id');
    Route::post('/productos', [ProductosController::class, 'store']);
    Route::put('/productos/{id}', [ProductosController::class, 'update'])->whereNumber('id');
    Route::post('/productos/{id}/ajustar', [ProductosController::class, 'ajustar'])->whereNumber('id');
    Route::post('/productos/{id}/presentaciones', [ProductosController::class, 'guardarPresentacion'])->whereNumber('id');
    Route::delete('/productos/{id}/presentaciones/{presentacion}', [ProductosController::class, 'quitarPresentacion'])->whereNumber(['id', 'presentacion']);
    // Etiquetas con código de barras y códigos internos EAN-13
    Route::post('/productos/etiquetas', [ProductosController::class, 'etiquetas']);
    Route::post('/productos/barcodes', [ProductosController::class, 'barcodes']);
    Route::post('/alertas-precio/aplicar-todas', [ProductosController::class, 'aplicarTodas']);
    Route::post('/alertas-precio/{alerta}', [ProductosController::class, 'resolverAlerta'])->whereNumber('alerta');
    Route::get('/libros-fiscales', [LibrosFiscalesController::class, 'index']);
    Route::get('/libros-fiscales/quincenal', [LibrosFiscalesController::class, 'resumenQuincenal']);
    Route::get('/libros-fiscales/validar', [LibrosFiscalesController::class, 'cierreFiscal']);
    Route::get('/libros-fiscales/paquete', [LibrosFiscalesController::class, 'paqueteDatos']);
    Route::post('/libros-fiscales/retenciones/enterar', [LibrosFiscalesController::class, 'enterar']);
    Route::post('/libros-fiscales/retenciones/enteradas/{id}/desmarcar', [LibrosFiscalesController::class, 'desmarcarEnterada'])->whereNumber('id');
    Route::get('/libros-fiscales/ventas', [LibrosFiscalesController::class, 'buscarVentas']);
    Route::post('/libros-fiscales/notas', [LibrosFiscalesController::class, 'notaStore']);
    Route::post('/libros-fiscales/ventas/{id}/factura', [LibrosFiscalesController::class, 'asignarFactura'])->whereNumber('id');
    Route::put('/libros-fiscales/alicuotas', [LibrosFiscalesController::class, 'alicuotaUpdate']);
    Route::post('/libros-fiscales/retenciones', [LibrosFiscalesController::class, 'retencionStore']);
    Route::post('/libros-fiscales/retenciones/{id}/anular', [LibrosFiscalesController::class, 'retencionAnular'])->whereNumber('id');
    Route::post('/libros-fiscales/compras/{id}/importacion', [LibrosFiscalesController::class, 'importacionStore'])->whereNumber('id');

    Route::get('/caja', [CajaController::class, 'index']);
    Route::get('/caja/buscar', [CajaController::class, 'buscar']);
    Route::get('/caja/clientes', [CajaController::class, 'clientes']);
    Route::post('/caja/clientes', [CajaController::class, 'clienteStore']);
    Route::post('/caja/cotizar', [CajaController::class, 'cotizar']);
    Route::post('/caja/venta', [CajaController::class, 'registrar']);
    Route::get('/caja/venta/{id}', [CajaController::class, 'documento'])->whereNumber('id');
    Route::post('/caja/venta/{id}/emitir', [CajaController::class, 'emitir'])->whereNumber('id');
    Route::post('/caja/venta/{id}/factura', [CajaController::class, 'factura'])->whereNumber('id');
    // Turnos de caja y venta a crédito (SQL 14 y 15)
    Route::get('/caja/apertura', [AperturaCajaController::class, 'estadoActual']);
    Route::post('/caja/apertura', [AperturaCajaController::class, 'store']);
    Route::get('/caja/corte-x', [AperturaCajaController::class, 'corteX']);
    Route::get('/caja/credito/verificar', [CajaController::class, 'creditoVerificar']);
    Route::get('/caja/recientes', fn () => response()->json((new CajaController())->recientes()));

    Route::get('/compras', [ComprasController::class, 'index']);
    Route::get('/conciliacion', [ConciliacionController::class, 'index']);
    Route::post('/conciliacion/bancaria', [ConciliacionController::class, 'bancariaStore']);
    Route::get('/conciliacion/bancaria/{id}', [ConciliacionController::class, 'bancariaVer'])->whereNumber('id');
    Route::put('/conciliacion/bancaria/{id}', [ConciliacionController::class, 'bancariaUpdate'])->whereNumber('id');
    Route::delete('/conciliacion/bancaria/{id}', [ConciliacionController::class, 'bancariaBorrar'])->whereNumber('id');
    Route::post('/conciliacion/bancaria/{id}/importar', [ConciliacionController::class, 'bancariaImportar'])->whereNumber('id');
    Route::post('/conciliacion/bancaria/{id}/cruzar-auto', [ConciliacionController::class, 'bancariaAuto'])->whereNumber('id');
    Route::post('/conciliacion/bancaria/{id}/cruzar', [ConciliacionController::class, 'bancariaCruzar'])->whereNumber('id');
    Route::post('/conciliacion/bancaria/{id}/descruzar', [ConciliacionController::class, 'bancariaDescruzar'])->whereNumber('id');
    Route::post('/conciliacion/bancaria/{id}/clasificar', [ConciliacionController::class, 'bancariaClasificar'])->whereNumber('id');
    Route::post('/conciliacion/bancaria/{id}/anterior', [ConciliacionController::class, 'bancariaAnterior'])->whereNumber('id');
    Route::post('/conciliacion/bancaria/{id}/cerrar', [ConciliacionController::class, 'bancariaCerrar'])->whereNumber('id');
    Route::get('/conciliacion/bancaria/{id}/acta', [ConciliacionController::class, 'bancariaActa'])->whereNumber('id');
    Route::get('/conciliacion/fiscal', [ConciliacionController::class, 'fiscalVer']);
    Route::post('/conciliacion/fiscal', [ConciliacionController::class, 'fiscalStore']);
    Route::delete('/conciliacion/fiscal/{id}', [ConciliacionController::class, 'fiscalBorrar'])->whereNumber('id');
    Route::get('/conciliacion/fiscal/reporte', [ConciliacionController::class, 'fiscalReporte']);
    Route::get('/contabilidad', [ContabilidadController::class, 'index']);
    Route::get('/contabilidad/reporte', [ContabilidadController::class, 'reporte']);
    Route::get('/contabilidad/exportar', [ContabilidadController::class, 'exportar']);
    Route::get('/contabilidad/periodos', [ContabilidadController::class, 'periodosVer']);
    Route::post('/contabilidad/periodos/cerrar', [ContabilidadController::class, 'periodoCerrar']);
    Route::post('/contabilidad/periodos/reabrir', [ContabilidadController::class, 'periodoReabrir']);
    Route::get('/contabilidad/apertura', [ContabilidadController::class, 'aperturaVer']);
    Route::post('/contabilidad/apertura', [ContabilidadController::class, 'aperturaStore']);
    Route::get('/contabilidad/cierre-ejercicio', [ContabilidadController::class, 'cierreEjercicioVer']);
    Route::post('/contabilidad/cierre-ejercicio', [ContabilidadController::class, 'cierreEjercicioStore']);
    Route::get('/contabilidad/ajuste-cambiario', [ContabilidadController::class, 'ajusteVer']);
    Route::post('/contabilidad/ajuste-cambiario', [ContabilidadController::class, 'ajusteStore']);
    Route::post('/contabilidad/automatica', [ContabilidadController::class, 'automatica']);
    Route::post('/contabilidad/asientos', [ContabilidadController::class, 'asientoStore']);
    Route::post('/contabilidad/cuentas', [ContabilidadController::class, 'cuentaStore']);
    Route::put('/contabilidad/cuentas/{id}', [ContabilidadController::class, 'cuentaUpdate'])->whereNumber('id');
    Route::put('/contabilidad/parametros/{clave}', [ContabilidadController::class, 'parametroUpdate']);
    Route::get('/compras/nueva', [ComprasController::class, 'nueva']);
    Route::get('/compras/reporte', [ComprasController::class, 'reporte']);
    Route::get('/compras/productos', [ComprasController::class, 'productos']);
    Route::get('/proveedores', [ProveedoresController::class, 'index']);
    Route::post('/proveedores', [ProveedoresController::class, 'store']);
    Route::get('/proveedores/pagos/cotizar', [ProveedoresController::class, 'cotizarPago']);
    Route::get('/proveedores/{id}', [ProveedoresController::class, 'show'])->whereNumber('id');
    Route::get('/proveedores/{id}/cuenta', [ProveedoresController::class, 'cuenta'])->whereNumber('id');
    Route::get('/proveedores/{id}/expediente', [ProveedoresController::class, 'expediente'])->whereNumber('id');
    Route::post('/proveedores/{id}/pagos', [ProveedoresController::class, 'pagar'])->whereNumber('id');
    Route::post('/proveedores/{id}/pagos/{pago}/anular', [ProveedoresController::class, 'pagoAnular'])->whereNumber('id')->whereNumber('pago');
    Route::put('/proveedores/{id}', [ProveedoresController::class, 'update'])->whereNumber('id');
    Route::patch('/proveedores/{id}/estado', [ProveedoresController::class, 'estado'])->whereNumber('id');
    Route::delete('/proveedores/{id}', [ProveedoresController::class, 'destroy'])->whereNumber('id');
    Route::get('/clientes', [ClientesController::class, 'index']);
    Route::post('/clientes', [ClientesController::class, 'store']);
    Route::get('/clientes/{id}', [ClientesController::class, 'show'])->whereNumber('id');
    Route::put('/clientes/{id}', [ClientesController::class, 'update'])->whereNumber('id');
    Route::patch('/clientes/{id}/estado', [ClientesController::class, 'estado'])->whereNumber('id');
    Route::delete('/clientes/{id}', [ClientesController::class, 'destroy'])->whereNumber('id');
    Route::get('/compras/proveedores', [ComprasController::class, 'proveedores']);
    Route::post('/compras/proveedores', [ComprasController::class, 'proveedorStore']);
    Route::get('/compras/tasa', [ComprasController::class, 'tasa']);
    Route::get('/compras/duplicada', [ComprasController::class, 'duplicada']);
    Route::post('/compras/simular', [ComprasController::class, 'simular']);
    Route::post('/compras', [ComprasController::class, 'store']);
    Route::get('/compras/{id}', [ComprasController::class, 'show'])->whereNumber('id');
    Route::post('/compras/{id}/anular', [ComprasController::class, 'anular'])->whereNumber('id');
    Route::post('/compras/{id}/retencion', [ComprasController::class, 'retencion'])->whereNumber('id');
    Route::post('/compras/{id}/retencion/anular', [ComprasController::class, 'retencionAnular'])->whereNumber('id');
    Route::post('/compras/{id}/importacion', [ComprasController::class, 'importacion'])->whereNumber('id');
    Route::get('/configuracion', [ConfiguracionController::class, 'index']);
    Route::post('/configuracion/alicuota', [ConfiguracionController::class, 'alicuota']);
    Route::delete('/configuracion/alicuota/{codigo}', [ConfiguracionController::class, 'cancelarAlicuota']);
    Route::post('/configuracion/{seccion}', [ConfiguracionController::class, 'guardar'])->where('seccion', 'negocio|regimen|precios|cobros|numeracion');
    Route::get('/ventas', [VentasController::class, 'index']);
    Route::get('/ventas/{id}', [VentasController::class, 'show'])->whereNumber('id');
    Route::post('/ventas/{id}/anular', [VentasController::class, 'anular'])->whereNumber('id');
    Route::get('/ventas/metodos-devolucion', [VentasController::class, 'metodosDevolucion']);
    Route::get('/ventas/{id}/devolvibles', [VentasController::class, 'devolviblesJson'])->whereNumber('id');
    Route::post('/ventas/{id}/nota', [VentasController::class, 'nota'])->whereNumber('id');

    Route::get('/kardex', [KardexController::class, 'index']);
    Route::get('/kardex/reporte', [KardexController::class, 'reporteJson']);
    Route::get('/kardex/buscar', [KardexController::class, 'buscar']);
    Route::get('/kardex/producto/{id}', [KardexController::class, 'fichaJson'])->whereNumber('id');
    Route::post('/kardex/ajustar', [KardexController::class, 'ajustar']);

    Route::get('/cuentas-por-cobrar', [CuentasPorCobrarController::class, 'index']);
    Route::get('/cuentas-por-cobrar/cliente/{id}', [CuentasPorCobrarController::class, 'estadoCuenta'])->whereNumber('id');
    Route::get('/cuentas-por-cobrar/{id}', [CuentasPorCobrarController::class, 'show'])->whereNumber('id');
    Route::post('/cuentas-por-cobrar/pagos', [CuentasPorCobrarController::class, 'pagar']);
    Route::get('/cuentas-por-cobrar/pagos/{pago}/comprobante', [CuentasPorCobrarController::class, 'comprobante'])->whereNumber('pago');
    Route::post('/cuentas-por-cobrar/pagos/{pago}/anular', [CuentasPorCobrarController::class, 'anularPago'])->whereNumber('pago');
    Route::get('/movimientos-caja', [MovimientosCajaController::class, 'index']);
    Route::post('/movimientos-caja', [MovimientosCajaController::class, 'store']);
    Route::post('/movimientos-caja/{id}/anular', [MovimientosCajaController::class, 'anular'])->whereNumber('id');
    Route::get('/reportes', [ReportesController::class, 'index']);
    Route::get('/reportes/rentabilidad', [ReportesController::class, 'rentabilidad']);
    Route::get('/reportes/compras-global', [ReportesController::class, 'comprasGlobal']);
    Route::get('/reportes/movimientos-caja', [ReportesController::class, 'movimientosCaja']);
    // Análisis de inventario y rentabilidad (SQL 28)
    Route::get('/reportes/abc', [ReportesController::class, 'abc']);
    Route::get('/reportes/rotacion', [ReportesController::class, 'rotacion']);
    Route::get('/reportes/rentabilidad-categoria', [ReportesController::class, 'rentabilidadCategoria']);
    Route::get('/reportes/rentabilidad-cliente', [ReportesController::class, 'rentabilidadCliente']);
    Route::get('/cierre-caja', [CierreCajaController::class, 'index']);
    Route::post('/cierre-caja', [CierreCajaController::class, 'store']);
    // Encargos de piezas sin stock (SQL 24): la caja y el administrador
    Route::get('/encargos', [EncargosController::class, 'index']);
    Route::post('/encargos', [EncargosController::class, 'store']);
    Route::get('/encargos/{id}', [EncargosController::class, 'ver'])->whereNumber('id');
    Route::post('/encargos/{id}/anticipo', [EncargosController::class, 'anticipo'])->whereNumber('id');
    Route::post('/encargos/{id}/estado', [EncargosController::class, 'estado'])->whereNumber('id');
    Route::post('/encargos/{id}/entregar', [EncargosController::class, 'entregar'])->whereNumber('id');
    // Combos / kits de mantenimiento (SQL 25): el CRUD es del administrador; la caja solo lee
    Route::get('/combos', [CombosController::class, 'index']);
    Route::get('/combos/lista', fn () => app(CombosController::class)->lista());
    Route::get('/combos/cotizar', [CombosController::class, 'cotizar']);
    Route::post('/combos', [CombosController::class, 'store']);
    Route::put('/combos/{id}', [CombosController::class, 'update'])->whereNumber('id');
    Route::patch('/combos/{id}/estado', [CombosController::class, 'estado'])->whereNumber('id');
    Route::delete('/combos/{id}', [CombosController::class, 'destroy'])->whereNumber('id');
    // Órdenes de compra con recepción parcial (SQL 26), solo administradores
    Route::get('/ordenes-compra', [OrdenesCompraController::class, 'index']);
    Route::get('/ordenes-compra/sugerir', [OrdenesCompraController::class, 'sugerir']);
    Route::post('/ordenes-compra', [OrdenesCompraController::class, 'store']);
    Route::post('/ordenes-compra/{id}/enviar', [OrdenesCompraController::class, 'enviar'])->whereNumber('id');
    Route::post('/ordenes-compra/{id}/cerrar', [OrdenesCompraController::class, 'cerrar'])->whereNumber('id');
    Route::post('/ordenes-compra/{id}/anular', [OrdenesCompraController::class, 'anular'])->whereNumber('id');
    Route::post('/ordenes-compra/{id}/recibir', [OrdenesCompraController::class, 'recibir'])->whereNumber('id');
    // Conteos físicos con ajuste masivo (SQL 27), solo administradores
    Route::get('/conteos', [ConteosController::class, 'index']);
    Route::post('/conteos', [ConteosController::class, 'store']);
    Route::post('/conteos/{id}/contar', [ConteosController::class, 'contar'])->whereNumber('id');
    Route::post('/conteos/{id}/quitar', [ConteosController::class, 'quitar'])->whereNumber('id');
    Route::post('/conteos/{id}/aplicar', [ConteosController::class, 'aplicar'])->whereNumber('id');
    Route::post('/conteos/{id}/anular', [ConteosController::class, 'anular'])->whereNumber('id');

    Route::get('/categorias', [CategoriasController::class, 'index']);
    Route::post('/categorias', [CategoriasController::class, 'store']);
    Route::put('/categorias/{id}', [CategoriasController::class, 'update'])->whereNumber('id');
    Route::patch('/categorias/{id}/estado', [CategoriasController::class, 'estado'])->whereNumber('id');
    Route::post('/categorias/{id}/recalcular', [CategoriasController::class, 'recalcular'])->whereNumber('id');
    Route::delete('/categorias/{id}', [CategoriasController::class, 'destroy'])->whereNumber('id');
    Route::get('/retenciones-islr', [\App\Http\Controllers\RetencionesIslrController::class, 'index']);
    Route::post('/retenciones-islr', [\App\Http\Controllers\RetencionesIslrController::class, 'store']);
    Route::post('/retenciones-islr/simular', [\App\Http\Controllers\RetencionesIslrController::class, 'simular']);
    Route::post('/retenciones-islr/enterar', [\App\Http\Controllers\RetencionesIslrController::class, 'enterar']);
    Route::post('/retenciones-islr/unidad-tributaria', [\App\Http\Controllers\RetencionesIslrController::class, 'guardarUt']);
    Route::post('/retenciones-islr/configuracion', [\App\Http\Controllers\RetencionesIslrController::class, 'guardarConfig']);
    Route::post('/retenciones-islr/enteros/{id}/desmarcar', [\App\Http\Controllers\RetencionesIslrController::class, 'desmarcarEntero'])->whereNumber('id');
    Route::post('/retenciones-islr/{id}/anular', [\App\Http\Controllers\RetencionesIslrController::class, 'anular'])->whereNumber('id');
    Route::get('/retenciones-islr/{id}/comprobante', [\App\Http\Controllers\RetencionesIslrController::class, 'comprobante'])->whereNumber('id');
    Route::get('/declaracion-islr', [\App\Http\Controllers\DeclaracionIslrController::class, 'index']);
    Route::post('/declaracion-islr/datos', [\App\Http\Controllers\DeclaracionIslrController::class, 'guardarDatos']);
    Route::post('/declaracion-islr/tramos', [\App\Http\Controllers\DeclaracionIslrController::class, 'guardarTramos']);
    Route::post('/declaracion-islr/anticipos', [\App\Http\Controllers\DeclaracionIslrController::class, 'anticipo']);
    Route::post('/declaracion-islr/anticipos/{id}/anular', [\App\Http\Controllers\DeclaracionIslrController::class, 'anularAnticipo'])->whereNumber('id');
    Route::post('/declaracion-islr/retenciones-recibidas', [\App\Http\Controllers\DeclaracionIslrController::class, 'sufrida']);
    Route::post('/declaracion-islr/retenciones-recibidas/{id}/anular', [\App\Http\Controllers\DeclaracionIslrController::class, 'anularSufrida'])->whereNumber('id');
    Route::post('/declaracion-islr/liquidar', [\App\Http\Controllers\DeclaracionIslrController::class, 'liquidar']);
    Route::post('/declaracion-islr/pagar', [\App\Http\Controllers\DeclaracionIslrController::class, 'pagar']);
    Route::post('/declaracion-islr/revertir', [\App\Http\Controllers\DeclaracionIslrController::class, 'revertir']);
    Route::get('/calendario-fiscal', [\App\Http\Controllers\CalendarioFiscalController::class, 'index']);
    Route::post('/calendario-fiscal/presentada', [\App\Http\Controllers\CalendarioFiscalController::class, 'marcar']);
    Route::post('/calendario-fiscal/fecha', [\App\Http\Controllers\CalendarioFiscalController::class, 'guardar']);
    Route::post('/calendario-fiscal/cargar', [\App\Http\Controllers\CalendarioFiscalController::class, 'cargar']);
    Route::post('/calendario-fiscal/fecha/eliminar', [\App\Http\Controllers\CalendarioFiscalController::class, 'eliminar']);
    Route::post('/calendario-fiscal/obligacion', [\App\Http\Controllers\CalendarioFiscalController::class, 'obligacion']);
    Route::post('/calendario-fiscal/presentada/quitar', [\App\Http\Controllers\CalendarioFiscalController::class, 'desmarcar']);
    Route::get('/metodos-pago', [MetodosPagoController::class, 'index']);
    Route::post('/metodos-pago', [MetodosPagoController::class, 'store']);
    Route::put('/metodos-pago/{id}', [MetodosPagoController::class, 'update'])->whereNumber('id');
    Route::patch('/metodos-pago/{id}/estado', [MetodosPagoController::class, 'estado'])->whereNumber('id');
    Route::delete('/metodos-pago/{id}', [MetodosPagoController::class, 'destroy'])->whereNumber('id');
    Route::get('/marcas', [MarcasController::class, 'index']);
    Route::post('/marcas', [MarcasController::class, 'store']);
    Route::put('/marcas/{id}', [MarcasController::class, 'update'])->whereNumber('id');
    Route::patch('/marcas/{id}/estado', [MarcasController::class, 'estado'])->whereNumber('id');
    Route::delete('/marcas/{id}', [MarcasController::class, 'destroy'])->whereNumber('id');
    Route::get('/modelos', [ModelosController::class, 'index']);
    Route::get('/modelos/{id}', [ModelosController::class, 'show'])->whereNumber('id');
    Route::patch('/modelos/marca', [ModelosController::class, 'renombrarMarca']);
    Route::get('/compatibilidad', [CompatibilidadController::class, 'index']);
    Route::get('/compatibilidad/{moto}/candidatos', [CompatibilidadController::class, 'candidatos'])->whereNumber('moto');
    Route::post('/compatibilidad/{moto}/productos', [CompatibilidadController::class, 'agregar'])->whereNumber('moto');
    Route::patch('/compatibilidad/{moto}/productos/{producto}', [CompatibilidadController::class, 'anio'])->whereNumber(['moto', 'producto']);
    Route::post('/compatibilidad/{moto}/quitar', [CompatibilidadController::class, 'quitar'])->whereNumber('moto');
    Route::post('/compatibilidad/{moto}/copiar', [CompatibilidadController::class, 'copiar'])->whereNumber('moto');
    Route::post('/modelos', [ModelosController::class, 'store']);
    Route::put('/modelos/{id}', [ModelosController::class, 'update'])->whereNumber('id');
    Route::delete('/modelos/{id}', [ModelosController::class, 'destroy'])->whereNumber('id');
    Route::get('/tasas', [TasasController::class, 'index']);
    Route::get('/tasas/consulta', [TasasController::class, 'consulta']);
    Route::post('/tasas/par', [TasasController::class, 'par']);
    Route::post('/tasas/sincronizar', [TasasController::class, 'sincronizar']);
    Route::post('/tasas/manual', [TasasController::class, 'manual']);
    Route::patch('/monedas/{codigo}', [TasasController::class, 'moneda']);
});

// ── Health check de base de datos ──────────────────────────────────────────
// Tienda única: la conexión puede usar cualquier rol; se informa el usuario
// actual y si es superusuario, pero no se aborta.
Route::get('/health/db', function () {
    try {
        $super = (bool) Illuminate\Support\Facades\DB::selectOne(
            'SELECT rolsuper FROM pg_roles WHERE rolname = current_user'
        )?->rolsuper;
    } catch (\Throwable $e) {
        return response()->json(['db' => 'error', 'detalle' => substr($e->getMessage(), 0, 120)], 503);
    }
    $cuerpo = ['db' => 'ok', 'usuario' => Illuminate\Support\Facades\DB::selectOne('SELECT current_user')->current_user, 'superusuario' => $super];

    return response()->json($cuerpo);
});

// ── Health checks de observabilidad (Nivel 1) ────────────────────────────────
// El orquestador sondea /health/* sin subdominio: por eso IdentificarTenant
// los exime del resolver de tenant (y RLS no aplica: no tocan datos de negocio).
//
// /health/cache · escribe, lee y borra una clave real en el store configurado.
//   Detecta caché inaccesible (disco lleno, Redis caído) ANTES de que se
//   perciba en la app. Devuelve también la latencia del roundtrip.
Route::get('/health/cache', function () {
    $inicio = microtime(true);
    $clave = 'health:'.bin2hex(random_bytes(8));

    try {
        Illuminate\Support\Facades\Cache::put($clave, 'ok', 10);
        $valor = Illuminate\Support\Facades\Cache::get($clave);
        Illuminate\Support\Facades\Cache::forget($clave);
    } catch (\Throwable $e) {
        return response()->json(['cache' => 'error', 'detalle' => substr($e->getMessage(), 0, 120)], 503);
    }

    if ($valor !== 'ok') {
        return response()->json(['cache' => 'error', 'detalle' => 'la clave escrita no se leyó'], 500);
    }

    return response()->json([
        'cache' => 'ok',
        'driver' => config('cache.default'),
        'ms' => (int) round((microtime(true) - $inicio) * 1000),
    ]);
});

// /health/queue · comprueba el almacén de la cola de jobs.
//   sync  → no hay cola: «ok» directo (el trabajo corre en la misma petición).
//   db    → cuenta jobs pendientes y antigüedad del más viejo: la señal clásica
//           de «el worker está muerto» es la antigüedad creciendo sin bajar.
//   redis → PING contra la conexión real de la cola.
Route::get('/health/queue', function () {
    $driver = (string) config('queue.default');

    if ($driver === 'sync') {
        return response()->json(['queue' => 'ok', 'driver' => $driver]);
    }

    try {
        if ($driver === 'database') {
            $pendientes = (int) Illuminate\Support\Facades\DB::table('jobs')->count();
            $masViejo = Illuminate\Support\Facades\DB::table('jobs')->min('created_at');   // epoch (s)

            return response()->json([
                'queue' => 'ok',
                'driver' => $driver,
                'pendientes' => $pendientes,
                'antiguedad_maxima_s' => $masViejo !== null ? max(0, time() - (int) $masViejo) : 0,
            ]);
        }

        Illuminate\Support\Facades\Queue::connection($driver)->size();   // toca la conexión del driver

        return response()->json(['queue' => 'ok', 'driver' => $driver, 'pendientes' => Illuminate\Support\Facades\Queue::connection($driver)->size()]);
    } catch (\Throwable $e) {
        return response()->json(['queue' => 'error', 'driver' => $driver, 'detalle' => substr($e->getMessage(), 0, 120)], 503);
    }
});

// /metrics · exposición Prometheus (Nivel 1). Token Bearer, falla cerrado.
// Ruta aparte del grupo web: sin sesión ni cookies; Prometheus puro.
Route::get('/metrics', \App\Http\Controllers\MetricsController::class);

// ── Reportes de violación de CSP (mejora 7) ──────────────────────────────────
// El navegador envía aquí cada violación cuando la CSP corre en modo
// Report-Only (staging) o enforcement (producción). Sin sesión a propósito.
Route::post('/csp-report', function (Illuminate\Http\Request $r) {
    $cuerpo = $r->json()->all();
    if ($cuerpo === []) {
        return response('', 204);
    }
    $linea = now()->toIso8601String().' '.json_encode([
        'agente' => (string) $r->headers->get('User-Agent'),
        'report' => $cuerpo['csp-report'] ?? $cuerpo,
    ], JSON_UNESCAPED_SLASHES).PHP_EOL;
    file_put_contents(storage_path('logs/csp-report.log'), $linea, FILE_APPEND);

    return response('', 204);
})->middleware('throttle:30,1');
