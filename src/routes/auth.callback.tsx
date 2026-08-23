import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Verifying — Pathwaay" },
      { name: "description", content: "Verifying your Pathwaay email sign-in link." },
      { property: "og:title", content: "Verifying — Pathwaay" },
      { property: "og:description", content: "Verifying your Pathwaay email sign-in link." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthCallback,
});

function AuthCallback() {
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      nav({ to: "/home", replace: true });
    };

    const run = async () => {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
      const errDesc = url.searchParams.get("error_description") || hash.get("error_description");
      if (errDesc) {
        setError(errDesc);
        return;
      }

      // Already signed in (detectSessionInUrl may have handled it)
      const { data: existing } = await supabase.auth.getSession();
      if (existing.session) return finish();

      const code = url.searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setError(error.message);
          return;
        }
        return finish();
      }

      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) {
          setError(error.message);
          return;
        }
        return finish();
      }

      const token_hash = url.searchParams.get("token_hash") || hash.get("token_hash");
      const type = (url.searchParams.get("type") || hash.get("type") || "email") as
        "email" | "magiclink" | "signup" | "recovery" | "invite";
      if (token_hash) {
        const { error } = await supabase.auth.verifyOtp({ token_hash, type });
        if (error) {
          setError(error.message);
          return;
        }
        return finish();
      }

      setError("This verification link is invalid or has already been used.");
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) finish();
    });

    run();
    return () => sub.subscription.unsubscribe();
  }, [nav]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-card shadow-card p-8 text-center">
        <div className="inline-block border-[3px] border-double border-navy px-4 py-2">
          <div className="text-xl font-extrabold tracking-tight text-navy">PATHWAAY</div>
        </div>
        {error ? (
          <>
            <h1 className="mt-6 text-xl font-bold">Verification failed</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <button
              onClick={() => nav({ to: "/login", replace: true })}
              className="mt-6 w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Send a new link
            </button>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto mt-6 h-7 w-7 animate-spin text-primary" />
            <h1 className="mt-4 text-xl font-bold">Verifying your email…</h1>
            <p className="mt-2 text-sm text-muted-foreground">Hang tight, we're signing you in.</p>
          </>
        )}
      </div>
    </div>
  );
}
