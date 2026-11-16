# -*- coding: utf-8 -*-
"""m09 · PORTABILIDAD COMPLETA: el paquete del negocio 2 se restaura como negocio
nuevo (ids remapeados, secuencias re-calibradas) y el restaurado vive aislado."""
import e2e_lib as L  # noqa: E402
import m_lib as M  # noqa: E402

TABLAS_VERIFICADAS = ('clientes', 'productos', 'ventas', 'detalle_venta', 'usuarios',
                      'metodos_pago', 'plan_cuentas', 'contab_parametros', 'calendario_fiscal',
                      'negocio_regimen_historial', 'movimientos_inventario', 'historial_precios')


def main():
    L.empezar('m09 · IMPORTAR: exportar n2 → restaurarlo como negocio nuevo')
    M.volver()
    # Jerarquía de plan de cuentas propia del negocio 2 (raíz + hija) para probar
    # el remapeo de la autoreferencia plan_cuentas.cuenta_padre_id en el paquete.
    L.ejecutar("INSERT INTO tienda.plan_cuentas (negocio_id, codigo, nombre, tipo, permite_movimiento, activa) "
               "SELECT 2, '9', nombre, tipo, false, true "
               "FROM tienda.plan_cuentas WHERE negocio_id = 1 AND cuenta_padre_id IS NULL LIMIT 1")
    raiz = L.q1("SELECT id FROM tienda.plan_cuentas WHERE negocio_id = 2 AND codigo = '9'")
    L.ejecutar("INSERT INTO tienda.plan_cuentas (negocio_id, codigo, nombre, tipo, cuenta_padre_id, "
               " permite_movimiento, activa) "
               "SELECT 2, '9.1', nombre, tipo, %s, true, true "
               "FROM tienda.plan_cuentas WHERE negocio_id = 1 AND cuenta_padre_id IS NOT NULL LIMIT 1", (raiz,))
    L.commit()
    v2 = L.q1("SELECT count(*) FROM tienda.ventas WHERE negocio_id = 2")
    con_cliente = L.q1("SELECT count(*) FROM tienda.ventas WHERE negocio_id = 2 AND cliente_id IS NOT NULL")
    pkg = L.fn('fn_exportar_negocio', 2)
    L.ok(pkg['negocio']['id'] == 2 and len(pkg['ventas']) == v2,
         f'paquete del negocio 2 ({v2} ventas, {len(pkg["clientes"])} clientes, {pkg["tablas_exportadas"]} tablas)')
    n = L.fn('fn_importar_negocio', pkg)
    L.commit()
    L.ok(n >= 3, f'restaurado como negocio {n} (ids nuevos, negocio_id remapeado en 63 tablas)')
    fallas = []
    for t in TABLAS_VERIFICADAS:
        if len(pkg.get(t, [])) != L.q1(f"SELECT count(*) FROM tienda.{t} WHERE negocio_id = %s", (n,)):
            fallas.append(t)
    L.ok(not fallas, f'{len(TABLAS_VERIFICADAS)} tablas con conteos exactos paquete=restaurado', ', '.join(fallas))
    L.ok(L.q1(f"SELECT count(*) FROM tienda.ventas v JOIN tienda.clientes c ON c.id = v.cliente_id "
              f"WHERE v.negocio_id = {n} AND c.negocio_id = {n}") == con_cliente,
         f'todas las ventas con cliente ({con_cliente}) apuntan al cliente REMAPEADO del negocio {n}')
    L.ok(L.q1(f"SELECT count(*) FROM tienda.detalle_venta d JOIN tienda.productos p ON p.id = d.producto_id "
              f"WHERE d.venta_id IN (SELECT id FROM tienda.ventas WHERE negocio_id = {n}) "
              f"AND p.negocio_id = {n}") > 0, 'el detalle de venta apunta al producto remapeado')
    L.ok(L.q1(f"SELECT count(*) FROM tienda.negocio g JOIN tienda.usuarios u ON u.id = g.configurado_por "
              f"WHERE g.id = {n} AND u.negocio_id = {n}") == 1,
         'configurado_por apunta al usuario importado (ciclo negocio↔usuarios roto con UPDATE)')
    L.ok(L.q1(f"SELECT count(*) FROM tienda.numeracion_fiscal WHERE id = {n} AND negocio_id = {n}") == 1
         and L.q1(f"SELECT count(*) FROM tienda.caja_config WHERE id = {n}") == 1
         and L.q1(f"SELECT count(*) FROM tienda.contab_config WHERE id = {n}") == 1
         and L.q1(f"SELECT count(*) FROM tienda.islr_config WHERE id = {n}") == 1,
         'las 4 config de PK fija llevan id = negocio nuevo')
    L.ok(L.q1(f"SELECT count(*) FROM tienda.plan_cuentas pc1 JOIN tienda.plan_cuentas pc2 "
              f"ON pc2.id = pc1.cuenta_padre_id WHERE pc1.negocio_id = {n} AND pc2.negocio_id = {n} AND pc1.codigo = '9.1' AND pc2.codigo = '9'") == 1,
         'autoreferencia plan_cuentas remapeada: la cuenta 9.1 apunta a la raíz 9 del negocio restaurado')
    max_cli = max(int(c['id']) for c in pkg['clientes'])
    L.ejecutar(f"INSERT INTO tienda.clientes (negocio_id, tipo_documento, documento, nombre, activo) "
               f"VALUES ({n}, 'V', '999-POSTIMPORT', 'Cliente Post-Importación', true)")
    L.ok(L.q1("SELECT id FROM tienda.clientes WHERE documento = '999-POSTIMPORT'") > max_cli,
         'secuencia de clientes re-calibrada: el primer INSERT del restaurado no colisiona')
    L.ok(L.q1("SELECT count(*) FROM tienda.estado_tenants WHERE negocio_id = %s AND activo", (n,)) == 1,
         f'el negocio {n} nace con su fila de control (subdominio generado, activo)')

    L.empezar('m09 · EL RESTAURADO VIVE: sesión propia y aislamiento')
    M.como(n)
    L.ok(L.fn('fn_negocio_actual') == n, f'sesión del negocio restaurado ({n})')
    L.ok(L.q1("SELECT count(*) FROM tienda.ventas") == v2, f've su patrimonio restaurado ({v2} ventas)')
    L.ok(L.q1("SELECT count(*) FROM tienda.ventas WHERE negocio_id = 2") == 0,
         'y NO ve las filas del negocio 2 (origen del paquete)')
    M.volver()
    M.como(n)
    L.espera_error('la app no puede importar: es operación del portal (superusuario)',
                   lambda: L.fn('fn_importar_negocio', pkg))
    M.volver()
    L.espera_error('paquete con formato desconocido → rechazado',
                   lambda: L.fn('fn_importar_negocio', {**pkg, 'formato': 'v9'}))
    M.volver()
