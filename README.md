# Partly Hackathon 2026 — Dataset

Offline parts data for 8 damaged vehicles + Partly's AI damage→parts predictions.

## Run

```bash
./test.sh                  # starts the API (docker compose) + runs example calls.  needs: docker, curl, jq
```

Or start it yourself:

```bash
docker compose up          # API on http://localhost:8420  (docs: /docs)
```

## Data (`data/`)

```
vehicles/<slug>/
  vehicle.json                       make / model / year
  assemblies.json                    parts (by part_id) + diagrams (by diagram_id)
  diagrams/<diagram_id>/
    image.webp                       the diagram image
    annotations.json                 segment polygons + callouts (linked to parts by hotspot code)
    meta.json                        scale for placing hotspots on the image
predictions/<slug>.json              AI: damage -> catalogue parts (part_id + diagram_id)
damage-contexts/<vehicle-id>/        the raw input: video.mp4, frames/, vehicle_slug.txt
```

A part in `assemblies.json` has `display_name`, `manufacturer_part_number`, `is_orderable`,
and a `hotspot` ({diagram_id, x1..y2, code}). Predictions reference `part_id` / `diagram_id`
that resolve back into `assemblies.json`. Each `damage-contexts/` folder is named for its vehicle — the 8 match a `vehicles/<slug>`; 4 extras are other vehicles (make-plate) with no catalogue, for free experimentation.

## API

| Endpoint | |
|---|---|
| `GET /vehicles` | list |
| `GET /vehicles/{slug}/assemblies` | catalogue |
| `GET /vehicles/{slug}/diagrams/{id}/image \| meta \| annotations` | diagram assets |
| `GET /vehicles/{slug}/predictions` | AI prediction |
| `GET /predictions` | slugs with a prediction |

Damage contexts are files only — read them from `data/damage-contexts/`.

See `LICENSE-NOTE.md`.
