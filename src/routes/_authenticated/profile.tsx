import { createFileRoute, redirect } from "@tanstack/react-router";

// Profile was folded into Settings, which also holds account details, theme and
// sign-out. Kept as a route so bookmarks and old links still land somewhere.
export const Route = createFileRoute("/_authenticated/profile")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", replace: true });
  },
});
