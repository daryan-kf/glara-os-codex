import { z } from "zod";
export const providerEvent = z.object({
  type: z.string(),
  created_at: z.iso.datetime(),
  data: z.object({ email_id: z.string().min(1).max(200) }),
});
export function eventKind(type: string) {
  const kinds = {
    "email.sent": "accepted",
    "email.delivered": "delivered",
    "email.bounced": "hard_bounce",
    "email.complained": "complaint",
    "email.delivery_delayed": "soft_bounce",
    "email.failed": "failed",
  } as const;
  return kinds[type as keyof typeof kinds];
}
export type SendResult = {
  result: "accepted" | "unknown" | "retryable" | "rejected";
  provider_id?: string;
  code: string;
};
export interface EmailProvider {
  sendEmail(input: {
    key: string;
    to: string;
    subject: string;
    text: string;
    correlation?: string;
  }): Promise<SendResult>;
  getDeliveryStatus(id: string): Promise<{ id: string; status: string } | null>;
  verifyConfiguration(): boolean;
}
export class ResendProvider implements EmailProvider {
  constructor(private config: { key: string; from: string; replyTo: string }) {}
  verifyConfiguration() {
    return (
      !!this.config.key &&
      z.email().safeParse(this.config.from).success &&
      z.email().safeParse(this.config.replyTo).success
    );
  }
  async sendEmail(input: {
    key: string;
    to: string;
    subject: string;
    text: string;
    correlation?: string;
  }): Promise<SendResult> {
    if (!this.verifyConfiguration())
      return { result: "rejected", code: "configuration_rejected" };
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.key,
        },
        body: JSON.stringify({
          from: `Glara Home Staging <${this.config.from}>`,
          to: [input.to],
          reply_to: this.config.replyTo,
          subject: input.subject,
          text: input.text,
          ...(input.correlation
            ? { tags: [{ name: "glara_send", value: input.correlation }] }
            : {}),
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (response.ok) {
        const data = z
          .object({ id: z.string().min(1).max(200) })
          .safeParse(await response.json());
        return data.success
          ? { result: "accepted", provider_id: data.data.id, code: "accepted" }
          : { result: "unknown", code: "invalid_provider_response" };
      }
      if (response.status === 429)
        return { result: "retryable", code: "rate_limited" };
      if ([401, 403].includes(response.status))
        return { result: "rejected", code: "configuration_rejected" };
      return {
        result:
          response.status >= 500 || response.status === 409
            ? "unknown"
            : "rejected",
        code: "provider_rejected",
      };
    } catch {
      return { result: "unknown", code: "transport_uncertain" };
    }
  }
  async getDeliveryStatus(id: string) {
    const response = await fetch(
      `https://api.resend.com/emails/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${this.config.key}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) return null;
    const result = z
      .object({ id: z.string(), last_event: z.string() })
      .safeParse(await response.json());
    return result.success
      ? { id: result.data.id, status: result.data.last_event }
      : null;
  }
}
