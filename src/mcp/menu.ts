import { MenuItem } from "../models/menu";
import { SwiggyMcpClient } from "./client";
import { MOCK_RESTAURANTS, normalizeQueryTokens } from "./food";

export class MenuMcpService {
  constructor(private readonly client: SwiggyMcpClient) {}

  async getRestaurantMenu(restaurantId: string): Promise<MenuItem[]> {
    return this.client.invokeTool<MenuItem[]>(
      "get_menu",
      { restaurantId },
      () => MOCK_RESTAURANTS.find((r) => r.id === restaurantId)?.items ?? [],
    );
  }

  async searchMenuItems(query: string, limit = 30): Promise<MenuItem[]> {
    return this.client.invokeTool<MenuItem[]>(
      "search_menu",
      { query, limit },
      () => {
        const normalized = normalizeQueryTokens(query);
        const items = MOCK_RESTAURANTS.flatMap((r) => r.items);
        return items.filter((item) => {
          const text = `${item.name} ${item.category}`.toLowerCase();
          return normalized.some((token) => text.includes(token));
        }).slice(0, limit);
      },
    );
  }
}

export function filterItemsByFlavor(items: MenuItem[], flavors: string[]): MenuItem[] {
  if (flavors.length === 0) return items;
  const keys = flavors.map((f) => f.toLowerCase());
  return items.filter((item) => {
    const text = `${item.name} ${item.category}`.toLowerCase();
    return keys.some((k) => text.includes(k));
  });
}

export function excludeDislikedItems(items: MenuItem[], dislikes: string[]): MenuItem[] {
  if (dislikes.length === 0) return items;
  const blocked = dislikes.map((d) => d.toLowerCase());
  return items.filter((item) => {
    const text = `${item.name} ${item.category}`.toLowerCase();
    return !blocked.some((d) => text.includes(d));
  });
}
