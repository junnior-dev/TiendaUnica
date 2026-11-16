<?php

namespace App\Http\Controllers\Portal;

use App\Http\Controllers\Controller;
use App\Support\Portal;
use App\Support\PortalConsultas;
use App\Support\Propagador;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Panel del SUPER ADMINISTRADOR del portal: todas las tiendas (tenants) de la
 * plataforma con su plan y estado, la cola de pagos reportados para verificar
 * contra el estado de cuenta bancario, la tasa del día y las cuentas de cobro.
 *
 * Es la única página del sistema que consulta portal_saas a manos libres. La
 * protege una contraseña única del operador (PORTAL_ADMIN_PASSWORD en .env):
 * no es login de usuario, es una puerta de mantenimiento del negocio.
 */
class PortalAdminController extends Controller
{
    /** Puerta: pide la contraseña del operador del portal. */
    public function login()
    {
        return Inertia::render('Portal/Login');
    }

    public function autenticar(Request $r)
    {
        $clave = (string) config('saas.portal_admin_password');
        if ($clave === '') {
            return back()->withErrors(['password' => 'El panel del portal está deshabilitado: define PORTAL_ADMIN_PASSWORD en el .env del servidor.']);
        }
        // Auditoría M-1: comparación en tiempo constante (hash_equals).
        if (! hash_equals($clave, (string) $r->input('password'))) {
            return back()->withErrors(['password' => 'Contraseña incorrecta.']);
        }
        $r->session()->put('portal_admin', true);
        $r->session()->regenerate();   // nueva sesión tras autenticar (fijación de sesión)

        return redirect('/portal');
    }

    /** Cerrar la puerta: el operador sale del panel. */
    public function salir(Request $r)
    {
        $r->session()->forget('portal_admin');

        return redirect('/portal/login');
    }

    private function autorizado(Request $r): bool
    {
        return (bool) $r->session()->get('portal_admin') && (string) config('saas.portal_admin_password') !== '';
    }

    /** Vuelve a la pantalla de donde vino (con sus filtros y su página); sin referencia, al resumen. */
    private function volver()
    {
        return redirect()->back(302, [], '/portal');
    }

    /**
     * Panel del super administrador, una vista por pantalla (?vista=resumen|tiendas|pagos|ajustes). Solo se consulta
     * lo que la vista muestra; las tablas filtran, ordenan y paginan en el servidor (App\Support\PortalConsultas).
     */
    public function index(Request $r)
    {
        if (! $this->autorizado($r)) {
            return redirect('/portal/login');
        }
        $p = DB::connection('portal');
        $vista = in_array($r->query('vista'), ['resumen', 'tiendas', 'pagos', 'ajustes'], true) ? $r->query('vista') : 'resumen';
        $por = PortalConsultas::por($r->query('por'));
        $pagina = PortalConsultas::pagina($r->query('pagina'));
        $f = [
            'q' => (string) $r->query('q', ''), 'estado' => (string) $r->query('estado', ''), 'plan' => (int) $r->query('plan', 0),
            'orden' => (string) $r->query('orden', 'atencion'), 'resultado' => (string) $r->query('resultado', ''),
        ];
        $seg = in_array($r->query('seg'), ['pendientes', 'historial', 'cobros'], true) ? $r->query('seg') : 'pendientes';
        $filas = fn (array $q) => $p->select($q[0], $q[1]);
        $uno = fn (array $q) => $p->selectOne($q[0], $q[1]);
        // Primero el total, para ajustar una página fuera de rango (?pagina=99) a la última antes de pedir las filas.
        $paginar = function (callable $consulta) use ($filas, $uno, $pagina, $por) {
            $total = $uno($consulta(1)['total']);
            $meta = PortalConsultas::meta((int) $total->n, $pagina, $por);

            return [$filas($consulta($meta['pagina'])['filas']), $meta, $total];
        };

        $pendientes = $p->table('v_solicitudes_pendientes')->get();
        $datos = [
            'vista' => $vista, 'seg' => $seg, 'filtros' => $f + ['por' => $por],
            'tasa' => Portal::tasa(), 'n_pendientes' => $pendientes->count(),
            'kpis' => $p->selectOne(<<<'SQL'
                SELECT
                    COALESCE(SUM(pl.precio_usd) FILTER (WHERE np.estado = 'ACTIVO'), 0)::float AS mrr_usd,
                    COUNT(*) FILTER (WHERE np.estado = 'ACTIVO') AS activos,
                    COUNT(*) FILTER (WHERE np.estado = 'PRUEBA') AS en_demo,
                    COUNT(*) FILTER (WHERE np.estado = 'MORA') AS en_mora,
                    COUNT(*) FILTER (WHERE np.estado = 'SUSPENDIDO') AS suspendidos,
                    COUNT(*) AS total
                FROM portal.negocios_portal np JOIN portal.planes pl ON pl.id = np.plan_id
            SQL),
        ];
        if ($vista === 'resumen') {
            $datos += ['pendientes' => $pendientes->take(3)->values(), 'por_vencer' => $filas(PortalConsultas::porVencer())];
        }
        if ($vista === 'tiendas') {
            [$lista, $meta] = $paginar(fn ($pg) => PortalConsultas::tiendas($f, $pg, $por));
            $conteos = PortalConsultas::conteos();
            $datos += [
                'filas' => $lista, 'meta' => $meta,
                'por_estado' => collect($p->select($conteos['estados']))->pluck('n', 'estado'), 'planes' => $p->select($conteos['planes']),
            ];
        }
        if ($vista === 'pagos') {
            $datos['pendientes'] = $pendientes;
            if ($seg === 'historial') {
                [$lista, $meta] = $paginar(fn ($pg) => PortalConsultas::historial($f, $pg, $por));
                $datos += ['filas' => $lista, 'meta' => $meta];
            } elseif ($seg === 'cobros') {
                [$lista, $meta, $t] = $paginar(fn ($pg) => PortalConsultas::cobros($f, $pg, $por));
                $datos += ['filas' => $lista, 'meta' => $meta, 'suma' => (float) $t->suma];
            }
        }
        if ($vista === 'ajustes') {
            $datos['cuentas'] = $p->table('cuentas_banco')->where('activo', true)->orderBy('moneda')->get();
        }

        return Inertia::render('Portal/Index', $datos);
    }

