import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login" });
    }
    // Suspension check
    const { data: prof } = await supabase
      .from("profiles")
      .select("suspended_until, name, college, course, year")
      .eq("id", data.user.id)
      .maybeSingle();
    if (prof?.suspended_until && new Date(prof.suspended_until).getTime() > Date.now()) {
      throw redirect({ to: "/suspended" });
    }

    // First sign-in after email verification: copy signup details onto the profile
    const meta = (data.user.user_metadata ?? {}) as Record<string, string | undefined>;
    if (prof && !prof.college && (meta.college || meta.name)) {
      await supabase
        .from("profiles")
        .update({
          name: prof.name || meta.name || undefined,
          college: meta.college || undefined,
          course: meta.course || undefined,
          year: meta.year || undefined,
          email: data.user.email ?? undefined,
        })
        .eq("id", data.user.id);
    }

    return { user: data.user };
  },
  component: () => <Outlet />,
});
