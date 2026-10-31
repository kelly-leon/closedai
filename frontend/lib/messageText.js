export function tokenizeWords(text, limit = 12) {
  const words = [];
  let start = -1;
  for (let index = 0; index <= text.length; index += 1) {
    const code = index < text.length ? text.charCodeAt(index) : 0;
    const part = (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
    const upper = code >= 65 && code <= 90;
    if (part || upper) {
      if (start === -1) start = index;
    } else if (start !== -1) {
      words.push(text.slice(start, index).toLowerCase());
      if (words.length >= limit) break;
      start = -1;
    }
  }
  return words.filter(word => word.length >= 3);
}

export function parseCitations(text) {
  const citations = [];
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf("[", index);
    if (start === -1) break;
    const end = text.indexOf("]", start + 1);
    if (end === -1) break;
    const content = text.slice(start + 1, end);
    const match = /^([^,\]\n]*,)?\s*page\s+(\d+)$/i.exec(content);
    if (match) {
      let filename = match[1] ? match[1].slice(0, -1).trim() : null;
      if (filename) filename = filename.length ? filename : null;
      citations.push({ start, end: end + 1, filename, page: Number(match[2]) });
      index = end + 1;
    } else {
      index = start + 1;
    }
  }
  return citations;
}
