import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // getSession() reads the persisted session and refreshes it locally;
    // getUser() always calls the server, so a slow or offline network logged
    // people out despite holding a perfectly valid token.
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      throw redirect({ to: "/login" });
    }
    const data = { user };
    // Suspension check
    const { data: prof } = await supabase
      .from("profiles")
      .select("suspended_until, onboarded_at")
      .eq("id", data.user.id)
      .maybeSingle();
    if (prof?.suspended_until && new Date(prof.suspended_until).getTime() > Date.now()) {
      throw redirect({ to: "/suspended" });
    }

    // Sign-up collects nothing but an email, so details are gathered on first
    // sign-in instead. Everything behind this guard assumes a real name exists.
    if (!prof?.onboarded_at) {
      throw redirect({ to: "/onboarding" });
    }

    return { user: data.user };
  },
  component: () => <Outlet />,
});
