<?php

/*
 * InventarioEsquemaTest · CONGELA el inventario del esquema multiinquilino,
 * verificado contra la instalación limpia del 16-nov-2026 (los mismos scripts
 * 00–43 que instala el CI):
 *
 *   80 tablas · 33 vistas · 226 rutinas (202 funciones + 24 procedimientos) ·
 *   154 triggers · 55 secuencias · 248 índices
 *
 * No es burocracia: m01 ya congela la ESTRUCTURA RLS (68 tablas de negocio +
 * 69 políticas con fn_sesion_permitida + 9 globales); aquí se congelan los
 * TOTALES. Cualquier migración que añada o quite objetos SIN querer rompe el
 * CI. Cuando el esquema crezca a propósito: actualizar ESTOS números con
 * commit (es el mismo contrato de t19).
 *
 * Además congela permanentemente los dos vectores de la revisión del esquema:
 *   · TODA vista de `tienda` con security_invoker=true — una vista sin invoker
 *     es un bypass potencial de RLS (verificado por pg_class.reloptions, NO
 *     por pg_views.definition, que solo contiene el SELECT y nunca las
 *     opciones de la vista);
 *   · TODA SECURITY DEFINER con search_path fijado — una DEFINER sin search_path
 *     explícito permite secuestro de búsqueda y escalada de privilegios.
 */

use Illuminate\Support\Facades\DB;

it('el inventario del esquema coincide con lo congelado', function () {
    $tablas = (int) DB::selectOne("SELECT count(*) AS n FROM pg_tables WHERE schemaname='tienda'")->n;
    expect($tablas)->toBe(77);

    $vistas = (int) DB::selectOne(
        "SELECT count(*) AS n FROM pg_class c JOIN pg_namespace nc ON nc.oid = c.relnamespace
         WHERE nc.nspname = 'tienda' AND c.relkind = 'v'"
    )->n;
    expect($vistas)->toBe(33);

    $rutinas = (int) DB::selectOne("SELECT count(*) AS n FROM information_schema.routines WHERE routine_schema='tienda'")->n;
    expect($rutinas)->toBe(222);

    $triggers = (int) DB::selectOne(
        "SELECT count(*) AS n FROM (SELECT DISTINCT trigger_name, event_object_table
         FROM information_schema.triggers WHERE trigger_schema = 'tienda') t"
    )->n;
    expect($triggers)->toBe(155);

    $secuencias = (int) DB::selectOne("SELECT count(*) AS n FROM pg_sequences WHERE schemaname='tienda'")->n;
    expect($secuencias)->toBe(55);

    $indices = (int) DB::selectOne("SELECT count(*) AS n FROM pg_indexes WHERE schemaname='tienda'")->n;
    expect($indices)->toBe(245);
});

it('ninguna tabla tiene RLS activo y toda SECURITY DEFINER fija search_path', function () {
    $tablasConRls = (int) DB::selectOne(
        "SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'tienda' AND rowsecurity IS TRUE"
    )->n;
    expect($tablasConRls)->toBe(0);

    $secdefSinSearchPath = (int) DB::selectOne(
        "SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace nc ON nc.oid = p.pronamespace
         WHERE nc.nspname = 'tienda' AND p.prosecdef
           AND (p.proconfig IS NULL OR NOT EXISTS (
               SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))"
    )->n;
    expect($secdefSinSearchPath)->toBe(0);
});
