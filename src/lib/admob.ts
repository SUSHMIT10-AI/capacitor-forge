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
    __ADMOB_IDS__?: {
      appId?: string;
      banner?: string;
      interstitial?: string;
      rewarded?: string;
      rewardedInterstitial?: string;
      appOpen?: string;
      testMode?: boolean;
    };
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
    bridge()?.initialize({ ...(opts || {}), testingDevices: [], initializeForTesting: false }) ?? notNative("initialize"),

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

  // ---------------------------------------------------------------------------
  // High-level helpers — IDs injected at native build time via
  // `window.__ADMOB_IDS__`. Call these from anywhere in the web app; you do
  // NOT need to pass ad unit IDs manually. They auto-load and auto-show.
  // ---------------------------------------------------------------------------

  /** Returns the AdMob configuration injected by the builder (or null). */
  getIds() {
    if (typeof window === "undefined") return null;
    return window.__ADMOB_IDS__ ?? null;
  },

  /** Show a banner using the configured banner unit ID. */
  async showBannerAd(opts?: Partial<BannerOptions>) {
    const ids = (typeof window !== "undefined" && window.__ADMOB_IDS__) || {};
    if (!ids.banner) throw new Error("[admob] No banner ad unit ID configured.");
    return AdMob.showBanner({
      adId: ids.banner,
      adSize: "ADAPTIVE_BANNER",
      position: "BOTTOM_CENTER",
      margin: 0,
      ...(opts || {}),
      isTesting: false,
    });
  },

  /** Load + show an interstitial in one call. */
  async showInterstitialAd() {
    const ids = (typeof window !== "undefined" && window.__ADMOB_IDS__) || {};
    if (!ids.interstitial) throw new Error("[admob] No interstitial ad unit ID configured.");
    await AdMob.loadInterstitial({ adId: ids.interstitial, isTesting: false });
    return AdMob.showInterstitial();
  },

  /** Load + show a rewarded ad. Resolves with the awarded reward when the user finishes. */
  async showRewardedAd(): Promise<AdMobReward | null> {
    const ids = (typeof window !== "undefined" && window.__ADMOB_IDS__) || {};
    if (!ids.rewarded) throw new Error("[admob] No rewarded ad unit ID configured.");
    return new Promise<AdMobReward | null>((resolve, reject) => {
      let reward: AdMobReward | null = null;
      const offReward = AdMob.on("rewardEarned", (d) => {
        if (d.format === "rewarded" && d.reward) reward = d.reward;
      });
      const offClosed = AdMob.on("adClosed", (d) => {
        if (d.format !== "rewarded") return;
        offReward(); offClosed(); offFail();
        resolve(reward);
      });
      const offFail = AdMob.on("adFailedToLoad", (d) => {
        if (d.format !== "rewarded") return;
        offReward(); offClosed(); offFail();
        reject(new Error(d.error?.message || "Rewarded ad failed to load"));
      });
      AdMob.loadRewarded({ adId: ids.rewarded!, isTesting: false })
        .then(() => AdMob.showRewarded())
        .catch((err) => { offReward(); offClosed(); offFail(); reject(err); });
    });
  },

  /** Load + show a rewarded interstitial. Resolves with the reward. */
  async showRewardedInterstitialAd(): Promise<AdMobReward | null> {
    const ids = (typeof window !== "undefined" && window.__ADMOB_IDS__) || {};
    if (!ids.rewardedInterstitial) throw new Error("[admob] No rewarded-interstitial ad unit ID configured.");
    return new Promise<AdMobReward | null>((resolve, reject) => {
      let reward: AdMobReward | null = null;
      const offReward = AdMob.on("rewardEarned", (d) => {
        if (d.format === "rewardedInterstitial" && d.reward) reward = d.reward;
      });
      const offClosed = AdMob.on("adClosed", (d) => {
        if (d.format !== "rewardedInterstitial") return;
        offReward(); offClosed(); offFail();
        resolve(reward);
      });
      const offFail = AdMob.on("adFailedToLoad", (d) => {
        if (d.format !== "rewardedInterstitial") return;
        offReward(); offClosed(); offFail();
        reject(new Error(d.error?.message || "Rewarded interstitial failed to load"));
      });
      AdMob.loadRewardedInterstitial({ adId: ids.rewardedInterstitial!, isTesting: false })
        .then(() => AdMob.showRewardedInterstitial())
        .catch((err) => { offReward(); offClosed(); offFail(); reject(err); });
    });
  },

  /** Load + show an app-open ad (typically on resume). */
  async showAppOpenAd() {
    const ids = (typeof window !== "undefined" && window.__ADMOB_IDS__) || {};
    if (!ids.appOpen) throw new Error("[admob] No app-open ad unit ID configured.");
    await AdMob.loadAppOpen({ adId: ids.appOpen, isTesting: false });
    return AdMob.showAppOpen();
  },
};

export default AdMob;
