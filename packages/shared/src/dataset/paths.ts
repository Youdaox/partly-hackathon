import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the repo's `data/` directory.
 *
 * Order of preference:
 *   1. `DATA_DIR` env var (what docker-compose sets).
 *   2. Walk up from this file looking for a directory containing `data/vehicles`.
 *
 * The walk means every workspace gets the same answer regardless of its cwd.
 */
let cached: string | null = null;

export function getDataDir(): string {
  if (cached) return cached;

  if (process.env.DATA_DIR) {
    cached = path.resolve(process.env.DATA_DIR);
    return cached;
  }

  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'data', 'vehicles'))) {
      cached = path.join(dir, 'data');
      return cached;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    'Could not locate the data/ directory. Set DATA_DIR to point at the dataset root.',
  );
}

/** Escape hatch for tests. */
export function setDataDir(dir: string): void {
  cached = path.resolve(dir);
}

export const vehicleDir = (slug: string) => path.join(getDataDir(), 'vehicles', slug);
export const vehicleFile = (slug: string) => path.join(vehicleDir(slug), 'vehicle.json');
export const assembliesFile = (slug: string) => path.join(vehicleDir(slug), 'assemblies.json');
export const diagramDir = (slug: string, diagramId: string) =>
  path.join(vehicleDir(slug), 'diagrams', diagramId);
export const annotationsFile = (slug: string, diagramId: string) =>
  path.join(diagramDir(slug, diagramId), 'annotations.json');
export const diagramMetaFile = (slug: string, diagramId: string) =>
  path.join(diagramDir(slug, diagramId), 'meta.json');
export const diagramImageFile = (slug: string, diagramId: string) =>
  path.join(diagramDir(slug, diagramId), 'image.webp');
export const predictionsFile = (slug: string) =>
  path.join(getDataDir(), 'predictions', `${slug}.json`);
