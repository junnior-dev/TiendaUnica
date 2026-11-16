<?php

namespace App\Http\Controllers;

use App\Support\Conciliador;
use App\Support\Permisos;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Cruce de cuentas (/conciliacion). Solo administradores. Usa lo que crea database/sql/13_conciliaciones.sql.
 *
 *  A) CONCILIACIÓN BANCARIA — estado de cuenta del banco contra la cuenta Bancos (1.1.02) del libro mayor.
 *     · El archivo (CSV o Excel) se lee en el navegador y llega aquí ya normalizado: fecha, referencia, descripción, monto con signo.
 *     · Cruce automático: monto exacto y fecha dentro de ±N días (por defecto 2: fines de semana y lotes del punto de venta). App\Support\Conciliador.
 *     · Lo que no cruza se empareja a mano o se clasifica (comisión, nota de crédito/débito del banco, interés).
 *     · Acta: saldo libros ajustado = saldo banco ajustado. Solo se cierra si cuadra; cerrada, ya no se modifica.
 *     Solo se LEEN asientos y asiento_detalle. Los ajustes del banco NO generan asiento aquí: salen en el acta como «por registrar en libros».
 *
 *  B) CRUCE FISCAL — lo que el sistema calcula (libros de ventas/compras, retenciones, IGTF) contra lo que la persona declaró en el portal.
 *     El sistema no se conecta al SENIAT: la persona anota los montos de su planilla y aquí se comparan, concepto por concepto, con semáforo.
 *
 * Los métodos de datos son públicos para poder probarlos sin HTTP.
 */
class ConciliacionController extends Controller
{
    use ContextoPagina;

    private const CLASES = ['COMISION' => 'Comisión bancaria', 'NOTA_CREDITO_BANCO' => 'Nota de crédito del banco', 'NOTA_DEBITO_BANCO' => 'Nota de débito del banco', 'INTERES' => 'Intereses', 'OTRO' => 'Otro ajuste'];
    private const MAX_LINEAS = 5000;

    /**
     * Conceptos de cada declaración: [clave, etiqueta, unidad]. Se comparan contra el cálculo del sistema (ver sistemaPeriodo).
     * Las diferencias en Bs son las que suman en el reporte; la base en USD del IGTF es solo informativa.
     */
    public const TIPOS = [
        'FORMA_30' => ['Declaración de IVA (Forma 30)', [
            ['BASE_VENTAS_GRAVADAS', 'Base imponible de ventas gravadas', 'Bs'], ['VENTAS_NO_GRAVADAS', 'Ventas exentas y exoneradas', 'Bs'], ['DEBITO_FISCAL', 'Débito fiscal (IVA de ventas)', 'Bs'],
            ['BASE_COMPRAS', 'Base imponible de compras', 'Bs'], ['CREDITO_FISCAL', 'Crédito fiscal (IVA de compras)', 'Bs'], ['RETENCIONES_SOPORTADAS', 'IVA retenido por tus clientes', 'Bs'],
            ['IVA_A_PAGAR', 'IVA a pagar', 'Bs'], ['EXCEDENTE_CREDITO', 'Excedente de crédito fiscal', 'Bs'],
        ]],
        'RETENCIONES_IVA' => ['Retenciones de IVA enteradas', [['RETENCION_ENTERADA', 'IVA retenido a tus proveedores (a enterar)', 'Bs']]],
        'IGTF' => ['Impuesto a las grandes transacciones financieras (IGTF)', [['BASE_DIVISAS_USD', 'Base: pagos recibidos en divisas', 'USD'], ['IGTF_BS', 'IGTF percibido', 'Bs']]],
    ];

    /* ───────────── infraestructura ───────────── */

    private function soloAdmin(): void
    {
        abort_if(! Permisos::esAdmin(auth()->user()->rol ?? ''), 403, 'Solo un administrador puede conciliar cuentas.');
    }

    private function instalado(): bool
    {
        return (bool) DB::scalar("SELECT to_regclass('conciliaciones_bancarias') IS NOT NULL AND to_regclass('declaraciones_seniat') IS NOT NULL AND to_regprocedure('fn_conciliacion_resumen(bigint)') IS NOT NULL");
    }

