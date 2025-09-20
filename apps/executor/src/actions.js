import fs from "node:fs/promises";
import path from "node:path";
import { writeCSV, writeJSON } from "./artifacts.js";
function normTimeout(intent) {
    return intent.timeout_ms ?? 15000;
}
export async function runIntents(page, baseDir, intents) {
    const results = [];
    // Helper to capture screenshot file and attach path
    async function cap(label) {
        const file = path.join(baseDir, `${Date.now()}-${label}.png`);
        await page.screenshot({ path: file, fullPage: true });
        return file;
    }
    for (const intent of intents) {
        const step = { intent, ok: true };
        try {
            switch (intent.type) {
                case "navigate": {
                    const url = intent.args?.url;
                    if (!url)
                        throw new Error("navigate: args.url is required");
                    await page.goto(url, {
                        waitUntil: "domcontentloaded",
                        timeout: normTimeout(intent),
                    });
                    step.screenshot = await cap("navigate");
                    break;
                }
                case "search": {
                    // Heuristic: focus site search and type query; fallback to general page type
                    const q = intent.args?.query || "";
                    if (!q)
                        throw new Error("search: args.query is required");
                    // Try common search boxes
                    const candidates = [
                        'input[aria-label="Search"]',
                        'input[type="search"]',
                        'input[placeholder*="Search" i]',
                        'input[name="q"]',
                        '[role="search"] input',
                    ];
                    let found = false;
                    for (const sel of candidates) {
                        const el = await page.$(sel);
                        if (el) {
                            await el.fill("");
                            await el.type(q, { delay: 20 });
                            await el.press("Enter");
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        // type on body + Enter as last resort
                        await page.keyboard.type(q, { delay: 20 });
                        await page.keyboard.press("Enter");
                    }
                    step.screenshot = await cap("search");
                    break;
                }
                case "filter": {
                    // naive price filter
                    if (intent.args?.price?.lte) {
                        const max = String(intent.args.price.lte);
                        // common "Max" price filters
                        const sel = await page.$('input[aria-label*="Max" i], input[placeholder*="Max" i]');
                        if (sel) {
                            await sel.fill("");
                            await sel.type(max);
                            await sel.press("Enter");
                        }
                    }
                    step.screenshot = await cap("filter");
                    break;
                }
                case "sort": {
                    // try a generic sort dropdown then choose order
                    await page
                        .locator('select:has-text("Sort"), [aria-label*="Sort" i], text=Sort by')
                        .first()
                        .click({ timeout: 3000 })
                        .catch(() => { });
                    if (intent.args?.order === "asc" && intent.args?.by === "price") {
                        await page
                            .getByText(/low to high|lowest price/i)
                            .first()
                            .click({ timeout: 3000 })
                            .catch(() => { });
                    }
                    else if (intent.args?.order === "desc" &&
                        intent.args?.by === "price") {
                        await page
                            .getByText(/high to low|highest price/i)
                            .first()
                            .click({ timeout: 3000 })
                            .catch(() => { });
                    }
                    step.screenshot = await cap("sort");
                    break;
                }
                case "click": {
                    if (intent.target?.selector) {
                        await page.click(intent.target.selector, {
                            timeout: normTimeout(intent),
                        });
                    }
                    else if (intent.target?.text) {
                        await page
                            .getByText(new RegExp(intent.target.text, "i"))
                            .first()
                            .click({ timeout: normTimeout(intent) });
                    }
                    else if (intent.target?.role && intent.target?.name) {
                        await page
                            .getByRole(intent.target.role, {
                            name: new RegExp(intent.target.name, "i"),
                        })
                            .first()
                            .click({ timeout: normTimeout(intent) });
                    }
                    else {
                        throw new Error("click: target is required");
                    }
                    step.screenshot = await cap("click");
                    break;
                }
                case "type": {
                    const value = String(intent.args?.value ?? "");
                    const sel = intent.target?.selector;
                    if (!sel)
                        throw new Error("type: target.selector is required");
                    await page.fill(sel, value, { timeout: normTimeout(intent) });
                    step.screenshot = await cap("type");
                    break;
                }
                case "select": {
                    const sel = intent.target?.selector;
                    const value = String(intent.args?.value ?? "");
                    if (!sel)
                        throw new Error("select: target.selector is required");
                    await page.selectOption(sel, { label: value }).catch(async () => {
                        await page.selectOption(sel, { value });
                    });
                    step.screenshot = await cap("select");
                    break;
                }
                case "scroll": {
                    const dir = (intent.args?.direction || "down").toLowerCase();
                    const px = Number(intent.args?.pixels ?? 800);
                    await page.evaluate(([d, p]) => {
                        window.scrollBy({
                            top: d === "down" ? p : -p,
                            behavior: "smooth",
                        });
                    }, [dir, px]);
                    step.screenshot = await cap("scroll");
                    break;
                }
                case "back": {
                    await page.goBack({
                        waitUntil: "domcontentloaded",
                        timeout: normTimeout(intent),
                    });
                    step.screenshot = await cap("back");
                    break;
                }
                case "forward": {
                    await page.goForward({
                        waitUntil: "domcontentloaded",
                        timeout: normTimeout(intent),
                    });
                    step.screenshot = await cap("forward");
                    break;
                }
                case "wait_for": {
                    const sel = intent.args?.selector;
                    const ms = Number(intent.args?.timeoutMs ?? normTimeout(intent));
                    if (!sel)
                        throw new Error("wait_for: args.selector is required");
                    await page.waitForSelector(sel, { timeout: ms, state: "visible" });
                    step.screenshot = await cap("wait_for");
                    break;
                }
                case "upload": {
                    const sel = intent.target?.selector;
                    const fileRef = String(intent.args?.fileRef || "");
                    if (!sel)
                        throw new Error("upload: target.selector is required");
                    if (!fileRef)
                        throw new Error("upload: args.fileRef is required");
                    // Resolve fileRef -> absolute path stored by /uploads
                    const updir = path.resolve(process.cwd(), ".uploads");
                    const filePath = path.join(updir, fileRef.replace(/^.+:\/\//, "")); // resume://<uuid> -> <uuid>
                    await fs.access(filePath);
                    await page.setInputFiles(sel, filePath);
                    step.screenshot = await cap("upload");
                    break;
                }
                case "extract_table": {
                    const sel = intent.target?.selector || "[data-test='results']";
                    const limit = Number(intent.args?.limit ?? 5);
                    const columns = Array.isArray(intent.args?.columns)
                        ? intent.args.columns
                        : ["title", "price"];
                    await page.waitForSelector(sel, { timeout: normTimeout(intent) });
                    // Simple heuristic extraction: items list with title/price
                    const rows = await page.$$eval(`${sel} *`, (nodes) => {
                        // collect possible cards
                        const cards = new Set();
                        nodes.forEach((n) => {
                            const text = (n.textContent || "").trim();
                            // crude heuristic to find product cards
                            if (n.querySelector &&
                                /add to cart|price|review/i.test(text)) {
                                cards.add(n.closest("[data-sku], li, article, .sku-item, .product") || n);
                            }
                        });
                        return Array.from(cards)
                            .slice(0, 50)
                            .map((el) => {
                            const text = (el.textContent || "").replace(/\s+/g, " ").trim();
                            // naive price parse
                            const priceMatch = text.match(/\$\s?\d+[.,]?\d*/);
                            // naive title = first 10 words
                            const title = text.split(/\s+/).slice(0, 12).join(" ");
                            return { title, price: priceMatch ? priceMatch[0] : "" };
                        });
                    });
                    const top = rows.slice(0, limit);
                    step.data = top;
                    // save JSON & CSV
                    const jsonPath = await writeJSON(baseDir, "extract_table", top);
                    const csvPath = await writeCSV(baseDir, "extract_table", top);
                    step.data_paths = { json: jsonPath, csv: csvPath };
                    step.screenshot = await cap("extract_table");
                    break;
                }
                case "screenshot": {
                    const label = String(intent.args?.label || "screenshot");
                    step.screenshot = await cap(label);
                    break;
                }
                case "summarize": {
                    // Executor is a browser runner; summarization is typically brain-side.
                    // Here we just mark an info result.
                    step.data = {
                        note: "Summarization should be handled by the brain/LLM.",
                    };
                    step.ok = true;
                    break;
                }
                default: {
                    step.ok = false;
                    step.error = `Unsupported intent type: ${intent.type}`;
                }
            }
        }
        catch (e) {
            step.ok = false;
            step.error = e?.message || String(e);
        }
        results.push(step);
    }
    return results;
}
