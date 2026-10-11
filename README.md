# Conty. Revisão de roteiro

API para o vai e volta do roteiro antes do vídeo: o criador envia versões, a marca pede alteração (com motivo e prazo) ou aprova. Cada passo fica no histórico, e o estado atual está sempre explícito na resposta.

## Como rodar

Node 22.18 ou mais novo. Não há dependências para instalar: a API usa só `node:http`, e os testes usam `node:test`. O Node roda os arquivos `.ts` direto.

```bash
npm test     # 25 testes
npm start    # sobe em http://127.0.0.1:3003 (mude com PORT=...)
```

Em Node 22 anterior ao 22.18, rode com `node --experimental-strip-types`.

## Estados

```
            criar (v1)              pedir alteração (motivo + prazo)
  ─────────────────────► in_review ─────────────────────────────► changes_requested
                           │  ▲                                          │
                   aprovar │  └──────────── enviar nova versão ──────────┘
                           ▼
                        approved   (final: não aceita nova versão, pedido nem reaprovação)
```

Toda resposta traz `status` e `allowed_actions`, então quem consome a API não precisa adivinhar o próximo passo. Cada versão guarda o próprio estado (`in_review`, `changes_requested`, `approved`), e nenhuma versão é sobrescrita.

| Ação | Endpoint | Aceita quando o estado é | Sucesso |
|---|---|---|---|
| Criar roteiro com a v1 | `POST /scripts` `{title, content}` | — | 201 |
| Pedir alteração | `POST /scripts/:id/change-requests` `{reason, deadline}` | `in_review` | 201 |
| Enviar nova versão | `POST /scripts/:id/versions` `{content}` | `changes_requested` | 201 |
| Aprovar | `POST /scripts/:id/approve` | `in_review` | 200 |
| Ver roteiro e histórico | `GET /scripts/:id` | qualquer | 200 |

Os erros vêm como `{"error": {"code", "message"}}`:

- `400 validation_error`: campo obrigatório ausente ou vazio, prazo fora do formato `AAAA-MM-DD` ou data inexistente;
- `404 not_found`: roteiro ou rota inexistente;
- `409 invalid_state`: ação não permitida no estado atual, por exemplo qualquer ação em roteiro aprovado;
- `422 deadline_passed`: o prazo do pedido já passou.

### Prazo

O prazo é um dia civil no fuso da marca, `America/Sao_Paulo`. O pedido vale até o último instante desse dia. Exemplo com prazo `2026-03-12`:

- em `2026-03-13T02:59:59.999Z` (23:59:59.999 do dia 12 em São Paulo), o pedido é **aceito**, mesmo com o UTC já no dia 13;
- em `2026-03-13T03:00:00.000Z` (meia-noite do dia 13 em São Paulo), o pedido é **recusado** com 422.

A API recebe o relógio como parâmetro (`createApp(clock)`). Os testes em `test/deadline.test.ts` fixam o horário exato em vez de depender da hora real.

## Exemplos

Respostas reais, encurtadas onde indicado com `…`.

**Criar roteiro**

```bash
curl -s -X POST localhost:3003/scripts -H 'content-type: application/json' \
  -d '{"title":"Campanha verão","content":"Abertura na praia, produto aparece aos 5s."}'
```

```json
{
  "id": "scr_1",
  "title": "Campanha verão",
  "status": "in_review",
  "current_version": 1,
  "created_at": "2026-10-11T21:07:09.622Z",
  "approved_at": null,
  "versions": [
    { "number": 1, "content": "Abertura na praia, produto aparece aos 5s.", "status": "in_review", "submitted_at": "2026-10-11T21:07:09.622Z", "late": false }
  ],
  "change_requests": [],
  "allowed_actions": ["request_changes", "approve"]
}
```

**Pedido sem prazo** → `400`

```bash
curl -s -X POST localhost:3003/scripts/scr_1/change-requests -H 'content-type: application/json' \
  -d '{"reason":"Trocar o CTA final"}'
```

```json
{ "error": { "code": "validation_error", "message": "deadline é obrigatório" } }
```

**Pedido com prazo que já passou** → `422`

```bash
curl -s -X POST localhost:3003/scripts/scr_1/change-requests -H 'content-type: application/json' \
  -d '{"reason":"Trocar o CTA final","deadline":"2026-10-01"}'
```

