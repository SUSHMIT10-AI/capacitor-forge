import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Key, Plus, Trash2, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface SigningKey {
  id: string;
  name: string;
  key_alias: string;
  key_password: string;
  store_password: string;
  keystore_path: string | null;
  is_default: boolean;
  created_at: string;
}

interface SigningKeysManagerProps {
  userId: string;
}

const SigningKeysManager = ({ userId }: SigningKeysManagerProps) => {
  const [keys, setKeys] = useState<SigningKey[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("Release Key");
  const [keyAlias, setKeyAlias] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [storePassword, setStorePassword] = useState("");
  const [keystoreFile, setKeystoreFile] = useState<File | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadKeys();
  }, []);

  const loadKeys = async () => {
    const { data } = await supabase
      .from("signing_keys")
      .select("*")
      .order("is_default", { ascending: false });
    if (data) setKeys(data as SigningKey[]);
  };

  const createKey = async () => {
    if (!keystoreFile) {
      toast({
        title: "Keystore file required",
        description: "Upload your .jks / .keystore file to continue.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      let keystorePath: string | null = null;
      if (keystoreFile) {
        const safeName = keystoreFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${userId}/keystores/${Date.now()}_${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("app-assets")
          .upload(path, keystoreFile, {
            contentType: "application/octet-stream",
            upsert: false,
          });
        if (upErr) throw new Error(`Keystore upload failed: ${upErr.message}`);
        keystorePath = path;
      }

      if (isDefault) {
        await supabase.from("signing_keys").update({ is_default: false }).eq("user_id", userId);
      }

      const { error } = await supabase.from("signing_keys").insert({
        user_id: userId,
        name,
          key_alias: keyAlias.trim() || "auto-detect",
          key_password: keyPassword.trim() || storePassword.trim(),
          store_password: storePassword.trim(),
        keystore_path: keystorePath,
        is_default: isDefault || keys.length === 0,
      });

      if (error) throw error;

      toast({ title: "Key created", description: "Signing key saved securely" });
      setShowCreate(false);
      setName("Release Key");
      setKeyAlias("");
      setKeyPassword("");
      setStorePassword("");
      setKeystoreFile(null);
      setIsDefault(false);
      await loadKeys();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteKey = async (id: string, keystorePath: string | null) => {
    if (keystorePath) {
      await supabase.storage.from("app-assets").remove([keystorePath]);
    }
    await supabase.from("signing_keys").delete().eq("id", id);
    setKeys((prev) => prev.filter((k) => k.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold text-foreground flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" /> Signing Keys
        </h2>
        <Button variant="outline" size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-4 w-4 mr-1" /> New Key
        </Button>
      </div>

      {showCreate && (
        <div className="glow-border rounded-xl bg-card/50 p-6 space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-heading">Upload Keystore (.jks / .keystore) *</Label>
            <Input
              type="file"
              onChange={(e) => setKeystoreFile(e.target.files?.[0] || null)}
              className="text-xs file:mr-3 file:rounded file:border-0 file:bg-primary/20 file:px-3 file:py-1 file:text-foreground"
            />
            {keystoreFile ? (
              <p className="text-xs text-primary">
                ✓ Selected: {keystoreFile.name} ({Math.round(keystoreFile.size / 1024)} KB)
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Drop your release keystore here. Alias, passwords, and name are optional — fill them only if your keystore uses non-default credentials.
              </p>
            )}
          </div>

          <details className="rounded-lg border border-border bg-background/40 p-3">
            <summary className="cursor-pointer text-xs font-heading text-muted-foreground hover:text-foreground">
              Advanced (alias / passwords / name) — optional
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-heading">Key Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Release Key" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-heading">Key Alias</Label>
                  <Input value={keyAlias} onChange={(e) => setKeyAlias(e.target.value)} placeholder="Auto-detect" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-heading">Store Password</Label>
                  <Input type="password" value={storePassword} onChange={(e) => setStorePassword(e.target.value)} placeholder="Leave blank if none" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-heading">Key Password</Label>
                  <Input type="password" value={keyPassword} onChange={(e) => setKeyPassword(e.target.value)} placeholder="Defaults to store password" />
                </div>
              </div>
            </div>
          </details>

          <div className="flex items-center gap-2">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            <Label className="text-xs text-foreground">Set as default signing key</Label>
          </div>
          <div className="flex gap-2">
            <Button variant="hero" size="sm" onClick={createKey} disabled={saving}>
              {saving ? "Saving..." : "Save Key"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {keys.length === 0 && !showCreate ? (
        <div className="rounded-xl border border-border bg-card/30 p-8 text-center">
          <Key className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No signing keys yet. Create one to sign your builds.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between rounded-lg border border-border bg-card/50 p-4">
              <div className="flex items-center gap-3">
                <Key className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-heading font-medium text-foreground">
                    {k.name} {k.is_default && <span className="text-xs text-primary ml-1">(default)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Alias: {k.key_alias}
                    {" · "}
                    {k.keystore_path
                      ? <span className="text-primary">Keystore uploaded ✓</span>
                      : <span className="text-destructive">No keystore file — re-create this key</span>}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteKey(k.id, k.keystore_path)}>
                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SigningKeysManager;
