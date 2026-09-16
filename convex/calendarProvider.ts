"use node";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { calendarSource } from "./calendarSchema";
import { createHash } from "node:crypto";
import {
  GoogleCalendarProvider,
  matchesProjection,
} from "../src/lib/communications/calendar-provider";
import { z } from "zod";
export const sync = action({
  args: { source: calendarSource },
  handler: async (ctx, a): Promise<{ status: string }> => {
    const prepared = await ctx.runMutation(api.calendarSync.prepare, a);
    const external =
      prepared.external_id ||
      createHash("sha256")
        .update(`${prepared.calendar_id}:${prepared.id}`)
        .digest("hex");
    let status: "synced" | "cancelled" | "unknown" | "failed" | "conflict" =
        "unknown",
      code = "transport_uncertain",
      etag: string | undefined;
    let observed:
      | { start: string; end: string; has_attendees: boolean; missing: boolean }
      | undefined;
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.M9_GOOGLE_CLIENT_ID ?? "",
          client_secret: process.env.M9_GOOGLE_CLIENT_SECRET ?? "",
          refresh_token: process.env.M9_GOOGLE_REFRESH_TOKEN ?? "",
          grant_type: "refresh_token",
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        status = "failed";
        code = "calendar_configuration_rejected";
      } else {
        const data = z
            .object({ access_token: z.string() })
            .parse(await response.json()),
          provider = new GoogleCalendarProvider(
            data.access_token,
            prepared.calendar_id,
          ),
          remote = await provider.getEvent(external);
        if (remote && remote.id !== external)
          throw new Error("calendar_conflict");
        observed = {
          start: (remote?.start?.dateTime ?? remote?.start?.date ?? "").slice(
            0,
            80,
          ),
          end: (remote?.end?.dateTime ?? remote?.end?.date ?? "").slice(0, 80),
          has_attendees: !!remote?.attendees?.length,
          missing: !remote,
        };
        await ctx.runQuery(api.calendarSync.verifyDispatch, {
          id: prepared.id,
          version: prepared.revision,
        });
        if (
          remote?.attendees?.length ||
          (remote &&
            prepared.etag &&
            remote.etag !== prepared.etag &&
            !matchesProjection(remote, prepared.source)) ||
          (remote &&
            !prepared.etag &&
            !matchesProjection(remote, prepared.source))
        ) {
          status = "conflict";
          etag = remote!.etag;
          code = "external_event_changed";
        } else if (
          !remote &&
          prepared.external_id &&
          prepared.etag &&
          !prepared.source.cancelled &&
          prepared.etag !== "missing"
        ) {
          status = "conflict";
          etag = "missing";
          code = "external_event_missing";
        } else if (prepared.source.cancelled) {
          if (remote && remote.status !== "cancelled")
            await provider.cancelEvent(external, remote.etag);
          status = "cancelled";
          code = "cancelled";
        } else {
          const result = remote
            ? matchesProjection(remote, prepared.source)
              ? remote
              : await provider.updateEvent(
                  prepared.source,
                  external,
                  remote.etag,
                )
            : await provider.createEvent(prepared.source, external);
          if (result.id !== external) throw new Error("calendar_conflict");
          status = "synced";
          etag = result.etag;
          code = "synced";
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message === "calendar_conflict") {
        status = "conflict";
        code = "concurrent_provider_edit";
      }
    }
    await ctx.runMutation(internal.calendarSync.finish, {
      id: prepared.id,
      version: prepared.revision,
      actor_id: prepared.actor_id,
      external_id: external,
      status,
      etag,
      code,
      observed,
    });
    return { status };
  },
});
