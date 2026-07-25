import { MenuItem } from "./menu";

export interface Restaurant {
  id: string;
  name: string;
  rating: number;
  deliveryTime: number;
  deliveryFee: number;
  items: MenuItem[];
}

export interface RestaurantSearchResult {
  query: string;
  restaurants: Restaurant[];
}
