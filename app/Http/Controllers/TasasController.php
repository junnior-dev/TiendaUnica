<?php

namespace App\Http\Controllers;

use App\Services\ExchangeRateService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Throwable;

/**
 * Módulo "Tasas de cambio": ver, agregar tasas de cualquier par de monedas (con la cotización de ExchangeRate-API al elegir),
 * actualizar todo con un clic, editar a mano y elegir las monedas del negocio.
 * Todo se guarda como «bolívares por 1 unidad» (tasas_cambio.moneda_destino = VES): es lo que usan ventas, caja y compras.
 */
class TasasController extends Controller
{
    /** Monedas que se pueden agregar desde la pantalla (código ISO → nombre, símbolo). */
    public const CATALOGO = [
        'USD' => ['Dólar estadounidense', '$'], 'VES' => ['Bolívar', 'Bs'], 'EUR' => ['Euro', '€'], 'COP' => ['Peso colombiano', 'COP'],
        'BRL' => ['Real brasileño', 'R$'], 'ARS' => ['Peso argentino', 'ARS'], 'CLP' => ['Peso chileno', 'CLP'], 'PEN' => ['Sol peruano', 'S/'],
        'MXN' => ['Peso mexicano', 'MX$'], 'GBP' => ['Libra esterlina', '£'], 'CAD' => ['Dólar canadiense', 'CA$'], 'PAB' => ['Balboa panameño', 'B/.'],
        'DOP' => ['Peso dominicano', 'RD$'], 'CNY' => ['Yuan chino', '¥'], 'CHF' => ['Franco suizo', 'CHF'], 'JPY' => ['Yen japonés', 'JP¥'],
        'UYU' => ['Peso uruguayo', '$U'], 'BOB' => ['Boliviano', 'Bs.'], 'PYG' => ['Guaraní paraguayo', '₲'], 'CRC' => ['Colón costarricense', '₡'],
        'GTQ' => ['Quetzal guatemalteco', 'Q'], 'HNL' => ['Lempira hondureño', 'L'], 'NIO' => ['Córdoba nicaragüense', 'C$'], 'TTD' => ['Dólar de Trinidad y Tobago', 'TT$'],
    ];

    private function monedasActivas(): array
    {
        return array_map(fn ($r) => $r->codigo, DB::select('SELECT codigo FROM monedas WHERE activa'));
    }

    /** Última tasa cargada de una moneda contra el bolívar (sin exigir que esté vigente). */
    private function tasaVes(string $m): ?float
    {
        if ($m === 'VES') return 1.0;
        $t = DB::scalar("SELECT tasa FROM v_tasas_actuales WHERE moneda_origen = ? AND moneda_destino = 'VES'", [$m]);
        $t = $t === false ? null : $t;
        return $t === null ? null : (float) $t;
    }

