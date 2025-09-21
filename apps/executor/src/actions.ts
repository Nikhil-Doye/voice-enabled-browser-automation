import type { Page } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { TIntent } from "./types.js";
import { writeCSV, writeJSON } from "./artifacts.js";

type StepResult = {
  intent: TIntent;
  ok: boolean;
  error?: string;
  data?: any;
  screenshot?: string;
  data_paths?: { json?: string; csv?: string };
};

function normTimeout(intent: TIntent) {
  return intent.timeout_ms ?? 15000;
}

export async function runIntents(
  page: Page,
  baseDir: string,
  intents: TIntent[]
): Promise<StepResult[]> {
  const results: StepResult[] = [];

  // Helper to capture screenshot file and attach path
  async function cap(label: string) {
    const file = path.join(baseDir, `${Date.now()}-${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  }

  for (const intent of intents) {
    const step: StepResult = { intent, ok: true };
    try {
      switch (intent.type) {
        case "navigate": {
          const url = intent.args?.url;
          if (!url) throw new Error("navigate: args.url is required");
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: normTimeout(intent),
          });
          step.screenshot = await cap("navigate");
          break;
        }
        case "search": {
          const q: string = intent.args?.query || "";
          if (!q) throw new Error("search: args.query is required");

          console.log(`[executor] Searching for: "${q}"`);

          // Wait for page to be ready
          await page.waitForLoadState("domcontentloaded");
          await page.waitForTimeout(500);

          // Universal search selectors (ordered by specificity/reliability)
          const searchSelectors = [
            // Common search input patterns
            'input[name="q"]',
            'input[name="query"]',
            'input[name="search"]',
            'textarea[name="q"]',
            'textarea[name="query"]',
            'textarea[name="search"]',

            // ARIA and semantic selectors
            'input[role="searchbox"]',
            'textarea[role="searchbox"]',
            'input[role="combobox"][aria-label*="search" i]',
            'textarea[role="combobox"][aria-label*="search" i]',

            // Attribute-based selectors
            'input[type="search"]',
            'input[aria-label*="search" i]',
            'textarea[aria-label*="search" i]',
            'input[placeholder*="search" i]',
            'textarea[placeholder*="search" i]',
            'input[title*="search" i]',
            'textarea[title*="search" i]',

            // Container-based selectors
            '[role="search"] input',
            '[role="search"] textarea',
            ".search-box input",
            ".search-form input",
            ".search input",
            "#search input",
            "#search-box input",

            // Generic fallbacks
            'input[class*="search" i]',
            'textarea[class*="search" i]',
          ];

          let searchElement = null;
          let usedSelector = "";

          // Try to find a search element
          for (const selector of searchSelectors) {
            try {
              const element = await page.$(selector);
              if (element) {
                // Check if element is visible and interactable
                const isVisible = await element.isVisible();
                const isEnabled = await element.isEnabled();

                if (isVisible && isEnabled) {
                  searchElement = element;
                  usedSelector = selector;
                  console.log(`[executor] Found search element: ${selector}`);
                  break;
                }
              }
            } catch (e) {
              // Continue to next selector
              continue;
            }
          }

          if (searchElement) {
            try {
              // Focus and clear the search element
              await searchElement.click();
              await page.waitForTimeout(100);

              // Clear existing content (cross-platform)
              await searchElement.selectText().catch(() => {}); // Select all text
              await searchElement.fill(""); // Clear field

              // Type the search query
              await searchElement.type(q, { delay: 50 });

              // Try different submission methods
              let submitted = false;

              // Method 1: Press Enter
              try {
                await searchElement.press("Enter");
                submitted = true;
                console.log(`[executor] Submitted search via Enter key`);
              } catch (e) {
                console.log(`[executor] Enter submission failed: ` + e);
              }

              // Method 2: Look for submit button if Enter didn't work
              if (!submitted) {
                const submitSelectors = [
                  'button[type="submit"]',
                  'input[type="submit"]',
                  'button[aria-label*="search" i]',
                  ".search-button",
                  ".search-btn",
                  "#search-button",
                  '[role="search"] button',
                ];

                for (const btnSelector of submitSelectors) {
                  try {
                    const submitBtn = await page.$(btnSelector);
                    if (submitBtn && (await submitBtn.isVisible())) {
                      await submitBtn.click();
                      submitted = true;
                      console.log(
                        `[executor] Submitted search via button: ${btnSelector}`
                      );
                      break;
                    }
                  } catch (e) {
                    continue;
                  }
                }
              }

              // Method 3: Submit the form containing the search element
              if (!submitted) {
                try {
                  const formElement = await searchElement.evaluateHandle((el) =>
                    el.closest("form")
                  );
                  if (formElement && formElement.asElement()) {
                    await formElement.evaluate((form: HTMLFormElement) =>
                      form.submit()
                    );
                    submitted = true;
                    console.log(
                      `[executor] Submitted search via form submission`
                    );
                  }
                  await formElement?.dispose();
                } catch (e: any) {
                  console.log(
                    `[executor] Form submission failed: ${e.message}`
                  );
                }
              }

              if (!submitted) {
                console.log(
                  `[executor] Warning: Search may not have been submitted properly`
                );
              }
            } catch (e: any) {
              throw new Error(`Search interaction failed:` + e);
            }
          } else {
            // Ultimate fallback: just type on the page
            console.log(
              "[executor] No search element found, using keyboard fallback"
            );
            try {
              await page.keyboard.type(q, { delay: 100 });
              await page.keyboard.press("Enter");
              console.log("[executor] Used keyboard fallback for search");
            } catch (e) {
              throw new Error(
                `Could not perform search: no search element found and keyboard fallback failed`
              );
            }
          }

          // Wait a moment for potential page navigation/results
          await page.waitForTimeout(1000);

          step.screenshot = await cap("search");
          break;
        }
        case "filter": {
          // naive price filter
          if (intent.args?.price?.lte) {
            const max = String(intent.args.price.lte);
            // common "Max" price filters
            const sel = await page.$(
              'input[aria-label*="Max" i], input[placeholder*="Max" i]'
            );
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
            .locator(
              'select:has-text("Sort"), [aria-label*="Sort" i], text=Sort by'
            )
            .first()
            .click({ timeout: 3000 })
            .catch(() => {});
          if (intent.args?.order === "asc" && intent.args?.by === "price") {
            await page
              .getByText(/low to high|lowest price/i)
              .first()
              .click({ timeout: 3000 })
              .catch(() => {});
          } else if (
            intent.args?.order === "desc" &&
            intent.args?.by === "price"
          ) {
            await page
              .getByText(/high to low|highest price/i)
              .first()
              .click({ timeout: 3000 })
              .catch(() => {});
          }
          step.screenshot = await cap("sort");
          break;
        }
        case "click": {
          if (intent.target?.selector) {
            await page.click(intent.target.selector, {
              timeout: normTimeout(intent),
            });
          } else if (intent.target?.text) {
            await page
              .getByText(new RegExp(intent.target.text, "i"))
              .first()
              .click({ timeout: normTimeout(intent) });
          } else if (intent.target?.role && intent.target?.name) {
            await page
              .getByRole(intent.target.role as any, {
                name: new RegExp(intent.target.name, "i"),
              })
              .first()
              .click({ timeout: normTimeout(intent) });
          } else {
            throw new Error("click: target is required");
          }
          step.screenshot = await cap("click");
          break;
        }
        case "type": {
          const value = String(intent.args?.value ?? "");
          const sel = intent.target?.selector;
          if (!sel) throw new Error("type: target.selector is required");
          await page.fill(sel, value, { timeout: normTimeout(intent) });
          step.screenshot = await cap("type");
          break;
        }
        case "select": {
          const sel = intent.target?.selector;
          const value = String(intent.args?.value ?? "");
          if (!sel) throw new Error("select: target.selector is required");
          await page.selectOption(sel, { label: value }).catch(async () => {
            await page.selectOption(sel, { value });
          });
          step.screenshot = await cap("select");
          break;
        }
        case "scroll": {
          const dir = (intent.args?.direction || "down").toLowerCase();
          const px = Number(intent.args?.pixels ?? 800);
          await page.evaluate(
            ([d, p]) => {
              window.scrollBy({
                top: d === "down" ? p : -p,
                behavior: "smooth",
              });
            },
            [dir, px]
          );
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
          if (!sel) throw new Error("wait_for: args.selector is required");
          await page.waitForSelector(sel, { timeout: ms, state: "visible" });
          step.screenshot = await cap("wait_for");
          break;
        }
        case "upload": {
          const sel = intent.target?.selector;
          const fileRef = String(intent.args?.fileRef || "");
          if (!sel) throw new Error("upload: target.selector is required");
          if (!fileRef) throw new Error("upload: args.fileRef is required");

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
          const columns: string[] = Array.isArray(intent.args?.columns)
            ? intent.args.columns
            : ["title", "price"];

          await page.waitForSelector(sel, { timeout: normTimeout(intent) });

          // Simple heuristic extraction: items list with title/price
          const rows = await page.$$eval(`${sel} *`, (nodes) => {
            // collect possible cards
            const cards = new Set<Element>();
            nodes.forEach((n) => {
              const text = (n.textContent || "").trim();
              // crude heuristic to find product cards
              if (
                (n as HTMLElement).querySelector &&
                /add to cart|price|review/i.test(text)
              ) {
                cards.add(
                  n.closest("[data-sku], li, article, .sku-item, .product") || n
                );
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
    } catch (e: any) {
      step.ok = false;
      step.error = e?.message || String(e);
    }
    results.push(step);
  }

  return results;
}
