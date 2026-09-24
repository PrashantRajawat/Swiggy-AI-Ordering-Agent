import { parseToolData } from "./validation";
import { z } from "zod";
import { MenuItem } from "../models/menu";
import { SwiggyMcpClient } from "./client";
import { MOCK_RESTAURANTS } from "./food";

const itemSchema = z.object({
  id: z.string(), name: z.string(), price: z.number().nonnegative().optional(),
  inStock: z.union([z.number(), z.boolean()]).optional(),
  categories: z.array(z.string()).default([]),
  hasVariants: z.boolean().optional(), hasAddons: z.boolean().optional(),
});
const commonMenuFields = {
  restaurant: z.object({ isOpen: z.boolean().optional() }).optional(),
  page: z.number().int().positive().optional(),
  hasMore: z.boolean().optional(),
};
const flatMenuSchema = z.object({ ...commonMenuFields, items: z.array(itemSchema) });
type RawMenuItem = z.infer<typeof itemSchema>;
interface MenuCategory {
  title: string;
  items?: RawMenuItem[];
  subcategories?: MenuCategory[];
}
const categorySchema: z.ZodType<MenuCategory, z.ZodTypeDef, unknown> = z.lazy(() => z.object({
  title: z.string(),
  items: z.array(itemSchema).optional(),
  subcategories: z.array(categorySchema).optional(),
}).refine((category) => category.items !== undefined || category.subcategories !== undefined, {
  message: "A menu category must contain items or subcategories",
}));
const groupedMenuSchema = z.object({ ...commonMenuFields, categories: z.array(categorySchema) });

function flattenCategories(categories: MenuCategory[], parents: string[] = []): RawMenuItem[] {
  return categories.flatMap((category) => {
    const path = [...parents, category.title];
    const items = (category.items ?? []).map((item) => ({
      ...item, categories: [...new Set([path.join("/"), ...item.categories])],
    }));
    return [...items, ...flattenCategories(category.subcategories ?? [], path)];
  });
}

export function normalizeMenuPage(raw: unknown): { items: MenuItem[]; page?: number; hasMore: boolean; closed: boolean } {
  const grouped = typeof raw === "object" && raw !== null && "categories" in raw && !("items" in raw);
  const data = grouped
    ? parseToolData("get_restaurant_menu", groupedMenuSchema, raw)
    : parseToolData("get_restaurant_menu", flatMenuSchema, raw);
  const closed = data.restaurant?.isOpen === false;
  const entries = "categories" in data
    ? flattenCategories(data.categories)
    : data.items;
  return {
    closed, page: data.page, hasMore: !closed && data.hasMore === true,
    items: closed ? [] : entries
      .filter((item) => item.price !== undefined && (item.inStock === 1 || item.inStock === true))
      .map((item) => ({
        id: item.id, name: item.name, price: item.price!, category: item.categories.join(" / "),
        available: true, requiresCustomization: Boolean(item.hasVariants || item.hasAddons),
      })),
  };
}

export class MenuMcpService {
  constructor(private readonly client: SwiggyMcpClient) {}
  async getRestaurantMenu(restaurantId: string, addressId: string): Promise<MenuItem[]> {
    if (this.client.isMockMode()) return MOCK_RESTAURANTS.find((r) => r.id === restaurantId)?.items ?? [];
    const itemsById = new Map<string, MenuItem>();
    // Bound remote work just as the flat browse endpoint bounds its item count.
    for (let page = 1; page <= 10; page += 1) {
      const args = page === 1 ? { restaurantId, addressId } : { restaurantId, addressId, page };
      const raw = await this.client.invokeTool("get_restaurant_menu", args, () => null);
      const data = normalizeMenuPage(raw);
      if (data.closed) return [];
      if (data.page !== undefined && data.page !== page) throw new Error("Swiggy returned an unexpected menu page. Please retry.");
      for (const item of data.items) {
        const existing = itemsById.get(item.id!);
        if (existing) {
          existing.category = [...new Set([...existing.category.split(" / "), ...item.category.split(" / ")])].join(" / ");
        } else {
          itemsById.set(item.id!, item);
        }
      }
      if (!data.hasMore || itemsById.size >= 150) break;
    }
    return [...itemsById.values()].slice(0, 150);
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