    public function index(ExchangeRateService $api)
    {
        $act = DB::table('v_tasas_actuales')->where('moneda_destino', 'VES')->get()->keyBy('moneda_origen');
        $usd = (float) ($act['USD']->tasa ?? 0);
        $meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        $dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        $hoy = now();

        $monedasDb = DB::table('monedas')->get()->keyBy('codigo');
        $orden = fn ($c) => sprintf('%02d', ['USD' => 0, 'VES' => 1, 'EUR' => 2, 'COP' => 3][$c] ?? 10);

        $tasas = $monedasDb->filter(fn ($m) => $m->activa && $m->codigo !== 'VES' && isset($act[$m->codigo]))->sortBy(fn ($m) => $orden($m->codigo) . $m->codigo)->map(function ($m) use ($act, $usd) {
            $p = $m->codigo; $t = $act[$p];
            $serie = DB::table('tasas_cambio')->where(['moneda_origen' => $p, 'moneda_destino' => 'VES'])->orderByDesc('fecha_valor')->limit(7)->get(['tasa', 'fecha_valor'])->reverse()->values();
            $prev = $serie->count() > 1 ? (float) $serie[$serie->count() - 2]->tasa : null;
            $porDolar = $p !== 'USD' && (float) $t->tasa < 1;           // monedas que valen menos de 1 Bs se muestran «por dólar»
            return [
                'par' => $p, 'nombre' => $m->nombre, 'simbolo' => $m->simbolo, 'tasa' => (float) $t->tasa, 'fecha' => $t->fecha_valor, 'vigente' => (bool) $t->vigente,
                'fuente' => DB::table('tasas_cambio')->where(['moneda_origen' => $p, 'moneda_destino' => 'VES', 'fecha_valor' => $t->fecha_valor])->value('fuente') ?? 'MANUAL',
                'variacion_pct' => $prev ? round(($t->tasa / $prev - 1) * 100, 3) : null,
                'serie' => $serie->count() > 1 ? $serie->pluck('tasa')->map(fn ($x) => (float) $x) : [],
                'serie_desde' => $serie->count() > 1 ? date('j M', strtotime($serie->first()->fecha_valor)) : '',
                'serie_hasta' => $serie->count() > 1 ? date('j M', strtotime($serie->last()->fecha_valor)) : '',
                'por_dolar' => $porDolar && $t->tasa > 0 ? round($usd / $t->tasa, 2) : null,
            ];
        })->values();

        $monedas = $monedasDb->sortBy(fn ($m) => $orden($m->codigo) . $m->codigo)->map(fn ($m) => [
            'codigo' => $m->codigo, 'nombre' => $m->nombre, 'simbolo' => $m->simbolo, 'base' => (bool) $m->es_base, 'activa' => (bool) $m->activa, 'bloqueada' => $m->codigo === 'VES',
            'sin_tasa' => $m->codigo !== 'VES' && ! isset($act[$m->codigo]),
        ])->values();

        $historial = DB::table('tasas_cambio as t')->leftJoin('usuarios as u', 'u.id', '=', 't.usuario_id')
            ->where('t.moneda_destino', 'VES')->orderByDesc('t.fecha_valor')->orderBy('t.moneda_origen')->limit(80)
            ->get(['t.moneda_origen', 't.fecha_valor', 't.tasa', 't.fuente', 't.obtenida_en', 'u.nombre_completo as usuario'])
            ->map(fn ($h) => [
                'origen' => $h->moneda_origen, 'fecha' => $h->fecha_valor, 'tasa' => (float) $h->tasa, 'fuente' => $h->fuente,
                'registrada' => date('d/m', strtotime($h->obtenida_en)) . ' · ' . ($h->usuario ?? 'Sistema'),
                'vigente' => isset($act[$h->moneda_origen]) && $act[$h->moneda_origen]->fecha_valor === $h->fecha_valor,
            ]);

        $neg = DB::table('negocio')->first();
        return Inertia::render('Tasas/Index', [
            'negocio' => $neg->nombre_comercial ?: ($neg->razon_social ?? ''), 'usuario' => ['nombre' => auth()->user()->nombre_completo ?? '', 'rol' => ucfirst(strtolower(auth()->user()->rol ?? 'Cajero'))],
            'fecha_larga' => $dias[$hoy->dayOfWeek] . ' ' . $hoy->day . ' de ' . $meses[$hoy->month - 1] . ' de ' . $hoy->year,
            'stock_bajo' => (int) DB::table('v_stock_bajo')->count(),
            'tasas' => $tasas, 'monedas' => $monedas, 'historial' => $historial,
            'catalogo' => array_map(fn ($c, $d) => ['codigo' => $c, 'nombre' => $d[0], 'simbolo' => $d[1]], array_keys(self::CATALOGO), self::CATALOGO),
            'sync' => ['clave' => $api->configurado(), 'ultima' => Cache::get('tasas.ultima_consulta')],
            'reglas' => ['sin_publicacion' => $neg->regla_tasa_sin_publicacion ?? 'SIGUIENTE', 'dias_antigua' => (int) ($neg->dias_max_tasa_antigua ?? 4), 'dias_futura' => (int) ($neg->dias_max_tasa_futura ?? 5)],
        ]);
    }

