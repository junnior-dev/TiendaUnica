<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Support\Portal;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Inertia\Inertia;

/**
 * Registro self-service del SaaS: cualquier persona crea SU negocio nuevo con
 * 15 días de demo gratis, sin intervención de nadie.
 *
 * Es la cara web de fn_provisionar_negocio (base de la tienda: negocio con
 * catálogos heredados, admin propio y estado_tenants) + portal.fn_alta_tenant
 * (base del portal: registro comercial en PRUEBA hasta hoy + 15).
 *
 * A diferencia del asistente de /registro (que configura la tienda única local
 * una sola vez), este flujo se puede usar siempre y nunca toca a los demás
 * negocios. Al terminar redirige al login del SUBDOMINIO del cliente.
 */
class CrearCuentaController extends Controller
{
    public function create()
    {
        return Inertia::render('Auth/CrearCuenta', [
            'base' => rtrim((string) config('saas.base_domain'), '.'),
        ]);
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'razon_social' => 'required|string|min:2|max:200',
            'rif' => ['required', 'regex:/^[JGVECPjgvecp]-?[0-9]{8}-?[0-9]$/'],
            'nombre_comercial' => 'required|string|min:2|max:200',
            'telefono' => 'nullable|string|max:40',
            'correo' => 'nullable|email|max:150',
            'direccion_fiscal' => 'nullable|string|max:300',
            'admin_nombre' => 'required|string|min:2|max:200',
            'admin_username' => ['required', 'regex:/^[a-z0-9_.]{3,30}$/'],
            'password' => ['required', 'confirmed', 'min:8', fn ($a, $v, $fail) => strlen($v) > 72 ? $fail('Máximo 72 bytes.') : null],
            'subdominio' => ['required', 'regex:/^[a-z0-9][a-z0-9-]{1,39}$/'],
        ]);

        try {
            // 1) La tienda: negocio nuevo con catálogos, admin y estado_tenants.
            //    Auditoría A-2: la provisión exige superusuario (fn_provisionar_negocio
            //    lo valida), así que va por la conexión pgsql_admin (DB_ADMIN_USERNAME
            //    en producción) y NO por la conexión normal de la app (saas_app).
            $negocioId = DB::connection('pgsql_admin')->transaction(function () use ($d) {
                $id = DB::connection('pgsql_admin')->selectOne(
                    'SELECT fn_provisionar_negocio(?,?,?,?,?,?,?,?,?,?,?)',
                    [
                        $d['razon_social'], strtoupper($d['rif']), $d['subdominio'],
                        $d['admin_nombre'], Hash::make($d['password']), $d['admin_username'],
                        'DEMO', $d['telefono'] ?? null, $d['correo'] ?? null,
                        $d['direccion_fiscal'] ?? null, $d['nombre_comercial'],
                    ]
                )?->fn_provisionar_negocio;
                if (! $id) throw new \RuntimeException('No se pudo crear el negocio.');

                return (int) $id;
            });

            // 2) El portal: registro comercial con la demo de 15 días.
            Portal::llamar('portal.fn_alta_tenant(?,?,?,?,?,?)::integer', [
                $d['subdominio'], $negocioId, 'DEMO',
                DB::connection('pgsql')->getDatabaseName(), config('database.connections.pgsql.host'),
                $d['correo'] ?? null,
            ]);
        } catch (\RuntimeException $e) {
            return back()->withErrors(['general' => $e->getMessage()])->withInput();
        } catch (\Illuminate\Database\QueryException $e) {
            preg_match('/ERROR:\s*(.+?)(\n|CONTEXT|\()/s', $e->getMessage(), $m);
            $msg = trim($m[1] ?? 'No se pudo completar el registro.');
            if (str_contains($e->getMessage(), 'uq_usuarios_username')) {
                $msg = 'Ese usuario ya existe en la plataforma: elige otro nombre de usuario.';
            }

            return back()->withErrors(['general' => $msg])->withInput();
        }

        // Subdominio listo para entrar (en desarrollo, el archivo .env define
        // SAAS_BASE_DOMAIN; con hosts locales se apunta al mismo dominio).
        $base = rtrim((string) config('saas.base_domain'), '.');
        $url = 'https://'.$d['subdominio'].($base ? '.'.$base : '/');

        // Auditoría B-7 (mejora 6): el alta lleva datos sensibles del admin
        // recién creado; no deja copia en proxies ni cachés intermedias.
        return redirect()->away($url.'/login')
            ->with('ok', 'Tu tienda está lista: 15 días de demo con todo habilitado.')
            ->header('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
}
