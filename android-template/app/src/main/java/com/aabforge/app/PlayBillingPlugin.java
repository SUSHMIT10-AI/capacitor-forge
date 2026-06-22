package com.aabforge.app;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * PlayBillingPlugin — the canonical Google Play Billing Library v6 bridge.
 *
 * Exposed to JS as: window.PlayBilling.*
 *
 *   PlayBilling.connect()                        → Promise<boolean>
 *   PlayBilling.querySubscriptions(["sku1",...]) → Promise<ProductDetails[]>
 *   PlayBilling.queryProducts(["sku1",...])      → Promise<ProductDetails[]>
 *   PlayBilling.launchPurchase("productId")      → Promise<Purchase>
 *   PlayBilling.queryPurchases()                 → Promise<Purchase[]>
 *   PlayBilling.acknowledgePurchase(token)       → Promise<boolean>
 *   PlayBilling.consumePurchase(token)           → Promise<boolean>
 *
 * IMPORTANT — Play policy: every non-consumable purchase MUST be acknowledged
 * within 3 days or it is automatically refunded. This plugin auto-acknowledges
 * after a successful PurchasesUpdatedListener callback. The web app should
 * still call PlayBilling.acknowledgePurchase(token) after server-side
 * receipt verification (recommended) — calling it twice is a no-op.
 *
 * Reflection is used so the app still compiles when the billing dependency
 * is excluded at build time (ENABLE_BILLING=false).
 */
public class PlayBillingPlugin {
    private static final String TAG = "PlayBilling";
    private final Activity activity;
    private final WebView webView;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private Object billingClient;          // BillingClient
    private boolean connected = false;
    /** Cache of queried ProductDetails by productId — required to launch the billing flow. */
    private final Map<String, Object> productCache = new HashMap<>();

    public PlayBillingPlugin(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        initClient();
    }

    private void initClient() {
        try {
            Class<?> clientCls   = Class.forName("com.android.billingclient.api.BillingClient");
            Class<?> builderCls  = Class.forName("com.android.billingclient.api.BillingClient$Builder");
            Class<?> listenerCls = Class.forName("com.android.billingclient.api.PurchasesUpdatedListener");
            Log.d(TAG, "Initializing BillingClient (lib v6 via reflection)");

            // Build a PurchasesUpdatedListener that auto-acknowledges and forwards to JS.
            Object purchasesUpdatedListener = java.lang.reflect.Proxy.newProxyInstance(
                listenerCls.getClassLoader(),
                new Class<?>[]{ listenerCls },
                (proxy, method, args) -> {
                    if ("onPurchasesUpdated".equals(method.getName()) && args != null && args.length >= 2) {
                        Object billingResult = args[0];
                        @SuppressWarnings("unchecked")
                        List<Object> purchases = (List<Object>) args[1];
                        int responseCode = (int) billingResult.getClass().getMethod("getResponseCode").invoke(billingResult);

                        JSONArray arr = new JSONArray();
                        if (purchases != null) {
                            for (Object p : purchases) {
                                JSONObject pj = purchaseToJson(p);
                                arr.put(pj);
                                // Auto-acknowledge purchased items (Play policy: ≤3 days)
                                int state = (int) p.getClass().getMethod("getPurchaseState").invoke(p);
                                boolean acked = (boolean) p.getClass().getMethod("isAcknowledged").invoke(p);
                                if (state == 1 /* PURCHASED */ && !acked) {
                                    String token = (String) p.getClass().getMethod("getPurchaseToken").invoke(p);
                                    acknowledge(token, null);
                                }
                            }
                        }
                        emit("onPurchasesUpdated", new JSONObject()
                            .put("responseCode", responseCode)
                            .put("purchases", arr));
                    }
                    return null;
                }
            );

            Object builder = clientCls.getMethod("newBuilder", android.content.Context.class).invoke(null, activity);
            builderCls.getMethod("enablePendingPurchases").invoke(builder);
            builderCls.getMethod("setListener", listenerCls).invoke(builder, purchasesUpdatedListener);
            billingClient = builderCls.getMethod("build").invoke(builder);
            Log.d(TAG, "BillingClient initialized successfully");
        } catch (Throwable t) {
            Log.e(TAG, "Failed to initialize BillingClient: " + t, t);
            billingClient = null;
        }
    }

    // ---------------- JS-facing API ----------------

    @JavascriptInterface
    public boolean isAvailable() {
        return billingClient != null;
    }

