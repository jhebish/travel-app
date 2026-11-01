import { SOURCES, type SourceId, type Weights, defaultWeights } from "./sources";

export interface EffectiveSources {
  weights: Weights;
  blocked: SourceId[];
  custom: boolean;
}

export interface AppSources {
  weights: Partial<Weights>;
  blocked: SourceId[];
}

export interface UserSources {
  useCustom: boolean;
  weights: Partial<Weights>;
  blocked: SourceId[];
}

const clampWeight = (n: unknown): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.max(0, Math.min(10, v));
};

/**
 * Combine the curators' defaults with a traveler's own mix.
 * - App-blocked sources stay blocked and at weight 0, whatever the traveler sets.
 * - A traveler can block more sources, and reweight everything else.
 */
export function blendWeights(app: AppSources, user?: UserSources | null): EffectiveSources {
  const base = { ...defaultWeights(), ...app.weights };
  const custom = !!user?.useCustom;
  const merged: Weights = { ...base, ...(custom ? user!.weights : {}) } as Weights;
  const blocked = new Set<SourceId>(app.blocked);
  if (custom) user!.blocked.forEach((b) => blocked.add(b));
  const weights = Object.fromEntries(
    SOURCES.map((s) => [s.id, blocked.has(s.id) ? 0 : clampWeight(merged[s.id])]),
  ) as Weights;
  return { weights, blocked: [...blocked], custom };
}

/** Sources that can contribute, highest weight first. */
export function activeSources(eff: EffectiveSources): SourceId[] {
  return SOURCES.filter((s) => !eff.blocked.includes(s.id) && eff.weights[s.id] > 0)
    .sort((a, b) => eff.weights[b.id] - eff.weights[a.id])
    .map((s) => s.id);
}
