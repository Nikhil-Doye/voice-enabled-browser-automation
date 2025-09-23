// apps/executor/src/actions.ts - DOM-aware version
import type { Page } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { TIntent } from "./types.js";
import { writeCSV, writeJSON } from "./artifacts.js";
import {
  DOMAnalyzer,
  type PageAnalysis,
  type DOMElement,
} 
from "./dom-analyzer.js";

type StepResult = {
  intent: TIntent;
  ok: boolean;
  error?: string;
  data?: any;
  screenshot?: string;
  data_paths?: { json?: string; csv?: string };
  pageAnalysis?: PageAnalysis;
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
  let pageAnalysis: PageAnalysis | null = null;

  // Helper to capture screenshot file and attach path
  async function cap(label: string) {
    const file = path.join(baseDir, `${Date.now()}-${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  }

  // Analyze page once for all intents
  async function ensurePageAnalysis() {
    if (!pageAnalysis) {
      console.log("[executor] Analyzing page DOM...");
      const analyzer = new DOMAnalyzer(page);
      pageAnalysis = await analyzer.analyzePage();
      console.log(
        `[executor] Found ${pageAnalysis.searchElements.length} search elements, ${pageAnalysis.buttons.length} buttons, ${pageAnalysis.filters.length} filters`
      );
    }
    return pageAnalysis;
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

          // Reset page analysis after navigation
          pageAnalysis = null;

          step.screenshot = await cap("navigate");
          break;
        }

        case "search": {
          const query: string = intent.args?.query || "";
          if (!query) throw new Error("search: args.query is required");

          const analysis = await ensurePageAnalysis();
          step.pageAnalysis = analysis;

          if (analysis.searchElements.length === 0) {
            throw new Error("No search elements found on the page");
          }

          // Use the best search element
          const searchElement = findBestSearchElement(analysis.searchElements);
          console.log(
            `[executor] Using search element: ${searchElement.selector}`
          );

          // Wait for element and interact
          await page.waitForSelector(searchElement.selector, { timeout: 5000 });
          await page.fill(searchElement.selector, query);
          await page.press(searchElement.selector, "Enter");

          step.screenshot = await cap("search");
          break;
        }

        case "click": {
          const analysis = await ensurePageAnalysis();
          step.pageAnalysis = analysis;

          let targetElement: DOMElement | null = null;

          // Find element by text, role, or selector
          if (intent.target?.text) {
            targetElement = findElementByText(
              [...analysis.buttons, ...analysis.links],
              intent.target.text
            );
          } else if (intent.target?.selector) {
            // Direct selector - find in analyzed elements
            targetElement = findElementBySelector(
              [
                ...analysis.buttons,
                ...analysis.links,
                ...analysis.navigationElements,
              ],
              intent.target.selector
            );
          }

          if (!targetElement) {
            throw new Error(`No clickable element found matching intent`);
          }

          console.log(`[executor] Clicking element: ${targetElement.selector}`);
          await page.click(targetElement.selector, {
            timeout: normTimeout(intent),
          });
          step.screenshot = await cap("click");
          break;
        }

        case "filter": {
          const analysis = await ensurePageAnalysis();
          step.pageAnalysis = analysis;

          // Handle different filter types
          if (intent.args?.price?.lte) {
            const priceFilter = analysis.filters.find(
              (f) =>
                f.type === "range" && f.label.toLowerCase().includes("price")
            );

            if (priceFilter && priceFilter.elements.length >= 1) {
              const maxPriceInput =
                priceFilter.elements.find(
                  (el) =>
                    el.placeholder?.toLowerCase().includes("max") ||
                    el.attributes.name?.toLowerCase().includes("max")
                ) || priceFilter.elements[priceFilter.elements.length - 1];

              await page.fill(
                maxPriceInput.selector,
                String(intent.args.price.lte)
              );
              await page.press(maxPriceInput.selector, "Enter");
              console.log(
                `[executor] Applied price filter: ${intent.args.price.lte}`
              );
            } else {
              throw new Error("No price range filter found");
            }
          }

          step.screenshot = await cap("filter");
          break;
        }

        case "sort": {
          const analysis = await ensurePageAnalysis();
          step.pageAnalysis = analysis;

          // Find sort dropdown
          const sortDropdown = analysis.forms
            .flatMap((form) => form.inputs)
            .find(
              (input) =>
                input.type === "select" &&
                (input.attributes.name?.toLowerCase().includes("sort") ||
                  input.attributes.id?.toLowerCase().includes("sort"))
            );

          if (sortDropdown) {
            let optionText = "";
            if (intent.args?.order === "asc" && intent.args?.by === "price") {
              optionText = "price low to high";
            } else if (
              intent.args?.order === "desc" &&
              intent.args?.by === "price"
            ) {
              optionText = "price high to low";
            }

            if (optionText) {
              await page.selectOption(sortDropdown.selector, {
                label: optionText,
              });
              console.log(`[executor] Selected sort option: ${optionText}`);
            }
          } else {
            throw new Error("No sort dropdown found");
          }

          step.screenshot = await cap("sort");
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

        case "extract_table": {
          const analysis = await ensurePageAnalysis();
          step.pageAnalysis = analysis;

          // Use DOM analysis to find data elements
          const dataElements = await page.$$eval(
            '[data-testid*="product"], .product, .item',
            (elements) => {
              return elements.slice(0, 10).map((el) => {
                const text = el.textContent?.replace(/\s+/g, " ").trim() || "";
                const priceMatch = text.match(/\$\s?\d+[.,]?\d*/);
                const title = text.split(/\s+/).slice(0, 8).join(" ");
                return { title, price: priceMatch ? priceMatch[0] : "" };
              });
            }
          );

          step.data = dataElements;
          const jsonPath = await writeJSON(
            baseDir,
            "extract_table",
            dataElements
          );
          const csvPath = await writeCSV(
            baseDir,
            "extract_table",
            dataElements
          );
          step.data_paths = { json: jsonPath, csv: csvPath };
          step.screenshot = await cap("extract_table");
          break;
        }

        // Keep other cases the same as before (scroll, back, forward, etc.)
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
          pageAnalysis = null; // Reset analysis after navigation
          step.screenshot = await cap("back");
          break;
        }

        case "screenshot": {
          const label = String(intent.args?.label || "screenshot");
          step.screenshot = await cap(label);
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

// Helper functions
function findBestSearchElement(searchElements: DOMElement[]): DOMElement {
  // Prioritize by common patterns
  const prioritized = searchElements.sort((a, b) => {
    const aScore = getSearchElementScore(a);
    const bScore = getSearchElementScore(b);
    return bScore - aScore;
  });

  return prioritized[0];
}

function getSearchElementScore(element: DOMElement): number {
  let score = 0;
  const attrs = element.attributes;

  if (attrs.name === "q") score += 10;
  if (attrs.type === "search") score += 8;
  if (element.placeholder?.toLowerCase().includes("search")) score += 6;
  if (attrs["aria-label"]?.toLowerCase().includes("search")) score += 5;
  if (element.bbox && element.bbox.width > 200) score += 2; // Prefer larger inputs

  return score;
}

function findElementByText(
  elements: DOMElement[],
  text: string
): DOMElement | null {
  const searchText = text.toLowerCase();
  return (
    elements.find(
      (el) =>
        el.text?.toLowerCase().includes(searchText) ||
        el.attributes["aria-label"]?.toLowerCase().includes(searchText)
    ) || null
  );
}

function findElementBySelector(
  elements: DOMElement[],
  selector: string
): DOMElement | null {
  return elements.find((el) => el.selector === selector) || null;
}
