import { z } from "zod";
export const migrationOperations = [
  "crm:write",
  "sales:saveProperty",
  "sales:saveOpportunity",
  "sales:transition",
  "operations:create",
  "inventory:saveCategory",
  "inventory:saveLocation",
  "inventory:saveProduct",
  "inventory:receive",
  "commercial:saveCustomer",
  "commercial:saveInvoice",
  "commercial:invoiceAction",
  "commercial:recordPayment",
  "communications:saveSettings",
] as const;
export const migrationRow = z.strictObject({
  stable_id: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),
  operation: z.enum(migrationOperations),
  args: z.record(z.string(), z.unknown()),
});
export const migrationPackage = z.strictObject({
  version: z.literal(1),
  key: z.string().regex(/^[a-z0-9-]{1,80}$/),
  source_type: z.literal("fictional-development-command-package"),
  source_sha: z.string().regex(/^[a-f0-9]{40}$/),
  transform_version: z.literal(1),
  staff: z.record(
    z.string().regex(/^[a-z][a-z0-9_-]*$/),
    z.string().min(1).max(64),
  ),
  rows: z.array(migrationRow).min(1).max(100),
});
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function validatePackage(input: string) {
  if (input.length > 200000) throw Error("MIGRATION_PACKAGE_TOO_LARGE");
  const data = migrationPackage.parse(JSON.parse(input));
  const known = new Set(Object.keys(data.staff));
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    if ("$ref" in value) {
      const ref = z.strictObject({ $ref: z.string() }).parse(value).$ref;
      if (!known.has(ref)) throw Error("MISSING_PARENT");
      return;
    }
    for (const [k, v] of Object.entries(value)) {
      if (/password|secret|token|credential/i.test(k))
        throw Error("SECRET_IMPORT_FORBIDDEN");
      walk(v);
    }
  };
  for (const row of data.rows) {
    if (known.has(row.stable_id)) throw Error("DUPLICATE_STABLE_ID");
    walk(row.args);
    known.add(row.stable_id);
  }
  return data;
}
export function resolveReferences(
  value: unknown,
  known: Map<string, unknown>,
): unknown {
  if (Array.isArray(value))
    return value.map((v) => resolveReferences(v, known));
  if (!value || typeof value !== "object") return value;
  if ("$ref" in value) {
    const ref = z.strictObject({ $ref: z.string() }).parse(value).$ref;
    if (!known.has(ref)) throw Error("MISSING_PARENT");
    const result = known.get(ref);
    return result && typeof result === "object" && "id" in result
      ? result.id
      : result;
  }
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, resolveReferences(v, known)]),
  );
}
