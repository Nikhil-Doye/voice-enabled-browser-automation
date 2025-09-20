// apps/executor/src/session.ts
import path from "node:path";
import fs from "node:fs/promises";
import { chromium, Browser, Page, BrowserContext } from "playwright";
import Browserbase from "@browserbasehq/sdk";

const USE_BROWSERBASE = !!process.env.BROWSERBASE_API_KEY;
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || ".artifacts";
const HEADLESS = process.env.EXECUTOR_HEADLESS === "true"; // toggle via .env

type Session = {
  id: string;
  browser: Browser;
  page: Page;
  createdAt: number;
  dir: string;
};

const sessions = new Map<string, Session>();

export async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true }).catch(() => {});
}

export async function openSession(existingId?: string): Promise<Session> {
  if (existingId && sessions.has(existingId)) return sessions.get(existingId)!;

  const id = existingId || crypto.randomUUID();
  const dir = path.resolve(process.cwd(), ARTIFACTS_DIR, id);
  await ensureDir(dir);

  let browser: Browser;
  let context: BrowserContext;

  if (USE_BROWSERBASE) {
    // Remote Browserbase session
    const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    const session = await bb.sessions.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID as string,
    });
    const connectUrl = session.connectUrl;
    browser = await chromium.connectOverCDP(connectUrl);
    context = browser.contexts()[0] || (await browser.newContext());
  } else {
    // Local Chrome (headful by default)
    browser = await chromium.launch({
      headless: HEADLESS, // set EXECUTOR_HEADLESS=true in .env for headless
      channel: "chrome", // use real Google Chrome
      args: ["--start-maximized"],
    });
    context = await browser.newContext({ viewport: null });
  }

  const page = await context.newPage();

  const sess: Session = { id, browser, page, createdAt: Date.now(), dir };
  sessions.set(id, sess);
  return sess;
}

export async function closeSession(id: string) {
  const sess = sessions.get(id);
  if (!sess) return;
  try {
    await sess.browser.close();
  } catch {}
  sessions.delete(id);
}

export function getSession(id: string) {
  return sessions.get(id);
}
