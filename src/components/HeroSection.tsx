import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, Upload, Package } from "lucide-react";

const HeroSection = () => {
  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px] animate-pulse-glow" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      </div>

      <div className="container relative z-10">
        <div className="mx-auto max-w-3xl text-center space-y-8">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-heading text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-glow" />
            Play-ready Android builder
          </div>

          {/* Heading */}
          <h1 className="font-heading text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            <span className="text-foreground">Build Play-ready</span>
            <br />
            <span className="text-gradient">Android AABs</span>
          </h1>

          {/* Subtitle */}
          <p className="mx-auto max-w-xl text-lg text-muted-foreground leading-relaxed">
            Generate signed AAB/APK builds from URLs or Capacitor projects with minSdk 22,
            all Google Play ABIs, release signing, and production AdMob support.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button variant="hero" size="lg" asChild>
              <Link to="/auth?tab=signup" className="gap-2">
                Start Building <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="hero-outline" size="lg" asChild>
              <Link to="/#how-it-works">See How It Works</Link>
            </Button>
          </div>

          {/* Visual */}
          <div className="mt-12 glow-border rounded-xl p-6 bg-card/50 backdrop-blur-sm">
            <div className="flex items-center gap-3 border-b border-border pb-3 mb-4">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-destructive/60" />
                <div className="h-3 w-3 rounded-full bg-warning/60" />
                <div className="h-3 w-3 rounded-full bg-success/60" />
              </div>
              <span className="text-xs font-heading text-muted-foreground">aabforge — terminal</span>
            </div>
            <div className="font-heading text-sm text-left space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="text-primary">$</span>
                <span>upload mht-cet-master.zip</span>
              </div>
              <div className="flex items-center gap-2 text-success">
                <Upload className="h-3.5 w-3.5" />
                <span>Project uploaded — overrides applied</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="text-primary">$</span>
                <span>build --min-sdk 22 --abis all --sign --ads production</span>
              </div>
              <div className="flex items-center gap-2 text-success">
                <Package className="h-3.5 w-3.5" />
                <span>✓ AAB generated — ready for Google Play</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
