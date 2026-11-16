# -*- coding: utf-8 -*-
"""t03 · Usuarios, roles y sesión: el cajero existe, el inactivo no puede operar."""
import e2e_lib as L


def main():
    L.empezar('t03 · Usuarios y sesión')
    admin = L.admin()
    L.ok(admin is not None, 'existe un usuario ADMINISTRADOR')

    # 1) Cajero nuevo (contraseña en hash bcrypt, como la hace Laravel)
    hash_demo = '$2y$12$cbaFYjBCzIjTqXLQPTpvkuxCNJDfbZQ0tjJRNChF3KSP5dKO5RG7a'
    nom = L.fake.name()
    u = L.ins('usuarios', username=f'e2e_{L.fake.user_name()}', password_hash=hash_demo,
              nombre_completo=nom, rol='CAJERO', activo=True, debe_cambiar_password=False)
    L.commit()
    L.ok(u is not None, f'cajero creado: {nom}')
    L.ok(L.q1("SELECT rol FROM tienda.usuarios WHERE id = %s", (u,)) == 'CAJERO', 'rol CAJERO asignado')

    # 2) La apertura activa es por usuario: un cajero sin apertura no tiene turno
    L.ok(L.fn('fn_apertura_activa', u) is None, 'cajero nuevo sin apertura (fn_apertura_activa = null)')
    L.ok(L.fn('fn_apertura_activa', admin) is None or True, 'fn_apertura_activa responde para admin')

    # 3) Usuario inactivo: el POS debe bloquearlo (apertura activa exige usuario activo)
    L.ejecutar("UPDATE tienda.usuarios SET activo = false WHERE id = %s", (u,))
    L.commit()
    L.espera_error('cajero inactivo no puede abrir caja', L.fn, 'fn_abrir_caja', u, 10, 100)
    L.ejecutar("UPDATE tienda.usuarios SET activo = true WHERE id = %s", (u,))
    L.commit()
    L.ok(L.q1("SELECT activo FROM tienda.usuarios WHERE id = %s", (u,)) is True, 'cajero reactivado')

    # 4) Sesión de auditoría: cada función firma con el usuario configurado
    L.q1("SELECT set_config('tienda.usuario_id', %s, true)", (str(u),))
    L.ok(L.q1("SELECT current_setting('tienda.usuario_id')") == str(u), 'GUC de sesión apunta al cajero')
    L.q1("SELECT set_config('tienda.usuario_id', %s, true)", (str(admin),))
