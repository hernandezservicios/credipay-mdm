/**
 * Integración con InovaGuard MDM API (proxy server-side).
 * Portado del cliente del frontend (src/services/inovaGuardApi.ts) para que
 * los secretos (appClient, secret, bearerToken) nunca viajen al navegador.
 * Base URL: https://dashboard.inovaguardapp.com/api/v1/customer
 * Documentación oficial (Postman):
 *   https://documenter.getpostman.com/view/49503810/2sBXcEkLjR
 */
export * from './types.js';
export {
  fetchInovaGuard,
  commandUrl,
  storeToken,
  clearTokens,
  invalidateTenantTokens,
  getStoredToken,
} from './client.js';
export {
  getInovaGuardDevices,
  getInovaGuardBalance,
  getInovaGuardLicences,
  findInovaGuardDevice,
  lockInovaGuardDevice,
  unlockInovaGuardDevice,
  generateInovaGuardUnlockCode,
  removeInovaGuardDevice,
  getInovaGuardQrEnrollment,
  invalidateInovaGuardCache,
  invalidateTenant,
} from './service.js';
export { redactMdmConfig, type RedactedMdmConfig } from './redact.js';
export type { FetchResult } from './client.js';
export type { MdmConfig } from '../../services/tenantService.js';
