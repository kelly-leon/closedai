const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCitations, tokenizeWords } = require("../lib/messageText.js");
const { crawlerOverlayVisible } = require("../lib/crawlerOverlay.js");

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
