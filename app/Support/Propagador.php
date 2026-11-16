<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Propagador: lleva el veredicto del PORTAL (plan, mora, suspensión) a cada tienda.
 *
 * El portal (base portal_saas) decide; la tienda solo lo lee de tienda.estado_tenants:
 *   · activo  → false si el portal la tiene SUSPENDIDA o CANCELADA (MORA sigue activa durante la gracia).
 *   · plan    → nombre del plan (SISTEMA / ESPECIAL / DEMO).
 *   · modulos → solo se toca la llave «fiscal»; los demás módulos de la tienda se respetan.
 * Escribe con la conexión 'pgsql_admin' porque el usuario normal de la app solo lee esa tabla.
 * Es idempotente: solo actualiza las filas que cambian y se puede repetir sin riesgo.
 */
class Propagador
{
    /** Aplica el veredicto a las tiendas de ESTA base (o solo a una). Devuelve cuántas filas cambiaron. */
    public static function aplicar(?int $negocioPortalId = null): int
    {
        $q = DB::connection('portal')->table('v_propagacion')
            ->where('db_nombre', DB::connection('pgsql')->getDatabaseName());
        if ($negocioPortalId !== null) {
            $q->where('negocio_portal_id', $negocioPortalId);
        }
        $cambiadas = 0;
        foreach ($q->get() as $f) {
            $cambiadas += DB::connection('pgsql_admin')->update(
                "UPDATE estado_tenants
                    SET plan = ?,
                        activo = ?::boolean,
                        modulos = jsonb_set(COALESCE(modulos, '{}'::jsonb), '{fiscal}', to_jsonb(?::boolean)),
                        suspendida_en = CASE WHEN ?::boolean THEN NULL ELSE COALESCE(suspendida_en, now()) END,
                        motivo = CASE WHEN ?::boolean THEN NULL ELSE ? END
                  WHERE negocio_id = ?
                    AND (plan IS DISTINCT FROM ?
                         OR activo IS DISTINCT FROM ?::boolean
                         OR (modulos ->> 'fiscal') IS DISTINCT FROM (?::boolean)::text)",
                [
                    $f->plan, self::b($f->activo), self::b($f->fiscal),
                    self::b($f->activo), self::b($f->activo), 'Portal: '.$f->estado,
                    $f->negocio_id,
                    $f->plan, self::b($f->activo), self::b($f->fiscal),
                ]
            );
        }

        return $cambiadas;
    }

    /** Igual que aplicar(), pero sin lanzar: devuelve el mensaje de error (o null si todo salió bien). */
    public static function intentar(): ?string
    {
        try {
            self::aplicar();

            return null;
        } catch (\Throwable $e) {
            Log::error('Propagador: '.$e->getMessage());

            return 'La decisión quedó guardada en el portal, pero no se pudo aplicar en la tienda. '
                .'Se reintenta sola en unos minutos (o corre «php artisan portal:propagar»).';
        }
    }

    private static function b($v): string
    {
        return $v ? 'true' : 'false';
    }
}
