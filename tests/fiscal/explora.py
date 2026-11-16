# -*- coding: utf-8 -*-
"""Exploración de comportamientos inciertos antes de fijar las aserciones del plan fiscal."""
import sys

sys.path.insert(0, '/home/z/my-project/work/sistema/sistema-repuestos-motos/tests/e2e')
import e2e_lib as L  # noqa: E402

L.DSN['dbname'] = 'tienda_fiscal'
L.conectar()
uid = L.admin()
hoy = L.hoy()
import json as J

# Turno abierto para poder vender (regla de la base)
for (aid,) in L.qs("SELECT id FROM tienda.aperturas_caja WHERE usuario_id = %s AND estado = 'ABIERTA'", (uid,)):
    L.fn('fn_cerrar_apertura', aid, uid)
L.commit()
L.fn('fn_abrir_caja', uid, 100, 1000)
L.commit()


def intento(titulo, callable_fn, *args):
    try:
        r = callable_fn(*args)
        L.conn.commit()
        print(f"  PERMITIDO  → {titulo} (resultado: {r})")
        return r
    except Exception as e:
        L.conn.rollback()
        print(f"  RECHAZADO  → {titulo}: {str(e).splitlines()[0][:120]}")
        return None


# ── A) Anular venta a crédito con CxC pendiente ──
cli = L.ins('clientes', nombre=L.fake.name(), documento=L.rif('V'), tipo_documento='V', activo=True)
L.commit()
p = L.q1("SELECT id FROM tienda.productos WHERE activo AND NOT exento_iva ORDER BY id LIMIT 1")
precio = float(L.q1("SELECT precio_venta_usd FROM tienda.productos WHERE id = %s", (p,)))
total = round(precio * 1.16, 2)
vcr = L.fn('fn_registrar_venta', uid, J.dumps([{'producto_id': p, 'cantidad': 1, 'descuento_pct': 0}]), J.dumps([]), cli, None, 'PRESENCIAL', True, 15)
L.commit()
print(f"A) venta crédito #{vcr} total {total}")
# nota tipo C sobre la venta (total en Bs a la tasa de la venta)
tasa = float(L.q1("SELECT tasa_cambio FROM tienda.ventas WHERE id = %s", (vcr,)))
n = L.ins('notas_ajuste', tipo='C', numero='900', venta_id=vcr, fecha=hoy, iva_pct=16,
          base_ves=round(precio * tasa, 2), iva_ves=round(precio * 0.16 * tasa, 2),
          total_ves=round(precio * 1.16 * tasa, 2), motivo='Exploración E2E', usuario_id=uid, devuelve_inventario=True)
L.commit()
sal = L.q1("SELECT saldo_usd, estado FROM tienda.cuentas_por_cobrar WHERE venta_id = %s", (vcr,))
print(f"   tras nota tipo C: CxC {sal}")
intento('A1 anular venta a crédito con CxC pendiente', L.ejecutar, "CALL tienda.sp_anular_venta(%s, %s, %s)", (vcr, uid, 'Exploración'))
print(f"   CxC ahora: {L.q1('SELECT saldo_usd, estado FROM tienda.cuentas_por_cobrar WHERE venta_id = %s', (vcr,))}")

# ── B) Nota que excede el total de la venta ──
n2 = None
try:
    n2 = L.ins('notas_ajuste', tipo='C', numero='901', venta_id=vcr, fecha=hoy, iva_pct=16,
               base_ves=round(precio * 3 * tasa, 2), iva_ves=round(precio * 0.48 * tasa, 2),
               total_ves=round(precio * 3.48 * tasa, 2), motivo='Exploración exceso', usuario_id=uid, devuelve_inventario=True)
    L.conn.commit()
    print(f"B) nota EXCEDENTE permitida → #{n2}; reembolsable_ves={L.fn('fn_nota_reembolsable_ves', n2)}")
except Exception as e:
    L.conn.rollback()
    print(f"B) nota EXCEDENTE rechazada: {str(e).splitlines()[0][:120]}")

