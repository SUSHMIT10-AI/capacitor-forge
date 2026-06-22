import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Clock, Loader2, CheckCircle2, XCircle, FileDown, Trash2, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type BuildStatus = "pending" | "building" | "complete" | "failed";

interface BuildConfig {
  id: string;
  url: string;
  app_name: string;
  package_name: string;
  status: BuildStatus;
  output_aab_path: string | null;
  output_apk_path: string | null;
  error_message: string | null;
  codemagic_build_id: string | null;
  created_at: string;
  version_name: string;
}

const statusConfig: Record<BuildStatus, { icon: any; label: string; className: string }> = {
  pending: { icon: Clock, label: "Queued", className: "text-warning" },
  building: { icon: Loader2, label: "Building", className: "text-primary animate-spin" },
  complete: { icon: CheckCircle2, label: "Ready", className: "text-success" },
  failed: { icon: XCircle, label: "Failed", className: "text-destructive" },
};

interface BuildHistoryProps {
  refreshKey: number;
}

const shouldPollBuild = (b: BuildConfig) =>
  b.status === "pending" ||
  b.status === "building" ||
  (b.status === "failed" && Boolean(b.codemagic_build_id) && !b.error_message);

const BuildHistory = ({ refreshKey }: BuildHistoryProps) => {
  const [builds, setBuilds] = useState<BuildConfig[]>([]);
  const { toast } = useToast();
  const buildsRef = useRef<BuildConfig[]>([]);

  const loadBuilds = useCallback(async () => {
    const { data } = await supabase
      .from("build_configs")
      .select("id, url, app_name, package_name, status, output_aab_path, output_apk_path, error_message, codemagic_build_id, created_at, version_name")
      .order("created_at", { ascending: false });
    if (data) setBuilds(data as BuildConfig[]);
  }, []);

  useEffect(() => {
    buildsRef.current = builds;
  }, [builds]);

  const inProgressBuildIds = useMemo(
    () => builds.filter(shouldPollBuild).map((b) => b.id).join("|"),
    [builds],
  );

  useEffect(() => {
    void loadBuilds();

    const channel = supabase
      .channel("build-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "build_configs" }, () => {
        void loadBuilds();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadBuilds, refreshKey]);

  useEffect(() => {
    if (!inProgressBuildIds) return;

    let cancelled = false;

    const syncBuildStatuses = async () => {
      const inProgress = buildsRef.current.filter(shouldPollBuild);
      if (!inProgress.length) return;

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        // No active session yet — skip this poll cycle instead of hitting the function unauthenticated.
        return;
      }

      const results = await Promise.allSettled(
        inProgress.map((b) =>
          supabase.functions.invoke("poll-codemagic-build", {
            body: { build_id: b.id },
            headers: { Authorization: `Bearer ${accessToken}` },
          }),
        ),
      );

      results.forEach((result) => {
        if (result.status === "fulfilled" && result.value.error) {
          console.warn("poll failed", result.value.error);
        }
        if (result.status === "rejected") {
          console.warn("poll failed", result.reason);
        }
      });

      if (!cancelled) {
        await loadBuilds();
      }
    };

    void syncBuildStatuses();

    const poller = setInterval(() => {
      void syncBuildStatuses();
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(poller);
    };
  }, [inProgressBuildIds, loadBuilds]);

  const downloadFile = async (path: string | null, fileName: string) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from("build-outputs").download(path);
    if (error) {
      toast({ title: "Download failed", description: error.message, variant: "destructive" });
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteBuild = async (id: string, aabPath: string | null, apkPath: string | null) => {
    const paths = [aabPath, apkPath].filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from("build-outputs").remove(paths);
    await supabase.from("build_configs").delete().eq("id", id);
    setBuilds((prev) => prev.filter((b) => b.id !== id));
  };

  if (builds.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card/30 p-8 text-center">
        <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No builds yet. Create your first build above.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {builds.map((b) => {
        const config = statusConfig[b.status as BuildStatus] || statusConfig.pending;
        const StatusIcon = config.icon;
        return (
          <div key={b.id} className="rounded-lg border border-border bg-card/50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <StatusIcon className={`h-5 w-5 flex-shrink-0 ${config.className}`} />
                <div className="min-w-0">
                  <p className="text-sm font-heading font-medium text-foreground truncate">
                    {b.app_name} <span className="text-muted-foreground text-xs">v{b.version_name}</span>
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{b.url}</p>
                  <p className="text-xs text-muted-foreground">{b.package_name} · {new Date(b.created_at).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs font-heading ${config.className}`}>{config.label}</span>
                {b.status === "complete" && (
                  <>
                    {b.output_aab_path && (
                      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => downloadFile(b.output_aab_path, `${b.app_name}_${b.package_name}.aab`)}>
                        <FileDown className="h-4 w-4 text-primary mr-1" /> .aab
                      </Button>
                    )}
                    {b.output_apk_path && (
                      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => downloadFile(b.output_apk_path, `${b.app_name}_${b.package_name}.apk`)}>
                        <FileDown className="h-4 w-4 text-primary mr-1" /> .apk
                      </Button>
                    )}
                  </>
                )}
                {b.status === "complete" && b.error_message && (
                  <span className="text-xs text-muted-foreground max-w-[180px] truncate">{b.error_message}</span>
                )}
                {b.status === "failed" && b.error_message && !b.error_message.startsWith("cm:") && (
                  <span className="text-xs text-destructive max-w-[150px] truncate">{b.error_message}</span>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteBuild(b.id, b.output_aab_path, b.output_apk_path)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default BuildHistory;
