import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brandCivilDay, isDeadlinePast } from "../src/deadline.ts";
import { setup } from "./helpers.ts";


const LAST_INSTANT_OF_DAY_12 = "2026-03-13T02:59:59.999Z"; 
const FIRST_INSTANT_OF_DAY_13 = "2026-03-13T03:00:00.000Z";

async function requestWithDeadlineAt(now: string, deadline: string) {
  const api = setup("2026-03-10T12:00:00.000Z");
  const id = await api.createScript();
  api.setNow(now);
  return { api, id, res: await api.post(`/scripts/${id}/change-requests`, { reason: "Ajustar o CTA", deadline }) };
}

describe("prazo do pedido de alteração no fuso da marca", () => {
  it("aceita o pedido no último instante do dia do prazo, mesmo com o UTC já no dia seguinte", async () => {
    const { res } = await requestWithDeadlineAt(LAST_INSTANT_OF_DAY_12, "2026-03-12");
    assert.equal(res.status, 201);
    assert.equal(res.body.status, "changes_requested");
    assert.equal(res.body.change_requests[0].deadline, "2026-03-12");
  });

  it("recusa o pedido no primeiro instante do dia seguinte ao prazo", async () => {
    const { api, id, res } = await requestWithDeadlineAt(FIRST_INSTANT_OF_DAY_13, "2026-03-12");
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "deadline_passed");
    const script = await api.get(`/scripts/${id}`);
    assert.equal(script.body.status, "in_review");
    assert.equal(script.body.change_requests.length, 0);
  });

  it("aceita prazo para hoje logo no começo do dia em São Paulo", async () => {
    const { res } = await requestWithDeadlineAt("2026-03-12T03:00:00.000Z", "2026-03-12");
    assert.equal(res.status, 201);
  });

  it("usa o dia de São Paulo e não o de UTC em outro dia qualquer", async () => {
    const { res } = await requestWithDeadlineAt("2026-03-12T01:00:00.000Z", "2026-03-11");
    assert.equal(res.status, 201);
  });
});

describe("dia civil da marca", () => {
  it("converte instantes UTC para o dia em São Paulo", () => {
    assert.equal(brandCivilDay(new Date(LAST_INSTANT_OF_DAY_12)), "2026-03-12");
    assert.equal(brandCivilDay(new Date(FIRST_INSTANT_OF_DAY_13)), "2026-03-13");
    assert.equal(isDeadlinePast("2026-03-12", new Date(LAST_INSTANT_OF_DAY_12)), false);
    assert.equal(isDeadlinePast("2026-03-12", new Date(FIRST_INSTANT_OF_DAY_13)), true);
  });
});

describe("versão enviada depois do prazo", () => {
  it("é aceita, fica no histórico e vem marcada como atrasada", async () => {
    const api = setup("2026-03-10T12:00:00.000Z");
    const id = await api.createScript();
    await api.post(`/scripts/${id}/change-requests`, { reason: "Ajustar", deadline: "2026-03-12" });

    api.setNow(LAST_INSTANT_OF_DAY_12);
    const onTime = await api.post(`/scripts/${id}/versions`, { content: "v2 no limite" });
    assert.equal(onTime.body.versions[1].late, false);

    await api.post(`/scripts/${id}/change-requests`, { reason: "Mais um ajuste", deadline: "2026-03-13" });
    api.setNow("2026-03-14T03:00:00.000Z");
    const late = await api.post(`/scripts/${id}/versions`, { content: "v3 atrasada" });
    assert.equal(late.status, 201);
    assert.equal(late.body.versions[2].late, true);
  });
});
