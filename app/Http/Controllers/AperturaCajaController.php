<?php

namespace App\Http\Controllers;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Turnos de caja (database/sql/14_aperturas_caja.sql). Controlador delgado: la apertura, el cierre y las cifras del turno
 * las hacen fn_abrir_caja, fn_cerrar_apertura y fn_resumen_apertura en PostgreSQL (con bloqueo consultivo por usuario).
 * Sin turno abierto el POS no vende (lo exige CajaController::registrarDatos).
 */
class AperturaCajaController extends Controller
{
    /** Turno abierto del usuario como arreglo (o null). Lo usa también el POS al cargar. */
    public function activa(?int $usuarioId = null): ?array
    {
        $a = DB::selectOne("SELECT a.id, a.fecha_apertura, a.fondo_inicial_usd, a.fondo_inicial_ves FROM aperturas_caja a
                             WHERE a.usuario_id = ? AND a.estado = 'ABIERTA'", [$usuarioId ?? auth()->id()]);
        return $a ? ['id' => (int) $a->id, 'fecha_apertura' => $a->fecha_apertura, 'fondo_usd' => (float) $a->fondo_inicial_usd, 'fondo_ves' => (float) $a->fondo_inicial_ves] : null;
    }

    /** GET /caja/apertura → turno activo o null. */
    public function estadoActual()
    {
        return response()->json(['apertura' => $this->activa()]);
    }

    /** POST /caja/apertura {fondo_inicial_usd, fondo_inicial_ves} */
    public function store(Request $r)
    {
        $d = $r->validate([
            'fondo_inicial_usd' => 'nullable|numeric|min:0|max:999999999',
            'fondo_inicial_ves' => 'nullable|numeric|min:0|max:999999999999',
        ], ['fondo_inicial_usd.min' => 'El fondo no puede ser negativo.', 'fondo_inicial_ves.min' => 'El fondo no puede ser negativo.']);
        try {
            DB::scalar('SELECT fn_abrir_caja(?, ?, ?)', [auth()->id(), (float) ($d['fondo_inicial_usd'] ?? 0), (float) ($d['fondo_inicial_ves'] ?? 0)]);
        } catch (QueryException $e) {
            return response()->json(['message' => $this->mensaje($e, 'No se pudo abrir la caja.')], 422);
        }
        return response()->json(['apertura' => $this->activa()]);
    }

    /**
     * Marca el turno como CERRADO. No es una ruta suelta: la llama CierreCajaController::store dentro de su transacción,
     * después de guardar el conteo, para que no se pueda cerrar un turno sin contar el efectivo.
     */
    public function cerrar(int $aperturaId): void
    {
        DB::select('SELECT fn_cerrar_apertura(?, ?)', [$aperturaId, auth()->id()]);
    }

    /** GET /caja/corte-x → resumen parcial del turno abierto (no cierra nada). */
    public function corteX()
    {
        $a = $this->activa();
        if (! $a) {
            return response()->json(['message' => 'No tienes una caja abierta.'], 422);
        }
        return response()->json($this->resumen($a['id']));
    }

    /** Resumen del turno (Corte X / Z) con los datos del emisor para el ticket. */
    public function resumen(int $aperturaId): array
    {
        $r = json_decode(DB::scalar('SELECT fn_resumen_apertura(?)::text', [$aperturaId]), true);
        $n = DB::table('negocio')->first(['razon_social', 'nombre_comercial', 'rif', 'direccion_fiscal']);
        $r['emisor'] = ['razon_social' => $n->razon_social, 'comercial' => $n->nombre_comercial, 'rif' => $n->rif, 'direccion' => $n->direccion_fiscal];
        return $r;
    }

    private function mensaje(QueryException $e, string $porDefecto): string
    {
        if ($e->getCode() === '23505') {
            return 'Ya tienes una caja abierta.';
        }
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }
}
