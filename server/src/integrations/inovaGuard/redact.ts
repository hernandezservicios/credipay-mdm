import type { MdmConfig } from '../../services/tenantService.js';

/**
 * Redaccion de secretos para respuestas HTTP (P1 seguridad / R16).
 * Los valores de credenciales nunca salen del backend hacia el frontend;
 * solo se expone si estan configurados (placeholder '********').
 */

const SECRET_KEYS = ['apiKey', 'appClient', 'secret', 'bearerToken'] as const;

export type RedactedMdmConfig = Omit<MdmConfig, (typeof SECRET_KEYS)[number]> & {
  [K in (typeof SECRET_KEYS)[number]]: string;
};

export function redactMdmConfig(config: MdmConfig): RedactedMdmConfig {
  const redacted = { ...config } as unknown as RedactedMdmConfig;
  for (const key of SECRET_KEYS) {
    redacted[key] = config[key] ? '********' : '';
  }
  return redacted;
}