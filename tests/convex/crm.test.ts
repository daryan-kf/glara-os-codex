import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import type { Role } from "../../src/lib/permissions";
import {
  realtorRow,
  activityRow,
  brokerageRow,
  choicesSchema,
} from "../../src/lib/crm/model";
import { z } from "zod";
const modules = import.meta.glob("../../convex/**/*.ts");
async function fixture() {
  const t = convexTest(schema, modules);
  const users = await t.run(async (ctx) => {
    const result = {} as Record<Role | "unassigned" | "archived", string>;
    for (const role of [
      "owner",
      "sales",
      "admin",
      "marketing",
      "designer",
      "staging_crew",
      "unassigned",
      "archived",
    ] as const) {
      const id = await ctx.db.insert("users", {
        email: role + "@accounts.example.test",
      });
      await ctx.db.insert("profiles", {
        userId: id,
        display_name: "Fictional " + role,
        roles:
          role === "unassigned" ? [] : [role === "archived" ? "sales" : role],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: role === "archived" ? new Date().toISOString() : null,
      });
      result[role] = id;
    }
    return result;
  });
  const sessions = await t.run(async (ctx) =>
    Object.fromEntries(
      await Promise.all(
        Object.entries(users).map(async ([role, id]) => [
          role,
          await ctx.db.insert("authSessions", {
            userId: ctx.db.normalizeId("users", id)!,
            expirationTime: Date.now() + 86400000,
          }),
        ]),
      ),
    ),
  );
  const client = (role: keyof typeof users) =>
    t.withIdentity({ subject: users[role] + "|" + sessions[role] });
  const read = (role: keyof typeof users, input: object) =>
    client(role).query(api.crm.read, { input: JSON.stringify(input) });
  const write = (role: keyof typeof users, input: object) =>
    client(role).mutation(api.crm.write, { input: JSON.stringify(input) });
  const data = {
    first_name: "Fictional",
    last_name: "Partner",
    email: "fictional-agent@accounts.example.test",
    phone: "+16045550101",
    assigned_to: users.sales,
    relationship_status: "prospect",
    next_title: "Original call",
    next_due_at: "2026-10-01T18:00:00Z",
    notes: "Private",
    relationship_score: "45",
  };
  return { t, users, client, read, write, data };
}
describe("Convex M1 transactional security", () => {
  it("denies anonymous, unassigned, archived and non-CRM roles in backend functions", async () => {
    const f = await fixture();
    await expect(
      f.t.query(api.crm.read, { input: '{"op":"list"}' }),
    ).rejects.toThrow();
    for (const role of [
      "designer",
      "staging_crew",
      "unassigned",
      "archived",
    ] as const) {
      await expect(f.read(role, { op: "list" })).rejects.toThrow();
      await expect(
        f.write(role, { op: "realtor_create", data: f.data }),
      ).rejects.toThrow();
    }
  });
  it("keeps Marketing projections safe and audit/operational roster private", async () => {
    const f = await fixture(),
      r = await f.write("sales", { op: "realtor_create", data: f.data });
    const safe = await f.read("marketing", { op: "detail", id: r.id });
    expect(safe).not.toHaveProperty("notes");
    expect(safe).not.toHaveProperty("relationship_score");
    expect(safe).toHaveProperty("owner_name", "Fictional sales");
    expect(
      choicesSchema.parse(await f.read("marketing", { op: "sources" })).owners,
    ).toEqual([]);
    for (const op of ["activities", "choices", "brokerages"])
      await expect(f.read("marketing", { op, id: r.id })).rejects.toThrow();
    await expect(
      f.write("marketing", {
        op: "realtor_update",
        id: r.id,
        version: 1,
        data: f.data,
      }),
    ).rejects.toThrow();
    for (const role of [
      "sales",
      "admin",
      "marketing",
      "designer",
      "staging_crew",
      "unassigned",
      "archived",
    ] as const)
      await expect(
        f.client(role).query(api.profiles.audit, { entity_id: r.id }),
      ).rejects.toThrow();
  });
  it("requires initial next actions atomically and rejects invalid direct writes", async () => {
    const f = await fixture();
    await expect(
      f.write("owner", {
        op: "realtor_create",
        data: { ...f.data, next_title: "", next_due_at: "" },
      }),
    ).rejects.toThrow();
    expect(
      await f.t.run((ctx) => ctx.db.query("realtors").collect()),
    ).toHaveLength(0);
    expect(
      await f.t.run((ctx) => ctx.db.query("audit_logs").collect()),
    ).toHaveLength(0);
    for (const patch of [
      { email: "invalid" },
      { assigned_to: f.users.marketing },
      { relationship_score: "101" },
    ])
      await expect(
        f.write("sales", {
          op: "realtor_create",
          data: { ...f.data, ...patch },
        }),
      ).rejects.toThrow();
  });
  it("validates versions, duplicate contacts, search and exact decimal strings", async () => {
    const f = await fixture(),
      r = await f.write("sales", {
        op: "realtor_create",
        data: { ...f.data, average_listing_price: "1234567.89" },
      });
    expect(
      realtorRow.parse(await f.read("owner", { op: "detail", id: r.id }))
        .average_listing_price,
    ).toBe("1234567.89");
    expect(
      await f.read("sales", {
        op: "list",
        q: f.data.email,
        assigned_to: f.users.sales,
        status: "prospect",
      }),
    ).toHaveProperty("total", 1);
    await expect(
      f.write("admin", { op: "realtor_create", data: f.data }),
    ).rejects.toThrow();
    await f.write("admin", {
      op: "realtor_update",
      id: r.id,
      version: 1,
      data: {
        ...f.data,
        next_title: "",
        next_due_at: "",
        primary_area: "Fictional Area",
      },
    });
    await expect(
      f.write("sales", {
        op: "realtor_update",
        id: r.id,
        version: 1,
        data: f.data,
      }),
    ).rejects.toThrow();
    expect(
      realtorRow.parse(await f.read("owner", { op: "detail", id: r.id }))
        .version,
    ).toBe(2);
  });
  it("rolls back last-action cancellation and preserves reschedule history and audit", async () => {
    const f = await fixture(),
      r = await f.write("sales", { op: "realtor_create", data: f.data });
    const rows = () =>
      f
        .read("sales", { op: "activities", id: r.id })
        .then((x) => z.object({ rows: z.array(activityRow) }).parse(x).rows);
    const original = (await rows())[0],
      before = await f.t.run((ctx) => ctx.db.query("audit_logs").collect());
    await expect(
      f.write("sales", { op: "activity_cancel", id: original.id, data: {} }),
    ).rejects.toThrow();
    expect(
      await f.t.run((ctx) => ctx.db.query("audit_logs").collect()),
    ).toEqual(before);
    await f.write("sales", {
      op: "activity_reschedule",
      id: original.id,
      data: { next_title: "Replacement", next_due_at: "2026-10-05T18:00:00Z" },
    });
    expect((await rows()).find((a) => a.id === original.id)).toMatchObject({
      status: "cancelled",
      completed_at: null,
      due_at: original.due_at,
    });
    const stored = await f.t.run((ctx) => ctx.db.query("activities").collect());
    expect(
      stored.find((a) => a.replaces_activity_id === original.id),
    ).toMatchObject({ status: "open", title: "Replacement" });
    await expect(
      f.write("sales", {
        op: "activity_reschedule",
        id: original.id,
        data: { next_title: "Again", next_due_at: "2026-10-07T18:00:00Z" },
      }),
    ).rejects.toThrow();
    const audit = await f
      .client("owner")
      .query(api.profiles.audit, { entity_id: original.id });
    expect(audit.every((a) => a.actor_id === f.users.sales)).toBe(true);
  });
  it("enforces archive and restore permissions without losing activities", async () => {
    const f = await fixture(),
      r = await f.write("sales", { op: "realtor_create", data: f.data });
    await f.write("sales", { op: "realtor_archive", id: r.id, version: 1 });
    expect(await f.read("sales", { op: "detail", id: r.id })).toBeNull();
    await expect(
      f.write("owner", {
        op: "realtor_update",
        id: r.id,
        version: 2,
        data: f.data,
      }),
    ).rejects.toThrow();
    await expect(
      f.write("sales", { op: "realtor_restore", id: r.id, version: 2 }),
    ).rejects.toThrow();
    await f.write("admin", { op: "realtor_restore", id: r.id, version: 2 });
    expect(
      realtorRow.parse(await f.read("sales", { op: "detail", id: r.id }))
        .next_action,
    ).toBe("Original call");
  });
  it("protects brokerage missing/stale versions and archived records for every operator", async () => {
    const f = await fixture(),
      data = { name: "Fictional Office", province: "BC" },
      b = await f.write("owner", { op: "brokerage_save", data });
    await f.write("sales", {
      op: "brokerage_save",
      id: b.id,
      version: 1,
      data: { ...data, name: "Edited" },
    });
    for (const role of ["owner", "sales", "admin"] as const) {
      await expect(
        f.write(role, { op: "brokerage_save", id: b.id, version: 1, data }),
      ).rejects.toThrow();
      await expect(
        f.write(role, { op: "brokerage_save", id: b.id, data }),
      ).rejects.toThrow();
    }
    expect(
      brokerageRow.parse(await f.read("owner", { op: "brokerage", id: b.id }))
        .version,
    ).toBe(2);
    await f.t.run(async (ctx) => {
      const id = ctx.db.normalizeId("brokerages", b.id)!;
      await ctx.db.patch(id, { deleted_at: new Date().toISOString() });
    });
    const before = await f.t.run((ctx) => ctx.db.query("audit_logs").collect());
    for (const role of ["owner", "sales", "admin"] as const)
      await expect(
        f.write(role, {
          op: "brokerage_save",
          id: b.id,
          version: 2,
          data: { ...data, deleted_at: null },
        }),
      ).rejects.toThrow();
    expect(
      await f.t.run((ctx) => ctx.db.query("audit_logs").collect()),
    ).toEqual(before);
  });
  it("limits source administration and derives audit identity from authentication", async () => {
    const f = await fixture();
    await expect(
      f.write("sales", { op: "source_save", data: { name: "Referral" } }),
    ).rejects.toThrow();
    await f.write("admin", { op: "source_save", data: { name: "Referral" } });
    expect(
      choicesSchema.parse(await f.read("marketing", { op: "sources" })).sources,
    ).toHaveLength(1);
    const r = await f.write("sales", {
      op: "realtor_create",
      data: { ...f.data, created_by: f.users.owner, actor_id: f.users.owner },
    });
    expect(
      (
        await f.client("owner").query(api.profiles.audit, { entity_id: r.id })
      ).every((a) => a.actor_id === f.users.sales),
    ).toBe(true);
  });
});
