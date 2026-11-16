<?php

namespace App\Support;

/**
 * Consultas del panel del super administrador del portal: filtros, orden y paginación EN EL SERVIDOR, para que el
 * panel aguante cientos de tiendas sin cargarlas todas. Es PHP puro (sin Laravel): cada método devuelve SQL con
 * parámetros posicionales, de modo que tests/portal/consultas.php los pasa por PostgreSQL contra el esquema real.
 *
 * Todo lo que llega del navegador (orden, estado, plan, página, tamaño) se valida contra listas blancas; el texto
 * de búsqueda va siempre como parámetro y con los comodines de LIKE escapados.
 */
class PortalConsultas
{
    public const ESTADOS = ['PRUEBA', 'ACTIVO', 'MORA', 'SUSPENDIDO', 'CANCELADO'];
    public const TAMANOS = [10, 25, 50];
    public const ORDENES = [
        'atencion' => "CASE np.estado WHEN 'MORA' THEN 0 WHEN 'SUSPENDIDO' THEN 1 WHEN 'PRUEBA' THEN 2 WHEN 'ACTIVO' THEN 3 ELSE 4 END, np.vence_el NULLS LAST",
        'vence' => 'np.vence_el NULLS LAST',
        'recientes' => 'np.creado_en DESC',
        'nombre' => 'np.subdominio',
    ];

    /** Texto de búsqueda → patrón ILIKE seguro (escapa % _ y \). */
    public static function like(?string $q): ?string
    {
        $q = trim((string) $q);

        return $q === '' ? null : '%'.addcslashes(mb_substr($q, 0, 80), '%_\\').'%';
    }

    public static function por($v): int
    {
        return in_array((int) $v, self::TAMANOS, true) ? (int) $v : self::TAMANOS[0];
    }

    public static function pagina($v): int
    {
        return max(1, min(100000, (int) $v));
    }

    /** Metadatos de paginación con la misma forma que usan las demás pantallas (Ventas, Productos…). */
    public static function meta(int $total, int $pagina, int $por): array
    {
        $paginas = max(1, (int) ceil($total / $por));

        return ['pagina' => min($pagina, $paginas), 'por_pagina' => $por, 'total' => $total, 'paginas' => $paginas];
    }

    /** @return array{0:string,1:array} condiciones WHERE (sin la palabra WHERE) y sus parámetros */
    private static function unir(array $conds, array $binds): array
    {
        return [$conds ? implode(' AND ', $conds) : 'TRUE', $binds];
    }

