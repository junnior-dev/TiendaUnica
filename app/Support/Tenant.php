<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Identidad de la tienda activa en esta petición o proceso.
 *
 * El SQL del negocio NUNCA filtra a mano: aquí se resuelve el subdominio en
 * tienda.estado_tenants y se fija el GUC app.negocio_id con set_config.
 * Row-Level Security (la guarda fn_sesion_permitida) hace el resto: una sesión
 * sin GUC no ve ni escribe nada —no cae por defecto al negocio 1— y un tenant
 * suspendido por mora tampoco.
 *
 *   Tenant::resolver($request->getHost());  // en el middleware, por petición
 *   Tenant::fijar(2);                       // en colas y comandos, por proceso
 *   Tenant::id();                           // ¿qué tienda está activa?
 *   Tenant::modulo('repuestos');            // ¿tiene el vertical activo?
 */
class Tenant
{
    protected static ?int $negocioId = null;

    protected static ?array $estado = null;

    /** Resuelve la tienda por subdominio y fija app.negocio_id para la petición. */
    public static function resolver(string $host): int
    {
        $sub = static::subdominioDe($host);
        $estado = null;
        if ($sub !== '' && $sub !== 'www') {
            $estado = DB::table('estado_tenants')->where('subdominio', $sub)->first();
            if (! $estado) {
                abort(404, 'Tienda no encontrada: el subdominio «'.$sub.'» no está registrado.');
            }
        } else {
            $registradas = DB::table('estado_tenants')->orderBy('negocio_id')->get();
            if ($registradas->count() === 1) {       // modo tienda única (compatibilidad con dev)
                $estado = $registradas->first();
            } elseif ($registradas->count() > 1) {   // multi: sin subdominio no se adivina
                abort(404, 'Falta el subdominio de la tienda (plataforma multi-negocio).');
            } else {
                abort(503, 'Plataforma sin tiendas registradas.');
            }
        }
        if (! $estado->activo) {
            abort(403, 'Cuenta suspendida por mora. Escribe a soporte para reactivarla.');
        }

        return static::fijar((int) $estado->negocio_id, (array) $estado);
    }

    /** Fija el negocio activo (colas, comandos artisan, pruebas). */
    public static function fijar(int $negocioId, array $estado = []): int
    {
        DB::statement('SELECT set_config(?, ?, false)', ['app.negocio_id', (string) $negocioId]);
        static::$negocioId = $negocioId;
        static::$estado = $estado !== []
            ? static::normalizar($estado)
            : static::normalizar((array) DB::table('estado_tenants')->where('negocio_id', $negocioId)->first());

        return $negocioId;
    }

    /**
     * Quita el GUC al terminar la petición: la conexión vuelve al pool SIN
     * identidad de tienda. El GUC es de sesión (set_config false, necesario
     * porque Laravel trabaja en autocommit); si nadie lo limpia, en un pool
     * de conexiones (pgBouncer en modo sesión, Octane, workers) la siguiente
     * petición o el siguiente job heredaría el negocio de la anterior. Con
     * esto la conexión queda neutra —y la guarda fn_sesion_permitida hace
     * que una conexión neutra no vea ni escriba nada (fail-closed)—.
     */
    public static function limpiar(): void
    {
        DB::statement("SELECT set_config('app.negocio_id', '', false)");
        static::$negocioId = null;
        static::$estado = null;
    }

    public static function id(): ?int
    {
        return static::$negocioId;
    }

    /**
     * Auditoría (mejora 9) · ejecuta un trabajo DENTRO de un tenant y garantiza
     * que la conexión queda neutra pase lo que pase (excepción incluida).
     *
     * Es la versión reutilizable del try/finally del middleware: jobs en cola,
     * comandos artisan y scripts NO pasan por IdentificarTenant, y un GUC de
     * sesión sin limpiar haría que la SIGUIENTE tarea del mismo worker heredara
     * el tenant anterior (exactamente el escenario que t17 cazó para HTTP).
     * Devuelve lo que devuelva $trabajo().
     */
    public static function ejecutar(int $negocioId, callable $trabajo): mixed
    {
        static::fijar($negocioId);
        try {
            return $trabajo($negocioId);
        } finally {
            static::limpiar();
        }
    }

    public static function estado(): ?array
    {
        return static::$estado;
    }

    /**
     * ¿Esta tienda administra las tablas GLOBALES de la plataforma (tasas de
     * cambio, alícuotas fiscales, unidad tributaria, monedas)? Fuente:
     * estado_tenants.modulos.editar_global (auditoría A-4). Por defecto es
     * falsa: las tasas y parámetros fiscales los fija la plataforma y los
     * clientes solo los leen; la tienda propia del operador (negocio 1) la
     * trae activa. En tienda única (sin fila en estado_tenants) queda abierta,
     * igual que fiscal(): el despliegue local no es multiinquilino.
     */
    public static function editarGlobal(): bool
    {
        return static::$estado === null || static::modulo('editar_global');
    }

    /**
     * ¿El plan de la tienda incluye la parte fiscal, contable e ISLR? Es la ÚNICA pregunta que hacen el menú, el panel,
     * las pantallas y el middleware ModuloFiscal. Sin fila en estado_tenants (tienda única, sin portal) no hay plan que
     * cercar y todo queda abierto. Los datos fiscales se guardan siempre; el plan solo decide qué se muestra.
     */
    public static function fiscal(): bool
    {
        return static::$estado === null || static::modulo('fiscal');
    }

    /** ¿El vertical (módulo) está activo para esta tienda? Fuente: estado_tenants.modulos. */
    public static function modulo(string $codigo): bool
    {
        return (bool) data_get(static::$estado, 'modulos.'.$codigo, false);
    }

    /** De «la-cava.misitiolibre.com» a «la-cava»; vacío para localhost, IPs y el dominio base. */
    protected static function subdominioDe(string $host): string
    {
        $host = strtolower(preg_replace('/:\d+$/', '', $host));
        $base = strtolower((string) config('saas.base_domain'));
        if ($base !== '' && str_ends_with($host, '.'.$base)) {
            return rtrim(substr($host, 0, -strlen($base)), '.');
        }
        if (filter_var($host, FILTER_VALIDATE_IP) || str_contains($host, 'localhost')) {
            return '';   // desarrollo local: el middleware decide con las tiendas registradas
        }
        $partes = explode('.', $host);

        return count($partes) > 1 ? $partes[0] : '';
    }

    /** El pgsql de Laravel entrega los jsonb como texto: se decodifican una sola vez. */
    protected static function normalizar(array $estado): array
    {
        if (isset($estado['modulos']) && is_string($estado['modulos'])) {
            $estado['modulos'] = json_decode($estado['modulos'], true) ?: [];
        }

        return $estado;
    }
}
