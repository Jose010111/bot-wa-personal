import dotenv from 'dotenv';
import cron from 'node-cron';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { fileURLToPath } from 'node:url';
import { getZonedDateParts, parseCommand } from './commands.js';
import { loadTasks, writeTasks } from './tasks.js';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });

const logger = pino({ level: 'info' });
const ownerNumber = process.env.OWNER_NUMBER;
const timeZone = process.env.TZ;
const reminderMinutesValue = process.env.REMIND_BEFORE_MIN ?? '15';

if (!ownerNumber || !/^62\d{8,13}$/.test(ownerNumber)) {
  throw new Error('OWNER_NUMBER wajib berformat 62xxxxxxxxxx tanpa tanda +.');
}

if (!timeZone) {
  throw new Error('TZ wajib diisi dengan zona waktu IANA, misalnya Asia/Jakarta.');
}
new Intl.DateTimeFormat('en-US', { timeZone });

if (!/^\d+$/.test(reminderMinutesValue)) {
  throw new Error('REMIND_BEFORE_MIN harus berupa bilangan bulat non-negatif.');
}
const reminderMinutes = Number(reminderMinutesValue);
if (!Number.isSafeInteger(reminderMinutes)) {
  throw new Error('REMIND_BEFORE_MIN berada di luar rentang bilangan bulat yang didukung.');
}

const ownerJid = `${ownerNumber}@s.whatsapp.net`;
const sessionDirectory = fileURLToPath(new URL('./sesi/', import.meta.url));
const sentThisMinute = new Map();
let tasks = await loadTasks(logger);
let activeSocket;
let reconnectTimer;
let shuttingDown = false;
let messageQueue = Promise.resolve();

function isScheduledFor(task, dateParts) {
  if (task.date) {
    return task.date === dateParts.date;
  }

  return task.days === 'daily' || task.days.includes(dateParts.weekday);
}

function formatTime(dateParts) {
  return `${String(dateParts.hour).padStart(2, '0')}:${String(dateParts.minute).padStart(2, '0')}`;
}

async function deliverTask(task, kind, dateParts, socket) {
  const minuteKey = `${task.id}:${kind}:${dateParts.date}T${formatTime(dateParts)}`;
  if (sentThisMinute.has(minuteKey)) {
    return;
  }

  sentThisMinute.set(minuteKey, Date.now());
  const text = kind === 'reminder'
    ? `🔔 Sebentar lagi (${task.time}): ${task.text}`
    : `⏰ ${task.time} - ${task.text}`;

  try {
    await socket.sendMessage(ownerJid, { text });
    logger.info({ taskId: task.id, kind, time: task.time }, 'Pengingat terkirim.');
  } catch (error) {
    logger.error({ err: error, taskId: task.id, kind }, 'Gagal mengirim pengingat.');
    return;
  }

  if (kind === 'scheduled' && task.date) {
    const remainingTasks = tasks.filter((item) => item.id !== task.id);
    await writeTasks(remainingTasks);
    tasks = remainingTasks;
    logger.info({ taskId: task.id }, 'Jadwal sekali dihapus setelah terkirim.');
  }
}

async function checkSchedule() {
  const now = new Date();
  const currentParts = getZonedDateParts(now, timeZone);
  const reminderParts = getZonedDateParts(
    new Date(now.getTime() + reminderMinutes * 60_000),
    timeZone,
  );
  const currentTime = formatTime(currentParts);
  const reminderTime = formatTime(reminderParts);
  const socket = activeSocket;

  if (!socket) {
    return;
  }

  for (const task of tasks) {
    if (reminderMinutes > 0 && task.time === reminderTime && isScheduledFor(task, reminderParts)) {
      await deliverTask(task, 'reminder', currentParts, socket);
    }

    if (task.time === currentTime && isScheduledFor(task, currentParts)) {
      await deliverTask(task, 'scheduled', currentParts, socket);
    }
  }

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, sentAt] of sentThisMinute) {
    if (sentAt < cutoff) {
      sentThisMinute.delete(key);
    }
  }
}

function isOwnerPrivateMessage(message) {
  const remoteJid = message.key.remoteJid;
  if (
    !remoteJid
    || remoteJid.endsWith('@g.us')
    || remoteJid.endsWith('@broadcast')
    || remoteJid.endsWith('@newsletter')
    || remoteJid === 'status@broadcast'
  ) {
    return false;
  }

  return remoteJid === ownerJid || message.key.remoteJidAlt === ownerJid;
}

async function handleOwnerMessage(message, socket) {
  if (message.key.fromMe || !isOwnerPrivateMessage(message)) {
    return;
  }

  const text = message.message?.conversation ?? message.message?.extendedTextMessage?.text;
  if (typeof text !== 'string') {
    return;
  }

  const today = getZonedDateParts(new Date(), timeZone);
  const command = parseCommand(text, tasks, today);

  if (command.type === 'add') {
    const updatedTasks = [...tasks, command.task];
    await writeTasks(updatedTasks);
    tasks = updatedTasks;
  } else if (command.type === 'delete') {
    const updatedTasks = tasks.filter((task) => task.id !== command.id);
    await writeTasks(updatedTasks);
    tasks = updatedTasks;
  }

  await socket.sendMessage(ownerJid, { text: command.text });
}

function scheduleReconnect(error) {
  if (shuttingDown || reconnectTimer) {
    return;
  }

  logger.warn({ err: error }, 'Koneksi terputus; mencoba kembali dalam 5 detik.');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void connectToWhatsApp().catch((connectError) => {
      logger.error({ err: connectError }, 'Gagal memulai koneksi WhatsApp.');
      scheduleReconnect(connectError);
    });
  }, 5_000);
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDirectory);
  const socket = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
  });
  activeSocket = socket;

  socket.ev.on('creds.update', () => {
    void saveCreds().catch((error) => {
      logger.error({ err: error }, 'Gagal menyimpan kredensial sesi.');
    });
  });

  socket.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      logger.info('Pindai QR berikut dengan WhatsApp > Perangkat tertaut.');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      logger.info('Bot WhatsApp terhubung.');
    } else if (connection === 'close') {
      if (activeSocket === socket) {
        activeSocket = undefined;
      }

      const error = lastDisconnect?.error;
      const statusCode = error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        shuttingDown = true;
        scheduler.stop();
        logger.error('Hapus folder sesi/ lalu scan QR ulang');
        process.exit(0);
      }

      scheduleReconnect(error);
    }
  });

  socket.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') {
      return;
    }

    messageQueue = messageQueue
      .then(async () => {
        for (const message of messages) {
          if (activeSocket === socket) {
            await handleOwnerMessage(message, socket);
          }
        }
      })
      .catch((error) => {
        logger.error({ err: error }, 'Gagal memproses pesan masuk.');
      });
  });
}

const scheduler = cron.schedule('* * * * *', () => checkSchedule(), {
  timezone: timeZone,
  noOverlap: true,
});

void connectToWhatsApp().catch((error) => {
  logger.fatal({ err: error }, 'Gagal memulai bot WhatsApp.');
  process.exitCode = 1;
  scheduler.stop();
});
