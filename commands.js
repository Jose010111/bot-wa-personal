import { validateTasks } from './tasks.js';

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const USAGE = [
  'Format perintah:',
  '/daftar',
  '/hari',
  '/tambah HH:MM teks',
  '/tambah YYYY-MM-DD HH:MM teks',
  '/hapus id',
].join('\n');

function validTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function formatTask(task) {
  const schedule = task.date
    ? `sekali, ${task.date}`
    : task.days === 'daily'
      ? 'setiap hari'
      : task.days.map((day) => DAY_NAMES[day]).join(', ');
  return `${task.id}. ${task.time} - ${task.text} (${schedule})`;
}

function listTasks(tasks) {
  if (tasks.length === 0) {
    return 'Belum ada jadwal.';
  }

  return [...tasks]
    .sort((left, right) => left.time.localeCompare(right.time) || left.id - right.id)
    .map(formatTask)
    .join('\n');
}

export function getZonedDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday);

  if (weekday < 0) {
    throw new RangeError(`Hari tidak dikenal untuk zona waktu ${timeZone}.`);
  }

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    weekday,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

export function parseCommand(input, tasks, today) {
  validateTasks(tasks);
  const command = input.trim();

  if (command === '/daftar') {
    return { type: 'reply', text: listTasks(tasks) };
  }

  if (command === '/hari') {
    const todayTasks = tasks.filter((task) => (
      task.date
        ? task.date === today.date
        : task.days === 'daily' || task.days.includes(today.weekday)
    ));

    return {
      type: 'reply',
      text: todayTasks.length === 0 ? 'Tidak ada jadwal hari ini.' : listTasks(todayTasks),
    };
  }

  const oneTimeMatch = command.match(/^\/tambah\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$/);
  if (oneTimeMatch) {
    const [, date, time, text] = oneTimeMatch;
    if (!validDate(date) || !validTime(time) || !text.trim()) {
      return { type: 'reply', text: USAGE };
    }

    const task = {
      id: Math.max(0, ...tasks.map((item) => item.id)) + 1,
      time,
      text: text.trim(),
      days: 'daily',
      date,
    };
    return { type: 'add', task, text: `Jadwal ${task.id} ditambahkan: ${formatTask(task)}` };
  }

  const dailyMatch = command.match(/^\/tambah\s+(\d{2}:\d{2})\s+(.+)$/);
  if (dailyMatch) {
    const [, time, text] = dailyMatch;
    if (!validTime(time) || !text.trim()) {
      return { type: 'reply', text: USAGE };
    }

    const task = {
      id: Math.max(0, ...tasks.map((item) => item.id)) + 1,
      time,
      text: text.trim(),
      days: 'daily',
    };
    return { type: 'add', task, text: `Jadwal ${task.id} ditambahkan: ${formatTask(task)}` };
  }

  const deleteMatch = command.match(/^\/hapus\s+(\d+)$/);
  if (deleteMatch) {
    const id = Number(deleteMatch[1]);
    if (!Number.isSafeInteger(id) || id < 1) {
      return { type: 'reply', text: USAGE };
    }
    return tasks.some((task) => task.id === id)
      ? { type: 'delete', id, text: `Jadwal ${id} dihapus.` }
      : { type: 'reply', text: `Jadwal dengan ID ${id} tidak ditemukan.` };
  }

  return { type: 'reply', text: USAGE };
}
