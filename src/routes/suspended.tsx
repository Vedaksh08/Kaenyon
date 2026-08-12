import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/suspended")({
  head: () => ({
    meta: [
      { title: "Account Suspended — StudyAll" },
      {
        name: "description",
        content: "Your StudyAll account is temporarily suspended after moderation review.",
      },
      { property: "og:title", content: "Account Suspended — StudyAll" },
      {
        property: "og:description",
        content: "Your StudyAll account is temporarily suspended after moderation review.",
      },
    ],
  }),
  component: Suspended,
});

function Suspended() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-danger bg-danger/5 p-8 text-center shadow-card">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-danger/10">
          <AlertTriangle className="h-8 w-8 text-danger" />
        </div>
        <h1 className="mt-4 text-2xl font-extrabold text-danger">Account Suspended</h1>
        <p className="mt-3 text-sm text-foreground">
          Your account has been suspended until <span className="font-semibold">Dec 31, 2025</span>.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Reason: Repeated violations of the community guidelines.
        </p>
        <p className="mt-6 text-xs text-muted-foreground">
          If you believe this is a mistake, contact{" "}
          <a href="mailto:support@studyall.com" className="font-semibold text-primary">
            support@studyall.com
          </a>
        </p>
      </div>
    </div>
  );
}
