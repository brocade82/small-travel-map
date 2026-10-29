const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

export type RandomFn = () => number;

/** 6 lowercase base36 characters, matching `20261026-ai7k3m`. */
export function randomBase36(length = 6, random: RandomFn = Math.random): string {
  let value = "";
  for (let i = 0; i < length; i++) {
    const index = Math.floor(random() * BASE36.length) % BASE36.length;
    value += BASE36[index];
  }
  return value;
}

export function dateStamp(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/**
 * `YYYYMMDD-` + six base36 characters. The date is local time; the id never
 * changes once a note is created, even when the file is renamed.
 */
export function generateId(date: Date = new Date(), random: RandomFn = Math.random): string {
  return `${dateStamp(date)}-${randomBase36(6, random)}`;
}

export function isTravelId(value: unknown): value is string {
  return typeof value === "string" && /^\d{8}-[0-9a-z]{6}$/.test(value);
}

/** Ensures a freshly generated id is not already present in the vault. */
export function generateUniqueId(
  taken: (id: string) => boolean,
  date: Date = new Date(),
  random: RandomFn = Math.random,
  attempts = 20
): string {
  for (let i = 0; i < attempts; i++) {
    const id = generateId(date, random);
    if (!taken(id)) return id;
  }
  throw new Error("无法生成唯一 id：随机源连续冲突");
}
