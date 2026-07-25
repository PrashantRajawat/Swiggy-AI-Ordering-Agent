import { Preferences } from "../models/user";

export function parseBudgetFromText(message: string): number | undefined {
  const budgetMatch = message.match(/(?:₹|rs\.?|rupees?)\s*(\d{2,5})|\b(\d{2,5})\b/i);
  if (!budgetMatch) return undefined;
  const value = Number(budgetMatch[1] ?? budgetMatch[2]);
  return Number.isFinite(value) ? value : undefined;
}

export function parseQuantityFromText(message: string): number | undefined {
  const qtyMatch = message.match(/(?:for|people|persons|serves?)\s*(\d+)/i);
  if (!qtyMatch) return undefined;
  const value = Number(qtyMatch[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

export function mergePreferences(
  base: Partial<Preferences>,
  incoming: Partial<Preferences>,
): Partial<Preferences> {
  return {
    ...base,
    ...incoming,
    flavors: incoming.flavors ?? base.flavors ?? [],
    dislikes: incoming.dislikes ?? base.dislikes ?? [],
  };
}
