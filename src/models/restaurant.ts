import { MenuItem } from "./menu";

import { Coupon } from "./coupon";

export interface Restaurant {
  id: string;
  name: string;
  rating: number;
  deliveryTime: number;
  deliveryFee: number;
  distanceKm?: number;
  pricingIsEstimate?: boolean;
  items: MenuItem[];
  coupons?: Coupon[];
}

export interface RestaurantSearchResult {
  query: string;
  restaurants: Restaurant[];
}
