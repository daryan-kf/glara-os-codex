"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpen, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canAccess, modules, type Role } from "@/lib/permissions";
import { guideSections, searchGuide } from "@/lib/help/guide";

export function UserGuide({ roles }: { roles: Role[] }) {
  const [query, setQuery] = useState("");
  const matches = searchGuide(query);
  const visibleIds = new Set(matches.map((section) => section.id));

  return (
    <div
      lang="fa"
      dir="rtl"
      className="mx-auto max-w-5xl space-y-7 text-start [font-family:Tahoma,Arial,sans-serif]"
    >
      <header id="guide-top" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
            <BookOpen aria-hidden="true" className="size-4" />
            مرکز راهنمای Glara OS
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
            className="print:hidden"
          >
            <Printer aria-hidden="true" />
            چاپ راهنمای کامل
          </Button>
        </div>
        <h1 className="text-3xl font-semibold leading-relaxed sm:text-4xl">
          راهنمای کاربران
        </h1>
        <p className="max-w-3xl text-base leading-8 text-muted-foreground">
          از اولین تماس تا جمع‌آوری وسایل و تسویه؛ مراحل کار را با نام دقیق
          بخش‌ها و دکمه‌های برنامه دنبال کنید. برای شروع، موضوع موردنیازتان را
          جست‌وجو کنید یا فهرست فصل‌ها را باز کنید.
        </p>
      </header>
      <section
        aria-label="جست‌وجوی راهنما"
        className="space-y-4 rounded-2xl border bg-card p-5 print:hidden sm:p-6"
      >
        <label htmlFor="guide-search" className="block text-sm font-semibold">
          جست‌وجو در راهنما؛ فارسی یا نام انگلیسی بخش
        </label>
        <div className="flex items-center gap-3 rounded-xl border bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
          <Search
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground"
          />
          <input
            id="guide-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="مثلاً تمدید، Staged، فاکتور یا موجودی"
            className="min-h-12 w-full min-w-0 bg-transparent text-base outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            موضوع‌های پرکاربرد:
          </span>
          {[
            ["پروژه‌های استیج‌شده", "پروژه‌های استیج‌شده"],
            ["موعد تمدید", "موعد پایان پکیج"],
            ["وسایل و انبار", "وسایل"],
            ["پرداخت‌ها", "دریافت وجه"],
          ].map(([label, value]) => (
            <Button
              key={value}
              type="button"
              variant="outline"
              onClick={() => setQuery(value)}
            >
              {label}
            </Button>
          ))}
          {query && (
            <Button type="button" variant="ghost" onClick={() => setQuery("")}>
              پاک کردن جست‌وجو
            </Button>
          )}
        </div>
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          {matches.length.toLocaleString("fa-CA")} فصل از{" "}
          {guideSections.length.toLocaleString("fa-CA")} فصل
        </p>
      </section>
      {matches.length > 0 && (
        <details className="rounded-2xl border bg-card p-5 print:hidden">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">
            فهرست فصل‌ها
          </summary>
          <nav
            aria-label="فهرست راهنمای کاربران"
            className="mt-3 grid gap-2 sm:grid-cols-2"
          >
            {matches.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-lg px-3 py-3 text-sm leading-6 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {section.title}
              </a>
            ))}
          </nav>
        </details>
      )}
      {matches.length === 0 && (
        <div className="rounded-2xl border p-8 text-center print:hidden">
          <h2 className="text-xl font-semibold">موضوعی پیدا نشد</h2>
          <p className="my-4 leading-7 text-muted-foreground">
            واژه کوتاه‌تر یا نام انگلیسی بخش را امتحان کنید؛ مثلاً تمدید یا
            Extension.
          </p>
          <Button type="button" variant="outline" onClick={() => setQuery("")}>
            نمایش همه فصل‌ها
          </Button>
        </div>
      )}
      <div className="space-y-6">
        {guideSections.map((section, index) => (
          <section
            id={section.id}
            key={section.id}
            aria-labelledby={`${section.id}-title`}
            className={`${visibleIds.has(section.id) ? "block" : "hidden"} scroll-mt-24 rounded-2xl border bg-card p-5 print:block print:rounded-none print:border-0 sm:p-7`}
          >
            <div className="mb-4 flex items-start gap-3">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary"
                aria-hidden="true"
              >
                {(index + 1).toLocaleString("fa-CA")}
              </span>
              <div>
                <h2
                  id={`${section.id}-title`}
                  className="text-xl font-semibold leading-9"
                >
                  {section.title}
                </h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  {section.summary}
                </p>
              </div>
            </div>
            <ol className="list-decimal space-y-3 ps-6 text-sm leading-8 marker:font-semibold marker:text-primary sm:text-base">
              {section.steps.map((step) => (
                <li key={step} className="break-words ps-1">
                  {step}
                </li>
              ))}
            </ol>
            {section.note && (
              <p className="mt-5 rounded-xl border-s-4 border-primary bg-muted p-4 text-sm leading-8">
                <strong className="font-semibold">یادآوری: </strong>
                {section.note}
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4 print:hidden">
              {section.module && canAccess(roles, section.module) ? (
                <Link
                  href={`/${section.module}`}
                  className="rounded-lg px-2 py-3 text-sm font-semibold text-primary hover:underline focus-visible:outline-2"
                >
                  رفتن به <bdi>{modules[section.module].title}</bdi>
                </Link>
              ) : (
                <span className="text-xs leading-6 text-muted-foreground">
                  اقدام‌ها تابع نقش و دسترسی شما هستند.
                </span>
              )}
              <a
                href="#guide-top"
                className="rounded-lg px-2 py-3 text-sm text-muted-foreground hover:underline focus-visible:outline-2"
              >
                بازگشت به بالای راهنما
              </a>
            </div>
          </section>
        ))}
      </div>
      <p className="text-sm leading-7 text-muted-foreground">
        این راهنما اطلاعات مشتریان یا وضعیت زنده سرویس‌ها را نمایش نمی‌دهد. برای
        تصمیم عملیاتی، وضعیت فعلی پرونده و پیام‌های داخل برنامه را ملاک قرار
        دهید.
      </p>
    </div>
  );
}
