-- Migration 0038: SECURITY FIX — add accounts.password_hash (PBKDF2-SHA256), stop storing
-- plaintext passwords going forward.
--
-- This migration ONLY adds a nullable column. It does NOT touch, migrate, or drop the
-- existing `password` column — existing plaintext passwords keep working as a fallback.
-- The server (src/lib/auth-functions.server.ts's `signIn`) upgrades each account from
-- plaintext to `password_hash` the next time that account logs in successfully, and clears
-- `password` to null at that point. Accounts that never log in again keep their plaintext
-- password in `password` until they do — this migration alone does not retroactively hash
-- every existing password (that requires knowing the plaintext, which only happens at login
-- time).
--
-- Safe to run on the live database: additive only, no existing column/constraint changed,
-- no rows rewritten.

alter table accounts add column if not exists password_hash text;
