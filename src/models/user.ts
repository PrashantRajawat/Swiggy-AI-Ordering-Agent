export interface Preferences {
  budget: number;
  quantity: number;
  flavors: string[];
  dislikes: string[];
  premium: boolean;
  deliveryTimeWeight: number;
}

export interface UserProfile {
  favoriteCuisine?: string;
  favoriteDessert?: string;
  usualBudget?: number;
  dislikes?: string[];
  swiggyOne?: boolean;
  defaultAddress?: string;
  lastUpdated?: string;
}

export interface UserRequest {
  message: string;
  preferences?: Partial<Preferences>;
}
