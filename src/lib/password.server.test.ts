import { describe, expect, test } from "bun:test";

import { hashPassword, isHashedPassword, verifyPassword } from "./password.server";

describe("password.server — PBKDF2 hashing", () => {
  test("hashPassword produces the pbkdf2$<iterations>$<salt>$<hash> format", async () => {
    const hash = await hashPassword("Tch1000");
    expect(hash.startsWith("pbkdf2$100000$")).toBe(true);
    expect(hash.split("$")).toHaveLength(4);
  });

  test("verifyPassword accepts the correct plaintext", async () => {
    const hash = await hashPassword("Tch1000");
    expect(await verifyPassword("Tch1000", hash)).toBe(true);
  });

  test("verifyPassword rejects a wrong password", async () => {
    const hash = await hashPassword("Tch1000");
    expect(await verifyPassword("wrong-guess", hash)).toBe(false);
  });

  test("two hashes of the same password are never identical (random salt)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  test("verifyPassword never throws on a malformed stored value — just returns false", async () => {
    await expect(verifyPassword("anything", "not-a-real-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });

  test("isHashedPassword distinguishes hashed values from legacy plaintext / null", async () => {
    const hash = await hashPassword("x");
    expect(isHashedPassword(hash)).toBe(true);
    expect(isHashedPassword("plaintext-legacy-password")).toBe(false);
    expect(isHashedPassword(null)).toBe(false);
    expect(isHashedPassword(undefined)).toBe(false);
  });
});
