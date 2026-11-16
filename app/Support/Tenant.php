<?php

namespace App\Support;

/**
 * Tienda única: el negocio siempre es 1.
 *
 * Se mantiene la clase por compatibilidad con el código existente
 * que llama a Tenant::id(), Tenant::fiscal(), etc.
 */
class Tenant
{
    /**
     * En tienda única siempre devuelve 1.
     */
    public static function id(): int
    {
        return 1;
    }

    /**
     * Todos los módulos activos en tienda única.
     */
    public static function modulo(string $codigo): bool
    {
        return true;
    }

    /**
     * Parte fiscal siempre activa en tienda única.
     */
    public static function fiscal(): bool
    {
        return true;
    }

    /**
     * Sin control de edición global en tienda única.
     */
    public static function editarGlobal(): bool
    {
        return true;
    }

    /**
     * No hace falta fijar el GUC en tienda única.
     * Se mantiene por compatibilidad con jobs en cola.
     */
    public static function fijar(int $negocioId = 1, array $estado = []): int
    {
        return 1;
    }

    /**
     * No hace falta limpiar en tienda única.
     */
    public static function limpiar(): void
    {
        // Nada que limpiar
    }

    /**
     * Resolver el tenant desde el host.
     * En tienda única no hace nada, pero se mantiene por compatibilidad.
     */
    public static function resolver(string $host): int
    {
        return 1;
    }

    /**
     * Ejecutar un trabajo sin cambio de contexto.
     */
    public static function ejecutar(int $negocioId, callable $trabajo): mixed
    {
        return $trabajo(1);
    }

    /**
     * Estado del tenant (vacío en tienda única).
     */
    public static function estado(): ?array
    {
        return null;
    }
}
