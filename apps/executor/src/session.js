import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import Browserbase from "@browserbasehq/sdk";
const USE_BROWSERBASE = !!process.env.BROWSERBASE_API_KEY;
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || ".artifacts";
const sessions = new Map();
export async function ensureDir(p) {
    await fs.mkdir(p, { recursive: true }).catch(() => { });
}
export async function openSession(existingId) {
    if (existingId && sessions.has(existingId))
        return sessions.get(existingId);
    const id = existingId || crypto.randomUUID();
    const dir = path.resolve(process.cwd(), ARTIFACTS_DIR, id);
    await ensureDir(dir);
    let browser;
    if (USE_BROWSERBASE) {
        const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
        const projectId = process.env.BROWSERBASE_PROJECT_ID;
        const session = await bb.sessions.create({
            projectId: process.env.BROWSERBASE_PROJECT_ID,
        });
        const connectUrl = session.connectUrl;
        browser = await chromium.connectOverCDP(connectUrl);
        // const { wsUrl } = await bb.sessions.create({ projectId }); // Assumes BB returns a wsUrl for CDP
        // browser = await chromium.connectOverCDP(wsUrl);
    }
    else {
        browser = await chromium.launch({ headless: true });
    }
    const context = await browser.newContext({
        viewport: { width: 1366, height: 768 },
    });
    const page = await context.newPage();
    const sess = { id, browser, page, createdAt: Date.now(), dir };
    sessions.set(id, sess);
    return sess;
}
export async function closeSession(id) {
    const sess = sessions.get(id);
    if (!sess)
        return;
    try {
        await sess.browser.close();
    }
    catch { }
    sessions.delete(id);
}
export function getSession(id) {
    return sessions.get(id);
}
