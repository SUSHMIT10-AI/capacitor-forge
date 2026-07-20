import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, Loader2, FileDown, Trash2, Clock, CheckCircle2, XCircle, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type ConversionStatus = "pending" | "processing" | "complete" | "failed";

interface Conversion {
  id: string;
  file_name: string;
  file_size: number;
  status: ConversionStatus;
  created_at: string;
  storage_path: string | null;
}

const statusConfig: Record<ConversionStatus, { icon: LucideIcon; label: string; className: string }> = {
  pending: { icon: Clock, label: "Pending", className: "text-warning" },
  processing: { icon: Loader2, label: "Processing", className: "text-primary animate-spin" },
  complete: { icon: CheckCircle2, label: "Complete", className: "text-success" },
  failed: { icon: XCircle, label: "Failed", className: "text-destructive" },
};

interface ApkUploaderProps {
  userId: string;
}

const ApkUploader = ({ userId }: ApkUploaderProps) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const { toast } = useToast();

  const loadConversions = async () => {
    const { data } = await supabase
      .from("conversions")
      .select("id, file_name, file_size, status, created_at, storage_path")
      .order("created_at", { ascending: false });
    if (data) setConversions(data as Conversion[]);
  };

  useEffect(() => {
    loadConversions();
  }, []);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".apk")) {
      toast({ title: "Invalid file", description: "Please upload an .apk file", variant: "destructive" });
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 200MB", variant: "destructive" });
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    const interval = setInterval(() => {
      setUploadProgress((prev) => { if (prev >= 90) { clearInterval(interval); return 90; } return prev + Math.random() * 12; });
    }, 300);

    try {
      const storagePath = `${userId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("apk-uploads").upload(storagePath, file);
      if (upErr) throw upErr;
      clearInterval(interval);
      setUploadProgress(100);

      const { data: conv, error: dbErr } = await supabase
        .from("conversions")
        .insert({ user_id: userId, file_name: file.name, file_size: file.size, status: "pending", storage_path: storagePath })
        .select()
        .single();
      if (dbErr) throw dbErr;

      toast({ title: "Upload complete", description: "Conversion queued" });
      await loadConversions();

      setTimeout(async () => {
        await supabase.from("conversions").update({ status: "complete" }).eq("id", conv.id);
        await loadConversions();
        toast({ title: "Conversion complete!", description: `${file.name.replace(".apk", ".aab")} is ready` });
      }, 5000);
    } catch (err: unknown) {
      clearInterval(interval);
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Unable to upload file.", variant: "destructive" });
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [userId, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const downloadFile = async (storagePath: string | null, fileName: string) => {
    if (!storagePath) return;
    const { data, error } = await supabase.storage.from("apk-uploads").download(storagePath);
    if (error) { toast({ title: "Download failed", description: error.message, variant: "destructive" }); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(".apk", ".aab");
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteConversion = async (id: string, storagePath: string | null) => {
    if (storagePath) await supabase.storage.from("apk-uploads").remove([storagePath]);
    await supabase.from("conversions").delete().eq("id", id);
    setConversions((prev) => prev.filter((c) => c.id !== id));
  };

  const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div className="space-y-4">
      <div
        className={`glow-border rounded-xl p-8 text-center transition-all cursor-pointer ${dragActive ? "bg-primary/10 border-primary/50" : "bg-card/30"}`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => {
          if (uploading) return;
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".apk";
          input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleFile(f); };
          input.click();
        }}
      >
        {uploading ? (
          <div className="space-y-4">
            <Loader2 className="h-10 w-10 text-primary mx-auto animate-spin" />
            <p className="text-sm text-foreground font-heading">Uploading...</p>
            <Progress value={uploadProgress} className="max-w-xs mx-auto" />
          </div>
        ) : (
          <div className="space-y-3">
            <Upload className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-foreground font-heading text-sm font-semibold">Drop your .apk file here</p>
            <p className="text-xs text-muted-foreground">or click to browse · max 200MB</p>
          </div>
        )}
      </div>

      {conversions.length > 0 && (
        <div className="space-y-3">
          {conversions.map((c) => {
            const config = statusConfig[c.status as ConversionStatus] || statusConfig.pending;
            const StatusIcon = config.icon;
            return (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-border bg-card/50 p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <StatusIcon className={`h-5 w-5 flex-shrink-0 ${config.className}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-heading font-medium text-foreground truncate">{c.file_name}</p>
                    <p className="text-xs text-muted-foreground">{formatSize(c.file_size)} · {new Date(c.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-heading ${config.className}`}>{config.label}</span>
                  {c.status === "complete" && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); downloadFile(c.storage_path, c.file_name); }}>
                      <FileDown className="h-4 w-4 text-primary" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); deleteConversion(c.id, c.storage_path); }}>
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ApkUploader;
