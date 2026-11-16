<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;

/**
 * Métodos de pago (database/sql/17_metodos_pago.sql). Las reglas (moneda fija si ya se usó, IGTF solo en divisas, no cambiar
 * efectivo/IGTF con turnos abiertos, al menos un método activo…) las exige PostgreSQL; aquí solo se valida el formato y se
 * traduce el error de la base a un mensaje en el campo correspondiente. Solo administrador (AccesoPorRol + Permisos).
 */
class MetodosPagoController extends Controller
{
    use ContextoPagina;

    public function index()
    {
        $neg = DB::table('negocio')->first(['cobra_igtf', 'es_contribuyente_especial']);
        $cobra = (bool) $neg->cobra_igtf;
        return Inertia::render('MetodosPago/Index', $this->contexto() + [
            'metodos' => DB::select('SELECT * FROM v_metodos_pago_uso ORDER BY activo DESC, array_position(ARRAY[\'USD\',\'VES\',\'EUR\',\'COP\'], moneda::text), nombre'),
            'monedas' => DB::table('monedas')->where('activa', true)->orderBy('codigo')->get(['codigo', 'nombre'])->map(fn ($m) => ['codigo' => trim($m->codigo), 'nombre' => $m->nombre]),
            'cuentas' => DB::select("SELECT id, codigo, nombre FROM plan_cuentas WHERE activa AND permite_movimiento AND tipo = 'ACTIVO' AND codigo LIKE '1.1.%' ORDER BY codigo"),
            'igtf' => ['cobra' => $cobra, 'pct' => $cobra ? (float) DB::scalar('SELECT fn_igtf_pct(fn_hoy())') : 0.0],
            'turnos_abiertos' => (int) DB::table('aperturas_caja')->where('estado', 'ABIERTA')->count(),
        ]);
    }

    public function store(Request $r)
    {
        $d = $this->datos($r);
        $this->guardar(fn () => DB::transaction(function () use ($d) {
            $id = DB::table('metodos_pago')->insertGetId($this->fila($d), 'id');
            DB::statement('SELECT fn_guardar_cuenta_metodo(?::bigint, ?::bigint)', [$id, $d['cuenta_id'] ?? null]);
        }));
        return back()->with('ok', 'Método de pago creado.');
    }

    public function update(Request $r, int $id)
    {
        abort_unless(DB::table('metodos_pago')->where('id', $id)->exists(), 404);
        $d = $this->datos($r);
        $this->guardar(fn () => DB::transaction(function () use ($d, $id) {
            DB::table('metodos_pago')->where('id', $id)->update($this->fila($d));
            DB::statement('SELECT fn_guardar_cuenta_metodo(?::bigint, ?::bigint)', [$id, $d['cuenta_id'] ?? null]);
        }));
        return back()->with('ok', 'Método de pago guardado.');
    }

    public function estado(Request $r, int $id)
    {
        $this->guardar(fn () => DB::table('metodos_pago')->where('id', $id)->update(['activo' => $r->boolean('activo')]));
        return back()->with('ok', $r->boolean('activo') ? 'Método activado.' : 'Método desactivado: ya no se ofrece al cobrar.');
    }

    public function destroy(int $id)
    {
        $this->guardar(fn () => DB::table('metodos_pago')->where('id', $id)->delete());
        return back()->with('ok', 'Método eliminado.');
    }

    private function datos(Request $r): array
    {
        $d = $r->validate([
            'nombre' => 'required|string|min:2|max:60', 'moneda' => 'required|string|size:3|exists:monedas,codigo',
            'es_efectivo' => 'boolean', 'requiere_referencia' => 'boolean', 'aplica_igtf' => 'boolean', 'cuenta_id' => 'nullable|integer',
        ], ['nombre.required' => 'Escribe el nombre del método.', 'nombre.min' => 'Escribe el nombre del método.', 'moneda.exists' => 'Elige una moneda activa.']);
        $d['moneda'] = strtoupper($d['moneda']);
        foreach (['es_efectivo', 'requiere_referencia', 'aplica_igtf'] as $k) {
            $d[$k] = (bool) ($d[$k] ?? false);
        }
        return $d;
    }

    private function fila(array $d): array
    {
        return ['nombre' => trim($d['nombre']), 'moneda' => $d['moneda'], 'es_efectivo' => $d['es_efectivo'],
            'requiere_referencia' => $d['requiere_referencia'], 'aplica_igtf' => $d['aplica_igtf']];
    }

    /** Ejecuta y traduce el rechazo de la base (triggers TV005/TV006, nombre repetido) a un error de validación legible. */
    private function guardar(callable $f): void
    {
        try {
            $f();
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? '') === '23505') {
                throw ValidationException::withMessages(['nombre' => 'Ya tienes un método con ese nombre.']);
            }
            $msg = preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : 'No se pudo guardar el método de pago.';
            throw ValidationException::withMessages(['general' => $msg]);
        }
    }
}
