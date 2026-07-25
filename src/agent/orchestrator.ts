import { LlmClient } from "../ai/llm";
import { getLatestProfile, saveProfile } from "../memory/preferences";
import { Coupon } from "../models/coupon";
import { Preferences, UserRequest } from "../models/user";
import { optimizeRestaurants } from "../recommendation/optimizer";
import { logger } from "../utils/logger";
import { mergePreferences } from "../utils/parser";
import { ConversationManager } from "./conversation";
import { normalizePreferences } from "./planner";
import { ToolOrchestrator } from "./toolOrchestrator";

export interface AgentResponse {
  status: "need_more_info" | "ready";
  followUpQuestions?: string[];
  recommendation?: {
    restaurant: string;
    items: string[];
    subtotal: number;
    finalPrice: number;
    coupon: string | null;
    explanation: string;
  };
}

export class AgentOrchestrator {
  private readonly llm = new LlmClient();
  private readonly conversation = new ConversationManager(this.llm);
  private readonly tools = new ToolOrchestrator();

  async handleRequest(request: UserRequest): Promise<AgentResponse> {
    const intent = await this.llm.extractIntent(request.message);
    const profile = getLatestProfile();

    const merged = mergePreferences(
      {
        budget: profile?.usualBudget,
        dislikes: profile?.dislikes,
      },
      {
        ...request.preferences,
        flavors: request.preferences?.flavors ?? intent.flavors,
        dislikes: request.preferences?.dislikes ?? intent.dislikes,
        premium: request.preferences?.premium ?? (intent.premium ?? undefined),
        budget: request.preferences?.budget ?? (intent.budget ?? undefined),
        quantity: request.preferences?.quantity ?? (intent.quantity ?? undefined),
      },
    );

    if (merged.deliveryTimeWeight === undefined) merged.deliveryTimeWeight = 1;

    const missing = this.conversation.getMissingFields(merged);
    if (missing.length > 0) {
      const followUpQuestions = await this.conversation.getFollowUpQuestions(merged);
      return {
        status: "need_more_info",
        followUpQuestions,
      };
    }

    const preferences = normalizePreferences(merged);
    logger.info("Searching restaurants via Swiggy MCP", { message: request.message, preferences });

    const restaurants = await this.tools.searchRestaurantsWithMenus(request.message);
    const coupons: Coupon[] = await this.tools.getAvailableCoupons();

    const result = optimizeRestaurants(restaurants, preferences, coupons);
    if (!result.best) {
      const candidateTotals: number[] = [];
      for (const r of restaurants) {
        const availablePrices = r.items
          .filter((i) => i.available !== false)
          .map((i) => i.price)
          .sort((a, b) => a - b);
        if (availablePrices.length >= preferences.quantity) {
          const itemSubtotal = availablePrices.slice(0, preferences.quantity).reduce((sum, v) => sum + v, 0);
          candidateTotals.push(itemSubtotal + r.deliveryFee);
        }
      }
      const minTotal = candidateTotals.length > 0 ? Math.min(...candidateTotals) : null;
      const explanation = minTotal
        ? `No valid combinations were found within your constraints. Lowest visible pre-coupon total is about INR ${minTotal}. Increase budget or reduce quantity.`
        : "No valid combinations were found within your constraints.";

      return {
        status: "ready",
        recommendation: {
          restaurant: "No matching restaurant found",
          items: [],
          subtotal: 0,
          finalPrice: 0,
          coupon: null,
          explanation,
        },
      };
    }

    saveProfile({
      usualBudget: preferences.budget,
      favoriteDessert: preferences.flavors[0],
      dislikes: preferences.dislikes,
    });

    const top = result.best;
    await this.tools.syncCartForRecommendation(
      top.restaurant.id,
      top.combination.items.map((item) => item.name),
    );

    return {
      status: "ready",
      recommendation: {
        restaurant: top.restaurant.name,
        items: top.combination.items.map((i) => i.name),
        subtotal: top.combination.subtotal + top.restaurant.deliveryFee,
        finalPrice: top.finalPrice,
        coupon: top.coupon.coupon?.couponCode ?? null,
        explanation: await this.buildExplanation(top.score, preferences),
      },
    };
  }

  private async buildExplanation(score: number, preferences: Preferences): Promise<string> {
    const base = `Recommended based on your ${preferences.premium ? "premium" : "value"} preference, flavor match, restaurant rating, and coupon-adjusted final price. Internal score: ${score.toFixed(2)}.`;
    if (!this.llm.isEnabled()) return base;
    return base;
  }
}