    @JavascriptInterface
    public void connect(final String callbackId) {
        if (billingClient == null) {
            Log.e(TAG, "connect() called but BillingClient is null");
            jsConsoleError("PlayBilling.connect: BillingClient unavailable (lib not bundled?)");
            resolve(callbackId, false);
            return;
        }
        Log.d(TAG, "Starting BillingClient connection…");
        try {
            Class<?> stateListenerCls = Class.forName("com.android.billingclient.api.BillingClientStateListener");
            Object stateListener = java.lang.reflect.Proxy.newProxyInstance(
                stateListenerCls.getClassLoader(),
                new Class<?>[]{ stateListenerCls },
                (proxy, method, args) -> {
                    String n = method.getName();
                    if ("onBillingSetupFinished".equals(n) && args != null && args.length >= 1) {
                        int code = (int) args[0].getClass().getMethod("getResponseCode").invoke(args[0]);
                        String dbg = (String) args[0].getClass().getMethod("getDebugMessage").invoke(args[0]);
                        connected = (code == 0);
                        Log.d(TAG, "onBillingSetupFinished code=" + code + " connected=" + connected + " msg=" + dbg);
                        if (!connected) jsConsoleError("PlayBilling.connect failed code=" + code + " msg=" + dbg);
                        resolve(callbackId, connected);
                    } else if ("onBillingServiceDisconnected".equals(n)) {
                        Log.w(TAG, "BillingService disconnected");
                        connected = false;
                    }
                    return null;
                }
            );
            billingClient.getClass().getMethod("startConnection", stateListenerCls).invoke(billingClient, stateListener);
        } catch (Throwable t) {
            Log.e(TAG, "connect() threw: " + t, t);
            jsConsoleError("PlayBilling.connect threw: " + t.getMessage());
            resolve(callbackId, false);
        }
    }

    @JavascriptInterface
    public void querySubscriptions(String productIdsJson, String callbackId) {
        queryProductDetails(productIdsJson, "subs", callbackId);
    }

    @JavascriptInterface
    public void queryProducts(String productIdsJson, String callbackId) {
        queryProductDetails(productIdsJson, "inapp", callbackId);
    }

    private void queryProductDetails(String productIdsJson, String productType, String callbackId) {
        if (billingClient == null) {
            Log.e(TAG, "queryProductDetails(" + productType + ") - client null");
            jsConsoleError("PlayBilling query failed: BillingClient null");
            resolveJson(callbackId, new JSONArray());
            return;
        }
        Log.d(TAG, "queryProductDetailsAsync type=" + productType + " ids=" + productIdsJson + " connected=" + connected);
        try {
            JSONArray ids = new JSONArray(productIdsJson);
            Class<?> productCls        = Class.forName("com.android.billingclient.api.QueryProductDetailsParams$Product");
            Class<?> productBuilderCls = Class.forName("com.android.billingclient.api.QueryProductDetailsParams$Product$Builder");
            Class<?> paramsCls         = Class.forName("com.android.billingclient.api.QueryProductDetailsParams");
            Class<?> paramsBuilderCls  = Class.forName("com.android.billingclient.api.QueryProductDetailsParams$Builder");
            Class<?> responseListenerCls = Class.forName("com.android.billingclient.api.ProductDetailsResponseListener");

            List<Object> productList = new ArrayList<>();
            for (int i = 0; i < ids.length(); i++) {
                Object pBuilder = productCls.getMethod("newBuilder").invoke(null);
                productBuilderCls.getMethod("setProductId", String.class).invoke(pBuilder, ids.getString(i));
                productBuilderCls.getMethod("setProductType", String.class).invoke(pBuilder, productType);
                productList.add(productBuilderCls.getMethod("build").invoke(pBuilder));
            }

            Object paramsBuilder = paramsCls.getMethod("newBuilder").invoke(null);
            paramsBuilderCls.getMethod("setProductList", List.class).invoke(paramsBuilder, productList);
            Object params = paramsBuilderCls.getMethod("build").invoke(paramsBuilder);

            Object listener = java.lang.reflect.Proxy.newProxyInstance(
                responseListenerCls.getClassLoader(),
                new Class<?>[]{ responseListenerCls },
                (proxy, method, args) -> {
                    if ("onProductDetailsResponse".equals(method.getName()) && args != null && args.length >= 2) {
                        int code = (int) args[0].getClass().getMethod("getResponseCode").invoke(args[0]);
                        String dbg = (String) args[0].getClass().getMethod("getDebugMessage").invoke(args[0]);
                        @SuppressWarnings("unchecked")
                        List<Object> details = (List<Object>) args[1];
                        Log.d(TAG, "onProductDetailsResponse code=" + code + " msg=" + dbg + " count=" + (details == null ? 0 : details.size()));
                        if (code != 0) jsConsoleError("PlayBilling query code=" + code + " msg=" + dbg);
                        JSONArray arr = new JSONArray();
                        if (details != null) {
                            for (Object d : details) {
                                JSONObject pj = productDetailsToJson(d);
                                arr.put(pj);
                                // Cache for launchPurchase()
                                String pid = invokeStr(d, "getProductId");
                                if (pid != null) productCache.put(pid, d);
                                Log.d(TAG, "  • product: " + pj.toString());
                            }
                        }
                        resolveJson(callbackId, arr);
                    }
                    return null;
                }
            );
            billingClient.getClass()
                .getMethod("queryProductDetailsAsync", paramsCls, responseListenerCls)
                .invoke(billingClient, params, listener);
        } catch (Throwable t) {
            Log.e(TAG, "queryProductDetails threw: " + t, t);
            jsConsoleError("PlayBilling query threw: " + t.getMessage());
            resolveJson(callbackId, new JSONArray());
        }
    }

