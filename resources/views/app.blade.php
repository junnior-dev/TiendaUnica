<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    {{-- Token CSRF para las peticiones AJAX del frontend (Inertia/axios lo lee de aquí) --}}
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title inertia>Repuestos de motos</title>
    @viteReactRefresh
    @vite(['resources/css/app.css', 'resources/js/app.jsx'])
    @inertiaHead
</head>
<body>
    @inertia
</body>
</html>
