import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Sparkles, Loader2, LogIn, UserPlus } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Luminiq — Log in" },
      {
        name: "description",
        content: "Log in or sign up to Luminiq to manage your photo sorting sessions.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate({ to: "/" });
      } else {
        setChecking(false);
      }
    });
  }, [navigate]);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Enter both email and password");
      return;
    }
    setLoading(true);

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back!");
        navigate({ to: "/" });
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast.success("Check your email to confirm your account.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error(result.error.message || "Google sign-in failed");
      setLoading(false);
      return;
    }
    if (result.redirected) {
      // Browser is redirecting to Google.
      return;
    }
    // Tokens received and session already set.
    toast.success("Signed in with Google");
    navigate({ to: "/" });
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="bg-background">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-negative text-background">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="font-display text-lg uppercase tracking-[0.08em]">Luminiq</span>
          </Link>
        </div>
        <div className="filmstrip h-3 w-full" aria-hidden="true" />
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <Card className="w-full max-w-sm p-6 space-y-5 step-in border-border">
          <div className="text-center space-y-3">
            <div
              className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
                mode === "login"
                  ? "bg-primary/10 text-primary"
                  : "bg-loupe/10 text-loupe"
              }`}
            >
              {mode === "login" ? (
                <LogIn className="h-6 w-6" />
              ) : (
                <UserPlus className="h-6 w-6" />
              )}
            </div>
            <div className="space-y-1">
              <div className="frame-counter">{mode === "login" ? "F·LOGIN" : "F·NEW ACCOUNT"}</div>
              <h1 className="font-display text-2xl uppercase tracking-tight">
                {mode === "login"
                  ? "Welcome back"
                  : "Create your account"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {mode === "login"
                  ? "Log in to pick up where you left off."
                  : "Free to start — sort your first shoot in minutes."}
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={handleGoogle}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
            )}
            Continue with Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground frame-counter">or</span>
            </div>
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
              {mode === "signup" && (
                <p className="text-xs text-muted-foreground">
                  Use at least 8 characters. You'll get a confirmation email.
                </p>
              )}
            </div>
            <Button type="submit" className="w-full font-display uppercase tracking-wide" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : mode === "login" ? (
                <LogIn className="h-4 w-4 mr-2" />
              ) : (
                <UserPlus className="h-4 w-4 mr-2" />
              )}
              {mode === "login" ? "Log in to Luminiq" : "Create account"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
              className="font-medium text-primary hover:underline"
            >
              {mode === "login" ? "Sign up" : "Log in"}
            </button>
          </p>
        </Card>
      </main>
    </div>
  );
}
