import { damageTransitions } from "../src/lib/inventory/model";
import { cents } from "../src/lib/sales/model";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  action,
} from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { z } from "zod";
import { deny, requireRoles } from "./access";
import {
  now,
  stamps,
  revision,
  parse,
  isAdmin,
  touch,
  access as projectAccess,
} from "./operationsCore";
import {
  catalogUser,
  manager,
  projectUser,
  activeProduct,
  activeLocation,
  projectLines,
  productLines,
  assetLines,
  balance,
  movement,
  available,
  removable,
  splitLine,
  audit,
} from "./inventoryCore";
import {
  conditions,
  assetStates,
  locationTypes,
  productInput,
  quantity,
  day,
  windowSchema,
  usable,
  readiness,
  stockStates,
} from "../src/lib/inventory/model";
import type { Doc, Id } from "./_generated/dataModel";
const conditionValue = v.union(...conditions.map((s) => v.literal(s)));
const emptyMovement = {
  asset_id: null,
  from_location_id: null,
  to_location_id: null,
  project_id: null,
  project_room_id: null,
  reservation_id: null,
  stock_deltas: [],
};

export const options = query({
  args: {},
  handler: async (ctx) => {
    const u = await catalogUser(ctx);
    const [categories, locations] = await Promise.all([
      ctx.db
        .query("inventory_categories")
        .withIndex("by_active", (q) => q.eq("active", true))
        .take(101),
      ctx.db
        .query("inventory_locations")
        .withIndex("by_active", (q) => q.eq("active", true))
        .take(101),
    ]);
    return {
      manage: isAdmin(u),
      categories: categories.filter((r) => !r.deleted_at),
      locations: locations.filter((r) => !r.deleted_at),
      partial: categories.length > 100 || locations.length > 100,
    };
  },
});
// Small reference records are streamed in bounded pages, never silently truncated.
export const categoryOptionsPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await catalogUser(ctx);
    const page = await ctx.db
      .query("inventory_categories")
      .withIndex("by_active", (q) => q.eq("active", true))
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(100, args.paginationOpts.numItems),
      });
    return { ...page, page: page.page.filter((row) => !row.deleted_at) };
  },
});
export const locationOptionsPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    project_id: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    if (args.project_id) await projectUser(ctx, args.project_id);
    else await catalogUser(ctx);
    const page = await ctx.db
      .query("inventory_locations")
      .withIndex("by_active", (q) => q.eq("active", true))
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(100, args.paginationOpts.numItems),
      });
    return {
      ...page,
      page: page.page
        .filter((row) => !row.deleted_at)
        .map((row) => ({
          _id: row._id,
          name: row.name,
          staging_source: row.staging_source,
          retail_source: row.retail_source,
        })),
    };
  },
});
export const saveCategory = mutation({
  args: {
    id: v.optional(v.id("inventory_categories")),
    version: v.number(),
    name: v.string(),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const u = await manager(ctx),
      name = parse(z.string().trim().min(1).max(80), JSON.stringify(args.name)),
      key = name.toLowerCase();
    const duplicate = await ctx.db
      .query("inventory_categories")
      .withIndex("by_name", (q) => q.eq("name_key", key))
      .unique();
    if (duplicate && duplicate._id !== args.id)
      deny("DUPLICATE", "Category name already exists.");
    const row = args.id ? await ctx.db.get(args.id) : null;
    if (args.id && !row) deny("UNAVAILABLE");
    if (row) {
      revision(row, args.version);
      if (
        !args.active &&
        (await ctx.db
          .query("products")
          .withIndex("by_category", (q) =>
            q.eq("category_id", row._id).eq("deleted_at", null),
          )
          .first())
      )
        deny("DEPENDENCY", "Category has products.");
      await ctx.db.patch(row._id, {
        name,
        name_key: key,
        active: args.active,
        updated_at: now(),
        version: row.version + 1,
      });
    }
    const id =
      row?._id ??
      (await ctx.db.insert("inventory_categories", {
        name,
        name_key: key,
        active: args.active,
        version: 1,
        ...stamps(),
      }));
    await audit(
      ctx,
      u.userId,
      id,
      "category_saved",
      row ? { name: row.name, active: row.active } : null,
      { name, active: args.active },
    );
    return id;
  },
});
export const saveLocation = mutation({
  args: {
    id: v.optional(v.id("inventory_locations")),
    version: v.number(),
    input: v.string(),
  },
  handler: async (ctx, args) => {
    const u = await manager(ctx),
      data = parse(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            type: z.enum(locationTypes),
            address: z.string().trim().max(300),
            active: z.boolean(),
            staging_source: z.boolean(),
            retail_source: z.boolean(),
          })
          .strict(),
        args.input,
      );
    const key = data.name.toLowerCase(),
      duplicate = await ctx.db
        .query("inventory_locations")
        .withIndex("by_name", (q) => q.eq("name_key", key))
        .unique();
    if (duplicate && duplicate._id !== args.id)
      deny("DUPLICATE", "Location already exists.");
    const row = args.id ? await ctx.db.get(args.id) : null;
    if (args.id && !row) deny("UNAVAILABLE");
    if (row) {
      revision(row, args.version);
      if (
        (!data.active || !data.staging_source) &&
        (row.active || row.staging_source)
      ) {
        const stock = await ctx.db
          .query("inventory_stock")
          .withIndex("by_location", (q) => q.eq("location_id", row._id))
          .take(101);
        const liveAssets = await Promise.all(
          assetStates
            .filter((status) => !["sold", "retired"].includes(status))
            .map((status) =>
              ctx.db
                .query("inventory_assets")
                .withIndex("by_location", (q) =>
                  q.eq("location_id", row._id).eq("status", status),
                )
                .first(),
            ),
        );
        const reservation = await ctx.db
          .query("inventory_reservations")
          .withIndex("by_location", (q) =>
            q.eq("location_id", row._id).eq("active", true),
          )
          .first();
        if (
          stock.length > 100 ||
          stock.some(
            (s) =>
              s.available +
                s.inspection +
                s.cleaning +
                s.repair +
                s.damaged +
                s.missing >
              0,
          ) ||
          liveAssets.some(Boolean) ||
          reservation
        )
          deny(
            "DEPENDENCY",
            "Move or reconcile inventory before disabling this location.",
          );
      }
      await ctx.db.patch(row._id, {
        ...data,
        name_key: key,
        updated_at: now(),
        version: row.version + 1,
      });
    }
    const id =
      row?._id ??
      (await ctx.db.insert("inventory_locations", {
        ...data,
        name_key: key,
        version: 1,
        ...stamps(),
      }));
    await audit(
      ctx,
      u.userId,
      id,
      "location_saved",
      row ? { version: row.version } : null,
      { name: data.name, active: data.active },
    );
    return id;
  },
});
export const saveProduct = mutation({
  args: {
    id: v.optional(v.id("products")),
    version: v.number(),
    category_id: v.id("inventory_categories"),
    input: v.string(),
  },
  handler: async (ctx, args) => {
    const u = await manager(ctx),
      data = parse(productInput, args.input),
      c = await ctx.db.get(args.category_id);
    if (!c || c.deleted_at || !c.active)
      deny("INVALID_INPUT", "Choose an active category.");
    const sameSku = await ctx.db
      .query("products")
      .withIndex("by_sku", (q) => q.eq("sku", data.sku).eq("deleted_at", null))
      .unique();
    if (sameSku && sameSku._id !== args.id)
      deny("DUPLICATE", "SKU already exists.");
    const row = args.id ? await ctx.db.get(args.id) : null;
    if (args.id && (!row || row.deleted_at)) deny("UNAVAILABLE");
    if (row) {
      revision(row, args.version);
      const existingMovement = await ctx.db
        .query("inventory_movements")
        .withIndex("by_product", (q) => q.eq("product_id", row._id))
        .first();
      if (row.track_mode !== data.track_mode && existingMovement)
        deny(
          "DEPENDENCY",
          "Tracking mode cannot change after inventory history exists.",
        );
      if (
        (!data.active || !data.staging_eligible) &&
        (await productLines(ctx, row._id)).length
      )
        deny(
          "DEPENDENCY",
          "Resolve reservations before disabling this product.",
        );
    }
    const { purchase_price, rental_price, sale_price, ...details } = data;
    const fields = {
      ...details,
      // Exact CAD cents; an empty input clears the stored price.
      purchase_price_cents: purchase_price
        ? String(cents(purchase_price))
        : undefined,
      rental_price_cents: rental_price
        ? String(cents(rental_price))
        : undefined,
      sale_price_cents: sale_price ? String(cents(sale_price)) : undefined,
      category_id: args.category_id,
      search_text: [
        data.sku,
        data.name,
        data.brand,
        data.collection,
        data.color,
        data.material,
      ].join(" "),
    };
    const id =
      row?._id ??
      (await ctx.db.insert("products", { ...fields, version: 1, ...stamps() }));
    if (row)
      await ctx.db.patch(id, {
        ...fields,
        version: row.version + 1,
        updated_at: now(),
      });
    await audit(
      ctx,
      u.userId,
      id,
      "product_saved",
      row
        ? {
            sku: row.sku,
            version: row.version,
            purchase_price_cents: row.purchase_price_cents ?? null,
            rental_price_cents: row.rental_price_cents ?? null,
            sale_price_cents: row.sale_price_cents ?? null,
          }
        : null,
      {
        sku: data.sku,
        active: data.active,
        purchase_price_cents: fields.purchase_price_cents ?? null,
        rental_price_cents: fields.rental_price_cents ?? null,
        sale_price_cents: fields.sale_price_cents ?? null,
      },
    );
    return id;
  },
});
const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const imageUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await manager(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});
export const attachProductImage = mutation({
  args: { product_id: v.id("products"), storage_id: v.id("_storage") },
  handler: async (ctx, args): Promise<{ ok: boolean; message?: string }> => {
    const u = await manager(ctx);
    const p = await ctx.db.get(args.product_id);
    // Throwing would roll back the blob cleanup, so refusals are returned
    // as values and the rejected upload is deleted in the same transaction.
    const reject = async (message: string) => {
      await ctx.storage.delete(args.storage_id);
      return { ok: false, message };
    };
    if (!p || p.deleted_at) return reject("Product unavailable.");
    const metadata = await ctx.db.system.get(args.storage_id);
    if (!metadata || !imageTypes.includes(metadata.contentType ?? ""))
      return reject("Upload a JPEG, PNG, WebP or GIF image.");
    if (metadata.size > 5 * 1024 * 1024)
      return reject("Images must be 5 MB or smaller.");
    const images = p.image_ids ?? [];
    if (images.includes(args.storage_id)) return { ok: true };
    if (images.length >= 6) return reject("A product holds up to 6 photos.");
    await ctx.db.patch(p._id, {
      image_ids: [...images, args.storage_id],
      updated_at: now(),
    });
    await audit(ctx, u.userId, p._id, "product_image_added", null, {
      sku: p.sku,
      images: images.length + 1,
    });
    return { ok: true };
  },
});
export const removeProductImage = mutation({
  args: { product_id: v.id("products"), storage_id: v.id("_storage") },
  handler: async (ctx, args) => {
    const u = await manager(ctx);
    const p = await ctx.db.get(args.product_id);
    if (!p) return deny("UNAVAILABLE");
    const images = p.image_ids ?? [];
    if (!images.includes(args.storage_id))
      return deny("INVALID_INPUT", "Photo is not attached to this product.");
    await ctx.db.patch(p._id, {
      image_ids: images.filter((id) => id !== args.storage_id),
      updated_at: now(),
    });
    await ctx.storage.delete(args.storage_id);
    await audit(ctx, u.userId, p._id, "product_image_removed", null, {
      sku: p.sku,
      images: images.length - 1,
    });
    return null;
  },
});
export const imageImportContext = internalQuery({
  args: { sku: v.string() },
  handler: async (ctx, args) => {
    await manager(ctx);
    const p = await ctx.db
      .query("products")
      .withIndex("by_sku", (q) => q.eq("sku", args.sku).eq("deleted_at", null))
      .unique();
    return p ? { id: p._id, images: (p.image_ids ?? []).length } : null;
  },
});
// The importing action validated the fetched response's type and size before
// storing, so this trusted finish step only enforces product state and limits.
export const finishImageImport = internalMutation({
  args: {
    product_id: v.id("products"),
    storage_id: v.id("_storage"),
    source_url: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; message?: string }> => {
    const u = await manager(ctx);
    const p = await ctx.db.get(args.product_id);
    const reject = async (message: string) => {
      await ctx.storage.delete(args.storage_id);
      return { ok: false, message };
    };
    if (!p || p.deleted_at) return reject("Product unavailable.");
    const images = p.image_ids ?? [];
    if (images.length >= 6) return reject("photo limit reached");
    await ctx.db.patch(p._id, {
      image_ids: [...images, args.storage_id],
      updated_at: now(),
    });
    await audit(ctx, u.userId, p._id, "product_image_imported", null, {
      sku: p.sku,
      url: args.source_url,
      images: images.length + 1,
    });
    return { ok: true };
  },
});
const imageImportRows = z
  .array(
    z.object({
      sku: z.string().trim().min(1).max(64),
      urls: z.array(z.url().startsWith("https://").max(2048)).min(1).max(6),
    }),
  )
  .min(1)
  .max(10);
