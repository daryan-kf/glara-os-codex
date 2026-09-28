"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { receiptConfigured } from "../src/lib/campaigns/receipt";
import { ResendProvider } from "../src/lib/communications/provider";
export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    if (
      !receiptConfigured(process.env) ||
      (await ctx.runQuery(internal.emergency.blocked, { capability: "email" }))
    )
      return;
    await ctx.runMutation(internal.campaignReceipts.sweep, {});
    const sender = new ResendProvider({
      key: process.env.GLARA_EXPO_RESEND_KEY!,
      from: "Support@glarahome.com",
      replyTo: "Support@glarahome.com",
    });
    for (const id of await ctx.runQuery(internal.campaignReceipts.due, {})) {
      const row = await ctx.runMutation(internal.campaignReceipts.claim, {
        id,
      });
      if (!row) continue;
      if (
        !(await ctx.runQuery(internal.campaignReceipts.dispatchAllowed, { id }))
      ) {
        await ctx.runMutation(internal.campaignReceipts.outcome, {
          id,
          result: "rejected",
          code: "dispatch_blocked",
        });
        continue;
      }
      const result = await sender.sendEmail({
        key: row.key,
        to: row.email,
        subject: row.subject,
        text: row.body,
      });
      await ctx.runMutation(internal.campaignReceipts.outcome, {
        id,
        ...result,
      });
    }
  },
});
