import { Coupon } from "../models/coupon";
import { SwiggyMcpClient } from "./client";

function firstString(value: unknown, keys: string[]): string | undefined {
  if (value && typeof value === "object") {
    for (const key of keys) {
      const field = (value as Record<string, unknown>)[key];
      if (typeof field === "string" && field.trim()) return field.trim();
    }
  }
  return undefined;
}

function firstNumber(value: unknown, keys: string[]): number | undefined {
  if (value && typeof value === "object") {
    for (const key of keys) {
      const field = (value as Record<string, unknown>)[key];
      if (typeof field === "number" && Number.isFinite(field)) return field;
      if (typeof field === "string" && field.trim() !== "") {
        const parsed = Number(field.replace(/[^0-9.-]/g, ""));
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }
  return undefined;
}

function asBoolean(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (["true", "yes", "eligible", "available", "active"].includes(lowered)) return true;
    if (["false", "no", "ineligible", "inactive"].includes(lowered)) return false;
  }
  return fallback;
}

function toCouponCode(raw: unknown): string | undefined {
  return firstString(raw, ["couponCode", "coupon_code", "code", "couponId", "id", "coupon", "name"]) ?? undefined;
}

export function normalizeCoupons(raw: unknown): Coupon[] {
  if (raw == null) return [];

  const queue: unknown[] = Array.isArray(raw) ? [...raw] : [raw];
  const coupons: Coupon[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null) continue;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (typeof current !== "object") continue;

    const obj = current as Record<string, unknown>;
    const candidateCode = toCouponCode(obj);
    const rawType = firstString(obj, ["type", "couponType", "discountType", "kind"]);
    const isPercent = /percent|percentage|discount/i.test(rawType ?? "") || obj.offerType === "PERCENTAGE";
    const discount = firstNumber(obj, ["discount", "discountValue", "amount", "value", "discountAmount"]) ?? 0;
    const minOrder = firstNumber(obj, ["minimumOrder", "minimum_order", "minOrder", "minAmount", "threshold", "minimumOrderValue"]) ?? 0;
    const maxDiscount = firstNumber(obj, ["maxDiscount", "max_discount", "cap", "maxDiscountValue"]) ?? undefined;
    const eligible = asBoolean(obj.eligible ?? obj.isEligible ?? obj.isApplicable ?? obj.applicable ?? obj.status, true);

    if (candidateCode && (discount > 0 || maxDiscount !== undefined || isPercent)) {
      coupons.push({
        couponCode: candidateCode,
        discount: discount || 0,
        minimumOrder: minOrder || 0,
        eligible,
        type: isPercent ? "percent" : "flat",
        ...(maxDiscount !== undefined ? { maxDiscount } : {}),
      });
    }

    for (const key of ["coupons", "offers", "coupon_sections", "couponSections", "items", "sections", "data", "results"]) {
      const value = obj[key];
      if (Array.isArray(value)) queue.push(...value);
      else if (value && typeof value === "object") queue.push(value);
    }
  }

  return coupons.filter((coupon, index, array) => array.findIndex((entry) => entry.couponCode === coupon.couponCode) === index);
}

export class OffersMcpService {
  constructor(private readonly client: SwiggyMcpClient) {}

  async getRecommendationCoupons(): Promise<Coupon[]> {
    if (!this.client.isMockMode()) return [];
    return [
      { couponCode: "WELCOME50", discount: 50, minimumOrder: 199, eligible: true, type: "flat" },
      { couponCode: "SAVE20", discount: 20, minimumOrder: 299, eligible: true, type: "percent", maxDiscount: 80 },
    ];
  }

  async getRestaurantCoupons(restaurantId: string, addressId: string): Promise<Coupon[]> {
    if (!restaurantId) return [];
    const payload = await this.getAvailableOffers(restaurantId, addressId);
    return normalizeCoupons(payload);
  }

  // Raw cart-specific data: coupon descriptions are not a reliable discount formula.
  async getAvailableOffers(restaurantId: string, addressId: string): Promise<unknown> {
    return this.client.invokeTool("fetch_food_coupons", { restaurantId, addressId }, () => ({ coupon_sections: [] }));
  }
}
