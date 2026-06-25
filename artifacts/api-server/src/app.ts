import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import pgSession from "connect-pg-simple";
import pinoHttp from "pino-http";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";

declare module "express-session" {
  interface SessionData {
    userId:      number;
    username:    string;
    displayName?: string;
  }
}

const PgSession = pgSession(session);

const isDev = process.env.NODE_ENV === "development";

const app: Express = express();

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
  }),
);

app.use(
  cors({
    origin: isDev ? true : (origin, cb) => {
      const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").map(d => d.trim());
      const allowed = domains.map(d => `https://${d}`);
      if (!origin || allowed.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
    }),
    name: "txmtr.sid",
    secret: process.env.SESSION_SECRET ?? "dev-secret-not-for-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: !isDev,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
