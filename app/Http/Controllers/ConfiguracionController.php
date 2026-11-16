<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;

/**
 * Módulo "Configuración": todo lo que el negocio puede parametrizar, por secciones que se guardan por separado.
 * Solo el administrador entra. Contribuyente especial sí/no manda sobre IGTF, cliente obligatorio y retenciones.
 */
class ConfiguracionController extends Controller
{
    use ContextoPagina;

    private const RIF = '/^[JGVECPjgvecp]-?[0-9]{8}-?[0-9]$/';

    public function index()
    {
        $this->soloAdmin();
        return Inertia::render('Configuracion/Index', $this->contexto() + $this->datos());
    }

    /** Estado completo de la pantalla; también lo devuelven los guardados para refrescarla sin recargar. */
    public function datos(): array
    {
        $n = DB::table('negocio')->first();
        $hoy = DB::selectOne('SELECT fn_hoy() AS d')->d;
        $alicuotas = [];
        foreach (['IVA_GENERAL' => 'iva', 'IGTF_DIVISAS' => 'igtf'] as $codigo => $clave) {
            $filas = DB::table('parametros_fiscales')->where('codigo', $codigo)->orderByDesc('vigente_desde')->get();
            $vigente = $filas->first(fn ($f) => $f->vigente_desde <= $hoy && ($f->vigente_hasta === null || $f->vigente_hasta >= $hoy));
            $futura = $filas->first(fn ($f) => $f->vigente_desde > $hoy);
            $alicuotas[$clave] = [
                'codigo' => $codigo,
                'vigente' => $vigente ? ['pct' => (float) $vigente->porcentaje, 'desde' => $vigente->vigente_desde, 'nota' => $vigente->nota] : null,
                'programada' => $futura ? ['pct' => (float) $futura->porcentaje, 'desde' => $futura->vigente_desde, 'nota' => $futura->nota] : null,
                'historial' => $filas->map(fn ($f) => ['pct' => (float) $f->porcentaje, 'desde' => $f->vigente_desde, 'hasta' => $f->vigente_hasta, 'nota' => $f->nota])->values(),
            ];
        }

        $num = $this->tablaNumeracion() ? DB::table('numeracion_fiscal')->first() : null;
        $ventas = (int) DB::table('ventas')->count();

        return [
            'hoy' => $hoy,
            'negocio' => $n->nombre_comercial ?: ($n->razon_social ?? ''),
            'datos' => [
                'razon_social' => $n->razon_social, 'nombre_comercial' => $n->nombre_comercial, 'rif' => $n->rif,
                'direccion_fiscal' => $n->direccion_fiscal, 'telefono' => $n->telefono, 'correo' => $n->correo,
            ],
            'regimen' => [
                'es_contribuyente_especial' => (bool) $n->es_contribuyente_especial, 'cobra_igtf' => (bool) $n->cobra_igtf,
                'igtf_base' => $n->igtf_base, 'recupera_credito_fiscal' => (bool) $n->recupera_credito_fiscal,
                'precios_incluyen_iva' => (bool) $n->precios_incluyen_iva, 'reversa_igtf_en_anulacion' => (bool) $n->reversa_igtf_en_anulacion,
            ],
            'precios' => [
                'margen_defecto_pct' => (float) $n->margen_defecto_pct, 'metodo_costo' => $n->metodo_costo,
                'politica_costo_nuevo' => $n->politica_costo_nuevo, 'redondeo_precio_usd' => (float) $n->redondeo_precio_usd,
            ],
            'cobros' => [
                'regla_tasa_sin_publicacion' => $n->regla_tasa_sin_publicacion, 'dias_max_tasa_antigua' => (int) $n->dias_max_tasa_antigua,
                'dias_max_tasa_futura' => (int) $n->dias_max_tasa_futura, 'tolerancia_pago_usd' => (float) $n->tolerancia_pago_usd,
                'permitir_stock_negativo' => (bool) $n->permitir_stock_negativo,
            ],
            'regimen_historial' => $this->historialRegimen(),
            'alicuotas' => $alicuotas,
            'numeracion' => $num ? [
                'disponible' => true, 'automatica' => (bool) $num->automatica,
                'prefijo_factura' => $num->prefijo_factura, 'siguiente_factura' => (int) $num->siguiente_factura,
                'prefijo_control' => $num->prefijo_control, 'siguiente_control' => (int) $num->siguiente_control,
            ] : ['disponible' => false],
            'ventas_emitidas' => $ventas,
            'checklist' => collect(DB::select('SELECT * FROM fn_checklist_configuracion()'))->map(fn ($c) => [
                'paso' => $c->paso, 'completo' => (bool) $c->completo, 'detalle' => $c->detalle,
            ])->values(),
        ];
    }

