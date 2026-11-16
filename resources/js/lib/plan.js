import { usePage } from '@inertiajs/react';

/**
 * ¿El plan de esta tienda incluye la parte fiscal, contable e ISLR?
 * El servidor comparte `modulo_fiscal` en todas las páginas (HandleInertiaRequests). `null`/ausente = tienda única
 * sin portal: todo visible. Solo `false` oculta. Ocultar aquí es comodidad: el bloqueo real es ModuloFiscal (servidor).
 */
export function useFiscal() {
    return usePage().props.modulo_fiscal !== false;
}
