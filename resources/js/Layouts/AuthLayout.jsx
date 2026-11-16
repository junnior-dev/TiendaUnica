import { Wrench } from 'lucide-react';
import fondo from '../../images/almacen.jpg';

export function Brand({ dark }) {
    return (
        <div className="flex items-center gap-2.5">
            <span className={`grid size-9 place-items-center rounded-lg ${dark ? 'bg-white/10 text-white' : 'bg-ink text-white'}`}><Wrench className="size-[18px]" /></span>
            <span className={`text-[15px] font-semibold tracking-tight ${dark ? 'text-white' : 'text-text'}`}>Repuestos de motos <span className={`font-normal ${dark ? 'text-white/60' : 'text-muted'}`}>POS</span></span>
        </div>
    );
}

/* Dos columnas: formulario a la izquierda, contexto del sistema a la derecha (oscura). */
export default function AuthLayout({ children, aside, wide }) {
    return (
        <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <main className="flex flex-col bg-white px-5 py-8 sm:px-10 lg:px-14 xl:px-20">
                <Brand />
                <div className={`mx-auto flex w-full flex-1 flex-col justify-center py-10 ${wide ? 'max-w-[560px]' : 'max-w-[400px]'}`}>{children}</div>
                <p className="text-[13px] text-muted">© {new Date().getFullYear()} Repuestos de motos POS · Venezuela</p>
            </main>
            <aside className="relative hidden overflow-hidden bg-[#07090b] text-white lg:flex lg:flex-col lg:justify-center lg:px-14 xl:px-20">
                <img src={fondo} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover object-center blur-[3px]" />
                <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(5,7,9,.82) 0%, rgba(8,10,13,.72) 45%, rgba(4,5,7,.9) 100%)' }} />
                <div aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(60% 45% at 85% 0%, rgba(62,76,92,.38) 0%, transparent 70%), radial-gradient(55% 45% at 0% 100%, rgba(30,38,48,.55) 0%, transparent 70%)' }} />
                <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent" />
                <div className="relative mx-auto w-full max-w-[500px]">{aside}</div>
            </aside>
        </div>
    );
}
