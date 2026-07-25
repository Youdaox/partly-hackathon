/**
 * Types mirroring the raw JSON on disk under `data/`, exactly as Partly ships it.
 *
 * The files are pipeline dumps, so almost everything is wrapped in a `completed`
 * envelope and many fields are optional. Keep these types faithful to the disk
 * format — the friendly, flattened shapes live in `../types.ts`.
 */

import type { DiagramId, PartId } from '../types.js';

// --- data/vehicles/<slug>/vehicle.json --------------------------------------

export interface RawVehicleFile {
  completed?: {
    oem_brand?: string;
    chassis_number?: string;
    variants?: Array<{
      id?: string;
      /** A list of single-key objects, e.g. `[{ make: "toyota" }, { model: "YARIS" }]`. */
      properties?: Array<Record<string, string | number>>;
    }>;
  };
}

// --- data/vehicles/<slug>/assemblies.json -----------------------------------

/**
 * Where a part sits on its diagram. `x1,y1,x2,y2` is a bounding box in the
 * diagram image's pixel space — NOT the single `{x,y}` point the brief assumed.
 * Use `hotspotCenter()` to reduce it to a point.
 */
export interface RawHotspot {
  diagram_id: DiagramId;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Matches the `code` of a `kind: "pnc"` object in the diagram's annotations.json. */
  code: string;
}

export interface RawAssembly {
  /** Present on all assemblies. */
  display_name: string;
  /** Present on all assemblies. */
  is_orderable: boolean;
  /** Only on ~43% of assemblies — the ones that are actual orderable parts. */
  manufacturer_part_number?: string;
  std_note?: string;
  description?: string;
  quantity?: number;
  /** Only ~51% of assemblies are placed on a diagram. */
  hotspot?: RawHotspot;
  /** Children of this assembly. Present on ~19%. */
  sub_assembly_ids?: Array<{ id: PartId; oem: boolean; hca: boolean }>;
  is_generic?: boolean;
  position?: string;
  variant_group?: string;
}

export interface RawDiagram {
  id: DiagramId;
  name: string;
  code?: string;
  category?: string;
  /** Every assembly placed on this diagram. Disjoint across diagrams. */
  assembly_ids?: PartId[];
  extracted_info?: Array<Record<string, unknown>>;
}

export interface RawAssembliesFile {
  completed?: {
    oem_vehicle_id?: string;
    root_nodes?: PartId[];
    assemblies?: Record<PartId, RawAssembly>;
    diagrams?: Record<DiagramId, RawDiagram>;
  };
}

// --- data/vehicles/<slug>/diagrams/<id>/annotations.json --------------------

export interface RawPoint {
  x: number;
  y: number;
}

export interface RawAnnotationObject {
  /** `pnc` objects are the ones that link to a part via `code`. */
  kind: 'pnc' | 'erase' | 'box' | string;
  code: string;
  description: string;
  bounding_box: { top_left: RawPoint; bottom_right: RawPoint };
  /** Segment polygons. Outer array is a list of rings. */
  future_masks?: RawPoint[][];
}

export interface RawAnnotationsFile {
  completed?: {
    annotation?: {
      objects?: RawAnnotationObject[];
    };
  };
}

// --- data/vehicles/<slug>/diagrams/<id>/meta.json ---------------------------

export interface RawDiagramMeta {
  diagram_id: DiagramId;
  scale_x: number;
  scale_y: number;
}

// --- data/predictions/<slug>.json -------------------------------------------

export interface RawContextSelection {
  uri: string;
  relevance_score: number;
  collision_context: string;
  is_collision_relevant: boolean;
}

/** An AI-identified damaged part, in the model's own words (not catalogue-linked). */
export interface RawRecommendedPart {
  quantity?: number;
  severity?: string;
  confidence?: string;
  damage_reason?: string;
  raw_part_name: string;
  repairer_notes?: string[];
  source_image_ids?: string[];
  recommended_action?: string;
  replacement_reason?: string;
  recommended_part_id?: string;
}

/** A catalogue part matched to a raw damaged part. */
export interface RawAssociatedOemPart {
  part_id: PartId;
  part_name: string;
  confidence?: string;
  diagram_id?: DiagramId;
  diagram_name?: string;
  hardware_kit?: RawAssociatedOemPart[];
}

export interface RawOemPartGroup {
  quantity?: number;
  severity?: string;
  confidence?: string;
  damage_reason?: string;
  raw_part_name: string;
  source_image_ids?: string[];
  recommended_action?: string;
  replacement_reason?: string;
  associated_oem_parts?: RawAssociatedOemPart[];
}

export interface RawPredictionsFile {
  context_selection?: {
    completed?: { data?: { selected?: RawContextSelection[] } };
  };
  raw_parts?: {
    completed?: {
      data?: {
        recommended_parts?: RawRecommendedPart[];
        vehicle_damage_summary?: string;
      };
    };
  };
  oem_parts?: {
    completed?: {
      data?: {
        oem_parts?: RawOemPartGroup[];
        oem_diagrams?: unknown;
      };
    };
  };
}