    /** POST /configuracion/{seccion}: negocio | regimen | precios | cobros | numeracion. */
    public function guardar(Request $r, string $seccion)
    {
        $this->soloAdmin();
        abort_unless(in_array($seccion, ['negocio', 'regimen', 'precios', 'cobros', 'numeracion'], true), 404);
        $d = $r->validate($this->reglas($seccion), $this->mensajes());
        $actual = DB::table('negocio')->first();

        try {
            DB::transaction(function () use ($seccion, $d, $actual) {
                match ($seccion) {
                    'negocio' => $this->guardarNegocio($d, $actual),
                    'regimen' => $this->guardarRegimen($d),
                    'precios' => DB::table('negocio')->where('id', \App\Support\Tenant::id())->update($d),
                    'cobros' => DB::table('negocio')->where('id', \App\Support\Tenant::id())->update($d),
                    'numeracion' => $this->guardarNumeracion($d),
                };
                DB::table('negocio')->where('id', \App\Support\Tenant::id())->update(['configurado_por' => auth()->id()]);
            });
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo guardar. Revisa los datos e inténtalo otra vez.')], 422);
        }
        return response()->json($this->datos());
    }

    /** POST /configuracion/alicuota: programa un cambio de IVA o de IGTF con fecha de inicio (nunca en el pasado). */
    public function alicuota(Request $r)
    {
        $this->soloAdmin();
        // Auditoría A-4: las alícuotas fiscales son GLOBALES (las fija el SENIAT/BCV):
        // solo la tienda con editar_global las cambia; las demás las leen.
        abort_unless(\App\Support\Tenant::editarGlobal(), 403, 'Las alícuotas fiscales las administra la plataforma: tu tienda las consulta pero no las modifica.');
        $d = $r->validate([
            'codigo' => ['required', Rule::in(['IVA_GENERAL', 'IGTF_DIVISAS'])],
            'porcentaje' => 'required|numeric|between:0,100',
            'desde' => 'required|date',
            'nota' => 'required|string|min:3|max:300',
        ], [
            'porcentaje.required' => 'Escribe el nuevo porcentaje.', 'porcentaje.between' => 'El porcentaje debe estar entre 0 y 100.',
            'desde.required' => 'Elige desde qué fecha rige.', 'nota.required' => 'Anota el decreto o la fuente del cambio.', 'nota.min' => 'Anota el decreto o la fuente del cambio.',
        ]);
        try {
            DB::statement('CALL sp_cambiar_alicuota(?,?,?,?,?)', [$d['codigo'], $d['porcentaje'], $d['desde'], $d['nota'], auth()->id()]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo programar el cambio.')], 422);
        }
        return response()->json($this->datos());
    }

    /** DELETE /configuracion/alicuota/{codigo}: cancela un cambio programado que aún no empieza. */
    public function cancelarAlicuota(string $codigo)
    {
        $this->soloAdmin();
        // Auditoría A-4 + B-3: escritura global → solo editar_global, y el SQL
        // directo sobre parametros_fiscales pasa al procedimiento con guardia.
        abort_unless(\App\Support\Tenant::editarGlobal(), 403, 'Las alícuotas fiscales las administra la plataforma: tu tienda las consulta pero no las modifica.');
        abort_unless(in_array($codigo, ['IVA_GENERAL', 'IGTF_DIVISAS'], true), 404);
        try {
            DB::statement('CALL sp_cancelar_alicuota(?)', [$codigo]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo cancelar el cambio.')], 422);
        }
        return response()->json($this->datos());
    }

    /* ───────────── Guardados por sección ───────────── */

    private function guardarNegocio(array $d, object $actual): void
    {
        // El procedimiento valida RIF (dígito verificador) y vuelve a escribir el régimen: se le pasa el actual para no tocarlo.
        DB::statement('CALL sp_guardar_configuracion_negocio(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
            $d['razon_social'], strtoupper($d['rif']), $d['direccion_fiscal'],
            (bool) $actual->es_contribuyente_especial, (bool) $actual->cobra_igtf, (bool) $actual->recupera_credito_fiscal, (bool) $actual->precios_incluyen_iva,
            $actual->politica_costo_nuevo, $actual->metodo_costo, $actual->margen_defecto_pct, $actual->igtf_base,
            $d['nombre_comercial'] ?? null, $d['telefono'] ?? null, $d['correo'] ?? null, auth()->id(),
        ]);
    }

    private function guardarRegimen(array $d): void
    {
        $especial = (bool) $d['es_contribuyente_especial'];
        // Solo un contribuyente especial cobra IGTF (la base de datos lo exige); si deja de serlo, se apaga solo.
        $d['cobra_igtf'] = $especial && (bool) $d['cobra_igtf'];
        $d['configurado_por'] = auth()->id();   // el historial del régimen (19_regimen_y_apertura.sql) anota quién lo cambió
        DB::table('negocio')->where('id', \App\Support\Tenant::id())->update($d);
    }

    /** Últimos cambios de régimen (si ya se ejecutó 19_regimen_y_apertura.sql). */
    private function historialRegimen(): array
    {
        if (!DB::scalar("SELECT to_regclass('negocio_regimen_historial') IS NOT NULL")) return [];
        return array_map(fn ($h) => ['fecha' => $h->cambiado_en, 'especial' => (bool) $h->es_especial, 'igtf' => (bool) $h->cobra_igtf, 'nota' => $h->nota, 'usuario' => $h->usuario],
            DB::select("SELECT h.cambiado_en, h.es_especial, h.cobra_igtf, h.nota, u.nombre_completo AS usuario FROM negocio_regimen_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id ORDER BY h.id DESC LIMIT 6"));
    }

    private function guardarNumeracion(array $d): void
    {
        abort_unless($this->tablaNumeracion(), 422, 'Falta instalar database/sql/09_numeracion_fiscal.sql para numerar facturas desde aquí.');
        $d['actualizado_en'] = now();
        DB::table('numeracion_fiscal')->where('id', \App\Support\Tenant::id())->update($d);
    }

    /* ───────────── Reglas ───────────── */

    private function reglas(string $seccion): array
    {
        return match ($seccion) {
            'negocio' => [
                'razon_social' => 'required|string|min:2|max:200', 'nombre_comercial' => 'nullable|string|max:200',
                'rif' => ['required', 'regex:' . self::RIF], 'direccion_fiscal' => 'required|string|min:5',
                'telefono' => 'nullable|string|max:40', 'correo' => 'nullable|email|max:150',
            ],
            'regimen' => [
                'es_contribuyente_especial' => 'required|boolean', 'cobra_igtf' => 'required|boolean',
                'igtf_base' => 'required|in:CON_IVA,SIN_IVA', 'recupera_credito_fiscal' => 'required|boolean',
                'precios_incluyen_iva' => 'required|boolean', 'reversa_igtf_en_anulacion' => 'required|boolean',
            ],
            'precios' => [
                'margen_defecto_pct' => 'required|numeric|between:0,1000', 'metodo_costo' => 'required|in:ULTIMO,PROMEDIO',
                'politica_costo_nuevo' => 'required|in:AVISAR,AUTOMATICO,NINGUNA', 'redondeo_precio_usd' => 'required|numeric|gt:0|max:10',
            ],
            'cobros' => [
                'regla_tasa_sin_publicacion' => 'required|in:ANTERIOR,SIGUIENTE', 'dias_max_tasa_antigua' => 'required|integer|min:0|max:60',
                'dias_max_tasa_futura' => 'required|integer|min:0|max:15', 'tolerancia_pago_usd' => 'required|numeric|min:0|max:5',
                'permitir_stock_negativo' => 'required|boolean',
            ],
            'numeracion' => [
                'automatica' => 'required|boolean', 'prefijo_factura' => 'required|string|max:10', 'siguiente_factura' => 'required|integer|min:1',
                'prefijo_control' => 'required|string|max:10', 'siguiente_control' => 'required|integer|min:1',
            ],
        };
    }

    private function mensajes(): array
    {
        return [
            'razon_social.required' => 'Escribe la razón social.', 'rif.required' => 'Escribe el RIF.', 'rif.regex' => 'El RIF no tiene el formato correcto. Ejemplo: J-12345678-4.',
            'direccion_fiscal.required' => 'Escribe la dirección fiscal.', 'direccion_fiscal.min' => 'La dirección fiscal es muy corta.', 'correo.email' => 'Ese correo no parece válido.',
            'margen_defecto_pct.between' => 'El margen debe estar entre 0 y 1000 %.', 'redondeo_precio_usd.gt' => 'El redondeo debe ser mayor que cero.',
            'dias_max_tasa_futura.max' => 'Como máximo 15 días.', 'siguiente_factura.min' => 'El número debe ser 1 o más.', 'siguiente_control.min' => 'El número debe ser 1 o más.',
        ];
    }

    /* ───────────── Utilidades ───────────── */

    private function tablaNumeracion(): bool
    {
        return (bool) DB::selectOne("SELECT to_regclass('numeracion_fiscal') IS NOT NULL AS ok")->ok;
    }

    private function soloAdmin(): void
    {
        abort_if(strtoupper((string) (auth()->user()->rol ?? '')) !== 'ADMINISTRADOR', 403, 'Solo un administrador puede cambiar la configuración.');
    }

    private function mensaje(QueryException $e, string $porDefecto): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }
}
