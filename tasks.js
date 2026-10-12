import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const TASKS_FILE = fileURLToPath(new URL('./tasks.json', import.meta.url));

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateTasks(value) {
  if (!Array.isArray(value)) {
    throw new TypeError('Data tugas harus berupa array.');
  }

  const ids = new Set();

  for (const task of value) {
    if (
      task === null
      || typeof task !== 'object'
      || !Number.isSafeInteger(task.id)
      || task.id < 1
      || typeof task.time !== 'string'
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(task.time)
      || typeof task.text !== 'string'
      || task.text.trim().length === 0
      || !(
        task.days === 'daily'
        || (
          Array.isArray(task.days)
          && task.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        )
      )
      || (task.date !== undefined && !isValidDate(task.date))
    ) {
      throw new TypeError('Ada item tugas dengan format tidak valid.');
    }

    if (ids.has(task.id)) {
      throw new TypeError(`ID tugas duplikat: ${task.id}.`);
    }
    ids.add(task.id);
  }

  return value;
}

export async function writeTasks(tasks, filePath = TASKS_FILE) {
  validateTasks(tasks);

  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function loadTasks(logger, filePath = TASKS_FILE) {
  let contents;

  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    logger.warn({ filePath }, 'File tasks.json belum ada; membuat jadwal kosong.');
    await writeTasks([], filePath);
    return [];
  }

  try {
    return validateTasks(JSON.parse(contents));
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) {
      throw error;
    }

    logger.warn({ err: error, filePath }, 'File tasks.json rusak; menggantinya dengan jadwal kosong.');
    await writeTasks([], filePath);
    return [];
  }
}