export const importProductImages = action({
  args: { input: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{ sku: string; added: number; skipped: number; errors: string[] }>
  > => {
    const items = parse(imageImportRows, args.input);
    const results = [];
    for (const item of items) {
      const result = {
        sku: item.sku,
        added: 0,
        skipped: 0,
        errors: [] as string[],
      };
      const context = await ctx.runQuery(
        internal.inventory.imageImportContext,
        { sku: item.sku },
      );
      if (!context) {
        result.errors.push("Product not found.");
        results.push(result);
        continue;
      }
      if (context.images > 0) {
        // Existing photos are kept; remove them in the app to replace them.
        result.skipped = item.urls.length;
        results.push(result);
        continue;
      }
      let count = context.images;
      for (const url of item.urls) {
        if (count >= 6) {
          result.errors.push("Photo limit of 6 reached.");
          break;
        }
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(15000),
          });
          const type = (response.headers.get("content-type") ?? "")
            .split(";")[0]
            .trim();
          if (!response.ok || !imageTypes.includes(type)) {
            result.errors.push(url + ": not a downloadable image.");
            continue;
          }
          const blob = await response.blob();
          if (blob.size > 5 * 1024 * 1024) {
            result.errors.push(url + ": larger than 5 MB.");
            continue;
          }
          const storageId = await ctx.storage.store(new Blob([blob], { type }));
          const attached = await ctx.runMutation(
            internal.inventory.finishImageImport,
            { product_id: context.id, storage_id: storageId, source_url: url },
          );
          if (attached.ok) {
            result.added++;
            count++;
          } else result.errors.push(url + ": " + (attached.message ?? ""));
        } catch {
          result.errors.push(url + ": download failed.");
        }
      }
      results.push(result);
    }
    return results;
  },
});
const importRows = z
  .array(productInput.extend({ category: z.string().trim().min(1).max(80) }))
  .min(1)
  .max(100);
