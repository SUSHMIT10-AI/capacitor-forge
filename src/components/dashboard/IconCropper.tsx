import { useCallback, useEffect, useState } from "react";
import Cropper, { Area } from "react-easy-crop";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

interface IconCropperProps {
  open: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onCropped: (file: File) => void;
}

async function getCroppedImage(src: string, area: Area, outSize: number): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, outSize, outSize);
  return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png", 1));
}

export default function IconCropper({ open, imageSrc, onClose, onCropped }: IconCropperProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [outSize, setOutSize] = useState(1024);
  const [areaPx, setAreaPx] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setCrop({ x: 0, y: 0 }); setZoom(1); setOutSize(1024); setAreaPx(null); }
  }, [open, imageSrc]);

  const onCropComplete = useCallback((_: Area, px: Area) => setAreaPx(px), []);

  const handleSave = async () => {
    if (!imageSrc || !areaPx) return;
    setBusy(true);
    try {
      const blob = await getCroppedImage(imageSrc, areaPx, outSize);
      const file = new File([blob], `icon_${outSize}.png`, { type: "image/png" });
      onCropped(file);
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-base">Crop App Icon</DialogTitle>
        </DialogHeader>
        <div className="relative w-full h-72 bg-muted rounded-md overflow-hidden">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="rect"
              showGrid
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          )}
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Zoom</Label>
            <Slider min={1} max={4} step={0.01} value={[zoom]} onValueChange={(v) => setZoom(v[0])} />
          </div>
          <div>
            <Label className="text-xs">Output size: {outSize}×{outSize}px</Label>
            <Slider min={192} max={1024} step={32} value={[outSize]} onValueChange={(v) => setOutSize(v[0])} />
            <p className="text-[10px] text-muted-foreground mt-1">
              Recommended: 1024×1024. The build creates high-density Android adaptive icons so Play Store installs do not upscale a small bitmap.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy || !areaPx}>{busy ? "Processing…" : "Use this icon"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
