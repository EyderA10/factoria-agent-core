import { describe, expect, it, vi, beforeEach } from "vitest";

const getTenantsForAuth = vi.fn();
vi.mock("@/lib/db/repo", () => ({ getTenantsForAuth: () => getTenantsForAuth() }));

import { extractBearer, hashSecret, resolveTenantFromAuth, safeEqualHex } from "@/lib/tenants/resolver";

const MESA_SECRET = "mesa-secret-abc123";
const VITEA_SECRET = "vitea-secret-xyz789";

describe("resolver: hash del secret", () => {
  it("el hash es determinista y de 64 hex (sha256)", () => {
    expect(hashSecret(MESA_SECRET)).toBe(hashSecret(MESA_SECRET));
    expect(hashSecret(MESA_SECRET)).not.toBe(hashSecret(VITEA_SECRET));
    expect(hashSecret(MESA_SECRET)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("el secret en claro nunca es el valor almacenado", () => {
    expect(hashSecret(MESA_SECRET)).not.toContain(MESA_SECRET);
  });

  it("safeEqualHex rechaza longitudes distintas", () => {
    expect(safeEqualHex("abcd", "ab")).toBe(false);
    expect(safeEqualHex(hashSecret("a"), hashSecret("a"))).toBe(true);
  });
});

describe("resolver: header Authorization", () => {
  it("extrae el Bearer y rechaza formatos inválidos", () => {
    expect(extractBearer(`Bearer ${MESA_SECRET}`)).toBe(MESA_SECRET);
    expect(extractBearer("Bearer   ")).toBeNull();
    expect(extractBearer(MESA_SECRET)).toBeNull();
    expect(extractBearer(null)).toBeNull();
    expect(extractBearer(undefined)).toBeNull();
  });
});

describe("resolver: aislamiento multi-tenant por secret", () => {
  beforeEach(() => {
    getTenantsForAuth.mockReset();
    getTenantsForAuth.mockResolvedValue([
      { id: "mesa-y-cia", secretHash: hashSecret(MESA_SECRET), enabled: true },
      { id: "vitea", secretHash: hashSecret(VITEA_SECRET), enabled: true },
    ]);
  });

  it("el secret de Mesa & Cía resuelve SOLO mesa-y-cia", async () => {
    await expect(resolveTenantFromAuth(`Bearer ${MESA_SECRET}`)).resolves.toEqual({
      tenantId: "mesa-y-cia",
      enabled: true,
    });
  });

  it("el secret de Vitea resuelve SOLO vitea", async () => {
    await expect(resolveTenantFromAuth(`Bearer ${VITEA_SECRET}`)).resolves.toEqual({
      tenantId: "vitea",
      enabled: true,
    });
  });

  it("un secret desconocido no resuelve tenant", async () => {
    await expect(resolveTenantFromAuth("Bearer secret-inventado")).resolves.toBeNull();
  });

  it("sin header Authorization no resuelve tenant", async () => {
    await expect(resolveTenantFromAuth(null)).resolves.toBeNull();
    await expect(getTenantsForAuth).not.toHaveBeenCalled();
  });

  it("reporta enabled=false para tenants deshabilitados (el core responde 403)", async () => {
    getTenantsForAuth.mockResolvedValue([
      { id: "vitea", secretHash: hashSecret(VITEA_SECRET), enabled: false },
    ]);
    await expect(resolveTenantFromAuth(`Bearer ${VITEA_SECRET}`)).resolves.toEqual({
      tenantId: "vitea",
      enabled: false,
    });
  });

  it("no resuelve si el secret del tenant aún no está hasheado en DB", async () => {
    getTenantsForAuth.mockResolvedValue([{ id: "vitea", secretHash: null, enabled: true }]);
    await expect(resolveTenantFromAuth(`Bearer ${VITEA_SECRET}`)).resolves.toBeNull();
  });
});
