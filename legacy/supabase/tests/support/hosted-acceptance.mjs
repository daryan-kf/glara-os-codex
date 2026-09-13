// Explicit opt-in hosted acceptance. Never imported by application code.
// Credentials arrive only in the process environment; output contains checks, not rows.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID, randomInt } from "node:crypto";
const ref = process.env.GLARA_ACCEPTANCE_PROJECT_REF;
const cli = process.env.GLARA_ACCEPTANCE_CLI;
const key = process.env.GLARA_ACCEPTANCE_KEY;
if (
  process.env.GLARA_ACCEPTANCE_ALLOW_DISPOSABLE !== "yes" ||
  !ref ||
  !cli ||
  !key
)
  throw new Error("Explicit disposable acceptance configuration required.");
const identity = JSON.parse(process.env.GLARA_ACCEPTANCE_IDENTITIES ?? "{}");
if (
  identity.project_ref !== ref ||
  readFileSync("supabase/.temp/project-ref", "utf8").trim() !== ref
)
  throw new Error("Project mismatch.");
const roles = [
  "owner",
  "sales",
  "admin",
  "marketing",
  "designer",
  "staging_crew",
  "unassigned",
  "archived",
];
for (const role of roles)
  if (!identity.users?.[role]?.email?.endsWith("@accounts.example.test"))
    throw new Error("Only reserved fictional test identities are allowed.");
