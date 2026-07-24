#!/usr/bin/env bash
# Example: starts the API (if it isn't already running) and shows how an AI
# prediction lines up with the catalogue + diagrams.
# Just run `./test.sh`.  Needs: docker, curl, jq
set -euo pipefail
BASE=${1:-http://localhost:8420}
cd "$(dirname "$0")"

# Bring up the compose network unless the API is already reachable. Only for the
# default local URL — a custom BASE ($1) is assumed to be already running.
if [ "$BASE" = "http://localhost:8420" ] && ! curl -sf -m 2 "$BASE/vehicles" >/dev/null 2>&1; then
  echo "== starting API (docker compose up -d) =="
  docker compose up -d
  echo "   waiting for it to be ready..."
  curl -sf --retry 90 --retry-delay 2 --retry-all-errors --retry-connrefused "$BASE/vehicles" >/dev/null \
    || { echo "API did not come up — see: docker compose logs"; exit 1; }
  echo "   ready. (stop later with: docker compose down)"
  echo
fi

echo "== vehicles =="
curl -s "$BASE/vehicles" | jq -r '.[] | "  \(.slug)  (\(.diagram_count) diagrams, \(.part_count) parts)"'

slug=$(curl -s "$BASE/vehicles" | jq -r '[.[] | select(.has_prediction)][0].slug')
echo; echo "== prediction for $slug -> catalogue part + diagram =="
pred=$(curl -s "$BASE/vehicles/$slug/predictions")
echo "$pred" | jq -r '.oem_parts.completed.data.oem_parts[0] as $g | $g.associated_oem_parts[0] as $m
  | "  damaged part: \($g.raw_part_name)\n  -> part_id:    \($m.part_id)\n  -> diagram_id: \($m.diagram_id)\n  -> match:      \($m.part_name) (\($m.confidence))"'

pid=$(echo "$pred" | jq -r '.oem_parts.completed.data.oem_parts[0].associated_oem_parts[0].part_id')
did=$(echo "$pred" | jq -r '.oem_parts.completed.data.oem_parts[0].associated_oem_parts[0].diagram_id')

echo; echo "== that part_id resolves in /assemblies =="
curl -s "$BASE/vehicles/$slug/assemblies" | jq -c --arg p "$pid" '.assemblies[$p] | {display_name, manufacturer_part_number, is_orderable, hotspot}'

echo; echo "== that diagram_id resolves to an image + annotations =="
curl -s -o /dev/null -w "  image        -> %{http_code} %{content_type}\n" "$BASE/vehicles/$slug/diagrams/$did/image"
curl -s "$BASE/vehicles/$slug/diagrams/$did/meta" | jq -c '{scale_x, scale_y}'
curl -s "$BASE/vehicles/$slug/diagrams/$did/annotations" | jq -c '{objects: (.objects | length)}'
