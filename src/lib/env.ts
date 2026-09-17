import { frontendConfigurationAllowed } from "./security/preflight";
export function isConfigured() {
  return frontendConfigurationAllowed(process.env);
}
