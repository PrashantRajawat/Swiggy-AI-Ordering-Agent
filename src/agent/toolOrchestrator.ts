import { Coupon } from "../models/coupon";
import { Restaurant } from "../models/restaurant";
import { logger } from "../utils/logger";
import { RestaurantMcpService } from "../mcp/restaurant";
import { MenuMcpService } from "../mcp/menu";
import { CartMcpService } from "../mcp/cart";
import { OffersMcpService } from "../mcp/offers";
import { OrdersMcpService, OrderResult } from "../mcp/orders";
import { mcpClient } from "../mcp/runtime";

export class ToolOrchestrator {
  private readonly client = mcpClient;
  private readonly restaurant = new RestaurantMcpService(this.client);
  private readonly menu = new MenuMcpService(this.client);
  private readonly cart = new CartMcpService(this.client);
  private readonly offers = new OffersMcpService(this.client);
  private readonly orders = new OrdersMcpService(this.client);
  private readonly restaurantLimit = Number(process.env.SWIGGY_MCP_MAX_RESTAURANTS ?? 10);

  async searchRestaurantsWithMenus(query: string): Promise<Restaurant[]> {
    logger.info("Tool orchestrator: search_restaurants", { query });
    const restaurants = await this.restaurant.searchRestaurants(query, this.restaurantLimit);

    const withMenus: Restaurant[] = [];
    for (const restaurant of restaurants) {
      logger.debug("Tool orchestrator: get_menu", { restaurantId: restaurant.id });
      const items = await this.menu.getRestaurantMenu(restaurant.id);
      if (items.length === 0) continue;
      withMenus.push({ ...restaurant, items });
    }

    return withMenus;
  }

  async getAvailableCoupons(): Promise<Coupon[]> {
    logger.info("Tool orchestrator: apply_available_offers");
    return this.offers.getAvailableOffers();
  }

  async syncCartForRecommendation(restaurantId: string, itemNames: string[]): Promise<void> {
    const restaurant = await this.restaurant.getRestaurantDetails(restaurantId);
    if (!restaurant) return;

    const selected = restaurant.items.filter((item) => itemNames.includes(item.name));
    await this.cart.updateCart(selected.map((item) => ({ restaurantId, item, quantity: 1 })));
  }

  async placeOrder(restaurantId: string, itemNames: string[], finalPrice: number): Promise<OrderResult> {
    logger.info("Tool orchestrator: place_order", { restaurantId, itemNames, finalPrice });
    return this.orders.placeOrder({ restaurantId, itemNames, finalPrice });
  }
}
