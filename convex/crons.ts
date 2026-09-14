import { cronJobs, makeFunctionReference } from "convex/server";
const crons = cronJobs();
crons.interval(
  "automation-due-queue",
  { minutes: 5 },
  makeFunctionReference<"action">("automation:tick"),
);
export default crons;
