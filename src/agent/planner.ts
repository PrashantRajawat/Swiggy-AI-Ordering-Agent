import { Preferences } from "../models/user";

export type AgentStep =
  | "need_more_info"
  | "search_swiggy"
  | "optimize"
  | "recommend"
  | "await_confirmation"
  | "place_order";

export function nextStep(
  preferencesComplete: boolean,
  hasRestaurants: boolean,
  hasRecommendation: boolean,
  confirmed: boolean,
): AgentStep {
  if (!preferencesComplete) return "need_more_info";
  if (!hasRestaurants) return "search_swiggy";
  if (!hasRecommendation) return "optimize";
  if (!confirmed) return "await_confirmation";
  return "place_order";
}

export function normalizePreferences(prefs: Partial<Preferences>): Preferences {
  if (!Number.isFinite(prefs.budget) || (prefs.budget ?? 0) <= 0) throw new Error("Budget must be a positive number.");
  if (!Number.isInteger(prefs.quantity) || (prefs.quantity ?? 0) < 1 || (prefs.quantity ?? 0) > 6) {
    throw new Error("Choose between 1 and 6 people.");
  }
  return {
    budget: prefs.budget ?? 300,
    quantity: prefs.quantity ?? 1,
    flavors: prefs.flavors ?? [],
    dislikes: prefs.dislikes ?? [],
    premium: prefs.premium ?? false,
    deliveryTimeWeight: prefs.deliveryTimeWeight ?? 1,
  };
}
