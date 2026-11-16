<?php

// Plataforma multiinquilino: el dominio base del que cuelgan los subdominios de
// las tiendas. Ej.: SAAS_BASE_DOMAIN=misitiolibre.com → la-cava.misitiolibre.com
// resuelve el negocio con subdominio «la-cava» en tienda.estado_tenants.
return [
    'base_domain' => env('SAAS_BASE_DOMAIN', ''),

    // Contraseña de la página del super administrador del portal (/portal).
    // Vacía = el panel del portal queda deshabilitado (por defecto).
    'portal_admin_password' => env('PORTAL_ADMIN_PASSWORD', ''),
];
