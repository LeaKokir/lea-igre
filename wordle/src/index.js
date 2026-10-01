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


function embed(title,desc){return new EmbedBuilder().setTitle(`💜 ${title}`).setDescription(desc).setFooter({text:"Lea Igre • Uazalenje"}).setTimestamp();}
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
      embeds:[embed("💜 UAZALENJE GAMES 🎮",
        "Izaberi igru koju želiš da igraš.\n\n" +
        "🟪 **Wordle** — Daily + dodatne lične runde\n" +
        "🔀 **Anagram** — ko prvi složi reč\n" +
        "⚡ **Brzina** — ko prvi tačno prepiše\n" +
        "🎯 **Reakcija** — najbrži klik\n" +
        "🧠 **Trivia Battle** — takmičenje znanja\n" +
        "🕵️ **Hangman** — pogodi reč\n" +
        "❓ **Ko sam ja?** — pogodi osobu\n" +
        "🏆 **Leaderboard** — XP i coins"
      )],
      components:rows
    });
   }

   if(cmd==="wordle"){
    const word=getDailyWord(today,words), p=getPlayer(user), attempts=getAttempts(user.id,today);
    return i.reply({embeds:[embed("UAZALENJE DAILY 🇷🇸",
      `🧩 Današnja reč ima **${word.length} slova**.\n\nPokušaji: **${attempts.length}/6**\n🔥 Niz: **${p.current_streak} dana**\n\nKoristi **/pogodi**.\n\n🟩 pravo mesto • 🟨 postoji, drugo mesto • ⬛ nema slova`)]});
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
    if(normalizeSerbianAnswer(answer)===normalizeSerbianAnswer(s.target)){
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
   if(cmd==="trivia"){
    if(sessions.trivia?.active) return i.reply({embeds:[embed("TRIVIA BATTLE 🧠","⚠️ Pitanje je već aktivno!\\n\\nPrvi tačan odgovor osvaja rundu.\\nKoristi **/trivia-odgovor <odgovor>**.")]});

    const triviaQuestions=[
      {q:"Koji je glavni grad Srbije?",a:["Beograd"]},
      {q:"Koji je glavni grad Australije?",a:["Kanbera", "Canberra"]},
      {q:"Koja planeta je poznata kao Crvena planeta?",a:["Mars"]},
      {q:"Koliko strana ima trougao?",a:["3", "tri"]},
      {q:"Koji je najveći okean na Zemlji?",a:["Pacifik", "Tihi okean"]},
      {q:"Koji je hemijski simbol za zlato?",a:["Au", "zlato"]},
      {q:"Koliko igrača ima fudbalski tim na terenu?",a:["11", "jedanaest"]},
      {q:"Koji je glavni grad Francuske?",a:["Pariz"]},
      {q:"Koji je glavni grad Italije?",a:["Rim"]},
      {q:"Koji je glavni grad Španije?",a:["Madrid"]},
      {q:"Koji je glavni grad Nemačke?",a:["Berlin"]},
      {q:"Koji je glavni grad Grčke?",a:["Atina"]},
      {q:"Koji je glavni grad Hrvatske?",a:["Zagreb"]},
      {q:"Koji je glavni grad Bosne i Hercegovine?",a:["Sarajevo"]},
      {q:"Koji je glavni grad Crne Gore?",a:["Podgorica"]},
      {q:"Koji je glavni grad Slovenije?",a:["Ljubljana"]},
      {q:"Koji je glavni grad Austrije?",a:["Beč", "bec"]},
      {q:"Koji je glavni grad Velike Britanije?",a:["London"]},
      {q:"Koji je glavni grad Japana?",a:["Tokio", "Tokyo"]},
      {q:"Koji je glavni grad Kanade?",a:["Otava", "Ottawa"]},
      {q:"Koji je glavni grad SAD?",a:["Vašington", "Washington"]},
      {q:"Koja je najveća država na svetu po površini?",a:["Rusija"]},
      {q:"Koja je najmanja država na svetu?",a:["Vatikan"]},
      {q:"Koji je najviši vrh na svetu?",a:["Mont Everest", "Everest"]},
      {q:"Na kom kontinentu se nalazi Egipat?",a:["Afrika"]},
      {q:"Na kom kontinentu se nalazi Brazil?",a:["Južna Amerika"]},
      {q:"Koji je najveći kontinent?",a:["Azija"]},
      {q:"Koji je najmanji kontinent?",a:["Australija"]},
      {q:"Koji je najhladniji kontinent?",a:["Antarktik", "Antarktida"]},
      {q:"Koja država ima oblik čizme?",a:["Italija"]},
      {q:"Koji je najveći sisar na svetu?",a:["Plavi kit"]},
      {q:"Koja je najbrža kopnena životinja?",a:["Gepard"]},
      {q:"Koliko nogu ima pauk?",a:["8", "osam"]},
      {q:"Koliko nogu ima insekt?",a:["6", "šest"]},
      {q:"Koja životinja daje vunu?",a:["Ovca"]},
      {q:"Koja životinja ima surlu?",a:["Slon"]},
      {q:"Kako se zove mladunče psa?",a:["Štene"]},
      {q:"Kako se zove mladunče mačke?",a:["Mače"]},
      {q:"Koji gas ljudi udišu iz vazduha?",a:["Kiseonik"]},
      {q:"Koji gas biljke koriste u fotosintezi?",a:["Ugljen-dioksid", "CO2"]},
      {q:"Koja je hemijska formula vode?",a:["H2O"]},
      {q:"Koji je hemijski simbol za kiseonik?",a:["O"]},
      {q:"Koji je hemijski simbol za srebro?",a:["Ag"]},
      {q:"Koji je hemijski simbol za gvožđe?",a:["Fe"]},
      {q:"Koji je hemijski simbol za natrijum?",a:["Na"]},
      {q:"Koliko planeta ima Sunčev sistem?",a:["8", "osam"]},
      {q:"Koja planeta je najbliža Suncu?",a:["Merkur"]},
      {q:"Koja planeta je najveća u Sunčevom sistemu?",a:["Jupiter"]},
      {q:"Koja planeta ima poznate prstenove?",a:["Saturn"]},
      {q:"Kako se zove prirodni satelit Zemlje?",a:["Mesec"]},
      {q:"Ko je prvi čovek koji je kročio na Mesec?",a:["Nil Armstrong", "Neil Armstrong"]},
      {q:"Koliko dana ima prestupna godina?",a:["366", "trista šezdeset šest"]},
      {q:"Koliko meseci ima godina?",a:["12", "dvanaest"]},
      {q:"Koliko minuta ima jedan sat?",a:["60", "šezdeset"]},
      {q:"Koliko sekundi ima jedan minut?",a:["60", "šezdeset"]},
      {q:"Koliko stepeni ima pravi ugao?",a:["90", "devedeset"]},
      {q:"Koliko je 7 puta 8?",a:["56", "pedeset šest"]},
      {q:"Koliko je 100 podeljeno sa 10?",a:["10", "deset"]},
      {q:"Koliko strana ima kvadrat?",a:["4", "četiri"]},
      {q:"Koliko ivica ima kocka?",a:["12", "dvanaest"]},
      {q:"Ko je napisao roman Na Drini ćuprija?",a:["Ivo Andrić", "Ivo Andric"]},
      {q:"Ko je napisao Gorski vijenac?",a:["Petar II Petrović Njegoš", "Njegoš"]},
      {q:"Ko je napisao Mali princ?",a:["Antoan de Sent Egziperi", "Antoine de Saint-Exupery"]},
      {q:"Ko je napisao Romeo i Julija?",a:["Vilijam Šekspir", "William Shakespeare", "Šekspir"]},
      {q:"Ko je naslikao Mona Lizu?",a:["Leonardo da Vinči", "Leonardo da Vinci"]},
      {q:"Ko je naslikao Zvezdanu noć?",a:["Vinsent van Gog", "Vincent van Gogh"]},
      {q:"Ko je komponovao Odu radosti?",a:["Betoven", "Ludvig van Betoven", "Beethoven"]},
      {q:"Ko je komponovao Malu noćnu muziku?",a:["Mocart", "Volfgang Amadeus Mocart", "Mozart"]},
      {q:"Ko je poznat kao Kralj popa?",a:["Majkl Džekson", "Michael Jackson", "Džekson"]},
      {q:"Koji bend je izveo Bohemian Rhapsody?",a:["Queen"]},
      {q:"Koji bend je poznat po pesmi Numb?",a:["Linkin Park"]},
      {q:"Koja pevačica je poznata kao Kraljica popa?",a:["Madona", "Madonna"]},
      {q:"Kako se zove čarobnjačka škola iz Harija Potera?",a:["Hogvort", "Hogwarts"]},
      {q:"Kako se zove glavni junak serijala o Hariju Poteru?",a:["Hari Poter", "Harry Potter"]},
      {q:"Kako se zove lav iz Kralja lavova?",a:["Simba"]},
      {q:"Kako se zove Simbin otac?",a:["Mufasa"]},
      {q:"Koji superheroj koristi štit sa zvezdom?",a:["Kapetan Amerika", "Captain America"]},
      {q:"Koji superheroj je poznat kao Čovek-pauk?",a:["Spajdermen", "Spider-Man", "Spiderman"]},
      {q:"Koji superheroj je alter ego Brusa Vejna?",a:["Betmen", "Batman", "Bruce Wayne"]},
      {q:"Koji superheroj je poznat kao Čovek od čelika?",a:["Supermen", "Superman"]},
      {q:"Koja igra ima likove Pikachu i Charizard?",a:["Pokemon", "Pokémon"]},
      {q:"Koja igra je poznata po Creeperima?",a:["Minecraft"]},
      {q:"Koja igra ima Counter-Terrorist i Terrorist timove?",a:["Counter Strike 2", "Counter-Strike 2", "CS2", "Counter Strike"]},
      {q:"Koja igra je poznata po autobusu koji spušta igrače na ostrvo?",a:["Fortnite"]},
      {q:"Koji studio je napravio GTA V?",a:["Rockstar Games", "Rockstar"]},
      {q:"Kako se zove glavni grad u igri GTA V?",a:["Los Santos"]},
      {q:"Koja igra ima lika po imenu Geralt od Rivije?",a:["The Witcher 3", "Witcher 3", "The Witcher"]},
      {q:"Koja igra je poznata po liku Kratosu?",a:["God of War"]},
      {q:"Koja igra je MOBA sa herojima i bazama?",a:["League of Legends", "LoL"]},
      {q:"Koliko igrača je potrebno za standardnu partiju šaha?",a:["2", "dva"]},
      {q:"Koliko figura svaki igrač ima na početku šahovske partije?",a:["16", "šesnaest"]},
      {q:"Koja figura u šahu može da se kreće u obliku slova L?",a:["Konj"]},
      {q:"Koja figura u šahu može da se kreće dijagonalno?",a:["Lovac"]},
      {q:"Koliko igrača ima košarkaški tim na terenu?",a:["5", "pet"]},
      {q:"Koliko igrača ima odbojkaški tim na terenu?",a:["6", "šest"]},
      {q:"Koliko igrača ima rukometni tim na terenu?",a:["7", "sedam"]},
      {q:"Koliko poena vredi šut za tri u košarci?",a:["3", "tri"]},
      {q:"U kom sportu se koristi reket i loptica preko mreže?",a:["Tenis"]},
      {q:"U kom sportu se koristi termin nokaut?",a:["Boks"]},
      {q:"Ko je osvojio Svetsko prvenstvo u fudbalu 2022. godine?",a:["Argentina"]},
      {q:"Koji fudbaler je poznat pod nadimkom CR7?",a:["Kristijano Ronaldo", "Cristiano Ronaldo", "Ronaldo"]},
      {q:"Koji fudbaler je poznat kao Mesi?",a:["Lionel Mesi", "Lionel Messi", "Mesi"]},
      {q:"Koliko prstenova ima olimpijski simbol?",a:["5", "pet"]},
      {q:"Kako se zove nauka koja proučava živa bića?",a:["Biologija"]},
      {q:"Kako se zove nauka o nebeskim telima?",a:["Astronomija"]},
      {q:"Kako se zove nauka o Zemlji?",a:["Geologija"]},
      {q:"Kako se zove proces kojim biljke stvaraju hranu uz pomoć svetlosti?",a:["Fotosinteza"]},
      {q:"Koji organ pumpa krv kroz telo?",a:["Srce"]},
      {q:"Koji organ služi za disanje?",a:["Pluća", "pluca"]},
      {q:"Koliko komora ima ljudsko srce?",a:["4", "četiri"]},
      {q:"Koji je najtvrđi prirodni materijal?",a:["Dijamant"]},
      {q:"Koji metal je tečan na sobnoj temperaturi?",a:["Živa"]},
      {q:"Koji instrument ima crno-bele dirke?",a:["Klavir"]},
      {q:"Koji instrument ima šest žica?",a:["Gitara"]},
      {q:"Koji jezik se najviše govori u Brazilu?",a:["Portugalski"]},
      {q:"Koliko slova ima srpska ćirilica?",a:["30", "trideset"]},
      {q:"Koliko slova ima srpska latinica?",a:["30", "trideset"]},
      {q:"Koji je najveći grad u Srbiji?",a:["Beograd"]},
      {q:"Koja reka protiče kroz Novi Sad?",a:["Dunav"]},
      {q:"Koji praznik se u Srbiji obeležava 15. februara?",a:["Dan državnosti Srbije", "Sretenje"]},
      {q:"Koje boje su na zastavi Srbije?",a:["crvena plava bela", "crvena, plava i bela", "crvena plava i bela"]},
      {q:"Kako se zove tradicionalna srpska igra?",a:["Kolo"]},
      {q:"Koji je nacionalni cvet Srbije?",a:["Natalijina ramonda", "ramonda"]},
      {q:"Koji je glavni grad Portugala?",a:["Lisabon"]},
      {q:"Koji je glavni grad Norveške?",a:["Oslo"]},
      {q:"Koji je glavni grad Švedske?",a:["Stokholm", "Stockholm"]},
      {q:"Koji je glavni grad Danske?",a:["Kopenhagen", "Copenhagen"]},
      {q:"Koji je glavni grad Finske?",a:["Helsinki"]},
      {q:"Koji je glavni grad Poljske?",a:["Varšava", "Warsaw"]},
      {q:"Koji je glavni grad Češke?",a:["Prag", "Prague"]},
      {q:"Koji je glavni grad Slovačke?",a:["Bratislava"]},
      {q:"Koji je glavni grad Rumunije?",a:["Bukurešt", "Bucharest"]},
      {q:"Koji je glavni grad Bugarske?",a:["Sofija"]},
      {q:"Koji je glavni grad Turske?",a:["Ankara"]},
      {q:"Koji je glavni grad Ukrajine?",a:["Kijev", "Kyiv"]},
      {q:"Koji je glavni grad Irske?",a:["Dablin", "Dublin"]},
      {q:"Koji je glavni grad Islanda?",a:["Rejkjavik", "Reykjavik"]},
      {q:"Koji je glavni grad Švajcarske?",a:["Bern"]},
      {q:"Koji je glavni grad Belgije?",a:["Brisel", "Brussels"]},
      {q:"Koji je glavni grad Holandije?",a:["Amsterdam"]},
      {q:"Koji je glavni grad Češke Republike?",a:["Prag", "Prague"]},
      {q:"Koji je glavni grad Albanije?",a:["Tirana"]},
      {q:"Koji je glavni grad Severne Makedonije?",a:["Skoplje"]},
      {q:"Koji je glavni grad Kosova?",a:["Priština", "Pristina"]},
      {q:"Koji je glavni grad Argentine?",a:["Buenos Ajres", "Buenos Aires"]},
      {q:"Koji je glavni grad Čilea?",a:["Santijago", "Santiago"]},
      {q:"Koji je glavni grad Meksika?",a:["Meksiko Siti", "Mexico City"]},
      {q:"Koji je glavni grad Indije?",a:["Nju Delhi", "New Delhi"]},
      {q:"Koji je glavni grad Kine?",a:["Peking", "Beijing"]},
      {q:"Koji je glavni grad Južne Koreje?",a:["Seul", "Seoul"]},
      {q:"Koji je glavni grad Tajlanda?",a:["Bangkok"]},
      {q:"Koji je glavni grad Egipta?",a:["Kairo", "Cairo"]},
      {q:"Koji je glavni grad Maroka?",a:["Rabat"]},
      {q:"Koji je glavni grad Kenije?",a:["Najrobi", "Nairobi"]},
      {q:"Koji je glavni grad Južnoafričke Republike?",a:["Pretorija", "Pretoria"]},
      {q:"Koji je glavni grad Novog Zelanda?",a:["Velington", "Wellington"]},
      {q:"Koji je glavni grad Vijetnama?",a:["Hanoj", "Hanoi"]},
      {q:"Koji je glavni grad Indonezije?",a:["Džakarta", "Jakarta"]},
      {q:"Koja reka protiče kroz London?",a:["Temza"]},
      {q:"Koja reka protiče kroz Pariz?",a:["Sena"]},
      {q:"Koja reka protiče kroz Rim?",a:["Tibar"]},
      {q:"Koja reka protiče kroz Budimpeštu?",a:["Dunav"]},
      {q:"Koje je najveće jezero na svetu po površini?",a:["Kaspijsko more"]},
      {q:"Koje je najdublje jezero na svetu?",a:["Bajkalsko jezero", "Bajkal"]},
      {q:"Koja pustinja je najveća topla pustinja na svetu?",a:["Sahara"]},
      {q:"Na kom kontinentu se nalazi pustinja Gobi?",a:["Azija"]},
      {q:"Koji okean se nalazi između Afrike i Australije?",a:["Indijski okean"]},
      {q:"Koji okean se nalazi između Evrope i Severne Amerike?",a:["Atlantski okean"]},
      {q:"Koji je najviši vrh Srbije?",a:["Midžor"]},
      {q:"Koja planina je najviša u Srbiji?",a:["Stara planina"]},
      {q:"Koja reka čini deo granice Srbije i Hrvatske?",a:["Dunav"]},
      {q:"Koja reka protiče kroz Niš?",a:["Nišava"]},
      {q:"Koja reka protiče kroz Kragujevac?",a:["Lepenica"]},
      {q:"Koji grad je poznat po Petrovaradinskoj tvrđavi?",a:["Novi Sad"]},
      {q:"U kom gradu se nalazi Kalemegdan?",a:["Beograd"]},
      {q:"U kom gradu se nalazi Niška tvrđava?",a:["Niš"]},
      {q:"Koji je najviši vodopad na svetu?",a:["Anđeoski vodopad", "Angel Falls"]},
      {q:"Koja država je poznata po fjordovima?",a:["Norveška"]},
      {q:"Koja država je poznata po piramidama u Gizi?",a:["Egipat"]},
      {q:"Koji je najduži planinski lanac na kopnu?",a:["Andi"]},
      {q:"Koji planinski lanac razdvaja Evropu i Aziju?",a:["Ural"]},
      {q:"Koji je glavni grad Brazila?",a:["Brazilija", "Brasilia"]},
      {q:"Koliko je 9 puta 9?",a:["81", "osamdeset jedan"]},
      {q:"Koliko je 12 puta 12?",a:["144", "sto četrdeset četiri"]},
      {q:"Koliko je 144 podeljeno sa 12?",a:["12", "dvanaest"]},
      {q:"Koliko je 25 posto od 200?",a:["50", "pedeset"]},
      {q:"Koliko je 15 plus 27?",a:["42", "četrdeset dva"]},
      {q:"Koliko je 100 minus 37?",a:["63", "šezdeset tri"]},
      {q:"Koliko je 2 na treći stepen?",a:["8", "osam"]},
      {q:"Koliko je kvadratni koren broja 81?",a:["9", "devet"]},
      {q:"Koliko stepeni ima prav ugao?",a:["90", "devedeset"]},
      {q:"Koliko stepeni ima pun krug?",a:["360", "trista šezdeset"]},
      {q:"Koliko strana ima petougao?",a:["5", "pet"]},
      {q:"Koliko strana ima šestougao?",a:["6", "šest"]},
      {q:"Koliko temena ima kocka?",a:["8", "osam"]},
      {q:"Koliko ivica ima tetraedar?",a:["6", "šest"]},
      {q:"Kako se zove trougao sa tri jednake stranice?",a:["Jednakostranični trougao"]},
      {q:"Kako se zove trougao sa dva jednaka kraka?",a:["Jednakokraki trougao"]},
      {q:"Kako se zove trougao sa jednim uglom od 90 stepeni?",a:["Pravougli trougao"]},
      {q:"Koliko je pi približno?",a:["3,14", "3.14"]},
      {q:"Koji je najmanji prost broj?",a:["2", "dva"]},
      {q:"Da li je broj 17 prost broj?",a:["Da"]},
      {q:"Koji je rezultat 10 na kvadrat?",a:["100", "sto"]},
      {q:"Koliko je polovina od 100?",a:["50", "pedeset"]},
      {q:"Koliko je četvrtina od 100?",a:["25", "dvadeset pet"]},
      {q:"Koji je simbol za procenat?",a:["%"]},
      {q:"Koja je jedinica za električnu struju?",a:["Amper", "A"]},
      {q:"Koja je jedinica za napon?",a:["Volt", "V"]},
      {q:"Koja je jedinica za električni otpor?",a:["Om", "Ohm"]},
      {q:"Koja je jedinica za snagu?",a:["Vat", "W", "Watt"]},
      {q:"Koja je jedinica za energiju?",a:["Džul", "J", "Joule"]},
      {q:"Koja je jedinica za frekvenciju?",a:["Herc", "Hz", "Hertz"]},
      {q:"Koja sila privlači tela ka Zemlji?",a:["Gravitacija"]},
      {q:"Koja je brzina svetlosti približno?",a:["300000 km/s", "300000"]},
      {q:"Koji deo ćelije sadrži genetski materijal?",a:["Jedro"]},
      {q:"Kako se zove osnovna jedinica živih organizama?",a:["Ćelija"]},
      {q:"Koji organ filtrira krv i stvara mokraću?",a:["Bubrezi"]},
      {q:"Koji organ proizvodi insulin?",a:["Gušterača", "pankreas"]},
      {q:"Koji organ je najveći organ čoveka?",a:["Koža"]},
      {q:"Koji organ koristi najveći deo kiseonika u telu?",a:["Mozak"]},
      {q:"Koliko kostiju približno ima odrasao čovek?",a:["206", "dvesta šest"]},
      {q:"Koliko hromozoma ima čovek u telesnoj ćeliji?",a:["46", "četrdeset šest"]},
      {q:"Koja krvna grupa se često naziva univerzalnim davaocem za eritrocite?",a:["0 negativna", "O negativna", "0-", "O-"]},
      {q:"Koja krvna grupa se često naziva univerzalnim primaocem za eritrocite?",a:["AB pozitivna", "AB+"]},
      {q:"Koji deo biljke upija vodu iz zemljišta?",a:["Koren"]},
      {q:"Koji deo biljke najčešće vrši fotosintezu?",a:["List"]},
      {q:"Koji gas nastaje kao proizvod fotosinteze?",a:["Kiseonik"]},
      {q:"Koji gas čini najveći deo Zemljine atmosfere?",a:["Azot"]},
      {q:"Koji je simbol za ugljenik?",a:["C"]},
      {q:"Koji je simbol za vodonik?",a:["H"]},
      {q:"Koji je simbol za kalcijum?",a:["Ca"]},
      {q:"Koji je simbol za bakar?",a:["Cu"]},
      {q:"Koji je simbol za kalijum?",a:["K"]},
      {q:"Koji je pH neutralne vode približno?",a:["7", "sedam"]},
      {q:"Kako se zove proces prelaska vode iz tečnog u gasovito stanje?",a:["Isparavanje"]},
      {q:"Kako se zove prelazak gasa u tečnost?",a:["Kondenzacija"]},
      {q:"Kako se zove prelazak čvrstog tela u tečnost?",a:["Topljenje"]},
      {q:"Kako se zove prelazak tečnosti u čvrsto stanje?",a:["Zamrzavanje", "očvršćavanje"]},
      {q:"Ko je formulisao zakon gravitacije?",a:["Isak Njutn", "Isaac Newton", "Njutn"]},
      {q:"Ko je razvio teoriju relativnosti?",a:["Albert Ajnštajn", "Albert Einstein", "Ajnštajn"]},
      {q:"Ko je otkrio penicilin?",a:["Aleksandar Fleming", "Alexander Fleming", "Fleming"]},
      {q:"Ko je prvi upotrebio teleskop za astronomska posmatranja?",a:["Galileo Galilej", "Galileo Galilei"]},
      {q:"Ko je predložio heliocentrični model Sunčevog sistema?",a:["Nikola Kopernik", "Kopernik"]},
      {q:"Ko je bio prvi predsednik Sjedinjenih Američkih Država?",a:["Džordž Vašington", "George Washington"]},
      {q:"Koji događaj je počeo 1789. godine u Francuskoj?",a:["Francuska revolucija"]},
      {q:"Koji događaj je počeo 1914. godine?",a:["Prvi svetski rat"]},
      {q:"Koji događaj je završen 1945. godine?",a:["Drugi svetski rat"]},
      {q:"Koji zid je pao 1989. godine?",a:["Berlinski zid"]},
      {q:"Koji brod je potonuo 1912. godine nakon sudara sa ledenim bregom?",a:["Titanik", "Titanic"]},
      {q:"Ko je bio vođa prvog putovanja oko sveta koje je završila njegova ekspedicija?",a:["Fernan Magelan", "Ferdinand Magellan", "Magelan"]},
      {q:"Koja civilizacija je izgradila Maču Pikču?",a:["Inke", "Inke civilizacija"]},
      {q:"Koja civilizacija je izgradila piramide u Gizi?",a:["Stari Egipćani", "Egipćani"]},
      {q:"Kako se zvao rimski bog rata?",a:["Mars"]},
      {q:"Kako se zvao grčki bog mora?",a:["Posejdon"]},
      {q:"Kako se zvao grčki bog gromova?",a:["Zevs"]},
      {q:"Kako se zvala egipatska boginja ljubavi i majčinstva?",a:["Izida", "Isis"]},
      {q:"Ko je bio prvi rimski car?",a:["Avgust", "August"]},
      {q:"Koji grad je bio sedište Vizantijskog carstva?",a:["Carigrad", "Konstantinopolj", "Konstantinopol"]},
      {q:"Kako se zove srednjovekovna srpska dinastija koju je osnovao Stefan Nemanja?",a:["Nemanjići", "Nemanjić"]},
      {q:"Ko je bio prvi kralj Srbije iz dinastije Nemanjića?",a:["Stefan Prvovenčani"]},
      {q:"Ko je bio srpski car poznat kao Dušan Silni?",a:["Stefan Dušan", "Dušan Silni"]},
      {q:"Koji manastir je zadužbina Stefana Nemanje?",a:["Studenica"]},
      {q:"Koji srpski svetitelj je poznat kao Sveti Sava?",a:["Rastko Nemanjić", "Sava"]},
      {q:"Koji praznik se slavi 1. januara?",a:["Nova godina"]},
      {q:"Koji praznik se slavi 8. marta?",a:["Dan žena", "Međunarodni dan žena"]},
      {q:"Koji praznik se slavi 1. maja?",a:["Praznik rada", "Prvi maj"]},
      {q:"Koji praznik se slavi 31. decembra?",a:["Nova godina", "doček Nove godine"]},
      {q:"Ko je napisao 'Zločin i kaznu'?",a:["Fjodor Dostojevski", "Dostojevski"]},
      {q:"Ko je napisao 'Don Kihota'?",a:["Migel de Servantes", "Miguel de Cervantes", "Servantes"]},
      {q:"Ko je napisao 'Božanstvenu komediju'?",a:["Dante Aligijeri", "Dante"]},
      {q:"Ko je napisao 'Ilijadu'?",a:["Homer"]},
      {q:"Ko je napisao 'Odiseju'?",a:["Homer"]},
      {q:"Ko je napisao 'Prokletu avliju'?",a:["Ivo Andrić", "Ivo Andric"]},
      {q:"Ko je napisao 'Derviš i smrt'?",a:["Meša Selimović", "Mesa Selimovic"]},
      {q:"Ko je napisao 'Seobe'?",a:["Miloš Crnjanski", "Milos Crnjanski"]},
      {q:"Ko je napisao 'Korene'?",a:["Dobrica Ćosić", "Dobrica Cosic"]},
      {q:"Ko je napisao 'Nečistu krv'?",a:["Borisav Stanković"]},
      {q:"Ko je napisao 'Zona Zamfirova'?",a:["Stevan Sremac"]},
      {q:"Ko je napisao 'Hajduk Stanko'?",a:["Janko Veselinović"]},
      {q:"Ko je napisao 'Pop Ćira i pop Spira'?",a:["Stevan Sremac"]},
      {q:"Ko je napisao 'Antigonu'?",a:["Sofokle"]},
      {q:"Ko je napisao 'Hamleta'?",a:["Vilijam Šekspir", "William Shakespeare"]},
      {q:"Ko je naslikao 'Poslednju večeru'?",a:["Leonardo da Vinči", "Leonardo da Vinci"]},
      {q:"Ko je naslikao 'Guernicu'?",a:["Pablo Pikaso", "Pablo Picasso"]},
      {q:"Ko je naslikao 'Vrisak'?",a:["Edvard Munk", "Edvard Munch"]},
      {q:"Ko je komponovao 'Četiri godišnja doba'?",a:["Antonio Vivaldi", "Vivaldi"]},
      {q:"Ko je komponovao 'Mesečevu sonatu'?",a:["Betoven", "Beethoven"]},
      {q:"Ko je komponovao 'Bolero'?",a:["Moris Ravel", "Maurice Ravel"]},
      {q:"Koji muzički instrument ima 88 dirki?",a:["Klavir"]},
      {q:"Koji instrument pripada porodici gudačkih instrumenata?",a:["Violina"]},
      {q:"Koji instrument ima usnik i metalno telo, a pripada duvačima?",a:["Truba"]},
      {q:"Koji instrument se sastoji od drvenog tela i usnika sa jezičkom?",a:["Klarinet"]},
      {q:"Koliko žica ima standardna violina?",a:["4", "četiri"]},
      {q:"Koliko žica ima standardna gitara?",a:["6", "šest"]},
      {q:"Koji bend je izveo 'We Will Rock You'?",a:["Queen"]},
      {q:"Koji bend je izveo 'Smells Like Teen Spirit'?",a:["Nirvana"]},
      {q:"Koji pevač je poznat po pesmi 'Thriller'?",a:["Majkl Džekson", "Michael Jackson"]},
      {q:"Koja pevačica je izvela 'Rolling in the Deep'?",a:["Adele"]},
      {q:"Koja pevačica je poznata po albumu 'Future Nostalgia'?",a:["Dua Lipa"]},
      {q:"Koji pevač je poznat po pesmi 'Shape of You'?",a:["Ed Širan", "Ed Sheeran"]}
     ];
    if(!global.triviaQueue) global.triviaQueue=[];
    if(!global.triviaLast) global.triviaLast=null;

    // 300 pitanja. Pitanja se nasumično izmešaju i troše jedno po jedno.
    // Isto pitanje se ne ponavlja dok se ne završi ceo krug.
    if(global.triviaQueue.length===0){
      global.triviaQueue=[...triviaQuestions];
      for(let n=global.triviaQueue.length-1;n>0;n--){
        const j=Math.floor(Math.random()*(n+1));
        [global.triviaQueue[n],global.triviaQueue[j]]=[global.triviaQueue[j],global.triviaQueue[n]];
      }
      if(global.triviaLast && global.triviaQueue.length>1 && global.triviaQueue[0].q===global.triviaLast.q){
        [global.triviaQueue[0],global.triviaQueue[1]]=[global.triviaQueue[1],global.triviaQueue[0]];
      }
    }

    const item=global.triviaQueue.shift();
    global.triviaLast=item;
    sessions.trivia={active:true,question:item,started:Date.now()};

    return i.reply({embeds:[embed(
      "TRIVIA BATTLE 🧠",
      `❓ **${item.q}**\\n\\n📚 Pitanja u bazi: **${triviaQuestions.length}**\\n🔄 Preostalo u ovom krugu: **${global.triviaQueue.length}**\\n\\n🏆 Prvi tačan odgovor osvaja **100 XP + 50 coins**!\\n\\nKoristi **/trivia-odgovor <odgovor>**.`
    )]});
   }

   if(cmd==="trivia-odgovor")   if(cmd==="trivia-odgovor"){
    if(!sessions.trivia?.active) return i.reply({content:"❌ Nema aktivnog Trivia pitanja. Koristi **/trivia**.",ephemeral:true});
    const guess=normalizeSerbianAnswer(i.options.getString("odgovor"));
    const correct=sessions.trivia.question.a.some(a=>guess===normalizeSerbianAnswer(a));
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
    return i.reply({embeds:[embed("HANGMAN 🕵️",`${answer.split("").map(()=> "＿").join(" ")}\n\n💀 Greške: **0/6**\n\nPogodi slovo: **/hangman-slovo <slovo>**\nIli celu reč: **/hangman-rec <reč>**\n\n🏆 Prvi koji otkrije reč osvaja **100 XP + 50 coins**.`)]});
   }

   if(cmd==="hangman-slovo"){
    if(!sessions.hangman?.active) return i.reply({content:"❌ Nema aktivnog Hangman-a. Koristi **/hangman**.",ephemeral:true});
    const letter=normalizeSerbianAnswer(i.options.getString("slovo"));
    if(letter.length!==1 || !/^[a-zčćžšđ]$/i.test(letter)) return i.reply({content:"❌ Unesi samo jedno slovo.",ephemeral:true});
    const s=sessions.hangman;
    if(s.guessed.has(letter)) return i.reply({content:"⚠️ To slovo je već probano.",ephemeral:true});
    s.guessed.add(letter);
    if(!normalizeSerbianAnswer(s.answer).includes(letter)) s.wrong++;
    const masked=s.answer.split("").map(ch=>s.guessed.has(normalizeSerbianAnswer(ch))?ch:"＿").join(" ");
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
    const s=sessions.hangman, guess=normalizeSerbianAnswer(i.options.getString("rec"));
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
    return i.reply({embeds:[embed("KO SAM JA? 🕵️",`🔎 **Trag:** ${p.clue}\n\nPrvi koji pogodi osvaja **100 XP + 50 coins**.\n\nKoristi **/kosamja-odgovor <odgovor>**.`)]});
   }

   if(cmd==="kosamja-odgovor"){
    if(!sessions.koSamJa?.active) return i.reply({content:"❌ Nema aktivnog izazova. Koristi **/kosamja**.",ephemeral:true});
    const s=sessions.koSamJa, guess=normalizeSerbianAnswer(i.options.getString("odgovor"));
    const correct=s.person.aliases.some(a=>normalizeSerbianAnswer(a)===guess);
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
