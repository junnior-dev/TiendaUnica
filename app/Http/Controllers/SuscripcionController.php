<?php

namespace App\Http\Controllers;

use App\Support\Portal;
use App\Support\Tenant;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

/**
 * Panel de suscripción de la tienda (solo el dueño/admin la ve): el estado de
 * su demo o plan, los días que le quedan, el historial de cobros y el
 * formulario para reportar su pago por pago móvil o transferencia.
 *
 * La base de la tienda no conoce el portal: este controller lee y escribe el
 * registro comercial POR EL CAMINO DEL PORTAL (App\Support\Portal), filtrando
 * siempre por SU negocio_id, y el SQL del portal valida el resto.
 */
class SuscripcionController extends Controller
{
    /** Datos de la página /suscripcion. */
    public function index()
    {
        $estado = Tenant::estado() ?? [];
        $portal = Portal::negocioPortal();
        $p = DB::connection('portal');

        $plan = $portal ? $p->table('planes')->where('id', $portal->plan_id)->first() : null;
        $cobros = $portal ? $p->table('cobros')->where('negocio_portal_id', $portal->id)
            ->orderByDesc('periodo')->limit(12)->get() : [];
        $solicitudes = $portal ? $p->table('solicitudes_pago')->where('negocio_portal_id', $portal->id)
            ->orderByDesc('creado_en')->limit(12)->get() : [];

        return Inertia::render('Suscripcion/Index', [
            'usuario' => ['nombre' => auth()->user()->nombre_completo, 'rol' => ucfirst(strtolower(auth()->user()->rol))],
            'negocio' => DB::table('negocio')->where('id', Tenant::id())->value(DB::raw('COALESCE(nombre_comercial, razon_social)')),
            'actual' => '/suscripcion',
            'tienda' => [
                'subdominio' => $estado['subdominio'] ?? null,
                'plan' => $estado['plan'] ?? null,
                'activo' => $estado['activo'] ?? false,
                'fiscal' => Tenant::modulo('fiscal'),
            ],
            'suscripcion' => $portal ? [
                'estado' => $portal->estado,
                'vence_el' => $portal->vence_el,
                'dias_restantes' => $portal->vence_el ? now()->diffInDays(\Carbon\Carbon::parse($portal->vence_el), false) + 1 : null,
                'correo_facturacion' => $portal->correo_facturacion,
            ] : null,
            'plan' => $plan ? ['nombre' => $plan->nombre, 'precio' => (float) $plan->precio_usd, 'notas' => $plan->notas] : null,
            'cobros' => $cobros,
            'solicitudes' => $solicitudes,
            'tasa' => Portal::tasa(),
            'cuentas' => $p->table('cuentas_banco')->where('activo', true)->orderBy('moneda')->get(),
            'instrucciones' => $p->table('config')->where('clave', 'instrucciones')->value('valor'),
        ]);
    }

    /** Elige el plan definitivo (al convertir la demo) y reporta el pago. */
    public function reportarPago(Request $r)
    {
        $d = $r->validate([
            'plan' => 'required|in:SISTEMA,ESPECIAL',
            'moneda' => 'required|in:BS,USD',
            'banco_origen' => 'required|string|max:80',
            'referencia' => 'required|string|max:60',
            'pagado_el' => 'required|date',
            'nota' => 'nullable|string|max:300',
        ]);

        $portal = Portal::negocioPortal();
        if (! $portal) {
            return back()->withErrors(['general' => 'No encontramos el registro comercial de tu tienda. Escribe a soporte.']);
        }

        try {
            // 1) El plan elegido queda registrado en el portal (y el propagador
            //    escribe plan y módulos en estado_tenants a diario).
            Portal::llamar('portal.fn_cambiar_plan(?,?)', [$portal->id, $d['plan']]);
            // 2) El pago reportado queda en REPORTADO hasta que lo verifiquen.
            Portal::llamar('portal.fn_reportar_pago(?,?,?,?,?,?)::integer', [
                $portal->id, now()->toDateString(), strtoupper($d['moneda']),
                $d['banco_origen'], $d['referencia'], $d['pagado_el'], $d['nota'] ?? null,
            ]);
        } catch (\RuntimeException $e) {
            return back()->withErrors(['general' => $e->getMessage()]);
        }

        return redirect('/suscripcion')->with('ok', '¡Pago reportado! Lo verificamos contra el estado de cuenta y tu plan se activa de inmediato.');
    }
}
