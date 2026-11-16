import { Link, router, usePage } from '@inertiajs/react';
import { useState } from 'react';
import { Banknote, Coins, LayoutDashboard, LogOut, Menu, Settings2, Store, Wrench, X } from 'lucide-react';
import { Toast } from '../Components/kit';

/* Marco del panel del super administrador: el mismo lenguaje que las tiendas (menú lateral oscuro de marca,
   contenido claro sobre fondo gris, tarjetas blancas) para que el operador no sienta que cambia de sistema. */

const MENU = [
    { grupo: 'Plataforma', items: [
        { t: 'Resumen', i: LayoutDashboard, vista: 'resumen' },
        { t: 'Tiendas', i: Store, vista: 'tiendas' },
        { t: 'Pagos', i: Banknote, vista: 'pagos', badge: true },
    ] },
    { grupo: 'Configuración', items: [
        { t: 'Tasa y cuentas de cobro', i: Settings2, vista: 'ajustes' },
    ] },
];
const url = (v) => (v === 'resumen' ? '/portal' : `/portal?vista=${v}`);

function MenuLateral({ vista, nPendientes, cerrar }) {
    return (
        <div className="flex h-full flex-col text-white" style={{ background: 'linear-gradient(180deg,#10141a 0%,#0b0e12 100%)' }}>
            <div className="flex h-16 shrink-0 items-center justify-between px-5">
                <div className="flex items-center gap-2.5">
                    <span className="grid size-9 place-items-center rounded-lg bg-white/10"><Wrench className="size-[18px]" /></span>
                    <span className="text-[15px] font-semibold tracking-tight">Repuestos de motos</span>
                </div>
                {cerrar && <button onClick={cerrar} aria-label="Cerrar menú" className="grid size-9 place-items-center rounded-md hover:bg-white/10"><X className="size-5" /></button>}
            </div>
            <div className="mx-3 mb-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <p className="text-sm font-medium">Administración del portal</p>
                <p className="mt-0.5 text-xs text-white/55">Todas las tiendas de la plataforma</p>
            </div>
            <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3" aria-label="Menú del portal">
                {MENU.map((g) => (
                    <div key={g.grupo}>
                        <p className="px-3 pb-1.5 text-xs font-medium text-white/40">{g.grupo}</p>
                        <ul className="space-y-0.5">
                            {g.items.map(({ t, i: Icon, vista: v, badge }) => {
                                const on = vista === v;
                                return (
                                    <li key={v}>
                                        <Link href={url(v)} aria-current={on ? 'page' : undefined}
                                            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors ${on ? 'bg-white/10 font-medium text-white' : 'text-white/65 hover:bg-white/[0.06] hover:text-white'}`}>
                                            {on && <span aria-hidden className="absolute -left-3 top-1.5 h-6 w-1 rounded-r bg-[#4f7cff]" />}
                                            <Icon className={`size-[18px] shrink-0 ${on ? 'text-white' : 'text-white/50 group-hover:text-white/80'}`} />
                                            <span className="flex-1 truncate">{t}</span>
                                            {badge && nPendientes > 0 && <span className="rounded-full bg-signal/20 px-2 py-0.5 text-xs font-semibold text-signal" title="Pagos esperando verificación">{nPendientes}</span>}
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </nav>
            <div className="border-t border-white/10 p-3">
                <div className="flex items-center gap-3 rounded-lg px-2 py-2">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold">OP</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">Operador</p><p className="text-xs text-white/50">Super administrador</p></div>
                    <button onClick={() => router.post('/portal/salir')} aria-label="Salir del portal" title="Salir del portal" className="grid size-9 place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"><LogOut className="size-[18px]" /></button>
                </div>
            </div>
        </div>
    );
}

export default function PortalLayout({ vista, titulo, subtitulo, tasa, nPendientes = 0, children }) {
    const [abierto, setAbierto] = useState(false);
    const flash = usePage().props.flash?.ok;
    return (
        <div className="min-h-screen bg-paper">
            <Toast texto={flash} />
            <aside className="fixed inset-y-0 left-0 z-30 hidden w-[268px] lg:block"><MenuLateral {...{ vista, nPendientes }} /></aside>
            {abierto && (
                <div className="fixed inset-0 z-40 lg:hidden">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setAbierto(false)} />
                    <div className="absolute inset-y-0 left-0 w-[280px] max-w-[85%]"><MenuLateral {...{ vista, nPendientes }} cerrar={() => setAbierto(false)} /></div>
                </div>
            )}
            <div className="min-w-0 lg:pl-[268px]">
                <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/85 px-4 backdrop-blur sm:px-6 lg:px-8">
                    <button onClick={() => setAbierto(true)} aria-label="Abrir menú" className="grid size-10 place-items-center rounded-lg border border-line lg:hidden"><Menu className="size-5" /></button>
                    <div className="min-w-0">
                        <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em]">{titulo}</h1>
                        {subtitulo && <p className="hidden truncate text-[13px] text-muted sm:block">{subtitulo}</p>}
                    </div>
                    <div className="ml-auto flex items-center gap-2 sm:gap-3">
                        {tasa
                            ? <Link href={url('ajustes')} className="hidden items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-[13px] hover:bg-paper sm:flex" title="Tasa del día para cobrar en bolívares">
                                <Coins className="size-4 text-muted" /><span className="text-muted">Tasa del día</span><span className="num font-semibold">Bs {tasa}</span></Link>
                            : <Link href={url('ajustes')} className="hidden items-center gap-2 rounded-lg border border-signal/50 bg-signal/10 px-3 py-2 text-[13px] font-medium text-[#6b4a00] hover:bg-signal/20 sm:flex">
                                <Coins className="size-4" />Publica la tasa del día</Link>}
                    </div>
                </header>
                <main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
            </div>
        </div>
    );
}