    @JavascriptInterface
    public void launchPurchase(String productId, String callbackId) {
        if (billingClient == null) { resolve(callbackId, false); return; }
        Object cached = productCache.get(productId);
        if (cached != null) {
            launchFlowWithDetails(cached, callbackId);
            return;
        }
        // Auto-query inapp first; if not found, try subs.
        queryAndLaunch(productId, "inapp", callbackId, true);
    }

    private void queryAndLaunch(String productId, String productType, String callbackId, boolean retrySubs) {
        try {
            JSONArray ids = new JSONArray().put(productId);
            Class<?> productCls         = Class.forName("com.android.billingclient.api.QueryProductDetailsParams$Product");
            Class<?> productBuilderCls  = Class.forName("com.android.billingclient.api.QueryProductDetailsParams$Product$Builder");
            Class<?> paramsCls          = Class.forName("com.android.billingclient.api.QueryProductDetailsParams");
            Class<?> paramsBuilderCls   = Class.forName("com.android.billingclient.api.QueryProductDetailsParams$Builder");
            Class<?> respListenerCls    = Class.forName("com.android.billingclient.api.ProductDetailsResponseListener");

            Object pBuilder = productCls.getMethod("newBuilder").invoke(null);
            productBuilderCls.getMethod("setProductId", String.class).invoke(pBuilder, productId);
            productBuilderCls.getMethod("setProductType", String.class).invoke(pBuilder, productType);
            List<Object> productList = new ArrayList<>();
            productList.add(productBuilderCls.getMethod("build").invoke(pBuilder));

            Object paramsBuilder = paramsCls.getMethod("newBuilder").invoke(null);
            paramsBuilderCls.getMethod("setProductList", List.class).invoke(paramsBuilder, productList);
            Object params = paramsBuilderCls.getMethod("build").invoke(paramsBuilder);

            Object listener = java.lang.reflect.Proxy.newProxyInstance(
                respListenerCls.getClassLoader(),
                new Class<?>[]{ respListenerCls },
                (proxy, method, args) -> {
                    if ("onProductDetailsResponse".equals(method.getName()) && args != null && args.length >= 2) {
                        @SuppressWarnings("unchecked")
                        List<Object> details = (List<Object>) args[1];
                        if (details != null && !details.isEmpty()) {
                            Object d = details.get(0);
                            productCache.put(productId, d);
                            launchFlowWithDetails(d, callbackId);
                        } else if (retrySubs) {
                            queryAndLaunch(productId, "subs", callbackId, false);
                        } else {
                            resolve(callbackId, false);
                        }
                    }
                    return null;
                }
            );
            billingClient.getClass()
                .getMethod("queryProductDetailsAsync", paramsCls, respListenerCls)
                .invoke(billingClient, params, listener);
        } catch (Throwable t) {
            resolve(callbackId, false);
        }
    }

