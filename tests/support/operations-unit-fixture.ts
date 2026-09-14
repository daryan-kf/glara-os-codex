import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import type { Role } from "../../src/lib/permissions";
import type { Id } from "../../convex/_generated/dataModel";
import { day, attention } from "../../src/lib/operations/model";
const modules = import.meta.glob("../../convex/**/*.ts");
export async function operationsFixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const users = await t.run(async (ctx) => {
    const result = [];
    for (const role of [
      "owner",
      "admin",
      "sales",
      "designer",
      "staging_crew",
      "marketing",
    ] as Role[]) {
      const id = await ctx.db.insert("users", {
        email: role + "@accounts.example.test",
      });
      await ctx.db.insert("profiles", {
        userId: id,
        display_name: role,
        roles: [role],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      });
      const session = await ctx.db.insert("authSessions", {
        userId: id,
        expirationTime: Date.now() + 86400000,
      });
      result.push({ role, id, subject: id + "|" + session });
    }
    return result;
  });
  const who = (role: Role) => users.find((u) => u.role === role)!;
  const c = (role: Role) => t.withIdentity({ subject: who(role).subject });
  const r = await c("sales").mutation(api.crm.write, {
    input: JSON.stringify({
      op: "realtor_create",
      data: {
        first_name: "M3",
        last_name: "Fictional",
        relationship_status: "active_partner",
        assigned_to: who("sales").id,
      },
    }),
  });
  const pid = await c("sales").mutation(api.sales.saveProperty, {
    version: 0,
    input: JSON.stringify({
      address_line_1: "13 Fictional Crescent",
      city: "Vancouver",
      province: "BC",
      property_type: "detached",
      occupancy_status: "vacant",
      realtor_id: r.id,
      seller_name: "PRIVATE SELLER",
      notes: "PRIVATE PROPERTY",
    }),
  });
  const oid = await c("sales").mutation(api.sales.saveOpportunity, {
    version: 0,
    input: JSON.stringify({
      property_id: pid,
      assigned_to: who("sales").id,
      estimated_value: "5000",
      probability: 20,
      next_action_title: "Contact",
      next_action_date: "2099-01-01T18:00:00Z",
      notes: "PRIVATE NEGOTIATION",
    }),
  });
  const createArgs = {
    opportunity_id: oid,
    source_quote_id: null,
    project_manager_id: who("admin").id,
    designer_id: who("designer").id,
    staging_lead_id: who("staging_crew").id,
    input: JSON.stringify({
      package_type: "standard",
      planned_end_date: "2099-01-01",
      priority: "normal",
      internal_notes: "PRIVATE PROJECT",
    }),
    rooms: [
      JSON.stringify({
        room_type: "living_room",
        room_name: "Living room",
        staging_scope: "full",
        style_direction: "Calm",
        notes: "",
        status: "design_ready",
        sort_order: 0,
      }),
    ],
  };
  const won = () =>
    t.run(async (ctx) => {
      await ctx.db.patch(oid, {
        stage: "won",
        won_at: new Date().toISOString(),
      });
    });
  const create = async () => {
    await won();
    return (await c("owner").mutation(api.operations.create, createArgs)).id;
  };
  const get = (id: Id<"projects">) =>
    c("owner").query(api.operations.get, { id });
  const advance = async (
    id: Id<"projects">,
    status: Parameters<typeof attention>[0]["status"],
    date?: string,
  ) => {
    const p = await get(id);
    return c("owner").mutation(api.operations.transition, {
      id,
      version: p.version,
      status,
      date,
    });
  };
  const complete = async (id: Id<"projects">, category: string) => {
    const p = await get(id);
    for (const item of p.checklist.filter(
      (x) => x.required && x.category === category,
    ))
      await c("owner").mutation(api.operations.checklist, {
        id: item._id,
        version: item.version,
        status: "completed",
      });
  };
  const ready = async (id: Id<"projects">) => {
    await advance(id, "designing");
    await complete(id, "pre_staging");
    await advance(id, "ready_to_schedule");
  };
  const schedule = async (
    id: Id<"projects">,
    type: "staging" | "destaging" = "staging",
    hours = 16,
  ) =>
    c("owner").mutation(api.operations.schedule, {
      project_id: id,
      project_version: (await get(id)).version,
      version: 0,
      event_type: type,
      title: type,
      description: "",
      location_note: "",
      start_at: day() + `T${hours}:00:00Z`,
      end_at: day() + `T${hours + 1}:00:00Z`,
      assigned_lead_id: who("staging_crew").id,
    });
  return {
    t,
    c,
    who,
    oid,
    pid,
    r,
    createArgs,
    won,
    create,
    get,
    advance,
    complete,
    ready,
    schedule,
  };
}
