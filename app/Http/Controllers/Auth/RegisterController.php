<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Inertia\Inertia;

/** Asistente de primer inicio: llama, en una sola transacción, a los procedimientos del esquema tienda. */
class RegisterController extends Controller
{
    public function create()
    {
        // Si el asistente ya se confirmó, no hay nada que crear.
        if (DB::table('negocio')->whereNotNull('configurado_en')->exists()) return redirect('/login');
        return Inertia::render('Auth/Register');
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'nombre_completo' => 'required|string|min:2|max:200',
            'password' => ['required', 'confirmed', 'min:8', fn ($a, $v, $fail) => strlen($v) > 72 ? $fail('Máximo 72 bytes.') : null],
            'razon_social' => 'required|string|min:2|max:200',
            'nombre_comercial' => 'nullable|string|max:200',
            'rif' => ['required', 'regex:/^[JGVECPjgvecp]-?[0-9]{8}-?[0-9]$/'],
            'direccion_fiscal' => 'required|string|min:5',
            'telefono' => 'nullable|string|max:40',
            'correo' => 'nullable|email|max:150',
            'es_contribuyente_especial' => 'boolean', 'cobra_igtf' => 'boolean',
            'recupera_credito_fiscal' => 'boolean', 'precios_incluyen_iva' => 'boolean',
            'igtf_base' => 'in:CON_IVA,SIN_IVA', 'metodo_costo' => 'in:ULTIMO,PROMEDIO',
            'politica_costo_nuevo' => 'in:AVISAR,AUTOMATICO,NINGUNA',
            'margen_defecto_pct' => 'numeric|between:0,1000',
            'tasa' => 'required', 'tasa_eur' => 'nullable', 'tasa_cop' => 'nullable', 'fecha_tasa' => 'required|date', 'fuente_tasa' => 'in:BCV,MANUAL',
        ]);
        $tasa = (float) str_replace(',', '.', $d['tasa']);

        try {
            DB::transaction(function () use ($d, $tasa) {
                $admin = 1; // administrador semilla (usuarios.id = 1, username "admin")
                DB::statement('CALL sp_primer_admin(?, ?)', [Hash::make($d['password']), $d['nombre_completo']]);
                DB::statement('CALL sp_guardar_configuracion_negocio(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
                    $d['razon_social'], strtoupper($d['rif']), $d['direccion_fiscal'],
                    (bool) $d['es_contribuyente_especial'], (bool) $d['cobra_igtf'],
                    (bool) $d['recupera_credito_fiscal'], (bool) $d['precios_incluyen_iva'],
                    $d['politica_costo_nuevo'], $d['metodo_costo'], $d['margen_defecto_pct'], $d['igtf_base'],
                    $d['nombre_comercial'] ?? null, $d['telefono'] ?? null, $d['correo'] ?? null, $admin,
                ]);
                DB::statement("CALL sp_registrar_tasa(?,?,?,?,?,'USD','VES')", [
                    $tasa, $d['fecha_tasa'], $d['fuente_tasa'], $d['fuente_tasa'] === 'BCV', $admin,
                ]);
                // Euros y pesos: opcionales. Tasa en bolívares por 1 unidad de la moneda (COP ≈ 0,0125).
                foreach ([['EUR', $d['tasa_eur'] ?? null, $d['fuente_tasa'] === 'BCV'], ['COP', $d['tasa_cop'] ?? null, false]] as [$mon, $t, $oficial]) {
                    $t = (float) str_replace(',', '.', (string) $t);
                    if ($t > 0) DB::statement('CALL sp_registrar_tasa(?,?,?,?,?,?,?)', [$t, $d['fecha_tasa'], $oficial ? 'BCV' : 'MANUAL', $oficial, $admin, $mon, 'VES']);
                }
                DB::statement('CALL sp_confirmar_configuracion_inicial(?)', [$admin]);
            });
        } catch (\Illuminate\Database\QueryException $e) {
            // Los errores de negocio de la base (TV006…) traen un mensaje legible en español.
            preg_match('/ERROR:\s*(.+?)(\n|CONTEXT|\()/s', $e->getMessage(), $m);
            return back()->withErrors(['general' => trim($m[1] ?? 'No se pudo completar la configuración.')]);
        }
        return redirect('/login')->with('status', 'Cuenta creada. Ya puedes iniciar sesión.');
    }
}