    private void launchFlowWithDetails(Object productDetails, String callbackId) {
        ui.post(() -> {
            try {
                Class<?> flowParamsCls           = Class.forName("com.android.billingclient.api.BillingFlowParams");
                Class<?> flowParamsBuilderCls    = Class.forName("com.android.billingclient.api.BillingFlowParams$Builder");
                Class<?> productParamsCls        = Class.forName("com.android.billingclient.api.BillingFlowParams$ProductDetailsParams");
                Class<?> productParamsBuilderCls = Class.forName("com.android.billingclient.api.BillingFlowParams$ProductDetailsParams$Builder");

                Object pdBuilder = productParamsCls.getMethod("newBuilder").invoke(null);
                productParamsBuilderCls.getMethod("setProductDetails", Class.forName("com.android.billingclient.api.ProductDetails"))
                    .invoke(pdBuilder, productDetails);

                // For subscriptions we must also pass the offer token.
                String productType = invokeStr(productDetails, "getProductType");
                if ("subs".equals(productType)) {
                    @SuppressWarnings("unchecked")
                    List<Object> offers = (List<Object>) productDetails.getClass()
                        .getMethod("getSubscriptionOfferDetails").invoke(productDetails);
                    if (offers != null && !offers.isEmpty()) {
                        String offerToken = (String) offers.get(0).getClass().getMethod("getOfferToken").invoke(offers.get(0));
                        productParamsBuilderCls.getMethod("setOfferToken", String.class).invoke(pdBuilder, offerToken);
                    }
                }
                Object pdParams = productParamsBuilderCls.getMethod("build").invoke(pdBuilder);

                List<Object> pdList = new ArrayList<>();
                pdList.add(pdParams);

                Object fpBuilder = flowParamsCls.getMethod("newBuilder").invoke(null);
                flowParamsBuilderCls.getMethod("setProductDetailsParamsList", List.class).invoke(fpBuilder, pdList);
                Object flowParams = flowParamsBuilderCls.getMethod("build").invoke(fpBuilder);

                Object result = billingClient.getClass()
                    .getMethod("launchBillingFlow", android.app.Activity.class, flowParamsCls)
                    .invoke(billingClient, activity, flowParams);
                int code = (int) result.getClass().getMethod("getResponseCode").invoke(result);
                // Resolve true if Play UI launched (responseCode 0 = OK). Final Purchase
                // arrives via the PurchasesUpdatedListener -> onPurchasesUpdated event.
                resolve(callbackId, code == 0);
            } catch (Throwable t) {
                resolve(callbackId, false);
            }
        });
    }

    @JavascriptInterface
    public void acknowledgePurchase(String purchaseToken, String callbackId) {
        acknowledge(purchaseToken, callbackId);
    }

    private void acknowledge(String purchaseToken, String callbackId) {
        if (billingClient == null || purchaseToken == null) {
            if (callbackId != null) resolve(callbackId, false);
            return;
        }
        try {
            Class<?> paramsCls        = Class.forName("com.android.billingclient.api.AcknowledgePurchaseParams");
            Class<?> paramsBuilderCls = Class.forName("com.android.billingclient.api.AcknowledgePurchaseParams$Builder");
            Class<?> listenerCls      = Class.forName("com.android.billingclient.api.AcknowledgePurchaseResponseListener");

            Object pBuilder = paramsCls.getMethod("newBuilder").invoke(null);
            paramsBuilderCls.getMethod("setPurchaseToken", String.class).invoke(pBuilder, purchaseToken);
            Object params = paramsBuilderCls.getMethod("build").invoke(pBuilder);

            Object listener = java.lang.reflect.Proxy.newProxyInstance(
                listenerCls.getClassLoader(),
                new Class<?>[]{ listenerCls },
                (proxy, method, args) -> {
                    if ("onAcknowledgePurchaseResponse".equals(method.getName()) && args != null && args.length >= 1) {
                        int code = (int) args[0].getClass().getMethod("getResponseCode").invoke(args[0]);
                        if (callbackId != null) resolve(callbackId, code == 0);
                    }
                    return null;
                }
            );
            billingClient.getClass()
                .getMethod("acknowledgePurchase", paramsCls, listenerCls)
                .invoke(billingClient, params, listener);
        } catch (Throwable t) {
            if (callbackId != null) resolve(callbackId, false);
        }
    }

