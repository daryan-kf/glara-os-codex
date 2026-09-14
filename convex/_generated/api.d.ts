/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as commercial from "../commercial.js";
import type * as commercialCore from "../commercialCore.js";
import type * as commercialSchema from "../commercialSchema.js";
import type * as access from "../access.js";
import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as crm from "../crm.js";
import type * as http from "../http.js";
import type * as inventory from "../inventory.js";
import type * as inventoryCore from "../inventoryCore.js";
import type * as inventorySchema from "../inventorySchema.js";
import type * as operations from "../operations.js";
import type * as operationsCore from "../operationsCore.js";
import type * as operationsSchema from "../operationsSchema.js";
import type * as profiles from "../profiles.js";
import type * as sales from "../sales.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  commercial: typeof commercial;
  commercialCore: typeof commercialCore;
  commercialSchema: typeof commercialSchema;
  access: typeof access;
  admin: typeof admin;
  auth: typeof auth;
  crm: typeof crm;
  http: typeof http;
  inventory: typeof inventory;
  inventoryCore: typeof inventoryCore;
  inventorySchema: typeof inventorySchema;
  operations: typeof operations;
  operationsCore: typeof operationsCore;
  operationsSchema: typeof operationsSchema;
  profiles: typeof profiles;
  sales: typeof sales;
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
