import { Restaurant } from "../models/restaurant";

export const MOCK_RESTAURANTS: Restaurant[] = [
  {
    id: "bwc",
    name: "Belgian Waffle Co",
    rating: 4.6,
    deliveryTime: 24,
    deliveryFee: 20,
    items: [
      { name: "Triple Chocolate Waffle", price: 199, category: "Chocolate", available: true },
      { name: "Nutella Waffle", price: 219, category: "Chocolate", available: true },
      { name: "Red Velvet Strawberry", price: 229, category: "Berry", available: true },
    ],
  },
  {
    id: "waffle-hub",
    name: "Waffle Hub",
    rating: 4.3,
    deliveryTime: 30,
    deliveryFee: 10,
    items: [
      { name: "Dark Choco Crunch", price: 189, category: "Chocolate", available: true },
      { name: "Brownie Blast", price: 209, category: "Brownie", available: true },
      { name: "Classic Maple", price: 169, category: "Classic", available: true },
    ],
  },
  {
    id: "dessert-lab",
    name: "Dessert Lab",
    rating: 4.7,
    deliveryTime: 35,
    deliveryFee: 35,
    items: [
      { name: "Nutella Brownie Waffle", price: 239, category: "Chocolate", available: true },
      { name: "Protein Waffle", price: 249, category: "Healthy", available: true },
    ],
  },
  {
    id: "pizza-palace",
    name: "Pizza Palace",
    rating: 4.4,
    deliveryTime: 28,
    deliveryFee: 25,
    items: [
      { name: "Margherita Pizza", price: 249, category: "Veg Pizza", available: true },
      { name: "Farmhouse Pizza", price: 329, category: "Veg Pizza", available: true },
      { name: "Paneer Tikka Pizza", price: 359, category: "Veg Pizza", available: true },
    ],
  },
  {
    id: "slice-street",
    name: "Slice Street",
    rating: 4.2,
    deliveryTime: 22,
    deliveryFee: 15,
    items: [
      { name: "Pepperoni Pizza", price: 379, category: "Non Veg Pizza", available: true },
      { name: "Chicken Supreme Pizza", price: 399, category: "Non Veg Pizza", available: true },
      { name: "Garlic Bread", price: 149, category: "Sides", available: true },
    ],
  },
  {
    id: "oven-story-lite",
    name: "Oven Story Lite",
    rating: 4.5,
    deliveryTime: 26,
    deliveryFee: 20,
    items: [
      { name: "Cheese Burst Pizza", price: 339, category: "Cheese Pizza", available: true },
      { name: "Double Cheese Margherita", price: 289, category: "Cheese Pizza", available: true },
      { name: "Veg Loaded Pizza", price: 349, category: "Veg Pizza", available: true },
    ],
  },
];

export function normalizeQueryTokens(query: string): string[] {
  const base = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.endsWith("s") ? t.slice(0, -1) : t));

  const expanded = new Set(base);
  for (const token of base) {
    if (token === "pizza") {
      expanded.add("margherita");
      expanded.add("pepperoni");
      expanded.add("cheese");
      expanded.add("farmhouse");
    }
    if (token === "waffle") {
      expanded.add("chocolate");
      expanded.add("nutella");
      expanded.add("brownie");
    }
  }

  return Array.from(expanded);
}
