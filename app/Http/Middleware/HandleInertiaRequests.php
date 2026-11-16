<?php

namespace App\Http\Middleware;

use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    protected $rootView = 'app';

    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /** Lo que todas las páginas reciben: el aviso breve tras guardar (flash.ok) y el módulo fiscal del plan. */
    public function share(Request $request): array
    {
        return [
            ...parent::share($request),
            'flash' => ['ok' => fn () => $request->session()->get('ok')],
            'modulo_fiscal' => fn () => $this->moduloFiscal($request),
        ];
    }

    /** ¿El plan de la tienda activa incluye la parte fiscal (ESPECIAL o DEMO)? */
    private function moduloFiscal(Request $request): ?bool
    {
        try {
            if (! \App\Support\Tenant::id()) {
                return null;
            }

            return \App\Support\Tenant::fiscal();
        } catch (\Throwable) {
            return null;
        }
    }
}
