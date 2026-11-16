<?php

namespace App\Support;

/**
 * Qué pantallas ve cada rol. Es la única fuente: la usan el middleware (AccesoPorRol), la pantalla de Usuarios (matriz de accesos)
 * y el redirect de inicio. El menú lateral (AppLayout.jsx) marca con `admin: true` lo mismo que aquí figura como 'no' para el cajero.
 *   ADMINISTRADOR → todo.
 *   CAJERO        → vender (punto de venta), consultar SUS ventas, cobrar cuentas por cobrar y cerrar SU caja. Lo demás es solo del administrador:
 *                   las pantallas con costos, márgenes, compras, libros fiscales, contabilidad, usuarios y configuración.
 * Cada módulo: [clave, etiqueta, primer segmento de la ruta, qué hace el cajero ('si' | 'propio' | 'no'), descripción corta del acceso del cajero]
 */
final class Permisos
{
    public const MODULOS = [
        ['caja', 'Punto de venta', 'caja', 'si', 'Cobra, factura y registra clientes nuevos al vender'],
        ['encargos', 'Encargos de piezas', 'encargos', 'si', 'Piezas pedidas por clientes, anticipos y entregas'],
        ['combos', 'Combos y kits', 'combos', 'si', 'Kits de mantenimiento que la caja vende de una vez'],
        ['ventas', 'Ventas', 'ventas', 'propio', 'Consulta solo las ventas que él hizo; no anula ni emite notas'],
        ['cierre', 'Cierre de caja', 'cierre-caja', 'propio', 'Cuenta y cierra solo su propia caja'],
        ['cxc', 'Cuentas por cobrar', 'cuentas-por-cobrar', 'si', 'Ve las deudas de los clientes y registra sus cobros; no anula cobros'],
        ['movimientos', 'Movimientos de caja', 'movimientos-caja', 'no', 'Egresos, retiros e ingresos de caja'],
        ['reportes', 'Reportes de gestión', 'reportes', 'no', 'Rentabilidad, compras y movimientos de caja'],
        ['panel', 'Panel', 'dashboard', 'no', 'Resumen del negocio con ventas y utilidades'],
        ['productos', 'Productos', 'productos', 'no', 'Costos, márgenes y precios del catálogo'],
        ['kardex', 'Existencias y kardex', 'kardex', 'no', 'Valor del inventario y ajustes de existencias'],
        ['compras', 'Compras', 'compras', 'no', 'Facturas de proveedores y su costo'],
        ['ordenes', 'Órdenes de compra', 'ordenes-compra', 'no', 'Pedidos al proveedor con recepción parcial'],
        ['conteos', 'Conteos físicos', 'conteos', 'no', 'Conteo de inventario con ajuste en lote'],
        ['proveedores', 'Proveedores', 'proveedores', 'no', 'Deudas y pagos a proveedores'],
        ['clientes', 'Clientes', 'clientes', 'no', 'Directorio y expediente de clientes'],
        ['catalogo', 'Categorías, marcas, modelos y compatibilidad', 'categorias|marcas|modelos|compatibilidad', 'no', 'Organización del catálogo'],
        ['tasas', 'Tasas de cambio', 'tasas', 'no', 'Registrar y corregir las tasas del día'],
        ['metodos', 'Métodos de pago', 'metodos-pago', 'no', 'Qué formas de pago acepta el negocio'],
        ['fiscal', 'Libros fiscales, IGTF, ISLR y calendario', 'libros-fiscales|retenciones-islr|calendario-fiscal|declaracion-islr', 'no', 'Libros de IVA, retenciones de IVA e ISLR, declaración y calendario'],
        ['contabilidad', 'Contabilidad', 'contabilidad', 'no', 'Asientos, balances y cierres'],
        ['conciliacion', 'Conciliación (banco y SENIAT)', 'conciliacion', 'no', 'Cruce del banco y de las declaraciones'],
        ['usuarios', 'Usuarios', 'usuarios', 'no', 'Crear usuarios y asignar roles'],
        ['configuracion', 'Configuración', 'configuracion', 'no', 'Datos y reglas fiscales del negocio'],
    ];

    /** Segmentos que el cajero puede abrir además de sus módulos: su propia contraseña. */
    private const COMUNES = ['cuenta', 'logout', 'up'];

    public static function esAdmin(?string $rol): bool
    {
        return strtoupper((string) $rol) === 'ADMINISTRADOR';
    }

    /** Pantalla a la que va cada rol al entrar. */
    public static function inicio(?string $rol): string
    {
        return self::esAdmin($rol) ? '/dashboard' : '/caja';
    }

    /** ¿Puede este rol abrir esta ruta? ($path sin la barra inicial.) */
    public static function permitido(?string $rol, string $path): bool
    {
        if (self::esAdmin($rol)) {
            return true;
        }
        $seg = explode('/', trim($path, '/'))[0] ?? '';
        if ($seg === '' || in_array($seg, self::COMUNES, true)) {
            return true;
        }
        foreach (self::MODULOS as [, , $rutas, $cajero]) {
            if ($cajero !== 'no' && in_array($seg, explode('|', $rutas), true)) {
                return true;
            }
        }
        return false;
    }

    /** Para la pantalla de Usuarios: la matriz por rol. */
    public static function matriz(): array
    {
        return array_map(fn ($m) => ['clave' => $m[0], 'etiqueta' => $m[1], 'cajero' => $m[3], 'detalle' => $m[4]], self::MODULOS);
    }
}
