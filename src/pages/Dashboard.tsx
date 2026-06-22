import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Terminal, LogOut, Globe, Upload, Key, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import BuildForm from "@/components/dashboard/BuildForm";
import BuildHistory from "@/components/dashboard/BuildHistory";
import SigningKeysManager from "@/components/dashboard/SigningKeysManager";
import ApkUploader from "@/components/dashboard/ApkUploader";

const Dashboard = () => {
  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [buildRefreshKey, setBuildRefreshKey] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      setUserEmail(session.user.email || "");
      setUserId(session.user.id);
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) navigate("/auth");
      else {
        setUserEmail(session.user.email || "");
        setUserId(session.user.id);
      }
    });

    init();
    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border glass">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-primary" />
            <span className="font-heading text-sm font-bold text-foreground">AABforge</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground hidden sm:block">{userEmail}</span>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-8">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Build Android apps from URLs or convert APK files</p>
        </div>

        <Tabs defaultValue="url-build" className="space-y-6">
          <TabsList className="bg-card/50 border border-border">
            <TabsTrigger value="url-build" className="font-heading text-xs">
              <Globe className="h-3.5 w-3.5 mr-1.5" /> URL → AAB
            </TabsTrigger>
            <TabsTrigger value="apk-convert" className="font-heading text-xs">
              <Upload className="h-3.5 w-3.5 mr-1.5" /> APK → AAB
            </TabsTrigger>
            <TabsTrigger value="signing-keys" className="font-heading text-xs">
              <Key className="h-3.5 w-3.5 mr-1.5" /> Signing Keys
            </TabsTrigger>
          </TabsList>

          <TabsContent value="url-build" className="space-y-6">
            <BuildForm userId={userId} onBuildStarted={() => setBuildRefreshKey((k) => k + 1)} />
            <div>
              <h2 className="font-heading text-lg font-semibold text-foreground mb-4">Build History</h2>
              <BuildHistory refreshKey={buildRefreshKey} />
            </div>
          </TabsContent>

          <TabsContent value="apk-convert" className="space-y-6">
            <div>
              <h2 className="font-heading text-lg font-semibold text-foreground mb-2">APK to AAB Converter</h2>
              <p className="text-xs text-muted-foreground mb-4">Upload an existing APK file to convert it to AAB format</p>
              <ApkUploader userId={userId} />
            </div>
          </TabsContent>

          <TabsContent value="signing-keys">
            <SigningKeysManager userId={userId} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Dashboard;
