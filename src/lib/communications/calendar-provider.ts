import { z } from "zod";
export type CalendarProjection = {
  title: string;
  location: string;
  start: string;
  end: string;
  cancelled: boolean;
  revision: number;
};
export function calendarPayload(source: CalendarProjection, id: string) {
  const allDay =
    /^\d{4}-\d{2}-\d{2}$/.test(source.start) &&
    /^\d{4}-\d{2}-\d{2}$/.test(source.end);
  return {
    id,
    summary: source.title,
    location: source.location,
    start: allDay
      ? { date: source.start }
      : { dateTime: source.start, timeZone: "America/Vancouver" },
    end: allDay
      ? { date: source.end }
      : { dateTime: source.end, timeZone: "America/Vancouver" },
    visibility: "private",
    extendedProperties: { private: { glara: "m9" } },
  };
}
const remote = z.object({
  id: z.string(),
  etag: z.string(),
  status: z.string().optional(),
  attendees: z.array(z.unknown()).optional(),
  summary: z.string().optional(),
  location: z.string().optional(),
  start: z
    .object({ dateTime: z.string().optional(), date: z.string().optional() })
    .optional(),
  end: z
    .object({ dateTime: z.string().optional(), date: z.string().optional() })
    .optional(),
  extendedProperties: z
    .object({ private: z.record(z.string(), z.string()).optional() })
    .optional(),
});
export type RemoteEvent = z.infer<typeof remote>;
export interface CalendarProvider {
  getEvent(id: string): Promise<RemoteEvent | null>;
  createEvent(source: CalendarProjection, id: string): Promise<RemoteEvent>;
  updateEvent(
    source: CalendarProjection,
    id: string,
    etag: string,
  ): Promise<RemoteEvent>;
  cancelEvent(id: string, etag: string): Promise<void>;
}
export class GoogleCalendarProvider implements CalendarProvider {
  constructor(
    private token: string,
    private calendar: string,
  ) {}
  private url(id?: string) {
    return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendar)}/events${id ? "/" + encodeURIComponent(id) : ""}?sendUpdates=none`;
  }
  private async call(
    method: string,
    id?: string,
    body?: unknown,
    etag?: string,
  ) {
    const response = await fetch(this.url(id), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(etag ? { "If-Match": etag } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    return response;
  }
  async getEvent(id: string) {
    const r = await this.call("GET", id);
    if (r.status === 404 || r.status === 410) return null;
    if (!r.ok) throw new Error("calendar_unavailable");
    return remote.parse(await r.json());
  }
  async createEvent(source: CalendarProjection, id: string) {
    const r = await this.call("POST", undefined, calendarPayload(source, id));
    if (!r.ok)
      throw new Error(
        r.status === 409 ? "calendar_conflict" : "calendar_unknown",
      );
    return remote.parse(await r.json());
  }
  async updateEvent(source: CalendarProjection, id: string, etag: string) {
    const r = await this.call("PUT", id, calendarPayload(source, id), etag);
    if (!r.ok)
      throw new Error(
        r.status === 412 ? "calendar_conflict" : "calendar_unknown",
      );
    return remote.parse(await r.json());
  }
  async cancelEvent(id: string, etag: string) {
    const r = await this.call("DELETE", id, undefined, etag);
    if (!r.ok && r.status !== 410)
      throw new Error(
        r.status === 412 ? "calendar_conflict" : "calendar_unknown",
      );
  }
}
export function matchesProjection(
  remote: RemoteEvent,
  source: CalendarProjection,
) {
  const start = remote.start?.dateTime ?? remote.start?.date,
    end = remote.end?.dateTime ?? remote.end?.date;
  const same = (a: string | undefined, b: string) =>
    a === b ||
    (!!a && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b));
  return (
    !remote.attendees?.length &&
    remote.extendedProperties?.private?.glara === "m9" &&
    remote.summary === source.title &&
    (remote.location ?? "") === source.location &&
    same(start, source.start) &&
    same(end, source.end) &&
    remote.status !== "cancelled"
  );
}
