import { v } from "convex/values";
export const capabilities = [
  "automation",
  "ai",
  "email",
  "calendar",
  "onboarding",
  "financial",
  "inventory",
] as const;
export const capabilityValue = v.union(...capabilities.map(v.literal));
export type Capability = (typeof capabilities)[number];
