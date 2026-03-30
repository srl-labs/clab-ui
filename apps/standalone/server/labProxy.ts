/**
 * Lab lifecycle action proxy - deploy, destroy, redeploy.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ClabApiClient } from "./clabApiClient.js";
import { getTokenFromRequest } from "./middleware.js";

interface LabActionBody {
  labName: string;
  cleanup?: boolean;
  path?: string;
}

type ClientResolver = (request: FastifyRequest) => ClabApiClient;

async function forwardNdjsonStream(reply: FastifyReply, response: Response): Promise<void> {
  reply.raw.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff"
  });

  if (!response.body) {
    reply.raw.write(`${JSON.stringify({ type: "error", error: "Lifecycle stream has no response body" })}\n`);
    reply.raw.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        reply.raw.write(Buffer.from(value));
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  reply.raw.end();
}

export function registerLabProxy(app: FastifyInstance, getClient: ClientResolver): void {
  app.get<{ Querystring: { labName?: string } }>(
    "/api/lab/status",
    async (request: FastifyRequest<{ Querystring: { labName?: string } }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      const labName = request.query.labName?.trim() ?? "";
      if (!labName) return reply.status(400).send({ error: "Missing labName" });

      try {
        const client = getClient(request);
        const running = await client.isLabRunning(token, labName);
        return reply.send({ success: true, running });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: message });
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/deploy",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      const { labName, path } = request.body;
      if (!labName) return reply.status(400).send({ error: "Missing labName" });

      try {
        const client = getClient(request);
        const lifecycle = await client.deployLab(token, labName, { path, includeLogs: true });
        return reply.send({
          success: true,
          result: lifecycle.result,
          message: lifecycle.message,
          logs: lifecycle.logs ?? []
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: message });
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/deploy/stream",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      const { labName, path } = request.body;
      if (!labName) return reply.status(400).send({ error: "Missing labName" });

      try {
        const client = getClient(request);
        const streamResponse = await client.openLifecycleStream(token, "deploy", labName, { path });
        await forwardNdjsonStream(reply, streamResponse);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: message });
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/destroy",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      const { labName, cleanup = false } = request.body;
      if (!labName) return reply.status(400).send({ error: "Missing labName" });

      try {
        const client = getClient(request);
        const lifecycle = await client.destroyLab(token, labName, { cleanup, includeLogs: true });
        return reply.send({
          success: true,
          result: lifecycle.result,
          message: lifecycle.message,
          logs: lifecycle.logs ?? []
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: message });
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/destroy/stream",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      const { labName, cleanup = false } = request.body;
      if (!labName) return reply.status(400).send({ error: "Missing labName" });

      try {
        const client = getClient(request);
        const streamResponse = await client.openLifecycleStream(token, "destroy", labName, { cleanup });
        await forwardNdjsonStream(reply, streamResponse);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: message });
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/redeploy",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      const { labName, cleanup = false } = request.body;
      if (!labName) return reply.status(400).send({ error: "Missing labName" });

      try {
        const client = getClient(request);
        const lifecycle = await client.redeployLab(token, labName, { cleanup, includeLogs: true });
        return reply.send({
          success: true,
          result: lifecycle.result,
          message: lifecycle.message,
          logs: lifecycle.logs ?? []
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: message });
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/redeploy/stream",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      const { labName, cleanup = false } = request.body;
      if (!labName) return reply.status(400).send({ error: "Missing labName" });

      try {
        const client = getClient(request);
        const streamResponse = await client.openLifecycleStream(token, "redeploy", labName, { cleanup });
        await forwardNdjsonStream(reply, streamResponse);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: message });
      }
    }
  );
}
