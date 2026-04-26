import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/topoviewer";

const TOPOLOGY_FILE = "simple.clab.yml";

async function openYamlEditor(page: Page): Promise<void> {
  await page.locator('[data-testid="panel-tab-yaml"]').click();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    return Boolean(
      (window as { __clabMonacoDebug?: { getMarkers?: () => unknown[] } }).__clabMonacoDebug
    );
  });
}

async function setEditorValue(
  page: Page,
  value: string,
  lineNumber: number,
  column: number
): Promise<void> {
  await page.evaluate(
    ({ content, line, col }) => {
      const debug = (
        window as {
          __clabMonacoDebug?: {
            setValue: (value: string) => void;
            setPosition: (lineNumber: number, column: number) => void;
          };
        }
      ).__clabMonacoDebug;
      if (!debug) throw new Error("Monaco debug API is not available");
      debug.setValue(content);
      debug.setPosition(line, col);
    },
    { content: value, line: lineNumber, col: column }
  );
}

async function triggerSuggest(page: Page): Promise<void> {
  await page.evaluate(() => {
    const debug = (
      window as { __clabMonacoDebug?: { triggerSuggest: () => void } }
    ).__clabMonacoDebug;
    if (!debug) throw new Error("Monaco debug API is not available");
    debug.triggerSuggest();
  });
}

async function triggerHover(page: Page): Promise<void> {
  await page.evaluate(() => {
    const debug = (window as { __clabMonacoDebug?: { triggerHover: () => void } })
      .__clabMonacoDebug;
    if (!debug) throw new Error("Monaco debug API is not available");
    debug.triggerHover();
  });
}

async function selectEditorRange(
  page: Page,
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }
): Promise<void> {
  await page.evaluate((selectionRange) => {
    const debug = (
      window as {
        __clabMonacoDebug?: {
          editor: {
            focus: () => void;
            setSelection: (range: typeof selectionRange) => void;
          };
        };
      }
    ).__clabMonacoDebug;
    if (!debug) throw new Error("Monaco debug API is not available");
    debug.editor.setSelection(selectionRange);
    debug.editor.focus();
  }, range);
}

async function selectedTextBackgrounds(page: Page): Promise<string[]> {
  return page.locator(".monaco-editor .selected-text").evaluateAll((elements) =>
    elements
      .map((element) => window.getComputedStyle(element).backgroundColor)
      .filter((background) => background !== "" && background !== "rgba(0, 0, 0, 0)")
  );
}

async function markerMessages(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const debug = (
      window as { __clabMonacoDebug?: { getMarkers: () => Array<{ message: string }> } }
    ).__clabMonacoDebug;
    return debug?.getMarkers().map((marker) => marker.message) ?? [];
  });
}

function isRedDominant(background: string): boolean {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(background);
  if (!match) return false;
  const red = Number(match[1]);
  const green = Number(match[2]);
  const blue = Number(match[3]);
  return red > 140 && red > green * 1.25 && red > blue * 1.25;
}

test.describe("Monaco YAML source editor", () => {
  test("shows schema markers and autocomplete suggestions", async ({ page, topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(TOPOLOGY_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await openYamlEditor(page);

    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: nokia_srlinux\n", 4, 26);
    await selectEditorRange(page, {
      startLineNumber: 4,
      startColumn: 13,
      endLineNumber: 4,
      endColumn: 26
    });
    await expect
      .poll(async () => selectedTextBackgrounds(page), {
        timeout: 5000,
        message: "selected YAML text should render with a visible selection background"
      })
      .not.toEqual([]);
    expect((await selectedTextBackgrounds(page)).some(isRedDominant)).toBe(false);

    await setEditorValue(
      page,
      "name: demo\ntopology:\n  nodes:\n    srl1:\n      kind: does_not_exist\n      unknown-field: true\n",
      6,
      26
    );

    await expect
      .poll(
        async () => {
          const messages = await markerMessages(page);
          return (
            messages.includes('Unknown property "unknown-field"') &&
            messages.some((message) => message.includes("Value is not accepted"))
          );
        },
        {
          timeout: 5000,
          message: "invalid topology YAML should produce schema markers"
        }
      )
      .toBe(true);

    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: nok", 4, 16);
    await triggerSuggest(page);
    await expect(page.locator(".suggest-widget")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".suggest-widget").getByText("nokia_srlinux")).toBeVisible();

    await page.keyboard.press("Escape");

    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: ", 4, 13);
    await page.keyboard.type("n");
    await expect(page.locator(".suggest-widget")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".suggest-widget").getByText("nokia_srlinux")).toBeVisible();

    await page.keyboard.press("Escape");
    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: nokia_srlinux\n", 4, 9);
    await triggerHover(page);
    await expect(page.locator(".monaco-hover")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".monaco-hover")).toContainText("Allowed values");

    await page.keyboard.press("Escape");

    await setEditorValue(
      page,
      "topology:\n  nodes:\n    srl1:\n      kind: nokia_srlinux\n    srl2:\n      kind: nokia_srlinux\n  links:\n    - endpoints:\n        - ",
      9,
      11
    );
    await triggerSuggest(page);
    await expect(page.locator(".suggest-widget")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".suggest-widget").getByText("srl1")).toBeVisible();
    await expect(page.locator(".suggest-widget").getByText("srl2")).toBeVisible();
  });
});
