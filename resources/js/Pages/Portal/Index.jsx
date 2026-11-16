import { Head, usePage } from '@inertiajs/react';
import PortalLayout from '../../Layouts/PortalLayout';
import { Aviso } from '../../Components/saas';
import Resumen from './partes/Resumen';
import Tiendas from './partes/Tiendas';
import Pagos from './partes/Pagos';
import Ajustes from './partes/Ajustes';

/* Panel del super administrador del portal. Una sola ruta (/portal) con cuatro vistas (?vista=…): el servidor
   manda solo los datos de la vista abierta y las tablas filtran, ordenan y paginan allá (PortalAdminController). */

const TITULOS = {
    resumen: ['Resumen', 'Así va la plataforma: cuánto entra, qué pagos esperan y a quién cobrar'],
    tiendas: ['Tiendas', 'El estado comercial de cada cliente. Suspender corta el acceso; reactivar lo devuelve todo.'],
    pagos: ['Pagos', 'Verifica lo que reportan los clientes y consulta lo ya resuelto'],
    ajustes: ['Tasa y cuentas de cobro', 'Lo que ven los clientes al pagar su suscripción'],
};

export default function PortalIndex(props) {
    const { vista, tasa, n_pendientes } = props;
    const errors = usePage().props.errors || {};
    const [titulo, subtitulo] = TITULOS[vista];
    return (
        <PortalLayout vista={vista} titulo={titulo} subtitulo={subtitulo} tasa={tasa} nPendientes={n_pendientes}>
            <Head title={`Portal · ${titulo}`} />
            {errors.general && vista !== 'ajustes' && <Aviso tipo="error" className="mb-4">{errors.general}</Aviso>}
            {vista === 'resumen' && <Resumen {...props} />}
            {vista === 'tiendas' && <Tiendas {...props} />}
            {vista === 'pagos' && <Pagos {...props} />}
            {vista === 'ajustes' && <Ajustes {...props} errors={errors} />}
        </PortalLayout>
    );
}
