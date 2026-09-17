import { test, expect } from "../fixtures/topoviewer";

/**
 * Show Dummy Links E2E Tests
 *
 * The network.clab.yml topology contains dummy links connected to nodes.
 * Hiding is applied with React Flow's `hidden` flag rather than by removing elements,
 * so the nodes stay in the graph (and keep their annotations and positions) while
 * disappearing from the canvas.
 */

async function getDummyNodeIds(topoViewerPage: {
  getNodeIds: () => Promise<string[]>;
}): Promise<string[]> {
  const nodeIds = await topoViewerPage.getNodeIds();
  return nodeIds.filter((id: string) => id.startsWith("dummy"));
}

test.describe("Show Dummy Links Toggle", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile("network.clab.yml");
    await topoViewerPage.waitForCanvasReady();
  });

  test("network.clab.yml has dummy link visible by default", async ({ page, topoViewerPage }) => {
    const dummyNodes = await getDummyNodeIds(topoViewerPage);
    expect(dummyNodes.length).toBeGreaterThan(0);

    expect(await topoViewerPage.getEdgeCount()).toBeGreaterThan(0);
    await expect(page.locator(`[data-id="${dummyNodes[0]}"]`)).toBeVisible();
  });

  test("navbar toggle hides and shows dummy nodes without removing them", async ({
    page,
    topoViewerPage
  }) => {
    const initialNodeIds = await topoViewerPage.getNodeIds();
    const initialEdgeCount = await topoViewerPage.getEdgeCount();
    const dummyNodes = await getDummyNodeIds(topoViewerPage);
    expect(dummyNodes.length).toBeGreaterThan(0);
    const dummyId = dummyNodes[0];

    // Toggle dummy links OFF via the navbar
    await page.getByTestId("navbar-show-dummy-links").click();

    // Gone from the canvas...
    await expect(page.locator(`[data-id="${dummyId}"]`)).toBeHidden();

    // ...but still present in the graph, so nothing has been destroyed.
    expect(await topoViewerPage.getNodeIds()).toHaveLength(initialNodeIds.length);
    expect(await topoViewerPage.getEdgeCount()).toBe(initialEdgeCount);

    // Toggle back ON
    await page.getByTestId("navbar-show-dummy-links").click();

    await expect(page.locator(`[data-id="${dummyId}"]`)).toBeVisible();
    expect(await topoViewerPage.getNodeIds()).toHaveLength(initialNodeIds.length);
    expect(await topoViewerPage.getEdgeCount()).toBe(initialEdgeCount);
  });

  test("running a layout while dummies are hidden does not delete them", async ({
    page,
    topoViewerPage
  }) => {
    const initialNodeIds = await topoViewerPage.getNodeIds();
    const dummyNodes = await getDummyNodeIds(topoViewerPage);
    expect(dummyNodes.length).toBeGreaterThan(0);

    await page.getByTestId("navbar-show-dummy-links").click();
    await expect(page.locator(`[data-id="${dummyNodes[0]}"]`)).toBeHidden();

    // Layout writes the rendered node array back to the graph store. When hiding was
    // implemented by filtering the array, this silently dropped every dummy node.
    await page.evaluate(() => {
      const dev = (window as { __DEV__?: { setLayout?: (layout: string) => void } }).__DEV__;
      dev?.setLayout?.("force");
    });
    await page.waitForTimeout(500);

    await page.getByTestId("navbar-show-dummy-links").click();

    expect(await getDummyNodeIds(topoViewerPage)).toHaveLength(dummyNodes.length);
    expect(await topoViewerPage.getNodeIds()).toHaveLength(initialNodeIds.length);
    await expect(page.locator(`[data-id="${dummyNodes[0]}"]`)).toBeVisible();
  });

  test("the toggle persists to the annotations sidecar", async ({ page, topoViewerPage }) => {
    await page.getByTestId("navbar-show-dummy-links").click();
    await page.waitForTimeout(300);

    const annotations = await topoViewerPage.getAnnotationsFromFile("network.clab.yml");
    expect(annotations.viewerSettings?.showDummyLinks).toBe(false);
  });
});
