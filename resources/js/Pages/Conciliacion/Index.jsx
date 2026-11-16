import { Head, router } from '@inertiajs/react';
import { useFiscal } from '../../lib/plan';
import { useState } from 'react';
import { Landmark, Scale } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Vacio } from '../../Components/kit';
import Bancaria from './Bancaria';
import Fiscal from './Fiscal';

/** Conciliación (/conciliacion): banco contra libro mayor, y sistema contra lo declarado al SENIAT. Solo administradores. */
export default function Conciliacion(p) {
    const { negocio, usuario, fecha_larga, stock_bajo, tasa_usd, instalado, vista, conciliaciones, clases, emisor, hoy } = p;
    const planFiscal = useFiscal();
    const [actual, setActual] = useState(p.actual); const [fiscal, setFiscal] = useState(p.fiscal);
    const refrescar = () => router.reload({ only: ['conciliaciones'], preserveScroll: true });
    const ir = (v) => router.get('/conciliacion', { vista: v }, { preserveScroll: true });
    return (
        <AppLayout actual="/conciliacion" titulo="Conciliación" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Conciliación" />
            <div className="mb-6"><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Conciliación</h2>
                <p className="mt-1 max-w-[66ch] text-[15px] text-muted">{planFiscal ? 'Cruza tu contabilidad con el banco y con lo que declaraste al SENIAT, y saca las actas listas para firmar.' : 'Cruza tus movimientos con el estado de cuenta del banco y saca las actas listas para firmar.'}</p></div>
            {!instalado ? <Vacio icon={Scale} titulo="Falta instalar la conciliación" texto="Ejecuta database/sql/13_conciliaciones.sql en tu base de datos y vuelve a abrir esta pantalla." /> : (
                <>
                    <div className="mb-5 inline-flex rounded-lg border border-line bg-white p-1" role="tablist">
                        {[['bancaria', 'Banco', Landmark], ['fiscal', 'Declaraciones SENIAT', Scale]].filter(([k]) => k === 'bancaria' || planFiscal).map(([k, t, Icon]) => (
                            <button key={k} role="tab" aria-selected={vista === k} onClick={() => vista !== k && ir(k)} className={`inline-flex h-9 items-center gap-2 rounded-md px-4 text-[14px] font-semibold ${vista === k ? 'bg-ink text-white' : 'text-muted hover:text-[#161b21]'}`}><Icon className="size-4" />{t}</button>))}
                    </div>
                    {vista === 'bancaria'
                        ? <Bancaria lista={conciliaciones} actual={actual} setActual={setActual} refrescar={refrescar} clases={clases} emisor={emisor} hoy={hoy} cuentaBancos={p.cuenta_bancos} />
                        : <Fiscal fiscal={fiscal} setFiscal={setFiscal} mes={p.mes} periodicidad={p.periodicidad} quincena={p.quincena} regimenEspecial={p.regimen_especial} />}
                </>)}
        </AppLayout>
    );
}
