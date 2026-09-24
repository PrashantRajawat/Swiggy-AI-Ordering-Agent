export interface MenuItem {
  id?: string;
  requiresCustomization?: boolean;
  name: string;
  price: number;
  category: string;
  available?: boolean;
}

export interface ExtractedMenu {
  restaurant: string;
  rating: number;
  deliveryTime: number;
  deliveryFee: number;
  items: MenuItem[];
}
