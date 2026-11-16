<?php

namespace App\Support;

/**
 * Auditoría (mejora 9) · trait para JOBS y comandos que tocan datos de tenant.
 *
 * El middleware IdentificarTenant limpia el GUC en el ciclo HTTP; los jobs en
 * cola y los comandos artisan NO pasan por él. Todo trabajo que sepa de qué
 * tienda habla DEBE ejecutarse dentro de enTenant(), que fija app.negocio_id,
 * corre el trabajo y —excepción incluida— deja la conexión neutra para la
 * siguiente tarea del mismo worker (pool pgBouncer/Octane/queue:work).
 *
 * Uso en un job:
 *   public function handle(): void {
 *       $this->enTenant($this->negocioId, function (int $negocio) {
 *           ... SQL del tenant ...
 *       });
 *   }
 */
trait ConTenant
{
    /**
     * @param  int  $negocioId  Tienda sobre la que opera el trabajo.
     * @param  callable(int): mixed  $trabajo  Recibe el id del negocio activo.
     */
    protected function enTenant(int $negocioId, callable $trabajo): mixed
    {
        return Tenant::ejecutar($negocioId, $trabajo);
    }
}
