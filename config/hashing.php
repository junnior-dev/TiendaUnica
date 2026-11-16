<?php

use Illuminate\Support\Str;

return [

    /*
    |--------------------------------------------------------------------------
    | ¿Re-hashear la contraseña al iniciar sesión?
    |--------------------------------------------------------------------------
    |
    | Laravel trae rehash_on_login = true: al entrar, si el costo o el algoritmo
    | del hash guardado ya no coincide con la configuración actual, re-escribe la
    | contraseña directamente. Este sistema NO puede hacer eso: la columna
    | usuarios.password_hash está protegida por el trigger trg_usuarios_antes
    | (SQL 03, error TV005) y solo puede cambiar mediante sp_primer_admin o
    | sp_cambiar_password. Si un usuario tuviera un hash con otro costo (p. ej.
    | semilla con bcrypt 12 y config con 10), el login terminaría en 500.
    |
    | Con false, la verificación funciona igual (bcrypt compara con el costo que
    | trae el propio hash) y el costo se moderniza cuando el usuario cambia su
    | contraseña, camino que sí está permitido y audita el cambio.
    |
    */

    'rehash_on_login' => false,

    'driver' => 'bcrypt',

    'bcrypt' => [
        'rounds' => env('BCRYPT_ROUNDS', 12),
        'verify' => true,
    ],

    'argon' => [
        'memory' => 65536,
        'threads' => 1,
        'time' => 4,
        'verify' => true,
    ],

];
