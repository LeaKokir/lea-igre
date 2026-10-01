require("dotenv").config();
const fs=require("fs"), path=require("path");
const {
 Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
 EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle
}=require("discord.js");
const {
 getPlayer,addXP,addCoins,addGameScore,getToday,getDailyWord,
 getAttempts,addAttempt,finishWordle,allGamesLeaderboard
}=require("./database/database");
const {normalizeSrpski,evaluateGuess,formatRow}=require("./games/wordle");
const {normalize:normalizeAnagram,sameLetters}=require("./games/anagram");

const token=process.env.DISCORD_TOKEN, clientId=process.env.CLIENT_ID, guildId=process.env.GUILD_ID;
const CHANNELS={
 wordle:process.env.WORDLE_CHANNEL_ID,
 anagram:process.env.ANAGRAM_CHANNEL_ID,
 brzina:process.env.BRZINA_CHANNEL_ID,
 reakcija:process.env.REAKCIJA_CHANNEL_ID,
 leaderboard:process.env.LEADERBOARD_CHANNEL_ID
};
if(!token||!clientId||!guildId||Object.values(CHANNELS).some(v=>!v)){
 console.error("Nedostaje jedna ili više Railway Variables vrednosti."); process.exit(1);
}
const words=JSON.parse(fs.readFileSync(path.join(__dirname,"../data/words.json"),"utf8"));
const anagrams=JSON.parse(fs.readFileSync(path.join(__dirname,"../data/anagrams.json"),"utf8"));

const commands=[
 new SlashCommandBuilder().setName("wordle").setDescription("Pokreni današnji Wordle izazov."),
 new SlashCommandBuilder().setName("pogodi").setDescription("Pošalji pokušaj za današnji Wordle.")
  .addStringOption(o=>o.setName("rec").setDescription("Reč od 5 slova").setRequired(true)),
 new SlashCommandBuilder().setName("wordle-stats").setDescription("Pogledaj svoju Wordle statistiku."),
 new SlashCommandBuilder().setName("wordle-top").setDescription("Wordle rang-lista."),
 new SlashCommandBuilder().setName("wordle-igra").setDescription("Pokreni novu zajedničku dodatnu Wordle rundu."),
 new SlashCommandBuilder().setName("igre").setDescription("Prikaži Uazalenje Games."),
 new SlashCommandBuilder().setName("anagram").setDescription("Pokreni novu Anagram rundu."),
 new SlashCommandBuilder().setName("anagram-pogodi").setDescription("Pogodi trenutni Anagram.")
  .addStringOption(o=>o.setName("rec").setDescription("Tvoj odgovor").setRequired(true)),
 new SlashCommandBuilder().setName("brzina").setDescription("Pokreni novi Speed Type izazov."),
 new SlashCommandBuilder().setName("brzina-pogodi").setDescription("Pošalji tekst za Speed Type.")
  .addStringOption(o=>o.setName("tekst").setDescription("Prepiši tekst").setRequired(true)),
 new SlashCommandBuilder().setName("reakcija").setDescription("Pokreni Reaction Challenge."),
 new SlashCommandBuilder().setName("leaderboard").setDescription("Uazalenje Games leaderboard.")
].map(c=>c.toJSON());

const client=new Client({intents:[GatewayIntentBits.Guilds]});
const sessions={anagram:null,brzina:null,reakcija:null,extraWordle:null};

