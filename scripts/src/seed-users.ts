/**
 * Seed pilot users for VERSTA taxometer.
 * Run: pnpm --filter @workspace/scripts run seed-users
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import { writeFileSync } from "fs";

const PILOT_COUNT = 15;

function rand(len: number) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function run() {
  const db_url = process.env.DATABASE_URL;
  if (!db_url) throw new Error("DATABASE_URL not set");

  const client = new pg.Client({ connectionString: db_url });
  await client.connect();

  console.log("🚀 Seeding VERSTA taxometer pilot users...\n");

  const created: { username: string; password: string; displayName: string }[] = [];
  const skipped: string[] = [];

  for (let i = 1; i <= PILOT_COUNT; i++) {
    const username    = `versta${String(i).padStart(2, "0")}`;
    const password    = rand(10);
    const displayName = `Пилот ${String(i).padStart(2, "0")}`;

    const existing = await client.query(
      "SELECT id FROM users WHERE username = $1 LIMIT 1",
      [username]
    );
    if (existing.rows.length > 0) {
      skipped.push(username);
      continue;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      "INSERT INTO users (username, password_hash, display_name) VALUES ($1, $2, $3)",
      [username, passwordHash, displayName]
    );
    created.push({ username, password, displayName });
  }

  await client.end();

  const sep = "─".repeat(52);
  console.log(sep);
  console.log("  VERSTA taxometer — Учётные данные пилотов");
  console.log(sep);
  console.log("Логин".padEnd(14) + "Пароль".padEnd(14) + "Имя");
  console.log(sep);
  for (const u of created) {
    console.log(u.username.padEnd(14) + u.password.padEnd(14) + u.displayName);
  }
  if (skipped.length) {
    console.log(`\n⚠  Уже существуют: ${skipped.join(", ")}`);
  }
  console.log(sep);
  console.log(`\n✅ Создано: ${created.length} | Пропущено: ${skipped.length}\n`);

  if (created.length > 0) {
    const lines = [
      "VERSTA taxometer — Учётные данные пилотных пользователей",
      `Создано: ${new Date().toLocaleString("ru-RU")}`,
      "",
      "Логин".padEnd(14) + "Пароль".padEnd(14) + "Имя",
      sep,
      ...created.map(u => u.username.padEnd(14) + u.password.padEnd(14) + u.displayName),
      "",
      "URL: https://versta-taxometer.replit.app",
      "Инструкция: https://versta-taxometer.replit.app/manual.html",
    ];
    writeFileSync("scripts/pilot-credentials.txt", lines.join("\n"), "utf8");
    console.log("📄 Credentials saved to scripts/pilot-credentials.txt");
  }
}

run().catch(e => { console.error(e); process.exit(1); });