    /** Veredicto humano sobre un pago reportado: aprobar o rechazar con motivo. */
    public function verificarPago(Request $r, int $solicitud)
    {
        abort_unless($this->autorizado($r), 403, 'Solo el operador del portal puede verificar pagos.');
        $d = $r->validate(['aprobar' => 'required|boolean', 'motivo' => 'nullable|string|max:300']);
        try {
            Portal::llamar('portal.fn_verificar_pago(?,?,?)', [
                $solicitud, $r->boolean('aprobar'), 'portal',
                $d['motivo'] ?? null,
            ]);
        } catch (\RuntimeException $e) {
            return back()->withErrors(['general' => $e->getMessage()]);
        }
        if ($r->boolean('aprobar') && ($falla = Propagador::intentar())) {
            return $this->volver()->with('ok', 'Pago verificado en el portal.')->withErrors(['general' => $falla]);
        }

        return $this->volver()->with('ok', $r->boolean('aprobar')
            ? 'Pago verificado: la suscripción del cliente quedó activa.'
            : 'Pago rechazado: el cliente ve el motivo en su panel.');
    }

    /** Publica la tasa USD→VES del día (para convertir los pagos en bolívares). */
    public function publicarTasa(Request $r)
    {
        abort_unless($this->autorizado($r), 403, 'Solo el operador del portal puede publicar la tasa.');
        $d = $r->validate(['tasa' => 'required|numeric|gt:0']);
        try {
            Portal::llamar('portal.fn_publicar_tasa(?)::numeric', [(float) str_replace(',', '.', $d['tasa'])]);
        } catch (\RuntimeException $e) {
            return back()->withErrors(['general' => $e->getMessage()]);
        }

        return $this->volver()->with('ok', 'Tasa del día publicada.');
    }

    /** Suspender o reactivar una tienda (el propagador lo escribe en su base). */
    public function cambiarEstado(Request $r, int $tenant)
    {
        abort_unless($this->autorizado($r), 403, 'Solo el operador del portal puede suspender o reactivar tiendas.');
        $d = $r->validate(['accion' => 'required|in:suspender,reactivar', 'motivo' => 'nullable|string|max:300']);
        try {
            if ($d['accion'] === 'suspender') {
                Portal::llamar('portal.fn_suspender(?,?)', [$tenant, $d['motivo'] ?? 'Suspensión manual del portal']);
            } else {
                Portal::llamar('portal.fn_reactivar(?)', [$tenant]);
            }
        } catch (\RuntimeException $e) {
            return back()->withErrors(['general' => $e->getMessage()]);
        }

        if ($falla = Propagador::intentar()) {
            return $this->volver()->withErrors(['general' => $falla]);
        }

        return $this->volver()->with('ok', $d['accion'] === 'suspender' ? 'Tienda suspendida.' : 'Tienda reactivada.');
    }

    /** Registrar una cuenta de cobro (pago móvil o transferencia) nueva. */
    public function guardarCuenta(Request $r)
    {
        abort_unless($this->autorizado($r), 403, 'Solo el operador del portal puede administrar cuentas de cobro.');
        $d = $r->validate([
            'banco' => 'required|string|max:60', 'tipo_cuenta' => 'required|in:pago móvil,corriente,ahorros',
            'numero' => 'required|string|max:40', 'titular' => 'required|string|max:120',
            'rif_titular' => 'required|string|max:20', 'moneda' => 'required|in:BS,USD',
            'notas' => 'nullable|string|max:200',
        ]);
        DB::connection('portal')->table('cuentas_banco')->insert([
            'banco' => $d['banco'], 'tipo_cuenta' => $d['tipo_cuenta'], 'numero' => $d['numero'],
            'titular' => $d['titular'], 'rif_titular' => $d['rif_titular'], 'moneda' => $d['moneda'],
            'notas' => $d['notas'] ?? null,
        ]);

        return $this->volver()->with('ok', 'Cuenta de cobro guardada.');
    }
}
