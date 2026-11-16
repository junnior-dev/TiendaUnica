<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Inertia\Inertia;

class LoginController extends Controller
{
    public function create() { return Inertia::render('Auth/Login'); }

    public function store(Request $r)
    {
        $c = $r->validate(['username' => 'required|string', 'password' => 'required|string']);
        // Solo usuarios activos; password_hash 'PENDIENTE' nunca coincide con bcrypt.
        if (! Auth::attempt(['username' => $c['username'], 'password' => $c['password'], 'activo' => true], $r->boolean('remember'))) {
            return back()->withErrors(['username' => 'Usuario o contraseña incorrectos.']);
        }
        $r->session()->regenerate();
        // Re-hash controlado (D-1): si el hash guardado usa un costo o algoritmo
        // anterior a la configuración vigente, se moderniza tras un login exitoso
        // por el único camino que el trigger admite (sp_rehash_password, que activa
        // tienda.cambiando_password dentro de su transacción). NO se usa el rehash
        // nativo de Laravel (rehash_on_login = false): haría un UPDATE directo sobre
        // password_hash y el trigger trg_usuarios_antes lo rechazaría con TV005.
        // La contraseña efectiva y debe_cambiar_password no cambian: el usuario
        // acaba de demostrar que conoce la actual.
        $hashGuardado = Auth::user()->getAuthPassword();
        if (Hash::needsRehash($hashGuardado)) {
            DB::statement('CALL sp_rehash_password(?, ?)', [Auth::id(), Hash::make($c['password'])]);
        }
        DB::statement('CALL sp_registrar_login(?)', [Auth::id()]);
        return redirect()->intended(\App\Support\Permisos::inicio(Auth::user()->rol));
    }

    public function destroy(Request $r)
    {
        Auth::logout();
        $r->session()->invalidate();
        $r->session()->regenerateToken();
        return redirect('/login');
    }
}