const base = "https://" + ref + ".supabase.co";
const sessions = {};
const checks = [];
const run = "Fictional " + randomUUID().slice(0, 8);
class SafeFailure extends Error {
  constructor(code = "ASSERTION") {
    super(code);
    this.code = code;
  }
}
function ensure(condition, code = "ASSERTION") {
  if (!condition) throw new SafeFailure(code);
}
async function check(name, fn, severity = "P1") {
  try {
    await fn();
    checks.push({ name, status: "PASS" });
    console.log("PASS " + name);
  } catch (error) {
    const code =
      error instanceof SafeFailure
        ? error.code
        : "EXECUTION_" +
          (/^[A-Za-z]+$/.test(error?.name ?? "") ? error.name : "UNKNOWN");
    checks.push({ name, status: "FAIL", severity, code });
    console.log("FAIL " + name + " [" + code + "]");
  }
}
async function http(role, path, method = "GET", body, override) {
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (role)
    headers.Authorization =
      "Bearer " + (override ?? sessions[role]?.access_token);
  const response = await fetch(base + path, {
    method,
    headers,
    signal: AbortSignal.timeout(30000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}
function ok(response) {
  if (!response.ok)
    throw new SafeFailure(
      /^[A-Za-z0-9_]+$/.test(
        response.data?.error_code ?? response.data?.code ?? "",
      )
        ? (response.data.error_code ?? response.data.code)
        : "HTTP_" + response.status,
    );
  return response.data;
}
async function rpc(role, op, input = {}, mutation = false) {
  return http(
    role,
    "/rest/v1/rpc/" + (mutation ? "crm_mutate" : "crm_query"),
    "POST",
    { p_input: { op, ...input } },
  );
}
async function query(role, op, input = {}) {
  return ok(await rpc(role, op, input));
}
async function mutate(role, op, input = {}) {
  return ok(await rpc(role, op, input, true));
}
async function table(role, name, filter = "") {
  return ok(await http(role, "/rest/v1/" + name + "?select=*" + filter));
}
function sql(statement) {
  const result = spawnSync(cli, ["db", "query", "--linked", statement], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  if (result.status !== 0) throw new SafeFailure("ADMIN_SQL_FAILED");
  const start = result.stdout.indexOf("{");
  const data = JSON.parse(result.stdout.slice(start));
  if (!Array.isArray(data.rows)) throw new SafeFailure("ADMIN_SQL_SHAPE");
  return data.rows;
}
function uid(value) {
  if (!/^[0-9a-f-]{36}$/.test(value)) throw new SafeFailure("INVALID_UUID");
  return value;
}
const audit = async (id) => table("owner", "audit_logs", "&entity_id=eq." + id);
let office, realtor, source, original, baseData;
for (const role of roles)
  await check(role + ": Auth password login", async () => {
    const user = identity.users[role];
    sessions[role] = ok(
      await http(null, "/auth/v1/token?grant_type=password", "POST", {
        email: user.email,
        password: user.password,
      }),
    );
    ensure(
      sessions[role].user.id === user.id &&
        Boolean(sessions[role].refresh_token),
    );
  });
if (!roles.every((role) => sessions[role]?.access_token)) {
  saveResults();
  process.exit(1);
}
await check("Archive extra Sales profile after token issuance", async () => {
  ensure(Boolean(sessions.archived.access_token));
  sql(
    "update public.profiles set deleted_at=now() where id='" +
      uid(identity.users.archived.id) +
      "'",
  );
});
await check(
  "Public signup remains disabled",
  async () => {
    const response = await http(null, "/auth/v1/signup", "POST", {
      email: "signup-" + randomUUID() + "@accounts.example.test",
      password: identity.users.owner.password,
    });
    ensure(!response.ok);
  },
  "P0",
);
await check(
  "Create fictional brokerage, source, assigned prospect and initial next action",
  async () => {
    office = await mutate("owner", "brokerage_save", {
      data: { name: run + " Office", notes: "Fictional brokerage note" },
    });
    source = await mutate("admin", "source_save", {
      data: { name: run + " Source" },
    });
    let phone;
    for (let attempt = 0; attempt < 100; attempt++) {
      phone = "+160455501" + String(randomInt(100)).padStart(2, "0");
      if ((await query("owner", "list", { q: phone })).total === 0) break;
    }
    baseData = {
      first_name: "Fictional",
      last_name: run,
      email: randomUUID() + "@accounts.example.test",
      phone,
      assigned_to: identity.users.sales.id,
      relationship_status: "prospect",
      brokerage_id: office.id,
      lead_source_id: source.id,
      primary_city: "Fictional City",
      primary_area: "Fictional Area",
      notes: "Fictional private note",
      relationship_score: "40",
      next_title: "Fictional initial call",
      next_due_at: new Date(Date.now() + 86400000).toISOString(),
    };
    realtor = await mutate("sales", "realtor_create", {
      data: { ...baseData, created_by: identity.users.marketing.id },
    });
    const row = await query("owner", "detail", { id: realtor.id });
    ensure(
      row.brokerage_id === office.id &&
        row.assigned_to === identity.users.sales.id &&
        row.lead_source_id === source.id &&
        row.next_followup_date,
    );
    original = (
      await query("sales", "activities", { id: realtor.id, status: "open" })
    ).rows[0];
  },
);
if (!realtor?.id || !original?.id) {
  saveResults();
  process.exit(1);
}
for (const role of ["owner", "sales", "admin"])
  await check(role + ": operational reads, create and edit", async () => {
    ensure((await query(role, "list", { q: "Fictional" })).total >= 1);
    ensure(
      (await query(role, "detail", { id: realtor.id })).notes ===
        "Fictional private note",
    );
    const fixture = await mutate(role, "realtor_create", {
      data: {
        first_name: "Fictional",
        last_name: run + role,
        assigned_to: identity.users[role].id,
        relationship_status: "dormant",
      },
    });
    await mutate(role, "realtor_update", {
      id: fixture.id,
      version: 1,
      data: {
        first_name: "Fictional",
        last_name: run + role + " Edited",
        assigned_to: identity.users[role].id,
        relationship_status: "dormant",
      },
    });
    ensure((await query(role, "detail", { id: fixture.id })).version === 2);
  });
await check(
  "Marketing safe directory, source and owner display; no roster or private fields",
  async () => {
    const row = await query("marketing", "detail", { id: realtor.id });
    ensure(
      row.owner_name === "Fictional sales" &&
        !Object.hasOwn(row, "notes") &&
        !Object.hasOwn(row, "relationship_score"),
    );
    ensure((await query("marketing", "sources")).owners.length === 0);
    ensure(
      (await query("marketing", "sources")).sources.some(
        (s) => s.id === source.id,
      ),
    );
    ensure((await rpc("marketing", "choices")).data.code === "42501");
    const profiles = await table("marketing", "profiles"),
      assignments = await table("marketing", "user_roles");
    ensure(
      profiles.length === 1 && profiles[0].id === identity.users.marketing.id,
    );
    ensure(assignments.length === 1 && assignments[0].role === "marketing");
    for (const name of ["realtor_private", "activities", "brokerages"])
      ensure((await table("marketing", name)).length === 0);
    ensure(
      (
        await rpc(
          "marketing",
          "brokerage_save",
          { data: { name: run + " Forbidden" } },
          true,
        )
      ).data.code === "42501",
    );
  },
  "P0",
);
for (const role of ["designer", "staging_crew", "unassigned", "archived"])
  await check(
    role + ": RPC and direct RLS denial",
    async () => {
      ensure((await rpc(role, "list")).data.code === "42501");
      ensure(
        (await rpc(role, "realtor_create", { data: baseData }, true)).data
          .code === "42501",
      );
      for (const name of [
        "realtors",
        "realtor_private",
        "activities",
        "brokerages",
        "lead_sources",
      ])
        ensure((await table(role, name)).length === 0);
    },
    "P0",
  );
await check(
  "Anonymous table and RPC access denied",
  async () => {
    ensure(!(await http(null, "/rest/v1/realtors?select=id")).ok);
    ensure(!(await rpc(null, "list")).ok);
    ensure(!(await rpc(null, "realtor_create", { data: baseData }, true)).ok);
  },
  "P0",
);
for (const role of roles)
  await check(
    role + ": direct table DML denied",
    async () => {
      const response = await http(
        role,
        "/rest/v1/realtors?id=eq." + realtor.id,
        "PATCH",
        { first_name: "Forbidden" },
      );
      ensure(!response.ok && response.data.code === "42501");
      const insert = await http(role, "/rest/v1/brokerages", "POST", {
        name: run + " Forbidden direct",
      });
      ensure(!insert.ok && insert.data.code === "42501");
    },
    "P0",
  );
await check("Sales cannot manage sources; Owner and Admin can", async () => {
  ensure(
    (
      await rpc(
        "sales",
        "source_save",
        { data: { name: run + " Forbidden" } },
        true,
      )
    ).data.code === "42501",
  );
  await mutate("owner", "source_save", {
    id: source.id,
    data: { name: run + " Source renamed" },
  });
});
await check("Search and combined filters", async () => {
  const found = await query("sales", "list", {
    q: baseData.email,
    brokerage_id: office.id,
    lead_source_id: source.id,
    assigned_to: identity.users.sales.id,
    status: "prospect",
    area: "Fictional",
  });
  ensure(found.total === 1 && found.rows[0].id === realtor.id);
  ensure(
    (await query("sales", "list", { q: baseData.phone })).rows.some(
      (r) => r.id === realtor.id,
    ),
  );
});
await check(
  "Edit, stale version, duplicate email/phone and failed-write audit rollback",
  async () => {
    const edit = { ...baseData };
    delete edit.next_title;
    delete edit.next_due_at;
    await mutate("sales", "realtor_update", {
      id: realtor.id,
      version: 1,
      data: { ...edit, primary_area: "Fictional Area" },
    });
    const before = (await audit(realtor.id)).length;
    ensure(
      !(
        await rpc(
          "admin",
          "realtor_update",
          { id: realtor.id, version: 1, data: edit },
          true,
        )
      ).ok,
    );
    for (const patch of [
      { phone: "" },
      { email: randomUUID() + "@accounts.example.test" },
    ])
      ensure(
        (
          await rpc(
            "owner",
            "realtor_create",
            { data: { ...baseData, ...patch } },
            true,
          )
        ).data.code === "23505",
      );
    ensure((await audit(realtor.id)).length === before);
    ensure(
      (await query("owner", "detail", { id: realtor.id })).primary_area ===
        "Fictional Area",
    );
  },
);
await check(
  "Last-action cancellation and invalid reschedule roll back without audit",
  async () => {
    const before = (await audit(original.id)).length;
    ensure(
      !(
        await rpc(
          "sales",
          "activity_cancel",
          { id: original.id, data: {} },
          true,
        )
      ).ok,
    );
    ensure(
      !(
        await rpc(
          "sales",
          "activity_reschedule",
          { id: original.id, data: { next_title: "No date" } },
          true,
        )
      ).ok,
    );
    ensure((await audit(original.id)).length === before);
    ensure(
      (
        await query("sales", "activities", { id: realtor.id, status: "open" })
      ).rows.some((r) => r.id === original.id),
    );
  },
);
await check(
  "Atomic reschedule preserves original due date, cancelled status and replacement link",
  async () => {
    await mutate("sales", "activity_reschedule", {
      id: original.id,
      data: {
        next_title: "Fictional rescheduled",
        next_due_at: new Date(Date.now() + 172800000).toISOString(),
      },
    });
    const rows = (await query("owner", "activities", { id: realtor.id })).rows;
    const old = rows.find((r) => r.id === original.id),
      replacement = rows.find((r) => r.replaces_activity_id === original.id);
    ensure(
      old.status === "cancelled" &&
        old.completed_at === null &&
        old.due_at === original.due_at,
    );
    ensure(
      replacement?.status === "open" &&
        replacement.assigned_to === original.assigned_to,
    );
    ensure(
      !(
        await rpc(
          "sales",
          "activity_reschedule",
          {
            id: original.id,
            data: {
              next_title: "Repeated",
              next_due_at: new Date().toISOString(),
            },
          },
          true,
        )
      ).ok,
    );
  },
);
await check(
  "Create task/follow-up, complete, cancel without replacement and cancel with replacement",
  async () => {
    const data = {
      realtor_id: realtor.id,
      type: "task",
      title: "Fictional task",
      status: "open",
      due_at: new Date(Date.now() + 86400000).toISOString(),
      assigned_to: identity.users.sales.id,
    };
    const task = await mutate("sales", "activity_create", { data });
    await mutate("sales", "activity_complete", { id: task.id, data: {} });
    const next = await mutate("admin", "activity_create", {
      data: { ...data, type: "follow_up", title: "Fictional extra followup" },
    });
    await mutate("admin", "activity_cancel", { id: next.id, data: {} });
    const last = (
      await query("sales", "activities", { id: realtor.id, status: "open" })
    ).rows[0];
    await mutate("sales", "activity_cancel", {
      id: last.id,
      data: {
        next_title: "Fictional next conversation",
        next_due_at: new Date(Date.now() + 259200000).toISOString(),
      },
    });
    const rows = (await query("owner", "activities", { id: realtor.id })).rows;
    ensure(rows.find((r) => r.id === task.id).completed_at);
    ensure(
      rows.find((r) => r.id === next.id).status === "cancelled" &&
        rows.find((r) => r.id === next.id).completed_at === null,
    );
    ensure(rows.filter((r) => r.status === "open").length === 1);
    await mutate("sales", "activity_create", {
      data: {
        ...data,
        type: "call",
        status: "completed",
        title: "Fictional call",
      },
    });
    await mutate("sales", "activity_create", {
      data: {
        ...data,
        type: "note",
        status: "completed",
        title: "Fictional note",
      },
    });
    ensure(
      (await query("owner", "detail", { id: realtor.id })).last_contact_date,
    );
  },
);
await check(
  "Realtor archive, archived edit denial and Sales restore denial; Admin/Owner recovery",
  async () => {
    let row = await query("owner", "detail", { id: realtor.id });
    await mutate("sales", "realtor_archive", {
      id: realtor.id,
      version: row.version,
    });
    ensure((await query("sales", "detail", { id: realtor.id })) === null);
    ensure((await query("marketing", "detail", { id: realtor.id })) === null);
    row = await query("owner", "detail", { id: realtor.id });
    ensure(
      (
        await rpc(
          "sales",
          "realtor_restore",
          { id: realtor.id, version: row.version },
          true,
        )
      ).data.code === "42501",
    );
    ensure(
      !(
        await rpc(
          "owner",
          "realtor_update",
          { id: realtor.id, version: row.version, data: baseData },
          true,
        )
      ).ok,
    );
    await mutate("admin", "realtor_restore", {
      id: realtor.id,
      version: row.version,
    });
    row = await query("owner", "detail", { id: realtor.id });
    await mutate("owner", "realtor_archive", {
      id: realtor.id,
      version: row.version,
    });
    row = await query("owner", "detail", { id: realtor.id });
    await mutate("owner", "realtor_restore", {
      id: realtor.id,
      version: row.version,
    });
    ensure(
      (await query("sales", "detail", { id: realtor.id })).deleted_at === null,
    );
  },
);
await check(
  "Brokerage real concurrent writers, missing version and stale rejection",
  async () => {
    const row = await query("owner", "brokerage", { id: office.id });
    const responses = await Promise.all(
      ["sales", "admin"].map((role) =>
        rpc(
          role,
          "brokerage_save",
          {
            id: office.id,
            version: row.version,
            data: { name: run + " Office " + role },
          },
          true,
        ),
      ),
    );
    ensure(
      responses.filter((r) => r.ok).length === 1,
      "CONCURRENT_WINNER_COUNT",
    );
    ensure(responses.find((r) => !r.ok).data.code === "PT409");
    ensure(
      (await query("owner", "brokerage", { id: office.id })).version ===
        row.version + 1,
    );
    ensure(
      (
        await rpc(
          "owner",
          "brokerage_save",
          { id: office.id, data: { name: run + " Missing version" } },
          true,
        )
      ).data.code === "PT409",
    );
  },
);
await check(
  "Archived brokerage rejects Owner/Admin/Sales crafted edits and preserves audit",
  async () => {
    sql(
      "update public.brokerages set deleted_at=now() where id='" +
        uid(office.id) +
        "'",
    );
    const before = JSON.stringify(
        await table("owner", "brokerages", "&id=eq." + office.id),
      ),
      count = (await audit(office.id)).length;
    const version = JSON.parse(before)[0].version;
    for (const role of ["owner", "admin", "sales"])
      ensure(
        (
          await rpc(
            role,
            "brokerage_save",
            {
              id: office.id,
              version,
              data: { name: "Fictional forbidden", deleted_at: null },
            },
            true,
          )
        ).data.code === "42501",
        "ARCHIVED_DENIAL_" + role.toUpperCase(),
      );
    ensure(
      JSON.stringify(
        await table("owner", "brokerages", "&id=eq." + office.id),
      ) === before,
      "ARCHIVED_ROW_CHANGED",
    );
    ensure((await audit(office.id)).length === count, "ARCHIVED_AUDIT_CHANGED");
  },
);
await check(
  "Audit actors cannot be forged; original/replacement, archive/restore and offices recorded",
  async () => {
    const created = await audit(realtor.id);
    ensure(
      created.some(
        (r) => r.action === "INSERT" && r.actor_id === identity.users.sales.id,
      ),
    );
    ensure(
      created
        .filter((r) => r.action === "INSERT")
        .every((r) => r.actor_id !== identity.users.marketing.id),
    );
    ensure(
      created.some((r) => r.new_value?.deleted_at) &&
        created.some(
          (r) => r.old_value?.deleted_at && r.new_value?.deleted_at === null,
        ),
    );
    const activity = await audit(original.id);
    ensure(
      activity.some(
        (r) =>
          r.new_value?.status === "cancelled" &&
          r.actor_id === identity.users.sales.id,
      ),
    );
    ensure(
      (
        await table(
          "owner",
          "audit_logs",
          "&entity=eq.activities&action=eq.INSERT",
        )
      ).some((r) => r.new_value?.replaces_activity_id === original.id),
    );
    ensure(
      (await audit(office.id)).some(
        (r) =>
          r.action === "UPDATE" &&
          [identity.users.sales.id, identity.users.admin.id].includes(
            r.actor_id,
          ),
      ),
    );
  },
  "P0",
);
for (const role of roles.filter((r) => r !== "owner"))
  await check(
    role + ": audit logs hidden",
    async () => ensure((await table(role, "audit_logs")).length === 0),
    "P0",
  );
for (const role of [
  "owner",
  "sales",
  "admin",
  "marketing",
  "designer",
  "staging_crew",
  "unassigned",
  "archived",
])
  await check(role + ": session refresh preserves scope", async () => {
    sessions[role] = ok(
      await http(null, "/auth/v1/token?grant_type=refresh_token", "POST", {
        refresh_token: sessions[role].refresh_token,
      }),
    );
    const response = await rpc(role, "list");
    ensure(
      ["owner", "sales", "admin", "marketing"].includes(role)
        ? response.ok
        : response.data.code === "42501",
    );
  });
for (const role of roles)
  await check(role + ": Auth logout invalidates session", async () => {
    ok(await http(role, "/auth/v1/logout", "POST", {}));
    ensure(!(await http(role, "/auth/v1/user")).ok);
  });
saveResults();
function saveResults() {
  const result = {
    project_ref: ref,
    project_name: "glara-os-acceptance",
    started_from_commit: process.env.GLARA_ACCEPTANCE_COMMIT,
    date: new Date().toISOString(),
    fictional_data_only: true,
    checks,
    passed: checks.filter((c) => c.status === "PASS").length,
    failed: checks.filter((c) => c.status === "FAIL").length,
  };
  writeFileSync(
    "docs/M1-hosted-api-results.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    "Hosted checks: " +
      result.passed +
      " passed; " +
      result.failed +
      " failed. No credentials or row contents recorded.",
  );
  process.exitCode = result.failed ? 1 : 0;
}
