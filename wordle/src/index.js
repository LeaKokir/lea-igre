require("dotenv").config();

const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const {
  getPlayer, addXP, addCoins, getToday, getDailyWord,
  getAttempts, addAttempt, finishWordle, leaderboard
} = require("./database/database");
const { evaluateGuess, formatRow } = require("./games/wordle");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID or GUILD_ID in .env");
  process.exit(1);
}

const words = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../data/words.json"), "utf8")
).map(w => w.toLowerCase());

const commands = [
  new SlashCommandBuilder()
    .setName("wordle")
    .setDescription("Pokreni današnji Uazalenje Wordle izazov."),
  new SlashCommandBuilder()
    .setName("pogodi")
    .setDescription("Pošalji pokušaj za današnji Wordle.")
    .addStringOption(o => o.setName("rec").setDescription("Reč koju želiš da pogodiš").setRequired(true)),
  new SlashCommandBuilder()
    .setName("wordle-stats")
    .setDescription("Pogledaj svoju Wordle statistiku."),
  new SlashCommandBuilder()
    .setName("wordle-top")
    .setDescription("Pogledaj Uazalenje Wordle leaderboard."),
  new SlashCommandBuilder()
    .setName("profil")
    .setDescription("Pogledaj svoj Lea Igre profil.")
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log("Slash commands registered.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function baseEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`💜 ${title}`)
    .setDescription(description)
    .setFooter({ text: "Lea Igre • Uazalenje" })
    .setTimestamp();
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const user = interaction.user;
  const today = getToday();

  if (interaction.commandName === "wordle") {
    const word = getDailyWord(today, words);
    const player = getPlayer(user);
    const attempts = getAttempts(user.id, today);

    await interaction.reply({
      embeds: [baseEmbed(
        "UAZALENJE DAILY",
        `🧩 **Današnja reč ima ${word.length} slova.**\n\n` +
        `Pokušaji: **${attempts.length}/6**\n` +
        `🔥 Streak: **${player.current_streak} dana**\n\n` +
        `Koristi **/pogodi** i unesi svoju reč.\n\n` +
        `🟩 tačno mesto • 🟨 postoji, drugo mesto • ⬛ nema slova`
      )]
    });
    return;
  }

  if (interaction.commandName === "pogodi") {
    const answer = getDailyWord(today, words);
    const guess = interaction.options.getString("rec").trim().toLowerCase();

    if (!/^[a-zčćžšđ]+$/i.test(guess)) {
      await interaction.reply({ content: "❌ Koristi samo slova.", ephemeral: true });
      return;
    }

    if (guess.length !== answer.length) {
      await interaction.reply({ content: `❌ Reč mora imati **${answer.length} slova**.`, ephemeral: true });
      return;
    }

    const attempts = getAttempts(user.id, today);

    if (attempts.length >= 6) {
      await interaction.reply({ content: "❌ Potrošila si svih 6 pokušaja za danas.", ephemeral: true });
      return;
    }

    if (attempts.includes(guess)) {
      await interaction.reply({ content: "⚠️ Već si probala tu reč.", ephemeral: true });
      return;
    }

    addAttempt(user.id, today, guess);
    const result = evaluateGuess(guess, answer);
    const won = guess === answer;
    const newCount = attempts.length + 1;

    let description = `**Pokušaj ${newCount}/6**\n\n${formatRow(guess, result)}`;

    if (won) {
      const player = finishWordle(user.id, today, true);
      addXP(user.id, 100);
      addCoins(user.id, 50);

      description += `\n\n🎉 **Pogodila si!**\n🔥 Streak: **${player.current_streak}**\n💰 +50 coins • ⭐ +100 XP`;
    } else if (newCount >= 6) {
      finishWordle(user.id, today, false);
      description += `\n\n😢 Nema više pokušaja.\nDanašnja reč je bila **${answer.toUpperCase()}**.`;
    } else {
      description += `\n\nPreostalo pokušaja: **${6 - newCount}**`;
    }

    await interaction.reply({ embeds: [baseEmbed("WORDLE", description)] });
    return;
  }

  if (interaction.commandName === "wordle-stats") {
    const p = getPlayer(user);
    const rate = p.wordle_played ? Math.round((p.wordle_wins / p.wordle_played) * 100) : 0;

    await interaction.reply({
      embeds: [baseEmbed(
        "WORDLE STATISTIKA",
        `🧩 Odigrano: **${p.wordle_played}**\n` +
        `🏆 Pogođeno: **${p.wordle_wins}**\n` +
        `🎯 Uspešnost: **${rate}%**\n` +
        `🔥 Trenutni streak: **${p.current_streak}**\n` +
        `💥 Najduži streak: **${p.best_streak}**`
      )]
    });
    return;
  }

  if (interaction.commandName === "wordle-top") {
    const rows = leaderboard();
    const text = rows.length
      ? rows.map((p, i) => `**${i + 1}.** ${p.username} — ⭐ ${p.xp} XP • 🧩 ${p.wordle_wins} pobeda`).join("\n")
      : "Leaderboard je još prazan.";

    await interaction.reply({
      embeds: [baseEmbed("UAZALENJE LEADERBOARD", text)]
    });
    return;
  }

  if (interaction.commandName === "profil") {
    const p = getPlayer(user);
    await interaction.reply({
      embeds: [baseEmbed(
        `PROFIL • ${user.username}`,
        `⭐ XP: **${p.xp}**\n` +
        `💰 Coins: **${p.coins}**\n` +
        `🧩 Wordle pobede: **${p.wordle_wins}**\n` +
        `🔥 Streak: **${p.current_streak}**\n` +
        `🏆 Najduži streak: **${p.best_streak}**`
      )]
    });
  }
});

client.login(token);
