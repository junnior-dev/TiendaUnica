<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Puente hacia la BASE DEL PORTAL (portal_saas): el registro comercial de cada
 * tienda. La base del tenant no la conoce — solo esta clase la consulta, con
 * la conexión 'portal' definida en config/database.php (PORTAL_DB_*).
 *
 *   Portal::negocioPortal();   // registro comercial de la tienda activa
 *   Portal::tasa();            // tasa USD→VES publicada por el administrador
 *   Portal::llamar('portal.fn_reportar_pago', [...]);  // llamada con mensaje legible
 */
class Portal
{
    /** Registro comercial de la tienda activa (negocios_portal) o null si aún no existe. */
    public static function negocioPortal(): ?object
    {
        return DB::connection('portal')->table('negocios_portal')
            ->where('db_nombre', DB::connection('pgsql')->getDatabaseName())
            ->where('negocio_id', Tenant::id())
            ->first();
    }

    /** Tasa USD→VES publicada por el administrador del portal (null si no hay). */
    public static function tasa(): ?float
    {
        $v = DB::connection('portal')->table('config')->where('clave', 'tasa_usd_ves')->value('valor');

        return $v !== null ? (float) $v : null;
    }

    /** Llama una función del portal y devuelve su primer valor (o null si es void). */
    public static function llamar(string $fn, array $params): mixed
    {
        // Auditoría B-4: el nombre de función llega interpolado al SQL; exigir el
        // prefijo del esquema evita que una llamada futura con datos del request
        // termine ejecutando otra cosa. Las llamadas válidas son portal.fn_*.
        if (! str_starts_with($fn, 'portal.')) {
            throw new \RuntimeException('Portal::llamar solo admite funciones del esquema portal (portal.fn_*).');
        }
        try {
            $fila = DB::connection('portal')->selectOne("SELECT {$fn}", $params);
            if ($fila === null) {
                return null;
            }

            return array_values((array) $fila)[0];
        } catch (\Illuminate\Database\QueryException $e) {
            preg_match('/ERROR:\s*(.+?)(\n|CONTEXT|\()/s', $e->getMessage(), $m);
            $legible = trim($m[1] ?? 'El portal rechazó la operación.');

            throw new \RuntimeException($legible, 0, $e);
        }
    }

    /** Consulta genérica de una tabla/vista del portal (solo lectura). */
    public static function tabla(string $nombre, \Closure $consulta): mixed
    {
        return $consulta(DB::connection('portal')->table($nombre));
    }
}
