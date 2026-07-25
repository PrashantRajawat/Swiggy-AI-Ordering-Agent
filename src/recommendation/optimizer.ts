import { Coupon } from "../models/coupon";
import { Restaurant } from "../models/restaurant";
import { Preferences } from "../models/user";
import { filterItemsByFlavor, excludeDislikedItems } from "../mcp/menu";
import { bestCouponForSubtotal } from "./coupon";
import { filterValidCombinations, generateCombinations } from "./combinations";
import { RankedOption, scoreOption } from "./ranking";

export interface OptimizationResult {
  best: RankedOption | null;
  ranked: RankedOption[];
}

export function optimizeRestaurants(
  restaurants: Restaurant[],
  preferences: Preferences,
  coupons: Coupon[],
): OptimizationResult {
  const ranked: RankedOption[] = [];

  for (const restaurant of restaurants) {
    const filtered = excludeDislikedItems(
      filterItemsByFlavor(restaurant.items, preferences.flavors),
      preferences.dislikes,
    );

    const combos = filterValidCombinations(
      generateCombinations(filtered, preferences.quantity),
      preferences,
    );

    for (const combo of combos) {
      const coupon = bestCouponForSubtotal(combo.subtotal + restaurant.deliveryFee, coupons);
      if (coupon.finalPrice > preferences.budget) {
        continue;
      }
      const score = scoreOption(restaurant, combo, coupon, preferences);
      ranked.push({
        restaurant,
        combination: combo,
        coupon,
        score,
        finalPrice: coupon.finalPrice,
      });
    }
  }

  ranked.sort((a, b) => {
    if (preferences.premium) {
      return b.score - a.score;
    }
    if (a.finalPrice !== b.finalPrice) {
      return a.finalPrice - b.finalPrice;
    }
    return b.score - a.score;
  });

  return { best: ranked[0] ?? null, ranked };
}
