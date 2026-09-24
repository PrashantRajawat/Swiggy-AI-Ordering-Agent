import { filterItemsByDish } from "./relevance";
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
  matchingItemCount: number;
  lowestPrice: number | null;
}

export function optimizeRestaurants(
  restaurants: Restaurant[],
  preferences: Preferences,
  coupons: Coupon[],
  dishQuery: string,
): OptimizationResult {
  const ranked: RankedOption[] = [];
  let matchingItemCount = 0;
  let lowestPrice: number | null = null;

  for (const restaurant of restaurants) {
    const filtered = excludeDislikedItems(
      filterItemsByFlavor(filterItemsByDish(restaurant.items, dishQuery), preferences.flavors),
      preferences.dislikes,
    ).sort((a, b) => a.price - b.price);

    matchingItemCount += filtered.filter((item) => item.available !== false).length;
    const combos = filterValidCombinations(
      generateCombinations(filtered, preferences.quantity),
      preferences,
    );

    for (const combo of combos) {
      const coupon = bestCouponForSubtotal(combo.subtotal + restaurant.deliveryFee, coupons);
      lowestPrice = Math.min(lowestPrice ?? Infinity, coupon.finalPrice);
      if (coupon.finalPrice > preferences.budget) {
        continue;
      }
      const score = scoreOption(restaurant, combo, coupon, preferences, dishQuery);
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
      return b.score - a.score || a.finalPrice - b.finalPrice;
    }
    if (a.finalPrice !== b.finalPrice) {
      return a.finalPrice - b.finalPrice;
    }
    return b.score - a.score;
  });

  return { best: ranked[0] ?? null, ranked, matchingItemCount, lowestPrice };
}
