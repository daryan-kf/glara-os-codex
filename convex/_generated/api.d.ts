/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as admin from "../admin.js";
import type * as ai from "../ai.js";
import type * as aiContext from "../aiContext.js";
import type * as aiProvider from "../aiProvider.js";
import type * as aiSchema from "../aiSchema.js";
import type * as analytics from "../analytics.js";
import type * as analyticsHistory from "../analyticsHistory.js";
import type * as analyticsLedger from "../analyticsLedger.js";
import type * as analyticsMaintenance from "../analyticsMaintenance.js";
import type * as analyticsOperations from "../analyticsOperations.js";
import type * as analyticsReconciliation from "../analyticsReconciliation.js";
import type * as analyticsSchema from "../analyticsSchema.js";
import type * as analyticsSources from "../analyticsSources.js";
import type * as auth from "../auth.js";
import type * as authSecurity from "../authSecurity.js";
import type * as automation from "../automation.js";
import type * as automationCore from "../automationCore.js";
import type * as automationSchema from "../automationSchema.js";
import type * as automationSources from "../automationSources.js";
import type * as calendarProvider from "../calendarProvider.js";
import type * as calendarSchema from "../calendarSchema.js";
import type * as calendarSync from "../calendarSync.js";
import type * as commercial from "../commercial.js";
import type * as commercialCore from "../commercialCore.js";
import type * as commercialSchema from "../commercialSchema.js";
import type * as communicationCore from "../communicationCore.js";
import type * as communicationDelivery from "../communicationDelivery.js";
import type * as communicationHttp from "../communicationHttp.js";
import type * as communicationProvider from "../communicationProvider.js";
import type * as communicationSchema from "../communicationSchema.js";
import type * as communications from "../communications.js";
import type * as crm from "../crm.js";
import type * as crons from "../crons.js";
import type * as emergency from "../emergency.js";
import type * as emergencyCore from "../emergencyCore.js";
import type * as emergencyModel from "../emergencyModel.js";
import type * as functions from "../functions.js";
import type * as http from "../http.js";
import type * as integrity from "../integrity.js";
import type * as inventory from "../inventory.js";
import type * as inventoryCore from "../inventoryCore.js";
import type * as inventorySchema from "../inventorySchema.js";
import type * as migration from "../migration.js";
import type * as operationalHealth from "../operationalHealth.js";
import type * as operations from "../operations.js";
import type * as operationsCore from "../operationsCore.js";
import type * as operationsSchema from "../operationsSchema.js";
import type * as profiles from "../profiles.js";
import type * as sales from "../sales.js";
import type * as securityAdmin from "../securityAdmin.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  admin: typeof admin;
  ai: typeof ai;
  aiContext: typeof aiContext;
  aiProvider: typeof aiProvider;
  aiSchema: typeof aiSchema;
  analytics: typeof analytics;
  analyticsHistory: typeof analyticsHistory;
  analyticsLedger: typeof analyticsLedger;
  analyticsMaintenance: typeof analyticsMaintenance;
  analyticsOperations: typeof analyticsOperations;
  analyticsReconciliation: typeof analyticsReconciliation;
  analyticsSchema: typeof analyticsSchema;
  analyticsSources: typeof analyticsSources;
  auth: typeof auth;
  authSecurity: typeof authSecurity;
  automation: typeof automation;
  automationCore: typeof automationCore;
  automationSchema: typeof automationSchema;
  automationSources: typeof automationSources;
  calendarProvider: typeof calendarProvider;
  calendarSchema: typeof calendarSchema;
  calendarSync: typeof calendarSync;
  commercial: typeof commercial;
  commercialCore: typeof commercialCore;
  commercialSchema: typeof commercialSchema;
  communicationCore: typeof communicationCore;
  communicationDelivery: typeof communicationDelivery;
  communicationHttp: typeof communicationHttp;
  communicationProvider: typeof communicationProvider;
  communicationSchema: typeof communicationSchema;
  communications: typeof communications;
  crm: typeof crm;
  crons: typeof crons;
  emergency: typeof emergency;
  emergencyCore: typeof emergencyCore;
  emergencyModel: typeof emergencyModel;
  functions: typeof functions;
  http: typeof http;
  integrity: typeof integrity;
  inventory: typeof inventory;
  inventoryCore: typeof inventoryCore;
  inventorySchema: typeof inventorySchema;
  migration: typeof migration;
  operationalHealth: typeof operationalHealth;
  operations: typeof operations;
  operationsCore: typeof operationsCore;
  operationsSchema: typeof operationsSchema;
  profiles: typeof profiles;
  sales: typeof sales;
  securityAdmin: typeof securityAdmin;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
