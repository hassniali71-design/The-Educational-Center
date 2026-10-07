-- Migration 0038: SECURITY FIX — add accounts.password_hash (PBKDF2-SHA256), stop storing
-- plaintext passwords going forward.
--
-- This migration ONLY adds a nullable column. It does NOT touch, migrate, or drop the
-- existing `password` column — existing plaintext passwords keep working as a fallback.
-- The server (src/lib/auth-functions.server.ts's `signIn`) upgrades each account from
-- plaintext to `password_hash` the next time that account logs in successfully. `password`
-- is deliberately left untouched when that happens — a one-week rollback-safety window,
-- requested explicitly — even though every comparison from that point on prefers
-- `password_hash` and no server function ever returns `password` to a client regardless.
-- See migration 0039 (run separately, later, once that window closes) for clearing it.
-- This migration alone does not retroactively hash every existing password (that requires
-- knowing the plaintext, which only happens at login time).
--
-- Safe to run on the live database: additive only, no existing column/constraint changed,
-- no rows rewritten.

alter table accounts add column if not exists password_hash text;
