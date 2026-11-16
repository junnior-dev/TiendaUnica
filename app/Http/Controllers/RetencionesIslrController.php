<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Retenciones de ISLR a proveedores de servicios (database/sql/20_retenciones_islr.sql). Todo el cálculo y las reglas
 * (sustraendo, mínimo, comprobante numerado, asiento, no editar) viven en PostgreSQL; aquí solo se valida el formato y se traducen
 * los errores. Solo administrador (AccesoPorRol + Permisos: módulo «fiscal»).
 */
class RetencionesIslrController extends Controller
{
    use ContextoPagina;

    private function instalado(): bool
    {
        return (bool) DB::scalar("SELECT to_regclass('retenciones_islr') IS NOT NULL AND to_regproc('fn_registrar_retencion_islr') IS NOT NULL");
    }

    private function mes(Request $r, string $hoy): string
    {
        $m = (string) $r->query('mes', substr($hoy, 0, 7));
        return preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $m) ? $m : substr($hoy, 0, 7);
    }

    public function index(Request $r)
    {
        $hoy = (string) DB::scalar('SELECT fn_hoy()');
        $base = $this->contexto() + ['hoy' => $hoy, 'instalado' => $this->instalado()];
        if (!$base['instalado']) return Inertia::render('RetencionesIslr/Index', $base + ['mes' => substr($hoy, 0, 7)]);

        $mes = $this->mes($r, $hoy);
        $desde = "$mes-01"; $hasta = date('Y-m-t', strtotime($desde));
        $f = fn ($x) => [
            'id' => (int) $x->id, 'numero' => $x->numero, 'fecha' => $x->fecha, 'beneficiario' => $x->beneficiario, 'rif' => $x->rif, 'tipo' => $x->tipo_beneficiario,
            'concepto' => $x->concepto_nombre, 'documento' => $x->documento, 'moneda' => trim($x->moneda), 'monto' => (float) $x->monto_orig, 'base_ves' => (float) $x->base_ves,
            'porcentaje' => (float) $x->porcentaje, 'sustraendo_ves' => (float) $x->sustraendo_ves, 'retenido_ves' => (float) $x->retenido_ves, 'neto_ves' => (float) $x->neto_pagado_ves,
            'estado' => $x->estado, 'entero_id' => $x->entero_id ? (int) $x->entero_id : null, 'motivo' => $x->motivo_anulacion,
        ];
        $filas = DB::select('SELECT r.*, c.nombre AS concepto_nombre FROM retenciones_islr r JOIN islr_conceptos c ON c.codigo = r.concepto WHERE r.fecha BETWEEN ? AND ? ORDER BY r.fecha DESC, r.id DESC', [$desde, $hasta]);
        $activas = array_filter($filas, fn ($x) => $x->estado === 'ACTIVA');
        $ut = DB::scalar('SELECT fn_islr_ut(fn_hoy())');

        return Inertia::render('RetencionesIslr/Index', $base + [
            'mes' => $mes,
            'alertas' => DeclaracionIslrController::alertas(),
            'retenciones' => array_map($f, $filas),
            'resumen' => [
                'mes_retenido' => round(array_sum(array_map(fn ($x) => (float) $x->retenido_ves, $activas)), 2),
                'mes_base' => round(array_sum(array_map(fn ($x) => (float) $x->base_ves, $activas)), 2),
                'mes_n' => count($activas),
                'por_enterar' => (float) DB::scalar("SELECT COALESCE(sum(retenido_ves), 0) FROM retenciones_islr WHERE estado = 'ACTIVA' AND entero_id IS NULL"),
                'por_enterar_n' => (int) DB::scalar("SELECT count(*) FROM retenciones_islr WHERE estado = 'ACTIVA' AND entero_id IS NULL"),
                'mas_antigua' => DB::scalar("SELECT min(fecha) FROM retenciones_islr WHERE estado = 'ACTIVA' AND entero_id IS NULL"),
            ],
            'enteros' => array_map(fn ($e) => ['id' => (int) $e->id, 'desde' => $e->desde, 'hasta' => $e->hasta, 'fecha_pago' => $e->fecha_pago, 'referencia' => $e->referencia, 'monto' => (float) $e->monto_ves, 'estado' => $e->estado],
                DB::select('SELECT * FROM enteros_islr ORDER BY id DESC LIMIT 8')),
            'conceptos' => DB::table('islr_conceptos')->where('activo', true)->orderBy('orden')->get(['codigo', 'nombre', 'pct_natural', 'pct_juridica'])
                ->map(fn ($c) => ['codigo' => $c->codigo, 'nombre' => $c->nombre, 'pct_natural' => (float) $c->pct_natural, 'pct_juridica' => (float) $c->pct_juridica]),
            'ut' => ['vigente' => $ut !== null ? (float) $ut : null, 'historial' => DB::table('islr_ut')->orderByDesc('desde')->limit(5)->get(['desde', 'valor_ves', 'nota'])->map(fn ($u) => ['desde' => $u->desde, 'valor' => (float) $u->valor_ves, 'nota' => $u->nota])],
            'config' => ['sustraendo_una_vez_mes' => (bool) DB::table('islr_config')->value('sustraendo_una_vez_mes')],
            'proveedores' => DB::table('proveedores')->where('activo', true)->orderBy('razon_social')->get(['id', 'razon_social', 'rif'])->map(fn ($p) => ['id' => (int) $p->id, 'nombre' => $p->razon_social, 'rif' => $p->rif]),
            'monedas' => DB::table('monedas')->where('activa', true)->orderBy('codigo')->pluck('codigo')->map(fn ($m) => trim($m)),
            'contabilidad_automatica' => (bool) DB::table('contab_config')->value('automatica'),
        ]);
    }

    private function datos(Request $r): array
    {
        return $r->validate([
            'fecha' => 'required|date_format:Y-m-d', 'beneficiario' => 'required|string|min:3|max:150', 'rif' => ['required', 'regex:/^[JGVECPjgvecp]-?\d{8}-?\d$/'],
            'tipo' => 'required|in:N,J', 'concepto' => 'required|string|max:30', 'documento' => 'nullable|string|max:40',
            'monto' => 'required|numeric|gt:0|max:999999999999', 'moneda' => 'required|string|size:3', 'fondos' => 'required|in:CAJA,BANCOS',
            'proveedor_id' => 'nullable|integer', 'observaciones' => 'nullable|string|max:300',
        ], ['rif.regex' => 'El RIF no tiene el formato correcto. Ejemplo: J-12345678-4.']);
    }

    /** Vista previa exacta: usa la misma función que el registro, para que lo que ves es lo que se guarda. */
    public function simular(Request $r)
    {
        abort_unless($this->instalado(), 422, 'Falta ejecutar 20_retenciones_islr.sql en la base de datos.');
        $d = $r->validate(['fecha' => 'required|date_format:Y-m-d', 'tipo' => 'required|in:N,J', 'concepto' => 'required|string|max:30', 'monto' => 'required|numeric|gt:0|max:999999999999',
            'moneda' => 'required|string|size:3', 'rif' => 'nullable|string|max:15']);
        try {
            $t = $d['moneda'] === 'VES' ? 1.0 : (float) DB::scalar("SELECT fn_tasa_par(?::bpchar, 'VES', ?::date)", [$d['moneda'], $d['fecha']]);
            if ($t <= 0) return response()->json(['message' => "No hay tasa para {$d['moneda']} el {$d['fecha']}: cárgala en Tasas de cambio."], 422);
            $base = round($d['monto'] * $t, 2);
            $c = json_decode(DB::scalar('SELECT fn_islr_calcular(?::date, ?::bpchar, ?::text, ?::numeric, ?::text)', [$d['fecha'], $d['tipo'], $d['concepto'], $base, $d['rif'] ?? null]), true);
        } catch (QueryException $e) { return response()->json(['message' => $this->mensaje($e, 'No se pudo calcular.')], 422); }
        return response()->json(['tasa' => $t, 'base_ves' => $base] + $c);
    }

    public function store(Request $r)
    {
        abort_unless($this->instalado(), 422, 'Falta ejecutar 20_retenciones_islr.sql en la base de datos.');
        $d = $this->datos($r);
        try {
            $id = DB::transaction(fn () => (int) DB::scalar('SELECT fn_registrar_retencion_islr(?::date, ?::text, ?::text, ?::bpchar, ?::text, ?::text, ?::numeric, ?::bpchar, ?::text, ?::bigint, ?::text, ?::bigint)', [
                $d['fecha'], $d['beneficiario'], $d['rif'], $d['tipo'], $d['concepto'], $d['documento'] ?? null, $d['monto'], $d['moneda'], $d['fondos'], $d['proveedor_id'] ?? null, $d['observaciones'] ?? null, auth()->id()]));
        } catch (QueryException $e) { return response()->json(['message' => $this->mensaje($e, 'No se pudo registrar la retención.')], 422); }
        return response()->json(['ok' => true, 'id' => $id]);
    }

    public function anular(Request $r, int $id)
    {
        abort_unless($this->instalado(), 422, 'Falta ejecutar 20_retenciones_islr.sql en la base de datos.');
        $d = $r->validate(['motivo' => 'required|string|min:3|max:300']);
        try { DB::transaction(fn () => DB::statement('SELECT fn_anular_retencion_islr(?::bigint, ?::text, ?::bigint)', [$id, $d['motivo'], auth()->id()])); }
        catch (QueryException $e) { return response()->json(['message' => $this->mensaje($e, 'No se pudo anular.')], 422); }
        return response()->json(['ok' => true]);
    }

    public function enterar(Request $r)
    {
        abort_unless($this->instalado(), 422, 'Falta ejecutar 20_retenciones_islr.sql en la base de datos.');
        $d = $r->validate(['desde' => 'required|date_format:Y-m-d', 'hasta' => 'required|date_format:Y-m-d', 'fecha_pago' => 'required|date_format:Y-m-d', 'referencia' => 'nullable|string|max:60']);
        try { DB::transaction(fn () => DB::statement('SELECT fn_enterar_islr(?::date, ?::date, ?::date, ?::text, ?::bigint)', [$d['desde'], $d['hasta'], $d['fecha_pago'], $d['referencia'] ?? null, auth()->id()])); }
        catch (QueryException $e) { return response()->json(['message' => $this->mensaje($e, 'No se pudo marcar como enterado.')], 422); }
        return response()->json(['ok' => true]);
    }

    public function desmarcarEntero(Request $r, int $id)
    {
        abort_unless($this->instalado(), 422, 'Falta ejecutar 20_retenciones_islr.sql en la base de datos.');
        $d = $r->validate(['motivo' => 'required|string|min:3|max:300']);
        try { DB::transaction(fn () => DB::statement('SELECT fn_desmarcar_entero_islr(?::bigint, ?::text, ?::bigint)', [$id, $d['motivo'], auth()->id()])); }
        catch (QueryException $e) { return response()->json(['message' => $this->mensaje($e, 'No se pudo desmarcar.')], 422); }
        return response()->json(['ok' => true]);
    }

    public function guardarUt(Request $r)
    {
        abort_unless($this->instalado(), 422, 'Falta ejecutar 20_retenciones_islr.sql en la base de datos.');
        // Auditoría A-4: la unidad tributaria es GLOBAL (Gaceta Oficial) → solo editar_global.
        abort_unless(\App\Support\Tenant::editarGlobal(), 403, 'La unidad tributaria la administra la plataforma: tu tienda la consulta pero no la modifica.');
        $d = $r->validate(['desde' => 'required|date_format:Y-m-d', 'valor' => 'required|numeric|gt:0|max:99999999', 'nota' => 'nullable|string|max:120']);
        try { DB::statement('SELECT fn_islr_guardar_ut(?::date, ?::numeric, ?::text, ?::bigint)', [$d['desde'], $d['valor'], $d['nota'] ?? null, auth()->id()]); }
        catch (QueryException $e) { return response()->json(['message' => $this->mensaje($e, 'No se pudo guardar la unidad tributaria.')], 422); }
        return response()->json(['ok' => true]);
    }

    public function guardarConfig(Request $r)
    {
        abort_unless($this->instalado(), 422, 'Falta ejecutar 20_retenciones_islr.sql en la base de datos.');
        $d = $r->validate(['sustraendo_una_vez_mes' => 'required|boolean']);
        DB::statement('UPDATE islr_config SET sustraendo_una_vez_mes = ?::boolean WHERE id = fn_negocio_actual()', [$d['sustraendo_una_vez_mes'] ? 'true' : 'false']);
        return response()->json(['ok' => true]);
    }

    /** Datos del comprobante para imprimir (agente de retención + beneficiario + cálculo). */
    public function comprobante(int $id)
    {
        abort_unless($this->instalado(), 422, 'Falta ejecutar 20_retenciones_islr.sql en la base de datos.');
        $x = DB::selectOne('SELECT r.*, c.nombre AS concepto_nombre FROM retenciones_islr r JOIN islr_conceptos c ON c.codigo = r.concepto WHERE r.id = ?', [$id]);
        abort_unless($x, 404);
        $n = DB::selectOne('SELECT razon_social, nombre_comercial, rif, direccion_fiscal FROM negocio LIMIT 1');
        return response()->json([
            'numero' => $x->numero, 'fecha' => $x->fecha, 'estado' => $x->estado, 'motivo_anulacion' => $x->motivo_anulacion,
            'agente' => ['razon_social' => $n->razon_social, 'comercial' => $n->nombre_comercial, 'rif' => $n->rif, 'direccion' => $n->direccion_fiscal],
            'beneficiario' => $x->beneficiario, 'rif' => $x->rif, 'tipo' => $x->tipo_beneficiario, 'concepto' => $x->concepto_nombre, 'documento' => $x->documento,
            'moneda' => trim($x->moneda), 'monto' => (float) $x->monto_orig, 'tasa' => (float) $x->tasa_ves, 'base_ves' => (float) $x->base_ves, 'porcentaje' => (float) $x->porcentaje,
            'ut' => $x->ut_ves !== null ? (float) $x->ut_ves : null, 'sustraendo_ves' => (float) $x->sustraendo_ves, 'retenido_ves' => (float) $x->retenido_ves, 'neto_ves' => (float) $x->neto_pagado_ves,
        ]);
    }

    /** Los procedimientos de la base lanzan mensajes en español (TV005/TV006): se muestran tal cual. */
    private function mensaje(QueryException $e, string $porDefecto): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }
}
