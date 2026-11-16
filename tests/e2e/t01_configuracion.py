# -*- coding: utf-8 -*-
"""t01 · Configuración del negocio: checklist, RIF, impuestos, tasas y métodos de pago."""
import datetime

import e2e_lib as L


def main():
    L.empezar('t01 · Configuración e impuestos')
    hoy = L.hoy()
    uid = L.admin()

    # 1) El checklist no deja pendientes con la base sembrada
    chk = L.fn('fn_checklist_configuracion')
    L.ok(chk is not None, 'fn_checklist_configuracion responde', f'{chk}')
    L.ok(L.q1("SELECT razon_social FROM tienda.negocio WHERE id = 1") is not None, 'negocio tiene razón social')

    # 2) RIF: devuelve booleano (formato + dígito de control), igual que el formulario
    rifs_db = [x[0] for x in L.qs("SELECT DISTINCT rif FROM tienda.negocio UNION SELECT rif FROM tienda.proveedores LIMIT 6")]
    for r in rifs_db:
        L.ok(L.fn('fn_validar_rif', r) is True, f'RIF de la base aceptado: {r}')
    for r in ['X-12345678-1', 'J-12345678', 'J-12345678-0']:
        L.ok(L.fn('fn_validar_rif', r) is False, f'RIF inválido rechazado: {r}')

    # 3) Impuestos vigentes: IVA general 16 % y IGTF 3 % por contribuyente especial
    iva = L.fn('fn_iva_pct', hoy)
    igtf = L.fn('fn_igtf_pct', hoy)
    L.ok(float(iva) == 16.0, f'IVA vigente = {iva} %', 'esperado 16')
    L.ok(float(igtf) == 3.0, f'IGTF vigente = {igtf} %', 'esperado 3 (especial)')
    L.regimen_especial = L.q1("SELECT es_contribuyente_especial FROM tienda.negocio WHERE id = 1")
    L.ok(L.regimen_especial in (True, False), f'régimen fiscal configurado (especial = {L.regimen_especial})')

    # 4) Tasas de cambio: la del día existe y responde a pares EUR/COP vía USD
    t_usd = L.fn_fila('fn_tasa_aplicable', hoy, 'USD', 'VES')
    L.ok(t_usd and float(t_usd['tasa']) > 0, f'tasa USD→VES del día = {t_usd["tasa"]}')
    def asegurar_tasa(orig, dest, valor):
        # La tasa aplicable debe estar vigente (≤ 4 días); si está vencida se registra la de hoy,
        # exactamente como pide Configuración → Tasas de cambio.
        try:
            t = L.fn_fila('fn_tasa_aplicable', hoy, orig, dest)
        except Exception:
            L.conn.rollback()
            t = None
        dias = (datetime.date.fromisoformat(str(hoy)) - datetime.date.fromisoformat(str(t['fecha_valor']))).days if t else 99
        if t is None or dias > 4:
            if t is None:
                L.conn.rollback()
            L.ejecutar("INSERT INTO tienda.tasas_cambio (moneda_origen, moneda_destino, tasa, fecha_valor, fuente, es_oficial_bcv, usuario_id) "
                       "VALUES (%s, %s, %s, %s, 'BCV', true, %s)", (orig, dest, valor, hoy, uid))
            L.commit()
            t = L.fn_fila('fn_tasa_aplicable', hoy, orig, dest)
            L.ok(float(t['tasa']) > 0, f'tasa {orig}→{dest} registrada/actualizada y aplicable = {t["tasa"]}')
        else:
            L.ok(True, f'tasa {orig}→{dest} vigente = {t["tasa"]} (fecha {t["fecha_valor"]})')

    asegurar_tasa('USD', 'VES', 36.5)
    asegurar_tasa('EUR', 'VES', 1.0352)
    asegurar_tasa('COP', 'VES', 0.2280)
    par = L.fn('fn_tasa_par', 'USD', 'VES', hoy)
    L.ok(par and abs(float(par) - float(t_usd['tasa'])) < 0.0001, f'fn_tasa_par ({par}) coincide con la aplicable ({t_usd["tasa"]})')

    # 5) Métodos de pago: sembrados + uno nuevo del E2E + regla de uso
    n_metodos = L.q1("SELECT count(*) FROM tienda.metodos_pago WHERE activo")
    L.ok(n_metodos >= 8, f'métodos de pago activos sembrados = {n_metodos}', 'esperado ≥ 8')
    m_qr = L.ins('metodos_pago', nombre=f'QR Prueba {L.fake.word()}', moneda='VES',
                 es_divisa=False, aplica_igtf=False, requiere_referencia=True, activo=True, es_efectivo=False)
    L.ok(L.fn('fn_metodo_en_uso', m_qr) is False, 'método nuevo sin uso reporta fn_metodo_en_uso = false')
    L.commit()

    # 6) Usuario de sesión: el GUC que usan los triggers (auditoría)
    uid = L.admin()
    L.q1("SELECT set_config('tienda.usuario_id', %s, true)", (str(uid),))
    L.ok(L.q1("SELECT current_setting('tienda.usuario_id')") == str(uid), 'sesión (usuario_id) queda configurada')

    # 7) Unidades y presentaciones: la conversión que usa Compras al comprar cajas
    pid = L.q1("SELECT id FROM tienda.productos WHERE activo ORDER BY id LIMIT 1")
    L.ejecutar("UPDATE tienda.productos SET unidad_compra = 'CAJA', piezas_por_presentacion = 12 WHERE id = %s", (pid,))
    L.commit()
    L.ok(float(L.fn('fn_cantidad_en_presentaciones', pid, 24)) == 2.0, '24 piezas → 2 presentaciones')
    L.ok(float(L.fn('fn_cantidad_en_unidades', pid, 2)) == 24.0, '2 cajas → 24 piezas')
