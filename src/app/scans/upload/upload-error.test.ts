import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadErrorMessage } from "./upload-error";

test("uses the server's JSON error when there is one", () => {
  assert.equal(uploadErrorMessage(400, '{"error":"photo is required"}'), "photo is required");
});

test("explains non-JSON failures instead of a JSON parse error", () => {
  assert.equal(uploadErrorMessage(413, "Request Entity Too Large"), "Photo is too large (max about 4.5 MB). Try a smaller photo.");
  assert.equal(uploadErrorMessage(500, "<!DOCTYPE html><html>…</html>"), "Server error (500). Please try again.");
  assert.equal(uploadErrorMessage(504, ""), "Server error (504). Please try again.");
  assert.equal(uploadErrorMessage(500, '{"message":"no error field"}'), "Server error (500). Please try again.");
});
