const THINKING_WORDS = [
  "Triangulating", "Mulling", "Crawling", "Digging", "Cross-referencing",
  "Sifting", "Connecting dots", "Ruminating", "Scouring", "Untangling",
  "Decoding", "Cogitating", "Foraging", "Piecing together", "Surfacing",
];

function chooseDifferentWord(words, current, random = Math.random) {
  const choices = words.filter(word => word !== current);
  return choices[Math.floor(random() * choices.length)] ?? current;
}

module.exports = { THINKING_WORDS, chooseDifferentWord };
