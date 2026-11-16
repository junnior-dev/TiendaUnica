<?php

/*
 * ValidacionDePropsPorPaginaTest · Suite de Auditoría Forense (4/4) — el contrato de datos.
 *
 * Cada página crítica del ERP se pide por HTTP real y se valida con el
 * paquete oficial de Inertia (assertInertia) contra el CÓDIGO FUENTE de sus
 * controladores: si React espera una prop y no llega (o llega null/string
 * donde va un array), la pantalla se queda en blanco en producción. Aquí se
 * caza antes, con nombre de prop exacto.
 *
 * Dos pasadas por cada página del mapa:
 *   1. CONTRATO: el componente declarado es el del código fuente y TODAS las
 *      props obligatorias están (->has(), la aserción oficial).
 *   2. TIPOS: la identidad («negocio» con nombre, «usuario.nombre» no
 *      vacío) y cada prop estructural llega como ARRAY real — ni null ni
 *      string; los kpis numéricos llegan numéricos.
 *
 * El mapa fija EXACTAMENTE lo que entrega el código: el trait ContextoPagina
 * (negocio, usuario, fecha_larga, stock_bajo, tasa_usd), DashboardController,
 * VentasController::datosPagina, ClientesController, CajaController,
 * ComprasController, ProductosController::index, TasasController::index y
 * LibrosFiscalesController::datos. Dashboard y Tasas definen su propio
 * contexto (sin tasa_usd), por eso no heredan la lista del trait.
 */

use Illuminate\Support\Facades\DB;

/**
 * Mapa de páginas críticas: URI → [componente, props OBLIGATORIAS].
 *
 * @return array<string, array{string, list<string>}>
 */
function forenseMapaProps(): array
{
    $contexto = ['negocio', 'usuario', 'fecha_larga', 'stock_bajo', 'tasa_usd'];   // trait ContextoPagina

    return [
        '/dashboard' => ['Dashboard', ['negocio', 'usuario', 'fecha_larga', 'tasas', 'vencimientos', 'kpis', 'por_moneda', 'semana', 'ultimas', 'alertas', 'mas_vendidos']],
        '/ventas' => ['Ventas/Index', [...$contexto, 'filtros', 'resumen', 'filas', 'meta', 'cajeros', 'es_admin', 'factura_automatica', 'regimen']],
        '/clientes' => ['Clientes/Index', [...$contexto, 'filtros', 'hoy', 'dormido_dias', 'emisor', 'resumen', 'filas']],
        '/caja' => ['Caja/Index', [...$contexto, 'estado', 'apertura', 'emisor', 'regimen', 'tasas', 'factura_automatica', 'metodos', 'recientes']],
        '/compras' => ['Compras/Index', [...$contexto, 'filtros', 'resumen', 'filas', 'meta', 'proveedores', 'especial', 'retenciones_activas']],
        '/productos' => ['Productos/Index', [...$contexto, 'iva_pct', 'margen_defecto', 'kpis', 'catalogo', 'filtros', 'filas', 'meta', 'alertas']],
        '/tasas' => ['Tasas/Index', ['negocio', 'usuario', 'fecha_larga', 'stock_bajo', 'tasas', 'monedas', 'historial', 'catalogo', 'sync', 'reglas']],
        '/libros-fiscales' => ['LibrosFiscales/Index', [...$contexto, 'vista', 'mes', 'hoy', 'desde', 'hasta', 'retenciones_activas', 'enterar_activo', 'regimen', 'resumen', 'emisor']],
    ];
}

/**
 * Props que DEBEN llegar como array (React las recorre o espera objeto).
 * «apertura» en /caja puede ser null (sin turno abierto) y no está aquí.
 *
 * @return array<string, list<string>>
 */
function forensePropsArray(): array
{
    return [
        '/dashboard' => ['usuario', 'tasas', 'vencimientos', 'kpis', 'por_moneda', 'semana', 'ultimas', 'alertas', 'mas_vendidos'],
        '/ventas' => ['usuario', 'filtros', 'resumen', 'filas', 'meta', 'cajeros', 'regimen'],
        '/clientes' => ['usuario', 'filtros', 'emisor', 'resumen', 'filas'],
        '/caja' => ['usuario', 'emisor', 'regimen', 'tasas', 'metodos', 'recientes'],
        '/compras' => ['usuario', 'filtros', 'resumen', 'filas', 'meta', 'proveedores'],
        '/productos' => ['usuario', 'kpis', 'catalogo', 'filtros', 'filas', 'meta', 'alertas'],
        '/tasas' => ['usuario', 'tasas', 'monedas', 'historial', 'catalogo', 'sync', 'reglas'],
        '/libros-fiscales' => ['usuario', 'regimen', 'resumen', 'emisor'],
    ];
}

it('CONTRATO: cada página crítica declara SU componente y trae TODAS las props que React espera', function () {
    $this->actingAs(\App\Models\Usuario::find(adminId()));
    $host = forenseHostA();

    foreach (forenseMapaProps() as $uri => [$componente, $props]) {
        $this->get("http://{$host}{$uri}")->assertInertia(function ($page) use ($componente, $props) {
            $page->component($componente);
            foreach ($props as $prop) {
                $page->has($prop);
            }
        });
    }
});

it('CONTRATO: la identidad llega con nombre, las props estructurales son arrays reales y los kpis numéricos', function () {
    $this->actingAs(\App\Models\Usuario::find(adminId()));
    $host = forenseHostA();

    // Acumulación: el diff final lista TODAS las props mal entregadas, con
    // página, prop y tipo exactos (el error alegado de «props faltantes» se
    // confirma o se refuta aquí).
    $fallos = [];

    foreach (forenseMapaProps() as $uri => [$componente, $props]) {
        $p = propsDePest($this->get("http://{$host}{$uri}"));

        if (trim((string) ($p['negocio'] ?? '')) === '') {
            $fallos[] = "{$uri}: «negocio» no llega o llega vacío";
        }
        if (! is_array($p['usuario'] ?? null) || trim((string) ($p['usuario']['nombre'] ?? '')) === '') {
            $fallos[] = "{$uri}: «usuario.nombre» no llega o llega vacío";
        }
        foreach (forensePropsArray()[$uri] as $clave) {
            if (! is_array($p[$clave] ?? null)) {
                $tipo = isset($p[$clave]) ? gettype($p[$clave]) : 'inexistente';
                $fallos[] = "{$uri} ({$componente}): «{$clave}» debe ser array, llegó {$tipo}";
            }
        }
        $kpis = $p['kpis'] ?? null;
        if (is_array($kpis)) {
            foreach ($kpis as $claveK => $valor) {
                if (! is_numeric($valor)) {
                    $fallos[] = "{$uri}: kpis.{$claveK} no es numérico";
                }
            }
        }
    }

    expect($fallos, 'props con tipo, presencia o valor equivocado')->toBe([]);
});
