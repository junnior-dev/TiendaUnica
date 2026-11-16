<?php

namespace App\Http\Controllers;

use App\Support\Permisos;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Inertia\Inertia;

/**
 * Usuarios (/usuarios). Solo administradores.
 *   Lista    → cada persona con su rol, estado, último acceso y lo que ha vendido en 30 días; más la matriz de accesos por rol (App\Support\Permisos)
 *   Alta     → usuario, nombre, rol y contraseña temporal: la persona debe cambiarla al entrar (debe_cambiar_password, ver AccesoPorRol)
 *   Cambios  → nombre y rol; restablecer contraseña (otra temporal); activar o desactivar (nunca se borra: ventas y compras guardan quién las hizo)
 * Reglas: no puedes quitarte tu propio rol ni desactivarte; el sistema siempre conserva al menos un administrador activo.
 * La contraseña se guarda con bcrypt y solo cambia con sp_cambiar_password. Los métodos de datos son públicos para poder probarlos sin HTTP.
 */
class UsuariosController extends Controller
{
    use ContextoPagina;

    private const ROLES = ['ADMINISTRADOR', 'CAJERO'];

    public function index(Request $r)
    {
        $this->soloAdmin();
        return Inertia::render('Usuarios/Index', [...$this->contexto(), ...$this->datosPagina((int) auth()->id())]);
    }

    private function soloAdmin(): void
    {
        abort_if(! Permisos::esAdmin(auth()->user()->rol ?? ''), 403, 'Solo un administrador puede gestionar usuarios.');
    }

    private function mensaje(\Throwable $e, string $porDefecto): string
    {
        return preg_match('/ERROR:\s*(.+?)(?:\s*CONTEXT:|\n|\(Connection|$)/su', $e->getMessage(), $m) ? trim($m[1]) : $porDefecto;
    }

    /* ───────────── Datos de la página ───────────── */

