import { Restaurant } from "../models/restaurant";
import { SwiggyMcpClient } from "./client";
import { MOCK_RESTAURANTS, normalizeQueryTokens } from "./food";

export class RestaurantMcpService {
  constructor(private readonly client: SwiggyMcpClient) {}

  async searchRestaurants(query: string, limit = 10): Promise<Restaurant[]> {
    return this.client.invokeTool<Restaurant[]>(
      "search_restaurants",
      { query, limit },
      () => {
        const normalized = normalizeQueryTokens(query);
        return MOCK_RESTAURANTS.filter((r) => {
          const haystack = `${r.name} ${r.items.map((i) => `${i.name} ${i.category}`).join(" ")}`.toLowerCase();
          return normalized.some((token) => haystack.includes(token));
        }).slice(0, limit);
      },
    );
  }

  async getRestaurantDetails(restaurantId: string): Promise<Restaurant | null> {
    return this.client.invokeTool<Restaurant | null>(
      "get_restaurant_details",
      { restaurantId },
      () => MOCK_RESTAURANTS.find((r) => r.id === restaurantId) ?? null,
    );
  }
}
