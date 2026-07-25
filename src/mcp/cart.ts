import { MenuItem } from "../models/menu";
import { SwiggyMcpClient } from "./client";

export interface CartSnapshot {
  items: Array<{ restaurantId: string; item: MenuItem; quantity: number }>;
  subtotal: number;
}

export class CartMcpService {
  private mockItems: Array<{ restaurantId: string; item: MenuItem; quantity: number }> = [];

  constructor(private readonly client: SwiggyMcpClient) {}

  async addItems(restaurantId: string, item: MenuItem, quantity = 1): Promise<CartSnapshot> {
    return this.client.invokeTool<CartSnapshot>(
      "update_cart",
      { action: "add", restaurantId, item, quantity },
      () => {
        this.mockItems.push({ restaurantId, item, quantity });
        return this.computeMockCart();
      },
    );
  }

  async updateCart(items: Array<{ restaurantId: string; item: MenuItem; quantity: number }>): Promise<CartSnapshot> {
    return this.client.invokeTool<CartSnapshot>(
      "update_cart",
      { action: "replace", items },
      () => {
        this.mockItems = [...items];
        return this.computeMockCart();
      },
    );
  }

  async getCart(): Promise<CartSnapshot> {
    return this.client.invokeTool<CartSnapshot>(
      "get_cart",
      {},
      () => this.computeMockCart(),
    );
  }

  private computeMockCart(): CartSnapshot {
    const subtotal = this.mockItems.reduce((sum, row) => sum + row.item.price * row.quantity, 0);
    return {
      items: [...this.mockItems],
      subtotal,
    };
  }
}
