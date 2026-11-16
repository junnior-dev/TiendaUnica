<?php

namespace App\Support;

/**
 * Cruce automático entre el estado de cuenta del banco y las líneas del libro (cuenta Bancos). Lógica pura: sin base de datos,
 * para poder probarla sola. Los montos se comparan en céntimos enteros (nunca con decimales flotantes).
 *
 * Criterio contable:
 *  1) Uno a uno: mismo monto EXACTO (mismo signo) y fecha del banco dentro de ±$tolerancia días de la fecha del asiento.
 *     La tolerancia existe porque el banco acredita con retraso (fines de semana, feriados, lotes del punto de venta).
 *     Entre varios candidatos gana el de fecha más cercana; a igual cercanía, el asiento más antiguo.
 *  2) Agrupado: una línea del banco que es la suma de varios asientos (el punto de venta deposita el lote del día en un solo abono).
 *     Se prueba con todos los asientos de un mismo día y, si no, con todos los de la ventana de tolerancia.
 * Lo que no cruza queda para emparejar a mano o clasificar (comisión, nota del banco): jamás se «fuerza» una diferencia.
 */
final class Conciliador
{
    /** @return int céntimos */
    public static function centavos(float|int|string $m): int { return (int) round(((float) $m) * 100); }

    private static function dias(string $a, string $b): int { return (int) abs((strtotime($a . ' 12:00:00 UTC') - strtotime($b . ' 12:00:00 UTC')) / 86400); }

    /**
     * @param array<int,array{id:int,fecha:string,monto:float|string}> $banco  líneas del banco SIN cruzar ni clasificar
     * @param array<int,array{id:int,fecha:string,monto:float|string}> $libro  líneas del libro SIN cruzar
     * @return array<int,array{linea_id:int,detalles:int[]}>
     */
    public static function cruzar(array $banco, array $libro, int $tolerancia): array
    {
        usort($banco, fn ($a, $b) => [$a['fecha'], $a['id']] <=> [$b['fecha'], $b['id']]);
        usort($libro, fn ($a, $b) => [$a['fecha'], $a['id']] <=> [$b['fecha'], $b['id']]);
        $usadoLibro = [];
        $hechos = [];
        $pendientes = [];

        foreach ($banco as $b) {                                                  // 1) uno a uno
            $c = self::centavos($b['monto']);
            $mejor = null; $mejorDias = PHP_INT_MAX;
            foreach ($libro as $l) {
                if (isset($usadoLibro[$l['id']]) || self::centavos($l['monto']) !== $c) continue;
                $d = self::dias($b['fecha'], $l['fecha']);
                if ($d <= $tolerancia && $d < $mejorDias) { $mejor = $l; $mejorDias = $d; }
            }
            if ($mejor) { $usadoLibro[$mejor['id']] = true; $hechos[] = ['linea_id' => $b['id'], 'detalles' => [$mejor['id']]]; } else { $pendientes[] = $b; }
        }

        foreach ($pendientes as $b) {                                              // 2) agrupado
            $c = self::centavos($b['monto']);
            $enVentana = array_values(array_filter($libro, fn ($l) => ! isset($usadoLibro[$l['id']]) && self::centavos($l['monto']) * $c > 0 && self::dias($b['fecha'], $l['fecha']) <= $tolerancia));
            if (count($enVentana) < 2) continue;
            $porDia = [];
            foreach ($enVentana as $l) $porDia[$l['fecha']][] = $l;
            $grupo = null;
            foreach ($porDia as $g) if (count($g) > 1 && array_sum(array_map(fn ($l) => self::centavos($l['monto']), $g)) === $c) { $grupo = $g; break; }
            if (! $grupo && array_sum(array_map(fn ($l) => self::centavos($l['monto']), $enVentana)) === $c) $grupo = $enVentana;
            if ($grupo) {
                foreach ($grupo as $l) $usadoLibro[$l['id']] = true;
                $hechos[] = ['linea_id' => $b['id'], 'detalles' => array_map(fn ($l) => $l['id'], $grupo)];
            }
        }
        return $hechos;
    }
}
