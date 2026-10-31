function safeMessageText(content) {
  return typeof content === "string" ? content : "";
}

function splitQuotedMessage(content) {
  const text = safeMessageText(content);
  if (!text.startsWith("> ")) return { quote: null, question: text };
  const lines = text.split("\n");
  const quoted = [];
  let index = 0;
  while (index < lines.length && lines[index].startsWith("> ")) {
    quoted.push(lines[index].slice(2));
    index += 1;
  }
  while (index < lines.length && lines[index] === "") index += 1;
  return { quote: quoted.join("\n") || null, question: lines.slice(index).join("\n") };
}

module.exports = { safeMessageText, splitQuotedMessage };
