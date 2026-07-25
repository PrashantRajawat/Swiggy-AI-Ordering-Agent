import { SwiggyMcpClient } from "./client";

export interface PlaceOrderInput {
  restaurantId: string;
  itemNames: string[];
  finalPrice: number;
}

export interface OrderResult {
  orderId: string;
  status: "placed" | "failed";
}

export class OrdersMcpService {
  constructor(private readonly client: SwiggyMcpClient) {}

  async placeOrder(input: PlaceOrderInput): Promise<OrderResult> {
    return this.client.invokeTool<OrderResult>(
      "place_order",
      input as unknown as Record<string, unknown>,
      () => ({
        orderId: `mock-${Date.now()}`,
        status: "placed",
      }),
    );
  }

  async trackOrder(orderId: string): Promise<{ orderId: string; status: string }> {
    return this.client.invokeTool<{ orderId: string; status: string }>(
      "track_order",
      { orderId },
      () => ({ orderId, status: "confirmed" }),
    );
  }
}
