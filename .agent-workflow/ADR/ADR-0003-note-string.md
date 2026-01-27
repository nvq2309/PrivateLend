# ADR-0003 — Note String Format (veil-note-v1)

Status: Proposed
Date: 2026-01-25

## Context
The note string is the user’s portable representation of a private position.
It must be:
- deterministic to encode/decode
- versioned for forward compatibility
- safe to copy/paste (checksum or similar)
- minimal (avoid leaking fields unnecessarily)

## Decision (needs operator choice)

A) `veil-note-v1:<base64url payload>[:checksum]`
- Payload is a compact, versioned binary schema.
- Explicit fields and ordering.
- Optional checksum to detect copy/paste corruption.

B) JSON note
- Easier to debug and inspect.
- Larger and more likely to leak sensitive info in logs.

C) Binary-only note (no prefix/version)
- Small but fragile and hard to evolve.

### Proposed recommendation
Recommendation: **A)**.

## Consequences
- Any change to payload schema requires a version bump.
- SDK must validate format strictly and fail loudly.

## Verification
- `yarn test -- --grep "Note string"`
