function evaluateGuess(guess, answer) {
  const result = Array(guess.length).fill("⬛");
  const remaining = answer.split("");

  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === answer[i]) {
      result[i] = "🟩";
      remaining[i] = null;
    }
  }

  for (let i = 0; i < guess.length; i++) {
    if (result[i] === "🟩") continue;
    const index = remaining.indexOf(guess[i]);
    if (index !== -1) {
      result[i] = "🟨";
      remaining[index] = null;
    }
  }

  return result;
}

function formatRow(guess, result) {
  return guess.split("").map((letter, i) => `${result[i]} ${letter.toUpperCase()}`).join("  ");
}

module.exports = { evaluateGuess, formatRow };
