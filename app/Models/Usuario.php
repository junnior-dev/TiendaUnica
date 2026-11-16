<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;

/** Tabla tienda.usuarios: el hash solo cambia vía sp_primer_admin / sp_cambiar_password (TV005 si es UPDATE directo). */
class Usuario extends Authenticatable
{
    protected $table = 'usuarios';
    protected $hidden = ['password_hash'];
    public $timestamps = false;

    public function getAuthPassword(): string { return $this->password_hash; }
    /** La columna real del hash (Laravel la llama «password» por defecto; rehash y cambios la necesitan). */
    public function getAuthPasswordName(): string { return 'password_hash'; }
    public function getRememberToken() { return null; }
    public function setRememberToken($value): void {}
    public function getRememberTokenName(): string { return ''; }
}
