import { isDeadlinePast, isValidCivilDate } from "./deadline.ts";

export type ScriptStatus = "in_review" | "changes_requested" | "approved";

export type VersionStatus = "in_review" | "changes_requested" | "approved";

export type Action = "request_changes" | "approve" | "submit_version";

export type Version = {
  number: number;
  content: string;
  status: VersionStatus;
  submitted_at: string;
  late: boolean;
};

export type ChangeRequest = {
  id: number;
  version: number;
  reason: string;
  deadline: string;
  requested_at: string;
};

export type Script = {
  id: string;
  title: string;
  status: ScriptStatus;
  current_version: number;
  created_at: string;
  approved_at: string | null;
  versions: Version[];
  change_requests: ChangeRequest[];
};

export type ScriptView = Script & { allowed_actions: Action[] };

export type ErrorCode = "validation_error" | "not_found" | "invalid_state" | "deadline_passed";

export class DomainError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const ALLOWED_ACTIONS: Record<ScriptStatus, Action[]> = {
  in_review: ["request_changes", "approve"],
  changes_requested: ["submit_version"],
  approved: [],
};

export type Clock = () => Date;

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainError("validation_error", `${field} é obrigatório`);
  }
  return value.trim();
}

export class ScriptStore {
  private readonly scripts = new Map<string, Script>();
  private readonly clock: Clock;
  private nextId = 1;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  view(id: string): ScriptView {
    const script = this.find(id);
    return { ...structuredClone(script), allowed_actions: [...ALLOWED_ACTIONS[script.status]] };
  }

  create(input: { title?: unknown; content?: unknown }): ScriptView {
    const title = requiredText(input.title, "title");
    const content = requiredText(input.content, "content");
    const now = this.clock().toISOString();
    const id = `scr_${this.nextId++}`;
    this.scripts.set(id, {
      id,
      title,
      status: "in_review",
      current_version: 1,
      created_at: now,
      approved_at: null,
      versions: [{ number: 1, content, status: "in_review", submitted_at: now, late: false }],
      change_requests: [],
    });
    return this.view(id);
  }


  requestChanges(id: string, input: { reason?: unknown; deadline?: unknown }): ScriptView {
    const script = this.find(id);
    this.ensureAllowed(script, "request_changes");
    const reason = requiredText(input.reason, "reason");
    const deadline = requiredText(input.deadline, "deadline");
    if (!isValidCivilDate(deadline)) {
      throw new DomainError("validation_error", "deadline deve ser uma data no formato AAAA-MM-DD");
    }
    const now = this.clock();
    if (isDeadlinePast(deadline, now)) {
      throw new DomainError("deadline_passed", "o prazo informado já passou no fuso da marca");
    }

    const version = this.currentVersion(script);
    version.status = "changes_requested";
    script.change_requests.push({
      id: script.change_requests.length + 1,
      version: version.number,
      reason,
      deadline,
      requested_at: now.toISOString(),
    });
    script.status = "changes_requested";
    return this.view(id);
  }


  submitVersion(id: string, input: { content?: unknown }): ScriptView {
    const script = this.find(id);
    this.ensureAllowed(script, "submit_version");
    const content = requiredText(input.content, "content");
    const now = this.clock();
    const openRequest = script.change_requests[script.change_requests.length - 1];
    const late = openRequest ? isDeadlinePast(openRequest.deadline, now) : false;

    const number = script.versions.length + 1;
    script.versions.push({ number, content, status: "in_review", submitted_at: now.toISOString(), late });
    script.current_version = number;
    script.status = "in_review";
    return this.view(id);
  }


  approve(id: string): ScriptView {
    const script = this.find(id);
    this.ensureAllowed(script, "approve");
    this.currentVersion(script).status = "approved";
    script.status = "approved";
    script.approved_at = this.clock().toISOString();
    return this.view(id);
  }

  private find(id: string): Script {
    const script = this.scripts.get(id);
    if (!script) throw new DomainError("not_found", "roteiro não encontrado");
    return script;
  }

  private currentVersion(script: Script): Version {
    const version = script.versions[script.current_version - 1];
    if (!version) throw new Error(`versão ${script.current_version} ausente no roteiro ${script.id}`);
    return version;
  }

  private ensureAllowed(script: Script, action: Action): void {
    if (ALLOWED_ACTIONS[script.status].includes(action)) return;
    const detail =
      script.status === "approved"
        ? "o roteiro já foi aprovado e não aceita mais alterações"
        : `ação ${action} não é permitida no estado ${script.status}`;
    throw new DomainError("invalid_state", detail);
  }
}
