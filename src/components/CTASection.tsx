import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

const CTASection = () => {
  return (
    <section className="py-24 relative">
      <div className="absolute inset-0">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      </div>
      <div className="container relative z-10">
        <div className="mx-auto max-w-2xl text-center glow-border rounded-2xl p-12 bg-card/30 backdrop-blur-sm space-y-6">
          <h2 className="font-heading text-3xl font-bold text-foreground">
            Ready to convert?
          </h2>
          <p className="text-muted-foreground">
            Sign up for free and convert your first APK to AAB in minutes.
          </p>
          <Button variant="hero" size="lg" asChild>
            <Link to="/auth?tab=signup" className="gap-2">
              Create Free Account <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
