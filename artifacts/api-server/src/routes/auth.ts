import { Router } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import { db, usersTable } from "@workspace/db";

const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много попыток входа. Подождите 15 минут." },
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Укажите логин и пароль" });
    return;
  }

  let user;
  try {
    [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, username.toLowerCase().trim()))
      .limit(1);
  } catch (err) {
    req.log.error({ err }, "DB error during login");
    res.status(500).json({ error: "Ошибка сервера" });
    return;
  }

  // Constant-time comparison even when user not found
  const dummyHash = "$2b$10$KIX/1KqoZCDdmFuKkfPAYuP.XheFQZm5U0lDLWa1o5E1z7h1dVT9G";
  const hashToCheck = user?.passwordHash ?? dummyHash;
  const ok = await bcrypt.compare(password, hashToCheck);

  if (!user || !ok) {
    res.status(401).json({ error: "Неверный логин или пароль" });
    return;
  }

  req.session.userId   = user.id;
  req.session.username = user.username;
  req.session.displayName = user.displayName ?? undefined;

  res.json({
    id:          user.id,
    username:    user.username,
    displayName: user.displayName,
  });
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("txmtr.sid");
    res.json({ ok: true });
  });
});

authRouter.get("/me", (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Не авторизован" });
    return;
  }
  res.json({
    id:          req.session.userId,
    username:    req.session.username,
    displayName: req.session.displayName,
  });
});

export default authRouter;