    private function mensaje(\Throwable $e, string $porDefecto): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }

    /** Ejecuta una acción: éxito → [cuerpo, 200]; error de la base (reglas de PostgreSQL) → 422 con el mensaje en español. */
    private function intentar(callable $f, string $porDefecto, string $campo = 'general'): array
    {
        try { return $f(); }
        catch (QueryException $e) { $m = $e->getCode() === '23505' ? 'Ese registro ya existe.' : $this->mensaje($e, $porDefecto); return [['message' => $m, 'errors' => [$campo => [$m]]], 422]; }
    }

    private function fallo(string $campo, string $m): array { return [['message' => $m, 'errors' => [$campo => [$m]]], 422]; }

    private function emisor(): array
    {
        $n = DB::selectOne('SELECT razon_social, nombre_comercial, rif, direccion_fiscal, telefono FROM negocio WHERE id = fn_negocio_actual()');
        return ['razon_social' => $n->razon_social ?? '', 'comercial' => $n->nombre_comercial ?? null, 'rif' => $n->rif ?? '', 'direccion' => $n->direccion_fiscal ?? '', 'telefono' => $n->telefono ?? ''];
    }

    private static function f($v): float { return round((float) $v, 2); }

    private function fechaValida(?string $f): bool { return is_string($f) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $f) && checkdate((int) substr($f, 5, 2), (int) substr($f, 8, 2), (int) substr($f, 0, 4)); }

    /* ───────────── página ───────────── */

    public function index(Request $r)
    {
        $this->soloAdmin();
        return Inertia::render('Conciliacion/Index', [...$this->contexto(), ...$this->datosPagina($r->query())]);
    }

    public function datosPagina(array $q): array
    {
        $hoy = DB::scalar('SELECT fn_hoy()');
        $base = ['instalado' => $this->instalado(), 'hoy' => $hoy, 'emisor' => $this->emisor(), 'vista' => ($q['vista'] ?? '') === 'fiscal' ? 'fiscal' : 'bancaria', 'clases' => self::CLASES];
        if (! $base['instalado']) return $base + ['conciliaciones' => [], 'actual' => null, 'fiscal' => null];
        $especial = (bool) DB::scalar('SELECT es_contribuyente_especial FROM negocio WHERE id = fn_negocio_actual()');
        $mes = preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', (string) ($q['mes'] ?? '')) ? $q['mes'] : substr($hoy, 0, 7);
        $per = in_array($q['periodicidad'] ?? '', ['QUINCENAL', 'MENSUAL'], true) ? $q['periodicidad'] : ($especial ? 'QUINCENAL' : 'MENSUAL');
        $qn = in_array((int) ($q['quincena'] ?? 0), [1, 2], true) ? (int) $q['quincena'] : ((int) substr($hoy, 8, 2) > 15 ? 2 : 1);
        $lista = $this->lista();
        $id = (int) ($q['id'] ?? 0);
        $actual = $id && collect($lista)->contains('id', $id) ? $this->detalle($id) : null;
        return $base + ['conciliaciones' => $lista, 'actual' => $actual, 'regimen_especial' => $especial, 'cuenta_bancos' => $this->cuentaBancos(),
            'fiscal' => $base['vista'] === 'fiscal' ? $this->fiscal($mes, $per, $qn) : null, 'mes' => $mes, 'periodicidad' => $per, 'quincena' => $qn];
    }

    private function cuentaBancos(): ?array
    {
        $c = DB::selectOne("SELECT p.id, p.codigo, p.nombre FROM contab_parametros cp JOIN plan_cuentas p ON p.id = cp.cuenta_id WHERE cp.clave = 'BANCOS'");
        return $c ? ['id' => (int) $c->id, 'codigo' => $c->codigo, 'nombre' => $c->nombre] : null;
    }

    private function lista(): array
    {
        return array_map(fn ($c) => [
            'id' => (int) $c->id, 'banco' => $c->banco, 'cuenta_bancaria' => $c->cuenta_bancaria, 'desde' => $c->desde, 'hasta' => $c->hasta, 'estado' => $c->estado,
            'diferencia' => $c->saldo_banco_final === null ? null : self::f($c->diferencia), 'pendientes' => (int) $c->pendientes, 'lineas' => (int) $c->lineas,
        ], DB::select("SELECT c.id, c.banco, c.cuenta_bancaria, c.desde::text, c.hasta::text, c.estado, c.saldo_banco_final, r.diferencia, r.lineas_pendientes AS pendientes, r.lineas_banco AS lineas
                         FROM conciliaciones_bancarias c CROSS JOIN LATERAL fn_conciliacion_resumen(c.id) r ORDER BY c.hasta DESC, c.id DESC LIMIT 60"));
    }

    /* ───────────── A) CONCILIACIÓN BANCARIA ───────────── */

    /** Todo lo que pinta la pantalla de una conciliación: cabecera, cifras del acta, movimientos del banco y asientos del libro por cruzar. */
    public function detalle(int $id): ?array
    {
        $c = DB::selectOne('SELECT c.*, c.desde::text AS desde_t, c.hasta::text AS hasta_t, p.codigo AS cuenta_codigo, p.nombre AS cuenta_nombre FROM conciliaciones_bancarias c JOIN plan_cuentas p ON p.id = c.cuenta_id WHERE c.id = ?', [$id]);
        if (! $c) return null;
        $res = DB::selectOne('SELECT * FROM fn_conciliacion_resumen(?)', [$id]);
        $cruces = [];
        foreach (DB::select('SELECT banco_linea_id, asiento_detalle_id, metodo FROM conciliacion_cruces WHERE conciliacion_id = ?', [$id]) as $k) $cruces[(int) $k->banco_linea_id][] = $k;
        $banco = array_map(function ($l) use ($cruces) {
            $k = $cruces[(int) $l->id] ?? [];
            return ['id' => (int) $l->id, 'fecha' => $l->fecha, 'referencia' => $l->referencia, 'descripcion' => $l->descripcion, 'monto' => self::f($l->monto), 'saldo_banco' => $l->saldo_banco === null ? null : self::f($l->saldo_banco),
                'clase' => $l->clase, 'nota' => $l->nota, 'estado' => $k ? 'CRUZADA' : ($l->clase ? 'AJUSTE' : 'PENDIENTE'), 'metodo' => $k[0]->metodo ?? null, 'asientos' => array_map(fn ($x) => (int) $x->asiento_detalle_id, $k)];
        }, DB::select('SELECT id, fecha::text, referencia, descripcion, monto, saldo_banco, clase, nota FROM conciliacion_banco_lineas WHERE conciliacion_id = ? ORDER BY fecha, id', [$id]));
        $anteriores = array_map(fn ($x) => (int) $x->asiento_detalle_id, $cruces[0] ?? []);
        $libro = array_values(array_map(fn ($l) => [
            'id' => (int) $l->detalle_id, 'fecha' => $l->fecha, 'asiento' => (int) $l->numero_asiento, 'concepto' => $l->concepto, 'glosa' => $l->glosa, 'monto' => self::f($l->monto),
            'estado' => $l->cruzado_aqui ? (in_array((int) $l->detalle_id, $anteriores, true) ? 'ANTERIOR' : 'CRUZADO') : 'SIN_CRUZAR',
        ], array_filter(DB::select('SELECT detalle_id, fecha::text, numero_asiento, concepto, glosa, monto, cruzado_aqui, cruzado_otra FROM fn_conciliacion_libro(?)', [$id]), fn ($l) => ! $l->cruzado_otra)));
        return [
            'id' => (int) $c->id, 'cuenta_id' => (int) $c->cuenta_id, 'cuenta' => $c->cuenta_codigo . ' ' . $c->cuenta_nombre, 'banco' => $c->banco, 'cuenta_bancaria' => $c->cuenta_bancaria, 'desde' => $c->desde_t, 'hasta' => $c->hasta_t,
            'saldo_banco_final' => $c->saldo_banco_final === null ? null : self::f($c->saldo_banco_final), 'tolerancia_dias' => (int) $c->tolerancia_dias, 'folio_inicial' => (int) $c->folio_inicial,
            'archivo' => $c->archivo, 'observaciones' => $c->observaciones, 'estado' => $c->estado, 'cerrada_at' => $c->cerrada_at,
            'resumen' => $this->resumen($res), 'movimientos' => $banco, 'libro' => $libro,
        ];
    }

    private function resumen(object $r): array
    {
        return ['saldo_libros' => self::f($r->saldo_libros), 'ajustes_abonos' => self::f($r->ajustes_abonos), 'ajustes_cargos' => self::f($r->ajustes_cargos), 'saldo_libros_ajustado' => self::f($r->saldo_libros_ajustado),
            'saldo_banco' => $r->saldo_banco === null ? null : self::f($r->saldo_banco), 'depositos_transito' => self::f($r->depositos_transito), 'pagos_transito' => self::f($r->pagos_transito),
            'saldo_banco_ajustado' => $r->saldo_banco_ajustado === null ? null : self::f($r->saldo_banco_ajustado), 'diferencia' => $r->diferencia === null ? null : self::f($r->diferencia),
            'lineas_banco' => (int) $r->lineas_banco, 'lineas_pendientes' => (int) $r->lineas_pendientes, 'monto_pendiente' => self::f($r->monto_pendiente), 'libro_sin_cruzar' => (int) $r->libro_sin_cruzar];
    }

    private function abierta(int $id): ?object
    {
        return DB::selectOne("SELECT * FROM conciliaciones_bancarias WHERE id = ? AND estado = 'BORRADOR'", [$id]);
    }

    public function crear(array $d, int $yo): array
    {
        $banco = trim((string) ($d['banco'] ?? ''));
        if (mb_strlen($banco) < 2 || mb_strlen($banco) > 80) return $this->fallo('banco', 'Escribe el nombre del banco.');
        if (! $this->fechaValida($d['desde'] ?? null)) return $this->fallo('desde', 'Indica la fecha de inicio del estado de cuenta.');
        if (! $this->fechaValida($d['hasta'] ?? null)) return $this->fallo('hasta', 'Indica la fecha de cierre del estado de cuenta.');
        if ($d['hasta'] < $d['desde']) return $this->fallo('hasta', 'La fecha final no puede ser anterior a la inicial.');
        if ((strtotime($d['hasta']) - strtotime($d['desde'])) / 86400 > 366) return $this->fallo('hasta', 'El período no puede pasar de un año.');
        if ($d['hasta'] > DB::scalar('SELECT fn_hoy()')) return $this->fallo('hasta', 'No puedes conciliar un período que aún no termina.');
        $cuentaBancaria = trim((string) ($d['cuenta_bancaria'] ?? '')) ?: null;
        if ($cuentaBancaria !== null && mb_strlen($cuentaBancaria) > 30) return $this->fallo('cuenta_bancaria', 'Usa máximo 30 caracteres (por ejemplo, los últimos 4 dígitos).');
        $tol = (int) ($d['tolerancia_dias'] ?? 2);
        if ($tol < 0 || $tol > 7) return $this->fallo('tolerancia_dias', 'La tolerancia va de 0 a 7 días.');
        return $this->intentar(function () use ($d, $banco, $cuentaBancaria, $tol, $yo) {
            return DB::transaction(function () use ($d, $banco, $cuentaBancaria, $tol, $yo) {
                $cuenta = (int) ($d['cuenta_id'] ?? 0) ?: (int) DB::scalar("SELECT fn_cuenta_param('BANCOS')");
                if (! DB::selectOne("SELECT 1 FROM plan_cuentas WHERE id = ? AND tipo = 'ACTIVO' AND permite_movimiento", [$cuenta])) return $this->fallo('cuenta_id', 'Esa cuenta no puede conciliarse.');
                $solapa = DB::selectOne('SELECT banco, desde::text, hasta::text FROM conciliaciones_bancarias WHERE cuenta_id = ? AND lower(banco) = lower(?) AND COALESCE(cuenta_bancaria, \'\') = COALESCE(?, \'\') AND desde <= ? AND hasta >= ? LIMIT 1',
                    [$cuenta, $banco, $cuentaBancaria, $d['hasta'], $d['desde']]);
                if ($solapa) return $this->fallo('desde', "Ya hay una conciliación de {$solapa->banco} que cubre {$solapa->desde} al {$solapa->hasta}.");
                $id = DB::scalar('INSERT INTO conciliaciones_bancarias (cuenta_id, banco, cuenta_bancaria, desde, hasta, tolerancia_dias, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
                    [$cuenta, $banco, $cuentaBancaria, $d['desde'], $d['hasta'], $tol, $yo ?: null]);
                return [['ok' => true, 'id' => (int) $id, 'conciliacion' => $this->detalle((int) $id)], 200];
            });
        }, 'No se pudo crear la conciliación.');
    }

    public function editar(int $id, array $d): array
    {
        if (! $this->abierta($id)) return $this->fallo('general', 'La conciliación no existe o ya está cerrada.');
        $set = []; $par = [];
        if (array_key_exists('saldo_banco_final', $d)) {
            if ($d['saldo_banco_final'] === null || $d['saldo_banco_final'] === '') { $set[] = 'saldo_banco_final = NULL'; }
            elseif (! is_numeric($d['saldo_banco_final']) || abs((float) $d['saldo_banco_final']) > 1e13) return $this->fallo('saldo_banco_final', 'Escribe el saldo final como número (puede ser negativo).');
            else { $set[] = 'saldo_banco_final = ?'; $par[] = round((float) $d['saldo_banco_final'], 2); }
        }
        if (array_key_exists('tolerancia_dias', $d)) { $t = (int) $d['tolerancia_dias']; if ($t < 0 || $t > 7) return $this->fallo('tolerancia_dias', 'La tolerancia va de 0 a 7 días.'); $set[] = 'tolerancia_dias = ?'; $par[] = $t; }
        if (array_key_exists('folio_inicial', $d)) { $t = (int) $d['folio_inicial']; if ($t < 1) return $this->fallo('folio_inicial', 'El primer folio es 1 o más.'); $set[] = 'folio_inicial = ?'; $par[] = $t; }
        if (array_key_exists('observaciones', $d)) { $set[] = 'observaciones = ?'; $par[] = trim((string) $d['observaciones']) ?: null; }
        if (! $set) return $this->fallo('general', 'No hay nada que cambiar.');
        return $this->intentar(function () use ($id, $set, $par) {
            DB::update('UPDATE conciliaciones_bancarias SET ' . implode(', ', $set) . ' WHERE id = ?', [...$par, $id]);
            return [['ok' => true, 'conciliacion' => $this->detalle($id)], 200];
        }, 'No se pudo guardar.');
    }

    /**
     * Importa el estado de cuenta. Cada línea: {fecha: YYYY-MM-DD, referencia, descripcion, monto, saldo?}. monto: + abono / − cargo.
     * Las líneas fuera del período se descartan y las repetidas (mismo archivo subido otra vez) se ignoran: la huella incluye el número de
     * orden entre líneas idénticas, así dos depósitos iguales el mismo día no se confunden con un duplicado.
     */
    public function importar(int $id, array $d): array
    {
        $c = $this->abierta($id);
        if (! $c) return $this->fallo('general', 'La conciliación no existe o ya está cerrada.');
        $lineas = $d['lineas'] ?? null;
        if (! is_array($lineas) || ! count($lineas)) return $this->fallo('lineas', 'El archivo no trae movimientos.');
        if (count($lineas) > self::MAX_LINEAS) return $this->fallo('lineas', 'El archivo tiene más de ' . self::MAX_LINEAS . ' movimientos: súbelo por períodos más cortos.');
        $desde = DB::scalar('SELECT desde::text FROM conciliaciones_bancarias WHERE id = ?', [$id]); $hasta = DB::scalar('SELECT hasta::text FROM conciliaciones_bancarias WHERE id = ?', [$id]);
        $ok = []; $fuera = 0; $malas = [];
        $vistas = [];
        foreach ($lineas as $i => $l) {
            $n = $i + 1;
            if (! is_array($l) || ! $this->fechaValida($l['fecha'] ?? null)) { $malas[] = "Fila $n: fecha no válida."; continue; }
            if (! isset($l['monto']) || ! is_numeric($l['monto']) || abs((float) $l['monto']) > 1e13) { $malas[] = "Fila $n: monto no válido."; continue; }
            $m = round((float) $l['monto'], 2);
            if ($m == 0.0) continue;                                           // líneas de saldo inicial/final sin movimiento
            if ($l['fecha'] < $desde || $l['fecha'] > $hasta) { $fuera++; continue; }
            $ref = mb_substr(trim((string) ($l['referencia'] ?? '')), 0, 60); $des = mb_substr(trim((string) ($l['descripcion'] ?? '')), 0, 250);
            $clave = $l['fecha'] . '|' . number_format($m, 2, '.', '') . '|' . mb_strtolower($ref) . '|' . mb_strtolower($des);
            $vistas[$clave] = ($vistas[$clave] ?? 0) + 1;
            $saldo = isset($l['saldo']) && is_numeric($l['saldo']) ? round((float) $l['saldo'], 2) : null;
            $ok[] = [$l['fecha'], $ref ?: null, $des ?: null, $m, $saldo, sha1($clave . '|' . $vistas[$clave])];
        }
        if (count($malas) > 0) return [['message' => $malas[0] . (count($malas) > 1 ? ' (y ' . (count($malas) - 1) . ' más)' : ''), 'errors' => ['lineas' => array_slice($malas, 0, 5)]], 422];
        if (! $ok) return $this->fallo('lineas', $fuera ? "Ningún movimiento cae entre el $desde y el $hasta." : 'No hay movimientos con monto.');
        return $this->intentar(function () use ($id, $ok, $fuera, $d) {
            return DB::transaction(function () use ($id, $ok, $fuera, $d) {
                $nuevas = 0;
                foreach (array_chunk($ok, 500) as $lote) {
                    $ph = implode(',', array_fill(0, count($lote), '(?, ?, ?, ?, ?, ?, ?)')); $par = [];
                    foreach ($lote as $x) array_push($par, $id, ...$x);
                    $nuevas += DB::affectingStatement("INSERT INTO conciliacion_banco_lineas (conciliacion_id, fecha, referencia, descripcion, monto, saldo_banco, huella) VALUES $ph ON CONFLICT (conciliacion_id, huella) DO NOTHING", $par);
                }
                if (! empty($d['archivo'])) DB::update('UPDATE conciliaciones_bancarias SET archivo = ? WHERE id = ?', [mb_substr((string) $d['archivo'], 0, 200), $id]);
                if (array_key_exists('saldo_final', $d) && is_numeric($d['saldo_final']) && DB::scalar('SELECT saldo_banco_final IS NULL FROM conciliaciones_bancarias WHERE id = ?', [$id])) {
                    DB::update('UPDATE conciliaciones_bancarias SET saldo_banco_final = ? WHERE id = ?', [round((float) $d['saldo_final'], 2), $id]);
                }
                return [['ok' => true, 'nuevas' => $nuevas, 'repetidas' => count($ok) - $nuevas, 'fuera_periodo' => $fuera, 'conciliacion' => $this->detalle($id)], 200];
            });
        }, 'No se pudo importar el archivo.', 'lineas');
    }

    /** Cruce automático (monto exacto ± días). Solo toca movimientos sin cruzar ni clasificar. */
    public function cruzarAuto(int $id, array $d, int $yo): array
    {
        $c = $this->abierta($id);
        if (! $c) return $this->fallo('general', 'La conciliación no existe o ya está cerrada.');
        $tol = array_key_exists('dias', $d) ? (int) $d['dias'] : (int) $c->tolerancia_dias;
        if ($tol < 0 || $tol > 7) return $this->fallo('dias', 'La tolerancia va de 0 a 7 días.');
        return $this->intentar(function () use ($id, $tol, $yo) {
            return DB::transaction(function () use ($id, $tol, $yo) {
                DB::update('UPDATE conciliaciones_bancarias SET tolerancia_dias = ? WHERE id = ?', [$tol, $id]);
                $banco = array_map(fn ($l) => ['id' => (int) $l->id, 'fecha' => $l->fecha, 'monto' => $l->monto], DB::select(
                    'SELECT l.id, l.fecha::text, l.monto FROM conciliacion_banco_lineas l WHERE l.conciliacion_id = ? AND l.clase IS NULL AND NOT EXISTS (SELECT 1 FROM conciliacion_cruces k WHERE k.banco_linea_id = l.id)', [$id]));
                $libro = array_map(fn ($l) => ['id' => (int) $l->detalle_id, 'fecha' => $l->fecha, 'monto' => $l->monto], DB::select(
                    'SELECT detalle_id, fecha::text, monto FROM fn_conciliacion_libro(?) WHERE NOT cruzado_aqui AND NOT cruzado_otra', [$id]));
                $hechos = Conciliador::cruzar($banco, $libro, $tol);
                foreach ($hechos as $h) DB::select("SELECT fn_cruzar_banco(?, ?, ?::bigint[], 'AUTO', ?)", [$id, $h['linea_id'], '{' . implode(',', $h['detalles']) . '}', $yo ?: null]);
                $asientos = array_sum(array_map(fn ($h) => count($h['detalles']), $hechos));
                return [['ok' => true, 'cruzadas' => count($hechos), 'asientos' => $asientos, 'sin_cruzar' => count($banco) - count($hechos), 'conciliacion' => $this->detalle($id)], 200];
            });
        }, 'No se pudo cruzar.');
    }

    /** Emparejar a mano: una línea del banco con uno o varios asientos. La base de datos exige que las sumas sean iguales. */
    public function cruzarManual(int $id, array $d, int $yo): array
    {
        $linea = (int) ($d['linea_id'] ?? 0); $det = array_values(array_unique(array_map('intval', (array) ($d['asientos'] ?? []))));
        if ($linea < 1) return $this->fallo('linea_id', 'Elige el movimiento del banco.');
        if (! $det || count($det) > 200 || in_array(0, $det, true)) return $this->fallo('asientos', 'Elige al menos un asiento del libro.');
        return $this->intentar(fn () => DB::transaction(function () use ($id, $linea, $det, $yo) {
            DB::select("SELECT fn_cruzar_banco(?, ?, ?::bigint[], 'MANUAL', ?)", [$id, $linea, '{' . implode(',', $det) . '}', $yo ?: null]);
            return [['ok' => true, 'conciliacion' => $this->detalle($id)], 200];
        }), 'No se pudo emparejar.', 'asientos');
    }

    /** Deshacer un emparejamiento: por línea del banco o por asiento marcado «ya conciliado antes». */
    public function descruzar(int $id, array $d): array
    {
        $linea = (int) ($d['linea_id'] ?? 0); $det = (int) ($d['asiento_id'] ?? 0);
        if (! $linea && ! $det) return $this->fallo('general', 'Indica qué emparejamiento deshacer.');
        return $this->intentar(function () use ($id, $linea, $det) {
            $n = $linea ? DB::delete('DELETE FROM conciliacion_cruces WHERE conciliacion_id = ? AND banco_linea_id = ?', [$id, $linea])
                        : DB::delete("DELETE FROM conciliacion_cruces WHERE conciliacion_id = ? AND asiento_detalle_id = ? AND metodo = 'ANTERIOR'", [$id, $det]);
            return $n ? [['ok' => true, 'conciliacion' => $this->detalle($id)], 200] : $this->fallo('general', 'Ese emparejamiento ya no existe.');
        }, 'No se pudo deshacer.');
    }

    /** Clasificar un movimiento del banco que no tiene asiento (comisión, nota del banco…). clase = null lo deja pendiente otra vez. */
    public function clasificar(int $id, array $d): array
    {
        $linea = (int) ($d['linea_id'] ?? 0); $clase = $d['clase'] ?? null;
        if ($linea < 1) return $this->fallo('linea_id', 'Elige el movimiento del banco.');
        if ($clase !== null && ! isset(self::CLASES[$clase])) return $this->fallo('clase', 'Elige el tipo de ajuste.');
        $nota = mb_substr(trim((string) ($d['nota'] ?? '')), 0, 250) ?: null;
        return $this->intentar(function () use ($id, $linea, $clase, $nota) {
            if (DB::selectOne('SELECT 1 FROM conciliacion_cruces WHERE banco_linea_id = ?', [$linea])) return $this->fallo('linea_id', 'Ese movimiento ya está emparejado con un asiento: deshaz el emparejamiento primero.');
            $n = DB::update('UPDATE conciliacion_banco_lineas SET clase = ?, nota = ? WHERE id = ? AND conciliacion_id = ?', [$clase, $clase ? $nota : null, $linea, $id]);
            return $n ? [['ok' => true, 'conciliacion' => $this->detalle($id)], 200] : $this->fallo('linea_id', 'Ese movimiento no pertenece a esta conciliación.');
        }, 'No se pudo clasificar.', 'clase');
    }

    public function marcarAnterior(int $id, array $d, int $yo): array
    {
        $det = array_values(array_unique(array_map('intval', (array) ($d['asientos'] ?? []))));
        if (! $det || count($det) > 500 || in_array(0, $det, true)) return $this->fallo('asientos', 'Elige al menos un asiento del libro.');
        return $this->intentar(fn () => DB::transaction(function () use ($id, $det, $yo) {
            DB::select('SELECT fn_marcar_conciliado_anterior(?, ?::bigint[], ?)', [$id, '{' . implode(',', $det) . '}', $yo ?: null]);
            return [['ok' => true, 'conciliacion' => $this->detalle($id)], 200];
        }), 'No se pudo marcar.', 'asientos');
    }

    public function cerrar(int $id): array
    {
        return $this->intentar(fn () => DB::transaction(function () use ($id) { DB::select('SELECT fn_cerrar_conciliacion(?)', [$id]); return [['ok' => true, 'conciliacion' => $this->detalle($id)], 200]; }), 'No se pudo cerrar la conciliación.');
    }

    public function borrar(int $id): array
    {
        if (! $this->abierta($id)) return $this->fallo('general', 'Solo se pueden borrar conciliaciones sin cerrar.');
        return $this->intentar(fn () => DB::transaction(function () use ($id) {
            DB::delete('DELETE FROM conciliacion_cruces WHERE conciliacion_id = ?', [$id]);
            DB::delete('DELETE FROM conciliacion_banco_lineas WHERE conciliacion_id = ?', [$id]);
            DB::delete('DELETE FROM conciliaciones_bancarias WHERE id = ?', [$id]);
            return [['ok' => true], 200];
        }), 'No se pudo borrar.');
    }

    /**
     * Datos del «Acta de Conciliación Bancaria». Si el acta está cerrada se usa la fotografía guardada al cerrar (lo firmado no cambia);
     * si no, las cifras salen en vivo y el PDF lo marca como borrador.
     */
    public function acta(int $id): ?array
    {
        $d = $this->detalle($id);
        if (! $d) return null;
        $snap = $d['estado'] === 'CERRADA' ? json_decode((string) DB::scalar('SELECT acta FROM conciliaciones_bancarias WHERE id = ?', [$id]), true) : null;
        $resumen = $snap['resumen'] ?? $d['resumen'];
        $resumen = array_map(fn ($v) => is_numeric($v) ? (float) $v : $v, $resumen);
        $ajustes = $snap ? $snap['ajustes'] : array_values(array_filter($d['movimientos'], fn ($l) => $l['estado'] === 'AJUSTE'));
        $transito = $snap ? $snap['transito'] : array_values(array_filter($d['libro'], fn ($l) => $l['estado'] === 'SIN_CRUZAR'));
        $norm = fn ($l) => ['fecha' => $l['fecha'], 'asiento' => (int) ($l['numero_asiento'] ?? $l['asiento'] ?? 0), 'concepto' => $l['concepto'] ?? '', 'monto' => (float) $l['monto']];
        $transito = array_map($norm, $transito);
        $porId = array_column($d['libro'], null, 'id');
        $conciliados = [];
        foreach ($d['movimientos'] as $l) {
            if ($l['estado'] !== 'CRUZADA') continue;
            $conciliados[] = ['fecha' => $l['fecha'], 'referencia' => $l['referencia'], 'descripcion' => $l['descripcion'], 'monto' => $l['monto'], 'metodo' => $l['metodo'],
                'asientos' => array_map(fn ($a) => ['asiento' => $porId[$a]['asiento'] ?? 0, 'fecha' => $porId[$a]['fecha'] ?? null, 'monto' => $porId[$a]['monto'] ?? 0], $l['asientos'])];
        }
        return [
            'emisor' => $this->emisor(), 'conciliacion' => array_diff_key($d, ['movimientos' => 1, 'libro' => 1, 'resumen' => 1]), 'cerrada' => $d['estado'] === 'CERRADA', 'resumen' => $resumen,
            'ajustes' => array_map(fn ($l) => ['fecha' => $l['fecha'], 'referencia' => $l['referencia'], 'descripcion' => $l['descripcion'], 'monto' => (float) $l['monto'], 'clase' => self::CLASES[$l['clase']] ?? $l['clase'], 'nota' => $l['nota']], $ajustes),
            'depositos_transito' => array_values(array_filter($transito, fn ($t) => $t['monto'] > 0)), 'pagos_transito' => array_values(array_filter($transito, fn ($t) => $t['monto'] < 0)),
            'conciliados' => $conciliados, 'anteriores' => count(array_filter($d['libro'], fn ($l) => $l['estado'] === 'ANTERIOR')),
        ];
    }

    /* ───────────── B) CRUCE FISCAL ───────────── */

    /** Períodos entre dos meses: uno por mes, o dos por mes (01–15 y 16–fin) si la periodicidad es quincenal. */
    public function periodos(string $desdeMes, string $hastaMes, string $periodicidad): array
    {
        $out = [];
        for ($t = strtotime("$desdeMes-01"); $t <= strtotime("$hastaMes-01"); $t = strtotime('+1 month', $t)) {
            $m = date('Y-m', $t); $fin = date('Y-m-t', $t);
            if ($periodicidad === 'MENSUAL') { $out[] = ['desde' => "$m-01", 'hasta' => $fin, 'mes' => $m, 'quincena' => null]; continue; }
            $out[] = ['desde' => "$m-01", 'hasta' => "$m-15", 'mes' => $m, 'quincena' => 1];
            $out[] = ['desde' => "$m-16", 'hasta' => $fin, 'mes' => $m, 'quincena' => 2];
        }
        return $out;
    }

    /**
     * Lo que calcula el sistema para el período, en Bs (cada venta con su tasa; compras en USD con la última tasa publicada hasta su fecha).
     * Reutiliza LibrosFiscalesController::quincenal() para que coincida con el Resumen Quincenal. Un mes completo suma sus dos quincenas y el
     * IVA a pagar / excedente se recalcula con los totales del mes (no se suman los resultados de cada quincena: el excedente de una no compensa a la otra).
     * Fuente de cada concepto:
     *   débito = IVA de facturas + notas de débito − notas de crédito · crédito = IVA de compras con derecho a crédito (no anuladas)
     *   retenciones soportadas = comprobantes ACTIVOS que te practicaron tus clientes · retención a enterar = comprobantes ACTIVOS que tú practicaste
     *   IGTF = lo percibido en divisas incluyendo ventas luego anuladas (v_igtf_a_declarar): anular no extingue el impuesto; el reintegro se reclama aparte.
     */
    public function sistemaPeriodo(string $mes, ?int $quincena): array
    {
        $lf = app(LibrosFiscalesController::class);
        $qs = $quincena ? [$lf->quincenal($mes, $quincena)] : [$lf->quincenal($mes, 1), $lf->quincenal($mes, 2)];
        $s = fn (callable $f) => self::f(array_sum(array_map($f, $qs)));
        $deb = $s(fn ($q) => $q['ventas']['iva_debito']); $cred = $s(fn ($q) => $q['compras']['iva_credito']); $suf = $s(fn ($q) => $q['retenciones']['sufridas']);
        $neto = round($deb - $cred - $suf, 2);
        return [
            'BASE_VENTAS_GRAVADAS' => $s(fn ($q) => $q['ventas']['base_gravada']), 'VENTAS_NO_GRAVADAS' => $s(fn ($q) => $q['ventas']['base_exenta'] + $q['ventas']['base_exonerada']),
            'DEBITO_FISCAL' => $deb, 'BASE_COMPRAS' => $s(fn ($q) => $q['compras']['base']), 'CREDITO_FISCAL' => $cred, 'RETENCIONES_SOPORTADAS' => $suf,
            'IVA_A_PAGAR' => max($neto, 0.0), 'EXCEDENTE_CREDITO' => $neto < 0 ? -$neto : 0.0,
            'RETENCION_ENTERADA' => $s(fn ($q) => $q['retenciones']['practicadas']),
            'BASE_DIVISAS_USD' => $s(fn ($q) => $q['igtf']['base_divisas_usd']), 'IGTF_BS' => $s(fn ($q) => $q['igtf']['igtf_ves']),
        ];
    }

    /** Semáforo: ≤ 0,01 cuadra · ≤ 1,00 diferencia por redondeo · más, no cuadra · sin planilla registrada, sin declarar. */
    public static function semaforo(float $sistema, ?float $declarado): array
    {
        if ($declarado === null) return [null, 'SIN_DECLARAR'];
        $dif = round($declarado - $sistema, 2); $a = abs($dif);
        return [$dif, $a <= 0.01 ? 'CUADRA' : ($a <= 1.0 ? 'REDONDEO' : 'NO_CUADRA')];
    }

    /** Comparación de un período: por cada tipo de declaración, concepto por concepto. */
    public function compararPeriodo(array $p, string $periodicidad): array
    {
        $sis = $this->sistemaPeriodo($p['mes'], $p['quincena']);
        $tipos = [];
        foreach (self::TIPOS as $tipo => [$titulo, $conceptos]) {
            $decl = DB::selectOne('SELECT id, numero_planilla, fecha_presentacion::text, observaciones FROM declaraciones_seniat WHERE tipo = ? AND desde = ? AND hasta = ?', [$tipo, $p['desde'], $p['hasta']]);
            $montos = $decl ? array_column(DB::select('SELECT concepto, monto FROM declaraciones_seniat_montos WHERE declaracion_id = ?', [$decl->id]), 'monto', 'concepto') : [];
            $filas = [];
            foreach ($conceptos as [$k, $et, $u]) {
                $dec = isset($montos[$k]) ? self::f($montos[$k]) : null;
                [$dif, $sem] = self::semaforo($sis[$k], $decl ? ($dec ?? 0.0) : null);
                $filas[] = ['concepto' => $k, 'etiqueta' => $et, 'unidad' => $u, 'sistema' => $sis[$k], 'declarado' => $decl ? ($dec ?? 0.0) : null, 'diferencia' => $dif, 'semaforo' => $sem];
            }
            $tipos[] = ['tipo' => $tipo, 'titulo' => $titulo, 'declaracion' => $decl ? ['id' => (int) $decl->id, 'numero_planilla' => $decl->numero_planilla, 'fecha_presentacion' => $decl->fecha_presentacion, 'observaciones' => $decl->observaciones] : null, 'filas' => $filas];
        }
        return ['periodo' => $p + ['periodicidad' => $periodicidad], 'tipos' => $tipos];
    }

    /** Pantalla: el período elegido comparado, con el conteo de semáforos y las últimas declaraciones registradas. */
    public function fiscal(string $mes, string $periodicidad, int $quincena): array
    {
        $p = $this->periodos($mes, $mes, $periodicidad);
        $p = $periodicidad === 'QUINCENAL' ? $p[$quincena - 1] : $p[0];
        $c = $this->compararPeriodo($p, $periodicidad);
        $n = ['CUADRA' => 0, 'REDONDEO' => 0, 'NO_CUADRA' => 0, 'SIN_DECLARAR' => 0];
        foreach ($c['tipos'] as $t) $n[$t['declaracion'] ? $this->peor($t['filas']) : 'SIN_DECLARAR']++;
        return $c + ['resumen' => $n, 'historial' => array_map(fn ($h) => ['id' => (int) $h->id, 'tipo' => $h->tipo, 'periodicidad' => $h->periodicidad, 'desde' => $h->desde, 'hasta' => $h->hasta, 'numero_planilla' => $h->numero_planilla], DB::select(
            'SELECT id, tipo, periodicidad, desde::text, hasta::text, numero_planilla FROM declaraciones_seniat ORDER BY hasta DESC, id DESC LIMIT 12'))];
    }

    private function peor(array $filas): string
    {
        $orden = ['CUADRA' => 0, 'REDONDEO' => 1, 'NO_CUADRA' => 2];
        $p = 'CUADRA';
        foreach ($filas as $f) if (($orden[$f['semaforo']] ?? 0) > $orden[$p]) $p = $f['semaforo'];
        return $p;
    }

    /** Guarda (o reemplaza) lo declarado de un tipo y período. Un solo registro vigente por tipo y período. */
    public function guardarDeclaracion(array $d, int $yo): array
    {
        $tipo = $d['tipo'] ?? '';
        if (! isset(self::TIPOS[$tipo])) return $this->fallo('tipo', 'Elige qué declaración vas a registrar.');
        $per = $d['periodicidad'] ?? '';
        if (! in_array($per, ['QUINCENAL', 'MENSUAL'], true)) return $this->fallo('periodicidad', 'Elige si la declaración es quincenal o mensual.');
        if (! preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', (string) ($d['mes'] ?? ''))) return $this->fallo('mes', 'Elige el mes.');
        $quincena = $per === 'QUINCENAL' ? (int) ($d['quincena'] ?? 0) : null;
        if ($per === 'QUINCENAL' && ! in_array($quincena, [1, 2], true)) return $this->fallo('quincena', 'Elige la quincena.');
        $p = $this->periodos($d['mes'], $d['mes'], $per); $p = $per === 'QUINCENAL' ? $p[$quincena - 1] : $p[0];
        if ($p['hasta'] > DB::scalar('SELECT fn_hoy()')) return $this->fallo('mes', 'Ese período aún no termina: no hay nada que declarar todavía.');
        $permitidos = array_column(self::TIPOS[$tipo][1], 0);
        $montos = [];
        foreach ((array) ($d['montos'] ?? []) as $k => $v) {
            if (! in_array($k, $permitidos, true)) return $this->fallo('montos', "El concepto $k no corresponde a esta declaración.");
            if ($v === null || $v === '') continue;
            if (! is_numeric($v) || (float) $v < 0 || (float) $v > 1e13) return $this->fallo("montos.$k", 'Escribe un monto de 0 en adelante.');
            $montos[$k] = round((float) $v, 2);
        }
        if (! $montos) return $this->fallo('montos', 'Escribe al menos un monto de la planilla.');
        $fp = $d['fecha_presentacion'] ?? null;
        if ($fp !== null && $fp !== '' && (! $this->fechaValida($fp) || $fp < $p['desde'])) return $this->fallo('fecha_presentacion', 'La fecha de presentación no es válida para ese período.');
        $planilla = mb_substr(trim((string) ($d['numero_planilla'] ?? '')), 0, 40) ?: null;
        $obs = trim((string) ($d['observaciones'] ?? '')) ?: null;
        return $this->intentar(fn () => DB::transaction(function () use ($tipo, $per, $p, $planilla, $fp, $obs, $montos, $yo) {
            $id = DB::scalar('INSERT INTO declaraciones_seniat (tipo, periodicidad, desde, hasta, numero_planilla, fecha_presentacion, observaciones, usuario_id)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                              ON CONFLICT (tipo, desde, hasta) DO UPDATE SET periodicidad = EXCLUDED.periodicidad, numero_planilla = EXCLUDED.numero_planilla, fecha_presentacion = EXCLUDED.fecha_presentacion,
                                  observaciones = EXCLUDED.observaciones, usuario_id = EXCLUDED.usuario_id, updated_at = now() RETURNING id',
                [$tipo, $per, $p['desde'], $p['hasta'], $planilla, $fp ?: null, $obs, $yo ?: null]);
            DB::delete('DELETE FROM declaraciones_seniat_montos WHERE declaracion_id = ?', [$id]);
            foreach ($montos as $k => $v) DB::insert('INSERT INTO declaraciones_seniat_montos (declaracion_id, concepto, monto) VALUES (?, ?, ?)', [$id, $k, $v]);
            return [['ok' => true, 'id' => (int) $id, 'fiscal' => $this->fiscal($p['mes'], $per, $p['quincena'] ?? 1)], 200];
        }), 'No se pudo guardar la declaración.');
    }

    public function borrarDeclaracion(int $id): array
    {
        $d = DB::selectOne('SELECT periodicidad, desde::text, hasta::text FROM declaraciones_seniat WHERE id = ?', [$id]);
        if (! $d) return $this->fallo('general', 'Esa declaración ya no existe.');
        return $this->intentar(function () use ($id, $d) {
            DB::delete('DELETE FROM declaraciones_seniat WHERE id = ?', [$id]);          // los montos se van por ON DELETE CASCADE
            return [['ok' => true, 'fiscal' => $this->fiscal(substr($d->desde, 0, 7), $d->periodicidad, (int) substr($d->desde, 8, 2) > 15 ? 2 : 1)], 200];
        }, 'No se pudo borrar.');
    }

    /** Datos del «Reporte de Conciliación Fiscal»: todos los períodos entre dos meses (máx. 12), en el orden en que se declaran. */
    public function reporteFiscal(string $desdeMes, string $hastaMes, string $periodicidad): array
    {
        $hoyMes = substr(DB::scalar('SELECT fn_hoy()'), 0, 7);
        if ($hastaMes > $hoyMes) $hastaMes = $hoyMes;
        if ($desdeMes > $hastaMes) $desdeMes = $hastaMes;
        if ((((int) substr($hastaMes, 0, 4)) * 12 + (int) substr($hastaMes, 5, 2)) - (((int) substr($desdeMes, 0, 4)) * 12 + (int) substr($desdeMes, 5, 2)) > 11) {
            $t = strtotime("$hastaMes-01 -11 months"); $desdeMes = date('Y-m', $t);
        }
        $hoy = DB::scalar('SELECT fn_hoy()');
        $periodos = array_values(array_filter($this->periodos($desdeMes, $hastaMes, $periodicidad), fn ($p) => $p['hasta'] <= $hoy));
        $items = array_map(fn ($p) => $this->compararPeriodo($p, $periodicidad), $periodos);
        $n = ['CUADRA' => 0, 'REDONDEO' => 0, 'NO_CUADRA' => 0, 'SIN_DECLARAR' => 0];
        foreach ($items as $it) foreach ($it['tipos'] as $t) $n[$t['declaracion'] ? $this->peor($t['filas']) : 'SIN_DECLARAR']++;
        return ['emisor' => $this->emisor(), 'desde_mes' => $desdeMes, 'hasta_mes' => $hastaMes, 'periodicidad' => $periodicidad, 'regimen_especial' => (bool) DB::scalar('SELECT es_contribuyente_especial FROM negocio WHERE id = fn_negocio_actual()'),
            'periodos' => $items, 'resumen' => $n];
    }

    /* ───────────── HTTP ───────────── */

    private function json(array $t) { return response()->json($t[0], $t[1]); }
    private function yo(): int { return (int) auth()->id(); }

    public function bancariaStore(Request $r) { $this->soloAdmin(); return $this->json($this->crear($r->all(), $this->yo())); }
    public function bancariaVer(int $id) { $this->soloAdmin(); $d = $this->detalle($id); return $d ? response()->json($d) : response()->json(['message' => 'Esa conciliación no existe.'], 404); }
    public function bancariaUpdate(Request $r, int $id) { $this->soloAdmin(); return $this->json($this->editar($id, $r->all())); }
    public function bancariaImportar(Request $r, int $id) { $this->soloAdmin(); return $this->json($this->importar($id, $r->all())); }
    public function bancariaAuto(Request $r, int $id) { $this->soloAdmin(); return $this->json($this->cruzarAuto($id, $r->all(), $this->yo())); }
    public function bancariaCruzar(Request $r, int $id) { $this->soloAdmin(); return $this->json($this->cruzarManual($id, $r->all(), $this->yo())); }
    public function bancariaDescruzar(Request $r, int $id) { $this->soloAdmin(); return $this->json($this->descruzar($id, $r->all())); }
    public function bancariaClasificar(Request $r, int $id) { $this->soloAdmin(); return $this->json($this->clasificar($id, $r->all())); }
    public function bancariaAnterior(Request $r, int $id) { $this->soloAdmin(); return $this->json($this->marcarAnterior($id, $r->all(), $this->yo())); }
    public function bancariaCerrar(int $id) { $this->soloAdmin(); return $this->json($this->cerrar($id)); }
    public function bancariaBorrar(int $id) { $this->soloAdmin(); return $this->json($this->borrar($id)); }
    public function bancariaActa(int $id) { $this->soloAdmin(); $a = $this->acta($id); return $a ? response()->json($a) : response()->json(['message' => 'Esa conciliación no existe.'], 404); }

    public function fiscalVer(Request $r)
    {
        $this->soloAdmin();
        $q = $this->datosPagina(['vista' => 'fiscal'] + $r->query());
        return response()->json($q['fiscal']);
    }
    public function fiscalStore(Request $r) { $this->soloAdmin(); return $this->json($this->guardarDeclaracion($r->all(), $this->yo())); }
    public function fiscalBorrar(int $id) { $this->soloAdmin(); return $this->json($this->borrarDeclaracion($id)); }
    public function fiscalReporte(Request $r)
    {
        $this->soloAdmin();
        $hoyMes = substr(DB::scalar('SELECT fn_hoy()'), 0, 7);
        $re = '/^\d{4}-(0[1-9]|1[0-2])$/';
        $hasta = preg_match($re, (string) $r->query('hasta')) ? $r->query('hasta') : $hoyMes;
        $desde = preg_match($re, (string) $r->query('desde')) ? $r->query('desde') : $hasta;
        $per = in_array($r->query('periodicidad'), ['QUINCENAL', 'MENSUAL'], true) ? $r->query('periodicidad') : 'MENSUAL';
        return response()->json($this->reporteFiscal($desde, $hasta, $per));
    }
}
