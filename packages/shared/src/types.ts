/**
 * Partli domain types — the single source of truth shared by web and mobile.
 *
 * These mirror the `/v1` contract served by `backend/` (FastAPI). The wire format
 * is snake_case; these types keep those names rather than remapping, so a payload
 * can be handed straight to a component without a translation layer that would
 * silently drift.
 *
 * Everything here is a plain type with no runtime dependency, so it is safe to
 * import from React Native and the browser.
 */

/** e.g. "toyota-yaris-qmn16" — the folder name under `data/vehicles/`. */
export type VehicleSlug = string;

/** Part id from the OEM catalogue (a UUID in `assemblies.json`). */
export type PartId = string;

/** Diagram id from the OEM catalogue. */
export type DiagramId = string;

/** Registration plate. The only thing a repairer types to start a job. */
export type Rego = string;

/**
 * The three vehicles that ship with a complete parts catalogue. Other slugs have
 * a prediction file but no `assemblies.json`, so the assistant degrades to
 * class-level predictions.
 */
export const CATALOGUE_VEHICLE_SLUGS = [
  'toyota-yaris-qmn16',
  'hyundai-santafe-pns53',
  'jaguar-epace-rfh447',
] as const;

export type CatalogueVehicleSlug = (typeof CATALOGUE_VEHICLE_SLUGS)[number];

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

/**
 * `no_catalogue` is a success case, not an error: several vehicles resolve to a
 * make and model with no OEM parts data behind them.
 */
export type VehicleStatus =
  | 'resolving'
  | 'identified'
  | 'catalogue_ready'
  | 'not_found'
  | 'no_catalogue';

/** One row of `GET /v1/vehicles` — what the demo can run. */
export interface VehicleSummary {
  slug: VehicleSlug;
  rego: Rego;
  make: string;
  model: string;
  year: number | null;
  has_prediction: boolean;
  has_catalogue: boolean;
}

/** The resolved vehicle behind a case. */
export interface Vehicle {
  vehicle_id: string;
  /** The `data/vehicles/<slug>` folder name — needed to address that vehicle's diagram images. */
  slug: VehicleSlug | null;
  status: VehicleStatus;
  rego: Rego;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  model_code: string | null;
  market: string | null;
  steering: string | null;
  parts_indexed: number;
  /** Part-to-part connections built for this vehicle; the prediction walks these. */
  edges_indexed?: number;
  resolved_ms: number | null;
}

