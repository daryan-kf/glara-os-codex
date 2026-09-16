import { cronJobs, makeFunctionReference } from "convex/server";
const crons = cronJobs();
crons.interval(
  "automation-due-queue",
  { minutes: 5 },
  makeFunctionReference<"action">("automation:tick"),
);
crons.interval(
  "ai-conversation-retention",
  { hours: 1 },
  makeFunctionReference<"mutation">("ai:retentionSweep"),
);
crons.interval(
  "communications-outbox",
  { minutes: 1 },
  makeFunctionReference<"action">("communicationProvider:tick"),
);
export default crons;
