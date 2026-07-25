/**
 * Pull a vehicle out of free text.
 *
 * The entry screen lets a repairer type one sentence — "yaris front right hit, bumper
 * hanging off" — and turns it into a job. That means working out which vehicle they
 * meant and what is left over to treat as a damage description.
 *
 * Pure and framework-free, so it runs on device and is easy to test.
 */

import type { VehicleSummary } from './types.js';

/** Lowercase and strip anything that isn't a letter or digit. */
const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Split text into comparable word tokens. */
const tokenize = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Words that appear in slugs but carry no meaning for matching — the registration
 * plate fragment at the end of every slug, e.g. the `qmn16` in `toyota-yaris-qmn16`.
 * Matching on those would let "16" pick a car.
 */
function slugTerms(slug: string): string[] {
  const parts = slug.split('-');
  // Drop the trailing plate fragment; keep make and model parts.
  return parts.slice(0, Math.max(1, parts.length - 1));
}

export interface VehicleMatch {
  vehicle: VehicleSummary;
  /** How strong the match is. Model hits count for more than make hits. */
  score: number;
  /** The terms that matched, e.g. ["toyota", "yaris"]. */
  matchedTerms: string[];
  /** The input with the matched vehicle words removed — the damage description. */
  remainder: string;
}

export interface MatchVehicleOptions {
  /** Only consider vehicles with a full parts catalogue. Defaults to false. */
  requireCatalogue?: boolean;
}

/**
 * Find the vehicle a sentence is talking about.
 *
 * Returns null when nothing matches, so the caller can fall back to asking. A model
 * hit ("yaris") outweighs a make hit ("toyota"), because several demo vehicles share
 * a make — "toyota" alone is ambiguous between the Yaris, Prius and Hiace.
 */
export function matchVehicle(
  text: string,
  vehicles: VehicleSummary[],
  options: MatchVehicleOptions = {},
): VehicleMatch | null {
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;

  const squashedTokens = tokens.map(squash);
  // Also consider adjacent word pairs so "santa fe" matches the slug's "santafe".
  const pairs: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    pairs.push(squash(`${tokens[i]}${tokens[i + 1]}`));
  }

  const candidates = options.requireCatalogue
    ? vehicles.filter((v) => v.hasCatalogue)
    : vehicles;

  let best: VehicleMatch | null = null;

  for (const vehicle of candidates) {
    const makeTerm = squash(vehicle.make);
    const modelTerm = squash(vehicle.model);
    const extraTerms = slugTerms(vehicle.slug).map(squash);

    const matchedTerms: string[] = [];
    let score = 0;

    // Model match is the strong signal.
    if (modelTerm && (squashedTokens.includes(modelTerm) || pairs.includes(modelTerm))) {
      score += 3;
      matchedTerms.push(modelTerm);
    }

    // Make match is weaker — several vehicles share one.
    if (makeTerm && squashedTokens.includes(makeTerm)) {
      score += 1;
      matchedTerms.push(makeTerm);
    }

    // Slug fragments catch spellings the parsed model misses.
    for (const term of extraTerms) {
      if (matchedTerms.includes(term)) continue;
      if (squashedTokens.includes(term) || pairs.includes(term)) {
        score += 1;
        matchedTerms.push(term);
      }
    }

    if (score === 0) continue;

    if (!best || score > best.score) {
      best = {
        vehicle,
        score,
        matchedTerms,
        remainder: stripTerms(text, matchedTerms),
      };
    }
  }

  return best;
}

/**
 * Remove the matched vehicle words from the original text, keeping the rest readable.
 * "yaris front right hit" -> "front right hit"
 */
function stripTerms(text: string, terms: string[]): string {
  if (terms.length === 0) return text.trim();

  const words = text.split(/(\s+)/);
  const kept: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (/^\s+$/.test(word)) {
      kept.push(word);
      continue;
    }

    const squashed = squash(word);
    if (terms.includes(squashed)) continue;

    // Handle a two-word term like "santa fe" being written out in full.
    const next = words[i + 2];
    if (next && terms.includes(squash(`${word}${next}`))) {
      i += 2;
      continue;
    }

    kept.push(word);
  }

  return kept
    .join('')
    .replace(/\s+/g, ' ')
    // Tidy up punctuation left stranded by the removal, e.g. ", front right".
    .replace(/^[\s,;:.\-]+/, '')
    .trim();
}
