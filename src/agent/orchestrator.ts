import { LlmClient } from "../ai/llm";
import { getLatestProfile, saveProfile } from "../memory/preferences";
import { Coupon } from "../models/coupon";
import { Preferences, UserRequest } from "../models/user";
import { resolveDishQuery } from "../recommendation/relevance";
import { optimizeRestaurants } from "../recommendation/optimizer";
import { logger } from "../utils/logger";
import { mergePreferences } from "../utils/parser";
import { ConversationManager } from "./conversation";
import { normalizePreferences } from "./planner";
import { ToolOrchestrator } from "./toolOrchestrator";

export interface RecommendationSummary {
  restaurant: string;
  items: string[];
  subtotal: number;
  finalPrice: number;
  coupon: string | null;
  explanation: string;
  pricingIsEstimate?: boolean;
  distanceKm?: number;
  deliveryTimeMinutes?: number;
}

export interface AgentResponse {
  status: "need_more_info" | "ready";
  followUpQuestions?: string[];
  recommendation?: RecommendationSummary;
  recommendations?: RecommendationSummary[];
}

export class AgentOrchestrator {
  private readonly llm = new LlmClient();
  private readonly conversation = new ConversationManager(this.llm);
  private readonly tools = new ToolOrchestrator();

  async handleRequest(request: UserRequest): Promise<AgentResponse> {
    const intent = await this.llm.extractIntent(request.message);
    const dishQuery = resolveDishQuery(request.message, intent.dishQuery);
    if (!dishQuery) return { status: "need_more_info", followUpQuestions: ["Which dish would you like to order?"] };
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

    const restaurants = await this.tools.searchRestaurantsWithMenus(dishQuery, request.addressId);
    const coupons: Coupon[] = await this.tools.getAvailableCoupons();

    const result = optimizeRestaurants(restaurants, preferences, coupons, dishQuery);
    if (!result.best) {
      const explanation = result.matchingItemCount === 0
        ? `No available ${dishQuery} matched your request and preferences in the menus checked. Try another dish or adjust your preferences.`
        : `No matching ${dishQuery} combination fits your budget. The lowest estimated total among the matching options checked is INR ${result.lowestPrice}.`;

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
    const alternatives = result.ranked.slice(0, 3).map((option) => ({
      restaurant: option.restaurant.name,
      items: option.combination.items.map((i) => i.name),
      subtotal: option.combination.subtotal + option.restaurant.deliveryFee,
      finalPrice: option.finalPrice,
      coupon: option.coupon.coupon?.couponCode ?? null,
      pricingIsEstimate: Boolean(option.restaurant.pricingIsEstimate),
      distanceKm: option.restaurant.distanceKm,
      deliveryTimeMinutes: option.restaurant.deliveryTime || undefined,
      explanation: `Matches your request for ${dishQuery}. ${preferences.premium ? "Ranked matching dishes by relevance, restaurant rating and delivery time." : "Chosen for the lowest price among matching dishes within your budget."}${option.restaurant.pricingIsEstimate ? " Estimated from live menu prices; delivery fees, taxes, packaging, customizations and coupons are excluded. Checkout may exceed your budget. Your cart has not been changed." : " Demo coupon savings are included."}`,
    }));

    return {
      status: "ready",
      recommendation: alternatives[0],
      recommendations: alternatives,
    };
  }

}
