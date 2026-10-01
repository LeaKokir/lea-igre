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
const {normalize:normalizeAnagram}=require("./games/anagram");

const token=process.env.DISCORD_TOKEN, clientId=process.env.CLIENT_ID, guildId=process.env.GUILD_ID;
const CHANNELS={
 wordle:process.env.WORDLE_CHANNEL_ID,
 anagram:process.env.ANAGRAM_CHANNEL_ID,
 brzina:process.env.BRZINA_CHANNEL_ID,
 reakcija:process.env.REAKCIJA_CHANNEL_ID,
 leaderboard:process.env.LEADERBOARD_CHANNEL_ID
};
const CHANNEL_NAMES={trivia:"trivia",hangman:"hangman",koSamJa:"ko-sam-ja"};
function findChannelId(key){
 const envKey={trivia:"TRIVIA_CHANNEL_ID",hangman:"HANGMAN_CHANNEL_ID",koSamJa:"KOSAMJA_CHANNEL_ID"}[key];
 if(envKey && process.env[envKey]) return process.env[envKey];
 const wanted=CHANNEL_NAMES[key];
 const guild=client?.guilds?.cache?.get(guildId);
 const ch=guild?.channels?.cache?.find(c=>c.isTextBased?.() && (c.name===wanted || c.name.endsWith("・"+wanted) || c.name.endsWith("-"+wanted)));
 return ch?.id;
}
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
 new SlashCommandBuilder().setName("trivia").setDescription("Pokreni Trivia Battle."),
 new SlashCommandBuilder().setName("trivia-odgovor").setDescription("Odgovori na aktivno Trivia pitanje.")
  .addStringOption(o=>o.setName("odgovor").setDescription("Tvoj odgovor").setRequired(true)),
 new SlashCommandBuilder().setName("hangman").setDescription("Pokreni Competitive Hangman."),
 new SlashCommandBuilder().setName("hangman-slovo").setDescription("Pogodi slovo u Hangmanu.")
  .addStringOption(o=>o.setName("slovo").setDescription("Jedno slovo").setRequired(true)),
 new SlashCommandBuilder().setName("hangman-rec").setDescription("Pogodi celu Hangman reč.")
  .addStringOption(o=>o.setName("rec").setDescription("Tvoja reč").setRequired(true)),
 new SlashCommandBuilder().setName("kosamja").setDescription("Pokreni Ko sam ja?"),
 new SlashCommandBuilder().setName("kosamja-odgovor").setDescription("Odgovori na Ko sam ja? izazov.")
  .addStringOption(o=>o.setName("odgovor").setDescription("Tvoj odgovor").setRequired(true)),
 new SlashCommandBuilder().setName("leaderboard").setDescription("Uazalenje Games leaderboard.")
].map(c=>c.toJSON());

