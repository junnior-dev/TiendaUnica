import { Head, router } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, KeyRound, Lock, Pencil, Plus, Power, Search, ShieldCheck, ShoppingBag, Store, TriangleAlert, UserCog, UserPlus, Users } from 'lucide-react';
import AppLayout from '../../Layouts/AppLayout';
import { Card, Kpi, Modal, Toast, Vacio } from '../../Components/kit';
import { Button, Field } from '../../Components/ui';
import { dmy, dolares, hace, iniciales } from '../../Components/expediente';
import { n0 } from '../../lib/format';
import { http } from '../../lib/http';

const ROLES = {
    ADMINISTRADOR: { nombre: 'Administrador', icon: ShieldCheck, texto: 'Ve y maneja todo el sistema: costos, existencias, contabilidad, libros fiscales y usuarios.' },
    CAJERO: { nombre: 'Cajero', icon: Store, texto: 'Solo atiende el mostrador: vende, consulta sus ventas y cierra su caja. No ve costos ni configuración.' },
};

/* Contraseña temporal sin caracteres que se confunden (0/O, 1/l/I). */
function generarClave() {
    const a = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const b = new Uint32Array(10); crypto.getRandomValues(b);
    return Array.from(b, (x) => a[x % a.length]).join('');
}
const fechaHora = (s) => (s ? `${dmy(s.slice(0, 10))} ${s.slice(11, 16)}` : null);

const RolChip = ({ rol }) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${rol === 'ADMINISTRADOR' ? 'bg-ink text-white' : 'bg-brand-50 text-brand'}`}>
        {ROLES[rol].nombre}
    </span>
);
const Etiqueta = ({ tono, children }) => (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tono === 'warn' ? 'bg-[#fff4d6] text-[#7a5600]' : tono === 'bad' ? 'bg-[#fde8e6] text-danger' : 'bg-paper text-muted'}`}>{children}</span>
);

function Acceso({ valor }) {
    if (valor === 'si') return <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ok"><Check className="size-4" />Sí</span>;
    if (valor === 'propio') return <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#7a5600]"><Check className="size-4" />Solo lo suyo</span>;
    return <span className="inline-flex items-center gap-1.5 text-[13px] text-muted"><Lock className="size-3.5" />Sin acceso</span>;
}

