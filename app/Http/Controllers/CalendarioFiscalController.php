<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Calendario fiscal (database/sql/21 y 22). El administrador carga y edita las fechas de cada año (el SENIAT publica un calendario nuevo
 * cada año) y marca «ya la presenté». El sistema no se conecta al portal del SENIAT. Todas las reglas viven en PostgreSQL; aquí solo
 * se valida el formato y se traducen los errores. Solo administrador (AccesoPorRol + Permisos: módulo «fiscal»).
 */
class CalendarioFiscalController extends Controller
{
    use ContextoPagina;

    private const PERIODOS = ['QUINCENA', 'MES', 'ANIO', 'OTRO'];

    private static function paramGuardado(): bool
    {
        return (bool) DB::scalar("SELECT to_regproc('fn_calendario_guardar') IS NOT NULL AND to_regclass('calendario_obligaciones') IS NOT NULL");
    }

    /** Próximos vencimientos del negocio (o [] si no hay fechas para su régimen y dígito, o falta el SQL 21). Lo usa el Panel. */
    public static function proximos(int $limite = 5): array
    {
        if (!DB::scalar("SELECT to_regproc('fn_proximos_vencimientos') IS NOT NULL")) return [];
        return array_map(fn ($v) => [
            'obligacion' => $v->obligacion, 'titulo' => $v->titulo, 'tipo' => $v->tipo_periodo ?? ($v->obligacion === 'IVA' ? 'QUINCENA' : 'MES'),
            'desde' => $v->periodo_desde, 'hasta' => $v->periodo_hasta, 'fecha' => $v->fecha_limite,
            'dias' => (int) $v->dias, 'presentada' => (bool) $v->presentada, 'presentada_en' => $v->presentada_en,
        ], DB::select('SELECT * FROM fn_proximos_vencimientos(NULL, ?)', [$limite]));
    }

