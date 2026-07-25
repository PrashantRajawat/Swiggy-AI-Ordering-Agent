import { Coupon } from "../models/coupon";
import { SwiggyMcpClient } from "./client";

export class OffersMcpService {
  constructor(private readonly client: SwiggyMcpClient) {}

  async getAvailableOffers(): Promise<Coupon[]> {
    return this.client.invokeTool<Coupon[]>(
      "apply_available_offers",
      {},
      () => [
        {
          couponCode: "WELCOME50",
          discount: 50,
          minimumOrder: 199,
          eligible: true,
          type: "flat",
        },
        {
          couponCode: "SAVE20",
          discount: 20,
          minimumOrder: 299,
          eligible: true,
          type: "percent",
          maxDiscount: 80,
        },
      ],
    );
  }
}
