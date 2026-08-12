import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Users, Trophy, Settings } from "lucide-react";

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isActive = (p: string) => pathname === p || pathname.startsWith(p + "/");

  const itemCls = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-semibold tracking-wider ${
      active ? "text-primary" : "text-muted-foreground"
    }`;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-md">
        <Link to="/home" className={itemCls(isActive("/home"))}>
          <Home className="h-5 w-5" />
          HOME
        </Link>
        <Link to="/experts" className={itemCls(isActive("/experts"))}>
          <Users className="h-5 w-5" />
          FRIENDS
        </Link>
        <Link to="/ranks" className={itemCls(isActive("/ranks"))}>
          <Trophy className="h-5 w-5" />
          RANKS
        </Link>
        <Link to="/settings" className={itemCls(isActive("/settings"))}>
          <Settings className="h-5 w-5" />
          SETTINGS
        </Link>
      </div>
    </nav>
  );
}
