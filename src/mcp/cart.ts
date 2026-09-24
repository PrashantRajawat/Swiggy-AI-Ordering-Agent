import { SwiggyMcpClient } from "./client";

// Low-level adapter only. No recommendation/UI route invokes cart mutations.
// Item customizations must come from search_menu and the discovered input schema.
export class CartMcpService {
  constructor(private readonly client: SwiggyMcpClient) {}

  async getCart(): Promise<unknown> {
    return this.client.invokeTool("get_food_cart", {}, () => ({ items: [] }));
  }

  async updateCart(input: {
    restaurantId: string;
    addressId: string;
    cartItems: Array<Record<string, unknown>>;
  }): Promise<unknown> {
    return this.client.invokeTool("update_food_cart", input, () => ({ items: input.cartItems }));
  }
}
