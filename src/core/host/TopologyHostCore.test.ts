import assert from "node:assert/strict";
import { posix as path } from "node:path";
import test from "node:test";

import type { FileSystemAdapter } from "../io/types";

import { TopologyHostCore } from "./TopologyHostCore";

class MemoryFileSystemAdapter implements FileSystemAdapter {
  private readonly files = new Map<string, string>();

  constructor(initialFiles: Record<string, string>) {
    for (const [filePath, content] of Object.entries(initialFiles)) {
      this.files.set(this.key(filePath), content);
    }
  }

  async readFile(filePath: string): Promise<string> {
    const content = this.files.get(this.key(filePath));
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as Error & {
        code: string;
      };
      error.code = "ENOENT";
      throw error;
    }
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(this.key(filePath), content);
  }

  async unlink(filePath: string): Promise<void> {
    this.files.delete(this.key(filePath));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldKey = this.key(oldPath);
    const content = this.files.get(oldKey);
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file or directory, rename '${oldPath}'`) as Error & {
        code: string;
      };
      error.code = "ENOENT";
      throw error;
    }
    this.files.set(this.key(newPath), content);
    this.files.delete(oldKey);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.files.has(this.key(filePath));
  }

  dirname(filePath: string): string {
    return path.dirname(filePath);
  }

  basename(filePath: string): string {
    return path.basename(filePath);
  }

  join(...segments: string[]): string {
    return path.join(...segments);
  }

  private key(filePath: string): string {
    return path.normalize(filePath);
  }
}

const YAML_PATH = "/labs/demo.clab.yml";
const BASE_YAML = `name: demo
topology:
  nodes:
    leaf1:
      kind: linux
      image: alpine
  links: []
`;

function createHost(): TopologyHostCore {
  const fs = new MemoryFileSystemAdapter({
    [YAML_PATH]: BASE_YAML,
    [`${YAML_PATH}.annotations.json`]: "{}\n"
  });
  return new TopologyHostCore({
    fs,
    yamlFilePath: YAML_PATH,
    mode: "view",
    deploymentState: "deployed",
    liveApplyEnabled: true
  });
}

test("topology YAML command marks deployed live-apply snapshot pending", async () => {
  const host = createHost();
  const initial = await host.getSnapshot();
  assert.equal(initial.liveApplyEnabled, true);
  assert.equal(initial.pendingTopologyApply, false);

  const response = await host.applyCommand(
    {
      command: "addNode",
      payload: {
        id: "leaf2",
        name: "leaf2",
        extraData: { kind: "linux", image: "alpine" },
        position: { x: 100, y: 100 }
      }
    },
    initial.revision
  );

  assert.equal(response.type, "topology-host:ack");
  assert.equal(response.snapshot?.pendingTopologyApply, true);

  const applied = await host.markTopologyApplied();
  assert.equal(applied.pendingTopologyApply, false);
});

test("annotation command does not mark deployed live-apply snapshot pending", async () => {
  const host = createHost();
  const initial = await host.getSnapshot();

  const response = await host.applyCommand(
    {
      command: "setAnnotations",
      payload: { nodeAnnotations: [{ id: "leaf1", position: { x: 42, y: 24 } }] }
    },
    initial.revision
  );

  assert.equal(response.type, "topology-host:ack");
  assert.equal(response.snapshot?.pendingTopologyApply, false);
});