    /** GET /tasas/consulta?de=EUR&a=VES · cotización de ExchangeRate-API para mostrarla al elegir el par en el modal. */
    public function consulta(Request $request, ExchangeRateService $api)
    {
        $de = strtoupper((string) $request->query('de')); $a = strtoupper((string) $request->query('a'));
        if (! isset(self::CATALOGO[$de]) || ! isset(self::CATALOGO[$a])) return response()->json(['message' => 'Elige las dos monedas.'], 422);
        if ($de === $a) return response()->json(['message' => 'Elige dos monedas distintas.'], 422);
        $guardada = null;
        try { $guardada = (float) DB::scalar('SELECT fn_tasa_par(?, ?)', [$de, $a]); } catch (Throwable) { $guardada = null; }
        if (! $api->configurado()) return response()->json(['ok' => true, 'api' => null, 'guardada' => $guardada, 'aviso' => 'No hay clave de ExchangeRate-API en el archivo .env: escribe la tasa a mano.']);
        try {
            $r = $api->par($de, $a);
            return response()->json(['ok' => true, 'api' => $r, 'guardada' => $guardada, 'de' => $de, 'a' => $a]);
        } catch (Throwable $e) {
            return response()->json(['ok' => true, 'api' => null, 'guardada' => $guardada, 'aviso' => $e->getMessage()]);
        }
    }

    /**
     * POST /tasas/par · «1 DE equivale a VALOR A». Se normaliza a bolívares:
     *   X→VES  se guarda tal cual · VES→X se guarda 1/valor · entre dos monedas extranjeras se deduce la que falte a partir de la que ya tiene tasa.
     */
    public function par(Request $request)
    {
        // Auditoría A-4: las tasas GLOBALES las administra la plataforma (editar_global).
        abort_unless(\App\Support\Tenant::editarGlobal(), 403, 'Las tasas de cambio las administra la plataforma: tu tienda las consulta pero no las modifica.');
        $d = $request->validate(['de' => 'required|string|size:3', 'a' => 'required|string|size:3', 'valor' => 'required', 'fecha_valor' => 'required|date', 'fuente' => 'required|in:EXCHANGERATE_API,BCV,MANUAL']);
        $de = strtoupper($d['de']); $a = strtoupper($d['a']);
        if (! isset(self::CATALOGO[$de]) || ! isset(self::CATALOGO[$a])) return back()->withErrors(['valor' => 'Una de las monedas no está en la lista.']);
        if ($de === $a) return back()->withErrors(['valor' => 'Elige dos monedas distintas.']);
        $v = self::numero($d['valor']);
        if ($v <= 0) return back()->withErrors(['valor' => 'Escribe un número mayor que cero.']);

        if ($de === 'VES') $filas = [[$a, 1 / $v]];
        elseif ($a === 'VES') $filas = [[$de, $v]];
        else {
            $tDe = $this->tasaVes($de); $tA = $this->tasaVes($a);
            if ($tDe === null && $tA === null) return back()->withErrors(['valor' => "Primero registra la tasa de {$de} o de {$a} contra el bolívar; la otra se calcula a partir de ella."]);
            // Falta una: se calcula a partir de la otra. Si existen las dos, se ajusta la que no es dólar (el dólar es la referencia).
            $ajustaA = $tA === null || ($tDe !== null && $a !== 'USD');
            $filas = $ajustaA ? [[$a, $tDe / $v]] : [[$de, $v * $tA]];
        }
        try {
            DB::transaction(function () use ($filas, $d) {
                foreach ($filas as [$m, $tasa]) {
                    $nombre = self::CATALOGO[$m];
                    DB::statement('CALL sp_alta_moneda(?, ?, ?)', [$m, $nombre[0], $nombre[1]]);
                    DB::statement("CALL sp_registrar_tasa(?,?,?,?,?,?,'VES')", [round($tasa, 8), $d['fecha_valor'], $d['fuente'], $d['fuente'] === 'BCV', auth()->id(), $m]);
                }
            });
        } catch (Throwable $e) {
            return back()->withErrors(['valor' => self::mensaje($e)]);
        }
        [$m, $tasa] = $filas[0];
        return back()->with('ok', 'Tasa guardada: 1 ' . $m . ' = Bs ' . number_format($tasa, $tasa < 1 ? 6 : 4, ',', '.') . '.');
    }

