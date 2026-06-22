import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Terminal, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useToast } from "@/hooks/use-toast";

const Auth = () => {
  const ALLOWED_EMAILS = [
    "sushmitdeshmukh94@gmail.com",
    "aitechdeveloper45@gmail.com",
    "deshmukh10sai@gmail.com",
  ];
  const [searchParams] = useSearchParams();
  const [isSignUp, setIsSignUp] = useState(searchParams.get("tab") === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const normalizedEmail = email.trim().toLowerCase();
  const isAllowedEmail = ALLOWED_EMAILS.includes(normalizedEmail);
  const passwordFor = (e: string) => `Allowed!${e}#secure_2026`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!isAllowedEmail) {
        throw new Error("This email is not authorized to access this app.");
      }
      const effectivePassword = passwordFor(normalizedEmail);
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password: effectivePassword,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast({ title: "Account ready", description: "You can sign in now." });
      } else {
        let { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password: effectivePassword,
        });
        if (error) {
          // Auto-provision allowed account on first sign-in
          const { error: signUpError } = await supabase.auth.signUp({
            email: normalizedEmail,
            password: effectivePassword,
            options: { emailRedirectTo: window.location.origin },
          });
          if (signUpError) throw signUpError;
          const retry = await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password: effectivePassword,
          });
          if (retry.error) throw retry.error;
        }
        navigate("/dashboard");
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    toast({
      title: "Google sign-in disabled",
      description: "Use one of the authorized email addresses to sign in.",
      variant: "destructive",
    });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-4">
          <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm mb-4">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
          <div className="flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/20">
              <Terminal className="h-6 w-6 text-primary" />
            </div>
          </div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {isSignUp ? "Create your account" : "Welcome back"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isSignUp ? "Start converting APKs to AABs" : "Sign in to your dashboard"}
          </p>
        </div>

        <div className="glow-border rounded-xl bg-card/50 p-6 space-y-6">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleGoogleSignIn}
          >
            <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-foreground">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {email && !isAllowedEmail && (
            <div className="space-y-2">
              <p className="text-xs text-destructive">
                This email is not authorized to access this app.
              </p>
            </div>
            )}
            {isAllowedEmail && (
              <p className="text-xs text-muted-foreground">
                Authorized email — no password required.
              </p>
            )}
            <Button type="submit" variant="hero" className="w-full" disabled={loading || !isAllowedEmail}>
              {loading ? "Loading..." : isSignUp ? "Create Account" : "Sign In"}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            className="text-primary hover:underline font-medium"
            onClick={() => setIsSignUp(!isSignUp)}
          >
            {isSignUp ? "Sign in" : "Sign up"}
          </button>
        </p>
      </div>
    </div>
  );
};

export default Auth;
