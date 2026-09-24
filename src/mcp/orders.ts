import { SwiggyMcpClient } from "./client";

// Checkout has no UI/API route yet. A caller must review the current cart,
// address and payment method with the user before setting confirmed=true.
export class OrdersMcpService {
  constructor(private readonly client: SwiggyMcpClient) {}

  async placeOrder(input: { addressId: string; paymentMethod: string }, confirmed: boolean): Promise<unknown> {
    if (!confirmed) throw new Error("Explicit order confirmation is required.");
    return this.client.invokeTool("place_food_order", input, () => ({ orderId: `mock-${Date.now()}`, status: "placed" }));
  }

  async trackOrder(orderId: string): Promise<unknown> {
    return this.client.invokeTool("track_food_order", { orderId }, () => ({ orderId, status: "confirmed" }));
  }
}
