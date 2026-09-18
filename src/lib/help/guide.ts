import type { Module } from "@/lib/permissions";

export type GuideSection = {
  id: string;
  title: string;
  summary: string;
  module?: Module;
  steps: string[];
  note?: string;
};

/** User-facing instructions; no customer records or live configuration are embedded. */
export const guideSections: GuideSection[] = [
  {
    id: "start",
    title: "Getting started and finding your way",
    summary:
      "Glara OS brings customer relationships, sales, project delivery, and inventory movements into one workspace.",
    module: "dashboard",
    steps: [
      "Sign in with your work account email and password. Ask your company administrator to arrange an account or adjust access; this guide does not create an account.",
      "Use the left sidebar on desktop or the menu button at the top of the screen on mobile. Your navigation shows the modules available to your role.",
      "Use Search workspace to find modules and records you can access. Search for a customer, property address, project, or product.",
      "The New button provides shortcuts for creating records. Schedule a consultation from its opportunity and create a project through the handoff from a won opportunity.",
      "After submitting a form, check the result message. If a list has multiple pages, continue to the next page; an empty filtered page does not always mean that no matching record exists.",
    ],
    note: "This guide describes the current implementation. A feature appearing here does not mean your role can use it or that its external service is enabled.",
  },
  {
    id: "daily",
    title: "Your daily routine",
    summary:
      "Start with today’s work and finish each task by recording its outcome and next action.",
    module: "dashboard",
    steps: [
      "Review Dashboard and Notifications. Open the source record behind an alert to check its details and current status.",
      "Sales: review due follow-ups, active opportunities, consultations, and quotes awaiting a response.",
      "Operations: review Calendar, today’s projects, team assignments, property access, and preparation checklists.",
      "Inventory team: check project reservations, outgoing items, returns, and items awaiting inspection or repair.",
      "Managers: review project Package end dates, extensions awaiting a decision, unpaid invoices, and red attention alerts.",
      "Before finishing the day, record call outcomes, completed tasks, actual inventory movements, and the next action for each open case.",
    ],
  },
  {
    id: "roles",
    title: "Roles and permissions",
    summary:
      "Access to a page does not automatically include permission to change all its information.",
    module: "profile",
    steps: [
      "The Owner has access to all modules. The interface currently displays the Owner role as Admin; the separate admin role still has its own narrower permissions.",
      "Sales works with customers, opportunities, properties, consultations, and quotes. Access to company-wide financial information is restricted.",
      "Designers and Staging crew use permitted operations and inventory features and do not have access to the Realtor CRM. Crew members work on assigned projects.",
      "Marketing receives a restricted view appropriate to its work. Seeing a module name does not grant access to private CRM or financial information.",
      "If a button is missing or you see Unauthorized, ask your administrator to check your role and project assignment. Do not use a colleague’s account.",
    ],
  },
  {
    id: "crm",
    title: "Customers, Realtors, and Realtor 360",
    summary:
      "Keep one relationship record so conversations and follow-ups stay together.",
    module: "realtors",
    steps: [
      "Before adding a customer in Realtors, search for an existing record to avoid duplicates. Some forms use the Customer label and support Realtor or Builder contact types.",
      "Enter the name, contact details, city, relationship owner, and lead source. Choose a Brokerage from the brokerage records and record the actual Lead source.",
      "Select the relationship status that reflects reality: Prospect, New partner, Active partner, VIP, At risk, or Dormant.",
      "Open the customer profile to review details, activities, follow-ups, and related history. This is the integrated Realtor 360 view.",
      "For a Prospect, keep a next action and due date recorded. A note alone does not replace a scheduled follow-up.",
    ],
  },
  {
    id: "followups",
    title: "Activities, tasks, and follow-ups",
    summary:
      "Recording something you did is different from scheduling something you still need to do.",
    module: "realtors",
    steps: [
      "After a call, meeting, or message, record an activity on the related profile and describe the actionable outcome.",
      "For unfinished work, specify an assignee, due date, priority, and clear instructions. Use Follow-ups within Realtors to track these tasks.",
      "Mark work complete only after it is done. If another follow-up is needed, record the next action as well; do not close a task merely to remove its alert.",
      "On an opportunity, review Next actions & timeline. Every active opportunity needs a next action.",
      "Recording an Email or SMS activity does not send an external message. Actual sending has a separate Communications workflow.",
    ],
  },
  {
    id: "properties",
    title: "Creating and managing properties",
    summary:
      "A Property describes the home; an Opportunity tracks the sale of your service, and a Project tracks delivery.",
    module: "properties",
    steps: [
      "Search the address in Properties before creating a new record. Enter the address, city, and required details.",
      "Complete the available property type, bedroom, floor area, occupancy, and listing fields, and select the related customer.",
      "If address suggestions are enabled, verify the suggestion against the original address, including unit and postal code. You can enter an address manually when suggestions are unavailable.",
      "Follow related opportunities and projects from the property record. Open the opportunity to update sales progress, or the project to manage delivery.",
    ],
  },
  {
    id: "opportunities",
    title: "Opportunities and consultations",
    summary:
      "Keep ownership and the next step clear from first contact to the final outcome.",
    module: "opportunities",
    steps: [
      "In Opportunities, link the correct customer and property. Record the owner, estimated value, stage, next action, and next action date.",
      "The sales stages are New, Contacted, Interested, Consultation, Quote sent, Negotiation, Won, and Lost. Update the stage to reflect actual progress.",
      "Schedule a consultation in the opportunity’s Consultations section and record the outcome. Continue pricing through its Quotes section.",
      "When closing an unsuccessful opportunity as Lost, record the real reason, such as price, timing, or a competitor. Lost is different from Archive.",
      "After Won, continue through the project creation workflow. If a project already exists, open it instead of creating a second operational history.",
    ],
  },
  {
    id: "quotes",
    title: "Quotes for staging, rentals, and sales",
    summary:
      "A Quote is a commercial proposal, not proof of payment or a confirmed inventory reservation.",
    module: "quotes",
    steps: [
      "Create a quote from Quotes or the opportunity. Select the appropriate type: staging, rental, or sale.",
      "Review each line’s description, quantity, price, rental periods where applicable, discount, taxes, and expiry date. Monetary amounts are in Canadian dollars.",
      "For rental and sale quotes, use Add from inventory to select products. Check any missing or zero prices before finalizing.",
      "If a discount exceeds your authority, use the applicable approval process. Do not adjust other amounts to bypass the limit.",
      "Record sent, accepted, or declined status only when that event has happened. Changing a commercial document to Sent does not itself guarantee email delivery.",
      "After acceptance, follow the agreement and operations workflows separately. Adding a product to a quote does not move it out of inventory.",
    ],
  },
  {
    id: "project-start",
    title: "Creating a project and preparing for delivery",
    summary:
      "A won opportunity is handed to operations as a project with its own number.",
    module: "projects",
    steps: [
      "In Projects, continue from an opportunity ready for operational handoff. An Owner or Admin can create a staging project from a Won opportunity.",
      "Check the property and customer carried over from the opportunity. Enter the package type and Package end date; this date drives expiry alerts.",
      "Assign the project manager, designer, and staging lead, and allocate team members to the appropriate responsibilities.",
      "Complete the rooms, staging scope, design notes, and preparation checklist. Rooms must move beyond their initial Planned state before scheduling readiness.",
      "Use Project inventory for items and Commercial summary for agreements, invoices, and extensions. These links depend on your permissions.",
    ],
  },
  {
    id: "project-status",
    title: "Understanding project statuses",
    summary:
      "Finishing the installation is different from finishing the entire project.",
    module: "projects",
    steps: [
      "Planning: initial preparation. Designing: room design. Ready to schedule: ready for scheduling. Scheduled: an installation time has been recorded.",
      "Staging: installation is underway. Staged: installation is finished and the project remains active; furniture may still be at the property.",
      "Listing live: the property is listed. Pending sale: a sale is awaiting completion. Sold: the sale has been recorded and destaging needs to be arranged.",
      "Destaging scheduled: a removal time has been recorded. Destaging: removal is underway. Completed: operational completion has been recorded.",
      "Cancelled means the project was cancelled. Neither cancellation nor completion replaces recording returns, invoice adjustments, or settlement; review those separately.",
      "Use the Mark controls in the project to change status. Available actions depend on your role, the current stage, and completed prerequisites.",
    ],
  },
  {
    id: "staged",
    title: "Where to find staged projects",
    summary:
      "A staged project stays in Projects; finishing installation does not automatically archive it.",
    module: "projects",
    steps: [
      "Once installation is actually finished, complete the required staging checklist and select Mark Staged in the project.",
      "To see these projects, open Projects, expand Filter projects, choose Status = Staged, and select Apply filters.",
      "If a project later changes to Listing live, Pending sale, or Sold, it no longer appears under Staged. Clear the Status filter and apply it again to see all active projects.",
      "Each card shows the address, project number, status, Staging time, and Package end date. Open the card for details.",
      "The default view shows active work. Find finished work with Status = Completed and use Archived records for archived history.",
    ],
  },
  {
    id: "renewals",
    title: "Package expiry and extensions",
    summary: "Check Package end dates and active-project alerts every day.",
    module: "projects",
    steps: [
      "The renewal deadline comes from the project’s Package end date, not simply its installation or creation date. If it says Not set, first confirm and record the end date against the agreement.",
      "A yellow Package expires in … days alert shows an approaching deadline. Default alert thresholds are 30, 14, and 7 days; company settings can change them.",
      "A red Package expired alert means the end date has passed. In Filter projects, choose Attention = yellow or red. Read the reason because these colours also flag other problems.",
      "Overdue only filters late tasks and checklist items; it is not a dedicated renewal filter. Commercial attention in Commercial summary also highlights extension review needs.",
      "To propose an extension, open the project, then Commercial summary, Package extensions, and Propose extension. Enter the new end date, weekly/monthly/custom period, number of periods, rate, taxes, and reason.",
      "An authorized manager must record acceptance and its evidence through Record extension decision. The agreement must be accepted. Save extension proposal alone does not change the end date.",
      "After acceptance, Package end updates to the new date. Use Prepare extension invoice to create its invoice and track payment separately.",
    ],
    note: "Do not assume a package extension automatically extends every inventory reservation. Check reservation dates and conflicts with the next project in Project inventory. An in-app alert is not proof that a reminder email was sent.",
  },
  {
    id: "calendar",
    title: "Internal calendar and scheduling",
    summary:
      "Calendar shows company operations; the Google Calendar integration is a separate capability.",
    module: "calendar",
    steps: [
      "In Calendar, choose the day, week, or month view and the date you need, then review the events you can access.",
      "Schedule staging or destaging from the project, recording the event type, start and end time, and assigned team.",
      "Before confirming, check team scheduling conflicts and daily capacity. Resolve capacity or readiness errors by correcting the plan and prerequisites.",
      "Operational times use Vancouver time. During daylight-saving changes, choose a different, unambiguous time if the system rejects a missing or repeated local time.",
      "Completing a calendar event does not replace updating the project status, checklist, or inventory movements.",
    ],
    note: "The external Google Calendar integration is currently deferred and must not be assumed active. Use the internal calendar for daily operations.",
  },
  {
    id: "crew",
    title: "Mobile guide for designers and staging crew",
    summary:
      "Focus on your assigned project, its rooms, checklists, and items.",
    module: "projects",
    steps: [
      "Open the mobile menu and go to your permitted project through Projects or Calendar. Read the address, schedule, contact responsibilities, and available notes before leaving.",
      "Designers should record room requirements and update design progress, then reserve suitable items within their permissions.",
      "Crew members should complete checklist items only after doing the work. Stage changes depend on required items being complete.",
      "Match each physical asset number against the reservation and record picking, installation, and returns in Project inventory.",
      "Report damage or shortages with a precise description and photos in the relevant section. Recording an incident does not determine a charge or collect money.",
      "You need an internet connection to save changes. Without a success message, do not assume the update was saved. Mobile photo capture may require browser camera permission.",
    ],
  },
  {
    id: "inventory",
    title: "Products, physical assets, and stock",
    summary:
      "A Product describes a model; a Physical asset is one specific item with its own identifier.",
    module: "inventory",
    steps: [
      "Fictional example: one sofa model can have several separate physical assets. Open the specific asset number to track that sofa’s location and damage.",
      "In Inventory, search by name or SKU and apply filters. The catalog holds categories, specifications, colours, dimensions, photos, and purchase/rental/sale prices.",
      "Choose the correct tracking mode when creating a product: Serialized for individually identified items, or Quantity for counted stock.",
      "Creating a product alone does not always create usable stock. Use Receive inventory to record the actual receipt, quantity or assets, location, and condition, then check the result.",
      "Use Availability by date for the required period. An item being available today does not mean it is free for the entire project.",
      "In an asset record, review Current whereabouts, Reservations, Movement history, and Inspections & damage. Do not rely only on its current location label.",
    ],
  },
  {
    id: "inventory-movement",
    title: "Reserving, picking, installing, and returning items",
    summary:
      "Reservations, physical movements, and condition each have their own records.",
    module: "inventory",
    steps: [
      "Open Project inventory from the project. Under Reserve for a room, search products for the required dates and choose the destination room, asset or quantity, and reservation intent.",
      "Check the dates and availability before Save reservation. Planned is different from Reserved; verify the recorded reservation status.",
      "When picking an item, installing it at the property, or starting its return, choose the matching action on its reservation and use Confirm inventory action. Confirm the asset number or quantity as requested.",
      "On receipt at the warehouse, select the correct Receiving location and Return outcome. Do not mark a damaged item healthy just to make it available.",
      "Follow inspection, cleaning, repair, damage, or missing-item issues through to resolution. Status and history should match the physical reality.",
      "Use the project’s Reconciliation section to review differences between reservations and items. Do not work around a conflict by duplicating reservations or assets.",
    ],
  },
  {
    id: "inventory-files",
    title: "Product photos and Excel or CSV imports",
    summary:
      "Bulk import maintains the catalog; review the preview and each row’s result.",
    module: "inventory",
    steps: [
      "Use Quick add from photos to start with images and complete the resulting drafts. A photo alone does not confirm specifications or stock.",
      "For bulk import, use the template provided in Inventory settings. The sku, name, and category columns are required. A row matching an existing SKU may update that product.",
      "Review the file and preview errors before applying it. Check tracking mode, prices, active status, and staging eligibility carefully.",
      "Image links must use HTTPS and a product supports up to six photos. External image fetching may be disabled by environment settings; check photo results separately.",
      "After importing, inspect sample products and the results for all rows. Record actual inventory receipts and locations as needed; importing a catalog is not a stock movement.",
      "Keep Excel exports in authorized company storage and do not share them with people who lack access.",
    ],
  },
  {
    id: "agreements",
    title: "Agreements and customer acceptance",
    summary:
      "Track the agreement and agreed terms from the project’s Commercial summary.",
    module: "projects",
    steps: [
      "In Agreements, prepare the document from its related commercial source. Review the customer, property, service period, amount, deposit, and extension terms.",
      "Check the terms and amounts before finalizing or printing. Use the browser’s print function and Save as PDF to keep a copy when needed.",
      "Record acceptance only after the customer has actually agreed. The evidence form records the acceptance details and reference; this does not itself obtain a new digital signature.",
      "Use the document’s permitted actions to correct a finalized record while preserving history. Do not create an unrelated document to hide a mistake.",
      "Check agreement status, deposit payment, and operational readiness separately. Printing or changing a document’s status does not guarantee delivery to the customer.",
    ],
  },
  {
    id: "payments",
    title: "Invoices, received payments, and balances",
    summary: "Record a payment only when the money has actually been received.",
    module: "payments",
    steps: [
      "In Payments, click the Project field to browse projects with outstanding issued invoices or upcoming/expired packages. Type a project number, address, or Realtor name to narrow the list, then select a project. Use Apply receivable filters for invoice results, or Open project to record payment or review renewal for its commercial workspace. Other invoice filters still apply; Clear project removes the selection.",
      "In the project’s Commercial summary, prepare deposit, balance, extension, or approved damage invoices from the corresponding source.",
      "Check the customer, line items, taxes, amount, and due date before issuing. A draft is different from an issued invoice.",
      "Use Record received payment for money already received. Enter the amount, date, method, and reference according to the actual evidence.",
      "Check how the payment is allocated to invoices. A payment existing on the record does not necessarily settle all invoices.",
      "Review balances and outstanding work in Payments and the commercial summary. Use the permitted allocation, reversal, or Credit note process with a reason for corrections.",
      "Never enter full card numbers, CVV codes, banking passwords, or bank sign-in details in notes or files. This area is not an automatic payment collection gateway.",
    ],
  },
  {
    id: "destaging",
    title: "Sale, destaging, and project closure",
    summary:
      "Sold starts removal follow-up; closing work requires checking operations, inventory, and accounts.",
    module: "projects",
    steps: [
      "After confirming the sale, record Sold and the actual date. A sold project without a destaging plan may show an alert.",
      "Schedule the Destaging event with its date, team, and property access, and review the removal checklist.",
      "Match the items against the project list. Record returns, receiving locations, condition, and any shortage or damage.",
      "Complete the required checklist for the stage, then record operational completion through the permitted control. If blocked, review the reason and outstanding work.",
      "In Commercial summary, review the balance invoice, extensions, damage charges, and payments. Completed does not automatically mean the account is settled.",
      "Find finished work in Projects by filtering Status = Completed. Handle review requests, referrals, or further contact through the authorized workflow with a clear follow-up.",
    ],
  },
  {
    id: "reports",
    title: "Dashboards, reports, and marketing",
    summary:
      "Read each number together with its date range, definition, and source records.",
    module: "reports",
    steps: [
      "Check the date range and available filters in Dashboard and Reports. Different roles see different information.",
      "Opportunity value, quote amount, invoice amount, and cash received mean different things. Do not treat them as interchangeable revenue figures.",
      "Open an alert or recommended action and check its source record’s current state. A colleague may have acted since the alert was created.",
      "In Marketing, review lead sources and attribution within your permissions. Results depend on accurate source and date entries.",
      "If a report disagrees with the underlying records, check the date range and filters and report a specific example to your administrator. Do not change real data merely to make a chart look right.",
    ],
  },
  {
    id: "automation",
    title: "Notifications and automation",
    summary:
      "An alert points you to work; reading it is not the same as completing the task.",
    module: "notifications",
    steps: [
      "Open a notification, review its source, and record the outcome in the related record.",
      "For automated tasks, complete, snooze, or take another available action only when appropriate, supplying a reason where required.",
      "Authorized managers control rules, timing, assignees, and activation scope in Automation. Saving a rule version does not necessarily activate it.",
      "If automation is disabled or an alert has not been created, review due work manually in the lists. An automated internal task does not itself send an external message.",
    ],
  },
  {
    id: "copilot",
    title: "Using Ask Glara",
    summary:
      "The assistant helps review information and prepare suggestions; an authorized user makes the final decision.",
    module: "copilot",
    steps: [
      "Open Ask Glara or its link from a record, select an accessible topic or record, and ask a clear question, such as which tasks remain open on this project.",
      "Review the sources and limitations in the answer. Open the original record to verify sensitive amounts, deadlines, or statuses.",
      "Check names, amounts, dates, and tone before using a draft. Generating a draft does not send it to a customer.",
      "Before approving an action proposal, check its assignee, due date, and effect. Generating a proposal does not authorize its execution.",
      "If the service is disabled, limited, or lacks sufficient information, continue in the original module. Do not include passwords, keys, or sensitive payment data in a prompt.",
    ],
  },
  {
    id: "communications",
    title: "Messages and external-service limits",
    summary:
      "Actual sending must follow the authorized review and approval workflow.",
    module: "communications",
    steps: [
      "In Communications, select the message purpose, source record, recipient, subject, and body. Check the preview for correct names, addresses, amounts, and links.",
      "Review communication eligibility and recipient preferences. Do not bypass unsubscribe, suppression, or permission restrictions by creating another contact.",
      "Approve reviewed message confirms the reviewed content. Actual sending uses Send approved message and is available only in an enabled, authorized environment.",
      "Queued, Sent, and Delivered are different states. If delivery is unknown, do not repeat the send; ask an administrator to reconcile history with the provider’s outcome.",
      "Under the current product decision, email remains disabled after acceptance testing and Google Calendar is deferred. Activating either requires separate configuration and authorization.",
    ],
    note: "A visible button, a Sent document status, or a completed follow-up is not evidence of inbox delivery. While email is disabled, do not rely on automatic reminders or email-based password recovery being delivered.",
  },
  {
    id: "account",
    title: "Your profile, password, and signing out",
    summary:
      "Use your own account so actions remain attributable to the person who performed them.",
    module: "profile",
    steps: [
      "In Profile, change your Display name when needed. This does not change your sign-in email or role.",
      "To change your password, complete Current password, New password, and Confirm new password, then check the result.",
      "If you forget your password, use only the provided recovery flow. Recovery email delivery depends on the service being enabled; contact your administrator if it is unavailable.",
      "Use Sign out on shared devices. Do not share passwords or recovery codes in project notes, team messages, or error screenshots.",
      "Your administrator controls roles and account access. If your permissions change, sign in again and report any continuing issue.",
    ],
  },
  {
    id: "archive",
    title: "Archiving, restoring, and change history",
    summary:
      "Archive removes a record from everyday work; it does not complete its business lifecycle.",
    steps: [
      "Before archiving, check for open projects, reservations, opportunities, or other dependencies. The system may block archiving while dependencies are active.",
      "Use the module’s archive filter to find historical records. If Restore is available, supply the required reason and check the result.",
      "Do not assume Archive or Restore automatically changes a sales stage, cancels an agreement, or releases inventory.",
      "Review History or the record’s change history within your permissions when investigating important edits. Clear reasons help the next colleague understand what happened.",
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting common issues",
    summary:
      "Check the previous result and error message before repeating an operation.",
    steps: [
      "Cannot find a project: check Status, Archived records, city, assignee filters, and the next page. Then ask your administrator to check assignment and access.",
      "Mark Staged or scheduling is blocked: review required checklists, room states, assigned leads, the end date, and the prerequisite message. Do not mark unfinished work complete.",
      "Cannot find an extension: check Package end, whether the project is active, and Commercial summary access. A proposal does not change the end date until acceptance is recorded.",
      "Insufficient inventory: check reservation dates, other projects’ reservations, location, condition, and tracking mode. Do not create duplicate products to bypass a shortage.",
      "Conflict or a colleague’s update: refresh, read the latest information, and apply your change to that version. Do not repeatedly submit the stale request.",
      "Loading error or lost connection: check connectivity and refresh. For payments, inventory movements, or messages, first inspect history to avoid recording the same action twice.",
      "If a problem persists, send your administrator the page path, record number, time, reproduction steps, and error text. Screenshots must not contain passwords, tokens, or sensitive customer information.",
    ],
  },
  {
    id: "glossary",
    title: "Quick glossary",
    summary: "Common terms used throughout the workspace.",
    steps: [
      "Realtor / Customer: the relationship or client record. Brokerage: the real estate firm. Lead source: how the relationship began. Follow-up: a planned next contact or task. Assignee: the person responsible.",
      "Property: the home being tracked. Opportunity: a potential service sale. Consultation: an assessment or meeting. Quote: a price proposal. Agreement: the agreed service terms. Invoice: the amount billed. Payment: money received.",
      "Staging: installation and styling. Staged: installation is complete. Destaging: removal. Package end: the service period’s end date. Extension: an approved additional period. Overdue: past the due date.",
      "Product: a catalog model. SKU: its catalog code. Asset: an individual physical item. Reservation: an allocation for a period. Movement: a location or operational transfer. Inspection: a condition check. Reconciliation: checking records agree.",
      "Draft: still being prepared. Pending: awaiting action. Accepted: approval recorded. Cancelled: stopped. Archived: removed from everyday lists. Restore: return an archived record to use. CAD: Canadian dollars.",
    ],
  },
];

export function normalizeGuideSearch(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-CA")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchGuide(query: string): GuideSection[] {
  const terms = normalizeGuideSearch(query).split(" ").filter(Boolean);
  return guideSections.filter((section) => {
    const text = normalizeGuideSearch(
      [
        section.title,
        section.summary,
        ...section.steps,
        section.note ?? "",
      ].join(" "),
    );
    return terms.every((term) => text.includes(term));
  });
}
