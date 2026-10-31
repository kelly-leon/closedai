const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCitations, tokenizeWords } = require("../lib/messageText.js");
const { crawlerOverlayVisible } = require("../lib/crawlerOverlay.js");
const { signupDecision } = require("../lib/signupDecision.js");
const { safeMessageText, splitQuotedMessage } = require("../lib/messageContent.js");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

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

test("saved message text normalizes null and empty content", () => {
  assert.equal(safeMessageText(null), "");
  assert.equal(safeMessageText(undefined), "");
  assert.equal(safeMessageText("plain\nnewlines"), "plain\nnewlines");
});

test("saved quote blocks preserve the question after blank lines", () => {
  assert.deepEqual(splitQuotedMessage("> quoted line\n> second line\n\nWhat now?"), {
    quote: "quoted line\nsecond line",
    question: "What now?",
  });
});

test("saved message newline, markdown break, list, and citation shapes remain renderable", () => {
  for (const content of [
    "plain\nnewlines",
    "first line  \nsecond line\n\n- list item",
    "> quoted line\n\nWhat now?",
    "Before [notes, page 42]\nAfter",
    null,
  ]) {
    const text = safeMessageText(content);
    assert.doesNotThrow(() => splitQuotedMessage(text));
  }
});

test("saved messages render markdown and citation variants without React errors", async () => {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
  ]);
  const markdownCases = [
    "plain\nnewlines",
    "first line  \nsecond line\n\n- list item",
    "Before [notes, page 42]\nAfter",
    null,
  ];
  const markdownComponents = { br: () => React.createElement("br") };
  for (const content of markdownCases) {
    const rendered = React.createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm],
      components: markdownComponents,
    }, safeMessageText(content));
    assert.doesNotThrow(() => renderToStaticMarkup(rendered));
  }

  const parsed = splitQuotedMessage("> quoted line\n\nWhat now?");
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(
    "div",
    null,
    React.createElement("blockquote", null, parsed.quote),
    React.createElement("p", null, parsed.question),
  )));
});

test("signup decision identifies duplicate auth errors", () => {
  assert.equal(signupDecision({}, { message: "User already registered" }), "duplicate");
});
