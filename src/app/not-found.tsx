import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg p-12">
      <h1 className="font-display text-3xl">This page isn’t here.</h1>
      <p className="my-5 text-muted-foreground">The link may have changed.</p>
      <Link href="/dashboard" className="underline">
        Back to your workspace
      </Link>
    </main>
  );
}
