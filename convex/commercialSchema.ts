import { defineTable } from "convex/server";
import { v } from "convex/values";
const nullable = v.union(v.string(), v.null());
export const billValue = v.object({
  type: v.union(
    v.literal("realtor"),
    v.literal("seller"),
    v.literal("brokerage"),
    v.literal("company"),
    v.literal("other"),
  ),
  name: v.string(),
  contact: v.string(),
  email: v.string(),
  phone: v.string(),
  address: v.string(),
  company: v.string(),
});
export const taxValue = v.object({
  name: v.string(),
  basis_points: v.number(),
  amount_cents: v.string(),
});
export const totalsValue = {
  subtotal_cents: v.string(),
  discount_cents: v.string(),
  tax_lines: v.array(taxValue),
  tax_cents: v.string(),
  total_cents: v.string(),
};
const stamps = {
  created_at: v.string(),
  updated_at: v.string(),
  deleted_at: nullable,
  version: v.number(),
};
const evidence = v.object({
  name: v.string(),
  email: v.string(),
  method: v.string(),
  reference: v.string(),
  recorded_by: v.id("users"),
  recorded_at: v.string(),
});
const projectIdentity = v.object({
  project_number: v.string(),
  property_address: v.string(),
  realtor_name: v.string(),
});
const sourceKind = v.union(
  v.literal("manual"),
  v.literal("deposit"),
  v.literal("balance"),
  v.literal("extension"),
  v.literal("assessment"),
);
export const commercialTables = {
  commercial_customers: defineTable({ bill_to: billValue, ...stamps }).index(
    "by_active",
    ["deleted_at"],
  ),
  agreements: defineTable({
    number: v.string(),
    project_id: v.id("projects"),
    opportunity_id: v.id("opportunities"),
    source_quote_id: v.union(v.id("quotes"), v.null()),
    customer_id: v.id("commercial_customers"),
    bill_to: billValue,
    identity: projectIdentity,
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("superseded"),
      v.literal("cancelled"),
    ),
    terms: v.object({
      effective_date: v.string(),
      staging_start_date: v.string(),
      package_end_date: v.string(),
      description: v.string(),
      scope: v.string(),
      payment_terms: v.string(),
      extension_terms: v.string(),
      cancellation_terms: v.string(),
      liability_terms: v.string(),
      special_terms: v.string(),
      override_reason: v.string(),
      deposit_type: v.string(),
      deposit_value: v.string(),
    }),
    ...totalsValue,
    deposit_cents: v.string(),
    replaces_id: v.union(v.id("agreements"), v.null()),
    acceptance: v.union(evidence, v.null()),
    issued_at: nullable,
    created_by: v.id("users"),
    ...stamps,
  })
    .index("by_project", ["project_id"])
    .index("by_number", ["number"])
    .index("by_status", ["status"]),
  invoices: defineTable({
    number: v.string(),
    project_id: v.id("projects"),
    realtor_id: v.id("realtors"),
    agreement_id: v.union(v.id("agreements"), v.null()),
    customer_id: v.id("commercial_customers"),
    bill_to: billValue,
    identity: projectIdentity,
    status: v.union(v.literal("draft"), v.literal("issued"), v.literal("void")),
    source_type: sourceKind,
    source_id: nullable,
    issue_date: v.string(),
    due_date: v.string(),
    currency: v.literal("CAD"),
    notes: v.string(),
    ...totalsValue,
    issued_at: nullable,
    voided_at: nullable,
    voided_by: v.union(v.id("users"), v.null()),
    void_reason: v.string(),
    created_by: v.id("users"),
    ...stamps,
  })
    .index("by_project", ["project_id"])
    .index("by_agreement", ["agreement_id"])
    .index("by_source", ["source_type", "source_id"])
    .index("by_issue", ["issue_date"])
    .index("by_customer", ["customer_id", "issue_date"])
    .index("by_realtor", ["realtor_id", "issue_date"])
    .index("by_status_due", ["status", "due_date"])
    .index("by_number", ["number"]),
  invoice_items: defineTable({
    invoice_id: v.id("invoices"),
    description: v.string(),
    quantity: v.number(),
    unit_amount_cents: v.string(),
    ...totalsValue,
    source_type: sourceKind,
    source_id: nullable,
    sort_order: v.number(),
  }).index("by_invoice", ["invoice_id"]),
  payments: defineTable({
    number: v.string(),
    project_id: v.id("projects"),
    customer_id: v.id("commercial_customers"),
    payer: billValue,
    amount_cents: v.string(),
    currency: v.literal("CAD"),
    method: v.string(),
    received_date: v.string(),
    external_reference: v.string(),
    notes: v.string(),
    recorded_by: v.id("users"),
    created_at: v.string(),
    request_key: v.string(),
  })
    .index("by_project", ["project_id"])
    .index("by_received", ["received_date"])
    .index("by_request", ["request_key"])
    .index("by_number", ["number"]),
  payment_allocations: defineTable({
    payment_id: v.id("payments"),
    invoice_id: v.id("invoices"),
    amount_cents: v.string(),
    created_by: v.id("users"),
    created_at: v.string(),
  })
    .index("by_payment", ["payment_id"])
    .index("by_invoice", ["invoice_id"]),
  payment_reversals: defineTable({
    payment_id: v.id("payments"),
    reason: v.string(),
    created_by: v.id("users"),
    created_at: v.string(),
  }).index("by_payment", ["payment_id"]),
  credit_notes: defineTable({
    number: v.string(),
    invoice_id: v.id("invoices"),
    amount_cents: v.string(),
    reason: v.string(),
    created_by: v.id("users"),
    created_at: v.string(),
  })
    .index("by_invoice", ["invoice_id"])
    .index("by_number", ["number"]),
  package_extensions: defineTable({
    project_id: v.id("projects"),
    agreement_id: v.id("agreements"),
    original_end_date: v.string(),
    new_end_date: v.string(),
    type: v.union(
      v.literal("monthly"),
      v.literal("weekly"),
      v.literal("custom"),
    ),
    rate_cents: v.string(),
    quantity: v.number(),
    reason: v.string(),
    ...totalsValue,
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("cancelled"),
    ),
    approval: v.union(evidence, v.null()),
    created_by: v.id("users"),
    ...stamps,
  })
    .index("by_project", ["project_id"])
    .index("by_period", ["project_id", "original_end_date"])
    .index("by_status", ["status"]),
  damage_charge_assessments: defineTable({
    project_id: v.id("projects"),
    agreement_id: v.union(v.id("agreements"), v.null()),
    damage_record_id: v.id("inventory_damage"),
    product_id: v.id("products"),
    asset_id: v.union(v.id("inventory_assets"), v.null()),
    room_id: v.union(v.id("project_rooms"), v.null()),
    assessment_type: v.union(
      v.literal("damage"),
      v.literal("missing"),
      v.literal("other_inventory_loss"),
    ),
    status: v.union(
      v.literal("review_required"),
      v.literal("under_review"),
      v.literal("approved"),
      v.literal("no_charge"),
      v.literal("waived"),
      v.literal("cancelled"),
    ),
    customer_responsible: v.union(v.boolean(), v.null()),
    liability_basis: v.string(),
    valuation_basis: v.string(),
    liability_terms: v.string(),
    notes: v.string(),
    description: v.string(),
    proposed_amount_cents: v.string(),
    approved_amount_cents: v.string(),
    taxes: v.array(v.object({ name: v.string(), basis_points: v.number() })),
    evidence: v.object({
      product_name: v.string(),
      asset_number: v.string(),
      room: v.string(),
      incident_date: v.string(),
    }),
    approved_by: v.union(v.id("users"), v.null()),
    approved_at: nullable,
    decision_reason: v.string(),
    decided_by: v.union(v.id("users"), v.null()),
    decided_at: nullable,
    created_by: v.id("users"),
    ...stamps,
  })
    .index("by_project", ["project_id"])
    .index("by_damage", ["damage_record_id"])
    .index("by_status", ["status"]),
  commercial_settings: defineTable({
    key: v.string(),
    taxes: v.array(v.object({ name: v.string(), basis_points: v.number() })),
    payment_terms: v.string(),
    extension_terms: v.string(),
    deposit_type: v.string(),
    deposit_value: v.string(),
    version: v.number(),
  }).index("by_key", ["key"]),
  commercial_counters: defineTable({
    key: v.string(),
    value: v.number(),
  }).index("by_key", ["key"]),
};
