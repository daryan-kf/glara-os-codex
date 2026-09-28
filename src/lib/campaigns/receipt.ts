// This receipt confirms a submitted form, never a prize or marketing subscription.
export const receiptVersion = "pacificwest-receipt-v1";
export function receiptContent(closesAt: number) {
  const closing = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Vancouver",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(closesAt);
  return {
    subject: "We received your Glara Staging giveaway registration",
    body: [
      "Thank you for registering for the PacificWest Conference — $2,000 Glara Staging Realtor Giveaway.",
      "We have received your registration. One eligible entry is allowed per Realtor; submitting again does not increase your chances.",
      `Registration closes ${closing} Pacific Time (Vancouver).`,
      "There is one prize: a CAD $2,000 Glara Staging Credit. This email is a receipt, not a winner confirmation or a gift card. Entries remain subject to the Official Rules and eligibility verification. The selected entrant must correctly answer a mathematical skill-testing question before being confirmed as the winner.",
      "Your optional marketing preference is separate from your giveaway entry. This receipt does not subscribe you to marketing emails.",
      "Official Rules and Privacy Notice: https://glarahome.com/win",
      "If you did not submit this registration, please contact Support@glarahome.com.",
      "Glara Staging\nGlara Import Ltd., operating as Glara Home / Glara Staging\nBritish Columbia, Canada\nSupport@glarahome.com",
    ].join("\n\n"),
  };
}
export function receiptConfigured(env: Record<string, string | undefined>) {
  return (
    env.GLARA_EXPO_RECEIPTS_ENABLED === "true" &&
    ["test", "live"].includes(env.GLARA_EXPO_RECEIPTS_MODE ?? "") &&
    env.GLARA_EXPO_RECEIPTS_VERIFIED === "true" &&
    !!env.GLARA_EXPO_RESEND_KEY &&
    !!env.M9_RESEND_WEBHOOK_SECRET &&
    (env.GLARA_ENVIRONMENT === "production"
      ? env.GLARA_PUBLIC_CAMPAIGN_ONLY === "true" &&
        env.GLARA_PRODUCTION_EXPO_RECEIPTS_APPROVED === "true"
      : env.GLARA_ENVIRONMENT === "development" &&
        !!env.GLARA_EXPO_RECEIPT_TEST_INBOX)
  );
}
