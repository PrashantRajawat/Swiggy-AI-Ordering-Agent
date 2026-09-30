import { Coupon } from "../models/coupon";
import { Restaurant } from "../models/restaurant";
import { RestaurantMcpService } from "../mcp/restaurant";
import { MenuMcpService } from "../mcp/menu";
import { AddressMcpService } from "../mcp/address";
import { OffersMcpService } from "../mcp/offers";
import { mcpClient } from "../mcp/runtime";

export class ToolOrchestrator {
  private readonly restaurant = new RestaurantMcpService(mcpClient);
  private readonly menu = new MenuMcpService(mcpClient);
  private readonly address = new AddressMcpService(mcpClient);
  private readonly offers = new OffersMcpService(mcpClient);
  private readonly restaurantLimit = Math.max(1, Math.min(10, Number(process.env.SWIGGY_MCP_MAX_RESTAURANTS) || 10));

  async searchRestaurantsWithMenus(query: string, selectedAddressId?: string, preferredRestaurants: string[] = []): Promise<Restaurant[]> {
    const addressId = await this.address.requireAddress(selectedAddressId);
    const restaurants = await this.restaurant.searchRestaurants(query, addressId, this.restaurantLimit);
    const normalized = (preferredRestaurants ?? [])
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .filter((name) => !/^(all|all restaurants|any restaurant|anywhere|no preference)$/i.test(name));
    const filtered = normalized.length
      ? restaurants.filter((restaurant) => normalized.some((name) => restaurant.name.toLowerCase().includes(name.toLowerCase())))
      : restaurants;
    const withMenus: Restaurant[] = [];
    for (const restaurant of filtered) {
      const items = await this.menu.getRestaurantMenu(restaurant.id, addressId);
      if (items.length) {
        const coupons = await this.offers.getRestaurantCoupons(restaurant.id, addressId);
        withMenus.push({ ...restaurant, items, coupons });
      }
    }
    return withMenus;
  }

  async getAvailableCoupons(): Promise<Coupon[]> {
    // Live coupon eligibility depends on a specific cart; don't apply demo discounts to live prices.
    return this.offers.getRecommendationCoupons();
  }
}
