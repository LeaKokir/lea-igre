require("dotenv").config();

const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const {
  getPlayer, addXP, addCoins, getToday, getDailyWord,
  getAttempts, addAttempt, finishWordle,
  getLatestFreeGame, getActiveFreeGame, createFreeGame, getFreeAttempts, addFreeAttempt, finishFreeGame,
  leaderboard
} = require("./database/database");

const {
  normalizeSrpski, evaluateGuess, formatRow
} = require("./games/wordle");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const wordleChannelId = process.env.WORDLE_CHANNEL_ID;

if (!token || !clientId || !guildId || !wordleChannelId) {
  console.error("Nedostaje DISCORD_TOKEN, CLIENT_ID, GUILD_ID ili WORDLE_CHANNEL_ID u Railway Variables.");
  process.exit(1);
}

const words = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../data/words.json"), "utf8")
).map(w => w.toLowerCase());

const commands = [
  new SlashCommandBuilder()
    .setName("wordle")
    .setDescription("Pokreni današnji Wordle izazov na srpskom."),
  new SlashCommandBuilder()
    .setName("wordle-igra")
    .setDescription("Pokreni dodatnu Wordle partiju nakon Daily izazova."),
  new SlashCommandBuilder()
    .setName("pogodi")
    .setDescription("Pošalji pokušaj za aktivnu Wordle partiju.")
    .addStringOption(o =>
      o.setName("rec")
        .setDescription("Reč od 5 slova")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("wordle-stats")
    .setDescription("Pogledaj svoju Wordle statistiku."),
  new SlashCommandBuilder()
    .setName("wordle-top")
    .setDescription("Pogledaj Uazalenje Wordle rang-listu."),
  new SlashCommandBuilder()
    .setName("profil")
    .setDescription("Pogledaj svoj Lea Igre profil.")
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commands }
  );
  console.log("Slash komande su registrovane.");
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
  console.log(`Bot je online kao ${client.user.tag}`);
  await registerCommands();
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const gameCommands = ["wordle", "wordle-igra", "pogodi", "wordle-stats", "wordle-top"];
  if (gameCommands.includes(interaction.commandName) && interaction.channelId !== wordleChannelId) {
    await interaction.reply({
      content: `🎮 Ova igra se koristi samo u kanalu <#${wordleChannelId}>.`,
      ephemeral: true
    });
    return;
  }

  const user = interaction.user;
  const today = getToday();

  if (interaction.commandName === "wordle") {
    const word = getDailyWord(today, words);
    const player = getPlayer(user);
    const attempts = getAttempts(user.id, today);

    await interaction.reply({
      embeds: [baseEmbed(
        "UAZALENJE DAILY 🇷🇸",
        `🧩 **Današnja reč ima ${word.length} slova.**\n\n` +
        `Pokušaji: **${attempts.length}/6**\n` +
        `🔥 Trenutni niz: **${player.current_streak} dana**\n\n` +
        `Koristi **/pogodi** i unesi svoju reč.\n\n` +
        `🟩 pravo mesto • 🟨 postoji, drugo mesto • ⬛ nema slova`
      )]
    });
    return;
  }

  if (interaction.commandName === "wordle-igra") {
    const existing = getActiveFreeGame(interaction.channelId);
    if (existing) {
      const attempts = getFreeAttempts(existing.id, user.id);
      await interaction.reply({
        embeds: [baseEmbed(
          "DODATNA WORDLE IGRA 🎮",
          `Već postoji aktivna dodatna partija u ovom kanalu.

🎮 Svi igrači u ovom kanalu pogađaju **istu reč**.

Pokušaji: **${attempts.length}/6**

Koristi **/pogodi rec:** da nastaviš.`
        )]
      });
      return;
    }

    const daily = getDailyWord(today, words);
    const game = createFreeGame(interaction.channelId, words, daily);

    await interaction.reply({
      embeds: [baseEmbed(
        "NOVA WORDLE IGRA 🎮",
        `Daily je završen? Nema problema — možeš da igraš dalje! 💜

` +
        `🧩 Reč ima **5 slova**.
` +
        `👥 Svi igrači u ovom kanalu dobijaju **istu reč**.
` +
        `🎯 Imaš **6 pokušaja**.

` +
        `Koristi **/pogodi rec:** da pogađaš.

` +
        `🟩 pravo mesto • 🟨 postoji, drugo mesto • ⬛ nema slova`
      )]
    });
    return;
  }

  if (interaction.commandName === "pogodi") {
    const guess = interaction.options.getString("rec").trim().toLowerCase();
    const normalizedGuess = normalizeSrpski(guess);

    if (!/^[a-zčćžšđ]+$/i.test(guess)) {
      await interaction.reply({ content: "❌ Reč može da sadrži samo slova.", ephemeral: true });
      return;
    }

    if ([...guess].length !== 5) {
      await interaction.reply({ content: "❌ Reč mora imati **tačno 5 slova**.", ephemeral: true });
      return;
    }

    // Ako postoji aktivna dodatna igra, /pogodi nastavlja zajedničku partiju za ovaj kanal. Svaki igrač ima svojih 6 pokušaja.
    const freeGame = getActiveFreeGame(interaction.channelId);
    if (freeGame) {
      const attempts = getFreeAttempts(freeGame.id, user.id);

      if (attempts.length >= 6) {
        finishFreeGame(freeGame.id, false);
        await interaction.reply({
          content: `❌ Ova dodatna partija je već završena. Današnja reč je bila **${freeGame.word.toUpperCase()}**.

Pokreni novu sa **/wordle-igra**.`,
          ephemeral: true
        });
        return;
      }

      if (attempts.some(a => normalizeSrpski(a) === normalizedGuess)) {
        await interaction.reply({ content: "⚠️ Već si pokušala tu reč u ovoj partiji.", ephemeral: true });
        return;
      }

      addFreeAttempt(freeGame.id, user.id, guess);
      const result = evaluateGuess(guess, freeGame.word);
      const won = normalizedGuess === normalizeSrpski(freeGame.word);
      const newCount = attempts.length + 1;

      let description = `**Pokušaj ${newCount}/6**\n\n${formatRow(guess, result)}`;
      if (won) {
        finishFreeGame(freeGame.id, true);
        addXP(user.id, 50);
        addCoins(user.id, 25);
        description += `\n\n🏆 **${user.username} je PRVA pogodila reč!** 🎉\n` +
          `💰 **+25 coins** • ⭐ **+50 XP**\n\n` +
          `💜 Ova runda je završena za sve igrače.\n` +
          `🎮 Ko želi novu rundu može pokrenuti **/wordle-igra**.`;
      } else {
        description += `\n\nPreostalo pokušaja: **${6 - newCount}**`;
      }

      await interaction.reply({ embeds: [baseEmbed("DODATNI WORDLE 🎮", description)] });
      return;
    }

    // Ako je poslednja zajednička dodatna runda završena, /pogodi ne
    // prebacuje korisnika slučajno na Daily. Daily se pokreće preko /wordle.
    const latestFreeGame = getLatestFreeGame(interaction.channelId);
    if (latestFreeGame && latestFreeGame.status !== "active") {
      await interaction.reply({
        content: `🏁 **Ova zajednička runda je završena.**\n\n` +
          `🏆 Reč je bila **${latestFreeGame.word.toUpperCase()}**.\n` +
          `🎮 Pokreni novu rundu sa **/wordle-igra**.`,
        ephemeral: true
      });
      return;
    }

    // U suprotnom /pogodi radi za Daily.
    const answer = getDailyWord(today, words);
    const attempts = getAttempts(user.id, today);

    const player = getPlayer(user);
    if (player.last_wordle_date === today || attempts.length >= 6) {
      await interaction.reply({
        content: `🎉 **Ispunila si svoj Daily za danas!**\n\nAko želiš da igraš dalje, koristi **/wordle-igra** i pokreni dodatnu partiju. 💜`,
        ephemeral: true
      });
      return;
    }

    if (attempts.some(a => normalizeSrpski(a) === normalizedGuess)) {
      await interaction.reply({ content: "⚠️ Već si pokušala tu reč.", ephemeral: true });
      return;
    }

    addAttempt(user.id, today, guess);
    const result = evaluateGuess(guess, answer);
    const won = normalizedGuess === normalizeSrpski(answer);
    const newCount = attempts.length + 1;

    let description = `**Pokušaj ${newCount}/6**\n\n${formatRow(guess, result)}`;

    if (won) {
      const playerAfter = finishWordle(user.id, today, true);
      addXP(user.id, 100);
      addCoins(user.id, 50);
      description +=
        `\n\n🎉 **Bravo! Pogodila si današnju reč!**\n` +
        `🔥 Trenutni niz: **${playerAfter.current_streak} dana**\n` +
        `💰 **+50 coins** • ⭐ **+100 XP**\n\n` +
        `🎮 **Daily je ispunjen!** Ako želiš još jednu partiju, koristi **/wordle-igra**.`;
    } else if (newCount >= 6) {
      finishWordle(user.id, today, false);
      description +=
        `\n\n😢 Nema više pokušaja.\n` +
        `Današnja reč je bila **${answer.toUpperCase()}**.\n\n` +
        `🎮 Možeš nastaviti sa dodatnom partijom preko **/wordle-igra**.`;
    } else {
      description += `\n\nPreostalo pokušaja: **${6 - newCount}**`;
    }

    await interaction.reply({ embeds: [baseEmbed("WORDLE 🇷🇸", description)] });
    return;
  }

  if (interaction.commandName === "wordle-stats") {
    const p = getPlayer(user);
    const rate = p.wordle_played
      ? Math.round((p.wordle_wins / p.wordle_played) * 100)
      : 0;

    await interaction.reply({
      embeds: [baseEmbed(
        "WORDLE STATISTIKA",
        `🧩 Odigrano: **${p.wordle_played}**\n` +
        `🏆 Pogođeno: **${p.wordle_wins}**\n` +
        `🎯 Uspešnost: **${rate}%**\n` +
        `🔥 Trenutni niz: **${p.current_streak} dana**\n` +
        `💥 Najduži niz: **${p.best_streak} dana**`
      )]
    });
    return;
  }

  if (interaction.commandName === "wordle-top") {
    const rows = leaderboard();

    const text = rows.length
      ? rows.map((p, i) =>
          `**${i + 1}.** ${p.username} — ⭐ ${p.xp} XP • 🧩 ${p.wordle_wins} pobeda`
        ).join("\n")
      : "Rang-lista je još prazna.";

    await interaction.reply({
      embeds: [baseEmbed("UAZALENJE RANG-LISTA 🏆", text)]
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
        `🔥 Trenutni niz: **${p.current_streak} dana**\n` +
        `🏆 Najduži niz: **${p.best_streak} dana**`
      )]
    });
  }
});

client.login(token);
