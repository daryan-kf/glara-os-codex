"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  TrendingUp,
  House,
  Layers,
  CalendarDays,
  Armchair,
  FileText,
  CreditCard,
  Megaphone,
  ChartNoAxesCombined,
  Bell,
  Settings,
  UserRound,
  Menu,
  Search,
  Plus,
  ArrowUpRight,
  LogOut,
  Check,
} from "lucide-react";
import { modules, canAccess, type Module, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { logout } from "@/app/auth/actions";
import { Avatar } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
const icons = {
  dashboard: LayoutDashboard,
  realtors: Users,
  opportunities: TrendingUp,
  properties: House,
  projects: Layers,
  calendar: CalendarDays,
  inventory: Armchair,
  quotes: FileText,
  payments: CreditCard,
  marketing: Megaphone,
  reports: ChartNoAxesCombined,
  notifications: Bell,
  settings: Settings,
  profile: UserRound,
};
type Identity = { name: string; roles: Role[]; email: string };
function Navigation({ roles, close }: { roles: Role[]; close?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main navigation" className="space-y-1">
      {(Object.keys(modules) as Module[])
        .filter((module) => canAccess(roles, module))
        .map((module) => {
          const Icon = icons[module];
          return (
            <Link
              key={module}
              href={`/${module}`}
              onClick={close}
              aria-current={path === `/${module}` ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                path === `/${module}` &&
                  "bg-primary/10 font-semibold text-primary",
                module === "notifications" && "mt-6 border-t pt-4",
              )}
            >
              <Icon className="size-[18px]" />
              {modules[module].title}
            </Link>
          );
        })}
    </nav>
  );
}
function SearchShell({ roles }: { roles: Role[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const results = (Object.keys(modules) as Module[]).filter(
    (module) =>
      canAccess(roles, module) &&
      modules[module].title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          aria-label="Search workspace"
          className="text-muted-foreground"
        >
          <Search />
          <span className="hidden md:inline">Search workspace</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          Search workspace
        </DialogTitle>
        <DialogDescription className="mb-5 mt-2 text-sm text-muted-foreground">
          Find a module. Record search will arrive with CRM.
        </DialogDescription>
        <label htmlFor="global-search" className="sr-only">
          Search modules
        </label>
        <input
          id="global-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-12 w-full rounded-lg border px-3 focus-visible:outline-2"
          placeholder="Where would you like to go?"
        />
        <div className="mt-3 max-h-72 overflow-auto">
          {results.map((module) => (
            <Link
              key={module}
              href={`/${module}`}
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center justify-between rounded-lg p-3 text-sm hover:bg-muted"
            >
              {modules[module].title}
              <ArrowUpRight className="size-4" />
            </Link>
          ))}
          {!results.length && (
            <p className="p-4 text-sm text-muted-foreground">
              No matching modules.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
function QuickCreate() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          <span>New</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          A place for every new beginning
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-6 text-muted-foreground">
          Quick create will become available as each module launches. Your
          workspace is currently in its foundation phase.
        </DialogDescription>
        <div className="mt-6 grid grid-cols-2 gap-2">
          {[
            "Realtor",
            "Opportunity",
            "Property",
            "Consultation",
            "Quote",
            "Project",
            "Task",
          ].map((label) => (
            <div
              key={label}
              className="rounded-lg border p-3 text-sm text-muted-foreground"
            >
              {label}
              <span className="mt-1 block text-xs">Coming later</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
function SignOut() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground"
        >
          <LogOut />
          Sign out
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          Sign out of Glara OS?
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          You can sign back in whenever you’re ready.
        </DialogDescription>
        <div className="mt-6 flex justify-end gap-3">
          <DialogClose asChild>
            <Button variant="outline">Stay here</Button>
          </DialogClose>
          <form action={logout}>
            <Button>Sign out</Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function Shell({
  user,
  children,
}: {
  user: Identity;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-svh">
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-lg bg-card p-4 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r bg-card px-5 py-7 lg:flex">
        <Link
          href="/dashboard"
          className="mb-9 px-3 text-2xl font-semibold tracking-[.16em]"
        >
          GLARA{" "}
          <span className="text-xs font-normal tracking-normal text-muted-foreground">
            OS
          </span>
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Navigation roles={user.roles} />
        </div>
        <div className="mt-5 border-t pt-4">
          <SignOut />
          <p className="mt-3 px-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Glara Home Staging
          </p>
        </div>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-20 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur-sm sm:px-8">
          <div className="flex items-center gap-2">
            <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Open navigation"
                  className="lg:hidden"
                >
                  <Menu />
                </Button>
              </DialogTrigger>
              <DialogContent className="left-0 top-0 h-svh max-w-xs translate-x-0 translate-y-0 overflow-auto rounded-none">
                <DialogTitle className="mb-6 text-xl tracking-widest">
                  GLARA OS
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Workspace navigation
                </DialogDescription>
                <Navigation
                  roles={user.roles}
                  close={() => setMobileOpen(false)}
                />
                <div className="mt-6">
                  <SignOut />
                </div>
              </DialogContent>
            </Dialog>
            <span className="hidden text-xs font-medium text-muted-foreground xl:inline">
              WORKSPACE
            </span>
            <SearchShell roles={user.roles} />
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <QuickCreate />
            <Link
              href="/notifications"
              aria-label="Notifications"
              className="flex size-11 items-center justify-center rounded-lg hover:bg-muted"
            >
              <Bell className="size-5" />
            </Link>
            <Link
              href="/profile"
              aria-label="Your profile"
              className="flex items-center gap-3"
            >
              <Avatar name={user.name} />
              <span className="hidden text-sm sm:block">
                {user.name}
                <span className="block text-xs capitalize text-muted-foreground">
                  {user.roles.join(", ").replaceAll("_", " ")}
                </span>
              </span>
            </Link>
          </div>
        </header>
        <main
          id="main-content"
          className="mx-auto max-w-[1440px] p-5 pb-28 sm:p-8 lg:p-12"
        >
          {children}
        </main>
        <footer className="mx-8 hidden items-center justify-between border-t py-5 text-xs text-muted-foreground lg:flex">
          <span>Glara Home Staging · Metro Vancouver</span>
          <span className="flex items-center gap-1.5">
            <Check className="size-3" />
            Private workspace
          </span>
        </footer>
        <nav
          aria-label="Mobile quick navigation"
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          {(["dashboard", "calendar", "profile"] as const).map((module) => {
            const Icon = icons[module];
            return (
              canAccess(user.roles, module) && (
                <Link
                  key={module}
                  href={`/${module}`}
                  className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs"
                >
                  <Icon className="size-5" />
                  {module === "dashboard" ? "Today" : modules[module].title}
                </Link>
              )
            );
          })}
        </nav>
      </div>
    </div>
  );
}
