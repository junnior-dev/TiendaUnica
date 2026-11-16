<?php

namespace App\Http\Controllers;

use App\Support\Permisos;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;

/** Mi contraseña (/cuenta/contrasena): la usa cualquier usuario, y es la única pantalla abierta mientras tenga una contraseña temporal. */
class CuentaController extends Controller
{
    public function contrasena()
    {
        $u = auth()->user();
        return Inertia::render('Auth/CambiarPassword', ['obligatorio' => (bool) $u->debe_cambiar_password, 'nombre' => $u->nombre_completo, 'inicio' => Permisos::inicio($u->rol)]);
    }

    public function guardar(Request $r)
    {
        $u = auth()->user();
        $d = $r->validate([
            'actual' => 'required|string', 'nueva' => 'required|string|min:8|max:72|confirmed',
        ], ['nueva.min' => 'La contraseña nueva debe tener al menos 8 caracteres.', 'nueva.confirmed' => 'Las dos contraseñas nuevas no coinciden.', 'actual.required' => 'Escribe tu contraseña actual.', 'nueva.required' => 'Escribe la contraseña nueva.']);
        if (! Hash::check($d['actual'], $u->getAuthPassword())) {
            throw ValidationException::withMessages(['actual' => 'Esa no es tu contraseña actual.']);
        }
        if ($d['nueva'] === $d['actual']) {
            throw ValidationException::withMessages(['nueva' => 'Elige una contraseña distinta a la actual.']);
        }
        DB::statement('CALL sp_cambiar_password(?, ?)', [$u->id, Hash::make($d['nueva'])]);
        return redirect(Permisos::inicio($u->rol))->with('ok', 'Contraseña cambiada.');
    }
}
