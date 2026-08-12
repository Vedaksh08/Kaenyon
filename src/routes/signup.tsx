import { createFileRoute, redirect } from "@tanstack/react-router";

// Sign-up and sign-in are the same door now: entering an email either creates
// the account or signs you back in. Kept as a route so old links still work.
export const Route = createFileRoute("/signup")({
  beforeLoad: () => {
    throw redirect({ to: "/login", replace: true });
  },
});
