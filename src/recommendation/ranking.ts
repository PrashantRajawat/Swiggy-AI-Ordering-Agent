import { CouponEvaluationResult } from "../models/coupon";
import { Restaurant } from "../models/restaurant";
import { Preferences } from "../models/user";
import { ItemCombination } from "./combinations";

export interface RankedOption {
  restaurant: Restaurant;
  combination: ItemCombination;
  coupon: CouponEvaluationResult;
  score: number;
  finalPrice: number;
}

export function scoreOption(
  restaurant: Restaurant,
  combination: ItemCombination,
  coupon: CouponEvaluationResult,
  preferences: Preferences,
): number {
  const preferenceText = preferences.flavors.join(" ").toLowerCase();
  const itemText = combination.items.map((i) => `${i.name} ${i.category}`.toLowerCase()).join(" ");
  const tasteMatch = preferenceText.length === 0
    ? 0.5
    : preferenceText.split(/\s+/).filter((token) => token && itemText.includes(token)).length;

  const deliveryPenalty = (restaurant.deliveryTime / 10) * preferences.deliveryTimeWeight;
  return (
    tasteMatch * 1.5 +
    restaurant.rating * 1.2 +
    coupon.savings * 0.03 -
    restaurant.deliveryFee * 0.08 -
    deliveryPenalty
  );
}
