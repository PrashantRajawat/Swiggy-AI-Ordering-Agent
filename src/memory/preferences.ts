import { UserProfile } from "../models/user";
import { db, initDb } from "./sqlite";

initDb();

export function getLatestProfile(): UserProfile | null {
  const row = db
    .prepare("SELECT * FROM preferences ORDER BY id DESC LIMIT 1")
    .get() as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    usualBudget: typeof row.budget === "number" ? row.budget : undefined,
    favoriteCuisine: typeof row.favoriteCuisine === "string" ? row.favoriteCuisine : undefined,
    favoriteDessert: typeof row.favoriteDessert === "string" ? row.favoriteDessert : undefined,
    dislikes: typeof row.dislikes === "string" ? row.dislikes.split(",").filter(Boolean) : undefined,
    swiggyOne: row.swiggyOne === 1,
    defaultAddress: typeof row.defaultAddress === "string" ? row.defaultAddress : undefined,
    lastUpdated: typeof row.lastUpdated === "string" ? row.lastUpdated : undefined,
  };
}

export function saveProfile(profile: UserProfile): void {
  db.prepare(
    `INSERT INTO preferences (budget, favoriteCuisine, favoriteDessert, dislikes, swiggyOne, defaultAddress, lastUpdated)
     VALUES (@budget, @favoriteCuisine, @favoriteDessert, @dislikes, @swiggyOne, @defaultAddress, @lastUpdated)`,
  ).run({
    budget: profile.usualBudget ?? null,
    favoriteCuisine: profile.favoriteCuisine ?? null,
    favoriteDessert: profile.favoriteDessert ?? null,
    dislikes: profile.dislikes?.join(",") ?? null,
    swiggyOne: profile.swiggyOne ? 1 : 0,
    defaultAddress: profile.defaultAddress ?? null,
    lastUpdated: new Date().toISOString(),
  });
}
