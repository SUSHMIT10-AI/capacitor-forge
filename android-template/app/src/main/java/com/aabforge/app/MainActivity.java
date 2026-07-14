package com.aabforge.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.WebView.WebViewTransport;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceRequest;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.os.Message;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private SwipeRefreshLayout swipe;
    private BillingBridge billingBridge;
    private PlayBillingPlugin playBillingPlugin;
    private NativeBridge nativeBridge;
    private boolean isOffline = false;
    private boolean resetWebCachesThisLaunch = false;
    private boolean cleanupReloadedThisLaunch = false;
    private final List<WebView> popupWindows = new ArrayList<>();
    private android.widget.FrameLayout popupHost;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        // Force dark mode if requested
        if (BuildConfig.DARK_MODE_FORCE) {
            AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES);
        }
        // Switch from splash theme to main theme before Activity inflation so an
        // app-update boot cannot keep drawing the launcher splash behind WebView.
        setTheme(R.style.Theme_AABForge);
        super.onCreate(savedInstanceState);

        // Display flags
        applyWindowFeatureFlags();
        if (BuildConfig.KEEP_SCREEN_ON) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
        if (BuildConfig.FULLSCREEN_MODE) {
            getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN
            );
        }
        if (BuildConfig.HIDE_STATUS_BAR) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
        // Apply theme color to status bar
        try {
            int themeColor = Color.parseColor(BuildConfig.THEME_COLOR);
            getWindow().setStatusBarColor(themeColor);
        } catch (Throwable ignored) {}
        try {
            int navColor = Color.parseColor(BuildConfig.NAV_COLOR);
            getWindow().setNavigationBarColor(navColor);
        } catch (Throwable ignored) {}

        // Build view hierarchy: SwipeRefreshLayout > WebView (if pull-to-refresh enabled)
        webView = new FeatureLockedWebView(this);
        // Hardware-accelerated layer = smoother scroll & animations
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        if (BuildConfig.ENABLE_PULL_TO_REFRESH) {
            swipe = new SwipeRefreshLayout(this);
            swipe.addView(webView);
            swipe.setOnRefreshListener(() -> {
                if (webView != null) webView.reload();
            });
            // Critical: only enable pull-to-refresh when WebView is scrolled to the top.
            // Otherwise every downward swipe inside the page intercepts touch and feels laggy.
            webView.getViewTreeObserver().addOnScrollChangedListener(() ->
                swipe.setEnabled(webView.getScrollY() == 0)
            );
            setContentView(swipe);
        } else {
            setContentView(webView);
        }

        configureWebView();
        wireBridges();
        wireDownloadListener();
        wireBackPressed();
        resetWebCachesIfAppUpdated();

        // Request runtime permissions for enabled features (Android 6+)
        requestEnabledPermissions();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            loadInitialUrl();
        }
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Enable multi-window support so window.open() / target="_blank" / payment
        // popups (Stripe Checkout, Razorpay, Cashfree, Google sign-in popup, etc.)
        // don't render as a blank backdrop. We handle the actual new window in
        // WebChromeClient.onCreateWindow below.
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setLoadsImagesAutomatically(true);
        // Always honor the page's <meta viewport> so responsive sites render with their
        // mobile layout (width=device-width) instead of the WebView's default ~980px
        // desktop viewport. Pinch-zoom is still controlled independently below.
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setMixedContentMode(BuildConfig.ALLOW_CLEARTEXT
            ? WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            : WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        // Pinch-to-zoom: setSupportZoom(false) is the authoritative WebView switch.
        // We additionally inject a <meta viewport user-scalable=no> after page load to
        // override pages that explicitly enable zoom.
        s.setBuiltInZoomControls(BuildConfig.ALLOW_ZOOM);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(BuildConfig.ALLOW_ZOOM);
        webView.setInitialScale(100);

        injectDocumentStartFeatureLocks();

        s.setGeolocationEnabled(BuildConfig.ENABLE_GEOLOCATION);

        s.setCacheMode(BuildConfig.CACHE_ENABLED
            ? WebSettings.LOAD_DEFAULT
            : WebSettings.LOAD_NO_CACHE);

        if (BuildConfig.USER_AGENT_OVERRIDE != null && !BuildConfig.USER_AGENT_OVERRIDE.isEmpty()) {
            s.setUserAgentString(BuildConfig.USER_AGENT_OVERRIDE);
        }

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                isOffline = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (swipe != null) swipe.setRefreshing(false);
                if (!isOffline) injectCustomCode(view);
                if (!isOffline && resetWebCachesThisLaunch && !cleanupReloadedThisLaunch) {
                    runPostUpdateCacheCleanup(view);
                }
            }

            @Override
            public void onScaleChanged(WebView view, float oldScale, float newScale) {
                super.onScaleChanged(view, oldScale, newScale);
                if (!BuildConfig.ALLOW_ZOOM && newScale != 1.0f) {
                    view.post(() -> view.setInitialScale(100));
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleMainFrameUrlLoading(url, false);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return false;
                if (!request.isForMainFrame()) return false;
                return handleMainFrameUrlLoading(request.getUrl().toString(), request.hasGesture());
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                if (BuildConfig.ENABLE_OFFLINE_PAGE && !isNetworkAvailable()) {
                    showOfflinePage();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                // Render popup WebViews as a real overlay on top of the main WebView.
                // Payment pages (Stripe, Razorpay, Cashfree, Lemon Squeezy, etc.) call
                // window.open() then write the checkout UI into the popup via
                // popup.document.write(...) or by navigating it. If the popup is never
                // attached to the view hierarchy the user only sees the page's modal
                // backdrop — a frozen dim overlay over the Plans page.
                try {
                    WebView popup = createPopupWebView();
                    WebViewTransport transport = (WebViewTransport) resultMsg.obj;
                    transport.setWebView(popup);
                    resultMsg.sendToTarget();
                    attachPopup(popup);
                    return true;
                } catch (Throwable t) {
                    return false;
                }
            }

            @Override
            public void onCloseWindow(WebView window) {
                // Payment SDKs call popup.close() once the checkout result is posted
                // back to the opener. Tear the popup down so the main app reappears.
                detachPopup(window);
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Auto-grant permissions the app declared support for
                runOnUiThread(() -> {
                    List<String> granted = new ArrayList<>();
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && BuildConfig.ENABLE_CAMERA) granted.add(r);
                        else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && BuildConfig.ENABLE_MICROPHONE) granted.add(r);
                        else if (PermissionRequest.RESOURCE_MIDI_SYSEX.equals(r)) granted.add(r);
                        else if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(r)) granted.add(r);
                    }
                    if (granted.isEmpty()) request.deny();
                    else request.grant(granted.toArray(new String[0]));
                });
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) {
                callback.invoke(origin, BuildConfig.ENABLE_GEOLOCATION, false);
            }
        });
    }

    private void applyWindowFeatureFlags() {
        if (BuildConfig.BLOCK_SCREENSHOTS) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
        // Render around display cutouts (notches / punch-holes) on Android 9+ so
        // the WebView fills the entire physical screen instead of being letter-boxed.
        // Combined with the safe-area CSS injected at document-start below, content
        // still stays clear of the cutout and system bars.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            try {
                android.view.WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.layoutInDisplayCutoutMode = android.view.WindowManager.LayoutParams
                    .LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                getWindow().setAttributes(lp);
            } catch (Throwable ignored) {}
        }
    }


    private void injectDocumentStartFeatureLocks() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        StringBuilder script = new StringBuilder("(function(){try{");
        // Expose native flags at document-start so SPA bundles see them on first render.
        script.append("window.__ANDROID_NATIVE__=true;");
        script.append("window.__APP_URL__='" + BuildConfig.APP_URL.replace("'", "\\'") + "';");
        if (BuildConfig.ENABLE_BILLING)   script.append("window.__BILLING_ENABLED__=true;");
        if (BuildConfig.ENABLE_CAPACITOR) script.append("window.__CAPACITOR_NATIVE__=true;");
        // Capacitor compatibility layer: many Lovable webapps ship Capacitor JS
        // (AdMob, Camera, Share, etc.) even when this wrapper does not include each
        // native SDK. Patch the global at document-start so early plugin calls no-op
        // instead of throwing during SPA bootstrap and leaving only the splash visible.
        if (BuildConfig.ENABLE_CAPACITOR) {
            script.append(capacitorBootScript());
        }
        script.append("try{console.log('[AABforge] Platform:', (window.Capacitor&&window.Capacitor.getPlatform&&window.Capacitor.getPlatform())||'web', 'billing=" + (BuildConfig.ENABLE_BILLING?"on":"off") + " capacitor=" + (BuildConfig.ENABLE_CAPACITOR?"on":"off") + "');}catch(e){}");
        if (!BuildConfig.ALLOW_ZOOM) script.append(zoomLockScript());
        if (!BuildConfig.ENABLE_CLIPBOARD) script.append(clipboardLockScript());
        // Mount the PlayBilling JS shim whenever billing is enabled. The shim only
        // exposes window.PlayBilling — it does not hijack any existing web payment
        // path, so it's safe to ship for every billing-enabled app, Capacitor or not.
        if (BuildConfig.ENABLE_BILLING) {
            script.append(playBillingBootScript());
        }
        script.append("}catch(e){}})();");
        WebViewCompat.addDocumentStartJavaScript(webView, script.toString(), Collections.singleton("*"));

        // Inject user-provided custom CSS / JS as early as possible so badge / tag
        // removers run before the target elements are painted, and re-run on every
        // navigation (including SPA route changes that never trigger onPageFinished).
        final String css = readAsset("custom_css.txt");
        final String js  = readAsset("custom_js.txt");

        if (!css.isEmpty()) {
            String b64 = Base64.encodeToString(css.getBytes(), Base64.NO_WRAP);
            String cssBoot =
                "(function(){try{" +
                "var apply=function(){" +
                  "var id='aabforge-custom-css';" +
                  "var prev=document.getElementById(id);if(prev)prev.remove();" +
                  "var s=document.createElement('style');s.id=id;" +
                  "s.textContent=atob('" + b64 + "');" +
                  "(document.head||document.documentElement).appendChild(s);" +
                "};" +
                "apply();" +
                "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',apply,{once:true});}" +
                "try{new MutationObserver(function(){if(!document.getElementById('aabforge-custom-css'))apply();}).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}" +
                "}catch(e){}})();";
            WebViewCompat.addDocumentStartJavaScript(webView, cssBoot, Collections.singleton("*"));
        }

        if (!js.isEmpty()) {
            String b64 = Base64.encodeToString(js.getBytes(), Base64.NO_WRAP);
            String jsBoot =
                "(function(){try{" +
                "var b64='" + b64 + "';" +
                "var decode=function(s){try{return decodeURIComponent(escape(atob(s)));}catch(e){return atob(s);}};" +
                "var raw=decode(b64).replace(/^\\s*<script[^>]*>/i,'').replace(/<\\/script>\\s*$/i,'');" +
                "var run=function(){try{" +
                  "var s=document.createElement('script');s.type='text/javascript';s.setAttribute('data-aabforge-custom-js','1');s.text=raw;" +
                  "(document.head||document.documentElement).appendChild(s);" +
                "}catch(e){console.error('AABforge custom JS error',e);}};" +
                "run();" +
                "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',run,{once:true});}" +
                "window.addEventListener('load',run,{once:true});" +
                // Re-run on SPA route changes so badges added after navigation are also handled.
                "try{var _ps=history.pushState;history.pushState=function(){var r=_ps.apply(this,arguments);setTimeout(run,50);return r;};" +
                "var _rs=history.replaceState;history.replaceState=function(){var r=_rs.apply(this,arguments);setTimeout(run,50);return r;};" +
                "window.addEventListener('popstate',function(){setTimeout(run,50);});}catch(e){}" +
                "}catch(e){console.error('AABforge custom JS bootstrap error',e);}})();";
            WebViewCompat.addDocumentStartJavaScript(webView, jsBoot, Collections.singleton("*"));
        }
    }

    private void wireBridges() {
        // Always-on native bridge for clipboard / share / vibrate / toast etc.
        nativeBridge = new NativeBridge(this, webView);
        webView.addJavascriptInterface(nativeBridge, "AndroidNative");

        if (BuildConfig.ENABLE_BILLING) {
            billingBridge = new BillingBridge(this, webView);
            webView.addJavascriptInterface(billingBridge, "AndroidBilling");

            // Canonical Play Billing v6 plugin (window.PlayBilling.*)
            playBillingPlugin = new PlayBillingPlugin(this, webView);
            webView.addJavascriptInterface(playBillingPlugin, "PlayBillingNative");
        }
    }

    private void wireDownloadListener() {
        if (!BuildConfig.ENABLE_FILE_DOWNLOAD) return;
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimetype, long contentLength) {
                try {
                    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                    String filename = URLUtil.guessFileName(url, contentDisposition, mimetype);
                    req.setMimeType(mimetype);
                    req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                    req.allowScanningByMediaScanner();
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    dm.enqueue(req);
                    Toast.makeText(getApplicationContext(), "Downloading " + filename, Toast.LENGTH_SHORT).show();
                } catch (Throwable t) {
                    Toast.makeText(getApplicationContext(), "Download failed", Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private void wireBackPressed() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Close the top popup first (payment / OAuth window) so back doesn't
                // exit the app mid-checkout.
                if (!popupWindows.isEmpty()) {
                    WebView top = popupWindows.get(popupWindows.size() - 1);
                    if (top != null && top.canGoBack()) { top.goBack(); return; }
                    detachPopup(top);
                    return;
                }
                if (BuildConfig.SWIPE_BACK_NAVIGATION && webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    finish();
                }
            }
        });
    }

    private void loadInitialUrl() {
        if (BuildConfig.ENABLE_OFFLINE_PAGE && !isNetworkAvailable()) {
            showOfflinePage();
        } else {
            webView.loadUrl(BuildConfig.APP_URL);
        }
    }

    private void showOfflinePage() {
        isOffline = true;
        webView.loadUrl("file:///android_asset/offline.html");
        // Inject the real app URL so the "Try again" button knows where to go
        webView.postDelayed(() ->
            webView.evaluateJavascript(
                "window.__APP_URL__='" + BuildConfig.APP_URL.replace("'", "\\'") + "';", null
            ), 100);
    }

    private boolean isNetworkAvailable() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo ni = cm.getActiveNetworkInfo();
            return ni != null && ni.isConnected();
        } catch (Throwable t) { return true; }
    }

    private boolean handleMainFrameUrlLoading(String url, boolean hasUserGesture) {
        if (url == null) return false;
        if (url.startsWith("http://") || url.startsWith("https://")) {
            Uri target = Uri.parse(url);
            Uri base = Uri.parse(BuildConfig.APP_URL);
            // App startup redirects usually have no user gesture. Keep them in-app even
            // when the final host differs, otherwise Android resolves them with Chrome.
            if (!hasUserGesture || !BuildConfig.ALLOW_EXTERNAL_LINKS || isInternalHost(target.getHost(), base.getHost())) {
                return false;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, target));
                return true;
            } catch (ActivityNotFoundException e) {
                return false;
            }
        }
        // tel:, mailto:, sms:, intent:, etc.
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            return true;
        } catch (Throwable ignored) { return false; }
    }

    /**
     * Treat the target URL as internal (keep inside the WebView) when its host is
     * the same as the configured APP_URL host, ignoring "www." and any subdomain
     * of the same registrable domain. Without this, a server-side redirect from
     * https://example.com to https://www.example.com (or app.example.com) fires
     * an ACTION_VIEW intent and Android opens the site in Chrome — i.e. the app
     * launches, then immediately bounces the user out to the browser.
     */
    private static boolean isInternalHost(String targetHost, String baseHost) {
        if (targetHost == null || baseHost == null) return false;
        String t = stripWww(targetHost.toLowerCase());
        String b = stripWww(baseHost.toLowerCase());
        if (t.equals(b)) return true;
        // Subdomain match: target ends with ".base" (e.g. app.example.com vs example.com)
        if (t.endsWith("." + b)) return true;
        if (b.endsWith("." + t)) return true;
        return false;
    }

    private static String stripWww(String host) {
        return host.startsWith("www.") ? host.substring(4) : host;
    }

    private void requestEnabledPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        List<String> needed = new ArrayList<>();
        if (BuildConfig.ENABLE_CAMERA)            add(needed, Manifest.permission.CAMERA);
        if (BuildConfig.ENABLE_MICROPHONE)        add(needed, Manifest.permission.RECORD_AUDIO);
        if (BuildConfig.ENABLE_LOCATION)          add(needed, Manifest.permission.ACCESS_FINE_LOCATION);
        if (BuildConfig.ENABLE_SMS)               add(needed, Manifest.permission.SEND_SMS);
        if (BuildConfig.ENABLE_CONTACTS)          add(needed, Manifest.permission.READ_CONTACTS);
        if (BuildConfig.ENABLE_PHONE_STATE)       add(needed, Manifest.permission.READ_PHONE_STATE);
        if (BuildConfig.ENABLE_CALENDAR)          add(needed, Manifest.permission.READ_CALENDAR);
        if (BuildConfig.ENABLE_PUSH_NOTIFICATIONS && Build.VERSION.SDK_INT >= 33) {
            add(needed, "android.permission.POST_NOTIFICATIONS");
        }
        if (BuildConfig.ENABLE_STORAGE) {
            if (Build.VERSION.SDK_INT >= 33) add(needed, "android.permission.READ_MEDIA_IMAGES");
            else                              add(needed, Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), 1001);
        }
    }

    private void add(List<String> list, String perm) {
        if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
            list.add(perm);
        }
    }

    private String readAsset(String name) {
        try (InputStream is = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Throwable t) {
            return "";
        }
    }

    /** Wraps source in a base64 atob() shim so we never have to escape user content. */
    private void evalJsSafe(WebView view, String source) {
        if (source == null || source.isEmpty()) return;
        try {
            String b64 = Base64.encodeToString(source.getBytes("UTF-8"), Base64.NO_WRAP);
            // Strategy:
            //  - Decode as UTF-8 (atob alone is Latin-1 and breaks unicode/curly quotes/emoji).
            //  - Strip wrapping <script>...</script> tags so users can paste either raw JS
            //    or a full <script> block (matches behaviour of other app builders).
            //  - Inject as a <script> element so the code runs in page scope just like
            //    a <script> tag in the original HTML — works with const/let/class and
            //    avoids strict-mode quirks of eval().
            //  - Re-run on SPA route changes by hooking history + a one-shot
            //    DOMContentLoaded fallback so DOM queries find their targets.
            String wrapper =
                "(function(){try{" +
                "var b64='" + b64 + "';" +
                "var decode=function(s){try{return decodeURIComponent(escape(atob(s)));}catch(e){return atob(s);}};" +
                "var raw=decode(b64);" +
                "raw=raw.replace(/^\\s*<script[^>]*>/i,'').replace(/<\\/script>\\s*$/i,'');" +
                "var run=function(){try{" +
                  "var s=document.createElement('script');s.type='text/javascript';s.text=raw;" +
                  "(document.head||document.documentElement).appendChild(s);" +
                "}catch(e){console.error('AABforge custom JS error',e);}};" +
                "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',run,{once:true});}else{run();}" +
                "}catch(e){console.error('AABforge custom JS bootstrap error',e);}})();";
            view.evaluateJavascript(wrapper, null);
        } catch (Throwable ignored) {}
    }

    private void injectCustomCode(WebView view) {
        // Expose feature flags first so injected JS can read them
        StringBuilder flags = new StringBuilder("(function(){");
        flags.append("window.__ANDROID_NATIVE__=true;");
        if (BuildConfig.ENABLE_BILLING)   flags.append("window.__BILLING_ENABLED__=true;");
        if (BuildConfig.ENABLE_CAPACITOR) flags.append("window.__CAPACITOR_NATIVE__=true;");
        flags.append("window.__APP_URL__='" + BuildConfig.APP_URL.replace("'", "\\'") + "';");
        if (BuildConfig.ENABLE_CAPACITOR) flags.append(capacitorBootScript());

        // Re-apply feature locks after page load for devices that do not support
        // AndroidX document-start injection.
        if (!BuildConfig.ALLOW_ZOOM) flags.append(zoomLockScript());

        // Enforce "Clipboard" toggle: when OFF, neuter both the AndroidNative bridge AND
        // the standard navigator.clipboard / document.execCommand('copy') so the web app
        // genuinely cannot copy/paste.
        if (!BuildConfig.ENABLE_CLIPBOARD) flags.append(clipboardLockScript());

        // PlayBilling promise shim — wraps the sync PlayBillingNative bridge.
        // Gate on ENABLE_BILLING only so the bridge works for every app.
        if (BuildConfig.ENABLE_BILLING) {
            flags.append(
              // Fallback only — the canonical shim is injected at document-start
              // via playBillingBootScript(). This re-runs it on devices that don't
              // support DOCUMENT_START_SCRIPT so window.PlayBilling still exists.
              "if(window.PlayBillingNative && !(window.PlayBilling&&window.PlayBilling.__ready)){" +
                "console.warn('[PlayBilling] doc-start shim missing — using post-load fallback');" +
              "}"
            );
        }
        flags.append("})();");
        view.evaluateJavascript(flags.toString(), null);

        // Read custom code from assets at runtime — safe for any content (multiline,
        // quotes, $, backticks, unicode, etc.)
        final String css  = readAsset("custom_css.txt");
        final String html = readAsset("custom_html.txt");
        final String js   = readAsset("custom_js.txt");

        if (!css.isEmpty()) {
            // Build JS that base64-decodes the CSS into a <style> tag — never inlined directly.
            // Dedupe: replace any previous injection so SPA navigations don't pile up <style> tags.
            String b64 = Base64.encodeToString(css.getBytes(), Base64.NO_WRAP);
            view.evaluateJavascript(
                "(function(){var id='aabforge-custom-css';" +
                "var prev=document.getElementById(id);if(prev)prev.remove();" +
                "var s=document.createElement('style');s.id=id;" +
                "s.textContent=atob('" + b64 + "');" +
                "(document.head||document.documentElement).appendChild(s);})();", null);
        }
        if (!html.isEmpty()) {
            String b64 = Base64.encodeToString(html.getBytes(), Base64.NO_WRAP);
            view.evaluateJavascript(
                "(function(){" +
                "var old=document.querySelector('[data-aabforge-custom-html]');if(old)old.remove();" +
                "var d=document.createElement('div');" +
                "d.setAttribute('data-aabforge-custom-html','true');" +
                "d.innerHTML=atob('" + b64 + "');" +
                "document.body.appendChild(d);" +
                "var scripts=d.querySelectorAll('script');" +
                "for(var i=0;i<scripts.length;i++){" +
                  "var old=scripts[i],s=document.createElement('script');" +
                  "for(var j=0;j<old.attributes.length;j++){var a=old.attributes[j];s.setAttribute(a.name,a.value);}" +
                  "s.text=old.text||old.textContent||old.innerHTML||'';" +
                  "old.parentNode.replaceChild(s,old);" +
                "}" +
                "})();", null);
        }
        if (!js.isEmpty()) {
            evalJsSafe(view, js);
        }
    }

    private String zoomLockScript() {
        return "(function(){" +
            "var apply=function(){" +
              "var c='width=device-width,initial-scale=1,maximum-scale=1,minimum-scale=1,user-scalable=no';" +
              "var h=document.head||document.getElementsByTagName('head')[0]||document.documentElement;" +
              "var m=document.querySelector('meta[name=viewport]');" +
              "if(!m){m=document.createElement('meta');m.name='viewport';h.appendChild(m);}" +
              "m.setAttribute('content',c);" +
              "if(!document.getElementById('aabforge-zoom-lock')){var s=document.createElement('style');s.id='aabforge-zoom-lock';s.textContent='html,body{touch-action:pan-x pan-y!important;-ms-touch-action:pan-x pan-y!important;}';h.appendChild(s);}" +
            "};" +
            "apply();" +
            "document.addEventListener('DOMContentLoaded',apply,{once:true});" +
            "try{new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}" +
          "})();";
    }

    private String clipboardLockScript() {
        return "(function(){" +
            "var block=function(){return Promise.reject(new Error('Clipboard disabled by app'));};" +
            "var api={writeText:block,readText:block,write:block,read:block};" +
            "try{Object.defineProperty(navigator,'clipboard',{configurable:true,get:function(){return api;}});}catch(e){}" +
            "try{var ex=document.execCommand&&document.execCommand.bind(document);if(ex&&!document.__aabforgeExecLocked){document.__aabforgeExecLocked=true;document.execCommand=function(c){c=String(c||'').toLowerCase();if(c==='copy'||c==='cut'||c==='paste')return false;return ex.apply(document,arguments);};}}catch(e){}" +
            // Also block the native long-press selection / context menu so the user
            // cannot use the system 'Copy' action either. CSS user-select:none is the
            // strongest cross-Android approach; we re-apply on SPA navigations.
            "try{var applyCss=function(){if(document.getElementById('aabforge-clipboard-lock'))return;var s=document.createElement('style');s.id='aabforge-clipboard-lock';s.textContent='*{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important;}input,textarea,[contenteditable=\"true\"]{-webkit-user-select:text!important;user-select:text!important;}';(document.head||document.documentElement).appendChild(s);};applyCss();document.addEventListener('DOMContentLoaded',applyCss,{once:true});try{new MutationObserver(applyCss).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}}catch(e){}" +
            "try{document.addEventListener('copy',function(e){e.preventDefault();e.stopImmediatePropagation();},true);document.addEventListener('cut',function(e){e.preventDefault();e.stopImmediatePropagation();},true);}catch(e){}" +
          "})();";
    }

    private String capacitorBootScript() {
        // (unchanged)
        return
          "(function(){try{" +
            "var cap=window.Capacitor=window.Capacitor||{};" +
            "cap.platform='android';" +
            "cap.getPlatform=function(){return 'android';};" +
            "cap.isNativePlatform=function(){return true;};" +
            "cap.convertFileSrc=cap.convertFileSrc||function(u){return u;};" +
            "var realPlugins=cap.Plugins||{};cap.Plugins=realPlugins;" +
            "var stubs={};" +
            "var stubFor=function(name){if(stubs[name])return stubs[name];" +
              "var base={addListener:function(){return Promise.resolve({remove:function(){return Promise.resolve();}});},removeAllListeners:function(){return Promise.resolve();}};" +
              "if(typeof Proxy==='function'){stubs[name]=new Proxy(base,{get:function(target,prop){" +
                "if(prop in target)return target[prop];" +
                "if(prop==='then'||prop==='catch'||prop==='finally')return undefined;" +
                "if(typeof Symbol!=='undefined'&&prop===Symbol.toPrimitive)return function(){return '[CapacitorPluginStub:'+name+']';};" +
                "if(prop==='toString'||prop==='valueOf')return function(){return '[CapacitorPluginStub:'+name+']';};" +
                "return function(){console.warn('[Capacitor] Plugin '+name+'.'+String(prop)+' not implemented natively — no-op');return Promise.resolve({});};" +
              "}});}else{" +
                "stubs[name]=base;" +
                "['initialize','showBanner','hideBanner','showInterstitial','prepareInterstitial','showRewardVideoAd','requestPermissions','checkPermissions','share','getCurrentPosition'].forEach(function(m){base[m]=function(){return Promise.resolve({});};});" +
              "}" +
              "return stubs[name];" +
            "};" +
            "if(typeof Proxy==='function'&&!cap.__pluginsProxied){" +
              "cap.Plugins=new Proxy(realPlugins,{get:function(target,prop){if(prop in target)return target[prop];if(typeof prop!=='string')return undefined;return stubFor(prop);},set:function(target,prop,value){target[prop]=value;return true;}});" +
              "cap.__pluginsProxied=true;" +
            "}" +
            "var core=window.CapacitorCore=window.CapacitorCore||{};" +
            "core.registerPlugin=core.registerPlugin||function(name){if(realPlugins[name])return realPlugins[name];var p=stubFor(name);realPlugins[name]=p;return p;};" +
            "cap.registerPlugin=cap.registerPlugin||core.registerPlugin;" +
            "cap.isPluginAvailable=function(name){return name==='PlayBilling'?!!window.PlayBillingNative:true;};" +
            "try{Object.defineProperty(cap.Plugins,'PlayBilling',{configurable:true,get:function(){return window.PlayBilling||stubFor('PlayBilling');}});}catch(e){cap.Plugins.PlayBilling=window.PlayBilling||stubFor('PlayBilling');}" +
          "}catch(e){console.error('[Capacitor] boot patch failed',e);}})();";
    }

    /** Create a WebView configured to behave like a popup window. */
    @SuppressLint({"SetJavaScriptEnabled"})
    private WebView createPopupWebView() {
        WebView popup = new WebView(this);
        WebSettings ps = popup.getSettings();
        ps.setJavaScriptEnabled(true);
        ps.setDomStorageEnabled(true);
        ps.setDatabaseEnabled(true);
        ps.setSupportMultipleWindows(true);
        ps.setJavaScriptCanOpenWindowsAutomatically(true);
        ps.setUseWideViewPort(true);
        ps.setLoadWithOverviewMode(true);
        ps.setMediaPlaybackRequiresUserGesture(false);
        ps.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(popup, true);
        popup.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                if (url == null) return false;
                // Custom schemes (upi://, intent://, tel:, mailto:, etc.) must leave the WebView.
                if (url.startsWith("http://") || url.startsWith("https://")
                    || url.startsWith("about:") || url.startsWith("data:") || url.startsWith("blob:")) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    return true;
                } catch (Throwable ignored) { return false; }
            }
        });
        popup.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                // Nested popup (rare) — also overlay.
                try {
                    WebView nested = createPopupWebView();
                    WebViewTransport transport = (WebViewTransport) resultMsg.obj;
                    transport.setWebView(nested);
                    resultMsg.sendToTarget();
                    attachPopup(nested);
                    return true;
                } catch (Throwable t) { return false; }
            }
            @Override
            public void onCloseWindow(WebView window) { detachPopup(window); }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });
        return popup;
    }

    private void attachPopup(WebView popup) {
        if (popupHost == null) {
            popupHost = new android.widget.FrameLayout(this);
            popupHost.setBackgroundColor(Color.WHITE);
            // Cover the full window so the popup is interactive and visible.
            android.view.ViewGroup root = (android.view.ViewGroup) getWindow().getDecorView();
            root.addView(popupHost, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        popupHost.addView(popup, new android.widget.FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        popupHost.setVisibility(View.VISIBLE);
        popupWindows.add(popup);
    }

    private void detachPopup(WebView popup) {
        try {
            if (popup != null) {
                ViewGroup parent = (ViewGroup) popup.getParent();
                if (parent != null) parent.removeView(popup);
                popup.destroy();
            }
            popupWindows.remove(popup);
            if (popupWindows.isEmpty() && popupHost != null) {
                popupHost.setVisibility(View.GONE);
            }
        } catch (Throwable ignored) {}
    }

    private void resetWebCachesIfAppUpdated() {
        try {
            SharedPreferences prefs = getSharedPreferences("aabforge_runtime", MODE_PRIVATE);
            int lastVersion = prefs.getInt("last_version_code", -1);
            int currentVersion = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
            if (lastVersion != currentVersion) {
                resetWebCachesThisLaunch = true;
                webView.clearCache(true);
                webView.clearHistory();
                CookieManager.getInstance().flush();
                prefs.edit().putInt("last_version_code", currentVersion).apply();
            }
        } catch (Throwable ignored) {}
    }

    private void runPostUpdateCacheCleanup(WebView view) {
        cleanupReloadedThisLaunch = true;
        String script =
            "(async function(){try{" +
              "if('serviceWorker' in navigator){var regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(function(r){return r.unregister().catch(function(){});}));}" +
              "if(window.caches&&caches.keys){var keys=await caches.keys();await Promise.all(keys.map(function(k){return caches.delete(k).catch(function(){});}));}" +
              "try{localStorage.removeItem('vite-pwa-register');}catch(e){}" +
            "}catch(e){console.warn('[AABforge] post-update web cache cleanup failed',e);}return true;})();";
        view.evaluateJavascript(script, value -> view.postDelayed(() -> {
            try { view.reload(); } catch (Throwable ignored) {}
        }, 150));
    }

    /**
     * Document-start boot script for window.PlayBilling. Defines the promise-based
     * shim, auto-connects on load, and fires a `playbillingready` event so SPA
     * pricing pages can render once products are fetchable. Verbose console logs
     * make billing failures debuggable from `adb logcat -s chromium`.
     */
    private String playBillingBootScript() {
        return
          "(function(){try{" +
          "var bootstrap=function(){" +
            "if(!window.PlayBillingNative){console.warn('[PlayBilling] native bridge not present');return;}" +
            "if(window.PlayBilling&&window.PlayBilling.__ready)return;" +
            "console.log('[PlayBilling] Billing initialized — building JS shim');" +
            "var P={__cb:{},__listeners:{},__ready:false,__connected:false,__lastError:null};" +
            "P.__resolve=function(id,v){var f=P.__cb[id];if(f){delete P.__cb[id];f(v);}};" +
            "P.__emit=function(name,p){(P.__listeners[name]||[]).forEach(function(fn){try{fn(p);}catch(e){console.error('[PlayBilling] listener error',e);}});};" +
            "P.on=function(name,fn){(P.__listeners[name]=P.__listeners[name]||[]).push(fn);};" +
            "function call(method,args){return new Promise(function(res){var id='cb_'+Date.now()+'_'+Math.random();P.__cb[id]=res;args=args||[];args.push(id);try{window.PlayBillingNative[method].apply(window.PlayBillingNative,args);}catch(e){console.error('[PlayBilling] bridge call '+method+' failed:',e);P.__lastError=String(e);res(null);}});}" +
            "P.isAvailable=function(){return !!(window.PlayBillingNative&&window.PlayBillingNative.isAvailable&&window.PlayBillingNative.isAvailable());};" +
            "P.isConnected=function(){return P.__connected;};" +
            "P.getLastError=function(){return P.__lastError;};" +
            "P.connect=function(){return call('connect',[]).then(function(ok){P.__connected=!!ok;console.log('[PlayBilling] Billing connected:',ok);if(!ok)P.__lastError='connect returned false';return ok;});};" +
            "P.querySubscriptions=function(ids){console.log('[PlayBilling] querySubscriptions ids=',ids);return call('querySubscriptions',[JSON.stringify(ids||[])]).then(function(r){console.log('[PlayBilling] Fetched subscriptions:',r);return r||[];});};" +
            "P.queryProducts=function(ids){console.log('[PlayBilling] queryProducts ids=',ids);return call('queryProducts',[JSON.stringify(ids||[])]).then(function(r){console.log('[PlayBilling] Fetched products:',r);return r||[];});};" +
            "P.launchPurchase=function(id){console.log('[PlayBilling] launchPurchase',id);return call('launchPurchase',[id]);};" +
            "P.acknowledgePurchase=function(t){return call('acknowledgePurchase',[t]);};" +
            "P.consumePurchase=function(t){return call('consumePurchase',[t]);};" +
            "P.queryPurchases=function(type){return call('queryPurchases',[type||'inapp']).then(function(r){console.log('[PlayBilling] queryPurchases('+type+'):',r);return r||[];});};" +
            "P.__ready=true;" +
            "window.PlayBilling=P;" +
            // Bridge Capacitor → Play Billing. Web apps frequently use a
            // Capacitor billing plugin (registerPlugin('Purchases'),
            // 'InAppPurchases', etc.) instead of window.PlayBilling directly.
            // Without this wiring, Capacitor returns the generic no-op stub
            // and every subscribe() call silently resolves with {} — i.e.
            // billing "appears" to run but never reaches Google Play.
            "try{" +
              "var ALIASES=['PlayBilling','InAppPurchases','InAppPurchases2','GooglePlayBilling','GoogleBilling','CapacitorPurchases','Purchases','RevenueCat','Glassfy','CdvPurchase'];" +
              "var installAlias=function(host,name){try{Object.defineProperty(host,name,{configurable:true,get:function(){return P;},set:function(){}});}catch(e){host[name]=P;}};" +
              "if(window.Capacitor){" +
                "window.Capacitor.Plugins=window.Capacitor.Plugins||{};" +
                "ALIASES.forEach(function(n){installAlias(window.Capacitor.Plugins,n);});" +
                "var origIsAvail=window.Capacitor.isPluginAvailable;" +
                "window.Capacitor.isPluginAvailable=function(n){if(ALIASES.indexOf(n)>=0)return true;return origIsAvail?origIsAvail.call(window.Capacitor,n):true;};" +
                "var origReg=window.Capacitor.registerPlugin;" +
                "window.Capacitor.registerPlugin=function(name,impls){if(ALIASES.indexOf(name)>=0){console.log('[PlayBilling] Capacitor.registerPlugin('+name+') → native PlayBilling');return P;}return origReg?origReg.call(window.Capacitor,name,impls):(window.Capacitor.Plugins&&window.Capacitor.Plugins[name]);};" +
              "}" +
              "if(window.CapacitorCore){" +
                "var origReg2=window.CapacitorCore.registerPlugin;" +
                "window.CapacitorCore.registerPlugin=function(name,impls){if(ALIASES.indexOf(name)>=0){console.log('[PlayBilling] CapacitorCore.registerPlugin('+name+') → native PlayBilling');return P;}return origReg2?origReg2.call(window.CapacitorCore,name,impls):P;};" +
              "}" +
            "}catch(e){console.error('[PlayBilling] Capacitor bridge wiring failed:',e);}" +
            // Auto-connect immediately so the pricing page can call query* as soon
            // as it mounts. The page can still call PlayBilling.connect() — it is
            // idempotent on the JS side because the resulting promise just re-fires.
            "var readyPromise=P.connect().then(function(ok){" +
              "try{window.dispatchEvent(new Event('playbillingready'));}catch(e){}" +
              "return ok;" +
            "}).catch(function(e){console.error('[PlayBilling] connect error:',e);P.__lastError=String(e);return false;});" +
            "P.ready=function(){return readyPromise;};" +
          "};" +
          // The native interface is attached synchronously before the first script
          // runs, so bootstrap() succeeds on first try. We also retry on DOMContentLoaded
          // for older WebViews that attach interfaces slightly later.
          "bootstrap();" +
          "if(!window.PlayBilling){document.addEventListener('DOMContentLoaded',bootstrap,{once:true});}" +
          "}catch(e){console.error('[PlayBilling] boot script error:',e);}})();";
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyWindowFeatureFlags();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (billingBridge != null) billingBridge.destroy();
        if (playBillingPlugin != null) playBillingPlugin.destroy();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    private static class FeatureLockedWebView extends WebView {
        FeatureLockedWebView(Context context) {
            super(context);
        }

        @Override
        public boolean dispatchTouchEvent(MotionEvent event) {
            if (!BuildConfig.ALLOW_ZOOM && event != null && event.getPointerCount() > 1) {
                return true;
            }
            return super.dispatchTouchEvent(event);
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            if (!BuildConfig.ALLOW_ZOOM && event != null && event.getPointerCount() > 1) {
                return true;
            }
            return super.onTouchEvent(event);
        }
    }
}
