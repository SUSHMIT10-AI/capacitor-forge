package com.aabforge.app;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

/**
 * Minimal JS bridge for Google Play Billing.
 * Web apps can call window.AndroidBilling.* from JS when ENABLE_BILLING is on.
 *
 * Reflection is used so the app still compiles when the billing dependency
 * is excluded (ENABLE_BILLING=false at build time).
 */
public class BillingBridge {
    private final Activity activity;
    private final WebView webView;
    private Object billingClient;

    public BillingBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        try {
            Class<?> clientCls = Class.forName("com.android.billingclient.api.BillingClient");
            Class<?> builderCls = Class.forName("com.android.billingclient.api.BillingClient$Builder");
            Object builder = clientCls.getMethod("newBuilder", android.content.Context.class).invoke(null, activity);
            builderCls.getMethod("enablePendingPurchases").invoke(builder);
            // Note: a real PurchasesUpdatedListener should be supplied for production use.
            // This bridge focuses on enabling the dependency + manifest permission so
            // Play Console accepts the AAB. Web teams can extend the bridge as needed.
            billingClient = builderCls.getMethod("build").invoke(builder);
        } catch (Throwable t) {
            // Billing lib not present — bridge becomes a no-op.
            billingClient = null;
        }
    }

    @JavascriptInterface
    public boolean isAvailable() {
        return billingClient != null;
    }

    @JavascriptInterface
    public String getStatus() {
        return billingClient != null ? "ready" : "unavailable";
    }

    public void destroy() {
        if (billingClient != null) {
            try {
                billingClient.getClass().getMethod("endConnection").invoke(billingClient);
            } catch (Throwable ignored) {}
        }
    }
}
