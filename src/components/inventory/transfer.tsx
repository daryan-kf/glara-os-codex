"use client";
import { useState } from "react";
import { useConvex, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/operations/shared";
import { productInput } from "@/lib/inventory/model";
import { decimal } from "@/lib/sales/model";
import { buildXlsx, parseXlsx, parseCsv } from "@/lib/inventory/spreadsheet";
import { z } from "zod";
const columns = [
  "sku",
  "name",
  "category",
  "track_mode",
  "brand",
  "collection",
  "description",
  "color",
  "material",
  "dimensions",
  "weight",
  "purchase_price",
  "rental_price",
  "sale_price",
  "staging_eligible",
  "retail_eligible",
  "active",
] as const;
const importRow = productInput.extend({
  category: z.string().trim().min(1).max(80),
});
type ImportRow = z.infer<typeof importRow>;
function flag(value: string, fallback: boolean) {
  const v = value.trim().toLowerCase();
  if (["yes", "true", "1", "y"].includes(v)) return true;
  if (["no", "false", "0", "n"].includes(v)) return false;
  return fallback;
}
function price(value: string) {
  const v = value.trim().replace(/^\$/, "").replaceAll(",", "");
  if (!v) return "";
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : v;
}
function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(
    new Blob([bytes as unknown as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
function mapRows(table: string[][]) {
  if (!table.length) return { rows: [], errors: ["The file is empty."] };
  const headers = table[0].map((h) => h.trim().toLowerCase());
  for (const required of ["sku", "name", "category"])
    if (!headers.includes(required))
      return {
        rows: [],
        errors: [`Missing required column "${required}". Use the template.`],
      };
  const cell = (row: string[], key: string) => {
    const index = headers.indexOf(key);
    return index < 0 ? "" : (row[index] ?? "").trim();
  };
  const rows: ImportRow[] = [];
  const errors: string[] = [];
  table.slice(1).forEach((raw, i) => {
    if (raw.every((value) => !value.trim())) return;
    const candidate = {
      sku: cell(raw, "sku"),
      name: cell(raw, "name"),
      category: cell(raw, "category"),
      track_mode:
        cell(raw, "track_mode").toLowerCase() === "quantity"
          ? "quantity"
          : "serialized",
      brand: cell(raw, "brand"),
      collection: cell(raw, "collection"),
      description: cell(raw, "description"),
      color: cell(raw, "color"),
      material: cell(raw, "material"),
      dimensions: cell(raw, "dimensions"),
      weight: cell(raw, "weight"),
      purchase_price: price(cell(raw, "purchase_price")),
      rental_price: price(cell(raw, "rental_price")),
      sale_price: price(cell(raw, "sale_price")),
      staging_eligible: flag(cell(raw, "staging_eligible"), true),
      retail_eligible: flag(cell(raw, "retail_eligible"), false),
      active: flag(cell(raw, "active"), true),
    };
    const parsed = importRow.safeParse(candidate);
    if (parsed.success) rows.push(parsed.data);
    else
      errors.push(
        `Row ${i + 2}: ${parsed.error.issues
          .map((issue) => issue.path.join(".") + " — " + issue.message)
          .join("; ")}`,
      );
  });
  if (!rows.length && !errors.length)
    errors.push("No product rows found under the header row.");
  return { rows, errors };
}
export function CatalogTransfer() {
  const convex = useConvex();
  const importProducts = useMutation(api.inventory.importProducts);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [errors, setErrors] = useState<string[]>([]),
    [pending, setPending] = useState<ImportRow[]>([]);
  async function exportCatalog() {
    setBusy(true);
    setMessage("");
    setErrors([]);
    try {
      const data: string[][] = [[...columns, "available_units"]];
      let cursor: string | null = null;
      for (;;) {
        const page: FunctionReturnType<typeof api.inventory.exportCatalog> =
          await convex.query(api.inventory.exportCatalog, { cursor });
        for (const r of page.rows)
          data.push([
            r.sku,
            r.name,
            r.category,
            r.track_mode,
            r.brand,
            r.collection,
            r.description,
            r.color,
            r.material,
            r.dimensions,
            r.weight,
            r.purchase_price_cents ? decimal(r.purchase_price_cents) : "",
            r.rental_price_cents ? decimal(r.rental_price_cents) : "",
            r.sale_price_cents ? decimal(r.sale_price_cents) : "",
            r.staging_eligible ? "yes" : "no",
            r.retail_eligible ? "yes" : "no",
            r.active ? "yes" : "no",
            String(r.available_units) + (r.partial ? "+" : ""),
          ]);
        if (page.done) break;
        cursor = page.cursor;
      }
      download(
        `glara-inventory-${new Date().toISOString().slice(0, 10)}.xlsx`,
        buildXlsx(data),
      );
      setMessage(`Exported ${data.length - 1} products.`);
    } catch {
      setErrors(["Export failed. Try again."]);
    } finally {
      setBusy(false);
    }
  }
  function template() {
    download(
      "glara-inventory-template.xlsx",
      buildXlsx([
        [...columns],
        [
          "SOFA-001",
          "Linen sofa",
          "Sofas",
          "serialized",
          "BrandName",
          "Spring collection",
          "Three-seat linen sofa",
          "Ivory",
          "Linen",
          "220 × 95 × 85 cm",
          "48 kg",
          "1200.00",
          "150.00",
          "1800.00",
          "yes",
          "no",
          "yes",
        ],
      ]),
    );
  }
  async function pick(file: File) {
    setBusy(true);
    setMessage("");
    setErrors([]);
    setPending([]);
    try {
      const table = file.name.toLowerCase().endsWith(".csv")
        ? parseCsv(await file.text())
        : await parseXlsx(new Uint8Array(await file.arrayBuffer()));
      const mapped = mapRows(table);
      setErrors(mapped.errors.slice(0, 20));
      setPending(mapped.errors.length ? [] : mapped.rows);
      if (!mapped.errors.length)
        setMessage(
          `${mapped.rows.length} products ready to import from ${file.name}.`,
        );
    } catch {
      setErrors([
        "Could not read this file. Save it as .xlsx or .csv and try again.",
      ]);
    } finally {
      setBusy(false);
    }
  }
  async function runImport() {
    setBusy(true);
    setMessage("");
    try {
      let created = 0,
        updated = 0;
      for (let i = 0; i < pending.length; i += 100) {
        const result = await importProducts({
          input: JSON.stringify(pending.slice(i, i + 100)),
        });
        created += result.created;
        updated += result.updated;
      }
      setPending([]);
      setMessage(
        `Import complete: ${created} created, ${updated} updated by SKU.`,
      );
    } catch {
      setErrors([
        "Import was rejected by the server. Earlier batches may have been applied; fix the file and re-import — rows are matched by SKU.",
      ]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Import & export (Excel)">
      <p className="mb-4 text-sm text-muted-foreground">
        Export the catalog as an Excel workbook, or bulk-import products from an
        .xlsx or .csv sheet. Rows are matched by SKU: new SKUs are created,
        existing SKUs are updated. Missing categories are created automatically.
        Prices are CAD.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={busy} onClick={exportCatalog}>
          Export catalog (.xlsx)
        </Button>
        <Button type="button" variant="outline" onClick={template}>
          Download import template
        </Button>
        <label className="inline-flex">
          <span className="sr-only">Choose spreadsheet</span>
          <input
            type="file"
            accept=".xlsx,.csv"
            disabled={busy}
            className="text-sm file:mr-3 file:rounded-lg file:border file:bg-card file:px-4 file:py-2"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pick(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {pending.length > 0 && (
        <div className="mt-4 rounded-xl border p-4">
          <p className="mb-3 text-sm">
            Ready to import {pending.length} products (
            {pending
              .slice(0, 3)
              .map((r) => r.sku)
              .join(", ")}
            {pending.length > 3 ? ", …" : ""}).
          </p>
          <Button type="button" disabled={busy} onClick={runImport}>
            {busy ? "Importing…" : `Import ${pending.length} products`}
          </Button>
        </div>
      )}
      <div aria-live="polite" className="mt-4 space-y-2">
        {message && (
          <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm">
            {message}
          </p>
        )}
        {errors.map((error) => (
          <p
            role="alert"
            key={error}
            className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        ))}
      </div>
    </Panel>
  );
}
