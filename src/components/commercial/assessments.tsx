"use client";
import { CommercialHistory } from "./history";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PageTitle, StatusBadge } from "@/components/primitives";
import { liabilityBases, valuationBases } from "@/lib/commercial/model";
import {
  Loading,
  Panel,
  Form,
  Field,
  Taxes,
  taxes,
  ProjectLink,
  decimal,
  dollars,
} from "./shared";
import { SourceInvoice } from "./invoices";
export function AssessmentDetail({ id }: { id: string }) {
  const a = useQuery(api.commercial.assessment, {
      id: id as Id<"damage_charge_assessments">,
    }),
    review = useMutation(api.commercial.reviewAssessment),
    decide = useMutation(api.commercial.decideAssessment);
  if (!a) return <Loading />;
  return (
    <div className="space-y-6">
      <ProjectLink id={a.project_id} />
      <PageTitle
        title="Inventory charge assessment"
        description={`${a.evidence.product_name} · ${a.evidence.asset_number || "Quantity inventory"} · ${a.evidence.room}`}
      />
      <StatusBadge>{a.effective_status.replaceAll("_", " ")}</StatusBadge>
      {a.recovered_conflict && (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-5"
        >
          This missing item has been recovered. Review the existing charge and
          issue a credit or cancel the charge as appropriate.
        </p>
      )}
      {a.manage && <CommercialHistory id={a._id} />}
      <Panel title="Commercial evidence">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <dt>Incident</dt>
          <dd>
            {a.assessment_type} · {a.evidence.incident_date}
          </dd>
          <dt>Customer responsibility</dt>
          <dd>
            {a.customer_responsible === null
              ? "Unresolved"
              : a.customer_responsible
                ? "Responsible"
                : "No charge / waived"}
          </dd>
          <dt>Liability basis</dt>
          <dd>{a.liability_basis.replaceAll("_", " ")}</dd>
          <dt>Valuation basis</dt>
          <dd>{a.valuation_basis.replaceAll("_", " ")}</dd>
          <dt>Proposed amount</dt>
          <dd>{dollars(a.proposed_amount_cents)}</dd>
          <dt>Approved amount before tax</dt>
          <dd>{dollars(a.approved_amount_cents)}</dd>
          <dt>Decision</dt>
          <dd>{a.decision_reason || "Awaiting review"}</dd>
        </dl>
        <p className="mt-5 text-sm whitespace-pre-wrap">{a.notes}</p>
        <h3 className="mt-5 font-semibold">Accepted liability terms</h3>
        <p className="text-sm whitespace-pre-wrap">
          {a.liability_terms || "No agreement terms linked"}
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          Commercial decisions do not change inventory condition, availability,
          repair, or reconciliation.
        </p>
      </Panel>
      {a.manage && ["review_required", "under_review"].includes(a.status) && (
        <Panel title="Review assessment">
          <Form
            key={a.version}
            version={a.version}
            submit="Save assessment review"
            onSave={(d, version) =>
              review({
                id: a._id,
                version,
                input: JSON.stringify({
                  liability_basis: d.liability_basis,
                  valuation_basis: d.valuation_basis,
                  notes: d.notes,
                  description: d.description,
                  proposed_amount: d.proposed_amount,
                  taxes: taxes(d),
                }),
              })
            }
          >
            <Field
              label="Liability basis"
              name="liability_basis"
              value={a.liability_basis}
              options={liabilityBases}
            />
            <Field
              label="Valuation basis"
              name="valuation_basis"
              value={a.valuation_basis}
              options={valuationBases}
            />
            <Field
              label="Proposed amount (CAD)"
              name="proposed_amount"
              value={decimal(a.proposed_amount_cents)}
              required
            />
            <Field
              label="Customer-facing charge description"
              name="description"
              value={a.description}
              required
            />
            <Field
              label="Review evidence and rationale"
              name="notes"
              value={a.notes}
              type="textarea"
            />
            <Taxes value={a.taxes} />
          </Form>
        </Panel>
      )}
      {a.manage &&
        !a.invoice_id &&
        ["review_required", "under_review", "approved"].includes(a.status) && (
          <Panel title="Record liability decision">
            <Form
              key={a.version}
              version={a.version}
              submit="Confirm assessment decision"
              onSave={(d, version) =>
                decide({
                  id: a._id,
                  version,
                  decision: d.action as
                    "approve" | "no_charge" | "waive" | "cancel",
                  approved_amount:
                    d.action === "approve" ? d.approved_amount : "0",
                  reason: d.reason,
                })
              }
            >
              <Field
                label="Decision"
                name="action"
                options={
                  a.status === "under_review"
                    ? ["approve", "no_charge", "waive", "cancel"]
                    : ["no_charge", "waive", "cancel"]
                }
              />
              <Field
                label="Approved amount (CAD, before tax)"
                name="approved_amount"
                value={decimal(a.proposed_amount_cents)}
              />
              <Field label="Decision reason" name="reason" required />
              <p className="text-sm">
                No charge means no customer liability. Waiver records a
                deliberate decision to waive the charge.
              </p>
            </Form>
          </Panel>
        )}
      {a.manage && a.status === "approved" && !a.invoice_id && (
        <Panel title="Invoice approved charge">
          <SourceInvoice
            projectId={a.project_id}
            type="assessment"
            sourceId={a._id}
          />
        </Panel>
      )}
      {a.invoice_id && (
        <a
          className="inline-block rounded-lg border p-4 text-primary"
          href={`/invoices/${a.invoice_id}`}
        >
          Open charge invoice →
        </a>
      )}
    </div>
  );
}
