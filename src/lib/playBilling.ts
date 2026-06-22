/**
 * Typed Play Billing helper for the web layer.
 *
 * Talks to `window.PlayBilling`, which is injected into the WebView at native
 * Android build time by `capacitor-scripts/apply-overrides.mjs` (the
 * `play-billing.js` bootstrap). The native side is `PlayBillingPlugin.java`
 * registered as `PlayBillingNative` in `MainActivity.java`.
 *
 * Outside the native Android shell (web browser, Lovable preview), every
 * call rejects with a clear error so callers can degrade gracefully.
 */

export type ProductType = "inapp" | "subs";

export interface BillingProduct {
  productId: string;
  type: ProductType;
  title?: string;
  description?: string;
  price?: string;
  priceAmountMicros?: number;
  priceCurrencyCode?: string;
  // Subscription extras (offer details vary by product config)
  offerToken?: string;
  basePlanId?: string;
}

export interface BillingPurchase {
  productId?: string;
  productIds?: string[];
  purchaseToken: string;
  orderId?: string;
  purchaseTime?: number;
  purchaseState?: number; // 0=unspecified, 1=purchased, 2=pending
  acknowledged?: boolean;
  autoRenewing?: boolean;
}

export interface PurchasesUpdatedPayload {
  responseCode: number;
  debugMessage?: string;
  purchases?: BillingPurchase[];
}

type Unsubscribe = () => void;

interface PlayBillingGlobal {
  __installed: true;
  isAvailable(): boolean;
  connect(): Promise<{ ready: boolean }>;
  destroy(): void;
  queryProducts(ids: string[]): Promise<BillingProduct[]>;
  querySubscriptions(ids: string[]): Promise<BillingProduct[]>;
  launchPurchase(productId: string): Promise<{ launched: boolean }>;
  acknowledgePurchase(token: string): Promise<{ acknowledged: boolean }>;
  consumePurchase(token: string): Promise<{ consumed: boolean }>;
  queryPurchases(type: ProductType): Promise<BillingPurchase[]>;
  on(event: string, fn: (payload: unknown) => void): Unsubscribe;
}

declare global {
  interface Window {
    PlayBilling?: PlayBillingGlobal;
    PlayBillingNative?: Record<string, unknown>;
  }
}

function pb(): PlayBillingGlobal {
  const g = typeof window !== "undefined" ? window.PlayBilling : undefined;
  if (!g) {
    throw new Error(
      "Play Billing bridge unavailable. Build the native Android app with billing enabled."
    );
  }
  return g;
}

export const playBilling = {
  /** True only inside the native Android shell with billing wired up. */
  isAvailable(): boolean {
    return typeof window !== "undefined" && !!window.PlayBilling?.isAvailable();
  },

  /** Establish a BillingClient connection. The bootstrap auto-runs this on load. */
  connect(): Promise<{ ready: boolean }> {
    return pb().connect();
  },

  /** Fetch one-time product details. */
  queryProducts(productIds: string[]): Promise<BillingProduct[]> {
    return pb().queryProducts(productIds);
  },

  /** Fetch subscription product details (with offer tokens). */
  querySubscriptions(productIds: string[]): Promise<BillingProduct[]> {
    return pb().querySubscriptions(productIds);
  },

  /**
   * Start the Play Billing purchase UI for a productId. Resolves when the
   * sheet has been launched — listen with onPurchasesUpdated for the result.
   */
  launchPurchase(productId: string): Promise<{ launched: boolean }> {
    return pb().launchPurchase(productId);
  },

  /** Acknowledge a non-consumable / subscription purchase (required within 3 days). */
  acknowledgePurchase(purchaseToken: string): Promise<{ acknowledged: boolean }> {
    return pb().acknowledgePurchase(purchaseToken);
  },

  /** Consume a consumable purchase so it can be bought again. */
  consumePurchase(purchaseToken: string): Promise<{ consumed: boolean }> {
    return pb().consumePurchase(purchaseToken);
  },

  /** List active entitlements the user already owns. */
  queryPurchases(type: ProductType = "inapp"): Promise<BillingPurchase[]> {
    return pb().queryPurchases(type);
  },

  /** Subscribe to purchase results from the Play UI or restored connections. */
  onPurchasesUpdated(
    cb: (payload: PurchasesUpdatedPayload) => void
  ): Unsubscribe {
    return pb().on("purchasesUpdated", cb as (p: unknown) => void);
  },

  /** Subscribe to connection lifecycle events. */
  onConnectionStateChanged(cb: (payload: { connected: boolean }) => void): Unsubscribe {
    return pb().on("connectionStateChanged", cb as (p: unknown) => void);
  },
};

export default playBilling;
