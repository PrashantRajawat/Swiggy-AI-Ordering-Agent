export interface Coupon {
  couponCode: string;
  discount: number;
  minimumOrder: number;
  eligible: boolean;
  type: "flat" | "percent";
  maxDiscount?: number;
}

export interface CouponEvaluationResult {
  coupon: Coupon | null;
  finalPrice: number;
  savings: number;
}
