import { DomainError, type Clock, type ErrorCode, ScriptStore } from "./scripts.ts";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_error: 400,
  not_found: 404,
  invalid_state: 409,
  deadline_passed: 422,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DomainError("validation_error", "corpo da requisição não é JSON válido");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DomainError("validation_error", "corpo da requisição deve ser um objeto JSON");
  }
  return parsed as Record<string, unknown>;
}

export type App = { handle(request: Request): Promise<Response> };

export function createApp(clock: Clock = () => new Date()): App {
  const store = new ScriptStore(clock);

  async function route(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const method = request.method;

    if (method === "GET" && pathname === "/health") return json({ ok: true });

    if (method === "POST" && pathname === "/scripts") {
      return json(store.create(await readBody(request)), 201);
    }

    const match = /^\/scripts\/([^/]+)(?:\/(change-requests|versions|approve))?$/.exec(pathname);
    if (match) {
      const id = decodeURIComponent(match[1] ?? "");
      const action = match[2];
      if (method === "GET" && !action) return json(store.view(id));
      if (method === "POST" && action === "change-requests") {
        return json(store.requestChanges(id, await readBody(request)), 201);
      }
      if (method === "POST" && action === "versions") {
        return json(store.submitVersion(id, await readBody(request)), 201);
      }
      if (method === "POST" && action === "approve") return json(store.approve(id));
    }

    return json({ error: { code: "not_found", message: "rota não encontrada" } }, 404);
  }

  return {
    async handle(request) {
      try {
        return await route(request);
      } catch (error) {
        if (error instanceof DomainError) {
          return json({ error: { code: error.code, message: error.message } }, STATUS_BY_CODE[error.code]);
        }
        console.error(error);
        return json({ error: { code: "internal_error", message: "erro interno" } }, 500);
      }
    },
  };
}