# ── C) Anular retención ISLR ya enterada ──
prov = L.q1("SELECT id FROM tienda.proveedores WHERE activo ORDER BY id LIMIT 1")
rif = L.q1("SELECT rif FROM tienda.proveedores WHERE id = %s", (prov,))
ret = L.fn('fn_registrar_retencion_islr', hoy, 'Prov Expl', rif, 'J', 'HONORARIOS', 'AP-9001', 1000, 'USD', 'BANCOS', prov, None, uid)
L.commit()
# enterar (hasta = hoy para que pase la guarda)
ent = None
try:
    ent = L.fn('fn_enterar_islr', f'{hoy.year}-11-01', hoy, hoy, 'PM-EXP', uid)
    L.commit()
    print(f"C) entero #{ent} creado")
except Exception as e:
    L.conn.rollback()
    print(f"C) entero falló: {str(e).splitlines()[0][:100]}")
if ent:
    intento('C1 anular retención ya ENTERADA', L.fn, 'fn_anular_retencion_islr', ret, 'Exploración', uid)

# ── D) Venta con el período ACTUAL cerrado ──
intento('D1 cerrar período actual', L.fn, 'fn_cerrar_periodo', hoy.replace(day=1), uid, 'Exploración')
vpc = intento('D2 vender en período cerrado', L.fn, 'fn_registrar_venta', uid, J.dumps([{'producto_id': p, 'cantidad': 1, 'descuento_pct': 0}]),
              J.dumps([{'metodo_pago_id': L.q1("SELECT id FROM tienda.metodos_pago WHERE nombre='Efectivo Bs' AND activo"),
                        'monto': round(total * 36.5, 2)}]), None, None, 'PRESENCIAL')
if vpc:
    print(f"   venta en período cerrado → #{vpc} (FINDING: permitida)")
L.fn('fn_reabrir_periodo', hoy.replace(day=1), uid, 'Reapertura exploración')
L.commit()

# ── E) IGTF declarado vs venta anulada ──
L.ejecutar("UPDATE tienda.negocio SET es_contribuyente_especial = true, cobra_igtf = true WHERE id = 1")
L.commit()
m_usd = L.q1("SELECT id FROM tienda.metodos_pago WHERE nombre='Efectivo USD' AND activo")
# venta con IGTF: el validador exige el total con IGTF; probamos dos montos
vig = None
for monto in [round(total * 1.03, 2), round(total * 1.0309, 2), round(total * 1.0308, 2), round(total * 1.031, 2)]:
    try:
        vig = L.fn('fn_registrar_venta', uid, J.dumps([{'producto_id': p, 'cantidad': 1, 'descuento_pct': 0}]),
                   J.dumps([{'metodo_pago_id': m_usd, 'monto': monto}]), None, None, 'PRESENCIAL')
        break
    except Exception as e:
        L.conn.rollback()
        monto = None
if vig:
    L.commit()
    ig = L.q1("SELECT igtf_usd FROM tienda.ventas WHERE id = %s", (vig,))
    print(f"E) venta con IGTF #{vig}: igtf_usd={ig}")
    print(f"   v_igtf_a_declarar hoy: {L.q1('SELECT COALESCE(sum(igtf_usd),0) FROM tienda.v_igtf_a_declarar WHERE fecha=%s', (hoy,))}")
    L.ejecutar("CALL tienda.sp_anular_venta(%s, %s, %s)", (vig, uid, 'Exploración IGTF'))
    L.commit()
    print(f"   tras anular: neto_diario={L.q1('SELECT COALESCE(sum(igtf_usd),0) FROM tienda.v_igtf_neto_diario WHERE fecha=%s', (hoy,))}"
          f"  a_declarar={L.q1('SELECT COALESCE(sum(igtf_usd),0) FROM tienda.v_igtf_a_declarar WHERE fecha=%s', (hoy,))}"
          f"  reversiones={L.q1('SELECT count(*) FROM tienda.reversiones_igtf')}")
else:
    print("E) no se logró venta con IGTF en la exploración")
L.ejecutar("UPDATE tienda.negocio SET es_contribuyente_especial = false, cobra_igtf = false WHERE id = 1")
L.commit()
L.conn.close()
print("exploración terminada")
