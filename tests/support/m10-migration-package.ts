import { randomUUID } from "node:crypto";
import { day } from "../../src/lib/operations/model";
export function fictionalMigrationPackage(f: {
  who: (role: "owner" | "sales" | "admin" | "designer" | "staging_crew") => {
    id: string;
  };
  oid: string;
  createArgs: Record<string, unknown>;
}) {
  const ref = ($ref: string) => ({ $ref });
  const row = (
    stable_id: string,
    operation: string,
    args: Record<string, unknown>,
  ) => ({ stable_id, operation, args });
  return {
    version: 1,
    key: "fictional-m10-native",
    source_type: "fictional-development-command-package",
    source_sha: "7b3992e344534ff68b78be4ac84846fbf950527c",
    transform_version: 1,
    staff: Object.fromEntries(
      (["owner", "sales", "admin", "designer", "staging_crew"] as const).map(
        (role) => [role, f.who(role).id],
      ),
    ),
    rows: [
      row("realtor", "crm:write", {
        input: {
          op: "realtor_create",
          data: {
            first_name: "Migration",
            last_name: "Fictional",
            relationship_status: "active_partner",
            assigned_to: ref("sales"),
          },
        },
      }),
      row("property", "sales:saveProperty", {
        version: 0,
        input: {
          address_line_1: "99 Fictional Migration Crescent",
          city: "Vancouver",
          province: "BC",
          property_type: "detached",
          occupancy_status: "vacant",
          realtor_id: ref("realtor"),
        },
      }),
      row("opportunity", "sales:saveOpportunity", {
        version: 0,
        input: {
          property_id: ref("property"),
          assigned_to: ref("sales"),
          estimated_value: "1000",
          probability: 20,
          next_action_title: "Fictional migration follow-up",
          next_action_date: "2099-01-01T18:00:00Z",
        },
      }),
      row("project", "operations:create", { ...f.createArgs }),
      row("category", "inventory:saveCategory", {
        name: "Migration chairs",
        active: true,
        version: 0,
      }),
      row("location", "inventory:saveLocation", {
        version: 0,
        input: {
          name: "Migration fictional warehouse",
          type: "warehouse",
          address: "Fictional",
          active: true,
          staging_source: true,
          retail_source: true,
        },
      }),
      row("product", "inventory:saveProduct", {
        category_id: ref("category"),
        version: 0,
        input: {
          sku: "m10-migration-chair",
          name: "Fictional migration chair",
          track_mode: "quantity",
          staging_eligible: true,
          retail_eligible: true,
          active: true,
        },
      }),
      row("receipt", "inventory:receive", {
        product_id: ref("product"),
        location_id: ref("location"),
        quantity: 10,
        condition: "good",
        acquisition_date: day(),
        reason: "Fictional migration receipt",
      }),
      row("customer", "commercial:saveCustomer", {
        version: 0,
        input: {
          type: "seller",
          name: "Fictional migration seller",
          email: "fictional@example.test",
          phone: "",
          contact: "",
          company: "",
          address: "Fictional migration address",
        },
      }),
      row("invoice", "commercial:saveInvoice", {
        project_id: ref("project"),
        customer_id: ref("customer"),
        version: 0,
        input: {
          issue_date: day(),
          due_date: day(),
          notes: "Fictional migration",
          items: [
            {
              description: "Fictional staging",
              quantity: 1,
              unit_amount: "100",
              discount: "0",
              taxes: [],
            },
          ],
        },
      }),
      row("issued", "commercial:invoiceAction", {
        id: ref("invoice"),
        version: 1,
        action: "issue",
        reason: "Fictional migration",
      }),
      row("payment", "commercial:recordPayment", {
        project_id: ref("project"),
        customer_id: ref("customer"),
        amount: "25",
        method: "e_transfer",
        received_date: day(),
        external_reference: "Fictional",
        notes: "Fictional",
        request_key: randomUUID(),
        allocations: [{ invoice_id: ref("invoice"), amount: "25" }],
      }),
      row("settings", "communications:saveSettings", {
        version: 0,
        signature: "Fictional migration sender",
        secondary_approval: true,
        paused: true,
      }),
    ],
  };
}
