const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCitations, tokenizeWords } = require("../lib/messageText.js");
const { crawlerOverlayVisible } = require("../lib/crawlerOverlay.js");
const { signupDecision } = require("../lib/signupDecision.js");

test("citation and word parsing handle 200,000 characters quickly", () => {
  const text = `${"a".repeat(200000)} [notes, page 42]`;
  const start = performance.now();
  const citations = parseCitations(text);
  const words = tokenizeWords(text, 12);
  assert.equal(citations.length, 1);
  assert.equal(citations[0].page, 42);
  assert.ok(words.length <= 12);
  assert.ok(performance.now() - start < 50, "message text parsing exceeded 50 ms");
});

test("crawler overlay unmounts on the first answer token", () => {
  assert.equal(crawlerOverlayVisible(true, "token"), false);
});

test("signup decision identifies new users", () => {
  assert.equal(signupDecision({ user: { identities: [{ id: "new" }] } }, null), "new");
});

test("signup decision identifies duplicates with empty identities", () => {
  assert.equal(signupDecision({ user: { identities: [] } }, null), "duplicate");
});

test("signup decision identifies duplicate auth errors", () => {
  assert.equal(signupDecision({}, { message: "User already registered" }), "duplicate");
});
