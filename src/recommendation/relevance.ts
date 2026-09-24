import { MenuItem } from "../models/menu";

// Dish identity is separate from optional flavor preferences. These aliases
// describe interchangeable menu wording, not broad restaurant categories.
const aliases: Record<string, string> = {
  rolls: "roll", wrap: "roll", wraps: "roll", frankie: "roll", frankies: "roll",
  pizzas: "pizza", burgers: "burger", waffles: "waffle", sandwiches: "sandwich",
  momos: "momo", dumplings: "dumpling", biriyani: "biryani", biryanis: "biryani",
  murgh: "chicken", murg: "chicken", chocolatey: "chocolate", choco: "chocolate",
  cheesy: "cheese", veggie: "veg", vegetarian: "veg", vegetables: "veg", vegetable: "veg",
  dips: "dip", sauces: "sauce", brownies: "brownie", shakes: "shake", fries: "fries",
};
const filler = new Set("i im i'm am want would like to eat order find search recommend suggest get give me please a an the some craving for with and of something best quality premium cheap cheapest budget tasty delicious good under below upto up rs inr rupee rupees people person persons serving servings piece pieces prefer preference".split(" "));
const dishForms = new Set("roll pizza burger waffle sandwich momo dumpling biryani rice noodle noodles pasta dosa idli shawarma paratha roti naan curry soup salad cake brownie icecream shake coffee tea juice dessert meal thali fries dip sauce chutney".split(" "));
const proteins = new Set(["chicken", "mutton", "lamb", "beef", "pork", "fish", "prawn", "paneer", "egg", "veg", "vegan"]);
const accompaniment = new Set(["dip", "sauce", "chutney", "dressing", "topping", "toppings", "addon", "add-on"]);

export function dishTokens(text: string): string[] {
  return text.toLowerCase().normalize("NFKC").replace(/ice[ -]cream/g, "icecream")
    .match(/[\p{L}]+/gu)?.map((token) => aliases[token] ?? token) ?? [];
}

export function extractDishQuery(message: string): string {
  const text = message
    .replace(/\b(?:under|below|budget(?: of)?|up to|upto)\s*(?:rs\.?|inr|₹)?\s*\d+(?:\.\d+)?/gi, " ")
    .replace(/(?:₹|\brs\.?|\binr)\s*\d+(?:\.\d+)?/gi, " ")
    .replace(/\bfor\s+\d+(?:\s+(?:people|persons?))?/gi, " ")
    .replace(/\b(?:no|without|avoid)\s+[\p{L}-]+/giu, " ");
  return dishTokens(text).filter((word) => !filler.has(word)).join(" ");
}

export function resolveDishQuery(message: string, proposed?: string | null): string {
  const fallback = extractDishQuery(message);
  const candidate = proposed ? extractDishQuery(proposed) : "";
  if (!candidate || fallback.split(" ").length <= 4) return fallback || candidate;
  // Language understanding must not drop an explicit dish or protein constraint.
  const required = dishTokens(fallback).filter((word) => dishForms.has(word) || proteins.has(word));
  const candidateTokens = new Set(dishTokens(candidate));
  return required.every((word) => candidateTokens.has(word)) ? candidate : fallback;
}

export function dishRelevance(item: MenuItem, query: string): number {
  const required = [...new Set(dishTokens(query).filter((word) => !filler.has(word)))];
  if (!required.length) return 0;

  const name = dishTokens(item.name);
  const nameSet = new Set(name);

  // A dip, sauce or accompaniment should not match a dish query unless the user
  // explicitly asked for that accompaniment as the base dish.
  const itemIsAccompaniment = name.some((word) => accompaniment.has(word));
  const queryIsAccompaniment = required.some((word) => accompaniment.has(word));
  if (itemIsAccompaniment && !queryIsAccompaniment) {
    // "Chicken Roll with BBQ Dip" is a chicken roll; "Barbeque Dip" is not.
    const baseName = dishTokens(item.name.split(/\bwith\b|\+|\-|\/|\(|\)/i)[0]);
    if (baseName.length === 0 || baseName.every((word) => accompaniment.has(word))) return 0;
  }

  // A dip under a "Chicken Rolls" category is still a dip. Dish identity must
  // be supported by the item's name; the restaurant/category cannot supply it.
  if (!required.every((word) => nameSet.has(word))) return 0;
  if (required.includes("veg") && (nameSet.has("non") || name.some((word) => proteins.has(word) && !["veg", "vegan", "paneer"].includes(word)))) return 0;

  const exactPhrase = name.join(" ").includes(required.join(" "));
  return exactPhrase ? 1 : 0.85;
}

export function filterItemsByDish(items: MenuItem[], query: string): MenuItem[] {
  return items.filter((item) => dishRelevance(item, query) > 0);
}