    @JavascriptInterface
    public void consumePurchase(String purchaseToken, String callbackId) {
        if (billingClient == null) { resolve(callbackId, false); return; }
        try {
            Class<?> paramsCls        = Class.forName("com.android.billingclient.api.ConsumeParams");
            Class<?> paramsBuilderCls = Class.forName("com.android.billingclient.api.ConsumeParams$Builder");
            Class<?> listenerCls      = Class.forName("com.android.billingclient.api.ConsumeResponseListener");

            Object pBuilder = paramsCls.getMethod("newBuilder").invoke(null);
            paramsBuilderCls.getMethod("setPurchaseToken", String.class).invoke(pBuilder, purchaseToken);
            Object params = paramsBuilderCls.getMethod("build").invoke(pBuilder);

            Object listener = java.lang.reflect.Proxy.newProxyInstance(
                listenerCls.getClassLoader(),
                new Class<?>[]{ listenerCls },
                (proxy, method, args) -> {
                    if ("onConsumeResponse".equals(method.getName()) && args != null && args.length >= 1) {
                        int code = (int) args[0].getClass().getMethod("getResponseCode").invoke(args[0]);
                        resolve(callbackId, code == 0);
                    }
                    return null;
                }
            );
            billingClient.getClass()
                .getMethod("consumeAsync", paramsCls, listenerCls)
                .invoke(billingClient, params, listener);
        } catch (Throwable t) {
            resolve(callbackId, false);
        }
    }

    @JavascriptInterface
    public void queryPurchases(String productType, String callbackId) {
        if (billingClient == null) { resolveJson(callbackId, new JSONArray()); return; }
        try {
            String type = (productType == null || productType.isEmpty()) ? "inapp" : productType;
            Class<?> paramsCls         = Class.forName("com.android.billingclient.api.QueryPurchasesParams");
            Class<?> paramsBuilderCls  = Class.forName("com.android.billingclient.api.QueryPurchasesParams$Builder");
            Class<?> listenerCls       = Class.forName("com.android.billingclient.api.PurchasesResponseListener");

            Object pBuilder = paramsCls.getMethod("newBuilder").invoke(null);
            paramsBuilderCls.getMethod("setProductType", String.class).invoke(pBuilder, type);
            Object params = paramsBuilderCls.getMethod("build").invoke(pBuilder);

            Object listener = java.lang.reflect.Proxy.newProxyInstance(
                listenerCls.getClassLoader(),
                new Class<?>[]{ listenerCls },
                (proxy, method, args) -> {
                    if ("onQueryPurchasesResponse".equals(method.getName()) && args != null && args.length >= 2) {
                        @SuppressWarnings("unchecked")
                        List<Object> purchases = (List<Object>) args[1];
                        JSONArray arr = new JSONArray();
                        if (purchases != null) {
                            for (Object p : purchases) arr.put(purchaseToJson(p));
                        }
                        resolveJson(callbackId, arr);
                    }
                    return null;
                }
            );
            billingClient.getClass()
                .getMethod("queryPurchasesAsync", paramsCls, listenerCls)
                .invoke(billingClient, params, listener);
        } catch (Throwable t) {
            resolveJson(callbackId, new JSONArray());
        }
    }

    public void destroy() {
        if (billingClient != null) {
            try {
                billingClient.getClass().getMethod("endConnection").invoke(billingClient);
            } catch (Throwable ignored) {}
        }
    }

    // ---------------- helpers ----------------

    private JSONObject purchaseToJson(Object p) {
        JSONObject j = new JSONObject();
        try {
            j.put("orderId", invokeStr(p, "getOrderId"));
            j.put("packageName", invokeStr(p, "getPackageName"));
            j.put("purchaseToken", invokeStr(p, "getPurchaseToken"));
            j.put("purchaseTime", p.getClass().getMethod("getPurchaseTime").invoke(p));
            j.put("purchaseState", p.getClass().getMethod("getPurchaseState").invoke(p));
            j.put("isAcknowledged", p.getClass().getMethod("isAcknowledged").invoke(p));
            j.put("isAutoRenewing", p.getClass().getMethod("isAutoRenewing").invoke(p));
            j.put("originalJson", invokeStr(p, "getOriginalJson"));
            j.put("signature", invokeStr(p, "getSignature"));
            @SuppressWarnings("unchecked")
            List<String> products = (List<String>) p.getClass().getMethod("getProducts").invoke(p);
            j.put("products", new JSONArray(products));
        } catch (Throwable ignored) {}
        return j;
    }

