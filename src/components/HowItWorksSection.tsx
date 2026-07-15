const steps = [
  {
    number: "01",
    title: "Upload or paste URL",
    description: "Paste a web app URL or upload a Capacitor project zip from the dashboard.",
  },
  {
    number: "02",
    title: "Configure signing",
    description: "Upload your own .jks / .keystore to sign your AAB.",
  },
  {
    number: "03",
    title: "Build AAB/APK",
    description: "The workflow locks target API 35, minSdk 22, all ABIs, AdMob, and signing.",
  },
  {
    number: "04",
    title: "Download & publish",
    description: "Download the .AAB and upload it directly to Google Play Console.",
  },
];

const HowItWorksSection = () => {
  return (
    <section id="how-it-works" className="py-24 relative">
      <div className="absolute inset-0">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      </div>
      <div className="container relative z-10">
        <div className="text-center mb-16 space-y-4">
          <h2 className="font-heading text-3xl font-bold text-foreground sm:text-4xl">
            How it works
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Four steps from project upload to a Play Store-ready Android bundle.
          </p>
        </div>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <div key={step.number} className="relative text-center space-y-4">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-primary/30 bg-primary/5">
                <span className="font-heading text-lg font-bold text-primary">{step.number}</span>
              </div>
              <h3 className="font-heading text-sm font-semibold text-foreground">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
              {i < steps.length - 1 && (
                <div className="hidden lg:block absolute top-7 left-[60%] w-[80%] h-px bg-gradient-to-r from-primary/30 to-transparent" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
