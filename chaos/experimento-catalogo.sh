#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Wrapper do experimento de Chaos Engineering do QualiCart.
#
# Sobe catalogo (3201) e checkout (3200), roda a bateria baseline, reinjeta o
# catalogo com chaos, roda a bateria com falha, imprime o comparativo e faz o
# teardown de tudo. Toda a orquestracao esta no .mjs (Node nativo), este script
# apenas o executa de forma reproduzivel.
#
# Uso:
#   ./chaos/experimento-catalogo.sh
#   N_REQ=100 CHAOS_LATENCY_MS=500 CHAOS_FAIL_RATE=0.3 ./chaos/experimento-catalogo.sh
# -----------------------------------------------------------------------------
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

exec node chaos/experimento-catalogo.mjs
