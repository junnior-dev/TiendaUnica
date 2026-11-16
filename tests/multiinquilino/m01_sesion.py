# -*- coding: utf-8 -*-
"""m01 · ESTRUCTURA: negocio_id en 71 tablas (incl. las del 43), políticas RLS con
guarda de sesión, FORCE, vistas security_invoker y defaults del GUC."""
import e2e_lib as L  # noqa: E402
import m_lib as M  # noqa: E402

GLOBALES = "('negocio','monedas','tasas_cambio','log_tasas_cambio','islr_conceptos','islr_ut'," \
           "'solicitudes_idempotentes','calendario_obligaciones','parametros_fiscales','plataforma_admin','plataforma_roles')"


def main():
    L.empezar('m01 · SESIÓN: GUC app.negocio_id y defaults')
    M.volver()
    L.ok(L.fn('fn_negocio_actual') == 1, 'superusuario sin GUC → fn_negocio_actual = 1 (compatibilidad)')
    L.ejecutar("SET app.negocio_id = '5'")
    L.ok(L.fn('fn_negocio_actual') == 5, 'GUC «5» → fn_negocio_actual = 5')
    L.ejecutar("SET app.negocio_id = ''")
    L.ok(L.fn('fn_negocio_actual') == 1, 'GUC vacío → cuenta como sin fijar (1)')
    M.volver()
    L.ok(L.fn('fn_negocio_actual') == 1, 'tras volver, el superusuario queda sin negocio fijado')

    L.empezar('m01 · ESTRUCTURA: columnas, políticas RLS, FORCE y vistas')
    L.ok(L.q1("SELECT count(*) FROM information_schema.columns "
              "WHERE table_schema='tienda' AND column_name='negocio_id'") == 71,
         'negocio_id en 68 tablas de negocio + estado_tenants + solicitudes_idempotentes + plataforma_admin (B-5 y 43)')
    L.ok(L.q1("SELECT count(*) FROM pg_policies WHERE schemaname='tienda'") == 69,
         '69 políticas p_tenant (68 tablas + negocio)')
    L.ok(L.q1("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
              "WHERE n.nspname='tienda' AND c.relkind='v' "
              "AND c.reloptions::text LIKE '%security_invoker%'") == 33,
         'las 33 vistas respetan el RLS del invocador (security_invoker)')
    L.ok(L.q1("SELECT count(*) FROM pg_tables WHERE schemaname='tienda' AND rowsecurity "
              "AND tablename NOT IN " + GLOBALES) == 68,
         'RLS activado en las 68 tablas de negocio (las 9 globales quedan fuera)')
    L.ok(L.q1("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
              "WHERE n.nspname='tienda' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity "
              "AND c.relname NOT IN " + GLOBALES) == 68,
         'FORCE RLS: la política aplica también al owner de cada tabla')
    L.ok(L.q1("SELECT count(*) FROM pg_policies WHERE schemaname='tienda' "
              "AND qual LIKE '%fn_sesion_permitida%'") == 69,
         'las 69 políticas llevan la guarda fn_sesion_permitida (GUC exigido + no suspendido)')
    L.ok(L.q1("SELECT count(*) FROM pg_tables WHERE schemaname='tienda' "
              "AND tablename='estado_tenants' AND rowsecurity") == 0,
         'estado_tenants es global (la lee la guarda, solo el portal escribe)')
    L.ok(L.q1("SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname='trg_sello_negocio'") == 68,
         '68 triggers de sello: INSERT sin negocio_id hereda la sesión')
    M.volver()
