import { describe, it, expect } from "vitest";
import { api } from "../../convex/_generated/api";
import { operationsFixture } from "../support/operations-unit-fixture";
describe("one-click opportunity conversion", () => {
  it("marks an active opportunity won, provisions a default project and is idempotent", async () => {
    const f = await operationsFixture();
    const result = await f
      .c("owner")
      .mutation(api.operations.convertOpportunity, { opportunity_id: f.oid });
    expect(result.existing).toBe(false);
    const opportunity = await f.t.run((ctx) => ctx.db.get(f.oid));
    expect(opportunity?.stage).toBe("won");
    expect(opportunity?.probability).toBe(100);
    expect(opportunity?.won_at).toBeTruthy();
    const project = await f.t.run((ctx) => ctx.db.get(result.id));
    expect(project?.status).toBe("planning");
    expect(project?.package_type).toBe("standard");
    expect(project?.project_manager_id).toBe(f.who("owner").id);
    const checklist = await f.t.run((ctx) =>
      ctx.db
        .query("project_checklist_items")
        .withIndex("by_project", (q) => q.eq("project_id", result.id))
        .collect(),
    );
    expect(checklist.length).toBeGreaterThan(0);
    const again = await f
      .c("owner")
      .mutation(api.operations.convertOpportunity, { opportunity_id: f.oid });
    expect(again).toEqual({ id: result.id, existing: true });
  });
  it("converts a property directly, reusing its open opportunity or recording a won one", async () => {
    const f = await operationsFixture();
    const viaExisting = await f
      .c("owner")
      .mutation(api.operations.convertProperty, { property_id: f.pid });
    expect(viaExisting.existing).toBe(false);
    const reused = await f.t.run((ctx) => ctx.db.get(f.oid));
    expect(reused?.stage).toBe("won");
    const pid2 = await f.c("sales").mutation(api.sales.saveProperty, {
      version: 0,
      input: JSON.stringify({
        address_line_1: "77 Fictional Terrace",
        city: "Burnaby",
        province: "BC",
        property_type: "detached",
        occupancy_status: "vacant",
        realtor_id: f.r.id,
        seller_name: "PRIVATE",
        notes: "",
      }),
    });
    const direct = await f
      .c("owner")
      .mutation(api.operations.convertProperty, { property_id: pid2 });
    expect(direct.existing).toBe(false);
    const project = await f.t.run((ctx) => ctx.db.get(direct.id));
    const opportunity = await f.t.run((ctx) =>
      ctx.db.get(project!.opportunity_id),
    );
    expect(opportunity?.stage).toBe("won");
    expect(opportunity?.property_id).toBe(pid2);
    expect(opportunity?.assigned_to).toBe(f.who("owner").id);
    const again = await f
      .c("owner")
      .mutation(api.operations.convertProperty, { property_id: pid2 });
    expect(again).toEqual({ id: direct.id, existing: true });
    await expect(
      f.c("sales").mutation(api.operations.convertProperty, {
        property_id: pid2,
      }),
    ).rejects.toThrow();
  });
  it("refuses lost opportunities and non-admin callers", async () => {
    const f = await operationsFixture();
    for (const role of ["sales", "designer", "staging_crew"] as const)
      await expect(
        f.c(role).mutation(api.operations.convertOpportunity, {
          opportunity_id: f.oid,
        }),
      ).rejects.toThrow();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.oid, { stage: "lost" });
    });
    await expect(
      f.c("owner").mutation(api.operations.convertOpportunity, {
        opportunity_id: f.oid,
      }),
    ).rejects.toThrow("INVALID_INPUT");
  });
});
