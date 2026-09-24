import { parseToolData } from "./validation";
import { z } from "zod";
import { Restaurant } from "../models/restaurant";
import { SwiggyMcpClient } from "./client";
import { MOCK_RESTAURANTS, normalizeQueryTokens } from "./food";

const restaurantSearchSchema = z.object({ restaurants: z.array(z.object({
  id: z.string().optional(), name: z.string(), avgRating: z.number().optional(),
  deliveryTimeMinutes: z.number().optional(), distanceKm: z.number().optional(),
  availabilityStatus: z.string().optional(),
})) });

export class RestaurantMcpService {
  constructor(private readonly client: SwiggyMcpClient) {}
  async searchRestaurants(query: string, addressId: string, limit = 10): Promise<Restaurant[]> {
    if (this.client.isMockMode()) {
      const tokens = normalizeQueryTokens(query);
      return MOCK_RESTAURANTS.filter((r) => tokens.some((token) =>
        `${r.name} ${r.items.map((i) => `${i.name} ${i.category}`).join(" ")}`.toLowerCase().includes(token),
      )).slice(0, limit);
    }
    const data = parseToolData("search_restaurants", restaurantSearchSchema, await this.client.invokeTool("search_restaurants", { query, addressId }, () => null));
    return data.restaurants.filter((r) => r.id && r.availabilityStatus === "OPEN").slice(0, limit).map((r) => ({
      id: r.id!, name: r.name, rating: r.avgRating ?? 0, deliveryTime: r.deliveryTimeMinutes ?? 0,
      distanceKm: r.distanceKm, deliveryFee: 0, pricingIsEstimate: true, items: [],
    }));
  }
}
