import { beforeAll, describe, expect, mock, test } from "bun:test";

process.env.SESSION_SECRET = "unit-test-secret-do-not-use-in-production";

/**
 * `session.server.ts` imports `getRequestHeader`/`setResponseStatus` from
 * `@tanstack/react-start/server`, which only works inside a real request (SSR/server-fn)
 * context. Outside of one, bun's module mock stands in for it so `requireSession()` can be
 * exercised as a plain unit test — `headerValue`/`lastStatus` are read live by the mock on
 * every call, so each test just sets `headerValue` before calling `requireSession()`.
 */
let headerValue: string | undefined;
let lastStatus: number | undefined;

mock.module("@tanstack/react-start/server", () => ({
  getRequestHeader: (_name: string) => headerValue,
  setResponseStatus: (code: number) => {
    lastStatus = code;
  },
}));

let signSessionToken: typeof import("./session.server").signSessionToken;
let verifySessionToken: typeof import("./session.server").verifySessionToken;
let requireSession: typeof import("./session.server").requireSession;

beforeAll(async () => {
  const mod = await import("./session.server");
  signSessionToken = mod.signSessionToken;
  verifySessionToken = mod.verifySessionToken;
  requireSession = mod.requireSession;
});

describe("session.server — signed token (sign/verify)", () => {
  test("round-trip: verify returns exactly what was signed", async () => {
    const token = await signSessionToken({ accountId: "acc-1", centerId: "ctr-1", role: "owner" });
    const payload = await verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.accountId).toBe("acc-1");
    expect(payload?.centerId).toBe("ctr-1");
    expect(payload?.role).toBe("owner");
  });

  test("malformed token (no signature part) is rejected", async () => {
    expect(await verifySessionToken("not-a-real-token")).toBeNull();
  });

  // Scenario (a) from the security brief: editing any client-held value (localStorage,
  // sessionStorage, a request field) must never change the identity the server resolves.
  // A signed token makes this concrete — any single-character edit to the signed payload
  // invalidates the signature, so there is nothing to "change and still have it accepted".
  test("tampering with the signed payload (e.g. editing center_id) invalidates the token", async () => {
    const token = await signSessionToken({
      accountId: "acc-1",
      centerId: "ctr-victim",
      role: "owner",
    });
    const [payloadB64, sigB64] = token.split(".") as [string, string];
    const lastChar = payloadB64.at(-1);
    const tamperedPayloadB64 = payloadB64.slice(0, -1) + (lastChar === "A" ? "B" : "A");
    const tamperedToken = `${tamperedPayloadB64}.${sigB64}`;
    expect(await verifySessionToken(tamperedToken)).toBeNull();
  });

  test("a token signed for one account cannot be turned into another by swapping payloads", async () => {
    const victim = await signSessionToken({ accountId: "acc-victim", centerId: "ctr-victim", role: "owner" });
    const attacker = await signSessionToken({ accountId: "acc-attacker", centerId: "ctr-attacker", role: "owner" });
    const [victimPayload] = victim.split(".");
    const [, attackerSig] = attacker.split(".");
    // Attacker tries to wear the victim's identity using their own valid signature.
    const frankenToken = `${victimPayload}.${attackerSig}`;
    expect(await verifySessionToken(frankenToken)).toBeNull();
  });

  test("expired token is rejected even though it was signed correctly", async () => {
    const originalNow = Date.now;
    let token: string;
    try {
      Date.now = () => new Date("2000-01-01T00:00:00Z").getTime();
      token = await signSessionToken({ accountId: "acc-1", centerId: "ctr-1", role: "teacher" });
    } finally {
      Date.now = originalNow;
    }
    expect(await verifySessionToken(token)).toBeNull();
  });
});

describe("session.server — requireSession() (scenario b: no/invalid token => 401)", () => {
  test("missing Authorization header => throws and sets status 401", async () => {
    headerValue = undefined;
    lastStatus = undefined;
    await expect(requireSession()).rejects.toThrow();
    expect(lastStatus).toBe(401);
  });

  test("header without the Bearer prefix => throws and sets status 401", async () => {
    headerValue = "some-random-value";
    lastStatus = undefined;
    await expect(requireSession()).rejects.toThrow();
    expect(lastStatus).toBe(401);
  });

  test("garbage bearer token => throws and sets status 401", async () => {
    headerValue = "Bearer this-is-not-signed";
    lastStatus = undefined;
    await expect(requireSession()).rejects.toThrow();
    expect(lastStatus).toBe(401);
  });

  test("valid bearer token => returns the server-signed identity, nothing else is consulted", async () => {
    const token = await signSessionToken({ accountId: "acc-42", centerId: "ctr-42", role: "staff" });
    headerValue = `Bearer ${token}`;
    const session = await requireSession();
    expect(session.accountId).toBe("acc-42");
    expect(session.centerId).toBe("ctr-42");
    expect(session.role).toBe("staff");
  });
});
