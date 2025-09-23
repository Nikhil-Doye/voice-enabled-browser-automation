// apps/executor/src/dom-analyzer.ts
import type { Page } from "playwright";

export interface DOMElement {
  selector: string;
  type: "input" | "button" | "link" | "select" | "textarea";
  text?: string;
  placeholder?: string;
  attributes: Record<string, string>;
  bbox?: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
  isEnabled: boolean;
}

export interface PageAnalysis {
  url: string;
  title: string;
  searchElements: DOMElement[];
  buttons: DOMElement[];
  links: DOMElement[];
  forms: {
    selector: string;
    inputs: DOMElement[];
    submitButton?: DOMElement;
  }[];
  filters: {
    type: "dropdown" | "checkbox" | "range" | "text";
    label: string;
    elements: DOMElement[];
  }[];
  navigationElements: DOMElement[];
}

export class DOMAnalyzer {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async analyzePage(): Promise<PageAnalysis> {
    await this.page.waitForLoadState("domcontentloaded");

    const [
      url,
      title,
      searchElements,
      buttons,
      links,
      forms,
      filters,
      navigationElements,
    ] = await Promise.all([
      Promise.resolve(this.page.url()),
      this.page.title(),
      this.findSearchElements(),
      this.findButtons(),
      this.findLinks(),
      this.findForms(),
      this.findFilters(),
      this.findNavigationElements(),
    ]);

    return {
      url,
      title,
      searchElements,
      buttons,
      links,
      forms,
      filters,
      navigationElements,
    };
  }