function Matriz({ matriz }) {
    return (
        <Card>
            <div className="border-b border-line p-5">
                <h3 className="text-[17px] font-semibold tracking-[-0.01em]">Qué ve cada rol</h3>
                <p className="mt-1 max-w-[70ch] text-[14px] text-muted">El administrador entra a todo. El cajero solo ve lo que necesita para atender; el resto ni aparece en su menú y, si escribe la dirección a mano, el sistema lo devuelve a su caja.</p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left">
                    <thead><tr className="border-b border-line bg-paper text-[13px] text-muted"><th className="px-5 py-3 font-medium">Pantalla</th><th className="px-3 py-3 font-medium">Administrador</th><th className="px-3 py-3 font-medium">Cajero</th></tr></thead>
                    <tbody>
                        {matriz.map((m) => (
                            <tr key={m.clave} className="border-b border-line last:border-0">
                                <td className="px-5 py-3"><div className="text-[15px] font-medium">{m.etiqueta}</div>{m.detalle && <div className="text-[13px] text-muted">{m.detalle}</div>}</td>
                                <td className="px-3 py-3"><Acceso valor="si" /></td>
                                <td className="px-3 py-3"><Acceso valor={m.cajero} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

function Ficha({ u, hoy, matriz, onEditar, onClave, onEstado, onVolver }) {
    const accesos = matriz.filter((m) => u.rol === 'ADMINISTRADOR' || m.cajero !== 'no');
    return (
        <div>
            <div className="rounded-t-2xl bg-ink px-5 pb-5 pt-4 text-white sm:px-7 sm:pb-6">
                <button onClick={onVolver} className="-ml-1.5 mb-3 inline-flex h-9 items-center gap-1.5 rounded-lg px-1.5 text-[14px] text-white/70 hover:bg-white/10 hover:text-white xl:hidden"><ArrowLeft className="size-4" />Volver a la lista</button>
                <div className="flex flex-wrap items-start gap-4">
                    <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-full bg-white/10 text-[22px] font-semibold ring-1 ring-white/20">{iniciales(u.nombre, true)}</span>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] sm:text-[26px]">{u.nombre}{u.es_yo && <span className="ml-2 align-middle text-[13px] font-normal text-white/60">(tú)</span>}</h3>
                        <p className="mt-0.5 text-[14px] text-white/65">@{u.username}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-ink">{ROLES[u.rol].nombre}</span>
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${u.activo ? 'bg-[#d8f1e3] text-ok' : 'bg-[#fde8e6] text-danger'}`}>{u.activo ? 'Activo' : 'Desactivado'}</span>
                            {u.sin_clave && <span className="rounded-full bg-[#fff4d6] px-2.5 py-0.5 text-xs font-semibold text-[#7a5600]">Sin contraseña</span>}
                            {u.debe_cambiar && !u.sin_clave && <span className="rounded-full bg-[#fff4d6] px-2.5 py-0.5 text-xs font-semibold text-[#7a5600]">Debe cambiar su contraseña</span>}
                        </div>
                    </div>
                </div>
            </div>
            <div className="p-5 sm:p-7">
                <div className="flex flex-wrap gap-2">
                    <button onClick={onEditar} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper"><Pencil className="size-4" />Editar</button>
                    <button onClick={onClave} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper"><KeyRound className="size-4" />Restablecer contraseña</button>
                    <button onClick={onEstado} disabled={u.es_yo} title={u.es_yo ? 'No puedes desactivar tu propio usuario' : undefined} className={`inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${u.activo ? 'border-line text-danger hover:bg-[#fde8e6]' : 'border-line hover:bg-paper'}`}><Power className="size-4" />{u.activo ? 'Desactivar' : 'Activar'}</button>
                </div>
                {u.es_yo && <p className="mt-3 text-[13px] text-muted">Para cuidar el acceso, no puedes cambiar tu propio rol ni desactivarte. Otro administrador puede hacerlo.</p>}

                <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <div className="rounded-xl bg-paper p-4"><dt className="text-[13px] text-muted">Último acceso</dt><dd className="mt-1 text-[16px] font-semibold">{u.ultimo_acceso ? hace(u.ultimo_acceso.slice(0, 10), hoy) : 'Nunca ha entrado'}</dd>{u.ultimo_acceso && <dd className="text-[12px] text-muted">{fechaHora(u.ultimo_acceso)}</dd>}</div>
                    <div className="rounded-xl bg-paper p-4"><dt className="text-[13px] text-muted">Ventas en 30 días</dt><dd className="mt-1 text-[16px] font-semibold">{n0(u.ventas_30)}</dd><dd className="text-[12px] text-muted">{dolares(u.usd_30)}</dd></div>
                    <div className="col-span-2 rounded-xl bg-paper p-4 sm:col-span-1"><dt className="text-[13px] text-muted">Última venta</dt><dd className="mt-1 text-[16px] font-semibold">{u.ultima_venta ? hace(u.ultima_venta, hoy) : 'Sin ventas'}</dd><dd className="text-[12px] text-muted">{n0(u.ventas_total)} en total</dd></div>
                </dl>

                <h4 className="mt-7 text-[15px] font-semibold">Pantallas a las que entra</h4>
                <p className="mt-0.5 text-[13px] text-muted">{ROLES[u.rol].texto}</p>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {accesos.map((m) => (
                        <li key={m.clave} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[14px]">
                            <span className="truncate">{m.etiqueta}</span>
                            {u.rol === 'CAJERO' && m.cajero === 'propio' ? <Etiqueta tono="warn">Solo lo suyo</Etiqueta> : <Check className="size-4 shrink-0 text-ok" />}
                        </li>
                    ))}
                </ul>
                <p className="mt-4 text-[12px] text-muted">Creado el {dmy(u.creado)}.</p>
            </div>
        </div>
    );
}

function Credenciales({ datos, cerrar }) {
    const [copiado, setCopiado] = useState(false);
    const texto = `Usuario: ${datos.usuario}\nContraseña temporal: ${datos.clave}`;
    const copiar = async () => { try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sin portapapeles */ } };
    return (
        <Modal titulo={datos.nuevo ? 'Usuario creado' : 'Contraseña restablecida'} subtitulo="Entrégale estos datos a la persona. Esta es la única vez que verás la contraseña." cerrar={cerrar} onSubmit={cerrar} ok="Listo">
            <div className="rounded-xl border border-line bg-paper p-4">
                <div className="text-[13px] text-muted">Usuario</div><div className="font-mono text-[17px] font-semibold">{datos.usuario}</div>
                <div className="mt-3 text-[13px] text-muted">Contraseña temporal</div><div className="font-mono text-[20px] font-semibold tracking-wider">{datos.clave}</div>
            </div>
            <button type="button" onClick={copiar} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-paper">{copiado ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}{copiado ? 'Copiado' : 'Copiar usuario y contraseña'}</button>
            <p className="text-[13px] text-muted">Al entrar por primera vez, el sistema le pedirá que cree su propia contraseña.</p>
        </Modal>
    );
}

function RolCards({ value, onChange, bloqueado }) {
    return (
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Rol">
            {Object.entries(ROLES).map(([k, r]) => {
                const on = value === k; const Icon = r.icon;
                return (
                    <button type="button" key={k} role="radio" aria-checked={on} disabled={bloqueado} onClick={() => onChange(k)}
                        className={`rounded-xl border p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${on ? 'border-brand bg-brand-50/60 ring-1 ring-brand' : 'border-line hover:border-[#b9c1ca]'}`}>
                        <span className="flex items-center gap-2 text-[15px] font-semibold"><Icon className="size-4" />{r.nombre}{on && <Check className="ml-auto size-4 text-brand" />}</span>
                        <span className="mt-1 block text-[12.5px] leading-snug text-muted">{r.texto}</span>
                    </button>
                );
            })}
        </div>
    );
}

export default function Usuarios({ negocio, usuario, fecha_larga, stock_bajo, tasa_usd, hoy, usuarios, matriz, resumen }) {
    const [tab, setTab] = useState('personas');
    const [q, setQ] = useState('');
    const [sel, setSel] = useState(usuarios[0]?.id ?? null);
    const [movil, setMovil] = useState(false);
    const [modal, setModal] = useState(null); // {tipo:'nuevo'|'editar'|'clave'|'estado'|'cred', ...}
    const [f, setF] = useState({});
    const [errs, setErrs] = useState({});
    const [enviando, setEnviando] = useState(false);
    const [msg, setMsg] = useState('');
    const aviso = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

    const filas = useMemo(() => {
        const t = q.trim().toLowerCase();
        return usuarios.filter((u) => !t || u.nombre.toLowerCase().includes(t) || u.username.includes(t));
    }, [usuarios, q]);
    const u = usuarios.find((x) => x.id === sel) || null;

    const abrir = (tipo, datos = {}) => { setErrs({}); setF(datos); setModal({ tipo }); };
    const cerrar = () => setModal(null);
    const enviar = async (metodo, url, cuerpo, luego) => {
        setEnviando(true); setErrs({});
        try { const r = await http(metodo, url, cuerpo); await new Promise((ok) => router.reload({ onFinish: ok })); luego(r); }
        catch (e) { setErrs(e.errors ? Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k, v[0]])) : { general: e.message || 'No se pudo guardar. Inténtalo de nuevo.' }); }
        finally { setEnviando(false); }
    };

    const crear = () => enviar('POST', '/usuarios', { nombre: f.nombre, username: f.username, rol: f.rol, password: f.clave }, (r) => { setSel(r.usuario?.id ?? sel); setMovil(true); setModal({ tipo: 'cred', datos: { nuevo: true, usuario: r.usuario?.username ?? f.username, clave: f.clave } }); });
    const guardar = () => enviar('PUT', `/usuarios/${u.id}`, { nombre: f.nombre, rol: f.rol }, () => { cerrar(); aviso('Cambios guardados.'); });
    const restablecer = () => enviar('POST', `/usuarios/${u.id}/contrasena`, { password: f.clave }, () => setModal({ tipo: 'cred', datos: { nuevo: false, usuario: u.username, clave: f.clave } }));
    const cambiarEstado = () => enviar('PATCH', `/usuarios/${u.id}/estado`, { activo: !u.activo }, () => { cerrar(); aviso(u.activo ? 'Usuario desactivado.' : 'Usuario activado.'); });

    const Error = () => (errs.general ? <p className="flex items-start gap-2 rounded-lg bg-[#fde8e6] p-3 text-[14px] text-danger"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{errs.general}</p> : null);
    const ClaveCampo = () => (
        <div>
            <Field label="Contraseña temporal" icon={KeyRound} value={f.clave || ''} onChange={(e) => setF({ ...f, clave: e.target.value })} error={errs.password} hint="La persona la cambiará al entrar. Mínimo 8 caracteres." autoComplete="off" spellCheck={false} />
            <button type="button" onClick={() => setF({ ...f, clave: generarClave() })} className="mt-1.5 text-[13px] font-semibold text-brand hover:underline">Generar otra</button>
        </div>
    );

    return (
        <AppLayout actual="/usuarios" titulo="Usuarios" subtitulo={fecha_larga} usuario={usuario} negocio={negocio} tasaUsd={tasa_usd} stockBajo={stock_bajo}>
            <Head title="Usuarios" />
            <Toast texto={msg} />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-[26px] font-semibold tracking-[-0.02em]">Usuarios</h2><p className="mt-1 max-w-[62ch] text-[15px] text-muted">Quién entra al sistema y a qué pantallas. Todo lo que se vende o ajusta queda a nombre de quien lo hizo.</p></div>
                <Button onClick={() => abrir('nuevo', { nombre: '', username: '', rol: 'CAJERO', clave: generarClave() })}><UserPlus className="size-4" />Nuevo usuario</Button>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Kpi icon={Users} titulo="Usuarios activos" valor={n0(resumen.activos)} detalle={resumen.desactivados ? `${resumen.desactivados} desactivado${resumen.desactivados === 1 ? '' : 's'}` : 'Ninguno desactivado'} />
                <Kpi icon={ShieldCheck} titulo="Administradores" valor={n0(resumen.admins)} detalle={resumen.admins < 2 ? 'Conviene tener un segundo de respaldo' : 'Con acceso total'} tono={resumen.admins < 2 ? 'warn' : undefined} />
                <Kpi icon={ShoppingBag} titulo="Cajeros" valor={n0(resumen.cajeros)} detalle="Solo atienden el mostrador" />
                <Kpi icon={KeyRound} titulo="Falta cambiar contraseña" valor={n0(resumen.pendientes)} tono={resumen.pendientes ? 'warn' : undefined} detalle={resumen.pendientes ? 'Aún usan la temporal' : 'Todos tienen la suya'} />
            </div>

            <div className="mb-5 inline-flex rounded-lg border border-line bg-white p-1" role="tablist">
                {[['personas', 'Personas', UserCog], ['accesos', 'Accesos por rol', Lock]].map(([k, t, Icon]) => (
                    <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`inline-flex h-9 items-center gap-2 rounded-md px-4 text-[14px] font-semibold ${tab === k ? 'bg-ink text-white' : 'text-muted hover:text-[#161b21]'}`}><Icon className="size-4" />{t}</button>
                ))}
            </div>

            {tab === 'accesos' ? <Matriz matriz={matriz} /> : (
                <div className="grid items-start gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
                    <Card className={movil ? 'hidden xl:block' : ''}>
                        <div className="border-b border-line p-4">
                            <label className="relative block"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
                                <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Buscar usuario" placeholder="Buscar por nombre o usuario" className="h-11 w-full rounded-lg border border-line bg-paper pl-10 pr-3 text-[15px] placeholder:text-[#8d97a2] focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand" /></label>
                        </div>
                        {filas.length === 0 ? <Vacio icon={Search} titulo="Nadie coincide" texto="Prueba con otro nombre o usuario." /> : (
                            <ul>
                                {filas.map((x) => (
                                    <li key={x.id} className="border-b border-line last:border-0">
                                        <button onClick={() => { setSel(x.id); setMovil(true); }} className={`flex w-full items-center gap-3 px-4 py-3.5 text-left ${sel === x.id ? 'bg-brand-50/60' : 'hover:bg-paper'} ${x.activo ? '' : 'opacity-60'}`}>
                                            <span aria-hidden className={`grid size-11 shrink-0 place-items-center rounded-full text-[14px] font-semibold ${x.rol === 'ADMINISTRADOR' ? 'bg-ink text-white' : 'bg-brand-50 text-brand'}`}>{iniciales(x.nombre, true)}</span>
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center gap-2"><span className="truncate text-[15px] font-semibold">{x.nombre}</span>{x.es_yo && <span className="text-[12px] text-muted">(tú)</span>}</span>
                                                <span className="mt-0.5 flex flex-wrap items-center gap-1.5"><RolChip rol={x.rol} />{!x.activo && <Etiqueta tono="bad">Desactivado</Etiqueta>}{x.activo && (x.debe_cambiar || x.sin_clave) && <Etiqueta tono="warn">{x.sin_clave ? 'Sin contraseña' : 'Clave temporal'}</Etiqueta>}</span>
                                                <span className="mt-1 block truncate text-[12.5px] text-muted">@{x.username} · {x.ultimo_acceso ? `entró ${hace(x.ultimo_acceso.slice(0, 10), hoy).toLowerCase()}` : 'nunca ha entrado'}</span>
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>
                    <Card className={`min-h-[420px] ${movil ? '' : 'hidden xl:block'}`}>
                        {u ? <Ficha u={u} hoy={hoy} matriz={matriz} onVolver={() => setMovil(false)}
                            onEditar={() => abrir('editar', { nombre: u.nombre, rol: u.rol })}
                            onClave={() => abrir('clave', { clave: generarClave() })}
                            onEstado={() => abrir('estado')} />
                            : <Vacio icon={Users} titulo="Elige un usuario" texto="Verás su rol, su actividad y las pantallas a las que entra." />}
                    </Card>
                </div>
            )}

            {modal?.tipo === 'nuevo' && (
                <Modal titulo="Nuevo usuario" subtitulo="Crea el acceso de una persona. Tú le entregas la contraseña temporal." cerrar={cerrar} onSubmit={crear} enviando={enviando} ok="Crear usuario" ancho="max-w-[560px]">
                    <Error />
                    <Field label="Nombre completo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} error={errs.nombre} autoFocus />
                    <Field label="Usuario para entrar" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') })} error={errs.username} hint="Minúsculas, números, punto, guion. Ejemplo: maria.perez" autoCapitalize="none" />
                    <div><div className="mb-2 text-[14px] font-medium">Rol</div><RolCards value={f.rol} onChange={(rol) => setF({ ...f, rol })} />{errs.rol && <p className="mt-1 text-[13px] text-danger">{errs.rol}</p>}</div>
                    <ClaveCampo />
                </Modal>
            )}
            {modal?.tipo === 'editar' && u && (
                <Modal titulo="Editar usuario" subtitulo={`@${u.username}`} cerrar={cerrar} onSubmit={guardar} enviando={enviando} ancho="max-w-[560px]">
                    <Error />
                    <Field label="Nombre completo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} error={errs.nombre} autoFocus />
                    <div><div className="mb-2 text-[14px] font-medium">Rol</div><RolCards value={f.rol} onChange={(rol) => setF({ ...f, rol })} bloqueado={u.es_yo} />{u.es_yo && <p className="mt-1 text-[13px] text-muted">No puedes cambiar tu propio rol.</p>}{errs.rol && <p className="mt-1 text-[13px] text-danger">{errs.rol}</p>}</div>
                </Modal>
            )}
            {modal?.tipo === 'clave' && u && (
                <Modal titulo="Restablecer contraseña" subtitulo={`${u.nombre} (@${u.username}) tendrá que crear una nueva al entrar.`} cerrar={cerrar} onSubmit={restablecer} enviando={enviando} ok="Restablecer">
                    <Error /><ClaveCampo />
                </Modal>
            )}
            {modal?.tipo === 'estado' && u && (
                <Modal titulo={u.activo ? 'Desactivar usuario' : 'Activar usuario'} subtitulo={u.activo ? `${u.nombre} ya no podrá entrar. Sus ventas y registros se conservan.` : `${u.nombre} podrá volver a entrar con su contraseña.`} cerrar={cerrar} onSubmit={cambiarEstado} enviando={enviando} ok={u.activo ? 'Desactivar' : 'Activar'} peligro={u.activo}>
                    <Error />
                </Modal>
            )}
            {modal?.tipo === 'cred' && <Credenciales datos={modal.datos} cerrar={cerrar} />}
        </AppLayout>
    );
}
