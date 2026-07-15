import { Upload, Zap, Shield, Download, Clock, Layers } from "lucide-react";

const features = [
  {
    icon: Upload,
    title: "URL or Capacitor Upload",
    description: "Build from a web URL or upload a Capacitor project zip with real-time progress.",
  },
  {
    icon: Zap,
    title: "minSdk 22 Support",
    description: "Keeps Android 5.1+ support while pinning Google Play services to compatible versions.",
  },
  {
    icon: Shield,
    title: "Release Signing",
    description: "Upload your own keystore and generate Play Console-ready release artifacts.",
  },
  {
    icon: Download,
    title: "Instant Download",
    description: "Download signed .AAB and optional .APK artifacts directly from the dashboard.",
  },
  {
    icon: Clock,
    title: "Conversion History",
    description: "Track every build with timestamps, status, and clearer failure diagnostics.",
  },
  {
    icon: Layers,
    title: "All Google Play ABIs",
    description: "Bundle armeabi-v7a, arm64-v8a, x86, and x86_64 for broad device coverage.",
  },
];

const FeaturesSection = () => {
  return (
    <section id="features" className="py-24 relative">
      <div className="absolute inset-0">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      </div>
      <div className="container relative z-10">
        <div className="text-center mb-16 space-y-4">
          <h2 className="font-heading text-3xl font-bold text-foreground sm:text-4xl">
            Everything you need
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            From upload to Play Store — a complete pipeline for Android App Bundle generation.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-xl border border-border bg-card/50 p-6 transition-all hover:glow-border hover:bg-card"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-heading text-base font-semibold text-foreground mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