    /** Consulta ExchangeRate-API y registra la tasa de USD y de cada moneda activa contra el bolívar. */
    public function sincronizar(ExchangeRateService $api)
    {
        // Auditoría A-4: escritura de tasas globales → solo editar_global.
        abort_unless(\App\Support\Tenant::editarGlobal(), 403, 'Las tasas de cambio las administra la plataforma: tu tienda las consulta pero no las modifica.');
        try {
            $r = $api->tasasUsd(forzar: true);
            $ves = $r['rates']['VES'] ?? 0;
            if ($ves <= 0) throw new \RuntimeException('ExchangeRate-API no devolvió la tasa del bolívar.');
            $omitidas = [];
            DB::transaction(function () use ($r, $ves, &$omitidas) {
                foreach (array_unique(array_merge(['USD'], $this->monedasActivas())) as $m) {
                    if ($m === 'VES') continue;
                    $porUsd = $r['rates'][$m] ?? 0;
                    if ($porUsd <= 0) { $omitidas[] = $m; continue; }
                    DB::statement("CALL sp_registrar_tasa(?,?,'EXCHANGERATE_API',false,?,?,'VES')", [round($ves / $porUsd, 8), $r['fecha'], auth()->id(), $m]);
                }
            });
            Cache::put('tasas.ultima_consulta', now()->format('d/m/Y H:i'), now()->addDay());
            return back()->with('ok', 'Tasas actualizadas con ExchangeRate-API.' . ($omitidas ? ' Sin cotización para: ' . implode(', ', $omitidas) . '.' : ''));
        } catch (Throwable $e) {
            return back()->withErrors(['sync' => $e->getMessage()]);
        }
    }

    /** Edición manual de la tasa de una moneda. Si la moneda vale menos de 1 Bs se escribe «unidades por dólar» y se guarda como «Bs por 1 unidad». */
    public function manual(Request $request)
    {
        // Auditoría A-4: escritura de tasas globales → solo editar_global.
        abort_unless(\App\Support\Tenant::editarGlobal(), 403, 'Las tasas de cambio las administra la plataforma: tu tienda las consulta pero no las modifica.');
        $d = $request->validate(['par' => 'required|string|size:3', 'valor' => 'required', 'fecha_valor' => 'required|date', 'fuente' => 'required|in:BCV,MANUAL']);
        $par = strtoupper($d['par']);
        if ($par === 'VES' || ! DB::scalar('SELECT 1 FROM monedas WHERE codigo = ?', [$par])) return back()->withErrors(['valor' => 'Esa moneda no se puede editar.']);
        $v = self::numero($d['valor']);
        if ($v <= 0) return back()->withErrors(['valor' => 'Escribe un número mayor que cero.']);
        $actual = $this->tasaVes($par);
        if ($par !== 'USD' && $actual !== null && $actual < 1) {
            $usd = $this->tasaVes('USD');
            if (! $usd) return back()->withErrors(['valor' => 'Primero registra la tasa del dólar.']);
            $v = $usd / $v;
        }
        try {
            DB::statement("CALL sp_registrar_tasa(?,?,?,?,?,?,'VES')", [$v, $d['fecha_valor'], $d['fuente'], $d['fuente'] === 'BCV', auth()->id(), $par]);
        } catch (Throwable $e) {
            return back()->withErrors(['valor' => self::mensaje($e)]);
        }
        return back()->with('ok', 'Tasa guardada.');
    }

    /** Activa o desactiva una moneda. USD (base) y VES no se pueden desactivar. */
    public function moneda(Request $request, string $codigo)
    {
        // Auditoría A-4: el catálogo de monedas es global → solo editar_global.
        abort_unless(\App\Support\Tenant::editarGlobal(), 403, 'El catálogo de monedas lo administra la plataforma.');
        $codigo = strtoupper($codigo);
        abort_if(in_array($codigo, ['USD', 'VES'], true) || ! DB::scalar('SELECT 1 FROM monedas WHERE codigo = ?', [$codigo]), 422);
        DB::statement('CALL sp_moneda_activa(?, ?)', [$codigo, $request->boolean('activa')]);
        return back();
    }

    /** «1.234,56» o «1234.56» → 1234.56 */
    public static function numero($v): float
    {
        $s = trim((string) $v);
        if (str_contains($s, ',')) return (float) str_replace(['.', ','], ['', '.'], $s);
        return is_numeric($s) ? (float) $s : 0.0;
    }

    private static function mensaje(Throwable $e): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|$)/s', $e->getMessage(), $m) ? trim($m[1]) : 'No se pudo guardar la tasa.';
    }
}
