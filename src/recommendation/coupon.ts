import { Coupon, CouponEvaluationResult } from "../models/coupon";

function applyCoupon(subtotal: number, coupon: Coupon): CouponEvaluationResult {
  if (!coupon.eligible || subtotal < coupon.minimumOrder) {
    return { coupon: null, finalPrice: subtotal, savings: 0 };
  }

  if (coupon.type === "flat") {
    const savings = Math.min(coupon.discount, subtotal);
    return { coupon, finalPrice: subtotal - savings, savings };
  }

  const rawDiscount = Math.floor((subtotal * coupon.discount) / 100);
  const savings = coupon.maxDiscount ? Math.min(rawDiscount, coupon.maxDiscount) : rawDiscount;
  return { coupon, finalPrice: subtotal - savings, savings };
}

export function bestCouponForSubtotal(subtotal: number, coupons: Coupon[]): CouponEvaluationResult {
  let best: CouponEvaluationResult = { coupon: null, finalPrice: subtotal, savings: 0 };

  for (const coupon of coupons) {
    const evaluated = applyCoupon(subtotal, coupon);
    if (evaluated.finalPrice < best.finalPrice) {
      best = evaluated;
    }
  }

  return best;
}
