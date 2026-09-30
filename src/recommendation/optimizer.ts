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
  let fallbackBest: RankedOption | null = null;

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
      const restaurantCoupons = restaurant.coupons?.length ? restaurant.coupons : coupons;
      const coupon = bestCouponForSubtotal(combo.subtotal + restaurant.deliveryFee, restaurantCoupons);
      lowestPrice = Math.min(lowestPrice ?? Infinity, coupon.finalPrice);
      const option = {
        restaurant,
        combination: combo,
        coupon,
        score: scoreOption(restaurant, combo, coupon, preferences, dishQuery),
        finalPrice: coupon.finalPrice,
      };
      if (coupon.finalPrice <= preferences.budget) {
        ranked.push(option);
      } else if (!fallbackBest || option.finalPrice < fallbackBest.finalPrice) {
        fallbackBest = option;
      }
    }
  }

  const candidates = ranked.length ? ranked : fallbackBest ? [fallbackBest] : [];
  candidates.sort((a, b) => {
    if (preferences.premium) {
      return b.score - a.score || a.finalPrice - b.finalPrice;
    }
    if (a.finalPrice !== b.finalPrice) {
      return a.finalPrice - b.finalPrice;
    }
    return b.score - a.score;
  });

  return { best: candidates[0] ?? null, ranked: candidates, matchingItemCount, lowestPrice };
}
