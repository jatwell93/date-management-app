// Type definitions for inventory items

export interface InventoryItem {
  id: number;
  productId: number;
  expiryDate: string;
  locationId: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpiredItem {
  id: number;
  productId: number;
  expiryDate: string;
  sku: string;
  productName: string;
  costPrice: number;
  locationName: string;
  locationId: number;
  status: string;
  quantityAvailable: number;
}

export interface ExpiredItemTransaction {
  id: number;
  inventoryItemId: number;
  userId: number;
  action: 'sold_through' | 'expired';
  unitsDiscarded: number | null;
  financialLoss: number | null;
  markdownLevel: number | null;
  transactionDate: string;
}

export interface ProcessExpiredItemRequest {
  inventoryItemId: number;
  action: 'sold_through' | 'expired';
  unitsDiscarded?: number;
}
