/**
 * Typed AdMob helper for the web layer.
 *
 * Talks to `window.AdMobBridge`, which is injected into the WebView at
 * native Android build time by `capacitor-scripts/apply-overrides.mjs`
 * (the `admob.js` bootstrap). The native side is the `@capacitor-community/admob`
 * plugin, registered automatically by `npx cap sync android`.
 *
 * Every native callback is also broadcast as a DOM CustomEvent on `window`:
 *   `admob:ready` | `admob:adLoaded` | `admob:adFailedToLoad` |
 *   `admob:adOpened` | `admob:adClosed` | `admob:adClicked` |
 *   `admob:adImpression` | `admob:rewardEarned`
 *
 * Outside the native shell (browser, Lovable preview), every call rejects
 * with a clear error so callers can degrade gracefully.
 */

export type AdFormat =
  | "banner"
  | "interstitial"
  | "rewarded"
  | "rewardedInterstitial"
  | "appOpen";

export type BannerPosition =
  | "TOP_CENTER"
  | "CENTER"
  | "BOTTOM_CENTER";

export type BannerSize =
  | "BANNER"
  | "LARGE_BANNER"
  | "MEDIUM_RECTANGLE"
  | "FULL_BANNER"
  | "LEADERBOARD"
  | "ADAPTIVE_BANNER"
  | "SMART_BANNER";

export interface BannerOptions {
  adId: string;
  adSize?: BannerSize;
  position?: BannerPosition;
  margin?: number;
  isTesting?: boolean;
  npa?: boolean;
}

export interface AdUnitOptions {
  adId: string;
  isTesting?: boolean;
  npa?: boolean;
}

export interface AdMobReward {
  type: string;
  amount: number;
}

export interface AdMobEventDetail {
  format: AdFormat;
  error?: { code?: number | string; message?: string };
  reward?: AdMobReward;
  [k: string]: unknown;
}

type EventName =
  | "ready"
  | "adLoaded"
  | "adFailedToLoad"
  | "adOpened"
  | "adClosed"
  | "adClicked"
  | "adImpression"
  | "rewardEarned";

interface AdMobBridge {
  isNative: () => boolean;
  isReady: () => boolean;
  initialize: (opts?: Record<string, unknown>) => Promise<unknown>;
  loadBanner: (opts: BannerOptions) => Promise<unknown>;
  showBanner: (opts: BannerOptions) => Promise<unknown>;
  hideBanner: () => Promise<unknown>;
  resumeBanner: () => Promise<unknown>;
  removeBanner: () => Promise<unknown>;
  loadInterstitial: (opts: AdUnitOptions) => Promise<unknown>;
  showInterstitial: () => Promise<unknown>;
  loadRewarded: (opts: AdUnitOptions) => Promise<unknown>;
  showRewarded: () => Promise<unknown>;
  loadRewardedInterstitial: (opts: AdUnitOptions) => Promise<unknown>;
  showRewardedInterstitial: () => Promise<unknown>;
  loadAppOpen: (opts: AdUnitOptions) => Promise<unknown>;
  showAppOpen: () => Promise<unknown>;
  on: (event: EventName, cb: (detail: AdMobEventDetail) => void) => () => void;
}

declare global {
  interface Window {
    AdMobBridge?: AdMobBridge;
  }
}

function bridge(): AdMobBridge | null {
  if (typeof window === "undefined") return null;
  return window.AdMobBridge ?? null;
}

function notNative(method: string): Promise<never> {
  return Promise.reject(
    new Error(
      `[admob] ${method} unavailable: not running inside the native Android shell.`,
    ),
  );
}

export function isAdMobAvailable(): boolean {
  const b = bridge();
  return !!(b && b.isNative());
}

export const AdMob = {
  isAvailable: isAdMobAvailable,
  initialize: (opts?: Record<string, unknown>) =>
    bridge()?.initialize(opts) ?? notNative("initialize"),

  // Banner
  loadBanner:   (opts: BannerOptions) => bridge()?.loadBanner(opts)   ?? notNative("loadBanner"),
  showBanner:   (opts: BannerOptions) => bridge()?.showBanner(opts)   ?? notNative("showBanner"),
  hideBanner:   ()                    => bridge()?.hideBanner()       ?? notNative("hideBanner"),
  resumeBanner: ()                    => bridge()?.resumeBanner()     ?? notNative("resumeBanner"),
  removeBanner: ()                    => bridge()?.removeBanner()     ?? notNative("removeBanner"),

  // Interstitial
  loadInterstitial: (opts: AdUnitOptions) => bridge()?.loadInterstitial(opts) ?? notNative("loadInterstitial"),
  showInterstitial: ()                    => bridge()?.showInterstitial()     ?? notNative("showInterstitial"),

  // Rewarded
  loadRewarded: (opts: AdUnitOptions) => bridge()?.loadRewarded(opts) ?? notNative("loadRewarded"),
  showRewarded: ()                    => bridge()?.showRewarded()     ?? notNative("showRewarded"),

  // Rewarded interstitial
  loadRewardedInterstitial: (opts: AdUnitOptions) =>
    bridge()?.loadRewardedInterstitial(opts) ?? notNative("loadRewardedInterstitial"),
  showRewardedInterstitial: () =>
    bridge()?.showRewardedInterstitial() ?? notNative("showRewardedInterstitial"),

  // App open
  loadAppOpen: (opts: AdUnitOptions) => bridge()?.loadAppOpen(opts) ?? notNative("loadAppOpen"),
  showAppOpen: ()                    => bridge()?.showAppOpen()     ?? notNative("showAppOpen"),

  /**
   * Subscribe to an AdMob lifecycle event. Returns an unsubscribe fn.
   * Works in the browser too — the event simply never fires there.
   */
  on(event: EventName, cb: (detail: AdMobEventDetail) => void): () => void {
    const b = bridge();
    if (b) return b.on(event, cb);
    if (typeof window === "undefined") return () => {};
    const h = (e: Event) => cb((e as CustomEvent<AdMobEventDetail>).detail);
    window.addEventListener(`admob:${event}`, h);
    return () => window.removeEventListener(`admob:${event}`, h);
  },
};

export default AdMob;
