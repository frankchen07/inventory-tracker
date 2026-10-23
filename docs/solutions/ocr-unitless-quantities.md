# OCR: unitless quantities and the "needs review" bucket

**Date**: 2026-10-22

## The problem
Some count-sheet entries are a bare number ("6", "12") with no unit. The model read the digit
at confidence 80–85 and left `ambiguous: false`, even though its notes said "no unit given."
The restock parser then correctly returned null for those — but the list builder `continue`d
past nulls, so the items vanished from the restock list. One was already below threshold.

## The solution / decision
- `SYSTEM_PROMPT` in `src/lib/vision-ocr.ts` sets `ambiguous: true` whenever a value has no
  unit, independent of digit confidence.
- `computeRestockList()` returns `needsReview` alongside `lowStock`; the home page
  (`src/app/page.tsx`) renders it as "Needs review — couldn't read units." Anything that can't
  be converted must land there, never be skipped.

## Why it wasn't obvious
- Confidence measures digit legibility, not completeness — a sure read of an incomplete value
  still looks fine on every metric the model reports.
- Returning null looked like the defensive fix; the bug was in what the caller did with it.

## Pointers
- General method: `setup-ocr-pipeline` skill
- `src/lib/vision-ocr.ts`, `computeRestockList()`, `src/app/page.tsx`