```json
{ "error": { "code": "deadline_passed", "message": "o prazo informado já passou no fuso da marca" } }
```

**Pedido válido** → `201`

```bash
curl -s -X POST localhost:3003/scripts/scr_1/change-requests -H 'content-type: application/json' \
  -d '{"reason":"Trocar o CTA final para o cupom VERAO10","deadline":"2026-10-15"}'
```

```json
{
  "id": "scr_1",
  "status": "changes_requested",
  "current_version": 1,
  "versions": [
    { "number": 1, "content": "Abertura na praia, produto aparece aos 5s.", "status": "changes_requested", "submitted_at": "2026-10-11T21:07:09.622Z", "late": false }
  ],
  "change_requests": [
    { "id": 1, "version": 1, "reason": "Trocar o CTA final para o cupom VERAO10", "deadline": "2026-10-15", "requested_at": "2026-10-11T21:07:09.651Z" }
  ],
  "allowed_actions": ["submit_version"],
  "…": "title, created_at e approved_at omitidos"
}
```

**Aprovar enquanto espera nova versão** → `409`

```json
{ "error": { "code": "invalid_state", "message": "ação approve não é permitida no estado changes_requested" } }
```

**Nova versão** → `201` (a v1 continua no histórico)

```bash
curl -s -X POST localhost:3003/scripts/scr_1/versions -H 'content-type: application/json' \
  -d '{"content":"Abertura na praia, produto aos 5s, CTA com cupom VERAO10."}'
```

```json
{
  "status": "in_review",
  "current_version": 2,
  "versions": [
    { "number": 1, "content": "Abertura na praia, produto aparece aos 5s.", "status": "changes_requested", "…": "…" },
    { "number": 2, "content": "Abertura na praia, produto aos 5s, CTA com cupom VERAO10.", "status": "in_review", "late": false, "…": "…" }
  ],
  "allowed_actions": ["request_changes", "approve"],
  "…": "…"
}
```

**Aprovar** → `200`

```bash
curl -s -X POST localhost:3003/scripts/scr_1/approve
```

```json
{
  "status": "approved",
  "approved_at": "2026-10-11T21:07:09.677Z",
  "versions": [
    { "number": 1, "status": "changes_requested", "…": "…" },
    { "number": 2, "status": "approved", "…": "…" }
  ],
  "allowed_actions": [],
  "…": "…"
}
```

**Nova versão depois de aprovado** → `409`

```json
{ "error": { "code": "invalid_state", "message": "o roteiro já foi aprovado e não aceita mais alterações" } }
```

## Decisões e o que ficou de fora

- **Versão enviada depois do prazo é aceita, com `late: true`.** O enunciado diz que um *pedido* com prazo vencido não vale. Para a *resposta* do criador fora do prazo ele não diz nada, então preferi não travar o fluxo e deixar o atraso visível. Com mais tempo, eu confirmaria com o time de operação se o certo é recusar, aceitar marcando, ou expirar o pedido e devolver o roteiro para a marca.
- **Um pedido por versão.** Enquanto o roteiro está em `changes_requested`, a marca não pode pedir de novo nem editar o pedido. Com mais tempo, eu permitiria corrigir o pedido aberto, guardando o histórico da edição.
- **Armazenamento em memória.** Reiniciar o servidor apaga tudo. Com mais tempo, eu usaria um banco (SQLite ou Postgres) com transação em cada mudança de estado, para dois pedidos simultâneos não passarem pela mesma checagem de estado.
- **Sem autenticação nem papéis.** Qualquer chamada age como marca ou como criador. Com mais tempo, a marca seria a única a pedir alteração e aprovar, e o criador o único a enviar versões.
- **Fuso fixo.** `America/Sao_Paulo` está no código porque o enunciado define assim. Com marcas em outros fusos, o fuso seria um campo da marca.
- **Sem dependências.** Usei `node:http` e `node:test` em vez de um framework, para a API rodar sem instalar nada. Num projeto real, eu usaria um framework HTTP com validação de schema.
- **Fora do escopo, como pede o enunciado:** vídeo, upload, interface, notificações e listagem de roteiros.


## IA

- A IA foi responsável por analisar o problema e desenvolver uma solução de código utilizando a stack dos outros desafios, eu implementei o código desenvolvido pela IA verificando e revisando ele por completo, todas as partes, realizei diversos testes e certifiquei de que estava tudo de funcionando e de acordo com o solicitado.