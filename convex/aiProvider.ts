import { day } from "../src/lib/operations/model";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { z } from "zod";
import {
  insightSchema,
  systemInstructions,
  validateInsight,
  safeError,
  type Context,
  type Config,
  type Insight,
} from "../src/lib/ai/model";
export type ProviderInput = {
  context: Context;
  question: string;
  config: Config;
  model: string;
  history: { question: string; answer: string }[];
};
export type ProviderResult = {
  insight: Insight;
  input_tokens: number;
  output_tokens: number;
  usage_known: boolean;
};
export interface IntelligenceProvider {
  generateStructuredInsight(input: ProviderInput): Promise<ProviderResult>;
}
const responseSchema = z.object({
  status: z.string().optional(),
  output: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(z.object({ type: z.string(), text: z.string().optional() }))
        .optional(),
    }),
  ),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});
export class OpenAIProvider implements IntelligenceProvider {
  async generateStructuredInsight(
    input: ProviderInput,
  ): Promise<ProviderResult> {
    const key = process.env.OPENAI_API_KEY;
    if (!key || !input.model || !/^[-a-zA-Z0-9.]{1,100}$/.test(input.model))
      throw Error("AI_UNAVAILABLE");
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), input.config.timeout_ms);
    let inputTokens = 0,
      outputTokens = 0,
      usageKnown = true;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const data = {
          retrieved_at: input.context.retrieved_at,
          business_date: day(input.context.retrieved_at),
          timezone: "America/Vancouver",
          scope: input.context.scope.feature,
          evidence: input.context.evidence.map((e) => ({
            key: e.key,
            label: e.label,
            kind: e.kind,
            data: JSON.parse(e.data),
          })),
          limitations: input.context.limitations,
          can_propose: input.context.can_propose && input.config.proposals,
          existing_task_count: input.context.existing_task_ids.length,
        };
        const body = JSON.stringify({
          model: input.model,
          store: false,
          max_output_tokens: input.config.max_output_tokens,
          input: [
            { role: "system", content: systemInstructions },
            {
              role: "user",
              content: JSON.stringify({
                user_request: input.question,
                previous_untrusted_conversation: input.history,
                authorized_business_data: data,
              }),
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "glara_insight",
              strict: true,
              schema: z.toJSONSchema(insightSchema),
            },
          },
        });
        if (new TextEncoder().encode(body).length > 32768)
          throw Error("INSUFFICIENT_EVIDENCE");
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body,
          signal: controller.signal,
        });
        if (!response.ok) throw Error("AI_UNAVAILABLE");
        const raw = await response.text();
        if (raw.length > 100000) throw Error("INVALID_AI_OUTPUT");
        const parsed = responseSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) throw Error("INVALID_AI_OUTPUT");
        const result = parsed.data;
        inputTokens += result.usage?.input_tokens ?? 0;
        outputTokens += result.usage?.output_tokens ?? 0;
        usageKnown &&= !!result.usage;
        if (result.status && result.status !== "completed")
          throw Error("INVALID_AI_OUTPUT");
        try {
          const text = result.output
            .flatMap((x) => (x.type === "message" ? (x.content ?? []) : []))
            .filter((x) => x.type === "output_text")
            .map((x) => x.text ?? "")
            .join("");
          return {
            insight: validateInsight(JSON.parse(text), input.context),
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            usage_known: usageKnown,
          };
        } catch {
          if (attempt === 1) throw Error("INVALID_AI_OUTPUT");
        }
      }
      throw Error("INVALID_AI_OUTPUT");
    } catch (e) {
      if (controller.signal.aborted) throw Error("AI_TIMEOUT");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
function navigationAnswer(run: ProviderInput): string {
  const data = JSON.parse(run.context.evidence[0].data) as {
    modules: string[];
    metric_definitions: Record<string, string>;
  };
  const q = run.question.toLowerCase();
  const metric = q.includes("win rate")
    ? "win_rate"
    : q.includes("invoiced")
      ? "invoiced"
      : q.includes("collected") || q.includes("cash")
        ? "collected"
        : q.includes("receivable")
          ? "ar"
          : q.includes("staged")
            ? "staged"
            : null;
  return metric
    ? data.metric_definitions[metric]
    : "Open a module from the navigation menu: " +
        data.modules.join(", ") +
        ".";
}
export const generate = action({
  args: { id: v.id("ai_requests") },
  handler: async (ctx, a): Promise<void> => {
    const retrievalStarted = Date.now();
    let run: ProviderInput | null;
    try {
      run = await ctx.runMutation(internal.ai.begin, a);
    } catch (e) {
      throw new ConvexError({ code: safeError(e) });
    }
    if (!run) return;
    const started = Date.now();
    let result: ProviderResult | null = null,
      error: string | null = null;
    try {
      if (run.context.scope.feature === "navigation")
        result = {
          insight: {
            answer: navigationAnswer(run),
            why: "Navigation follows your current Glara OS permissions.",
            evidence_ids: run.context.evidence.map((x) => x.key),
            evidence_state: "strong",
            recommendations: [],
            draft: "",
            limitations: [],
            proposal: null,
          },
          input_tokens: 0,
          output_tokens: 0,
          usage_known: true,
        };
      else result = await new OpenAIProvider().generateStructuredInsight(run);
    } catch (e) {
      error = safeError(e);
    }
    await ctx.runMutation(internal.ai.finish, {
      id: a.id,
      output: result ? JSON.stringify(result.insight) : null,
      error,
      input_tokens: result?.input_tokens ?? 0,
      output_tokens: result?.output_tokens ?? 0,
      usage_known: result?.usage_known ?? false,
      provider_ms: Date.now() - started,
      retrieval_ms: started - retrievalStarted,
    });
  },
});
