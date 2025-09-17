import puppeteer from "puppeteer-core";
import { createBrowserbaseSession } from "./browserbase.js";
import { parseIntent } from "@voice-web-agent/schemas";
import {
  describeIntent,
  validateNavigate,
  validateType,
  type StepLog,
} from "./actions.js";
import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const ART_DIR = path.resolve(process.cwd(), "artifacts");
if (!fs.existsSync(ART_DIR)) fs.mkdirSync(ART_DIR, { recursive: true });

// A tiny “demo workflow” you can replace with real intents later
const demoIntents = [
  parseIntent({
    intent: "navigate",
    utterance: "go to google",
    confidence: 0.95,
    target: { url: "https://www.google.com" },
  }),
  parseIntent({
    intent: "type",
    utterance: "type into google",
    confidence: 0.9,
    target: { selector: 'textarea[name="q"]' }, // ✅ correct for Google
    params: { value: "hello world" },
  }),
];

async function run() {
  const logs: StepLog[] = [];
  const hasBB = Boolean(
    process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID
  );

  if (!hasBB) {
    console.warn(
      "[dry-run] No BROWSERBASE API vars set; running without real browser. Set them in your .env to test real sessions."
    );
    demoIntents.forEach((i) => console.log("Intent:", describeIntent(i)));
    return;
  }

  // 1) Create Browserbase session → wsEndpoint
  const { connectUrl, id } = await createBrowserbaseSession();
  console.log("[browserbase] session id:", id);

  // 2) Connect Puppeteer to Browserbase
  const browser = await puppeteer.connect({ browserWSEndpoint: connectUrl });
  const page = await browser.newPage();

  // 3) Execute our tiny demo
  for (const i of demoIntents) {
    const t0 = Date.now();
    try {
      if (i.intent === "navigate") {
        validateNavigate(i);
        await page.goto(i.target!.url!, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });
        await page.screenshot({
          path: path.join(ART_DIR, `${Date.now()}-navigate.png`),
        });
      } else if (i.intent === "type") {
        validateType(i);
        await page
          .waitForSelector(i.target!.selector!, { timeout: 5000 })
          .catch(() => null);
        const el = await page.$(i.target!.selector!);
        if (el) {
          await el.click({ delay: 20 });
          await page.type(i.target!.selector!, String(i.params!.value));
        } else {
          console.warn(`[warn] Selector not found: ${i.target!.selector}`);
        }
        await page.screenshot({
          path: path.join(ART_DIR, `${Date.now()}-type.png`),
        });
      } else {
        console.log("[skip] intent:", i.intent);
      }

      logs.push({
        step: i.intent,
        selector: i.target?.selector,
        status: "success",
        latencyMs: Date.now() - t0,
      });
    } catch (err: any) {
      logs.push({
        step: i.intent,
        selector: i.target?.selector,
        status: "error",
        latencyMs: Date.now() - t0,
        message: String(err?.message ?? err),
      });
    }
  }

  console.table(logs);
  await browser.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
