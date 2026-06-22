import { Upload, Zap, Shield, Download, Clock, Layers } from "lucide-react";

const features = [
  {
    icon: Upload,
    title: "Drag & Drop Upload",
    description: "Upload APK files up to 200MB with real-time progress tracking.",
  },
  {
    icon: Zap,
    title: "Fast Conversion",
    description: "Powered by bundletool. Convert APKs under 100MB in less than 5 minutes.",
  },
  {
    icon: Shield,
    title: "Secure Signing",
    description: "Upload your own keystore to sign release builds.",
  },
  {
    icon: Download,
    title: "Instant Download",
    description: "Download your signed .AAB directly from the dashboard.",
  },
  {
    icon: Clock,
    title: "Conversion History",
    description: "Track all your conversions with timestamps, status, and error logs.",
  },
  {
    icon: Layers,
    title: "Split APK Support",
    description: "Handle multiple APK architectures and merge them into a single AAB.",
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