    private JSONObject productDetailsToJson(Object d) {
        JSONObject j = new JSONObject();
        try {
            j.put("productId",   invokeStr(d, "getProductId"));
            j.put("productType", invokeStr(d, "getProductType"));
            j.put("title",       invokeStr(d, "getTitle"));
            j.put("name",        invokeStr(d, "getName"));
            j.put("description", invokeStr(d, "getDescription"));

            // One-time purchase pricing
            try {
                Object otp = d.getClass().getMethod("getOneTimePurchaseOfferDetails").invoke(d);
                if (otp != null) {
                    JSONObject o = new JSONObject();
                    o.put("formattedPrice", invokeStr(otp, "getFormattedPrice"));
                    o.put("priceAmountMicros", otp.getClass().getMethod("getPriceAmountMicros").invoke(otp));
                    o.put("priceCurrencyCode", invokeStr(otp, "getPriceCurrencyCode"));
                    j.put("oneTimePurchaseOfferDetails", o);
                }
            } catch (Throwable ignored) {}

            // Subscription offers + pricing phases
            try {
                @SuppressWarnings("unchecked")
                List<Object> offers = (List<Object>) d.getClass().getMethod("getSubscriptionOfferDetails").invoke(d);
                if (offers != null) {
                    JSONArray offerArr = new JSONArray();
                    for (Object o : offers) {
                        JSONObject oj = new JSONObject();
                        oj.put("offerToken", invokeStr(o, "getOfferToken"));
                        oj.put("basePlanId", invokeStr(o, "getBasePlanId"));
                        oj.put("offerId",    invokeStr(o, "getOfferId"));
                        Object pricing = o.getClass().getMethod("getPricingPhases").invoke(o);
                        if (pricing != null) {
                            @SuppressWarnings("unchecked")
                            List<Object> phases = (List<Object>) pricing.getClass().getMethod("getPricingPhaseList").invoke(pricing);
                            JSONArray pArr = new JSONArray();
                            if (phases != null) for (Object ph : phases) {
                                JSONObject pj2 = new JSONObject();
                                pj2.put("formattedPrice",    invokeStr(ph, "getFormattedPrice"));
                                pj2.put("priceAmountMicros", ph.getClass().getMethod("getPriceAmountMicros").invoke(ph));
                                pj2.put("priceCurrencyCode", invokeStr(ph, "getPriceCurrencyCode"));
                                pj2.put("billingPeriod",     invokeStr(ph, "getBillingPeriod"));
                                pj2.put("billingCycleCount", ph.getClass().getMethod("getBillingCycleCount").invoke(ph));
                                pj2.put("recurrenceMode",    ph.getClass().getMethod("getRecurrenceMode").invoke(ph));
                                pArr.put(pj2);
                            }
                            oj.put("pricingPhases", pArr);
                        }
                        offerArr.put(oj);
                    }
                    j.put("subscriptionOfferDetails", offerArr);
                }
            } catch (Throwable ignored) {}
        } catch (Throwable ignored) {}
        return j;
    }

    private String invokeStr(Object obj, String method) {
        try { Object r = obj.getClass().getMethod(method).invoke(obj); return r == null ? null : r.toString(); }
        catch (Throwable t) { return null; }
    }

    private void resolve(String callbackId, boolean value) {
        if (callbackId == null) return;
        ui.post(() -> webView.evaluateJavascript(
            "window.PlayBilling && window.PlayBilling.__resolve && window.PlayBilling.__resolve('"
                + callbackId + "', " + value + ");",
            null
        ));
    }

    private void resolveJson(String callbackId, JSONArray arr) {
        if (callbackId == null) return;
        final String payload = arr.toString().replace("\\", "\\\\").replace("'", "\\'");
        ui.post(() -> webView.evaluateJavascript(
            "window.PlayBilling && window.PlayBilling.__resolve && window.PlayBilling.__resolve('"
                + callbackId + "', JSON.parse('" + payload + "'));",
            null
        ));
    }

    private void emit(String eventName, JSONObject payload) {
        final String json = payload.toString().replace("\\", "\\\\").replace("'", "\\'");
        ui.post(() -> webView.evaluateJavascript(
            "window.PlayBilling && window.PlayBilling.__emit && window.PlayBilling.__emit('"
                + eventName + "', JSON.parse('" + json + "'));",
            null
        ));
    }

    /** Surface a native error into the WebView console so JS devs can see it. */
    private void jsConsoleError(String msg) {
        final String safe = msg == null ? "" : msg.replace("\\", "\\\\").replace("'", "\\'");
        ui.post(() -> webView.evaluateJavascript(
            "console.error('[PlayBillingNative] ' + '" + safe + "');", null));
    }
}
