/**
 * Read-only dataset endpoints, mounted at /api/vehicles.
 * Lets mobile and web browse the catalogue without bundling `data/` themselves.
 */

import { Router } from 'express';
import {
  hasCatalogue,
  listDiagramsWithAssets,
  listVehicles,
  loadAssemblies,
  loadDiagramSegments,
  loadPredictions,
  loadVehicle,
  searchParts,
  diagramImageFile,
  hasPredictions,
} from '@first-look/shared/dataset';

import { badRequest, notFound } from '../http.js';

export const vehiclesRouter = Router();

// GET /api/vehicles — the demo fleet, catalogue vehicles first
vehiclesRouter.get('/', (_req, res) => {
  const vehicles = listVehicles().sort((a, b) => {
    if (a.hasCatalogue !== b.hasCatalogue) return a.hasCatalogue ? -1 : 1;
    return a.slug.localeCompare(b.slug);
  });
  res.json(vehicles);
});

// GET /api/vehicles/:slug
vehiclesRouter.get('/:slug', (req, res) => {
  const vehicle = loadVehicle(req.params.slug);
  if (!vehicle.hasCatalogue && !vehicle.hasPrediction) {
    throw notFound(`Unknown vehicle "${req.params.slug}"`);
  }
  res.json(vehicle);
});

// GET /api/vehicles/:slug/parts?q=bumper — resolve free text onto catalogue parts
vehiclesRouter.get('/:slug/parts', (req, res) => {
  const { slug } = req.params;
  if (!hasCatalogue(slug)) throw notFound(`No parts catalogue for "${slug}"`);

  const query = String(req.query.q ?? '').trim();
  if (!query) throw badRequest('Missing query', 'Pass ?q=<search text>');

  const limit = Math.min(Number(req.query.limit ?? 10) || 10, 50);

  res.json(
    searchParts(slug, query, limit).map(({ partId, assembly }) => ({
      partId,
      displayName: assembly.display_name,
      manufacturerPartNumber: assembly.manufacturer_part_number ?? null,
      isOrderable: assembly.is_orderable,
      diagramId: assembly.hotspot?.diagram_id ?? null,
    })),
  );
});

// GET /api/vehicles/:slug/predictions — the shipped AI prediction
vehiclesRouter.get('/:slug/predictions', (req, res) => {
  const { slug } = req.params;
  if (!hasPredictions(slug)) throw notFound(`No prediction for "${slug}"`);
  res.json(loadPredictions(slug));
});

// GET /api/vehicles/:slug/diagrams — only the ones whose assets actually shipped
vehiclesRouter.get('/:slug/diagrams', (req, res) => {
  const { slug } = req.params;
  if (!hasCatalogue(slug)) throw notFound(`No parts catalogue for "${slug}"`);

  const { diagrams } = loadAssemblies(slug);
  res.json(
    listDiagramsWithAssets(slug).map((id) => ({
      id,
      name: diagrams[id]?.name ?? null,
      category: diagrams[id]?.category ?? null,
    })),
  );
});

// GET /api/vehicles/:slug/diagrams/:diagramId/segments — polygons mapped to parts
vehiclesRouter.get('/:slug/diagrams/:diagramId/segments', (req, res) => {
  const { slug, diagramId } = req.params;
  if (!hasCatalogue(slug)) throw notFound(`No parts catalogue for "${slug}"`);

  res.json(
    loadDiagramSegments(slug, diagramId).map((segment) => ({
      partId: segment.partId,
      code: segment.code,
      displayName: segment.displayName,
      boundingBox: segment.object.bounding_box,
      masks: segment.object.future_masks ?? [],
    })),
  );
});

// GET /api/vehicles/:slug/diagrams/:diagramId/image — the diagram artwork
vehiclesRouter.get('/:slug/diagrams/:diagramId/image', (req, res) => {
  const { slug, diagramId } = req.params;
  const file = diagramImageFile(slug, diagramId);
  res.sendFile(file, (error) => {
    if (error) res.status(404).json({ error: `No image for diagram ${diagramId}` });
  });
});