const client=new Client({intents:[GatewayIntentBits.Guilds]});
const sessions={anagram:null,brzina:null,reakcija:null,extraWordle:new Map(),trivia:null,hangman:null,koSamJa:null};
// Srpski odgovori: prihvata latinicu, ćirilicu, velika/mala slova i osnovne razlike u pisanju.
function normalizeSerbianAnswer(value=""){
 return String(value)
  .trim()
  .toLowerCase()
  .replace(/[Аа]/g,"a").replace(/[Бб]/g,"b").replace(/[Вв]/g,"v")
  .replace(/[Гг]/g,"g").replace(/[Дд]/g,"d").replace(/[Ђђ]/g,"đ")
  .replace(/[Ее]/g,"e").replace(/[Жж]/g,"ž").replace(/[Зз]/g,"z")
  .replace(/[Ии]/g,"i").replace(/[Јј]/g,"j").replace(/[Кк]/g,"k")
  .replace(/[Лл]/g,"l").replace(/[Љљ]/g,"lj").replace(/[Мм]/g,"m")
  .replace(/[Нн]/g,"n").replace(/[Њњ]/g,"nj").replace(/[Оо]/g,"o")
  .replace(/[Пп]/g,"p").replace(/[Рр]/g,"r").replace(/[Сс]/g,"s")
  .replace(/[Тт]/g,"t").replace(/[Ћћ]/g,"ć").replace(/[Уу]/g,"u")
  .replace(/[Фф]/g,"f").replace(/[Хх]/g,"h").replace(/[Цц]/g,"c")
  .replace(/[Чч]/g,"č").replace(/[Џџ]/g,"dž").replace(/[Шш]/g,"š")
  .replace(/ё/g,"e")
  .replace(/[.,!?;:'"“”„()\-_/\\]/g," ")
  .replace(/\s+/g," ")
  .trim();
}

// Za poređenje odgovora ne pravimo razliku između slova sa i bez kvačica.
// Prikaz u igri ostaje pravilan srpski: š, č, ć, ž, đ.
function normalizeGameAnswer(value="") {
 return normalizeSerbianAnswer(value)
  .replace(/č/g,"c").replace(/ć/g,"c").replace(/š/g,"s")
  .replace(/ž/g,"z").replace(/đ/g,"d");
}


function evaluateSerbianWordleGuess(guess, answer){
 const g=[...normalizeGameAnswer(guess)];
 const a=[...normalizeGameAnswer(answer)];
 const result=Array(a.length).fill("absent");
 const counts={};
 for(let i=0;i<a.length;i++) counts[a[i]]=(counts[a[i]]||0)+1;
 for(let i=0;i<g.length;i++){
  if(g[i]===a[i]){result[i]="correct";counts[g[i]]--;}
 }
 for(let i=0;i<g.length;i++){
  if(result[i]==="correct") continue;
  if((counts[g[i]]||0)>0){result[i]="present";counts[g[i]]--;}
 }
 return result;
}

const PURPLE=0x9b59b6;
function embed(title,desc,opts={}){
 const e=new EmbedBuilder()
  .setColor(opts.color ?? PURPLE)
  .setTitle(title)
  .setDescription(desc)
  .setFooter({text:"💜 Uazalenje Games • Lea Igre"})
  .setTimestamp();
 if(opts.fields) e.addFields(opts.fields);
 return e;
}
function gameHeader(icon,name,subtitle){
 return `╭━━━━━━━━━━━━━━━━━━━━━━━━━━╮\n│ ${icon} **${name.toUpperCase()}**\n│ ${subtitle}\n╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯`;
}
function shuffleLetters(text){
 const chars=[...text];
 for(let i=chars.length-1;i>0;i--){
  const j=Math.floor(Math.random()*(i+1));
  [chars[i],chars[j]]=[chars[j],chars[i]];
 }
 if(chars.join("")===text && chars.length>1) [chars[0],chars[1]]=[chars[1],chars[0]];
 return chars.join("");
}
function letterTiles(text){
 const chars=[...text];
 const tiles=chars.map(()=>`🟪`).join(" ");
 const letters=chars.map(c=>`**${c.toLocaleUpperCase("sr-RS")}**`).join("   ");
 return `${tiles}\n${letters}`;
}
function statLine(label,value){return `**${label}**  ${value}`;}
function allowed(cmd,channelId){
 if(cmd==="igre") return true;
 const map={wordle:"wordle",pogodi:"wordle","wordle-stats":"wordle","wordle-top":"wordle","wordle-igra":"wordle",
 anagram:"anagram","anagram-pogodi":"anagram",brzina:"brzina","brzina-pogodi":"brzina",reakcija:"reakcija",
 trivia:"trivia","trivia-odgovor":"trivia",hangman:"hangman","hangman-slovo":"hangman","hangman-rec":"hangman",
 kosamja:"koSamJa","kosamja-odgovor":"koSamJa",leaderboard:"leaderboard"};
 const key=map[cmd];
 return (CHANNELS[key] || findChannelId(key))===channelId;
}
function wrongChannel(cmd){
 const map={wordle:"wordle",pogodi:"wordle","wordle-stats":"wordle","wordle-top":"wordle","wordle-igra":"wordle",
 anagram:"anagram","anagram-pogodi":"anagram",brzina:"brzina","brzina-pogodi":"brzina",reakcija:"reakcija",
 trivia:"trivia","trivia-odgovor":"trivia",hangman:"hangman","hangman-slovo":"hangman","hangman-rec":"hangman",
 kosamja:"koSamJa","kosamja-odgovor":"koSamJa",leaderboard:"leaderboard"};
 const key=map[cmd];
 return CHANNELS[key] || findChannelId(key);
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
    const channelButtons = [
      ["🟪 Wordle","wordle"],["🔀 Anagram","anagram"],["⚡ Brzina","brzina"],
      ["🎯 Reakcija","reakcija"],["🏆 Leaderboard","leaderboard"],
      ["🧠 Trivia","trivia"],["🕵️ Hangman","hangman"],["❓ Ko sam ja?","koSamJa"]
    ].map(([label,key])=>[label,CHANNELS[key]||findChannelId(key)]).filter(([,id])=>id);

    const rows=[];
    for(let n=0;n<channelButtons.length;n+=5){
      const row=new ActionRowBuilder();
      for(const [label,channelId] of channelButtons.slice(n,n+5)){
        row.addComponents(new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${guildId}/${channelId}`));
      }
      rows.push(row);
    }

    return i.reply({
      embeds:[embed("💜 UAZALENJE GAMES • 🎮", 
        gameHeader("🎮","UAZALENJE GAMES","Izaberi igru i takmiči se.") +
        `\n\n🟪 **WORDLE**  ·  Daily + lične dodatne runde\n` +
        `🔀 **ANAGRAM**  ·  složi pomešana slova\n` +
        `⚡ **BRZINA**  ·  najbrži tačan prepis\n` +
        `🎯 **REAKCIJA**  ·  najbrži klik\n` +
        `🧠 **TRIVIA**  ·  znanje i brzina\n` +
        `🕵️ **HANGMAN**  ·  otkrij skrivenu reč\n` +
        `❓ **KO SAM JA?**  ·  pogodi osobu\n` +
        `🏆 **LEADERBOARD**  ·  XP + coins\n\n` +
        `╭────────────────────────╮\n` +
        `│ 💜 **SREĆNO I ZABAVI SE!** │\n` +
        `╰────────────────────────╯`
      )],
      components:rows
    });
   }

   if(cmd==="wordle"){
    const word=getDailyWord(today,words), p=getPlayer(user), attempts=getAttempts(user.id,today);
    return i.reply({embeds:[embed("🟪 WORDLE • DAILY",
      gameHeader("🟪","WORDLE DAILY","Jedna reč • 6 pokušaja") +
      `\n\n🧩 Reč ima **${word.length} slova**\n` +
      `🎯 Pokušaji: **${attempts.length}/6**\n` +
      `🔥 Niz: **${p.current_streak} dana**\n\n` +
      `💡 Koristi **/pogodi <reč>**\n\n` +
      `🟩 **pravo mesto**   🟨 **postoji**   ⬛ **nema slova**`
    )]});
   }

   if(cmd==="pogodi"){
    const userId=user.id;
    const extra=sessions.extraWordle.get(userId);
    const isExtra=!!extra?.active;
    const answer=isExtra ? extra.word : getDailyWord(today,words);
    const guess=i.options.getString("rec").trim().toLowerCase(), ng=normalizeSrpski(guess);
    if(!/^[a-zčćžšđ]+$/i.test(guess)||ng.length!==5) return i.reply({content:"❌ Reč mora imati tačno 5 slova.",ephemeral:true});
    const attempts=isExtra ? extra.attempts : getAttempts(userId,today);
    if(attempts.length>=6) return i.reply({content:isExtra?"❌ Potrošila si svih 6 pokušaja u ovoj dodatnoj partiji. Pokreni novu sa **/wordle-igra**.":"❌ Potrošila si svih 6 pokušaja za današnji Daily.",ephemeral:true});
    if(attempts.some(a=>normalizeSrpski(a)===ng)) return i.reply({content:"⚠️ Već si probala tu reč.",ephemeral:true});
    if(isExtra) extra.attempts.push(guess); else addAttempt(userId,today,guess);
    const result=evaluateGuess(guess,answer), won=ng===normalizeSrpski(answer), n=attempts.length+1;
    let d=`**Pokušaj ${n}/6**\n\n${formatRow(guess,result)}`;
    if(won){
      if(isExtra){
       sessions.extraWordle.delete(userId); addGameScore(userId,user.username,"wordle-extra",100); addCoins(userId,50);
       d+=`\n\n🏆 **Bravo, ${user.username}! Pogodila si svoju privatnu reč!** 🎉\n⭐ +100 XP • 💰 +50 coins\n\n🎮 Za novu svoju reč koristi **/wordle-igra**.`;
      } else {
       const p=finishWordle(userId,today,true); addXP(userId,100); addCoins(userId,50);
       d+=`\n\n🎉 **Bravo! Pogodila si današnju reč!**\n🔥 Niz: **${p.current_streak} dana**\n💰 +50 coins • ⭐ +100 XP\n\n🎮 Daily je ispunjen. Za svoju dodatnu reč koristi **/wordle-igra**.`;
      }
    } else if(n>=6){
      if(isExtra){
       sessions.extraWordle.delete(userId);
       d+=`\n\n😢 Nema više pokušaja.\nTvoja reč je bila **${answer.toUpperCase()}**.\n\n🎮 Za novu svoju reč koristi **/wordle-igra**.`;
      } else {
       finishWordle(userId,today,false);
       d+=`\n\n😢 Nema više pokušaja.\nDanašnja reč je bila **${answer.toUpperCase()}**.\n\n🎮 Sutra te čeka novi Daily.`;
      }
    } else d+=`\n\nPreostalo pokušaja: **${6-n}**`;
    return i.reply({embeds:[embed(isExtra?"WORDLE — TVOJA DODATNA IGRA 🎮":"WORDLE DAILY 🇷🇸",d)]});
   }

   if(cmd==="wordle-igra"){
    const existing=sessions.extraWordle.get(user.id);
    if(existing?.active) return i.reply({embeds:[embed("WORDLE IGRA 🎮","⚠️ Već imaš aktivnu dodatnu partiju!\n\nTo je **tvoja privatna reč**.\n\nKoristi **/pogodi <reč>**.")]});
    let word;
    do {word=words[Math.floor(Math.random()*words.length)];} while(word===getDailyWord(today,words) && words.length>1);
    sessions.extraWordle.set(user.id,{active:true,word,attempts:[]});
    return i.reply({embeds:[embed("NOVA TVOJA RUNDA 🎮",`🔥 Dobila si **svoju privatnu reč**!\n\nNiko drugi ne igra tvoju reč.\n\nImaš **6 pokušaja**.\n\nKoristi **/pogodi <reč>**!`)]});
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
    const mixed=shuffleLetters(pair[0]);
    return i.reply({embeds:[embed("🔀 ANAGRAM • LEA IGRE",
      gameHeader("🔀","ANAGRAM","Složi pomešana slova") +
      `\n\n${letterTiles(mixed)}\n\n` +
      `╭────────────────────────╮\n` +
      `│ 🧩 **ZADATAK**          │\n` +
      `│ Složi slova u jednu reč.│\n` +
      `╰────────────────────────╯\n\n` +
      `🏆 **Nagrada:** ⭐ 100 XP  ·  💰 50 coins\n` +
      `💡 **Odgovor:** \/anagram-pogodi <reč>`
    )]});
   }

   if(cmd==="anagram-pogodi"){
    if(!sessions.anagram?.active) return i.reply({content:"❌ Nema aktivne Anagram runde. Koristi /anagram.",ephemeral:true});
    const guess=normalizeGameAnswer(i.options.getString("rec"));
    if(guess===normalizeGameAnswer(sessions.anagram.answer)){
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
    return i.reply({embeds:[embed("⚡ BRZINA • LEA IGRE",
      gameHeader("⚡","BRZINA","Ko je najbrži?") +
      `\n\n╭────────────────────────────╮\n` +
      `│ 🏁 **PREPIŠI TAČNO**        │\n` +
      `╰────────────────────────────╯\n\n` +
      `> **${target}**\n\n` +
      `🏆 **Nagrada:** ⭐ 100 XP  ·  💰 50 coins\n` +
      `💡 \/brzina-pogodi <tekst>`
    )]});
   }

   if(cmd==="brzina-pogodi"){
    if(!sessions.brzina?.active) return i.reply({content:"❌ Nema aktivne Brzina runde. Koristi /brzina.",ephemeral:true});
    const answer=i.options.getString("tekst"), s=sessions.brzina;
    if(normalizeGameAnswer(answer)===normalizeGameAnswer(s.target)){
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
      try{await msg.edit({embeds:[embed("🎯 REAKCIJA • SAD!",
        gameHeader("🟢","KLIKNI!","Ko je najbrži?") +
        `\n\n# 🟢 KLIKNI ODMAH!\n\n🚀 **Prvi klik pobeđuje.**`
      )],components:[row]});}catch{}
    },delay);
    return;
   }
   if(cmd==="trivia"){
    if(sessions.trivia?.active) return i.reply({embeds:[embed("TRIVIA BATTLE 🧠","⚠️ Pitanje je već aktivno!\n\nPrvi tačan odgovor osvaja rundu.\nKoristi **/trivia-odgovor <odgovor>**.")]});
    const questions=[
     {q:"Koji je glavni grad Australije?",a:["Kanbera","Canberra"]},
     {q:"Koja planeta je poznata kao Crvena planeta?",a:["Mars"]},
     {q:"Koliko strana ima trougao?",a:["3","tri"]},
     {q:"Koji je najveći okean na Zemlji?",a:["Pacifik","Tihi okean"]},
     {q:"Koji je hemijski simbol za zlato?",a:["Au","zlato"]},
     {q:"Koliko igrača ima fudbalski tim na terenu?",a:["11","jedanaest"]}
    ];
    const item=questions[Math.floor(Math.random()*questions.length)];
    sessions.trivia={active:true,question:item,started:Date.now()};
    return i.reply({embeds:[embed("🧠 TRIVIA BATTLE • LEA IGRE",
      gameHeader("🧠","TRIVIA BATTLE","Znanje + brzina") +
      `\n\n╭────────────────────────────╮\n` +
      `│ ❓ **PITANJE**              │\n` +
      `╰────────────────────────────╯\n\n` +
      `## ${item.q}\n\n` +
      `🏆 **100 XP**  ·  💰 **50 coins**\n` +
      `💡 \/trivia-odgovor <odgovor>`
    )]});
   }

   if(cmd==="trivia-odgovor"){
    if(!sessions.trivia?.active) return i.reply({content:"❌ Nema aktivnog Trivia pitanja. Koristi **/trivia**.",ephemeral:true});
    const guess=normalizeGameAnswer(i.options.getString("odgovor"));
    const correct=sessions.trivia.question.a.some(a=>guess===normalizeGameAnswer(a));
    if(correct){
     const elapsed=((Date.now()-sessions.trivia.started)/1000).toFixed(2);
     sessions.trivia=null; addGameScore(user.id,user.username,"trivia",100); addCoins(user.id,50);
     return i.reply({embeds:[embed("TRIVIA — POBEDNIK! 🏆",`🥇 **${user.username}** je prvi/a odgovorio/la tačno!\n\n⏱️ Vreme: **${elapsed}s**\n⭐ **+100 XP**\n💰 **+50 coins**`)]});
    }
    return i.reply({content:"❌ Nije tačno! Probaj ponovo.",ephemeral:true});
   }

   if(cmd==="hangman"){
    if(sessions.hangman?.active) return i.reply({embeds:[embed("HANGMAN 🕵️","⚠️ Runda je već aktivna!\n\nSvi pogađaju istu reč.\nKoristi **/hangman-slovo** ili **/hangman-rec**.")]});
    const pool=words.filter(w=>normalizeSrpski(w).length===5);
    const answer=pool[Math.floor(Math.random()*pool.length)].toLowerCase();
    sessions.hangman={active:true,answer,guessed:new Set(),wrong:0,maxWrong:6};
    return i.reply({embeds:[embed("🕵️ HANGMAN • LEA IGRE",
      gameHeader("🕵️","HANGMAN","Otkrij skrivenu reč") +
      `\n\n## ${answer.split("").map(()=> "＿").join("  ")}\n\n` +
      `💀 **Greške:** 0/6\n` +
      `🔤 **Slovo:** \/hangman-slovo <slovo>\n` +
      `📝 **Cela reč:** \/hangman-rec <reč>\n\n` +
      `🏆 **Nagrada:** ⭐ 100 XP  ·  💰 50 coins`
    )]});
   }

   if(cmd==="hangman-slovo"){
    if(!sessions.hangman?.active) return i.reply({content:"❌ Nema aktivnog Hangman-a. Koristi **/hangman**.",ephemeral:true});
    const letter=normalizeGameAnswer(i.options.getString("slovo"));
    if(letter.length!==1 || !/^[a-zčćžšđ]$/i.test(letter)) return i.reply({content:"❌ Unesi samo jedno slovo.",ephemeral:true});
    const s=sessions.hangman;
    if(s.guessed.has(letter)) return i.reply({content:"⚠️ To slovo je već probano.",ephemeral:true});
    s.guessed.add(letter);
    if(!normalizeGameAnswer(s.answer).includes(letter)) s.wrong++;
    const masked=s.answer.split("").map(ch=>s.guessed.has(normalizeGameAnswer(ch))?ch:"＿").join(" ");
    if(!masked.includes("＿")){
     sessions.hangman=null; addGameScore(user.id,user.username,"hangman",100); addCoins(user.id,50);
     return i.reply({embeds:[embed("HANGMAN — POBEDNIK! 🏆",`🎉 **${user.username}** je otkrio/la reč: **${s.answer.toUpperCase()}**\n\n⭐ **+100 XP**\n💰 **+50 coins**`)]});
    }
    if(s.wrong>=s.maxWrong){
     sessions.hangman=null;
     return i.reply({embeds:[embed("HANGMAN — KRAJ 😢",`Reč je bila **${s.answer.toUpperCase()}**.`)]});
    }
    return i.reply({embeds:[embed("HANGMAN 🕵️",`${masked}\n\n💀 Greške: **${s.wrong}/6**\n🔤 Probano: ${[...s.guessed].join(", ")}`)]});
   }

   if(cmd==="hangman-rec"){
    if(!sessions.hangman?.active) return i.reply({content:"❌ Nema aktivnog Hangman-a. Koristi **/hangman**.",ephemeral:true});
    const s=sessions.hangman, guess=normalizeGameAnswer(i.options.getString("rec"));
    if(guess===normalizeSerbianAnswer(s.answer)){
     sessions.hangman=null; addGameScore(user.id,user.username,"hangman",100); addCoins(user.id,50);
     return i.reply({embeds:[embed("HANGMAN — POBEDNIK! 🏆",`🎉 **${user.username}** je prvi/a pogodio/la reč: **${s.answer.toUpperCase()}**\n\n⭐ **+100 XP**\n💰 **+50 coins**`)]});
    }
    s.wrong++;
    if(s.wrong>=s.maxWrong){
     sessions.hangman=null;
     return i.reply({embeds:[embed("HANGMAN — KRAJ 😢",`Reč je bila **${s.answer.toUpperCase()}**.`)]});
    }
    return i.reply({content:`❌ Nije tačno! Greške: **${s.wrong}/6**`,ephemeral:true});
   }

   if(cmd==="kosamja"){
    if(sessions.koSamJa?.active) return i.reply({embeds:[embed("KO SAM JA? 🕵️","⚠️ Izazov je već aktivan!\n\nPrvi tačan odgovor osvaja rundu.\nKoristi **/kosamja-odgovor <odgovor>**.")]});
    const people=[
     {name:"Nikola Tesla",aliases:["Tesla","Nikola Tesla"],clue:"Bavio sam se elektricitetom i izumima. Po meni je nazvana jedinica za magnetnu indukciju."},
     {name:"Albert Einstein",aliases:["Einstein","Albert Einstein"],clue:"Bavio sam se fizikom i poznat sam po teoriji relativnosti."},
     {name:"Majkl Džekson",aliases:["Majkl Džekson","Michael Jackson","Džekson"],clue:"Bio sam pevač i plesač, poznat kao Kralj popa."},
     {name:"Lionel Mesi",aliases:["Lionel Mesi","Lionel Messi","Mesi","Messi"],clue:"Bavim se fudbalom i osvojio sam Svetsko prvenstvo sa Argentinom."}
    ];
    const p=people[Math.floor(Math.random()*people.length)];
    sessions.koSamJa={active:true,person:p,started:Date.now()};
    return i.reply({embeds:[embed("❓ KO SAM JA? • LEA IGRE",
      gameHeader("❓","KO SAM JA?","Pogodi osobu iz traga") +
      `\n\n╭────────────────────────────╮\n` +
      `│ 🔎 **TRAG**                 │\n` +
      `╰────────────────────────────╯\n\n` +
      `> ${p.clue}\n\n` +
      `🏆 **100 XP**  ·  💰 **50 coins**\n` +
      `💡 \/kosamja-odgovor <odgovor>`
    )]});
   }

   if(cmd==="kosamja-odgovor"){
    if(!sessions.koSamJa?.active) return i.reply({content:"❌ Nema aktivnog izazova. Koristi **/kosamja**.",ephemeral:true});
    const s=sessions.koSamJa, guess=normalizeGameAnswer(i.options.getString("odgovor"));
    const correct=s.person.aliases.some(a=>normalizeGameAnswer(a)===guess);
    if(correct){
     const elapsed=((Date.now()-s.started)/1000).toFixed(2);
     sessions.koSamJa=null; addGameScore(user.id,user.username,"kosamja",100); addCoins(user.id,50);
     return i.reply({embeds:[embed("KO SAM JA? — POBEDNIK! 🏆",`🥇 **${user.username}** je pogodio/la: **${s.person.name}**!\n\n⏱️ Vreme: **${elapsed}s**\n⭐ **+100 XP**\n💰 **+50 coins**`)]});
    }
    return i.reply({content:"❌ Nije tačno! Probaj ponovo.",ephemeral:true});
   }

   if(cmd==="leaderboard"){
    const rows=allGamesLeaderboard();
    const txt=rows.length?rows.map((p,n)=>`**${n+1}.** ${p.username} — ⭐ **${p.xp} XP** • 💰 ${p.coins}`).join("\n"):"Nema igrača.";
    const board=rows.slice(0,10).map((p,n)=>{
      const medal=["🥇","🥈","🥉"][n]||`**${n+1}.**`;
      return `${medal} **${p.username}**\n> ⭐ ${p.xp} XP   ·   💰 ${p.coins} coins`;
    }).join("\n\n")||"Još nema rezultata.";
    return i.reply({embeds:[embed("🏆 LEADERBOARD • LEA IGRE",
      gameHeader("🏆","LEADERBOARD","Top igrači po XP i coins") +
      `\n\n${board}\n\n╭────────────────────────╮\n│ 🎮 **Igraj. Osvoji. Popni se.** │\n╰────────────────────────╯`
    )]});
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