  private async findSearchElements(): Promise<DOMElement[]> {
    return await this.page.$$eval("input", (inputs: HTMLInputElement[]) => {
      const generateSelector = (element: Element): string => {
        const el = element as HTMLElement;
        if (el.id) return `#${el.id}`;
        const dtid = element.getAttribute("data-testid");
        if (dtid) return `[data-testid="${dtid}"]`;
        const name = element.getAttribute("name");
        if (name) return `${element.tagName.toLowerCase()}[name="${name}"]`;
        return element.tagName.toLowerCase();
      };

      const getElementAttributes = (
        element: Element
      ): Record<string, string> => {
        const attrs: Record<string, string> = {};
        for (const attr of Array.from(element.attributes))
          attrs[attr.name] = attr.value;
        return attrs;
      };

      const rect = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };

      return inputs
        .filter((input) => {
          const type = (input.type || "").toLowerCase();
          const placeholder = (input.placeholder || "").toLowerCase();
          const ariaLabel = (
            input.getAttribute("aria-label") || ""
          ).toLowerCase();
          const name = (input.name || "").toLowerCase();
          const id = (input.id || "").toLowerCase();
          return (
            type === "search" ||
            placeholder.includes("search") ||
            ariaLabel.includes("search") ||
            name.includes("search") ||
            name === "q" ||
            id.includes("search")
          );
        })
        .map((input) => ({
          selector: generateSelector(input),
          type: "input" as const,
          text: input.value ?? "",
          placeholder: input.placeholder ?? "",
          attributes: getElementAttributes(input),
          bbox: rect(input),
          isVisible: (input as HTMLElement).offsetHeight > 0,
          isEnabled: !input.disabled,
        }));
    });
  }

  private async findButtons(): Promise<DOMElement[]> {
    return await this.page.$$eval(
      'button, input[type="button"], input[type="submit"], [role="button"]',
      (buttons: Array<HTMLButtonElement | HTMLInputElement | HTMLElement>) => {
        const generateSelector = (element: Element): string => {
          const el = element as HTMLElement;
          if (el.id) return `#${el.id}`;
          const dtid = element.getAttribute("data-testid");
          if (dtid) return `[data-testid="${dtid}"]`;
          const name = element.getAttribute("name");
          if (name) return `${element.tagName.toLowerCase()}[name="${name}"]`;
          return element.tagName.toLowerCase();
        };

        const getElementAttributes = (
          element: Element
        ): Record<string, string> => {
          const attrs: Record<string, string> = {};
          for (const attr of Array.from(element.attributes))
            attrs[attr.name] = attr.value;
          return attrs;
        };

        const rect = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };

        return buttons
          .filter((btn) => (btn as HTMLElement).offsetHeight > 0)
          .map((btn) => {
            const asInput = btn as HTMLInputElement;
            return {
              selector: generateSelector(btn),
              type: "button" as const,
              text: (btn.textContent || "").trim() || asInput.value || "",
              attributes: getElementAttributes(btn),
              bbox: rect(btn),
              isVisible: (btn as HTMLElement).offsetHeight > 0,
              isEnabled:
                !(btn as HTMLButtonElement).disabled && !asInput.disabled,
            };
          });
      }
    );
  }

  private async findLinks(): Promise<DOMElement[]> {
    return await this.page.$$eval("a[href]", (links: HTMLAnchorElement[]) => {
      const generateSelector = (element: Element): string => {
        const el = element as HTMLElement;
        if (el.id) return `#${el.id}`;
        const dtid = element.getAttribute("data-testid");
        if (dtid) return `[data-testid="${dtid}"]`;
        return "a";
      };

      const getElementAttributes = (
        element: Element
      ): Record<string, string> => {
        const attrs: Record<string, string> = {};
        for (const attr of Array.from(element.attributes))
          attrs[attr.name] = attr.value;
        return attrs;
      };

      const rect = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };

      return links
        .filter((link) => (link as HTMLElement).offsetHeight > 0)
        .map((link) => ({
          selector: generateSelector(link),
          type: "link" as const,
          text: (link.textContent || "").trim(),
          attributes: getElementAttributes(link),
          bbox: rect(link),
          isVisible: (link as HTMLElement).offsetHeight > 0,
          isEnabled: true,
        }));
    });
  }

  private async findForms(): Promise<PageAnalysis["forms"]> {
    return await this.page.$$eval("form", (forms: HTMLFormElement[]) => {
      const formSelector = (element: Element): string => {
        const el = element as HTMLElement;
        if (el.id) return `#${el.id}`;
        const name = element.getAttribute("name");
        if (name) return `form[name="${name}"]`;
        return "form";
      };

      const genSelector = (element: Element): string => {
        const el = element as HTMLElement;
        if (el.id) return `#${el.id}`;
        const dtid = element.getAttribute("data-testid");
        if (dtid) return `[data-testid="${dtid}"]`;
        const name = element.getAttribute("name");
        if (name) return `${element.tagName.toLowerCase()}[name="${name}"]`;
        return element.tagName.toLowerCase();
      };

      const getElementAttributes = (
        element: Element
      ): Record<string, string> => {
        const attrs: Record<string, string> = {};
        for (const attr of Array.from(element.attributes))
          attrs[attr.name] = attr.value;
        return attrs;
      };

      const rect = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };

      const mapInputType = (tag: string): "input" | "select" | "textarea" => {
        const t = tag.toLowerCase();
        if (t === "select") return "select";
        if (t === "textarea") return "textarea";
        return "input";
      };

      return forms.map((form) => {
        const rawInputs = Array.from(
          form.querySelectorAll("input, select, textarea")
        ) as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;

        const inputs = rawInputs
          .filter((input) => (input as HTMLElement).offsetHeight > 0)
          .map((input) => ({
            selector: genSelector(input),
            type: mapInputType(input.tagName),
            text:
              input.tagName.toLowerCase() === "select"
                ? (input as HTMLSelectElement).selectedOptions?.[0]
                    ?.textContent || ""
                : (input as HTMLInputElement).value || "",
            placeholder: (input as HTMLInputElement).placeholder ?? undefined,
            attributes: getElementAttributes(input),
            bbox: rect(input),
            isVisible: (input as HTMLElement).offsetHeight > 0,
            isEnabled: !(input as HTMLInputElement).disabled,
          }));

        const submitButton = form.querySelector(
          'button[type="submit"], input[type="submit"]'
        ) as HTMLButtonElement | HTMLInputElement | null;

        return {
          selector: formSelector(form),
          inputs,
          submitButton: submitButton
            ? {
                selector: genSelector(submitButton),
                type: "button" as const,
                text:
                  (submitButton.textContent || "").trim() ||
                  (submitButton as HTMLInputElement).value ||
                  "",
                attributes: getElementAttributes(submitButton),
                bbox: rect(submitButton),
                isVisible: (submitButton as HTMLElement).offsetHeight > 0,
                isEnabled:
                  !(submitButton as HTMLButtonElement).disabled &&
                  !(submitButton as HTMLInputElement).disabled,
              }
            : undefined,
        };
      });
    });
  }

  private async findFilters(): Promise<PageAnalysis["filters"]> {
    return await this.page.$$eval("*", (elements: Element[]) => {
      const genSelector = (element: Element): string => {
        const el = element as HTMLElement;
        if (el.id) return `#${el.id}`;
        const name = element.getAttribute("name");
        if (name) return `${element.tagName.toLowerCase()}[name="${name}"]`;
        return element.tagName.toLowerCase();
      };

      const getElementAttributes = (
        element: Element
      ): Record<string, string> => {
        const attrs: Record<string, string> = {};
        for (const attr of Array.from(element.attributes))
          attrs[attr.name] = attr.value;
        return attrs;
      };

      const rect = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };

      const filters: {
        type: "dropdown" | "checkbox" | "range" | "text";
        label: string;
        elements: DOMElement[];
      }[] = [];

      // Price range: at least two visible inputs related to "price"
      const priceInputs = (elements as HTMLInputElement[]).filter(
        (el: Element) => {
          if (el.tagName.toUpperCase() !== "INPUT") return false;
          const inp = el as HTMLInputElement;
          const text = (inp.textContent || "").toLowerCase();
          const placeholder = (inp.placeholder || "").toLowerCase();
          const name = (inp.name || "").toLowerCase();
          const id = (inp.id || "").toLowerCase();
          return (
            (el as HTMLElement).offsetHeight > 0 &&
            (text.includes("price") ||
              placeholder.includes("price") ||
              name.includes("price") ||
              id.includes("price"))
          );
        }
      ) as HTMLInputElement[];

      if (priceInputs.length >= 2) {
        filters.push({
          type: "range",
          label: "Price Range",
          elements: priceInputs.map((input) => ({
            selector: genSelector(input),
            type: "input",
            text: input.value ?? "",
            placeholder: input.placeholder ?? "",
            attributes: getElementAttributes(input),
            bbox: rect(input),
            isVisible: (input as HTMLElement).offsetHeight > 0,
            isEnabled: !input.disabled,
          })),
        });
      }

      // Dropdown filters
      const selects = (elements as HTMLSelectElement[]).filter(
        (el) =>
          el.tagName.toUpperCase() === "SELECT" &&
          (el as HTMLElement).offsetHeight > 0
      );

      selects.forEach((select) => {
        const label =
          select.getAttribute("aria-label") ||
          select.getAttribute("name") ||
          "Filter";
        filters.push({
          type: "dropdown",
          label,
          elements: [
            {
              selector: genSelector(select),
              type: "select",
              text: select.selectedOptions?.[0]?.textContent || "",
              attributes: getElementAttributes(select),
              bbox: rect(select),
              isVisible: (select as HTMLElement).offsetHeight > 0,
              isEnabled: !select.disabled,
            },
          ],
        });
      });

      return filters;
    });
  }

  private async findNavigationElements(): Promise<DOMElement[]> {
    return await this.page.$$eval(
      'nav a, .nav a, [role="navigation"] a',
      (navLinks: HTMLAnchorElement[]) => {
        const generateSelector = (element: Element): string => {
          const el = element as HTMLElement;
          if (el.id) return `#${el.id}`;
          const dtid = element.getAttribute("data-testid");
          if (dtid) return `[data-testid="${dtid}"]`;
          return "a";
        };

        const getElementAttributes = (
          element: Element
        ): Record<string, string> => {
          const attrs: Record<string, string> = {};
          for (const attr of Array.from(element.attributes))
            attrs[attr.name] = attr.value;
          return attrs;
        };

        const rect = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };

        return navLinks
          .filter((link) => (link as HTMLElement).offsetHeight > 0)
          .map((link) => ({
            selector: generateSelector(link),
            type: "link" as const,
            text: (link.textContent || "").trim(),
            attributes: getElementAttributes(link),
            bbox: rect(link),
            isVisible: (link as HTMLElement).offsetHeight > 0,
            isEnabled: true,
          }));
      }
    );
  }
}