function embed(title,desc){return new EmbedBuilder().setTitle(`💜 ${title}`).setDescription(desc).setFooter({text:"Lea Igre • Uazalenje"}).setTimestamp();}
function allowed(cmd,channelId){
 const map={wordle:"wordle",pogodi:"wordle","wordle-stats":"wordle","wordle-top":"wordle","wordle-igra":"wordle",
 igre:"leaderboard",anagram:"anagram","anagram-pogodi":"anagram",brzina:"brzina","brzina-pogodi":"brzina",reakcija:"reakcija",leaderboard:"leaderboard"};
 return CHANNELS[map[cmd]]===channelId;
}
function wrongChannel(cmd){
 const map={wordle:"wordle",pogodi:"wordle","wordle-stats":"wordle","wordle-top":"wordle","wordle-igra":"wordle",igre:"leaderboard",anagram:"anagram","anagram-pogodi":"anagram",brzina:"brzina","brzina-pogodi":"brzina",reakcija:"reakcija",leaderboard:"leaderboard"};
 return CHANNELS[map[cmd]];
}

async function register(){
 const rest=new REST({version:"10"}).setToken(token);
 await rest.put(Routes.applicationGuildCommands(clientId,guildId),{body:commands});
 console.log("Slash komande registrovane.");
}
client.once("ready",async()=>{console.log(`Lea Igre online kao ${client.user.tag}`);await register();});

