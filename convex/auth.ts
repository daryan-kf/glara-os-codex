import {
  applicationOrigin,
  authenticationRedirect,
} from "../src/lib/security/origin";
import { productionCapabilityAllowed } from "../src/lib/security/preflight";
import { convexAuth } from "@convex-dev/auth/server";
import type { ConvexCredentialsUserConfig } from "@convex-dev/auth/providers/ConvexCredentials";
import { Password } from "@convex-dev/auth/providers/Password";
import { Email } from "@convex-dev/auth/providers/Email";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { ConvexError } from "convex/values";
const resetEmail = Email({
  id: "glara-email",
  from: "Glara Home Support <Support@glarahome.com>",
  maxAge: 15 * 60,
  async sendVerificationRequest({ identifier, token }) {
    if (
      process.env.AUTH_EMAIL_ENABLED !== "true" ||
      !productionCapabilityAllowed(process.env, "auth_email")
    )
      throw new Error("Email delivery is disabled.");
    const origin = applicationOrigin(
      process.env.SITE_URL,
      process.env.GLARA_ENVIRONMENT,
    );
    const key = process.env.AUTH_RESEND_KEY;
    if (!key) throw new Error("Email delivery is not configured.");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        from: "Glara Home Support <Support@glarahome.com>",
        to: identifier,
        subject: "Set your Glara OS password",
        text:
          "Use this single-use verification code to set or reset your Glara OS password:\n\n" +
          token +
          "\n\nOpen " +
          origin +
          "/update-password and enter your email, this code and a new password. The code expires in 15 minutes. If you did not request this, ignore this email. Support: Support@glarahome.com",
      }),
    });
    if (!response.ok) throw new Error("Email delivery failed.");
  },
});
const privatePassword = Password<DataModel>({
  profile(params) {
    if (params.flow === "signUp")
      throw new Error("Public registration is disabled.");
    return {
      email: z
        .email()
        .max(254)
        .parse(
          String(params.email ?? "")
            .trim()
            .toLowerCase(),
        ),
    };
  },
  validatePasswordRequirements(password) {
    z.string().min(6).max(128).parse(password);
  },
  reset: resetEmail,
});
const passwordOptions = (
  privatePassword as unknown as {
    options: ConvexCredentialsUserConfig<DataModel>;
  }
).options;
const authorizePassword = passwordOptions.authorize;
passwordOptions.authorize = async (params, ctx) => {
  const flow = String(params.flow ?? "");
  const email = String(params.email ?? "")
    .trim()
    .toLowerCase();
  const failure = () =>
    new ConvexError({
      code: "AUTHENTICATION_FAILED",
      message:
        "Unable to authenticate. Check your details or request a new recovery code.",
    });
  if (
    !["signIn", "reset", "reset-verification"].includes(flow) ||
    !z.email().max(254).safeParse(email).success ||
    JSON.stringify(params).length > 4096
  )
    throw failure();
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const permitted = await ctx.runMutation(internal.authSecurity.attempt, {
    key: digest,
    recovery: flow === "reset",
  });
  if (!permitted) {
    if (flow === "reset") return null;
    throw failure();
  }
  try {
    if (!(await ctx.runQuery(internal.authSecurity.eligible, { email })))
      throw failure();
    return await authorizePassword({ ...params, email }, ctx);
  } catch {
    // Recovery issuance must not reveal account existence, archive state, or delivery configuration.
    if (flow === "reset") return null;
    throw failure();
  }
};

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [privatePassword],
  session: {
    totalDurationMs: 7 * 24 * 60 * 60 * 1000,
    inactiveDurationMs: 24 * 60 * 60 * 1000,
  },
  jwt: { durationMs: 60 * 60 * 1000 },
  signIn: { maxFailedAttempsPerHour: 5 },
  callbacks: {
    async beforeSessionCreation(ctx, { userId }) {
      const profile = await (
        ctx as unknown as import("./_generated/server").MutationCtx
      ).db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (!profile || profile.deleted_at || !profile.roles.length)
        throw new Error("Access denied");
    },
    async redirect({ redirectTo }) {
      return authenticationRedirect(
        redirectTo,
        process.env.SITE_URL,
        process.env.GLARA_ENVIRONMENT,
      );
    },
  },
});
