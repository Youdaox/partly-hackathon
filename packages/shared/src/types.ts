/**
 * Partli domain types — the single source of truth shared by api, web and mobile.
 *
 * Everything here is a plain type with no runtime dependency, so it is safe to import
 * from React Native and the browser. Anything that touches the filesystem lives in
 * `@partli/shared/dataset` instead.
 */

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

/** e.g. "toyota-yaris-qmn16" — the folder name under `data/vehicles/`. */
export type VehicleSlug = string;

/** Part id from the OEM catalogue (a UUID in `assemblies.json`). */
export type PartId = string;

/** Diagram id from the OEM catalogue. */
export type DiagramId = string;

/**
 * The three vehicles that ship with a complete parts catalogue. Other slugs have a
 * prediction file but no `assemblies.json`, so the oracle cannot run on them.
 */
export const CATALOGUE_VEHICLE_SLUGS = [
  'toyota-yaris-qmn16',
  'hyundai-santafe-pns53',
  'jaguar-epace-rfh447',
] as const;

export type CatalogueVehicleSlug = (typeof CATALOGUE_VEHICLE_SLUGS)[number];

export interface VehicleSummary {
  slug: VehicleSlug;
  make: string;
  model: string;
  year: number | null;
  /** True when `data/vehicles/<slug>/assemblies.json` exists. */
  hasCatalogue: boolean;
  /** True when `data/predictions/<slug>.json` exists. */
  hasPrediction: boolean;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type JobStatus =
  /** Created; repairer is still walking around the car. */
  | 'capturing'
  /** The oracle has produced hidden-damage predictions. */
  | 'predicted'
  /** An approval link has been generated for the customer. */
  | 'sent_to_customer'
  /** The customer picked an option. */
  | 'approved';

export const JOB_STATUSES: readonly JobStatus[] = [
  'capturing',
  'predicted',
  'sent_to_customer',
  'approved',
];

/** How a visible damage item got onto the list. */
export type DamageSource = 'voice' | 'prediction' | 'manual';

export type Severity = 'minor' | 'moderate' | 'severe';

/** The AI dataset reports confidence as a label, not a number. */
export type ConfidenceLabel = 'low' | 'medium' | 'high';

export interface Job {
  id: string;
  vehicleSlug: VehicleSlug;
  status: JobStatus;
  createdAt: string;
}

/** A job plus everything the mobile app needs to render its screens. */
export interface JobState extends Job {
  vehicle: VehicleSummary | null;
  visibleDamage: DamageItem[];
  hiddenDamage: HiddenDamagePrediction[];
}

export interface DamageItem {
  id: string;
  jobId: string;
  partId: PartId;
  displayName: string;
  manufacturerPartNumber: string | null;
  source: DamageSource;
  createdAt: string;
}

export interface HiddenDamagePrediction {
  id: string;
  jobId: string;
  partId: PartId;
  displayName: string;
  /** 0..1. Adjusted up/down when a repairer confirms or denies. */
  confidenceScore: number;
  /** null = not yet reviewed. */
  confirmed: boolean | null;
  /** Human-readable justification, e.g. "next to Front Bumper Cover on Front Bumper". */
  reason: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Customer approval
// ---------------------------------------------------------------------------

/** Supply tier for a replacement part. Pricing in the MVP is placeholder. */
export type PartTier = 'oem' | 'aftermarket' | 'used';

export interface ApprovalOption {
  id: string;
  tier: PartTier;
  /** Display label for the option, e.g. "Genuine Toyota". */
  label: string;
  /** Price in minor units (cents) to avoid float rounding. */
  priceCents: number;
  currency: string;
  etaDays: number;
  warranty: string;
  manufacturerPartNumber: string | null;
  isOrderable: boolean;
}

/** One damaged part, with the options the customer can choose between. */
export interface ApprovalLineItem {
  partId: PartId;
  displayName: string;
  /** 'visible' items are confirmed damage; 'hidden' came from the oracle. */
  kind: 'visible' | 'hidden';
  options: ApprovalOption[];
}

/** The payload the public approval page renders. */
export interface ApprovalPayload {
  jobId: string;
  vehicle: VehicleSummary | null;
  status: JobStatus;
  lineItems: ApprovalLineItem[];
  /** Option id the customer already approved, if any. */
  approvedOption: string | null;
  approvedAt: string | null;
}

export interface CustomerApproval {
  id: string;
  jobId: string;
  options: ApprovalLineItem[];
  approvedOption: string | null;
  approvedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Proximity graph (shared by the oracle and the `proximity_graph_cache` table)
// ---------------------------------------------------------------------------

/** Why two parts are considered neighbours. */
export type ProximityEdgeKind =
  /** Hotspots sit near each other on the same exploded diagram. */
  | 'spatial'
  /** One part is a sub-assembly of the other. */
  | 'assembly';

export interface ProximityEdge {
  partId: PartId;
  neighborPartId: PartId;
  /** Normalised 0..1. Lower means closer. */
  distance: number;
  kind: ProximityEdgeKind;
}

export interface ProximityGraph {
  vehicleSlug: VehicleSlug;
  /** partId -> outgoing edges. Undirected: every edge is stored in both directions. */
  adjacency: Map<PartId, ProximityEdge[]>;
}

// ---------------------------------------------------------------------------
// API request/response contracts
// ---------------------------------------------------------------------------

export interface CreateJobRequest {
  vehicleSlug: VehicleSlug;
}

export interface AddDamageRequest {
  partId?: PartId;
  /** Free text from voice/manual entry. Resolved against the catalogue when partId is absent. */
  rawText?: string;
  displayName?: string;
  manufacturerPartNumber?: string | null;
  source?: DamageSource;
}

export interface PredictRequest {
  /** Cap on returned predictions. Defaults to 10. */
  limit?: number;
}

export interface PredictResponse {
  predictions: HiddenDamagePrediction[];
}

export interface ConfirmRequest {
  predictionId: string;
  confirmed: boolean;
}

export interface SendToCustomerResponse {
  jobId: string;
  approvalUrl: string;
  lineItems: ApprovalLineItem[];
}

export interface SubmitApprovalRequest {
  optionId: string;
}

export interface ApiError {
  error: string;
  detail?: string;
}
