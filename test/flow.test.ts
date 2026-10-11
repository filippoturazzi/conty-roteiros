import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setup } from "./helpers.ts";

const MORNING = "2026-03-10T12:00:00.000Z";

describe("fluxo do roteiro", () => {
  it("cria o roteiro com a versão 1 em revisão e diz o que pode ser feito", async () => {
    const api = setup(MORNING);
    const res = await api.post("/scripts", { title: "Campanha verão", content: "Abertura na praia" });

    assert.equal(res.status, 201);
    assert.equal(res.body.status, "in_review");
    assert.equal(res.body.current_version, 1);
    assert.deepEqual(res.body.allowed_actions, ["request_changes", "approve"]);
    assert.equal(res.body.versions[0].content, "Abertura na praia");
  });

  it("percorre o fluxo inteiro: pedido, nova versão e aprovação", async () => {
    const api = setup(MORNING);
    const id = await api.createScript("Versão 1");

    const requested = await api.post(`/scripts/${id}/change-requests`, {
      reason: "Trocar o CTA final",
      deadline: "2026-03-12",
    });
    assert.equal(requested.status, 201);
    assert.equal(requested.body.status, "changes_requested");
    assert.deepEqual(requested.body.allowed_actions, ["submit_version"]);
    assert.equal(requested.body.versions[0].status, "changes_requested");
    assert.deepEqual(requested.body.change_requests[0], {
      id: 1,
      version: 1,
      reason: "Trocar o CTA final",
      deadline: "2026-03-12",
      requested_at: MORNING,
    });

    const submitted = await api.post(`/scripts/${id}/versions`, { content: "Versão 2" });
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.status, "in_review");
    assert.equal(submitted.body.current_version, 2);

    const approved = await api.post(`/scripts/${id}/approve`);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, "approved");
    assert.equal(approved.body.approved_at, MORNING);
    assert.deepEqual(approved.body.allowed_actions, []);
    assert.deepEqual(
      approved.body.versions.map((v: { number: number; status: string }) => [v.number, v.status]),
      [
        [1, "changes_requested"],
        [2, "approved"],
      ],
    );
  });

  it("mantém as versões antigas intactas quando chega uma nova", async () => {
    const api = setup(MORNING);
    const id = await api.createScript("Texto original da v1");
    await api.post(`/scripts/${id}/change-requests`, { reason: "Encurtar", deadline: "2026-03-12" });
    await api.post(`/scripts/${id}/versions`, { content: "Texto da v2" });
    await api.post(`/scripts/${id}/change-requests`, { reason: "Mudar o gancho", deadline: "2026-03-13" });
    await api.post(`/scripts/${id}/versions`, { content: "Texto da v3" });

    const res = await api.get(`/scripts/${id}`);
    assert.deepEqual(
      res.body.versions.map((v: { content: string }) => v.content),
      ["Texto original da v1", "Texto da v2", "Texto da v3"],
    );
    assert.equal(res.body.change_requests.length, 2);
    assert.equal(res.body.change_requests[1].version, 2);
  });
});

describe("roteiro aprovado não reabre", () => {
  async function approvedScript() {
    const api = setup(MORNING);
    const id = await api.createScript();
    await api.post(`/scripts/${id}/approve`);
    return { api, id };
  }

  it("recusa nova versão", async () => {
    const { api, id } = await approvedScript();
    const res = await api.post(`/scripts/${id}/versions`, { content: "Mais uma" });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "invalid_state");
  });

  it("recusa novo pedido de alteração", async () => {
    const { api, id } = await approvedScript();
    const res = await api.post(`/scripts/${id}/change-requests`, { reason: "Mudei de ideia", deadline: "2026-03-20" });
    assert.equal(res.status, 409);
  });

  it("recusa aprovar de novo e não altera o roteiro", async () => {
    const { api, id } = await approvedScript();
    const before = await api.get(`/scripts/${id}`);
    const res = await api.post(`/scripts/${id}/approve`);
    assert.equal(res.status, 409);
    assert.deepEqual((await api.get(`/scripts/${id}`)).body, before.body);
  });
});

describe("transições fora de ordem", () => {
  it("não aceita nova versão sem pedido de alteração aberto", async () => {
    const api = setup(MORNING);
    const id = await api.createScript();
    const res = await api.post(`/scripts/${id}/versions`, { content: "v2 sem pedido" });
    assert.equal(res.status, 409);
  });

  it("não aceita aprovar enquanto espera a nova versão", async () => {
    const api = setup(MORNING);
    const id = await api.createScript();
    await api.post(`/scripts/${id}/change-requests`, { reason: "Ajustar", deadline: "2026-03-12" });
    const res = await api.post(`/scripts/${id}/approve`);
    assert.equal(res.status, 409);
  });

  it("não aceita dois pedidos seguidos para a mesma versão", async () => {
    const api = setup(MORNING);
    const id = await api.createScript();
    await api.post(`/scripts/${id}/change-requests`, { reason: "Ajustar", deadline: "2026-03-12" });
    const res = await api.post(`/scripts/${id}/change-requests`, { reason: "Outro", deadline: "2026-03-12" });
    assert.equal(res.status, 409);
  });

  it("responde 404 para roteiro inexistente", async () => {
    const api = setup(MORNING);
    assert.equal((await api.get("/scripts/scr_999")).status, 404);
    assert.equal((await api.post("/scripts/scr_999/approve")).status, 404);
  });
});

describe("validação do pedido de alteração", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["sem motivo", { deadline: "2026-03-12" }],
    ["motivo vazio", { reason: "", deadline: "2026-03-12" }],
    ["motivo só com espaços", { reason: "   ", deadline: "2026-03-12" }],
    ["sem prazo", { reason: "Trocar o CTA" }],
    ["prazo em outro formato", { reason: "Trocar o CTA", deadline: "12/03/2026" }],
    ["prazo que não existe no calendário", { reason: "Trocar o CTA", deadline: "2026-02-30" }],
    ["prazo como número", { reason: "Trocar o CTA", deadline: 20260312 }],
  ];

  for (const [name, body] of cases) {
    it(`recusa pedido ${name} e não muda o estado`, async () => {
      const api = setup(MORNING);
      const id = await api.createScript();
      const res = await api.post(`/scripts/${id}/change-requests`, body);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, "validation_error");
      const script = await api.get(`/scripts/${id}`);
      assert.equal(script.body.status, "in_review");
      assert.equal(script.body.change_requests.length, 0);
    });
  }

  it("recusa corpo que não é JSON", async () => {
    const api = setup(MORNING);
    const id = await api.createScript();
    const { createApp } = await import("../src/app.ts");
    const res = await createApp().handle(
      new Request(`http://test/scripts/${id}/change-requests`, { method: "POST", body: "{quebrado" }),
    );
    assert.equal(res.status, 400);
  });

  it("recusa roteiro ou versão sem conteúdo", async () => {
    const api = setup(MORNING);
    assert.equal((await api.post("/scripts", { title: "Sem texto" })).status, 400);
    const id = await api.createScript();
    await api.post(`/scripts/${id}/change-requests`, { reason: "Ajustar", deadline: "2026-03-12" });
    assert.equal((await api.post(`/scripts/${id}/versions`, { content: " " })).status, 400);
  });
});
