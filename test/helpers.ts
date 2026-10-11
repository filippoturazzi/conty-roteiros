import { createApp } from "../src/app.ts";

export function setup(startAt: string) {
  let now = new Date(startAt);
  const app = createApp(() => now);

  async function call(method: string, path: string, body?: unknown) {
    const response = await app.handle(
      new Request(`http://test${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as any };
  }

  return {
    setNow(instant: string) {
      now = new Date(instant);
    },
    get: (path: string) => call("GET", path),
    post: (path: string, body?: unknown) => call("POST", path, body),
    async createScript(content = "Versão 1 do roteiro") {
      const res = await call("POST", "/scripts", { title: "Campanha verão", content });
      return res.body.id as string;
    },
  };
}
