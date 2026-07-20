import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Globe, Rocket, Palette, DollarSign, Key, Loader2, Code2, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import IconCropper from "./IconCropper";

interface SigningKey {
  id: string;
  name: string;
  key_alias: string;
  is_default: boolean;
  keystore_path: string | null;
}

interface BuildFormProps {
  userId: string;
  onBuildStarted: () => void;
}

type BuildConfigInsertPayload = Record<string, unknown>;

const BuildForm = ({ userId, onBuildStarted }: BuildFormProps) => {
  const versionNameToCode = (value: string) => {
    const parts = value
      .trim()
      .split(".")
      .map((part) => Number.parseInt(part.replace(/\D/g, ""), 10) || 0);
    const [major = 1, minor = 0, patch = 0] = parts;
    return Math.max(1, major * 10000 + minor * 100 + patch);
  };
  const packageNamePattern = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
  const admobAppIdPattern = /^ca-app-pub-\d+~\d+$/;
  const admobUnitIdPattern = /^ca-app-pub-\d+\/\d+$/;
  const googleSampleAdMobPublisher = "ca-app-pub-3940256099942544";

  const [buildMode, setBuildMode] = useState<"webview" | "capacitor">("webview");
  const [projectZip, setProjectZip] = useState<File | null>(null);
  const [admobAppId, setAdmobAppId] = useState("");
  const [admobBannerId, setAdmobBannerId] = useState("");
  const [admobInterstitialId, setAdmobInterstitialId] = useState("");
  const [admobRewardedId, setAdmobRewardedId] = useState("");
  const [admobRewardedInterstitialId, setAdmobRewardedInterstitialId] = useState("");
  const [admobAppOpenId, setAdmobAppOpenId] = useState("");
  const [detectedPlugins, setDetectedPlugins] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [appName, setAppName] = useState("");
  const [packageName, setPackageName] = useState("com.example.app");
  const [versionName, setVersionName] = useState("1.0.0");
  const [versionCode, setVersionCode] = useState(versionNameToCode("1.0.0"));
  const [orientation, setOrientation] = useState("portrait");
  const [splashColor, setSplashColor] = useState("#FFFFFF");
  const [themeColor, setThemeColor] = useState("#4f46e5");
  const [navColor, setNavColor] = useState("#000000");
  const [enableBilling, setEnableBilling] = useState(false);
  const [customHtml, setCustomHtml] = useState("");
  const [customCss, setCustomCss] = useState("");
  const [customJs, setCustomJs] = useState("");
  const [buildType, setBuildType] = useState<"aab" | "apk" | "both">("aab");
  const [signingKeyId, setSigningKeyId] = useState<string>("");
  const [signingKeys, setSigningKeys] = useState<SigningKey[]>([]);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [rawIconSrc, setRawIconSrc] = useState<string | null>(null);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildStep, setBuildStep] = useState("");

  // Inline "upload your own keystore" flow inside Signing tab
  const [showInlineKey, setShowInlineKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState("My Release Key");
  const [newKeyAlias, setNewKeyAlias] = useState("");
  const [newKeyPassword, setNewKeyPassword] = useState("");
  const [newStorePassword, setNewStorePassword] = useState("");
  const [newKeystoreFile, setNewKeystoreFile] = useState<File | null>(null);
  const [savingKey, setSavingKey] = useState(false);
  const keystoreInputRef = useRef<HTMLInputElement | null>(null);

  const saveInlineSigningKey = async () => {
    const selectedKeystoreFile = newKeystoreFile || keystoreInputRef.current?.files?.[0] || null;
    const missingFields = [
      !newStorePassword.trim() ? "store password" : null,
      !selectedKeystoreFile ? "keystore file" : null,
    ].filter(Boolean);

    if (missingFields.length > 0) {
      toast({
        title: "Missing fields",
        description: `Please add: ${missingFields.join(", ")}.`,
        variant: "destructive",
      });
      return;
    }
    setSavingKey(true);
    try {
      const safeName = selectedKeystoreFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${userId}/keystores/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("app-assets")
        .upload(path, selectedKeystoreFile, {
          contentType: "application/octet-stream",
          upsert: false,
        });
      if (upErr) throw new Error(`Keystore upload failed: ${upErr.message}`);

      // Make this the default key so future builds pick it up automatically too.
      await supabase.from("signing_keys").update({ is_default: false }).eq("user_id", userId);

      const { data, error } = await supabase
        .from("signing_keys")
        .insert({
          user_id: userId,
          name: newKeyName.trim() || "My Release Key",
          key_alias: newKeyAlias.trim() || "auto-detect",
          key_password: newKeyPassword.trim() || newStorePassword.trim(),
          store_password: newStorePassword.trim(),
          keystore_path: path,
          is_default: true,
        })
        .select("id, name, key_alias, is_default, keystore_path")
        .single();
      if (error) throw error;

      toast({ title: "Signing key saved", description: "Your keystore will be used to sign this build." });
      // Refresh list and auto-select the new key
      await loadSigningKeys();
      if (data) setSigningKeyId(data.id);
      // Reset form
      setNewKeyAlias("");
      setNewKeyPassword("");
      setNewStorePassword("");
      setNewKeystoreFile(null);
      if (keystoreInputRef.current) keystoreInputRef.current.value = "";
      setShowInlineKey(false);
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Unable to save signing key.", variant: "destructive" });
    } finally {
      setSavingKey(false);
    }
  };

  // Native feature toggles
  const [feat, setFeat] = useState({
    enable_pull_to_refresh: true,
    enable_native_splash: true,
    enable_offline_page: true,
    enable_push_notifications: false,
    enable_camera: false,
    enable_microphone: false,
    enable_location: false,
    enable_storage: false,
    enable_sms: false,
    enable_contacts: false,
    enable_phone_state: false,
    enable_vibrate: true,
    enable_clipboard: true,
    enable_share: true,
    enable_biometric: false,
    enable_bluetooth: false,
    enable_nfc: false,
    enable_calendar: false,
    enable_file_download: true,
    enable_file_upload: true,
    enable_geolocation: false,
    block_screenshots: false,
    keep_screen_on: false,
    fullscreen_mode: false,
    hide_status_bar: false,
    allow_zoom: false,
    dark_mode_force: false,
    allow_external_links: true,
    cache_enabled: true,
    allow_cleartext: true,
    swipe_back_navigation: true,
  });
  const [userAgentOverride, setUserAgentOverride] = useState("");
  const setF = (k: keyof typeof feat, v: boolean) => setFeat((p) => ({ ...p, [k]: v }));

  const { toast } = useToast();

  useEffect(() => {
    loadSigningKeys();
  }, []);

  const loadSigningKeys = async () => {
    const { data } = await supabase
      .from("signing_keys")
      .select("id, name, key_alias, is_default, keystore_path")
      .not("keystore_path", "is", null)
      .order("is_default", { ascending: false });
    if (data) {
      setSigningKeys(data);
      const defaultKey = data.find((k) => k.is_default);
      setSigningKeyId(defaultKey?.id ?? data[0]?.id ?? "");
    }
  };

  const autoFillPackageName = (name: string) => {
    setAppName(name);
    if (name) {
      const clean = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      setPackageName(`com.app.${clean}`);
    }
  };

  const handleVersionNameChange = (value: string) => {
    setVersionName(value);
    setVersionCode(versionNameToCode(value));
  };

  const handleProjectZip = async (file: File | null) => {
    setProjectZip(file);
    setDetectedPlugins([]);
    if (!file) return;
    // Best-effort plugin detection by reading package.json from the zip in the browser
    try {
      const { unzipSync, strFromU8 } = await import("fflate");
      const buf = new Uint8Array(await file.arrayBuffer());
      const files = unzipSync(buf, {
        filter: (f) => f.name.endsWith("/package.json") || f.name === "package.json",
      });
      // Pick the shallowest package.json
      const entry = Object.entries(files).sort((a, b) => a[0].split("/").length - b[0].split("/").length)[0];
      if (entry) {
        const pkg = JSON.parse(strFromU8(entry[1]));
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        const plugins = Object.keys(deps).filter((d) =>
          d.startsWith("@capacitor/") || d.startsWith("@capacitor-community/") || d.includes("capacitor-plugin"),
        );
        setDetectedPlugins(plugins);
        if (!appName && pkg.name) autoFillPackageName(pkg.name);
        if (pkg.version) handleVersionNameChange(pkg.version);
      }
    } catch (e) {
      console.warn("Could not parse package.json from zip:", e);
    }
  };

  const handleBuild = async () => {
    if (buildMode === "webview" && !url.trim()) {
      toast({ title: "URL required", description: "Please enter your web app URL", variant: "destructive" });
      return;
    }
    if (buildMode === "capacitor" && !projectZip) {
      toast({ title: "Project zip required", description: "Upload a zip of your Capacitor project (package.json + capacitor.config + dist/).", variant: "destructive" });
      return;
    }
    if (!appName.trim()) {
      toast({ title: "App name required", description: "Please enter an app name", variant: "destructive" });
      return;
    }
    const resolvedPackageName = packageName.trim();
    if (!packageNamePattern.test(resolvedPackageName)) {
      toast({
        title: "Valid package name required",
        description: "Use a package like com.company.app. It must include dots and only letters, numbers, or underscores.",
        variant: "destructive",
      });
      return;
    }
    if (!signingKeyId && signingKeys.length === 0) {
      toast({ title: "Signing key required", description: "Upload your .jks / .keystore in the Signing tab before building.", variant: "destructive" });
      return;
    }
    if (!signingKeyId && signingKeys.length > 0) {
      toast({ title: "Select a signing key", description: "Choose which keystore to sign this build with.", variant: "destructive" });
      return;
    }
    const adUnitEntries = [
      ["Banner", admobBannerId.trim()],
      ["Interstitial", admobInterstitialId.trim()],
      ["Rewarded", admobRewardedId.trim()],
      ["Rewarded interstitial", admobRewardedInterstitialId.trim()],
      ["App open", admobAppOpenId.trim()],
    ] as const;
    const hasAnyAdUnit = adUnitEntries.some(([, value]) => Boolean(value));
    const resolvedAdMobAppId = admobAppId.trim();
    if ((resolvedAdMobAppId || hasAnyAdUnit) && !admobAppIdPattern.test(resolvedAdMobAppId)) {
      toast({ title: "Valid AdMob App ID required", description: "Use your real AdMob App ID, like ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY.", variant: "destructive" });
      return;
    }
    if (resolvedAdMobAppId.startsWith(googleSampleAdMobPublisher)) {
      toast({ title: "Test AdMob ID blocked", description: "Google sample/test AdMob IDs are not allowed. Enter your real AdMob App ID.", variant: "destructive" });
      return;
    }
    for (const [label, value] of adUnitEntries) {
      if (!value) continue;
      if (!admobUnitIdPattern.test(value) || value.startsWith(googleSampleAdMobPublisher)) {
        toast({ title: `${label} ad unit is invalid`, description: "Use a real AdMob ad unit ID from your own account, like ca-app-pub-XXXXXXXXXXXXXXXX/YYYYYYYYYY.", variant: "destructive" });
        return;
      }
    }

    setBuilding(true);
    setBuildStep("Preparing build…");
    let savedBuildId: string | null = null;
    try {
      let iconPath: string | null = null;
      if (iconFile) {
        setBuildStep("Uploading app icon…");
        const path = `${userId}/icons/${Date.now()}_${iconFile.name}`;
        const { error: upErr } = await supabase.storage.from("app-assets").upload(path, iconFile);
        if (upErr) throw new Error(`Icon upload failed: ${upErr.message}`);
        iconPath = path;
      }

      // Upload Capacitor project zip if applicable
      let projectZipPath: string | null = null;
      if (buildMode === "capacitor" && projectZip) {
        setBuildStep("Creating secure upload URL…");
        const { data: signed, error: signErr } = await supabase.functions.invoke("sign-capacitor-upload", {
          body: { filename: projectZip.name },
        });
        if (signErr || !signed?.upload_url) {
          throw new Error(`Could not get upload URL: ${signErr?.message ?? signed?.error ?? "unknown"}`);
        }
        setBuildStep("Uploading project zip…");
        const { error: signedUploadError } = await supabase.storage
          .from("capacitor-projects")
          .uploadToSignedUrl(signed.path, signed.token, projectZip, {
            contentType: "application/zip",
          });
        if (signedUploadError) throw new Error(`Project zip upload failed: ${signedUploadError.message}`);
        projectZipPath = signed.path;
      }

      setBuildStep("Saving build configuration…");
      const buildPayload = {
        user_id: userId,
        mode: buildMode,
        url: buildMode === "webview" ? url.trim() : "",
        project_zip_path: projectZipPath,
        admob_app_id: admobAppId.trim() || null,
        admob_banner_id: admobBannerId.trim() || null,
        admob_interstitial_id: admobInterstitialId.trim() || null,
        admob_rewarded_id: admobRewardedId.trim() || null,
        admob_rewarded_interstitial_id: admobRewardedInterstitialId.trim() || null,
        admob_app_open_id: admobAppOpenId.trim() || null,
        admob_test_mode: false,
        enable_admob: Boolean(admobAppId.trim()),
        app_name: appName.trim(),
        package_name: resolvedPackageName,
        version_name: versionName.trim(),
        version_code: Math.max(versionCode, versionNameToCode(versionName)),
        orientation,
        splash_color: splashColor,
        theme_color: themeColor,
        nav_color: navColor,
        enable_billing: enableBilling,
        enable_capacitor: true,
        custom_html: customHtml || null,
        custom_css: customCss || null,
        custom_js: customJs || null,
        build_type: buildType,
        signing_key_id: signingKeyId || null,
        icon_path: iconPath,
        status: "pending",
        user_agent_override: userAgentOverride || null,
        ...feat,
      };

      const saveBuildConfiguration = async (payload: BuildConfigInsertPayload) => {
        const result = await supabase
          .from("build_configs")
          .insert(payload as unknown as Database["public"]["Tables"]["build_configs"]["Insert"])
          .select()
          .single();

        if (!result.error) return result;

        const missingColumn = result.error.message.match(/Could not find the '([^']+)' column/)?.[1];
        const adMobMigrationColumns = [
          "admob_banner_id",
          "admob_interstitial_id",
          "admob_rewarded_id",
          "admob_rewarded_interstitial_id",
          "admob_app_open_id",
          "admob_test_mode",
        ];

        if (missingColumn && adMobMigrationColumns.includes(missingColumn)) {
          throw new Error(
            `Build configuration save failed: your backend database is missing the '${missingColumn}' column. Run migrations-to-apply/20260622_admob_unit_ids.sql in the SQL editor, then retry the build.`,
          );
        }

        return result;
      };

      const { data, error } = await saveBuildConfiguration(buildPayload);

      if (error) throw new Error(`Build configuration save failed: ${error.message}`);
      savedBuildId = data.id;

      setBuildStep("Starting Codemagic build…");
      const { data: triggerResult, error: fnError } = await supabase.functions.invoke("build-aab", {
        body: { build_id: data.id },
      });

      if (fnError) throw new Error(`Codemagic trigger failed: ${fnError.message}`);
      if (triggerResult && typeof triggerResult === "object" && "error" in triggerResult) {
        throw new Error(String(triggerResult.error));
      }

      toast({
        title: "Build started",
        description: buildMode === "capacitor"
          ? "Your Capacitor AAB is being generated. This usually takes 5–10 min."
          : buildType === "apk" ? "Your APK is being generated..." : buildType === "aab" ? "Your AAB is being generated..." : "Your APK and AAB are being generated...",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to start build.";
      if (savedBuildId) {
        await supabase
          .from("build_configs")
          .update({ status: "failed", error_message: message })
          .eq("id", savedBuildId);
      }
      toast({ title: "Build failed", description: message, variant: "destructive" });
    } finally {
      onBuildStarted();
      setBuildStep("");
      setBuilding(false);
    }
  };

  return (
    <div className="glow-border rounded-xl bg-card/50 overflow-hidden">
      <div className="p-6 border-b border-border">
        <h2 className="font-heading text-lg font-bold text-foreground flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          New Build
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Paste your web app URL and configure your Android app
        </p>
      </div>

      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="w-full flex flex-wrap justify-start rounded-none border-b border-border bg-transparent h-auto p-0 overflow-x-auto">
          <TabsTrigger value="basic" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3 text-xs font-heading">
            <Globe className="h-3.5 w-3.5 mr-1.5" /> Basic
          </TabsTrigger>
          <TabsTrigger value="appearance" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3 text-xs font-heading">
            <Palette className="h-3.5 w-3.5 mr-1.5" /> Appearance
          </TabsTrigger>
          <TabsTrigger value="native" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3 text-xs font-heading">
            <Shield className="h-3.5 w-3.5 mr-1.5" /> Native
          </TabsTrigger>
          <TabsTrigger value="monetization" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3 text-xs font-heading">
            <DollarSign className="h-3.5 w-3.5 mr-1.5" /> Monetize
          </TabsTrigger>
          <TabsTrigger value="custom" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3 text-xs font-heading">
            <Code2 className="h-3.5 w-3.5 mr-1.5" /> Custom
          </TabsTrigger>
          <TabsTrigger value="signing" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3 text-xs font-heading">
            <Key className="h-3.5 w-3.5 mr-1.5" /> Signing
          </TabsTrigger>
        </TabsList>

        <div className="p-6">
          <TabsContent value="basic" className="mt-0 space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-heading text-foreground">Build mode</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBuildMode("webview")}
                  className={`rounded-md border px-3 py-2 text-left text-xs ${buildMode === "webview" ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  <div className="font-heading text-sm">Simple WebView</div>
                  <div className="text-muted-foreground">Wrap a URL. Fast, no native plugins.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setBuildMode("capacitor")}
                  className={`rounded-md border px-3 py-2 text-left text-xs ${buildMode === "capacitor" ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  <div className="font-heading text-sm">Capacitor project</div>
                  <div className="text-muted-foreground">Full native plugins (AdMob, Billing, …).</div>
                </button>
              </div>
            </div>

            {buildMode === "webview" ? (
              <div className="space-y-2">
                <Label className="text-xs font-heading text-foreground">Web App URL *</Label>
                <Input
                  placeholder="https://your-webapp.lovable.app"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="font-heading text-sm"
                />
              </div>
            ) : (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="space-y-2">
                  <Label className="text-xs font-heading text-foreground">Capacitor project (.zip) *</Label>
                  <Input
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    onChange={(e) => handleProjectZip(e.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Must contain <code>package.json</code>, <code>capacitor.config.ts|json</code>, and a prebuilt
                    <code> dist/</code> (or <code>www/</code>, <code>build/</code>). Max 100 MB.
                  </p>
                  {projectZip && (
                    <p className="text-xs text-muted-foreground">
                      📦 {projectZip.name} ({(projectZip.size / 1024 / 1024).toFixed(2)} MB)
                    </p>
                  )}
                  {detectedPlugins.length > 0 && (
                    <div className="text-xs">
                      <div className="font-heading mb-1">Detected Capacitor plugins ({detectedPlugins.length}):</div>
                      <div className="flex flex-wrap gap-1">
                        {detectedPlugins.map((p) => (
                          <span key={p} className="rounded bg-muted px-2 py-0.5 text-[10px]">{p}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Configure AdMob App ID and ad unit IDs in the <b>Monetize</b> tab.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-heading text-foreground">App Name *</Label>
                <Input
                  placeholder="My App"
                  value={appName}
                  onChange={(e) => autoFillPackageName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-heading text-foreground">Package Name</Label>
                <Input
                  placeholder="com.example.app"
                  value={packageName}
                  onChange={(e) => setPackageName(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-heading text-foreground">Version</Label>
                <Input value={versionName} onChange={(e) => handleVersionNameChange(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-heading text-foreground">Play Version Code</Label>
                <Input
                  type="number"
                  min={1}
                  value={versionCode}
                  onChange={(e) => setVersionCode(Math.max(1, Number(e.target.value) || 1))}
                />
                <p className="text-xs text-muted-foreground">Must be higher than your last Play upload.</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-heading text-foreground">Orientation</Label>
                <Select value={orientation} onValueChange={setOrientation}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">Portrait</SelectItem>
                    <SelectItem value="landscape">Landscape</SelectItem>
                    <SelectItem value="any">Any</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-heading text-foreground">Build Output</Label>
              <Select value={buildType} onValueChange={(v) => setBuildType(v as "aab" | "apk" | "both")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="apk">APK only — install directly on phone</SelectItem>
                  <SelectItem value="aab">AAB only — for Google Play</SelectItem>
                  <SelectItem value="both">Both APK + AAB</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">APK is for sideloading on your device. AAB is required for the Play Store.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-heading text-foreground">App Icon (1024×1024 PNG recommended)</Label>
              <div className="flex items-center gap-3">
                {iconPreview && (
                  <img
                    src={iconPreview}
                    alt="App icon preview"
                    className="h-16 w-16 rounded-lg border border-border object-cover bg-muted"
                  />
                )}
                <div className="flex-1 space-y-2">
                  <Input
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        setRawIconSrc(reader.result as string);
                        setCropperOpen(true);
                      };
                      reader.readAsDataURL(f);
                      e.target.value = "";
                    }}
                    className="text-xs"
                  />
                  <div className="flex gap-2">
                    {iconFile && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => rawIconSrc && setCropperOpen(true)}
                      >
                        Re-crop
                      </Button>
                    )}
                    {iconFile && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => { setIconFile(null); setIconPreview(null); setRawIconSrc(null); }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Upload a sharp square logo. Use 1024×1024 for the cleanest Play Store and launcher icon.
                  </p>
                </div>
              </div>
              <IconCropper
                open={cropperOpen}
                imageSrc={rawIconSrc}
                onClose={() => setCropperOpen(false)}
                onCropped={(file) => {
                  setIconFile(file);
                  setIconPreview(URL.createObjectURL(file));
                }}
              />
            </div>
          </TabsContent>

          <TabsContent value="appearance" className="mt-0 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-heading text-foreground">Splash Color</Label>
                <div className="flex gap-2">
                  <input type="color" value={splashColor} onChange={(e) => setSplashColor(e.target.value)} className="h-10 w-10 rounded cursor-pointer border-0" />
                  <Input value={splashColor} onChange={(e) => setSplashColor(e.target.value)} className="text-xs" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-heading text-foreground">Theme Color</Label>
                <div className="flex gap-2">
                  <input type="color" value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className="h-10 w-10 rounded cursor-pointer border-0" />
                  <Input value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className="text-xs" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-heading text-foreground">Nav Bar Color</Label>
                <div className="flex gap-2">
                  <input type="color" value={navColor} onChange={(e) => setNavColor(e.target.value)} className="h-10 w-10 rounded cursor-pointer border-0" />
                  <Input value={navColor} onChange={(e) => setNavColor(e.target.value)} className="text-xs" />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">These colors customize the Android status bar, navigation bar, and splash screen.</p>
          </TabsContent>

          <TabsContent value="native" className="mt-0 space-y-6">
            {/* Section: UX */}
            <div>
              <h3 className="text-xs font-heading font-bold text-foreground mb-3 uppercase tracking-wider">User Experience</h3>
              <div className="space-y-2">
                {[
                  { k: "enable_native_splash" as const,    label: "Native Splash Screen",  desc: "Show app icon on launch in your splash color" },
                  { k: "enable_pull_to_refresh" as const,  label: "Pull to Refresh",       desc: "Swipe down on the page to reload" },
                  { k: "enable_offline_page" as const,     label: "Offline Fallback Page", desc: "Show a friendly offline screen instead of browser error" },
                  { k: "swipe_back_navigation" as const,   label: "Back-button Navigation",desc: "Hardware back goes to previous page in WebView history" },
                  { k: "allow_zoom" as const,              label: "Allow Pinch-to-Zoom",   desc: "Let users zoom into pages with pinch gestures" },
                  { k: "dark_mode_force" as const,         label: "Force Dark Mode",       desc: "Always use dark theme regardless of system setting" },
                  { k: "allow_external_links" as const,    label: "Open External Links",   desc: "Open non-app URLs in the system browser" },
                  { k: "cache_enabled" as const,           label: "Web Cache",             desc: "Cache assets for faster loads (recommended)" },
                  { k: "allow_cleartext" as const,         label: "Allow Mixed HTTP",      desc: "Permit insecure http:// resources on https:// pages" },
                ].map(({ k, label, desc }) => (
                  <div key={k} className="flex items-center justify-between rounded-lg border border-border bg-card/30 p-3">
                    <div className="pr-4">
                      <p className="text-sm font-heading font-medium text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <Switch checked={feat[k]} onCheckedChange={(v) => setF(k, v)} />
                  </div>
                ))}
              </div>
            </div>

            {/* Section: Display & Privacy */}
            <div>
              <h3 className="text-xs font-heading font-bold text-foreground mb-3 uppercase tracking-wider">Display &amp; Privacy</h3>
              <div className="space-y-2">
                {[
                  { k: "block_screenshots" as const, label: "Block Screenshots",        desc: "Prevent users from taking screenshots or screen recording (FLAG_SECURE)" },
                  { k: "keep_screen_on" as const,    label: "Keep Screen On",           desc: "Screen stays awake while app is open" },
                  { k: "fullscreen_mode" as const,   label: "Fullscreen Mode",          desc: "Hide the system status bar entirely" },
                  { k: "hide_status_bar" as const,   label: "Hide Status Bar",          desc: "Immersive mode (status bar appears on swipe)" },
                ].map(({ k, label, desc }) => (
                  <div key={k} className="flex items-center justify-between rounded-lg border border-border bg-card/30 p-3">
                    <div className="pr-4">
                      <p className="text-sm font-heading font-medium text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <Switch checked={feat[k]} onCheckedChange={(v) => setF(k, v)} />
                  </div>
                ))}
              </div>
            </div>

            {/* Section: Permissions */}
            <div>
              <h3 className="text-xs font-heading font-bold text-foreground mb-3 uppercase tracking-wider">Permissions</h3>
              <p className="text-xs text-muted-foreground mb-3">Only enable what your app actually uses — Play Store reviewers reject apps that request unused permissions.</p>
              <div className="space-y-2">
                {[
                  { k: "enable_camera" as const,             label: "Camera",                desc: "android.permission.CAMERA" },
                  { k: "enable_microphone" as const,         label: "Microphone",            desc: "android.permission.RECORD_AUDIO" },
                  { k: "enable_location" as const,           label: "Location",              desc: "ACCESS_FINE_LOCATION + COARSE" },
                  { k: "enable_geolocation" as const,        label: "Web Geolocation API",   desc: "Allow JS navigator.geolocation in WebView" },
                  { k: "enable_storage" as const,            label: "Files & Media",         desc: "READ_EXTERNAL_STORAGE / READ_MEDIA_*" },
                  { k: "enable_sms" as const,                label: "SMS",                   desc: "SEND_SMS, READ_SMS, RECEIVE_SMS" },
                  { k: "enable_contacts" as const,           label: "Contacts",              desc: "READ_CONTACTS, WRITE_CONTACTS" },
                  { k: "enable_phone_state" as const,        label: "Phone State",           desc: "READ_PHONE_STATE" },
                  { k: "enable_calendar" as const,           label: "Calendar",              desc: "READ_CALENDAR, WRITE_CALENDAR" },
                  { k: "enable_push_notifications" as const, label: "Push Notifications",    desc: "POST_NOTIFICATIONS (Android 13+)" },
                  { k: "enable_biometric" as const,          label: "Biometric / Fingerprint", desc: "USE_BIOMETRIC, USE_FINGERPRINT" },
                  { k: "enable_bluetooth" as const,          label: "Bluetooth",             desc: "BLUETOOTH_CONNECT, BLUETOOTH_SCAN" },
                  { k: "enable_nfc" as const,                label: "NFC",                   desc: "android.permission.NFC" },
                  { k: "enable_vibrate" as const,            label: "Vibration",             desc: "android.permission.VIBRATE" },
                ].map(({ k, label, desc }) => (
                  <div key={k} className="flex items-center justify-between rounded-lg border border-border bg-card/30 p-3">
                    <div className="pr-4">
                      <p className="text-sm font-heading font-medium text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <Switch checked={feat[k]} onCheckedChange={(v) => setF(k, v)} />
                  </div>
                ))}
              </div>
            </div>

            {/* Section: Web Bridges */}
            <div>
              <h3 className="text-xs font-heading font-bold text-foreground mb-3 uppercase tracking-wider">Web ↔ Native Bridges</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Available globally as <code>window.AndroidNative.*</code> from your web app.
              </p>
              <div className="space-y-2">
                {[
                  { k: "enable_clipboard" as const,     label: "Clipboard",        desc: "AndroidNative.copyToClipboard(text)" },
                  { k: "enable_share" as const,         label: "Native Share Sheet", desc: "AndroidNative.share(text, title)" },
                  { k: "enable_file_download" as const, label: "File Downloads",   desc: "Hook DownloadManager for downloadable links" },
                  { k: "enable_file_upload" as const,   label: "File Uploads",     desc: "Allow <input type=file> to access device files" },
                ].map(({ k, label, desc }) => (
                  <div key={k} className="flex items-center justify-between rounded-lg border border-border bg-card/30 p-3">
                    <div className="pr-4">
                      <p className="text-sm font-heading font-medium text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <Switch checked={feat[k]} onCheckedChange={(v) => setF(k, v)} />
                  </div>
                ))}
              </div>
            </div>

            {/* Section: Advanced */}
            <div>
              <h3 className="text-xs font-heading font-bold text-foreground mb-3 uppercase tracking-wider">Advanced</h3>
              <div className="space-y-2">
                <Label className="text-xs font-heading text-foreground">User Agent Override (optional)</Label>
                <Input
                  placeholder="Leave empty to use the default WebView user agent"
                  value={userAgentOverride}
                  onChange={(e) => setUserAgentOverride(e.target.value)}
                  className="text-xs font-mono"
                />
                <p className="text-xs text-muted-foreground">Some sites block WebViews — set a custom UA to bypass.</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="monetization" className="mt-0 space-y-4">
            <div className="rounded-lg border border-border bg-card/30 p-4 space-y-3">
              <div>
                <p className="text-sm font-heading font-medium text-foreground">AdMob</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Paste the IDs from your AdMob console. The builder injects them into the app as <code className="font-mono">window.__ADMOB_IDS__</code>; call <code className="font-mono">AdMob.showInterstitialAd()</code> / <code className="font-mono">showRewardedAd()</code> / <code className="font-mono">showBannerAd()</code> from your web app — IDs are picked up automatically.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-heading text-foreground">AdMob App ID</Label>
                <Input
                  placeholder="ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY"
                  value={admobAppId}
                  onChange={(e) => setAdmobAppId(e.target.value)}
                  className="font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Goes into <code>AndroidManifest.xml</code> as the AdMob APPLICATION_ID. Required to initialize the SDK.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs font-heading text-foreground">Banner Ad Unit ID</Label>
                  <Input
                    placeholder="ca-app-pub-XXXX/YYYY"
                    value={admobBannerId}
                    onChange={(e) => setAdmobBannerId(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-heading text-foreground">Interstitial Ad Unit ID</Label>
                  <Input
                    placeholder="ca-app-pub-XXXX/YYYY"
                    value={admobInterstitialId}
                    onChange={(e) => setAdmobInterstitialId(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-heading text-foreground">Rewarded Ad Unit ID</Label>
                  <Input
                    placeholder="ca-app-pub-XXXX/YYYY"
                    value={admobRewardedId}
                    onChange={(e) => setAdmobRewardedId(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-heading text-foreground">Rewarded Interstitial Ad Unit ID</Label>
                  <Input
                    placeholder="ca-app-pub-XXXX/YYYY"
                    value={admobRewardedInterstitialId}
                    onChange={(e) => setAdmobRewardedInterstitialId(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs font-heading text-foreground">App Open Ad Unit ID</Label>
                  <Input
                    placeholder="ca-app-pub-XXXX/YYYY"
                    value={admobAppOpenId}
                    onChange={(e) => setAdmobAppOpenId(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
                <b>Production ads only.</b> Test creatives are permanently disabled — every build serves real ads from the ad unit IDs above. Make sure the IDs belong to your own AdMob account before publishing.
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
                Leave any ad unit blank to disable that format. AdMob requires the <b>App ID</b> to be set; without it the SDK won't initialize and no ads will load.
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-card/30 p-4">
              <div>
                <p className="text-sm font-heading font-medium text-foreground">Google Play Billing</p>
                <p className="text-xs text-muted-foreground">Enable in-app purchases & subscriptions (adds BILLING permission + billing-client lib)</p>
              </div>
              <Switch checked={enableBilling} onCheckedChange={setEnableBilling} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-card/30 p-4">
              <div>
                <p className="text-sm font-heading font-medium text-foreground">Capacitor Support</p>
                <p className="text-xs text-muted-foreground">Always on — Capacitor core is bundled so the AdMob/Billing/Camera/Share plugins work natively.</p>
              </div>
              <Switch checked disabled />
            </div>
          </TabsContent>

          <TabsContent value="custom" className="mt-0 space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-heading text-foreground">Custom CSS</Label>
              <Textarea
                placeholder="/* Injected after page load — override styles, hide elements, etc. */&#10;body { background: #000; }"
                value={customCss}
                onChange={(e) => setCustomCss(e.target.value)}
                className="font-mono text-xs min-h-[100px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-heading text-foreground">Custom HTML</Label>
              <Textarea
                placeholder='<!-- Appended to <body> after page load -->&#10;<div id="native-banner">Hello from Android!</div>'
                value={customHtml}
                onChange={(e) => setCustomHtml(e.target.value)}
                className="font-mono text-xs min-h-[100px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-heading text-foreground">Custom JavaScript</Label>
              <Textarea
                placeholder="// Runs after page load. window.__ANDROID_NATIVE__ === true&#10;// Use window.AndroidBilling.* if billing is enabled."
                value={customJs}
                onChange={(e) => setCustomJs(e.target.value)}
                className="font-mono text-xs min-h-[120px]"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Code runs inside the WebView after each page load. Globals exposed: <code>window.__ANDROID_NATIVE__</code>, <code>window.__BILLING_ENABLED__</code>, <code>window.__CAPACITOR_NATIVE__</code>.
            </p>
          </TabsContent>

          <TabsContent value="signing" className="mt-0 space-y-4">
            {signingKeys.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs font-heading text-foreground">Use Existing Signing Key</Label>
                <Select value={signingKeyId} onValueChange={setSigningKeyId}>
                  <SelectTrigger><SelectValue placeholder="Choose a signing key" /></SelectTrigger>
                  <SelectContent>
                    {signingKeys.map((k) => (
                      <SelectItem key={k.id} value={k.id}>
                        {k.name} ({k.key_alias}){k.is_default ? " · default" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

              <div className="rounded-lg border border-border bg-card/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-heading font-medium text-foreground flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" /> Upload Your Own .jks / .keystore
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Use the same keystore as your previous Play Store release so the SHA-1 / SHA-256 fingerprints stay identical.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setShowInlineKey((v) => !v)}
                >
                  {showInlineKey ? "Cancel" : "Add Key"}
                </Button>
              </div>

              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <p className="text-xs text-foreground">
                  A signing key is required. Upload your own .jks / .keystore here or in the Signing Keys tab — builds will not start without one.
                </p>
              </div>

              {showInlineKey && (
                <div className="space-y-3 pt-2 border-t border-border">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Key Name</Label>
                      <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="My Release Key" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Key Alias</Label>
                      <Input value={newKeyAlias} onChange={(e) => setNewKeyAlias(e.target.value)} placeholder="Optional — auto-detected if blank" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Key Password</Label>
                      <Input type="password" value={newKeyPassword} onChange={(e) => setNewKeyPassword(e.target.value)} placeholder="Optional — uses store password if blank" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Store Password *</Label>
                      <Input type="password" value={newStorePassword} onChange={(e) => setNewStorePassword(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Keystore File (.jks / .keystore) *</Label>
                    <Input
                      ref={keystoreInputRef}
                      type="file"
                      onInput={(e) => setNewKeystoreFile(e.currentTarget.files?.[0] || null)}
                      onChange={(e) => setNewKeystoreFile(e.currentTarget.files?.[0] || null)}
                      className="text-xs file:mr-3 file:rounded file:border-0 file:bg-primary/20 file:px-3 file:py-1 file:text-foreground"
                    />
                    {newKeystoreFile && (
                      <p className="text-xs text-primary">
                        ✓ {newKeystoreFile.name} ({Math.round(newKeystoreFile.size / 1024)} KB)
                      </p>
                    )}
                  </div>
                  <Button variant="hero" size="sm" onClick={saveInlineSigningKey} disabled={savingKey}>
                    {savingKey ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Saving...</> : "Save & Use This Key"}
                  </Button>
                </div>
              )}
            </div>

            {signingKeys.length === 0 && !showInlineKey && (
              <div className="rounded-lg border border-dashed border-destructive/40 bg-destructive/5 p-4 text-center">
                <Key className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">
                  No signing key uploaded yet. Add your .jks / .keystore above — builds require your own signing key.
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              The keystore is stored privately and only used to sign your AAB/APK. Keep your passwords safe — they cannot be recovered.
            </p>
          </TabsContent>
        </div>
      </Tabs>

      <div className="p-6 border-t border-border">
        <Button variant="hero" className="w-full" onClick={handleBuild} disabled={building}>
          {building ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" /> {buildStep || "Building..."}</>
          ) : (
            <><Rocket className="h-4 w-4 mr-2" /> {buildType === "apk" ? "Build APK" : buildType === "aab" ? "Build AAB" : "Build APK + AAB"}</>
          )}
        </Button>
        {buildStep && <p className="mt-2 text-center text-xs text-muted-foreground">{buildStep}</p>}
      </div>
    </div>
  );
};

export default BuildForm;
