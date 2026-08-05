import { describe, expect, it } from 'vitest';
import { ApiError } from '../utils/http.ts';
import { parsePlanInput, resolvePlatformTenantId } from '../routes/v1/saas.routes.ts';

describe('resolvePlatformTenantId (Super Admin global vs usuario de tenant)', () => {
  it('usa el tenant de la sesión cuando el usuario pertenece a un tenant', () => {
    const req = { auth: { tenantId: 5 } } as never;
    expect(resolvePlatformTenantId(req, undefined)).toBe(5);
    expect(resolvePlatformTenantId(req, 999)).toBe(5);
  });

  it('Super Admin global: exige tenantId objetivo en el body', () => {
    const req = { auth: { tenantId: null } } as never;
    expect(resolvePlatformTenantId(req, 7)).toBe(7);
  });

  it('Super Admin global sin tenantId objetivo: error 400', () => {
    const req = { auth: { tenantId: null } } as never;
    expect(() => resolvePlatformTenantId(req, undefined)).toThrow(ApiError);
    expect(() => resolvePlatformTenantId(req, 0)).toThrow(ApiError);
    expect(() => resolvePlatformTenantId(req, 'abc')).toThrow('Indica el tenantId objetivo');
  });
});

describe('parsePlanInput (CRUD de planes, Super Admin)', () => {
  it('omite name y slug (van por separado en el INSERT) — regresión duplicado de columnas', () => {
    const { fields, values } = parsePlanInput({
      name: 'Plan X',
      slug: 'plan-x',
      price: 990,
      description: 'Descripción',
    });
    expect(fields).not.toContain('name');
    expect(fields).not.toContain('slug');
    expect(fields).toContain('price');
    expect(fields).toContain('description');
    expect(values).toContain(990);
  });

  it('omite status e is_default (se gestionan por separado)', () => {
    const { fields } = parsePlanInput({ status: 'INACTIVE', is_default: 1, price: 100 });
    expect(fields).not.toContain('status');
    expect(fields).not.toContain('is_default');
  });

  it('valida billing_cycle con valores permitidos', () => {
    expect(parsePlanInput({ billingCycle: 'MONTHLY', billing_cycle: 'QUARTERLY' }).values).toContain('QUARTERLY');
    expect(parsePlanInput({ billing_cycle: 'CADENA_RANDOM' }).values).not.toContain('CADENA_RANDOM');
  });

  it('ignora valores numéricos inválidos', () => {
    expect(parsePlanInput({ price: -5 }).fields).not.toContain('price');
    expect(parsePlanInput({ price: 'no-numero' }).fields).not.toContain('price');
  });
});
