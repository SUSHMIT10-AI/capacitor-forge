# Keep JS bridge methods accessible from WebView
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ----- Google Play Billing Library v6 -----
# Required to keep the BillingClient classes from being stripped by R8.
-keep class com.android.billingclient.api.** { *; }
-keep interface com.android.billingclient.api.** { *; }
-keep class com.android.vending.billing.** { *; }

# Keep our own billing plugin (loaded by reflection from MainActivity)
-keep class com.aabforge.app.PlayBillingPlugin { *; }
-keep class com.aabforge.app.BillingBridge { *; }
-keep class com.aabforge.app.NativeBridge { *; }

# AndroidX appcompat / webkit safety
-dontwarn androidx.**
-keep class androidx.swiperefreshlayout.widget.** { *; }
