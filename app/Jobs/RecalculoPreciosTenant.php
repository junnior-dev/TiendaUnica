<?php

namespace App\Jobs;

use App\Support\ConTenant;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\DB;

/**
 * Job de ejemplo que trabaja DENTRO de un tenant usando el trait ConTenant
 * (auditoría mejora 9). Es el patrón OBLIGATORIO para cualquier job en cola
 * que toque datos de una tienda: fija el GUC, trabaja y —excepción incluida—
 * deja la conexión neutra.
 *
 * El Pest JobConTenantTest lo despacha con Bus::dispatchSync y comprueba que:
 *   1. dentro del job el GUC es el negocio pedido;
 *   2. al terminar, la conexión compartida queda SIN negocio (neutral);
 *   3. si el trabajo lanza una excepción, la limpieza ocurre igual.
 */
class RecalculoPreciosTenant implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, ConTenant;

    public function __construct(public int $negocioId) {}

    /** Resultado del último handle() (dispatchSync no siempre devuelve el retorno del handler). */
    public array $resultado = [];

    /** Guarda [negocio_visto_en_guc, nombre_del_negocio] y deja la conexión neutra al salir. */
    public function handle(): array
    {
        return $this->resultado = $this->enTenant($this->negocioId, fn (int $negocio) => [
            'guc' => (string) (DB::selectOne('SELECT current_setting(?, true) as v', ['app.negocio_id'])->v ?? ''),
            'negocio' => (string) DB::selectOne('SELECT nombre_comercial FROM negocio WHERE id = ?', [$negocio])->nombre_comercial,
        ]);
    }

    /** Variante que SIEMPRE falla: prueba que el finally limpia aun con excepción. */
    public function handleFallo(): never
    {
        try {
            $this->enTenant($this->negocioId, function (): never {
                throw new \RuntimeException('fallo deliberado dentro del tenant');
            });
        } catch (\RuntimeException $e) {
            throw $e;   // propagación explícita: el fallo SIEMPRE sale del job
        }
        throw new \LogicException('la variante de fallo debe lanzar siempre'); // inalcanzable
    }
}
