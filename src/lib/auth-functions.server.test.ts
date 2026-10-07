import { describe, expect, test } from "bun:test";

import { hashPassword } from "./password.server";

process.env.SESSION_SECRET = "unit-test-secret-do-not-use-in-production";

import { PUBLIC_ACCOUNT_COLUMNS, verifyAccountPassword } from "./auth-functions.server";

describe("auth-functions.server — verifyAccountPassword (scenario c: legacy password + upgrade)", () => {
  test("legacy plaintext account: correct password matches and returns an upgrade hash", async () => {
    const account = { password: "tch1000", password_hash: null };
    const result = await verifyAccountPassword(account, "tch1000");
    expect(result.ok).toBe(true);
    expect(result.upgradeHash).toBeDefined();
    expect(result.upgradeHash!.startsWith("pbkdf2$")).toBe(true);
  });

  test("legacy plaintext account: wrong password fails, no upgrade hash produced", async () => {
    const account = { password: "tch1000", password_hash: null };
    const result = await verifyAccountPassword(account, "wrong-guess");
    expect(result.ok).toBe(false);
    expect(result.upgradeHash).toBeUndefined();
  });

  test("already-hashed account: correct password matches, no upgrade needed (already upgraded)", async () => {
    const hash = await hashPassword("tch1000");
    const account = { password: null, password_hash: hash };
    const result = await verifyAccountPassword(account, "tch1000");
    expect(result.ok).toBe(true);
    expect(result.upgradeHash).toBeUndefined();
  });

  test("already-hashed account: wrong password fails, plaintext column is never consulted", async () => {
    const hash = await hashPassword("tch1000");
    // `password` left over from before the upgrade — must be ignored entirely once password_hash exists.
    const account = { password: "tch1000", password_hash: hash };
    const result = await verifyAccountPassword(account, "some-other-guess");
    expect(result.ok).toBe(false);
  });

  test("account with neither password nor password_hash set never authenticates", async () => {
    const account = { password: null, password_hash: null };
    const result = await verifyAccountPassword(account, "anything");
    expect(result.ok).toBe(false);
  });
});

describe("auth-functions.server — fetchAccounts column list (scenario d: never leak passwords)", () => {
  test("PUBLIC_ACCOUNT_COLUMNS never selects password or password_hash", () => {
    const columns = PUBLIC_ACCOUNT_COLUMNS.split(",").map((c) => c.trim());
    expect(columns).not.toContain("password");
    expect(columns).not.toContain("password_hash");
    expect(columns).toContain("id");
    expect(columns).toContain("center_id");
    expect(columns).toContain("role");
  });
});
