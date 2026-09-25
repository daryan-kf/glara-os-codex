export const roles = [
  "owner",
  "sales",
  "designer",
  "staging_crew",
  "admin",
  "marketing",
] as const;
export type Role = (typeof roles)[number];
export const modules = {
  security: {
    title: "Security & operations",
    description: "Emergency controls and operational evidence.",
    milestone: "M10A",
    detail: "Authorized health review and incident containment.",
  },
  communications: {
    title: "Communications",
    description: "Thoughtful communication, confidently delivered.",
    milestone: "M9",
    detail:
      "Reviewed messages, recipient preferences, and accountable delivery.",
  },
  copilot: {
    title: "Ask Glara",
    description: "Evidence-grounded intelligence.",
    milestone: "M8",
    detail:
      "Permission-safe answers, drafts and human-reviewed task proposals.",
  },
  dashboard: {
    title: "Dashboard",
    description: "Your company, thoughtfully connected.",
    milestone: "M6",
    detail:
      "A clear view of company performance, daily priorities, and the actions that move your business forward.",
  },
  realtors: {
    title: "Realtors",
    description: "Relationships that grow with you.",
    milestone: "M1",
    detail:
      "Bring brokerage contacts, conversations, and follow-ups together in one complete relationship profile.",
  },
  opportunities: {
    title: "Opportunities",
    description: "From first conversation to a confident yes.",
    milestone: "M2",
    detail:
      "Track every property opportunity with a clear owner, stage, and next action.",
  },
  properties: {
    title: "Properties",
    description: "Every detail, in one place.",
    milestone: "M2",
    detail:
      "Connect property details, consultations, measurements, and media to the entire staging journey.",
  },
  projects: {
    title: "Projects",
    description: "Exceptional spaces. Seamless delivery.",
    milestone: "M3",
    detail:
      "Coordinate design, scheduling, staging, and destaging with shared project checklists.",
  },
  calendar: {
    title: "Calendar",
    description: "A little more clarity in every day.",
    milestone: "M3",
    detail:
      "Plan consultations, staging days, and crew assignments in a shared company calendar.",
  },
  inventory: {
    title: "Inventory",
    description: "Beautiful pieces, precisely accounted for.",
    milestone: "M4",
    detail:
      "Manage the product catalog and individual physical assets, with reservations, condition records, and movement history.",
  },
  quotes: {
    title: "Quotes",
    description: "A polished proposal for every property.",
    milestone: "M2",
    detail:
      "Prepare itemized quotes with transparent pricing, configurable discount governance, and clear acceptance status.",
  },
  payments: {
    title: "Payments",
    description: "Confidence in every transaction.",
    milestone: "M5",
    detail:
      "Connect invoices, deposits, and outstanding balances to their agreements and projects.",
  },
  marketing: {
    title: "Marketing",
    description: "Turn great work into your next opportunity.",
    milestone: "M6",
    detail:
      "Connect campaigns, referrals, reviews, and project stories to measurable growth.",
  },
  reports: {
    title: "Reports",
    description: "See the bigger picture.",
    milestone: "M6",
    detail:
      "Understand revenue, conversion, capacity, and the relationships driving repeat business.",
  },
  automation: {
    title: "Automation",
    description: "Reliable follow-through.",
    milestone: "M7",
    detail: "Versioned rules, internal tasks, and accountable outcomes.",
  },
  notifications: {
    title: "Notifications",
    description: "The right update at the right time.",
    milestone: "M7",
    detail:
      "Stay informed about follow-ups, operational changes, and important team actions.",
  },
  settings: {
    title: "Settings",
    description: "A foundation tailored to Glara.",
    milestone: "M0",
    detail:
      "Company configuration and user administration will be introduced alongside the modules they support.",
  },
  help: {
    title: "Help",
    description: "Glara OS user guide",
    milestone: "M0",
    detail:
      "Step-by-step guidance for everyday workflows and current features.",
  },
  profile: {
    title: "Profile",
    description: "Your place in Glara OS.",
    milestone: "M0",
    detail:
      "Update your display name and password; roles and access are managed by your company owner.",
  },
} as const;
export type Module = keyof typeof modules;
const grants: Record<Exclude<Role, "owner">, readonly Module[]> = {
  sales: [
    "help",
    "communications",
    "projects",
    "copilot",
    "dashboard",
    "realtors",
    "opportunities",
    "properties",
    "calendar",
    "quotes",
    "notifications",
    "profile",
  ],
  designer: [
    "help",
    "copilot",
    "dashboard",
    "properties",
    "projects",
    "calendar",
    "inventory",
    "notifications",
    "profile",
  ],
  staging_crew: [
    "help",
    "copilot",
    "dashboard",
    "projects",
    "calendar",
    "inventory",
    "notifications",
    "profile",
  ],
  admin: [
    "marketing",
    "help",
    "security",
    "communications",
    "automation",
    "inventory",
    "opportunities",
    "copilot",
    "dashboard",
    "realtors",
    "properties",
    "projects",
    "calendar",
    "quotes",
    "payments",
    "notifications",
    "profile",
  ],
  marketing: [
    "help",
    "communications",
    "projects",
    "properties",
    "copilot",
    "dashboard",
    "realtors",
    "marketing",
    "notifications",
    "profile",
  ],
};
/** Display label only; permissions still key off the stored role. */
export function roleLabel(role: string): string {
  return role === "owner" ? "Admin" : role.replaceAll("_", " ");
}
export function isRole(value: string): value is Role {
  return roles.some((role) => role === value);
}
export function canAccess(userRoles: readonly Role[], module: Module): boolean {
  return userRoles.some(
    (role) => role === "owner" || grants[role].includes(module),
  );
}
