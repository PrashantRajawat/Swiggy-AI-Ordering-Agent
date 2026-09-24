import { MenuItem } from "../models/menu";
import { Preferences } from "../models/user";

export interface ItemCombination {
  items: MenuItem[];
  subtotal: number;
}

export function generateCombinations(items: MenuItem[], quantity: number): ItemCombination[] {
  // Live menus can contain 150 dishes. Bound work to keep a request responsive.
  const maxCombinations = 20_000;
  const out: ItemCombination[] = [];
  const current: MenuItem[] = [];

  function dfs(start: number): void {
    if (out.length >= maxCombinations) return;
    if (current.length === quantity) {
      out.push({
        items: [...current],
        subtotal: current.reduce((sum, i) => sum + i.price, 0),
      });
      return;
    }

    for (let i = start; i < items.length; i += 1) {
      if (out.length >= maxCombinations) break;
      if (items[i].available === false) continue;
      current.push(items[i]);
      dfs(i);
      current.pop();
    }
  }

  if (Number.isInteger(quantity) && quantity > 0 && quantity <= 6 && items.length > 0) dfs(0);
  return out;
}

export function filterValidCombinations(
  combinations: ItemCombination[],
  preferences: Preferences,
): ItemCombination[] {
  const dislikes = preferences.dislikes.map((d) => d.toLowerCase());

  return combinations.filter((c) => {
    const text = c.items.map((i) => `${i.name} ${i.category}`.toLowerCase()).join(" ");
    if (dislikes.some((d) => text.includes(d))) return false;
    return true;
  });
}
