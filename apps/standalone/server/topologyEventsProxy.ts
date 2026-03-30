import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import type { ClabApiClient } from "./clabApiClient.js";
import { getTokenFromRequest } from "./middleware.js";

type ClientResolver = (request: FastifyRequest) => ClabApiClient;

function extractLabName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const basename = normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;
  return basename.replace(/\.clab\.ya?ml$/i, "");
}

export function registerTopologyEventsProxy(app: FastifyInstance, getClient: ClientResolver): void {
  app.get<{ Querystring: { path?: string } }>(
    "/api/topology/events",
    async (
      request: FastifyRequest<{ Querystring: { path?: string } }>,
      reply: FastifyReply
    ) => {
      const token = getTokenFromRequest(request);
      if (!token) {
        return reply.status(401).send({ error: "Not authenticated" });
      }

      const filePath = request.query.path?.trim() ?? "";
      if (!filePath) {
        return reply.status(400).send({ error: "Missing path" });
      }

      const labName = extractLabName(filePath);
      if (!labName) {
        return reply.status(400).send({ error: "Invalid topology path" });
      }

      const client = getClient(request);
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      reply.raw.write(":ok\n\n");

      let eventId = 0;
      let aborted = false;
      request.raw.on("close", () => {
        aborted = true;
      });

      try {
        const response = await client.openTopologyEventStream(token, labName, filePath);
        if (!response.body) {
          reply.raw.write("event: error\ndata: No topology event stream body\n\n");
          reply.raw.end();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (aborted) break;
            const trimmed = line.trim();
            if (!trimmed) continue;
            eventId += 1;
            reply.raw.write(`id: ${eventId}\ndata: ${trimmed}\n\n`);
          }
        }

        reader.cancel().catch(() => {});
      } catch (error) {
        if (!aborted) {
          const message = error instanceof Error ? error.message : "Topology event stream error";
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
        }
      }

      if (!aborted) {
        reply.raw.end();
      }
    }
  );
}
