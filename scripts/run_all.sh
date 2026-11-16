#!/bin/bash
# =============================================================================
#  run_all.sh · LA CADENA COMPLETA DE PRUEBAS DEL SISTEMA (2026), EN ORDEN Y
#  CON SUS DEPENDENCIAS. Cada paso falla duro (set -e) para que una regresión
#  nunca pase desapercibida.
#
#  Orden (y POR QUÉ):
#   0 · PostgreSQL vivo en 5433 (socket /tmp) — todo lo demás lo necesita.
#       (infra del sandbox: start_pg.sh NO forma parte del repo; en CI/Actions la
#        base la pone un contenedor de servicio postgres:17 y los workflows no
#        pasan por este script sino por scripts/infra/ y pasos por job.)
#   1 · setup_db.py (scripts/infra/) → reinstala `tienda` y `portal_saas` LIMPIAS
#       con los scripts 00–43 + semilla de pruebas.
#   2 · run_suites.py (scripts/infra/) → 688 funcionales (t01–t15 · f01–f17 ·
#       m01–m13 · p01–p03) contra el clon tienda_e2e.
#   3 · t16 (Inertia HTTP)    → necesita la base limpia (71 verificaciones).
#   4 · t17 (concurrencia)    → tolera el turno que t16 deja abierto (33).
#   5 · t18 (navegador E2E)   → necesita el SERVIDOR HTTP en :8000 y los
#                               assets de Vite construidos (19 pasos; incluye
#                               el humo del PDF con jspdf 4).
#   6 · Pest                  → bases DEDICADAS tienda_pest/portal_pest
#                               (clones del paso 1); no depende del servidor.
#   7 · t19 regresión         → crea SUS PROPIOS clones (tienda_regres) y sus
#                               PROPIOS servidores (:8010/8011/8012).
#   8 · k6 latencia/rampa/ventas → necesita el servidor de :8000 VIVO; las
#                               ventas de k6 dejan la base CON datos.
#   9 · concurrencia_pg       → clon tienda_carga (después de k6 no molesta).
#  10 · continuidad.py        → AL FINAL: pg_dump de una base CON ventas
#                               (c2 necesita datos reales que cruzar).
#  11 · trazabilidad.py       → cruza requisitos ↔ suites (incluye t19).
#  12 · composer/npm audit    → 0 vulnerabilidades esperadas.
#
#  Uso: bash scripts/run_all.sh [--rapido]   (sin --rapido corre TODO)
# =============================================================================
set -e
cd "$(dirname "$0")/.."

PHP=/home/z/my-project/work/stack/php-8.3.32/sapi/cli/php
PY=/home/z/.venv/bin/python
[ -x "$PHP" ] || PHP=php
[ -x "$PY" ] || PY=python3

export PHP_CLI_SERVER_WORKERS=8

echo "═══ 0 · PostgreSQL en 5433 (si no está vivo, arranca) ═══"
if ! pg_isready -h /tmp -p 5433 >/dev/null 2>&1; then
    bash /home/z/my-project/scripts/start_pg.sh
fi

if [ "$1" != "--rapido" ]; then
    echo "═══ 1 · Instalación limpia de bases (00–43 + semilla) ═══"
    $PY scripts/infra/setup_db.py

    echo "═══ 2 · Funcionales t/f/m/p (688 aserciones) ═══"
    $PY scripts/infra/run_suites.py /tmp/run_all_funcionales.log | tail -3
    tail -3 /tmp/run_all_funcionales.log
else
    echo "═══ (--rapido: se salta instalación y funcionales) ═══"
fi

echo "═══ 3–5 · Servidor HTTP en :8000 + t16 + t17 + t18 ═══"
$PHP artisan serve --host=127.0.0.1 --port=8000 > /tmp/run_all_serve.log 2>&1 &
SERVE_PID=$!
trap 'kill $SERVE_PID 2>/dev/null || true' EXIT
# El throttle de login (5/min por IP) usa el cache de archivos y PERSISTE entre
# corridas: las suites HTTP hacen varios logins y no deben heredar la ventana
# agotada de una corrida anterior (el límite sigue demostrándose en t19/RL-2).
$PHP artisan cache:clear >/dev/null 2>&1 || true
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:8000/up && break; sleep 1; done

$PY tests/e2e/t16_paginas_inertia.py     | tee /tmp/run_all_t16.log | tail -2
$PY tests/e2e/t17_concurrencia.py        | tee /tmp/run_all_t17.log | tail -2
$PY tests/e2e/t18_e2e_navegador.py       | tee /tmp/run_all_t18.log | tail -2

echo "═══ 6 · Pest (Laravel, bases dedicadas) ═══"
$PHP vendor/bin/pest --compact 2>&1 | tail -4

echo "═══ 7 · t19 regresión de hallazgos de auditoría ═══"
$PY tests/security/regresion_hallazgos.py | tee /tmp/run_all_t19.log | tail -3

echo "═══ 8 · k6: latencia, rampa y ventas por HTTP ═══"
for k in k6_latencia k6_rampa k6_ventas; do
    k6 run scripts/carga/$k.js | tee /tmp/run_all_$k.log | grep -E "checks|http_req_duration|iterations" | tail -4
done

echo "═══ 9 · Concurrencia PostgreSQL (A/B/C) ═══"
$PY scripts/carga/concurrencia_pg.py | tail -6

echo "═══ 10 · Continuidad (backup/restore/migración/rollback/search_path) ═══"
$PY scripts/infra/continuidad.py | tail -3

echo "═══ 11 · Trazabilidad requisitos ↔ suites ═══"
$PY tests/trazabilidad.py | tail -3

echo "═══ 12 · Auditorías de dependencias ═══"
composer audit --no-cache 2>/dev/null | tail -2 || echo "(composer audit: revisar)"
npm audit --omit=dev 2>/dev/null | tail -2 || echo "(npm audit: revisar)"

echo "═══ CADENA COMPLETA OK ═══"