    private function mensaje(QueryException $e, string $porDefecto): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }

    public function index(Request $r)
    {
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $instalado = self::paramGuardado();
        $base = $this->contexto() + ['hoy' => $hoy, 'instalado' => $instalado];
        if (!$instalado) return Inertia::render('CalendarioFiscal/Index', $base + ['anio' => (int) substr($hoy, 0, 4)]);

        $anio = (int) $r->query('anio', substr($hoy, 0, 4));
        if ($anio < 2020 || $anio > 2100) $anio = (int) substr($hoy, 0, 4);
        $reg = in_array($r->query('reg'), ['ESPECIAL', 'ORDINARIO'], true) ? $r->query('reg') : (string) DB::scalar('SELECT fn_regimen_calendario()');
        $obl = (string) $r->query('obl', '');
        $dig = $r->query('dig', '') === '' ? null : max(0, min(9, (int) $r->query('dig')));

        $negocio = DB::selectOne('SELECT fn_digito_rif_negocio() AS digito, fn_regimen_calendario() AS regimen, (SELECT rif FROM negocio LIMIT 1) AS rif');
        $anios = collect(DB::select('SELECT DISTINCT extract(year FROM fecha_limite)::int AS a FROM calendario_fiscal'))->pluck('a')
            ->push((int) substr($hoy, 0, 4))->push((int) substr($hoy, 0, 4) + 1)->unique()->sort()->values();

        $filtro = ['extract(year FROM c.fecha_limite) = ?', 'c.regimen = ?']; $args = [$anio, $reg];
        if ($obl !== '') { $filtro[] = 'c.obligacion = ?'; $args[] = $obl; }
        if ($dig !== null) { $filtro[] = 'c.digito = ?'; $args[] = $dig; }
        $total = (int) DB::scalar('SELECT count(*) FROM calendario_fiscal c WHERE ' . implode(' AND ', $filtro), $args);
        $filas = DB::select('SELECT c.*, o.titulo FROM calendario_fiscal c JOIN calendario_obligaciones o ON o.codigo = c.obligacion WHERE ' . implode(' AND ', $filtro)
            . ' ORDER BY c.fecha_limite, o.orden, c.digito LIMIT 400', $args);

        return Inertia::render('CalendarioFiscal/Index', $base + [
            'anio' => $anio, 'anios' => $anios,
            'mi' => ['digito' => $negocio->digito !== null ? (int) $negocio->digito : null, 'regimen' => $negocio->regimen, 'rif' => $negocio->rif],
            'calendario' => array_map(fn ($v) => [
                'obligacion' => $v->obligacion, 'titulo' => $v->titulo, 'tipo' => $v->tipo_periodo, 'desde' => $v->periodo_desde, 'hasta' => $v->periodo_hasta, 'fecha' => $v->fecha_limite,
                'dias' => (int) $v->dias, 'presentada' => (bool) $v->presentada, 'presentada_en' => $v->presentada_en, 'referencia' => $v->referencia, 'fuente' => $v->fuente,
            ], DB::select('SELECT * FROM fn_calendario_negocio(?)', [$anio])),
            'obligaciones' => DB::table('calendario_obligaciones')->where('activa', true)->orderBy('orden')->get(['codigo', 'titulo', 'periodo']),
            'admin' => [
                'reg' => $reg, 'obl' => $obl, 'dig' => $dig, 'total' => $total,
                'filas' => array_map(fn ($c) => ['regimen' => $c->regimen, 'obligacion' => $c->obligacion, 'titulo' => $c->titulo, 'digito' => (int) $c->digito,
                    'desde' => $c->periodo_desde, 'hasta' => $c->periodo_hasta, 'fecha' => $c->fecha_limite, 'fuente' => $c->fuente], $filas),
            ],
        ]);
    }

    public function marcar(Request $r)
    {
        $d = $r->validate(['obligacion' => 'required|string|max:20', 'desde' => 'required|date_format:Y-m-d', 'fecha' => 'required|date_format:Y-m-d', 'referencia' => 'nullable|string|max:60']);
        try { DB::statement('SELECT fn_marcar_presentada(?::text, ?::date, ?::date, ?::text, ?::bigint)', [$d['obligacion'], $d['desde'], $d['fecha'], $d['referencia'] ?? null, auth()->id()]); }
        catch (QueryException $e) { return response()->json(['message' => $this->mensaje($e, 'No se pudo marcar.')], 422); }
        return response()->json(['ok' => true, 'vencimientos' => self::proximos(5)]);
    }

    public function desmarcar(Request $r)
    {
        $d = $r->validate(['obligacion' => 'required|string|max:20', 'desde' => 'required|date_format:Y-m-d']);
        DB::statement('SELECT fn_desmarcar_presentada(?::text, ?::date)', [$d['obligacion'], $d['desde']]);
        return response()->json(['ok' => true, 'vencimientos' => self::proximos(5)]);
    }

    /** Una fecha: la crea o la corrige. «digito» puede ser 0–9 o «todos» (misma fecha para los diez dígitos, como en un ordinario). */
    public function guardar(Request $r)
    {
        if (!self::paramGuardado()) return response()->json(['message' => 'Falta instalar el SQL 22.'], 422);
        $d = $r->validate([
            'regimen' => 'required|in:ESPECIAL,ORDINARIO', 'obligacion' => 'required|string|max:20', 'digito' => ['required', 'regex:/^([0-9]|todos)$/'],
            'desde' => 'required|date_format:Y-m-d', 'hasta' => 'required|date_format:Y-m-d', 'fecha' => 'required|date_format:Y-m-d', 'fuente' => 'nullable|string|max:120',
        ]);
        $digitos = $d['digito'] === 'todos' ? range(0, 9) : [(int) $d['digito']];
        try {
            DB::transaction(function () use ($d, $digitos) {
                foreach ($digitos as $g) DB::statement('SELECT fn_calendario_guardar(?::text, ?::text, ?::int, ?::date, ?::date, ?::date, ?::text, ?::bigint)',
                    [$d['regimen'], $d['obligacion'], $g, $d['desde'], $d['hasta'], $d['fecha'], $d['fuente'] ?? null, auth()->id()]);
            });
        } catch (QueryException $e) { return response()->json(['message' => $this->mensaje($e, 'No se pudo guardar la fecha.')], 422); }
        return response()->json(['ok' => true, 'guardadas' => count($digitos), 'vencimientos' => self::proximos(5)]);
    }

    /**
     * Carga masiva pegando texto: una fecha por línea, separada por «;», tabulador o coma:
     *   OBLIGACIÓN ; DÍGITO (0-9 o «todos») ; DESDE ; HASTA ; FECHA LÍMITE      (fechas AAAA-MM-DD o DD/MM/AAAA)
     * El régimen y la fuente vienen del formulario. Si una línea falla no se guarda ninguna.
     */
    public function cargar(Request $r)
    {
        if (!self::paramGuardado()) return response()->json(['message' => 'Falta instalar el SQL 22.'], 422);
        $d = $r->validate(['regimen' => 'required|in:ESPECIAL,ORDINARIO', 'texto' => 'required|string|max:200000', 'fuente' => 'nullable|string|max:120']);
        $fecha = function (string $t) {
            $t = trim($t);
            if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $t, $m)) $y = [$m[1], $m[2], $m[3]];
            elseif (preg_match('#^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$#', $t, $m)) $y = [$m[3], $m[2], $m[1]];
            else return null;
            return checkdate((int) $y[1], (int) $y[2], (int) $y[0]) ? sprintf('%04d-%02d-%02d', $y[0], $y[1], $y[2]) : null;
        };
        $filas = []; $n = 0;
        foreach (preg_split('/\R/u', $d['texto']) as $linea) {
            $n++; $linea = trim($linea);
            if ($linea === '' || str_starts_with($linea, '#')) continue;
            $c = array_map('trim', preg_split('/[;\t,]/u', $linea));
            if (count($c) !== 5) return response()->json(['message' => "Línea $n: deben ser 5 columnas (obligación; dígito; desde; hasta; fecha límite)."], 422);
            [$o, $g, $a, $b, $f] = $c;
            if (!preg_match('/^([0-9]|todos)$/i', $g)) return response()->json(['message' => "Línea $n: el dígito debe ser de 0 a 9 o «todos»."], 422);
            foreach ([['desde', $a], ['hasta', $b], ['fecha límite', $f]] as [$nom, $v]) if ($fecha($v) === null) return response()->json(['message' => "Línea {$n}: la fecha «{$v}» ({$nom}) no es válida."], 422);
            foreach (strtolower($g) === 'todos' ? range(0, 9) : [(int) $g] as $dg)
                $filas[] = ['regimen' => $d['regimen'], 'obligacion' => strtoupper($o), 'digito' => $dg, 'desde' => $fecha($a), 'hasta' => $fecha($b), 'limite' => $fecha($f), 'fuente' => $d['fuente'] ?? null];
        }
        if (!$filas) return response()->json(['message' => 'No hay ninguna fecha para cargar.'], 422);
        try { $guardadas = (int) DB::scalar('SELECT fn_calendario_cargar(?::jsonb, ?::bigint)', [json_encode($filas), auth()->id()]); }
        catch (QueryException $e) { return response()->json(['message' => $this->mensaje($e, 'No se pudo cargar el calendario.')], 422); }
        return response()->json(['ok' => true, 'guardadas' => $guardadas, 'vencimientos' => self::proximos(5)]);
    }

    public function eliminar(Request $r)
    {
        $d = $r->validate(['regimen' => 'required|in:ESPECIAL,ORDINARIO', 'obligacion' => 'required|string|max:20', 'digito' => 'required|integer|between:0,9', 'desde' => 'required|date_format:Y-m-d']);
        try { DB::statement('SELECT fn_calendario_eliminar(?::text, ?::text, ?::int, ?::date)', [$d['regimen'], $d['obligacion'], $d['digito'], $d['desde']]); }
        catch (QueryException $e) { return response()->json(['message' => $this->mensaje($e, 'No se pudo eliminar.')], 422); }
        return response()->json(['ok' => true, 'vencimientos' => self::proximos(5)]);
    }

    public function obligacion(Request $r)
    {
        $d = $r->validate(['codigo' => 'required|string|max:20', 'titulo' => 'required|string|min:3|max:100', 'periodo' => 'required|in:' . implode(',', self::PERIODOS)]);
        try { DB::statement('SELECT fn_calendario_obligacion_guardar(?::text, ?::text, ?::text)', [$d['codigo'], $d['titulo'], $d['periodo']]); }
        catch (QueryException $e) { return response()->json(['message' => $this->mensaje($e, 'No se pudo guardar la obligación.')], 422); }
        return response()->json(['ok' => true]);
    }
}
