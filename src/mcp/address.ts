import { z } from "zod";
import { SwiggyMcpClient } from "./client";

const addressPageSchema = z.object({
  addresses: z.array(z.object({
    id: z.string().min(1), addressLine: z.string(),
    addressCategory: z.string().nullish().transform((value) => value ?? undefined),
    addressTag: z.string().nullish().transform((value) => value ?? undefined),
  })),
  pagination: z.object({ page: z.number().int(), hasMore: z.boolean() }),
});
export type AddressPage = z.infer<typeof addressPageSchema>;

export class AddressMcpService {
  constructor(private readonly client: SwiggyMcpClient) {}
  async getAddresses(page = 1): Promise<AddressPage> {
    const data = await this.client.invokeTool<unknown>("get_addresses", { page, pageSize: 10 }, () => ({
      addresses: [{ id: "mock-home", addressLine: "Demo delivery address", addressTag: "Home" }],
      pagination: { page: 1, hasMore: false },
    }));
    // Deliberately omit phone numbers from the browser response.
    const parsed = addressPageSchema.safeParse(data);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ");
      // Field paths only: never include address/phone/token values in diagnostics.
      throw new Error(`Swiggy address data has an unexpected format in: ${fields}.`);
    }
    return parsed.data;
  }
  async requireAddress(addressId?: string): Promise<string> {
    if (this.client.isMockMode()) return "mock-home";
    if (!addressId) throw new Error("Choose a saved Swiggy delivery address first.");
    let page = 1;
    let result: AddressPage;
    do {
      result = await this.getAddresses(page++);
      if (result.addresses.some((address) => address.id === addressId)) return addressId;
    } while (result.pagination.hasMore && page <= 100);
    throw new Error("This address is no longer available. Reload your saved addresses.");
  }
}
