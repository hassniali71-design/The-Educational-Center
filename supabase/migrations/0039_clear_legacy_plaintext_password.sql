-- Migration 0039: SECURITY FIX (follow-up) — empty the legacy plaintext `password` column.
--
-- Run this ONLY after the one-week rollback-safety window following migration 0038 has
-- passed, and only once you've confirmed the new PBKDF2-based login (password_hash) is
-- working correctly in production for all roles (owner/staff/teacher/student/parent).
--
-- What it does: clears `password` to null for every account that already has a
-- `password_hash` set (i.e. every account that has logged in at least once since migration
-- 0038 was applied, which upgrades it automatically on first successful login). It does
-- NOT touch accounts that have never logged in since then — those still need their
-- plaintext `password` to log in for the first time and get upgraded; clearing it now would
-- lock them out. Re-run this migration again later (it's idempotent) once those remaining
-- accounts have also logged in at least once, until `password` is empty for every account.
--
-- Safe to run repeatedly: a `where` clause, no column/constraint changes, no rows deleted.

update accounts
set password = null
where password_hash is not null
  and password is not null;
