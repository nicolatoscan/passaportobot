import { Telegraf } from "telegraf";
import { message } from 'telegraf/filters';
import * as dotenv from 'dotenv';
import province from './province';
import axios from 'axios';
import { parse } from 'node-html-parser';
import fs from 'fs';
dotenv.config();

const DB_FILE = 'db.json';
const DB: { [chatId: string]: string[] } = getDB();
function getDB() {
  if (fs.existsSync(DB_FILE)) {
    const file = fs.readFileSync(DB_FILE);
    return JSON.parse(file.toString());
  }
  return {};
}
function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(DB));
}

const bot = new Telegraf(process.env.BOT_TOKEN ?? '');

bot.start((ctx) => ctx.reply('Benvenuto! Inviami le sigla della provincia da controllare'));
bot.help((ctx) => ctx.reply('Benvenuto! Inviami le sigla della provincia da controllare'));
bot.command('dump', (ctx) => {
  if (ctx.chat.id.toString() == process.env.MY_ID)
    ctx.reply(JSON.stringify(DB, null, 2))
});
bot.command('ping', (ctx) => ctx.reply('pong'));

bot.on(message('text'), async (ctx) => {
  const prov = ctx.message.text
    .split(',')
    .filter((w) => w.length === 2)
    .map((w) => w.toUpperCase())
    .filter((w) => province.includes(w)) ?? [];
  
  const chatId = ctx.chat.id.toString();
  DB[chatId] = prov;
  saveDB();
  try {
    await ctx.reply(prov.length > 0 ? `Hai selezionato le province: ${prov.join(', ')}` : 'Nessuna provincia selezionata');
  } catch (e) {}
  const sent = await sendTo(chatId, prov);
  if (!sent) {
    try {
      await ctx.reply('Nessuna disponibilità al momento, controlleró ogni ora');
    } catch (e) {}
  }
});

async function getDisponebili(prov: string) {
  console.log('Checking ', prov);
  const URL = `https://www.passaportonline.poliziadistato.it/CittadinoAction.do?codop=resultRicercaRegistiProvincia&provincia=${prov}`;

  try {
    const page = await axios.get(URL)

    return parse(page.data).querySelectorAll('tr.data')
      .filter(line => line.querySelectorAll('td[headers="disponibilita"]').find(disp => disp.innerText.toUpperCase() !== 'NO'))
      .map(line => line.querySelectorAll('td[headers="descrizione"]').map(name => name.innerText).join(','))
  } catch(e) {
    return [];
  }

}

async function check() {

  const cache: { [prov: string]: string[] } = {};
  for (const chatId in DB) {
    await sendTo(chatId, DB[chatId], cache);
  }
}

async function sendTo(chatId: string, provs: string[], cache: { [prov: string]: string[] } = {}): Promise<boolean> {

  if (provs.length === 0) return true;

  let sent = false;
  for (const prov of provs) {
    let disponibili = cache[prov];
    if (!disponibili) {
      disponibili = await getDisponebili(prov);
      cache[prov] = disponibili;
    }
    if (disponibili.length > 0) {
      try {
        await bot.telegram.sendMessage(chatId, `Disponibili presso ${prov}:\n${disponibili.join('\n')}`);
        sent = true;
      } catch (e) {}
    }
  }
  return sent;
}

setInterval(() => check(), 1000 * 60 * 60 * 1);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
bot.launch();
console.log('Bot started');