    public function datosPagina(int $yo): array
    {
        $filas = DB::select("SELECT u.id, u.username, u.nombre_completo, u.rol, u.activo, u.debe_cambiar_password, (u.password_hash = 'PENDIENTE') AS sin_clave,
                                    to_char(u.ultimo_acceso AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD\"T\"HH24:MI') AS ultimo_acceso,
                                    to_char(u.created_at AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD') AS creado,
                                    COALESCE(v.n, 0) AS ventas_30, COALESCE(v.usd, 0) AS usd_30, v.ultima AS ultima_venta, COALESCE(t.n, 0) AS ventas_total
                               FROM usuarios u
                               LEFT JOIN (SELECT usuario_id, count(*) AS n, sum(total_usd) AS usd, max(COALESCE(fecha_valor, fecha_hora::date)) AS ultima
                                            FROM ventas WHERE estado = 'COMPLETADA' AND COALESCE(fecha_valor, fecha_hora::date) > fn_hoy() - 30 GROUP BY usuario_id) v ON v.usuario_id = u.id
                               LEFT JOIN (SELECT usuario_id, count(*) AS n FROM ventas GROUP BY usuario_id) t ON t.usuario_id = u.id
                              ORDER BY u.activo DESC, (u.rol = 'ADMINISTRADOR') DESC, lower(u.nombre_completo)");
        $usuarios = array_map(fn ($u) => [
            'id' => (int) $u->id, 'username' => $u->username, 'nombre' => $u->nombre_completo, 'rol' => $u->rol, 'activo' => (bool) $u->activo,
            'debe_cambiar' => (bool) $u->debe_cambiar_password, 'sin_clave' => (bool) $u->sin_clave, 'ultimo_acceso' => $u->ultimo_acceso, 'creado' => $u->creado,
            'ventas_30' => (int) $u->ventas_30, 'usd_30' => round((float) $u->usd_30, 2), 'ultima_venta' => $u->ultima_venta, 'ventas_total' => (int) $u->ventas_total, 'es_yo' => (int) $u->id === $yo,
        ], $filas);
        $act = array_filter($usuarios, fn ($u) => $u['activo']);
        return [
            'hoy' => (string) DB::scalar('SELECT fn_hoy()'), 'usuarios' => array_values($usuarios), 'matriz' => Permisos::matriz(),
            'resumen' => [
                'activos' => count($act), 'admins' => count(array_filter($act, fn ($u) => $u['rol'] === 'ADMINISTRADOR')), 'cajeros' => count(array_filter($act, fn ($u) => $u['rol'] === 'CAJERO')),
                'desactivados' => count($usuarios) - count($act), 'pendientes' => count(array_filter($act, fn ($u) => $u['debe_cambiar'] || $u['sin_clave'])),
            ],
        ];
    }

    private function ficha(int $id, int $yo): ?array
    {
        foreach ($this->datosPagina($yo)['usuarios'] as $u) {
            if ($u['id'] === $id) return $u;
        }
        return null;
    }

    /* ───────────── Altas y cambios ───────────── */

    private function respuesta(array $datos, int $codigo = 200)
    {
        // Auditoría B-7 (mejora 6): estas respuestas pueden llevar la CLAVE
        // TEMPORAL de un usuario nuevo o restablecido. no-store evita que la
        // guarde un proxy, la caché del navegador o el histórico.
        return response()->json($datos, $codigo)->header('Cache-Control', 'no-store, no-cache, must-revalidate');
    }

    private function falla(string $mensaje, string $campo = 'general'): array
    {
        return [['message' => $mensaje, 'errors' => [$campo => [$mensaje]]], 422];
    }

    /** @return array{0:array,1:int} [cuerpo, código HTTP] */
    public function crear(array $d, int $yo): array
    {
        // Payload hostil: los campos pueden llegar como ARRAY y el cast
        // (string) directo emite «Array to string conversion», que el handler
        // de errores de Laravel convierte en 500. Solo el texto plano es
        // entrada válida; lo demás cae a '' y lo rechaza la validación.
        $texto = static fn ($v): string => is_scalar($v) ? (string) $v : '';
        $username = strtolower(trim($texto($d['username'] ?? '')));
        $nombre = trim($texto($d['nombre'] ?? ''));
        $rol = strtoupper($texto($d['rol'] ?? ''));
        $clave = $texto($d['password'] ?? '');
        if (strlen($nombre) < 3) return $this->falla('Escribe el nombre completo.', 'nombre');
        if (! preg_match('/^[a-z0-9._-]{3,40}$/', $username)) return $this->falla('El usuario lleva de 3 a 40 letras minúsculas, números, punto, guion o guion bajo, sin espacios.', 'username');
        if (! in_array($rol, self::ROLES, true)) return $this->falla('Elige el rol de la persona.', 'rol');
        if (strlen($clave) < 8) return $this->falla('La contraseña temporal debe tener al menos 8 caracteres.', 'password');
        try {
            DB::statement('CALL sp_crear_usuario(?, ?, ?, ?, true)', [$username, Hash::make($clave), $nombre, $rol]);
        } catch (QueryException $e) {
            return $e->getCode() === '23505' ? $this->falla('Ya existe un usuario con ese nombre de usuario.', 'username') : $this->falla($this->mensaje($e, 'No se pudo crear el usuario.'));
        }
        $id = (int) DB::scalar('SELECT id FROM usuarios WHERE lower(username) = ?', [$username]);
        return [['ok' => true, 'usuario' => $this->ficha($id, $yo), 'clave' => $clave], 200];
    }

    private function adminsActivosAparte(int $id): int
    {
        return (int) DB::scalar("SELECT count(*) FROM usuarios WHERE rol = 'ADMINISTRADOR' AND activo AND id <> ?", [$id]);
    }

    /** Nombre y rol. */
    public function cambiar(int $id, array $d, int $yo): array
    {
        $u = DB::selectOne('SELECT id, rol, activo FROM usuarios WHERE id = ?', [$id]);
        if (! $u) return $this->falla('Ese usuario no existe.');
        $nombre = trim((string) ($d['nombre'] ?? ''));
        $rol = strtoupper((string) ($d['rol'] ?? $u->rol));
        if (strlen($nombre) < 3) return $this->falla('Escribe el nombre completo.', 'nombre');
        if (! in_array($rol, self::ROLES, true)) return $this->falla('Elige el rol de la persona.', 'rol');
        if ($rol !== $u->rol) {
            if ($id === $yo) return $this->falla('No puedes cambiar tu propio rol: pídeselo a otro administrador.', 'rol');
            if ($u->rol === 'ADMINISTRADOR' && $u->activo && $this->adminsActivosAparte($id) === 0) return $this->falla('Debe quedar al menos un administrador activo.', 'rol');
        }
        DB::update('UPDATE usuarios SET nombre_completo = ?, rol = ? WHERE id = ?', [$nombre, $rol, $id]);
        return [['ok' => true, 'usuario' => $this->ficha($id, $yo)], 200];
    }

    /** Contraseña temporal nueva: la persona deberá cambiarla al entrar. */
    public function nuevaClave(int $id, string $clave, int $yo): array
    {
        if (! DB::selectOne('SELECT 1 FROM usuarios WHERE id = ?', [$id])) return $this->falla('Ese usuario no existe.');
        if (strlen($clave) < 8) return $this->falla('La contraseña temporal debe tener al menos 8 caracteres.', 'password');
        try {
            DB::transaction(function () use ($id, $clave) {
                DB::statement('CALL sp_cambiar_password(?, ?)', [$id, Hash::make($clave)]);
                DB::update('UPDATE usuarios SET debe_cambiar_password = true WHERE id = ?', [$id]);
            });
        } catch (QueryException $e) {
            return $this->falla($this->mensaje($e, 'No se pudo cambiar la contraseña.'));
        }
        return [['ok' => true, 'usuario' => $this->ficha($id, $yo), 'clave' => $clave], 200];
    }

    public function cambiarEstado(int $id, bool $activo, int $yo): array
    {
        $u = DB::selectOne('SELECT id, activo FROM usuarios WHERE id = ?', [$id]);
        if (! $u) return $this->falla('Ese usuario no existe.');
        if (! $activo && $id === $yo) return $this->falla('No puedes desactivarte a ti mismo.');
        try {
            if ($activo) DB::update('UPDATE usuarios SET activo = true WHERE id = ?', [$id]);
            else DB::statement('CALL sp_desactivar_usuario(?)', [$id]);
        } catch (QueryException $e) {
            return $this->falla($this->mensaje($e, 'No se pudo cambiar el estado.'));
        }
        return [['ok' => true, 'usuario' => $this->ficha($id, $yo)], 200];
    }

    /* ───────────── HTTP ───────────── */

    public function store(Request $r)
    {
        $this->soloAdmin();
        [$d, $c] = $this->crear($r->only(['username', 'nombre', 'rol', 'password']), (int) auth()->id());
        return $this->respuesta($d, $c);
    }

    public function update(Request $r, int $id)
    {
        $this->soloAdmin();
        [$d, $c] = $this->cambiar($id, $r->only(['nombre', 'rol']), (int) auth()->id());
        return $this->respuesta($d, $c);
    }

    public function restablecer(Request $r, int $id)
    {
        $this->soloAdmin();
        [$d, $c] = $this->nuevaClave($id, (string) $r->input('password', ''), (int) auth()->id());
        return $this->respuesta($d, $c);
    }

    public function estado(Request $r, int $id)
    {
        $this->soloAdmin();
        [$d, $c] = $this->cambiarEstado($id, $r->boolean('activo'), (int) auth()->id());
        return $this->respuesta($d, $c);
    }
}