client.on("interactionCreate",async i=>{
 try{
  if(i.isChatInputCommand()){
   const cmd=i.commandName;
   if(!allowed(cmd,i.channelId)){
    return i.reply({content:`🎮 Ova igra se koristi samo u <#${wrongChannel(cmd)}> .`,ephemeral:true});
   }
   const user=i.user, today=getToday();

   if(cmd==="igre"){
    return i.reply({embeds:[embed("UAZALENJE GAMES 🎮",
      "🟪 **#wordle** — Daily + zajedničke dodatne runde\n🔀 **#anagram** — ko prvi složi reč\n⚡ **#brzina** — ko prvi tačno prepiše\n🎯 **#reakcija** — najbrži klik\n🏆 **#games-leaderboard** — XP i coins za sve igre") ]});
   }

   if(cmd==="wordle"){
    const word=getDailyWord(today,words), p=getPlayer(user), attempts=getAttempts(user.id,today);
    return i.reply({embeds:[embed("UAZALENJE DAILY 🇷🇸",
      `🧩 Današnja reč ima **${word.length} slova**.\n\nPokušaji: **${attempts.length}/6**\n🔥 Niz: **${p.current_streak} dana**\n\nKoristi **/pogodi**.\n\n🟩 pravo mesto • 🟨 postoji, drugo mesto • ⬛ nema slova`)]});
   }

   if(cmd==="pogodi"){
    const answer=sessions.extraWordle?.active ? sessions.extraWordle.word : getDailyWord(today,words);
    const isExtra=!!sessions.extraWordle?.active;
    const guess=i.options.getString("rec").trim().toLowerCase(), ng=normalizeSrpski(guess);
    if(!/^[a-zčćžšđ]+$/i.test(guess)||ng.length!==5) return i.reply({content:"❌ Reč mora imati tačno 5 slova.",ephemeral:true});
    const attempts=getAttempts(user.id,today);
    if(attempts.length>=6) return i.reply({content:"❌ Potrošila si svih 6 pokušaja za danas.",ephemeral:true});
    if(attempts.some(a=>normalizeSrpski(a)===ng)) return i.reply({content:"⚠️ Već si probala tu reč.",ephemeral:true});
    addAttempt(user.id,today,guess);
    const result=evaluateGuess(guess,answer), won=ng===normalizeSrpski(answer), n=attempts.length+1;
    let d=`**Pokušaj ${n}/6**\n\n${formatRow(guess,result)}`;
    if(won){
      if(isExtra){
        sessions.extraWordle=null;
        addGameScore(user.id,user.username,"wordle-extra",100);
        d+=`\n\n🏆 **${user.username} je PRVI pogodio/la zajedničku reč!** 🎉\n⭐ +100 XP • 💰 +50 coins\n\n🎮 Runda je završena za sve. Neko može pokrenuti novu pomoću **/wordle-igra**.`;
      } else {
        const p=finishWordle(user.id,today,true);addXP(user.id,100);addCoins(user.id,50);
        d+=`\n\n🎉 **Bravo! Pogodila si današnju reč!**\n🔥 Niz: **${p.current_streak} dana**\n💰 +50 coins • ⭐ +100 XP`;
      }
    }
    else if(n>=6){finishWordle(user.id,today,false);d+=`\n\n😢 Nema više pokušaja.\nDanašnja reč je bila **${answer.toUpperCase()}**.`;}
    else d+=`\n\nPreostalo pokušaja: **${6-n}**`;
    return i.reply({embeds:[embed("WORDLE 🇷🇸",d)]});
   }

   if(cmd==="wordle-igra"){
    if(sessions.extraWordle?.active) return i.reply({embeds:[embed("WORDLE IGRA 🎮","⚠️ Već postoji aktivna zajednička runda!\n\nSvi igraju istu reč. Koristi **/pogodi** da igraš.")]});
    let word;
    do {word=words[Math.floor(Math.random()*words.length)];} while(word===getDailyWord(today,words) && words.length>1);
    sessions.extraWordle={active:true,word,finished:false};
    return i.reply({embeds:[embed("NOVA ZAJEDNIČKA RUNDA 🎮",`🔥 Nova reč je spremna!\n\nSvi u ovom kanalu igraju **istu reč**.\n\nSvako ima svojih **6 pokušaja**.\n\nKoristi **/pogodi <reč>**!`)]});
   }

   if(cmd==="wordle-stats"){
    const p=getPlayer(user),rate=p.wordle_played?Math.round(p.wordle_wins/p.wordle_played*100):0;
    return i.reply({embeds:[embed("WORDLE STATISTIKA",`🧩 Odigrano: **${p.wordle_played}**\n🏆 Pogođeno: **${p.wordle_wins}**\n🎯 Uspešnost: **${rate}%**\n🔥 Niz: **${p.current_streak} dana**\n💥 Najduži niz: **${p.best_streak} dana**`)]});
   }

   if(cmd==="wordle-top"){
    const rows=allGamesLeaderboard(); return i.reply({embeds:[embed("WORDLE / GAMES RANG-LISTA",rows.map((p,n)=>`**${n+1}.** ${p.username} — ⭐ ${p.xp} XP`).join("\n")||"Nema igrača.") ]});
   }

   if(cmd==="anagram"){
    if(sessions.anagram?.active) return i.reply({embeds:[embed("ANAGRAM 🔀","⚠️ Runda je već aktivna!\nKoristi **/anagram-pogodi**.")]});
    const pair=anagrams[Math.floor(Math.random()*anagrams.length)];
    sessions.anagram={active:true,answer:pair[0],started:Date.now()};
    return i.reply({embeds:[embed("ANAGRAM 🔀",`Složi slova u reč:\n\n## ${pair[1].split("").join("  ")}\n\n🏆 Prvi tačan odgovor osvaja **100 XP**!`)]});
   }

   if(cmd==="anagram-pogodi"){
    if(!sessions.anagram?.active) return i.reply({content:"❌ Nema aktivne Anagram runde. Koristi /anagram.",ephemeral:true});
    const guess=normalizeAnagram(i.options.getString("rec"));
    if(guess===normalizeAnagram(sessions.anagram.answer)){
      sessions.anagram=null;addGameScore(user.id,user.username,"anagram",100);
      return i.reply({embeds:[embed("ANAGRAM — POBEDNIK! 🏆",`🎉 **${user.username}** je prvi pogodio/la reč!\n\n⭐ **+100 XP**\n💰 **+50 coins**`)]});
    }
    return i.reply({content:"❌ Nije tačno!",ephemeral:true});
   }

   if(cmd==="brzina"){
    if(sessions.brzina?.active) return i.reply({embeds:[embed("BRZINA ⚡","⚠️ Runda je već aktivna!")]});
    const texts=["Uazalenje Games okuplja najbrže igrače.","Ko prvi napiše ovu rečenicu osvaja rundu.","Lea Igre svaki dan donosi novi izazov.","Brzina, preciznost i malo sreće."];
    const target=texts[Math.floor(Math.random()*texts.length)];
    sessions.brzina={active:true,target,started:Date.now()};
    return i.reply({embeds:[embed("BRZINA ⚡",`Prepiši tekst **tačno**:\n\n> ${target}\n\n🏆 Prvi tačan odgovor osvaja **100 XP**!\nKoristi **/brzina-pogodi**.`)]});
   }

   if(cmd==="brzina-pogodi"){
    if(!sessions.brzina?.active) return i.reply({content:"❌ Nema aktivne Brzina runde. Koristi /brzina.",ephemeral:true});
    const answer=i.options.getString("tekst"), s=sessions.brzina;
    if(answer.trim()===s.target){
      const seconds=((Date.now()-s.started)/1000).toFixed(2); sessions.brzina=null;
      addGameScore(user.id,user.username,"brzina",100);
      return i.reply({embeds:[embed("BRZINA — POBEDNIK! ⚡",`🥇 **${user.username}** je prvi/a!\n\n⏱️ Bot vreme: **${seconds}s**\n⭐ **+100 XP**\n💰 **+50 coins**`)]});
    }
    return i.reply({content:"❌ Nije potpuno tačno. Probaj ponovo!",ephemeral:true});
   }

   if(cmd==="reakcija"){
    if(sessions.reakcija?.active) return i.reply({embeds:[embed("REAKCIJA 🎯","⚠️ Runda je već aktivna!")]});
    const delay=3000+Math.floor(Math.random()*5000);
    sessions.reakcija={active:true,ready:false,started:0,timeout:null};
    const msg=await i.reply({embeds:[embed("REAKCIJA 🎯","⏳ Čekaj... **NE KLIKAJ JOŠ!**")],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("reaction_wait").setLabel("ČEKAJ...").setStyle(ButtonStyle.Secondary).setDisabled(true))],fetchReply:true});
    sessions.reakcija.messageId=msg.id;
    sessions.reakcija.timeout=setTimeout(async()=>{
      if(!sessions.reakcija?.active)return;
      sessions.reakcija.ready=true;sessions.reakcija.started=Date.now();
      const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("reaction_go").setLabel("🟢 KLIKNI!").setStyle(ButtonStyle.Success));
      try{await msg.edit({embeds:[embed("REAKCIJA 🎯","## 🟢 KLIKNI!\n\nKo prvi klikne, pobeđuje! 🚀")],components:[row]});}catch{}
    },delay);
    return;
   }
   if(cmd==="leaderboard"){
    const rows=allGamesLeaderboard();
    const txt=rows.length?rows.map((p,n)=>`**${n+1}.** ${p.username} — ⭐ **${p.xp} XP** • 💰 ${p.coins}`).join("\n"):"Nema igrača.";
    return i.reply({embeds:[embed("UAZALENJE GAMES 🏆",txt)]});
   }
  }

  if(i.isButton() && i.customId==="reaction_go"){
    if(!sessions.reakcija?.active || !sessions.reakcija.ready) return i.reply({content:"❌ Preuranjeno ili je runda završena.",ephemeral:true});
    const ms=Date.now()-sessions.reakcija.started, winner=i.user;
    sessions.reakcija=null; addGameScore(winner.id,winner.username,"reakcija",100);
    return i.update({embeds:[embed("REAKCIJA — POBEDNIK! 🏆",`🥇 **${winner.username}** je prvi/a!\n\n⚡ Reakcija: **${ms} ms**\n⭐ **+100 XP**\n💰 **+50 coins**`)],components:[]});
  }
 }catch(e){console.error(e);if(i.isRepliable()&&!i.replied&&!i.deferred) i.reply({content:"❌ Došlo je do greške.",ephemeral:true}).catch(()=>{});}
});
client.login(token);
