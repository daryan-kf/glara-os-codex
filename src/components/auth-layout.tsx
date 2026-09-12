import { ArrowUpRight } from "lucide-react";
export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-primary p-14 text-primary-foreground lg:flex">
        <div className="text-2xl font-semibold tracking-[.18em]">
          GLARA{" "}
          <span className="text-sm font-normal tracking-normal opacity-60">
            OS
          </span>
        </div>
        <div className="absolute -right-36 top-24 size-[600px] rounded-full border border-white/10" />
        <div className="absolute -right-16 top-44 size-[440px] rounded-full border border-white/10" />
        <div className="relative max-w-md">
          <span className="mb-8 inline-flex rounded-full border border-white/25 p-3">
            <ArrowUpRight className="size-6" />
          </span>
          <h2 className="font-display text-5xl leading-tight">
            Beautiful spaces.
            <br />
            <span className="text-[#d5c5a7]">Thoughtful operations.</span>
          </h2>
          <p className="mt-6 max-w-sm leading-7 text-white/65">
            One connected workspace for the people behind Glara Home Staging.
          </p>
        </div>
        <p className="text-xs tracking-widest text-white/50">
          METRO VANCOUVER · BRITISH COLUMBIA
        </p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <p className="mb-12 text-xl font-semibold tracking-widest lg:hidden">
            GLARA OS
          </p>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
            Private team workspace
          </p>
          <h1 className="font-display text-3xl">{title}</h1>
          <p className="mb-8 mt-3 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          {children}
          <p className="mt-10 text-xs text-muted-foreground">
            Glara Home Staging · Access by invitation only
          </p>
        </div>
      </section>
    </main>
  );
}
