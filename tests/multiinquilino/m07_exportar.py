# -*- coding: utf-8 -*-
"""m07 · PORTABILIDAD: fn_exportar_negocio — la app solo exporta SU negocio y el
paquete completo no contiene ni una fila ajena; el portal exporta cualquiera."""
import e2e_lib as L  # noqa: E402
import m_lib as M  # noqa: E402


def main():
    L.empezar('m07 · PORTABILIDAD: el cliente puede llevarse sus datos')
    M.como(2)
    pkg = L.fn('fn_exportar_negocio')
    L.ok(pkg['formato'] == 'v1' and pkg['negocio']['id'] == 2, 'paquete formato v1 del negocio 2')
    L.ok(pkg['tablas_exportadas'] == 70, f'{pkg["tablas_exportadas"]} tablas exportadas')  # 68 + solicitudes_idempotentes (B-5) + plataforma_admin (43)
    malas = []
    for t, filas in pkg.items():
        if isinstance(filas, list):
            for f in filas:
                if isinstance(f, dict) and f.get('negocio_id') not in (2, None):
                    malas.append(t)
                    break
    L.ok(not malas, 'ninguna fila del paquete pertenece a otro negocio', ', '.join(malas))
    L.espera_error('exportar OTRO negocio → TV006 (la app solo puede exportar el suyo)',
                   lambda: L.fn('fn_exportar_negocio', 1))
    M.como(2)
    L.ok(len(pkg['clientes']) == L.q1("SELECT count(*) FROM tienda.clientes"), 
         'el paquete contiene exactamente los clientes propios')
    L.ok(len(pkg['ventas']) == L.q1("SELECT count(*) FROM tienda.ventas"),
         'y exactamente sus ventas')
    L.ok('estado_tenants' not in pkg, 'estado_tenants NO sale en el paquete (control del portal)')
    M.volver()
    pkg1 = L.fn('fn_exportar_negocio', 1)
    L.ok(pkg1['negocio']['id'] == 1 and len(pkg1['ventas']) >= 0,
         'el portal (superusuario) exporta el negocio que quiera, p.ej. el 1')
    L.ok(L.q1("SELECT count(*) FROM tienda.negocio") == 2,
         'dos negocios coexisten en la misma base, cada uno con su paquete')
    M.volver()
