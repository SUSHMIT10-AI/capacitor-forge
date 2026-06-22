package com.aabforge.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

/**
 * Always-available JS bridge exposing safe native helpers to the web app.
 * Web side uses: window.AndroidNative.copyToClipboard("...")
 */
public class NativeBridge {
    private final Activity activity;
    private final WebView webView;

    public NativeBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    @JavascriptInterface
    public boolean copyToClipboard(String text) {
        if (!BuildConfig.ENABLE_CLIPBOARD) return false;
        try {
            ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("app", text == null ? "" : text));
            return true;
        } catch (Throwable t) { return false; }
    }

    @JavascriptInterface
    public boolean share(String text, String title) {
        if (!BuildConfig.ENABLE_SHARE) return false;
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
            if (title != null) send.putExtra(Intent.EXTRA_SUBJECT, title);
            Intent chooser = Intent.createChooser(send, title == null ? "Share" : title);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(chooser);
            return true;
        } catch (Throwable t) { return false; }
    }

    @JavascriptInterface
    public boolean vibrate(int milliseconds) {
        if (!BuildConfig.ENABLE_VIBRATE) return false;
        try {
            Vibrator v = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return false;
            int ms = Math.max(1, Math.min(milliseconds, 5000));
            if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(ms);
            }
            return true;
        } catch (Throwable t) { return false; }
    }

    @JavascriptInterface
    public void toast(String message) {
        try {
            activity.runOnUiThread(() ->
                Toast.makeText(activity.getApplicationContext(), message == null ? "" : message, Toast.LENGTH_SHORT).show()
            );
        } catch (Throwable ignored) {}
    }

    @JavascriptInterface
    public String getFeatureFlags() {
        return "{"
            + "\"billing\":" + BuildConfig.ENABLE_BILLING + ","
            + "\"capacitor\":" + BuildConfig.ENABLE_CAPACITOR + ","
            + "\"camera\":" + BuildConfig.ENABLE_CAMERA + ","
            + "\"microphone\":" + BuildConfig.ENABLE_MICROPHONE + ","
            + "\"location\":" + BuildConfig.ENABLE_LOCATION + ","
            + "\"clipboard\":" + BuildConfig.ENABLE_CLIPBOARD + ","
            + "\"share\":" + BuildConfig.ENABLE_SHARE + ","
            + "\"vibrate\":" + BuildConfig.ENABLE_VIBRATE
            + "}";
    }
}