export interface RegisterVehicleResponse {
  vehicle_id: string;
  rego: Rego;
  status: VehicleStatus;
  /** Simulated VIN-lookup latency, so the UI can show a realistic progress hint. */
  estimated_ms: number;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export type CaseStatus =
  | 'open'
  | 'analysing'
  | 'ready'
  | 'ordered'
  | 'sent_to_customer'
  | 'approved'
  | 'closed';

export type Zone = 'front' | 'rear' | 'left' | 'right' | 'other';

/** `both` appears when the frames or the repairer disagree about the corner. */
export type Side = 'L' | 'R' | 'C' | 'both';

export interface Impact {
  zone: Zone;
  side: Side;
  severity: number;
}

export interface CaseSummary {
  case_id: string;
  status: CaseStatus;
}

export interface CaseMessage {
  id: string;
  role: 'repairer' | 'assistant';
  kind: 'text' | 'voice' | 'image' | 'video' | 'question' | 'report';
  text: string | null;
  transcript: string | null;
  created_at: number;
}

/** One row of `GET /v1/cases` — what the recent-jobs drawer lists. */
export interface CaseListItem {
  case_id: string;
  status: CaseStatus;
  impact: Impact;
  vehicle: { rego: Rego | null; make: string | null; model: string | null; year: number | null };
  /** Set once the quote has been sent; links the front desk to the customer's page. */
  approval_token: string | null;
  /** Unix seconds. */
  updated_at: number;
  created_at: number;
}

export interface CaseDetail {
  case_id: string;
  vehicle_id: string;
  status: CaseStatus;
  impact: Impact;
  messages: CaseMessage[];
  report: DamageReport | null;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/**
 * Which of the three sections a part sits in.
 *
 * `visible` we can see it; `order` confident enough to buy now; `check` genuinely
 * uncertain and worth walking over to look at.
 */
export type Bucket = 'visible' | 'order' | 'check';

/** Why a part is implicated, decomposed from the noisy-OR that produced it. */
export interface Attribution {
  cause: string;
  relation: string;
  /** 0..1, and the shares of one part sum to 1. */
  share: number;
}

export interface ReportLine {
  part_id: PartId;
  part_number: string | null;
  name: string;
  /**
   * Probability this part needs replacing, 0..1.
   *
   * Only meaningful for parts the engine *inferred*. A line in `visible` was
   * observed by Partly's interpreter or confirmed by the repairer, so its
   * number is 0.95-1.0 by construction and says nothing — the UI rule is
   * observed = no number, predicted = number.
   */
  p: number;
  qty: number;
  reason?: string;
  /**
   * Fasteners, seals and sub-components that come with this line. A repairer
   * orders a bumper cover and its clips, never nine clips, so consumables are
   * nested here rather than given order slots of their own.
   */
  hardware?: ReportLine[];
  diagram_id?: DiagramId;
  /** False when the diagram exists but its image was not shipped — do not fetch. */
  diagram_available?: boolean;
  /** `[x1, y1, x2, y2]` on the diagram image. */
  hotspot?: [number, number, number, number];
  /**
   * Catalogue tags carried on top-level lines only (not hardware/consumables) —
   * enough for a client to place the part on something physical, e.g. a region
   * of a 3D model, without re-guessing it from the display name. `zone` is not
   * included; it is redundant with the report's own `impact.zone` for all but a
   * handful of klasses, which a client can default to the impact zone for.
   */
  side?: Side;
  klass?: string;
  /** null = not yet inspected. */
  confirmed?: boolean | null;
  inspection_rank?: number;
  inspection_value?: number;
  accessible?: boolean;
  attribution?: Attribution[];
}

/** The single most useful thing to ask the repairer next. */
export interface Question {
  id: string;
  text: string;
  options: string[];
  /** How much the report moves depending on the answer. */
  value: number;
  /** `repairer` means they raised it themselves and could not settle it. */
  source?: 'repairer' | 'counterfactual';
}

/** One row of `inspect_first`: what to physically look at next (spec 9.5/9.6). */
export interface InspectFirstItem {
  part_id: PartId;
  name: string;
  /** own + downstream information value; settled parts sink from both ends. */
  value: number;
  /** How many other parts change bucket depending on this answer. */
  informs: number;
}

/** One uploaded file. Recorded and listed only — uploads never drive the prediction. */
export interface MediaAsset {
  media_id: string;
  case_id: string;
  kind: 'image' | 'video' | 'audio' | 'frame';
  /** The name the repairer's device sent, so they recognise what they added. */
  filename: string | null;
  content_type: string | null;
  bytes: number;
  /** Unix seconds. */
  uploaded_at: number;
  processed_at: number | null;
}

/** One row of `GET /v1/vehicles/allowed` — the regos a case may be opened against. */
export interface AllowedVehicle {
  rego: Rego;
  make: string;
  model: string;
  year: number | null;
  slug: VehicleSlug;
}

export interface DamageReport {
  case_id: string;
  status: CaseStatus;
  vehicle: Vehicle;
  impact: Impact;
  question: Question | null;
  sections: Record<Bucket, ReportLine[]>;
  /** Fasteners with no parent in the report, collapsed into one group. */
  consumables?: ReportLine[];
  /** What the repairer uploaded. Listed, never analysed. */
  media?: MediaAsset[];
  /** Top accessible inspections, capped at 3. */
  inspect_first?: InspectFirstItem[];
  hidden_count?: number;
  computed_ms?: number;
  candidates?: number;
  /** True when there is no OEM catalogue and predictions are class-level only. */
  degraded?: boolean;
}

/** Frame-level disagreement, e.g. one frame says right and another says left. */
export interface Conflict {
  field: string;
  values: string[];
  detail: string;
}

export interface DamageDetail {
  case_id: string;
  impact: Impact & { evidence: string[]; confidence: number };
  visible: (ReportLine & { sources: string[] })[];
  conflicts: Conflict[];
}

// ---------------------------------------------------------------------------
// Parts and suppliers
// ---------------------------------------------------------------------------

export type SupplierKind = 'oem' | 'aftermarket' | 'used';

/**
 * The supplied dataset has no price, lead-time, stock or supplier field of any
 * kind, so everything here is generated and must be labelled in the UI.
 */
export interface Offer {
  offer_id: string;
  supplier: string;
  kind: SupplierKind;
  price_nzd: number;
  lead_days: number;
  in_stock: boolean;
  recommended: boolean;
  why?: string;
}

export interface RecommendationLine {
  part_id: PartId;
  part_number: string | null;
  name: string;
  p: number;
  bucket: Bucket;
  qty: number;
  offers: Offer[];
}

export interface Recommendations {
  lines: RecommendationLine[];
  simulated: true;
}

export interface OrderLineInput {
  part_id: PartId;
  offer_id?: string;
  qty?: number;
  action: 'accept' | 'reject' | 'modify';
}

export interface PlacedOrder {
  order_id: string;
  state: 'draft' | 'placed';
  line_count: number;
  total_nzd: number;
  simulated: true;
  lines: Array<{
    part_id: PartId;
    action: string;
    qty: number;
    offer_id: string | null;
    from_bucket: Bucket | null;
    price_nzd?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Customer approval
// ---------------------------------------------------------------------------

export interface ApprovalOption {
  id: string;
  tier: SupplierKind;
  label: string;
  price_nzd: number;
  lead_days: number;
  in_stock: boolean;
  recommended: boolean;
  why: string | null;
}

/** One part on the quote. `hidden` items are predicted but not yet confirmed. */
export interface ApprovalLine {
  part_id: PartId;
  display_name: string;
  part_number: string | null;
  kind: 'visible' | 'hidden';
  qty: number;
  p: number;
  options: ApprovalOption[];
}

/** One per-part decision submitted from the approval form. */
export interface ApprovalPick {
  part_id: PartId;
  offer_id?: string;
  action: 'accept' | 'reject';
}

export interface ApprovalPayload {
  case_id: string;
  status: CaseStatus;
  vehicle: {
    rego: Rego | null;
    make: string | null;
    model: string | null;
    year: number | null;
  };
  lines: ApprovalLine[];
  /** Set when the customer picked one supply tier for the whole quote. */
  approved_option: string | null;
  /** Set when the customer decided part by part instead. */
  approved_picks: ApprovalPick[];
  /** Unix seconds. */
  approved_at: number | null;
  totals: { cheapest_nzd: number; recommended_nzd: number };
  simulated: true;
}

export interface SendToCustomerResponse {
  case_id: string;
  token: string;
  approval_url: string;
  lines: ApprovalLine[];
  simulated: true;
}

// ---------------------------------------------------------------------------
// Errors and streaming
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | 'rego_not_found'
  | 'vehicle_not_found'
  | 'vehicle_not_ready'
  | 'catalogue_unavailable'
  | 'case_not_found'
  | 'media_too_large'
  | 'unsupported_media'
  | 'transcription_failed'
  | 'extraction_failed'
  | 'prediction_unavailable'
  | 'invalid_request'
  | 'internal_error';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
    detail?: unknown;
  };
}

/** Server-sent events pushed while a case is being analysed. */
export type CaseEvent =
  | { event: 'vehicle'; data: { status: VehicleStatus; parts_indexed: number } }
  | { event: 'transcript'; data: { message_id: string; text: string } }
  | { event: 'analysis'; data: { stage: string; progress?: number; error?: string } }
  | { event: 'report'; data: DamageReport }
  | { event: 'question'; data: Question };
