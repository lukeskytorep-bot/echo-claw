# Contributing to ECHO-CLAW

Contributions are welcome, but changes affecting target blindness, ownership, Reveal, retries, Recovery, protocol execution or audit evidence must preserve fail-closed behavior.

## Before submitting a change

Run:

```bash
npm test
npm run verify:baselines
npm run verify:package
```

If you intentionally change a canonical protocol manifest, execution overlay, or bundled target source, update the relevant baseline only as an explicit, reviewed operation. Never regenerate a baseline merely to make a failing test green.

## Licensing

By contributing software code, you agree that the contribution may be distributed under the MIT License used by this repository.

By contributing original protocol text, target text, documentation, identity material, vocabulary or training content, you agree that the contribution may be distributed under CC BY 4.0 unless a different compatible notice is explicitly accepted by the project.

Preserve source-specific attribution. See `NOTICE.md` and `CONTRIBUTORS.md`.

## Research discipline

Do not add tests that compare blind responses against Reveal data before the blind phase is formally complete. Structural completeness and target accuracy are separate concerns.
