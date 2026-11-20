import { test } from "node:test";
import assert from "node:assert/strict";
import MonthDetailPage from "@/app/month/[month]/page";

test("AC-27: an invalid month in the path redirects to /month", async () => {
  for (const month of ["2026-13", "abc", "2026-1"]) {
    await assert.rejects(
      MonthDetailPage({ params: Promise.resolve({ month }) } as PageProps<"/month/[month]">),
      (err: { digest?: string }) => {
        assert.match(err.digest ?? "", /^NEXT_REDIRECT;[^;]*;\/month;/);
        return true;
      },
    );
  }
});
