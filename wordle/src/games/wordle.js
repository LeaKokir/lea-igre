function normalizeSrpski(value) {
  return value
    .toLowerCase()
    .replaceAll("č", "c")
    .replaceAll("ć", "c")
    .replaceAll("š", "s")
    .replaceAll("ž", "z")
    .replaceAll("đ", "dj");
}

function evaluateGuess(guess, answer) {
  const g = normalizeSrpski(guess);
  const a = normalizeSrpski(answer);
  const result = Array(g.length).fill("⬛");
  const remaining = a.split("");

  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) {
      result[i] = "🟩";
      remaining[i] = null;
    }
  }

  for (let i = 0; i < g.length; i++) {
    if (result[i] === "🟩") continue;
    const index = remaining.indexOf(g[i]);
    if (index !== -1) {
      result[i] = "🟨";
      remaining[index] = null;
    }
  }

  return result;
}

function formatRow(guess, result) {
  // Svako slovo je tačno ispod svoje kockice.
  // Monospace blok čuva razmak između kolona u Discordu.
  const squares = result.join("  ");
  const letters = guess
    .split("")
    .map(letter => letter.toUpperCase())
    .join("   ");

  return `\`\`\`\n${squares}\n${letters}\n\`\`\``;
}

module.exports = { normalizeSrpski, evaluateGuess, formatRow };