export const importProducts = mutation({
  args: { input: v.string() },
  handler: async (ctx, args) => {
    const u = await manager(ctx),
      rows = parse(importRows, args.input);
    const result = { created: 0, updated: 0 };
    for (const row of rows) {
      const { category, purchase_price, rental_price, sale_price, ...data } =
        row;
      const key = category.toLowerCase();
      let categoryRow = await ctx.db
        .query("inventory_categories")
        .withIndex("by_name", (q) => q.eq("name_key", key))
        .unique();
      if (!categoryRow) {
        const id = await ctx.db.insert("inventory_categories", {
          name: category,
          name_key: key,
          active: true,
          version: 1,
          ...stamps(),
        });
        await audit(ctx, u.userId, id, "category_imported", null, {
          name: category,
          active: true,
        });
        categoryRow = (await ctx.db.get(id))!;
      }
      if (!categoryRow.active)
        deny("INVALID_INPUT", `Category "${category}" is inactive.`);
      const existing = await ctx.db
        .query("products")
        .withIndex("by_sku", (q) =>
          q.eq("sku", data.sku).eq("deleted_at", null),
        )
        .unique();
      if (
        existing &&
        existing.track_mode !== data.track_mode &&
        (await ctx.db
          .query("inventory_movements")
          .withIndex("by_product", (q) => q.eq("product_id", existing._id))
          .first())
      )
        deny(
          "DEPENDENCY",
          `${data.sku}: tracking mode cannot change after inventory history exists.`,
        );
      const fields = {
        ...data,
        purchase_price_cents: purchase_price
          ? String(cents(purchase_price))
          : undefined,
        rental_price_cents: rental_price
          ? String(cents(rental_price))
          : undefined,
        sale_price_cents: sale_price ? String(cents(sale_price)) : undefined,
        category_id: categoryRow._id,
        search_text: [
          data.sku,
          data.name,
          data.brand,
          data.collection,
          data.color,
          data.material,
        ].join(" "),
      };
      const id =
        existing?._id ??
        (await ctx.db.insert("products", {
          ...fields,
          version: 1,
          ...stamps(),
        }));
      if (existing) {
        await ctx.db.patch(id, {
          ...fields,
          version: existing.version + 1,
          updated_at: now(),
        });
        result.updated++;
      } else result.created++;
      await audit(
        ctx,
        u.userId,
        id,
        "product_imported",
        existing ? { sku: existing.sku, version: existing.version } : null,
        { sku: data.sku, active: data.active },
      );
    }
    return result;
  },
});
export const exportCatalog = query({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await manager(ctx);
    const page = await ctx.db
      .query("products")
      .withIndex("by_active", (q) => q.eq("deleted_at", null))
      .paginate({ numItems: 50, cursor: args.cursor });
    const rows = await Promise.all(
      page.page.map(async (p) => {
        const [category, assets, stock] = await Promise.all([
          ctx.db.get(p.category_id),
          ctx.db
            .query("inventory_assets")
            .withIndex("by_product", (q) =>
              q.eq("product_id", p._id).eq("deleted_at", null),
            )
            .take(101),
          ctx.db
            .query("inventory_stock")
            .withIndex("by_product_location", (q) => q.eq("product_id", p._id))
            .take(101),
        ]);
        return {
          sku: p.sku,
          name: p.name,
          category: category?.name ?? "",
          track_mode: p.track_mode,
          brand: p.brand,
          collection: p.collection,
          description: p.description,
          color: p.color,
          material: p.material,
          dimensions: p.dimensions,
          weight: p.weight,
          purchase_price_cents: p.purchase_price_cents ?? null,
          rental_price_cents: p.rental_price_cents ?? null,
          sale_price_cents: p.sale_price_cents ?? null,
          staging_eligible: p.staging_eligible,
          retail_eligible: p.retail_eligible,
          active: p.active,
          image_urls: (
            await Promise.all(
              (p.image_ids ?? []).map((id) => ctx.storage.getUrl(id)),
            )
          )
            .filter(Boolean)
            .join(" "),
          available_units:
            p.track_mode === "serialized"
              ? assets.filter((a) => a.status === "available").length
              : stock.reduce((n, s) => n + s.available, 0),
          partial: assets.length > 100 || stock.length > 100,
        };
      }),
    );
    return { rows, cursor: page.continueCursor, done: page.isDone };
  },
});
export const receive = mutation({
  args: {
    product_id: v.id("products"),
    location_id: v.id("inventory_locations"),
    quantity: v.number(),
    condition: conditionValue,
    acquisition_date: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const u = await manager(ctx),
      p = await activeProduct(ctx, args.product_id);
    await activeLocation(ctx, args.location_id);
    const count = parse(quantity, JSON.stringify(args.quantity)),
      reason = parse(
        z.string().trim().min(3).max(1000),
        JSON.stringify(args.reason),
      );
    parse(day, JSON.stringify(args.acquisition_date));
    if (p.track_mode === "serialized" && count !== 1)
      deny("INVALID_INPUT", "Receive each serialized asset individually.");
    if (p.track_mode === "quantity" && args.condition !== "good")
      deny(
        "INVALID_INPUT",
        "Quantity receipts must be homogeneous good stock; record damaged stock separately after receipt.",
      );
    let assetId: Id<"inventory_assets"> | null = null;
    if (p.track_mode === "serialized") {
      const counter = await ctx.db
          .query("inventory_counters")
          .withIndex("by_key", (q) => q.eq("key", "asset"))
          .unique(),
        n = (counter?.value ?? 0) + 1;
      if (!Number.isSafeInteger(n) || n > 999999999) deny("LIMIT");
      if (counter) await ctx.db.patch(counter._id, { value: n });
      else
        await ctx.db.insert("inventory_counters", { key: "asset", value: n });
      assetId = await ctx.db.insert("inventory_assets", {
        asset_number: `GLA-${String(n).padStart(6, "0")}`,
        product_id: p._id,
        location_id: args.location_id,
        project_id: null,
        project_room_id: null,
        status: usable(args.condition) ? "available" : "inspection",
        condition: args.condition,
        staging_eligible: true,
        acquisition_date: args.acquisition_date,
        staging_use_count: 0,
        last_inspected_at: null,
        notes: "",
        version: 1,
        ...stamps(),
      });
    }
    await movement(ctx, u.userId, {
      ...emptyMovement,
      product_id: p._id,
      asset_id: assetId,
      quantity: count,
      to_location_id: args.location_id,
      movement_type: "received",
      reason,
      stock_deltas:
        p.track_mode === "quantity"
          ? [
              {
                location_id: args.location_id,
                bucket: "available",
                delta: count,
              },
            ]
          : [],
    });
    return assetId;
  },
});
export const availability = query({
  args: {
    product_id: v.id("products"),
    location_id: v.id("inventory_locations"),
    needed_from: v.string(),
    needed_until: v.string(),
  },
  handler: async (ctx, args) => {
    await catalogUser(ctx);
    const p = await activeProduct(ctx, args.product_id);
    parse(
      windowSchema,
      JSON.stringify({
        needed_from: args.needed_from,
        needed_until: args.needed_until,
      }),
    );
    const l = await activeLocation(ctx, args.location_id);
    if (p.track_mode === "quantity") {
      const stock = await balance(ctx, p._id, l._id);
      return {
        track_mode: p.track_mode,
        available: await available(
          ctx,
          p,
          l._id,
          args.needed_from,
          args.needed_until,
        ),
        retail_available:
          p.retail_eligible && l.retail_source
            ? await removable(ctx, p._id, l._id)
            : 0,
        stock,
        assets: [],
        partial: false,
      };
    }
    const assets = await ctx.db
      .query("inventory_assets")
      .withIndex("by_product_location", (q) =>
        q
          .eq("product_id", p._id)
          .eq("location_id", l._id)
          .eq("deleted_at", null),
      )
      .take(101);
    const result = await Promise.all(
      assets
        .slice(0, 100)
        .filter((a) => a.location_id === l._id)
        .map(async (a) => ({
          id: a._id,
          asset_number: a.asset_number,
          condition: a.condition,
          status: a.status,
          version: a.version,
          available: await available(
            ctx,
            p,
            l._id,
            args.needed_from,
            args.needed_until,
            a._id,
          ),
          retail_available:
            p.retail_eligible &&
            l.retail_source &&
            a.status === "available" &&
            usable(a.condition) &&
            !(await assetLines(ctx, a._id)).some((r) => r.state !== "planned"),
        })),
    );
    return {
      track_mode: p.track_mode,
      available: result.reduce((n, a) => n + a.available, 0),
      retail_available: result.filter((a) => a.retail_available).length,
      stock: null,
      assets: result,
      partial: assets.length > 100,
    };
  },
});
export const reserve = mutation({
  args: {
    project_id: v.id("projects"),
    project_room_id: v.id("project_rooms"),
    product_id: v.id("products"),
    location_id: v.id("inventory_locations"),
    asset_id: v.optional(v.id("inventory_assets")),
    quantity: v.number(),
    needed_from: v.string(),
    needed_until: v.string(),
    notes: v.string(),
    planned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { u, p } = await projectUser(ctx, args.project_id, true, true),
      product = await activeProduct(ctx, args.product_id),
      room = await ctx.db.get(args.project_room_id);
    if (
      !room ||
      room.deleted_at ||
      room.project_id !== p._id ||
      room.staging_scope === "no_staging"
    )
      deny("INVALID_INPUT", "Choose an active staged room on this project.");
    if (
      ![
        "planning",
        "designing",
        "ready_to_schedule",
        "scheduled",
        "staging",
        "staged",
        "listing_live",
      ].includes(p.status)
    )
      deny("INVALID_TRANSITION");
    const count = parse(quantity, JSON.stringify(args.quantity));
    parse(
      windowSchema,
      JSON.stringify({
        needed_from: args.needed_from,
        needed_until: args.needed_until,
      }),
    );
    const notes = parse(
      z.string().trim().max(2000),
      JSON.stringify(args.notes),
    );
    if (
      (product.track_mode === "serialized" &&
        (!args.asset_id || count !== 1)) ||
      (product.track_mode === "quantity" && args.asset_id)
    )
      deny("INVALID_INPUT");
    if (
      (await projectLines(ctx, p._id)).length >= 200 ||
      (await productLines(ctx, product._id)).length >= 400
    )
      deny("LIMIT");
    const l = await activeLocation(ctx, args.location_id);
    if (!product.staging_eligible || !l.staging_source) deny("UNAVAILABLE");
    if (args.asset_id) {
      if ((await assetLines(ctx, args.asset_id)).length >= 100) deny("LIMIT");
      const a = await ctx.db.get(args.asset_id);
      if (!a || a.product_id !== product._id || a.deleted_at)
        deny("INVALID_INPUT");
    }
    if (
      !args.planned &&
      (await available(
        ctx,
        product,
        l._id,
        args.needed_from,
        args.needed_until,
        args.asset_id,
      )) < count
    )
      deny("STOCK_CONFLICT", "Inventory is unavailable for this window.");
    const id = await ctx.db.insert("inventory_reservations", {
      project_id: p._id,
      project_room_id: room._id,
      product_id: product._id,
      location_id: l._id,
      asset_id: args.asset_id ?? null,
      return_location_id: null,
      parent_id: null,
      quantity: count,
      state: args.planned ? "planned" : "reserved",
      active: true,
      needed_from: args.needed_from,
      needed_until: args.needed_until,
      reserved_at: now(),
      reserved_by: u.userId,
      notes,
      exception: "",
      exception_approved: false,
      version: 1,
      created_at: now(),
      updated_at: now(),
    });
    await movement(ctx, u.userId, {
      ...emptyMovement,
      product_id: product._id,
      asset_id: args.asset_id ?? null,
      quantity: count,
      from_location_id: l._id,
      project_id: p._id,
      project_room_id: room._id,
      reservation_id: id,
      movement_type: "reserve",
      reason: args.planned
        ? "Planned demand; no allocation"
        : "Reservation confirmed",
    });
    await touch(ctx, p);
    return id;
  },
});
export const moveReservation = mutation({
  args: {
    return_outcome: v.optional(
      v.union(
        v.literal("good"),
        v.literal("damaged"),
        v.literal("cleaning"),
        v.literal("repair"),
      ),
    ),
    id: v.id("inventory_reservations"),
    version: v.number(),
    action: v.union(
      v.literal("confirm"),
      v.literal("release"),
      v.literal("pick"),
      v.literal("install"),
      v.literal("destage"),
      v.literal("return"),
      v.literal("missing"),
      v.literal("damage"),
      v.literal("wrong_item"),
      v.literal("exception"),
      v.literal("found"),
      v.literal("receive_damage"),
      v.literal("write_off"),
    ),
    quantity: v.number(),
    asset_confirmation: v.string(),
    location_id: v.optional(v.id("inventory_locations")),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await requireRoles(ctx, ["owner", "admin", "designer", "staging_crew"]);
    if (args.return_outcome && args.action !== "return") deny("INVALID_INPUT");
    const line = await ctx.db.get(args.id);
    if (!line) return deny("UNAVAILABLE");
    // Returns and inspection recovery remain possible after project completion.
    const {
      u,
      p,
      a: access,
    } = await projectUser(
      ctx,
      line.project_id,
      !["found", "receive_damage", "write_off"].includes(args.action),
    );
    revision(line, args.version);
    if (!line.active) deny("INVALID_TRANSITION");
    const count = parse(quantity, JSON.stringify(args.quantity));
    if (count > line.quantity || (line.asset_id && count !== 1))
      deny("INVALID_INPUT");
    const reason = parse(
      z.string().trim().min(3).max(1000),
      JSON.stringify(args.reason),
    );
    const managers = isAdmin(u),
      planning = managers || access === "design";
    if (["confirm", "release"].includes(args.action) && !planning) deny();
    if (
      ["exception", "found", "receive_damage", "write_off"].includes(
        args.action,
      ) &&
      !managers
    )
      deny();
    if (
      [
        "pick",
        "install",
        "destage",
        "return",
        "missing",
        "damage",
        "wrong_item",
      ].includes(args.action) &&
      !managers &&
      access !== "crew"
    )
      deny();
    const asset = line.asset_id ? await ctx.db.get(line.asset_id) : null;
    if (line.asset_id && (!asset || asset.deleted_at)) deny("UNAVAILABLE");
    if (
      asset &&
      [
        "pick",
        "install",
        "destage",
        "return",
        "found",
        "receive_damage",
        "write_off",
      ].includes(args.action) &&
      args.asset_confirmation.trim().toUpperCase() !== asset.asset_number
    )
      deny("IDENTITY_MISMATCH", "Confirm the asset number on the item.");
    const product = await ctx.db.get(line.product_id);
    if (!product) deny("UNAVAILABLE");
    let state = line.state,
      type: Doc<"inventory_movements">["movement_type"] = "exception";
    let from: Id<"inventory_locations"> | null = null,
      to: Id<"inventory_locations"> | null = null;
    let assetStatus = asset?.status,
      assetCondition = asset?.condition;
    let physicalLocation = asset?.location_id ?? null,
      physicalProject = asset?.project_id ?? null,
      physicalRoom = asset?.project_room_id ?? null;
    const deltas: Doc<"inventory_movements">["stock_deltas"] = [];
    const stock = (
      location: Id<"inventory_locations">,
      bucket: Doc<"inventory_movements">["stock_deltas"][number]["bucket"],
      delta: number,
    ) => {
      if (!asset) deltas.push({ location_id: location, bucket, delta });
    };
    const allowed = (...states: (typeof line.state)[]) => {
      if (!states.includes(line.state)) deny("INVALID_TRANSITION");
    };
    if (args.action === "confirm") {
      allowed("planned");
      await activeProduct(ctx, product._id);
      if (
        (await available(
          ctx,
          product,
          line.location_id,
          line.needed_from,
          line.needed_until,
          line.asset_id ?? undefined,
          line._id,
        )) < count
      )
        deny("STOCK_CONFLICT");
      state = "reserved";
      type = "reserve";
    } else if (args.action === "release") {
      allowed("planned", "reserved");
      state = "released";
      type = "release_reservation";
    } else if (args.action === "pick") {
      allowed("reserved");
      await activeProduct(ctx, product._id);
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Vancouver",
      }).format(new Date());
      if (today < line.needed_from || today > line.needed_until)
        deny(
          "INVALID_TRANSITION",
          "Picking must occur within the reserved dates.",
        );
      if (
        !["scheduled", "staging", "staged", "listing_live"].includes(p.status)
      )
        deny("INVALID_TRANSITION");
      if (
        (await available(
          ctx,
          product,
          line.location_id,
          line.needed_from,
          line.needed_until,
          line.asset_id ?? undefined,
          line._id,
        )) < count
      )
        deny("STOCK_CONFLICT");
      state = "picked";
      type = "stage_out";
      from = line.location_id;
      stock(line.location_id, "available", -count);
      assetStatus = "in_transit";
      physicalLocation = null;
      physicalProject = p._id;
      physicalRoom = line.project_room_id;
    } else if (args.action === "install") {
      allowed("picked");
      if (!["staging", "staged", "listing_live"].includes(p.status))
        deny("INVALID_TRANSITION");
      state = "installed";
      type = "installed";
      assetStatus = "staged";
    } else if (args.action === "destage") {
      allowed("installed");
      if (p.status !== "destaging") deny("INVALID_TRANSITION");
      state = "returning";
      type = "destage";
      assetStatus = "returning";
    } else if (args.action === "return") {
      allowed("returning", "picked");
      if (!args.location_id) deny("INVALID_INPUT");
      await activeLocation(ctx, args.location_id);
      state = "inspection";
      if (args.return_outcome === "damaged") assetCondition = "damaged";
      type = "returned";
      to = args.location_id;
      stock(to, "inspection", count);
      assetStatus = "inspection";
      physicalLocation = to;
      physicalProject = null;
      physicalRoom = null;
    } else if (args.action === "missing" || args.action === "damage") {
      allowed("reserved", "picked", "installed", "returning");
      state = args.action === "missing" ? "missing" : "damaged";
      type = args.action;
      if (line.state === "reserved") {
        from = line.location_id;
        stock(from, "available", -count);
        stock(from, state, count);
        physicalLocation = args.action === "missing" ? null : from;
      }
      // Missing project stock is held against its source, without pretending it is physically there.
      else if (!asset) stock(line.location_id, state, count);
      assetStatus = state;
      if (args.action === "damage") assetCondition = "damaged";
      if (args.action === "missing") physicalLocation = null;
      physicalProject = p._id;
      physicalRoom = line.project_room_id;
    } else if (args.action === "found") {
      allowed("missing");
      if (!args.location_id) deny("INVALID_INPUT");
      await activeLocation(ctx, args.location_id);
      state = "inspection";
      type = "found";
      to = args.location_id;
      stock(line.location_id, "missing", -count);
      stock(to, "inspection", count);
      assetStatus = "inspection";
      physicalLocation = to;
      physicalProject = null;
      physicalRoom = null;
    } else if (args.action === "receive_damage") {
      allowed("damaged");
      if (!args.location_id) deny("INVALID_INPUT");
      await activeLocation(ctx, args.location_id);
      state = "inspection";
      type = "returned";
      to = args.location_id;
      stock(line.return_location_id ?? line.location_id, "damaged", -count);
      stock(to, "inspection", count);
      assetStatus = "inspection";
      physicalLocation = to;
      physicalProject = null;
      physicalRoom = null;
    } else if (args.action === "write_off") {
      allowed("missing");
      if (
        asset &&
        (await assetLines(ctx, asset._id)).some(
          (r) => r._id !== line._id && r.state !== "planned",
        )
      )
        deny(
          "STOCK_CONFLICT",
          "Release future asset reservations before retirement.",
        );
      state = "resolved";
      type = "retired";
      stock(line.location_id, "missing", -count);
      stock(line.location_id, "retired", count);
      assetStatus = "retired";
      physicalLocation = null;
      physicalProject = null;
      physicalRoom = null;
    } else if (args.action === "wrong_item") {
      allowed("reserved");
    }
    const id = await splitLine(ctx, line, count, state, {
      ...(args.action === "install" ? { installed_at: now() } : {}),
      ...(args.action === "return"
        ? {
            return_outcome: args.return_outcome ?? "good",
            exception:
              args.return_outcome && args.return_outcome !== "good"
                ? reason
                : "",
          }
        : {}),
      ...(args.action === "pick" ? { exception: "" } : {}),
      ...(args.action === "exception" ? { exception_approved: true } : {}),
      ...(args.action === "damage" && line.state === "reserved"
        ? { return_location_id: line.location_id }
        : {}),
      ...(to ? { return_location_id: to } : {}),
      ...(["missing", "damage", "wrong_item", "exception"].includes(args.action)
        ? { exception: reason }
        : {}),
    });
    if (asset && assetStatus)
      await ctx.db.patch(asset._id, {
        status: assetStatus,
        condition: assetCondition!,
        location_id: physicalLocation,
        project_id: physicalProject,
        project_room_id: physicalRoom,
        staging_use_count:
          asset.staging_use_count + (args.action === "install" ? 1 : 0),
        version: asset.version + 1,
        updated_at: now(),
      });
    await movement(ctx, u.userId, {
      product_id: product._id,
      asset_id: asset?._id ?? null,
      quantity: count,
      from_location_id: from,
      to_location_id: to,
      project_id: p._id,
      project_room_id: line.project_room_id,
      reservation_id: id,
      movement_type: type,
      reason,
      stock_deltas: deltas,
    });
    if (
      ["damage", "missing", "wrong_item"].includes(args.action) ||
      args.return_outcome === "damaged"
    )
      await ctx.db.insert("inventory_damage", {
        product_id: product._id,
        asset_id: asset?._id ?? null,
        reservation_id: id,
        project_id: p._id,
        project_room_id: line.project_room_id,
        quantity: count,
        damage_type: args.return_outcome === "damaged" ? "damage" : args.action,
        severity: args.action === "wrong_item" ? "minor" : "major",
        description: reason,
        status: "reported",
        resolution: "",
        discovered_at: now(),
        discovered_by: u.userId,
        version: 1,
        created_at: now(),
        updated_at: now(),
      });
    await touch(ctx, p);
    return id;
  },
});
export const inspect = mutation({
  args: {
    reservation_id: v.optional(v.id("inventory_reservations")),
    asset_id: v.optional(v.id("inventory_assets")),
    product_id: v.id("products"),
    location_id: v.id("inventory_locations"),
    version: v.number(),
    quantity: v.number(),
    from_state: v.union(
      v.literal("inspection"),
      v.literal("cleaning"),
      v.literal("repair"),
      v.literal("damaged"),
    ),
    result: v.union(
      v.literal("available"),
      v.literal("cleaning"),
      v.literal("repair"),
      v.literal("damaged"),
      v.literal("retired"),
    ),
    condition: conditionValue,
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const u = await manager(ctx),
      product = await ctx.db.get(args.product_id);
    if (!product) deny("UNAVAILABLE");
    await activeLocation(ctx, args.location_id);
    const count = parse(quantity, JSON.stringify(args.quantity)),
      notes = parse(
        z.string().trim().min(3).max(2000),
        JSON.stringify(args.notes),
      );
    if (args.result === "available" && !usable(args.condition))
      deny("INVALID_INPUT", "Unusable condition cannot be released.");
    const line = args.reservation_id
      ? await ctx.db.get(args.reservation_id)
      : null;
    const asset = args.asset_id ? await ctx.db.get(args.asset_id) : null;
    if (
      (product.track_mode === "serialized" && (!asset || count !== 1)) ||
      (product.track_mode === "quantity" && args.asset_id)
    )
      deny("INVALID_INPUT");
    if (args.reservation_id && (!line || !line.active)) deny("UNAVAILABLE");
    if (line) {
      revision(line, args.version);
      if (
        line.product_id !== product._id ||
        line.asset_id !== (args.asset_id ?? null) ||
        line.state !== args.from_state ||
        (line.return_location_id ?? line.location_id) !== args.location_id ||
        count > line.quantity
      )
        deny("INVALID_INPUT");
      if (!line.return_location_id)
        deny(
          "DEPENDENCY",
          "Receive project inventory into a confirmed location before inspection.",
        );
      // Damaged items at a project must first be physically received into an inspection location.
      if (asset && asset.location_id !== args.location_id)
        deny("DEPENDENCY", "Receive the damaged item before inspection.");
    } else if (asset) {
      revision(asset, args.version);
      if (
        (await assetLines(ctx, asset._id)).some(
          (r) => !["planned", "reserved"].includes(r.state),
        )
      )
        deny(
          "DEPENDENCY",
          "Inspect this asset through its project reservation.",
        );
    } else {
      const b = await balance(ctx, product._id, args.location_id);
      if (!b) deny("UNAVAILABLE");
      revision(b, args.version);
      const held = (await productLines(ctx, product._id))
        .filter(
          (r) =>
            r.state === args.from_state &&
            (r.return_location_id ?? r.location_id) === args.location_id,
        )
        .reduce((n, r) => n + r.quantity, 0);
      if (b[args.from_state] - held < count)
        deny("DEPENDENCY", "Inspect project-held stock from its reservation.");
    }
    if (
      asset &&
      (asset.product_id !== product._id ||
        asset.location_id !== args.location_id ||
        asset.status !== args.from_state ||
        asset.deleted_at)
    )
      deny("INVALID_INPUT");
    if (
      asset &&
      args.result === "retired" &&
      (await assetLines(ctx, asset._id)).some(
        (r) => r._id !== line?._id && r.state !== "planned",
      )
    )
      deny(
        "STOCK_CONFLICT",
        "Release future asset reservations before retirement.",
      );
    const id = line
      ? await splitLine(
          ctx,
          line,
          count,
          args.result === "available" || args.result === "retired"
            ? "resolved"
            : args.result,
        )
      : null;
    if (asset)
      await ctx.db.patch(asset._id, {
        status: args.result,
        condition: args.condition,
        last_inspected_at: now(),
        project_id: null,
        project_room_id: null,
        version: asset.version + 1,
        updated_at: now(),
      });
    await ctx.db.insert("inventory_inspections", {
      product_id: product._id,
      asset_id: asset?._id ?? null,
      reservation_id: id,
      project_id: line?.project_id ?? null,
      location_id: args.location_id,
      quantity: count,
      condition_before: asset?.condition ?? null,
      condition_after: args.condition,
      result: args.result,
      notes,
      inspected_by: u.userId,
      inspected_at: now(),
    });
    await movement(ctx, u.userId, {
      ...emptyMovement,
      product_id: product._id,
      asset_id: asset?._id ?? null,
      quantity: count,
      from_location_id: args.location_id,
      to_location_id: args.location_id,
      project_id: line?.project_id ?? null,
      project_room_id: line?.project_room_id ?? null,
      reservation_id: id,
      movement_type:
        args.result === "available"
          ? "inspection_release"
          : args.result === "damaged"
            ? "damage"
            : args.result,
      reason: notes,
      stock_deltas: asset
        ? []
        : [
            {
              location_id: args.location_id,
              bucket: args.from_state,
              delta: -count,
            },
            {
              location_id: args.location_id,
              bucket: args.result,
              delta: count,
            },
          ],
    });
    return id;
  },
});
export const transferOrDispose = mutation({
  args: {
    product_id: v.id("products"),
    asset_id: v.optional(v.id("inventory_assets")),
    location_id: v.id("inventory_locations"),
    to_location_id: v.optional(v.id("inventory_locations")),
    version: v.number(),
    quantity: v.number(),
    action: v.union(
      v.literal("transfer"),
      v.literal("sold"),
      v.literal("retired"),
      v.literal("adjustment"),
    ),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const u = await manager(ctx),
      product = await activeProduct(ctx, args.product_id),
      l = await activeLocation(ctx, args.location_id);
    const count = parse(quantity, JSON.stringify(args.quantity)),
      reason = parse(
        z.string().trim().min(3).max(1000),
        JSON.stringify(args.reason),
      );
    if (
      args.action === "sold" &&
      (!product.retail_eligible || !l.retail_source)
    )
      deny("UNAVAILABLE", "This inventory is not eligible for retail.");
    if (args.action === "transfer") {
      if (!args.to_location_id || args.to_location_id === l._id)
        deny("INVALID_INPUT");
      await activeLocation(ctx, args.to_location_id);
    }
    const asset = args.asset_id ? await ctx.db.get(args.asset_id) : null;
    if (product.track_mode === "serialized") {
      if (
        !asset ||
        asset.product_id !== product._id ||
        asset.location_id !== l._id ||
        asset.deleted_at ||
        asset.status !== "available" ||
        count !== 1
      )
        deny("UNAVAILABLE");
      revision(asset, args.version);
      if ((await assetLines(ctx, asset._id)).some((r) => r.state !== "planned"))
        deny("STOCK_CONFLICT", "Asset is committed to staging.");
      if (args.action === "adjustment")
        deny("INVALID_INPUT", "Use a traced asset disposition.");
      await ctx.db.patch(asset._id, {
        location_id: args.action === "transfer" ? args.to_location_id! : l._id,
        status: args.action === "transfer" ? "available" : args.action,
        version: asset.version + 1,
        updated_at: now(),
      });
    } else {
      if (args.asset_id) deny("INVALID_INPUT");
      const b = await balance(ctx, product._id, l._id);
      if (!b) deny("UNAVAILABLE");
      revision(b, args.version);
      if ((await removable(ctx, product._id, l._id)) < count)
        deny("STOCK_CONFLICT", "Stock is committed to staging.");
    }
    const destination =
      args.action === "transfer" ? args.to_location_id! : l._id;
    await movement(ctx, u.userId, {
      ...emptyMovement,
      product_id: product._id,
      asset_id: asset?._id ?? null,
      quantity: count,
      from_location_id: l._id,
      to_location_id: args.action === "transfer" ? destination : null,
      movement_type: args.action,
      reason,
      stock_deltas: asset
        ? []
        : [
            { location_id: l._id, bucket: "available", delta: -count },
            {
              location_id: destination,
              bucket:
                args.action === "transfer"
                  ? "available"
                  : args.action === "adjustment"
                    ? "missing"
                    : args.action,
              delta: count,
            },
          ],
    });
  },
});
export const resolveDamage = mutation({
  args: {
    id: v.id("inventory_damage"),
    version: v.number(),
    status: v.union(
      v.literal("assessed"),
      v.literal("repair"),
      v.literal("resolved"),
      v.literal("written_off"),
    ),
    resolution: v.string(),
  },
  handler: async (ctx, args) => {
    const u = await manager(ctx),
      row = await ctx.db.get(args.id);
    if (!row) deny("UNAVAILABLE");
    revision(row, args.version);
    if (!damageTransitions[row.status].includes(args.status))
      deny("INVALID_TRANSITION");
    const resolution = parse(
      z.string().trim().min(3).max(2000),
      JSON.stringify(args.resolution),
    );
    if (
      ["resolved", "written_off"].includes(args.status) &&
      row.reservation_id
    ) {
      const r = await ctx.db.get(row.reservation_id);
      if (r?.active && ["missing", "damaged"].includes(r.state))
        deny("DEPENDENCY", "Reconcile the affected inventory first.");
    }
    await ctx.db.patch(row._id, {
      status: args.status,
      resolution,
      version: row.version + 1,
      updated_at: now(),
    });
    await audit(
      ctx,
      u.userId,
      row._id,
      "damage_updated",
      { status: row.status },
      { status: args.status, version: row.version + 1 },
    );
  },
});
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.string(),
    category_id: v.optional(v.id("inventory_categories")),
    location_id: v.optional(v.id("inventory_locations")),
    mode: v.optional(v.union(v.literal("serialized"), v.literal("quantity"))),
    status: v.optional(v.string()),
    condition: v.optional(conditionValue),
    color: v.optional(v.string()),
    available_only: v.boolean(),
    staging_only: v.boolean(),
    archived: v.boolean(),
  },
  handler: async (ctx, args) => {
    const u = await catalogUser(ctx);
    if (args.archived && !isAdmin(u)) deny();
    const search = args.search.trim().slice(0, 100);
    const asset = search.toUpperCase().startsWith("GLA-")
      ? await ctx.db
          .query("inventory_assets")
          .withIndex("by_number", (q) =>
            q.eq("asset_number", search.toUpperCase()),
          )
          .unique()
      : null;
    const source = asset
      ? ctx.db.query("products").withIndex("by_sku", (q) => q.eq("sku", ""))
      : search && !args.archived
        ? ctx.db.query("products").withSearchIndex("search", (q) => {
            let s = q.search("search_text", search).eq("deleted_at", null);
            if (args.category_id) s = s.eq("category_id", args.category_id);
            return s;
          })
        : args.category_id
          ? ctx.db
              .query("products")
              .withIndex("by_category", (q) =>
                args.archived
                  ? q
                      .eq("category_id", args.category_id!)
                      .gt("deleted_at", null)
                  : q
                      .eq("category_id", args.category_id!)
                      .eq("deleted_at", null),
              )
          : ctx.db
              .query("products")
              .withIndex("by_active", (q) =>
                args.archived
                  ? q.gt("deleted_at", null)
                  : q.eq("deleted_at", null),
              );
    const page = await source.paginate({
      ...args.paginationOpts,
      numItems: Math.min(8, args.paginationOpts.numItems),
    });
    const products =
      asset && !args.paginationOpts.cursor
        ? [await ctx.db.get(asset.product_id)].filter(
            (p): p is Doc<"products"> =>
              !!p && Boolean(p.deleted_at) === args.archived,
          )
        : page.page;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Vancouver",
    }).format(new Date());
    const result = [];
    for (const p of products) {
      if (
        (args.mode && p.track_mode !== args.mode) ||
        (args.staging_only && !p.staging_eligible) ||
        (args.color &&
          !p.color.toLowerCase().includes(args.color.toLowerCase())) ||
        (args.category_id && p.category_id !== args.category_id)
      )
        continue;
      const [assets, stocks, reservations, category] = await Promise.all([
        ctx.db
          .query("inventory_assets")
          .withIndex("by_product", (q) =>
            q.eq("product_id", p._id).eq("deleted_at", null),
          )
          .take(101),
        ctx.db
          .query("inventory_stock")
          .withIndex("by_product_location", (q) => q.eq("product_id", p._id))
          .take(101),
        productLines(ctx, p._id),
        ctx.db.get(p.category_id),
      ]);
      const aa = assets
        .slice(0, 100)
        .filter(
          (a) =>
            (!args.location_id || a.location_id === args.location_id) &&
            (!args.condition || a.condition === args.condition),
        );
      const ss = stocks
        .slice(0, 100)
        .filter((s) => !args.location_id || s.location_id === args.location_id);
      const reserved = reservations.filter(
        (r) =>
          r.state === "reserved" &&
          (!args.location_id || r.location_id === args.location_id) &&
          r.needed_from <= today &&
          r.needed_until >= today,
      );
      const locationIds = [
        ...new Set([
          ...aa.flatMap((a) => (a.location_id ? [a.location_id] : [])),
          ...ss.map((s) => s.location_id),
        ]),
      ];
      const sourceIds = new Set(
        (await Promise.all(locationIds.map((id) => ctx.db.get(id))))
          .filter((l) => l && l.active && !l.deleted_at && l.staging_source)
          .map((l) => l!._id),
      );
      const usableNow =
        p.active && !p.deleted_at && p.staging_eligible
          ? p.track_mode === "serialized"
            ? aa.filter(
                (a) =>
                  a.location_id &&
                  sourceIds.has(a.location_id) &&
                  a.status === "available" &&
                  a.staging_eligible &&
                  usable(a.condition) &&
                  !reserved.some((r) => r.asset_id === a._id),
              ).length
            : Math.max(
                0,
                ss
                  .filter((s) => sourceIds.has(s.location_id))
                  .reduce((n, s) => n + s.available, 0) -
                  reserved.reduce((n, r) => n + r.quantity, 0),
              )
          : 0;
      const reservedCount = reserved.reduce((n, r) => n + r.quantity, 0),
        staged = reservations
          .filter(
            (r) =>
              r.state === "installed" &&
              (!args.location_id || r.location_id === args.location_id),
          )
          .reduce((n, r) => n + r.quantity, 0);
      if (args.available_only && !usableNow) continue;
      if (
        args.condition &&
        p.track_mode === "quantity" &&
        args.condition !== "good"
      )
        continue;
      if (
        args.status &&
        !(args.status === "reserved"
          ? reservedCount > 0
          : args.status === "staged"
            ? staged > 0
            : aa.some((a) => a.status === args.status) ||
              ss.some((s) =>
                stockStates.some((k) => k === args.status && s[k] > 0),
              ))
      )
        continue;
      if (args.location_id && !aa.length && !ss.length && !reserved.length)
        continue;
      result.push({
        ...p,
        // Pricing is commercial data; only Owner/Admin receive stored values.
        purchase_price_cents: isAdmin(u)
          ? (p.purchase_price_cents ?? null)
          : null,
        rental_price_cents: isAdmin(u) ? (p.rental_price_cents ?? null) : null,
        sale_price_cents: isAdmin(u) ? (p.sale_price_cents ?? null) : null,
        image_url: p.image_ids?.length
          ? await ctx.storage.getUrl(p.image_ids[0])
          : null,
        matched_asset_id: asset?.product_id === p._id ? asset._id : null,
        category_name: category?.name ?? "Category",
        available: usableNow,
        reserved: reservedCount,
        staged,
        care:
          aa.filter((a) =>
            ["cleaning", "repair", "inspection"].includes(a.status),
          ).length +
          ss.reduce((n, s) => n + s.cleaning + s.repair + s.inspection, 0),
        partial: assets.length > 100 || stocks.length > 100,
      });
    }
    return { ...page, page: result, manage: isAdmin(u) };
  },
});
export const product = query({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    const u = await catalogUser(ctx),
      p = await ctx.db.get(args.id);
    if (!p || (p.deleted_at && !isAdmin(u))) deny("UNAVAILABLE");
    const [assets, stock, reservations, category] = await Promise.all([
      ctx.db
        .query("inventory_assets")
        .withIndex("by_product", (q) =>
          q.eq("product_id", p._id).eq("deleted_at", null),
        )
        .take(101),
      ctx.db
        .query("inventory_stock")
        .withIndex("by_product_location", (q) => q.eq("product_id", p._id))
        .take(101),
      productLines(ctx, p._id),
      ctx.db.get(p.category_id),
    ]);
    return {
      ...p,
      // Pricing is commercial data; only Owner/Admin receive stored values.
      purchase_price_cents: isAdmin(u)
        ? (p.purchase_price_cents ?? null)
        : null,
      rental_price_cents: isAdmin(u) ? (p.rental_price_cents ?? null) : null,
      sale_price_cents: isAdmin(u) ? (p.sale_price_cents ?? null) : null,
      images: (
        await Promise.all(
          (p.image_ids ?? []).map(async (id) => ({
            id,
            url: await ctx.storage.getUrl(id),
          })),
        )
      ).filter((image): image is { id: typeof image.id; url: string } =>
        Boolean(image.url),
      ),
      manage: isAdmin(u),
      category_name: category?.name ?? "Category",
      assets: assets.slice(0, 100).map((a) => ({
        id: a._id,
        asset_number: a.asset_number,
        status: a.status,
        condition: a.condition,
        location_id: a.location_id,
        staging_use_count: a.staging_use_count,
      })),
      stock: await Promise.all(
        stock.slice(0, 100).map(async (s) => ({
          ...s,
          location_name: (await ctx.db.get(s.location_id))?.name ?? "Location",
        })),
      ),
      upcoming_quantity: reservations
        .filter((r) => r.state === "reserved")
        .reduce((n, r) => n + r.quantity, 0),
      installed_quantity: reservations
        .filter((r) => r.state === "installed")
        .reduce((n, r) => n + r.quantity, 0),
      staging_use_count: assets.reduce((n, a) => n + a.staging_use_count, 0),
      partial: assets.length > 100 || stock.length > 100,
    };
  },
});
export const asset = query({
  args: { id: v.id("inventory_assets") },
  handler: async (ctx, args) => {
    const u = await catalogUser(ctx),
      row = await ctx.db.get(args.id);
    if (!row) deny("UNAVAILABLE");
    const [p, l, reservations] = await Promise.all([
      ctx.db.get(row.product_id),
      row.location_id ? ctx.db.get(row.location_id) : null,
      assetLines(ctx, row._id),
    ]);
    return {
      ...row,
      notes: isAdmin(u) ? row.notes : "",
      project_id: isAdmin(u) ? row.project_id : null,
      project_room_id: isAdmin(u) ? row.project_room_id : null,
      product_name: p?.name ?? "Product",
      location_name:
        l?.name ??
        (row.project_id
          ? "Assigned project / transit"
          : "No confirmed location"),
      manage: isAdmin(u),
      reservations: reservations.map((r) => ({
        id: r._id,
        needed_from: r.needed_from,
        needed_until: r.needed_until,
        state: r.state,
        project_id: isAdmin(u) ? r.project_id : null,
      })),
    };
  },
});
export const history = query({
  args: {
    product_id: v.id("products"),
    asset_id: v.optional(v.id("inventory_assets")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await manager(ctx);
    if (
      args.asset_id &&
      (await ctx.db.get(args.asset_id))?.product_id !== args.product_id
    )
      deny("INVALID_INPUT");
    const source = args.asset_id
      ? ctx.db
          .query("inventory_movements")
          .withIndex("by_asset", (q) => q.eq("asset_id", args.asset_id!))
      : ctx.db
          .query("inventory_movements")
          .withIndex("by_product", (q) => q.eq("product_id", args.product_id));
    return source.order("desc").paginate({
      ...args.paginationOpts,
      numItems: Math.min(20, args.paginationOpts.numItems),
    });
  },
});
export const careHistory = query({
  args: {
    product_id: v.id("products"),
    asset_id: v.optional(v.id("inventory_assets")),
  },
  handler: async (ctx, args) => {
    await manager(ctx);
    if (
      args.asset_id &&
      (await ctx.db.get(args.asset_id))?.product_id !== args.product_id
    )
      deny("INVALID_INPUT");
    const [inspections, damage] = await Promise.all([
      args.asset_id
        ? ctx.db
            .query("inventory_inspections")
            .withIndex("by_asset", (q) => q.eq("asset_id", args.asset_id!))
            .order("desc")
            .take(21)
        : ctx.db
            .query("inventory_inspections")
            .withIndex("by_product", (q) => q.eq("product_id", args.product_id))
            .order("desc")
            .take(21),
      args.asset_id
        ? ctx.db
            .query("inventory_damage")
            .withIndex("by_asset", (q) => q.eq("asset_id", args.asset_id!))
            .order("desc")
            .take(21)
        : ctx.db
            .query("inventory_damage")
            .withIndex("by_product", (q) => q.eq("product_id", args.product_id))
            .order("desc")
            .take(21),
    ]);
    return {
      inspections: inspections.slice(0, 20),
      damage: damage.slice(0, 20),
      partial: inspections.length > 20 || damage.length > 20,
    };
  },
});
export const projectInventory = query({
  args: { project_id: v.id("projects") },
  handler: async (ctx, args) => {
    const { u, p, a } = await projectUser(ctx, args.project_id),
      rows = await projectLines(ctx, p._id);
    const allocationCache = new Map<
      string,
      Promise<Doc<"inventory_reservations">[]>
    >();
    const allocations = (r: Doc<"inventory_reservations">) => {
      const key = r.asset_id ?? r.product_id;
      let pending = allocationCache.get(key);
      if (!pending) {
        pending = r.asset_id
          ? assetLines(ctx, r.asset_id)
          : productLines(ctx, r.product_id);
        allocationCache.set(key, pending);
      }
      return pending;
    };
    const lines = await Promise.all(
      rows.map(async (r) => {
        const [product, asset, location, room] = await Promise.all([
          ctx.db.get(r.product_id),
          r.asset_id ? ctx.db.get(r.asset_id) : null,
          ctx.db.get(r.location_id),
          ctx.db.get(r.project_room_id),
        ]);
        return {
          ...r,
          product_name: product?.name ?? "Product",
          sku: product?.sku ?? "",
          asset_number: asset?.asset_number ?? null,
          condition: asset?.condition ?? "good",
          current_location:
            r.state === "missing"
              ? "Unconfirmed — missing"
              : asset
                ? asset.location_id
                  ? ((await ctx.db.get(asset.location_id))?.name ?? "Location")
                  : asset.project_id === p._id
                    ? "Project / transit"
                    : "Unconfirmed"
                : ["picked", "installed", "returning"].includes(r.state) ||
                    (r.state === "damaged" && !r.return_location_id)
                  ? "Project / transit"
                  : ((await ctx.db.get(r.return_location_id ?? r.location_id))
                      ?.name ?? "Location"),
          location_name: location?.name ?? "Location",
          room_name: room?.room_name ?? "Room",
          shortage:
            ["planned", "reserved"].includes(r.state) &&
            product?.active &&
            !product.deleted_at
              ? (await available(
                  ctx,
                  product,
                  r.location_id,
                  r.needed_from,
                  r.needed_until,
                  r.asset_id ?? undefined,
                  r._id,
                  await allocations(r),
                )) < r.quantity
              : false,
        };
      }),
    );
    const locations = await ctx.db
      .query("inventory_locations")
      .withIndex("by_active", (q) => q.eq("active", true))
      .take(101);
    return {
      project_number: p.project_number,
      project_status: p.status,
      readiness: readiness(lines),
      manage: isAdmin(u),
      design: isAdmin(u) || a === "design",
      crew: isAdmin(u) || a === "crew",
      can_edit: !p.deleted_at && !["completed", "cancelled"].includes(p.status),
      lines,
      locations: locations
        .slice(0, 100)
        .map((l) => ({ id: l._id, name: l.name })),
      partial: locations.length > 100,
    };
  },
});
export const exceptions = query({
  args: {},
  handler: async (ctx) => {
    const u = await catalogUser(ctx);
    const results: {
      id: string;
      state: string;
      quantity: number;
      product_name: string;
      project_id: Id<"projects"> | null;
      project_number: string;
      product_id: Id<"products">;
    }[] = [];
    for (const state of [
      "planned",
      "reserved",
      "missing",
      "damaged",
      "inspection",
      "cleaning",
      "repair",
    ] as const) {
      const rows = await ctx.db
        .query("inventory_reservations")
        .withIndex("by_state", (q) => q.eq("state", state).eq("active", true))
        .take(21);
      for (const r of rows.slice(0, 20)) {
        if (!isAdmin(u)) {
          const p = await ctx.db.get(r.project_id);
          if (
            !p ||
            p.deleted_at ||
            (await projectAccess(ctx, p, u)) !== "design"
          )
            continue;
        }
        const product = await ctx.db.get(r.product_id),
          p = await ctx.db.get(r.project_id);
        const shortage =
          ["planned", "reserved"].includes(state) &&
          (!product ||
            !product.active ||
            !!product.deleted_at ||
            (await available(
              ctx,
              product,
              r.location_id,
              r.needed_from,
              r.needed_until,
              r.asset_id ?? undefined,
              r._id,
            )) < r.quantity);
        if (
          ["planned", "reserved"].includes(state) &&
          !shortage &&
          !(r.exception && !r.exception_approved)
        )
          continue;
        results.push({
          id: r._id,
          product_id: r.product_id,
          state: shortage
            ? "shortage"
            : r.exception && ["planned", "reserved"].includes(state)
              ? "exception"
              : state,
          quantity: r.quantity,
          product_name: product?.name ?? "Product",
          project_id: r.project_id,
          project_number: p?.project_number ?? "Project",
        });
      }
    }
    if (isAdmin(u)) {
      const stocks = await ctx.db
        .query("inventory_stock")
        .withIndex("by_missing", (q) => q.gt("missing", 0))
        .take(21);
      for (const stock of stocks.slice(0, 20)) {
        const held = (await productLines(ctx, stock.product_id))
          .filter(
            (r) => r.state === "missing" && r.location_id === stock.location_id,
          )
          .reduce((n, r) => n + r.quantity, 0);
        if (stock.missing > held)
          results.push({
            id: stock._id,
            state: "missing",
            quantity: stock.missing - held,
            product_name:
              (await ctx.db.get(stock.product_id))?.name ?? "Product",
            project_id: null,
            project_number: "Unassigned stock",
            product_id: stock.product_id,
          });
      }
      const assets = await ctx.db
        .query("inventory_assets")
        .withIndex("by_status", (q) => q.eq("status", "missing"))
        .take(21);
      for (const asset of assets.slice(0, 20))
        if (!asset.project_id)
          results.push({
            id: asset._id,
            state: "missing",
            quantity: 1,
            product_name:
              (await ctx.db.get(asset.product_id))?.name ?? "Product",
            project_id: null,
            project_number: asset.asset_number,
            product_id: asset.product_id,
          });
    }
    return results;
  },
});
export const archiveProduct = mutation({
  args: { id: v.id("products"), version: v.number(), archive: v.boolean() },
  handler: async (ctx, args) => {
    const u = await manager(ctx),
      p = await ctx.db.get(args.id);
    if (!p) deny("UNAVAILABLE");
    revision(p, args.version);
    if (args.archive) {
      if ((await productLines(ctx, p._id)).length) deny("DEPENDENCY");
      const assets = await ctx.db
        .query("inventory_assets")
        .withIndex("by_product", (q) =>
          q.eq("product_id", p._id).eq("deleted_at", null),
        )
        .take(101);
      const stock = await ctx.db
        .query("inventory_stock")
        .withIndex("by_product_location", (q) => q.eq("product_id", p._id))
        .take(101);
      if (
        assets.length > 100 ||
        stock.length > 100 ||
        assets.some((a) => !["sold", "retired"].includes(a.status)) ||
        stock.some(
          (s) =>
            s.available +
              s.inspection +
              s.cleaning +
              s.repair +
              s.damaged +
              s.missing >
            0,
        )
      )
        deny("DEPENDENCY", "Reconcile owned inventory before archiving.");
    } else {
      const category = await ctx.db.get(p.category_id);
      if (!category || !category.active || category.deleted_at)
        deny(
          "DEPENDENCY",
          "Reactivate the category before restoring this product.",
        );
      const existing = await ctx.db
        .query("products")
        .withIndex("by_sku", (q) => q.eq("sku", p.sku).eq("deleted_at", null))
        .unique();
      if (existing && existing._id !== p._id) deny("DUPLICATE");
    }
    await ctx.db.patch(p._id, {
      deleted_at: args.archive ? now() : null,
      version: p.version + 1,
      updated_at: now(),
    });
    await audit(
      ctx,
      u.userId,
      p._id,
      args.archive ? "product_archived" : "product_restored",
      { version: p.version },
      { version: p.version + 1 },
    );
  },
});
export const holdStock = mutation({
  args: {
    product_id: v.id("products"),
    asset_id: v.optional(v.id("inventory_assets")),
    location_id: v.id("inventory_locations"),
    version: v.number(),
    quantity: v.number(),
    action: v.union(
      v.literal("inspection_hold"),
      v.literal("damage"),
      v.literal("missing"),
      v.literal("found"),
      v.literal("retired"),
    ),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const u = await manager(ctx),
      product = await ctx.db.get(args.product_id);
    if (!product) deny("UNAVAILABLE");
    await activeLocation(ctx, args.location_id);
    const count = parse(quantity, JSON.stringify(args.quantity)),
      reason = parse(
        z.string().trim().min(3).max(1000),
        JSON.stringify(args.reason),
      );
    const fromState = ["found", "retired"].includes(args.action)
      ? "missing"
      : "available";
    const toState =
      args.action === "damage"
        ? "damaged"
        : args.action === "missing"
          ? "missing"
          : args.action === "retired"
            ? "retired"
            : "inspection";
    const asset = args.asset_id ? await ctx.db.get(args.asset_id) : null;
    if (product.track_mode === "serialized") {
      if (
        !asset ||
        asset.product_id !== product._id ||
        asset.deleted_at ||
        asset.status !== fromState ||
        count !== 1 ||
        (fromState !== "missing" && asset.location_id !== args.location_id)
      )
        deny("INVALID_INPUT");
      revision(asset, args.version);
      if ((await assetLines(ctx, asset._id)).some((r) => r.state !== "planned"))
        deny("DEPENDENCY", "Use this asset's project reservation.");
      await ctx.db.patch(asset._id, {
        status: toState,
        condition: args.action === "damage" ? "damaged" : asset.condition,
        location_id: toState === "missing" ? null : args.location_id,
        project_id: null,
        project_room_id: null,
        version: asset.version + 1,
        updated_at: now(),
      });
    } else {
      if (args.asset_id) deny("INVALID_INPUT");
      const b = await balance(ctx, product._id, args.location_id);
      if (!b) deny("UNAVAILABLE");
      revision(b, args.version);
      const held = (await productLines(ctx, product._id))
        .filter(
          (r) => r.state === "missing" && r.location_id === args.location_id,
        )
        .reduce((n, r) => n + r.quantity, 0);
      if (
        (fromState === "available"
          ? await removable(ctx, product._id, args.location_id)
          : b.missing - held) < count
      )
        deny(
          "STOCK_CONFLICT",
          "Use the affected project reservation or reduce the quantity.",
        );
    }
    await movement(ctx, u.userId, {
      ...emptyMovement,
      product_id: product._id,
      asset_id: asset?._id ?? null,
      quantity: count,
      from_location_id: args.location_id,
      to_location_id: toState === "missing" ? null : args.location_id,
      movement_type: args.action,
      reason,
      stock_deltas: asset
        ? []
        : [
            { location_id: args.location_id, bucket: fromState, delta: -count },
            { location_id: args.location_id, bucket: toState, delta: count },
          ],
    });
    if (["damage", "missing"].includes(args.action))
      await ctx.db.insert("inventory_damage", {
        product_id: product._id,
        asset_id: asset?._id ?? null,
        reservation_id: null,
        project_id: null,
        project_room_id: null,
        quantity: count,
        damage_type: args.action,
        severity: "major",
        description: reason,
        status: "reported",
        resolution: "",
        discovered_at: now(),
        discovered_by: u.userId,
        version: 1,
        created_at: now(),
        updated_at: now(),
      });
  },
});
export const saveAssetDetails = mutation({
  args: {
    id: v.id("inventory_assets"),
    version: v.number(),
    staging_eligible: v.boolean(),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const u = await manager(ctx),
      a = await ctx.db.get(args.id);
    if (!a || a.deleted_at) deny("UNAVAILABLE");
    revision(a, args.version);
    const notes = parse(
      z.string().trim().max(2000),
      JSON.stringify(args.notes),
    );
    if (
      !args.staging_eligible &&
      (await assetLines(ctx, a._id)).some((r) => r.state !== "planned")
    )
      deny(
        "DEPENDENCY",
        "Resolve reservations before disabling staging eligibility.",
      );
    await ctx.db.patch(a._id, {
      staging_eligible: args.staging_eligible,
      notes,
      version: a.version + 1,
      updated_at: now(),
    });
    await audit(
      ctx,
      u.userId,
      a._id,
      "asset_details_saved",
      { version: a.version, staging_eligible: a.staging_eligible },
      { version: a.version + 1, staging_eligible: args.staging_eligible },
    );
  },
});
export const settings = query({
  args: {},
  handler: async (ctx) => {
    await manager(ctx);
    const [categories, locations] = await Promise.all([
      ctx.db.query("inventory_categories").withIndex("by_name").take(101),
      ctx.db.query("inventory_locations").withIndex("by_name").take(101),
    ]);
    return {
      categories: categories.slice(0, 100),
      locations: locations.slice(0, 100),
      partial: categories.length > 100 || locations.length > 100,
    };
  },
});
export const productAssignments = query({
  args: {
    product_id: v.id("products"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const u = await catalogUser(ctx);
    const page = await ctx.db
      .query("inventory_reservations")
      .withIndex("by_product", (q) =>
        q.eq("product_id", args.product_id).eq("active", true),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(20, args.paginationOpts.numItems),
      });
    const rows = [];
    for (const r of page.page) {
      const p = await ctx.db.get(r.project_id);
      if (!p) continue;
      if (!isAdmin(u) && (await projectAccess(ctx, p, u)) !== "design")
        continue;
      const room = await ctx.db.get(r.project_room_id);
      rows.push({
        id: r._id,
        project_id: p._id,
        project_number: p.project_number,
        room_name: room?.room_name ?? "Room",
        quantity: r.quantity,
        state: r.state,
        needed_from: r.needed_from,
        needed_until: r.needed_until,
      });
    }
    return { ...page, page: rows };
  },
});

export const search = query({
  args: { q: v.string() },
  handler: async (ctx, args) => {
    const u = await requireRoles(ctx, [
      "owner",
      "admin",
      "designer",
      "staging_crew",
    ]);
    const term = args.q.trim().slice(0, 100);
    if (term.length < 2) return [];
    const crewOnly = !u.roles.some((r) =>
      ["owner", "admin", "designer"].includes(r),
    );
    const rows: {
      id: string;
      name: string;
      kind: "Asset" | "Product";
      href: string;
    }[] = [];
    const asset = await ctx.db
      .query("inventory_assets")
      .withIndex("by_number", (q) => q.eq("asset_number", term.toUpperCase()))
      .unique();
    if (asset && !asset.deleted_at) {
      let href = "/inventory/assets/" + asset._id;
      if (crewOnly) {
        href = "";
        for (const r of await assetLines(ctx, asset._id)) {
          const p = await ctx.db.get(r.project_id);
          if (
            p &&
            !p.deleted_at &&
            (await projectAccess(ctx, p, u)) === "crew"
          ) {
            href = "/projects/" + p._id + "/inventory";
            break;
          }
        }
      }
      if (href)
        rows.push({
          id: asset._id,
          name: asset.asset_number,
          kind: "Asset",
          href,
        });
    }
    if (crewOnly) return rows;
    const exact = await ctx.db
      .query("products")
      .withIndex("by_sku", (q) =>
        q.eq("sku", term.toUpperCase()).eq("deleted_at", null),
      )
      .unique();
    const products = await ctx.db
      .query("products")
      .withSearchIndex("search", (q) =>
        q.search("search_text", term).eq("deleted_at", null),
      )
      .take(8);
    for (const p of [...(exact ? [exact] : []), ...products]) {
      if (!p.active || rows.some((r) => r.id === p._id)) continue;
      rows.push({
        id: p._id,
        name: p.sku + " · " + p.name,
        kind: "Product",
        href: "/inventory/products/" + p._id,
      });
    }
    return rows;
  },
});
