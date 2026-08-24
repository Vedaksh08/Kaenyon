import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Users, Trophy, User, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Each tab owns one bar from the mark, so the active tab is coloured by the
 * brand rather than all four sharing a single blue. */
const TABS: Array<{ to: string; label: string; icon: LucideIcon; active: string }> = [
  { to: "/home", label: "Home", icon: Home, active: "text-brand-cyan" },
  { to: "/experts", label: "Friends", icon: Users, active: "text-brand-lime" },
  { to: "/ranks", label: "Ranks", icon: Trophy, active: "text-brand-amber" },
  { to: "/settings", label: "Profile", icon: User, active: "text-brand-violet" },
];

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (p: string) => pathname === p || pathname.startsWith(p + "/");

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
      <div className="mx-auto flex max-w-md">
        {TABS.map(({ to, label, icon: Icon, active }) => {
          const on = isActive(to);
          return (
            <Link
              key={to}
              to={to}
              aria-current={on ? "page" : undefined}
              className="group relative flex flex-1 flex-col items-center gap-1 pb-2 pt-2.5"
            >
              {/* The indicator sits on the border itself rather than under the
               * label, so the active tab reads at a glance on a small screen. */}
              <span
                className={cn(
                  "absolute inset-x-5 top-0 h-[3px] rounded-b-full transition-opacity",
                  on ? "opacity-100" : "opacity-0",
                  active.replace("text-", "bg-"),
                )}
              />
              <Icon
                className={cn(
                  "h-[22px] w-[22px] transition-colors",
                  on ? active : "text-muted-foreground group-hover:text-foreground",
                )}
                strokeWidth={on ? 2.4 : 1.9}
              />
              <span
                className={cn(
                  "text-[10px] font-bold uppercase tracking-wider transition-colors",
                  on ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
