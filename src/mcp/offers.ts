import { Coupon } from "../models/coupon";
import { SwiggyMcpClient } from "./client";

export class OffersMcpService {
  constructor(private readonly client: SwiggyMcpClient) {}

  async getRecommendationCoupons(): Promise<Coupon[]> {
    if (!this.client.isMockMode()) return [];
    return [
      { couponCode: "WELCOME50", discount: 50, minimumOrder: 199, eligible: true, type: "flat" },
      { couponCode: "SAVE20", discount: 20, minimumOrder: 299, eligible: true, type: "percent", maxDiscount: 80 },
    ];
  }

  // Raw cart-specific data: coupon descriptions are not a reliable discount formula.
  async getAvailableOffers(restaurantId: string, addressId: string): Promise<unknown> {
    return this.client.invokeTool("fetch_food_coupons", { restaurantId, addressId }, () => ({ coupon_sections: [] }));
  }
}
