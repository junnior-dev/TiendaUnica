import { useId, useState } from 'react';
import { AlertCircle, ChevronDown, Eye, EyeOff } from 'lucide-react';

/* Campo con label flotante: el label descansa dentro del input y, al enfocar o escribir, sube y corta el borde.
   El icono vive siempre dentro del campo. */
export function Field({ label, icon: Icon, error, hint, trailing, forceFloat, select, className = '', children, ...props }) {
    const id = useId();
    const tone = props.readOnly ? 'bg-paper' : 'bg-white';
    const input = `peer h-12 w-full rounded-lg border ${tone} text-[15px] text-text placeholder:text-transparent focus:placeholder:text-[#9aa4af] transition-colors
        ${Icon ? 'pl-11' : 'pl-3.5'} ${trailing || select ? 'pr-11' : 'pr-3.5'} focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand
        ${error ? 'border-danger focus:border-danger focus:ring-danger' : 'border-line hover:border-[#b9c1ca]'}`;
    const up = 'top-0 left-2.5 text-xs font-medium';
    const lab = `pointer-events-none absolute z-10 -translate-y-1/2 px-1.5 ${tone} transition-all duration-150
        ${forceFloat || select ? `top-0 left-2.5 text-xs font-medium ${error ? 'text-danger' : 'text-muted'} peer-focus:text-brand` : `${Icon ? 'left-10' : 'left-2.5'} top-1/2 text-[15px] ${error ? 'text-danger' : 'text-muted'} peer-focus:top-0 peer-focus:left-2.5 peer-focus:text-xs peer-focus:font-medium peer-focus:text-brand peer-not-placeholder-shown:top-0 peer-not-placeholder-shown:left-2.5 peer-not-placeholder-shown:text-xs peer-not-placeholder-shown:font-medium`}`;
    return (
        <div className={className}>
            <div className="relative">
                {select ? <select id={id} className={`${input} appearance-none`} {...props}>{children}</select>
                    : <input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} className={input} placeholder=" " {...props} />}
                <label htmlFor={id} className={lab}>{label}</label>
                {Icon && <Icon aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted peer-focus:text-brand" />}
                {select && <ChevronDown aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />}
                {trailing}
            </div>
            {error ? (
                <p id={`${id}-e`} className="mt-1.5 flex items-start gap-1.5 text-[13px] text-danger"><AlertCircle className="mt-px size-3.5 shrink-0" />{error}</p>
            ) : hint ? <p id={`${id}-h`} className="mt-1.5 text-[13px] text-muted">{hint}</p> : null}
        </div>
    );
}

export function PasswordField(props) {
    const [show, setShow] = useState(false);
    return (
        <Field {...props} type={show ? 'text' : 'password'} trailing={
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-1.5 top-1/2 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-paper hover:text-text">
                {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
            </button>} />
    );
}

export function Button({ variant = 'primary', className = '', ...props }) {
    const styles = {
        primary: 'bg-brand text-white hover:bg-brand-600 disabled:opacity-60',
        ghost: 'border border-line bg-white text-text hover:bg-paper',
    }[variant];
    return <button className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-[15px] font-semibold transition-colors ${styles} ${className}`} {...props} />;
}

/* Opción activable: fila con interruptor. Todas las reglas fiscales se explican en una línea. */
export function Choice({ checked, onChange, title, children, disabled }) {
    return (
        <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
            className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3.5 text-left transition-colors
                ${disabled ? 'cursor-not-allowed border-line bg-paper opacity-60' : checked ? 'border-brand/60 bg-brand-50/50' : 'border-line bg-white hover:border-[#b9c1ca]'}`}>
            <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted">{children}</span>
            </span>
            <span aria-hidden className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-[#c5ccd4]'}`}>
                <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
        </button>
    );
}

/* Elegir una opción: tarjetas con icono y marca de selección. `compact` = control segmentado (Sí / No). */
export function Segmented({ value, onChange, options, name, compact }) {
    if (compact) {
        return (
            <div role="radiogroup" aria-label={name} className="inline-grid h-12 w-full auto-cols-fr grid-flow-col rounded-lg bg-[#e9ecf0] p-1">
                {options.map((o) => (
                    <button type="button" role="radio" aria-checked={value === o.value} key={o.value} onClick={() => onChange(o.value)}
                        className={`rounded-md text-[15px] font-medium transition-all ${value === o.value ? 'bg-white text-text shadow-sm' : 'text-muted hover:text-text'}`}>{o.label}</button>
                ))}
            </div>
        );
    }
    return (
        <div role="radiogroup" aria-label={name} className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
            {options.map(({ value: v, label, note, icon: Icon }) => {
                const on = value === v;
                return (
                    <button type="button" role="radio" aria-checked={on} key={v} onClick={() => onChange(v)}
                        className={`relative flex flex-col rounded-xl border p-3.5 text-left transition-all ${on ? 'border-brand bg-brand-50/60 ring-1 ring-brand' : 'border-line bg-white hover:border-[#b9c1ca]'}`}>
                        <span className="flex items-center justify-between">
                            {Icon ? <span className={`grid size-8 place-items-center rounded-lg ${on ? 'bg-brand text-white' : 'bg-paper text-muted'}`}><Icon className="size-[17px]" /></span> : <span />}
                            <span aria-hidden className={`grid size-[18px] place-items-center rounded-full border-[1.5px] ${on ? 'border-brand bg-brand' : 'border-[#b3bbc4]'}`}>
                                {on && <svg viewBox="0 0 12 12" className="size-2.5 text-white"><path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                            </span>
                        </span>
                        <span className="mt-3 block text-[14.5px] font-semibold">{label}</span>
                        {note && <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{note}</span>}
                    </button>
                );
            })}
        </div>
    );
}