    // ── Tiendas ──────────────────────────────────────────────────────────────────────────────────
    public static function tiendas(array $f, int $pagina, int $por): array
    {
        $conds = []; $b = [];
        if (($like = self::like($f['q'] ?? null)) !== null) {
            $conds[] = "(np.subdominio ILIKE ? OR COALESCE(np.correo_facturacion, '') ILIKE ?)";
            array_push($b, $like, $like);
        }
        if (in_array($f['estado'] ?? '', self::ESTADOS, true)) {
            $conds[] = 'np.estado = ?'; $b[] = $f['estado'];
        }
        if ((int) ($f['plan'] ?? 0) > 0) {
            $conds[] = 'np.plan_id = ?'; $b[] = (int) $f['plan'];
        }
        [$where, $b] = self::unir($conds, $b);
        $orden = self::ORDENES[$f['orden'] ?? ''] ?? self::ORDENES['atencion'];
        $desde = 'FROM portal.negocios_portal np JOIN portal.planes pl ON pl.id = np.plan_id WHERE '.$where;

        return [
            'filas' => ["SELECT np.id, np.subdominio, np.negocio_id, np.estado, np.vence_el, np.correo_facturacion, np.creado_en,
                                pl.nombre AS plan, pl.precio_usd::float AS precio_usd, (np.vence_el - CURRENT_DATE) AS dias
                         $desde ORDER BY $orden, np.id LIMIT ? OFFSET ?", array_merge($b, [$por, ($pagina - 1) * $por])],
            'total' => ["SELECT COUNT(*) AS n $desde", $b],
        ];
    }

    /** Cuántas tiendas hay por estado (para los botones de filtro) y por plan. */
    public static function conteos(): array
    {
        return [
            'estados' => 'SELECT estado, COUNT(*)::int AS n FROM portal.negocios_portal GROUP BY estado',
            'planes' => 'SELECT pl.id, pl.nombre, pl.precio_usd::float AS precio_usd, COUNT(np.id)::int AS n
                         FROM portal.planes pl LEFT JOIN portal.negocios_portal np ON np.plan_id = pl.id GROUP BY pl.id ORDER BY pl.precio_usd, pl.id',
        ];
    }

    /** Tiendas al día o en demo cuyo plazo vence en los próximos N días (o ya vencido): lo que hay que cobrar. */
    public static function porVencer(int $dias = 7, int $limite = 6): array
    {
        return ["SELECT np.id, np.subdominio, np.estado, np.vence_el, pl.nombre AS plan, pl.precio_usd::float AS precio_usd, (np.vence_el - CURRENT_DATE) AS dias
                 FROM portal.negocios_portal np JOIN portal.planes pl ON pl.id = np.plan_id
                 WHERE np.estado IN ('ACTIVO', 'PRUEBA', 'MORA') AND np.vence_el IS NOT NULL AND np.vence_el <= CURRENT_DATE + ?::int
                 ORDER BY np.vence_el, np.id LIMIT ?", [max(0, $dias), $limite]];
    }

    // ── Pagos reportados: historial ──────────────────────────────────────────────────────────────
    public static function historial(array $f, int $pagina, int $por): array
    {
        $conds = ["s.estado IN ('VERIFICADO', 'RECHAZADO')"]; $b = [];
        if (in_array($f['resultado'] ?? '', ['VERIFICADO', 'RECHAZADO'], true)) {
            $conds[] = 's.estado = ?'; $b[] = $f['resultado'];
        }
        if (($like = self::like($f['q'] ?? null)) !== null) {
            $conds[] = '(n.subdominio ILIKE ? OR s.referencia ILIKE ? OR s.banco_origen ILIKE ?)';
            array_push($b, $like, $like, $like);
        }
        [$where, $b] = self::unir($conds, $b);
        $desde = 'FROM portal.solicitudes_pago s JOIN portal.negocios_portal n ON n.id = s.negocio_portal_id JOIN portal.planes pl ON pl.id = n.plan_id WHERE '.$where;

        return [
            'filas' => ["SELECT s.id, n.subdominio, pl.nombre AS plan, s.periodo, s.moneda, s.monto_usd::float AS monto_usd, s.monto_bs::float AS monto_bs,
                                s.tasa_aplicada::float AS tasa_aplicada, s.banco_origen, s.referencia, s.pagado_el, s.estado, s.verificado_en, s.rechazo_motivo
                         $desde ORDER BY COALESCE(s.verificado_en, s.creado_en) DESC, s.id DESC LIMIT ? OFFSET ?", array_merge($b, [$por, ($pagina - 1) * $por])],
            'total' => ["SELECT COUNT(*) AS n $desde", $b],
        ];
    }

    // ── Cobros registrados ───────────────────────────────────────────────────────────────────────
    public static function cobros(array $f, int $pagina, int $por): array
    {
        $conds = []; $b = [];
        if (($like = self::like($f['q'] ?? null)) !== null) {
            $conds[] = "(n.subdominio ILIKE ? OR COALESCE(c.metodo, '') ILIKE ? OR COALESCE(c.nota, '') ILIKE ?)";
            array_push($b, $like, $like, $like);
        }
        [$where, $b] = self::unir($conds, $b);
        $desde = 'FROM portal.cobros c JOIN portal.negocios_portal n ON n.id = c.negocio_portal_id WHERE '.$where;

        return [
            'filas' => ["SELECT c.id, n.subdominio, c.periodo, c.monto::float AS monto, c.moneda, c.metodo, c.nota, c.pagado_el
                         $desde ORDER BY c.periodo DESC, c.id DESC LIMIT ? OFFSET ?", array_merge($b, [$por, ($pagina - 1) * $por])],
            'total' => ["SELECT COUNT(*) AS n, COALESCE(SUM(c.monto), 0)::float AS suma $desde", $b],
        ];
    }
}
