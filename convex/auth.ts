import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { Email } from "@convex-dev/auth/providers/Email";
import { z } from "zod";
const resetEmail = Email({
  id: "glara-email",
  from: "Glara Home Support <Support@glarahome.com>",
  maxAge: 15 * 60,
  async sendVerificationRequest({ identifier, token }) {
    const key = process.env.AUTH_RESEND_KEY;
    if (!key) throw new Error("Email delivery is not configured.");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Glara Home Support <Support@glarahome.com>",
        to: identifier,
        subject: "Set your Glara OS password",
        text:
          "Use this single-use verification code to set or reset your Glara OS password:\n\n" +
          token +
          "\n\nOpen " +
          process.env.SITE_URL +
          "/update-password and enter your email, this code and a new password. The code expires in 15 minutes. If you did not request this, ignore this email. Support: Support@glarahome.com",
      }),
    });
    if (!response.ok) throw new Error("Email delivery failed.");
  },
});
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
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
        z.string().min(12).max(128).parse(password);
      },
      reset: resetEmail,
    }),
  ],
  session: {
    totalDurationMs: 7 * 24 * 60 * 60 * 1000,
    inactiveDurationMs: 24 * 60 * 60 * 1000,
  },
  jwt: { durationMs: 60 * 60 * 1000 },
  signIn: { maxFailedAttempsPerHour: 5 },
  callbacks: {
    async redirect({ redirectTo }) {
      const base = process.env.SITE_URL;
      if (!base) throw new Error("Missing application origin.");
      const target = new URL(redirectTo, base);
      if (
        target.origin !== new URL(base).origin ||
        !["/login", "/update-password", "/dashboard"].includes(target.pathname)
      )
        throw new Error("Redirect not allowed.");
      return target.toString();
    },
  },
});
