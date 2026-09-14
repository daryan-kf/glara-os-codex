"use client";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { PageTitle } from "@/components/primitives";
import {
  Loading,
  Panel,
  Form,
  Field,
  Taxes,
  taxes,
  Disclosure,
} from "./shared";
export function CommercialSettings() {
  const data = useQuery(api.commercial.configuration, {}),
    save = useMutation(api.commercial.saveSettings),
    customer = useMutation(api.commercial.saveCustomer);
  if (!data) return <Loading />;
  return (
    <div className="space-y-6">
      <PageTitle
        title="Commercial settings"
        description="Document defaults and durable billing identities."
      />
      <Panel title="Document defaults">
        <Form
          version={data.settings.version}
          submit="Save defaults"
          onSave={(d, version) =>
            save({
              version,
              input: JSON.stringify({
                taxes: taxes(d),
                payment_terms: d.payment_terms,
                extension_terms: d.extension_terms,
                deposit_type: d.deposit_type,
                deposit_value: d.deposit_value,
              }),
            })
          }
        >
          <Taxes value={data.settings.taxes} />
          <Field
            label="Deposit type"
            name="deposit_type"
            options={["percentage", "fixed"]}
            value={data.settings.deposit_type}
          />
          <Field
            label="Deposit percentage or amount (CAD)"
            name="deposit_value"
            value={data.settings.deposit_value}
            required
          />
          <Field
            label="Payment terms"
            name="payment_terms"
            type="textarea"
            value={data.settings.payment_terms}
          />
          <Field
            label="Extension terms"
            name="extension_terms"
            type="textarea"
            value={data.settings.extension_terms}
          />
        </Form>
      </Panel>
      <Panel title="New billing customer">
        <Form
          submit="Create customer"
          onSave={(d) => customer({ version: 0, input: JSON.stringify(d) })}
        >
          <CustomerFields />
        </Form>
      </Panel>
      <Panel title="Billing customers">
        {data.customers.map((c) => (
          <Disclosure key={c._id} className="border-b p-4">
            <summary className="cursor-pointer">
              {c.bill_to.name} · {c.bill_to.type}
            </summary>
            <div className="mt-4">
              <Form
                version={c.version}
                submit="Update customer"
                onSave={(d, version) =>
                  customer({ id: c._id, version, input: JSON.stringify(d) })
                }
              >
                <CustomerFields value={c.bill_to} />
              </Form>
            </div>
          </Disclosure>
        ))}
        {!data.customers.length && (
          <p>
            No customers yet. Create one before preparing a commercial document.
          </p>
        )}
      </Panel>
    </div>
  );
}
function CustomerFields({
  value,
}: {
  value?: {
    type: string;
    name: string;
    contact: string;
    email: string;
    phone: string;
    address: string;
    company: string;
  };
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label="Customer type"
        name="type"
        value={value?.type ?? "seller"}
        options={["realtor", "seller", "brokerage", "company", "other"]}
      />
      <Field label="Billing name" name="name" value={value?.name} required />
      <Field label="Contact name" name="contact" value={value?.contact} />
      <Field label="Email" name="email" value={value?.email} type="email" />
      <Field label="Phone" name="phone" value={value?.phone} />
      <Field label="Company" name="company" value={value?.company} />
      <Field
        label="Billing address"
        name="address"
        value={value?.address}
        required
      />
    </div>
  );
}
