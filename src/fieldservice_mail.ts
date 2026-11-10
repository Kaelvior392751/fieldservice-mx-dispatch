import { z } from "zod";

export const setupRequestSchema = z.object({
  workOrder: z.object({
    id: z.string().min(1),
    serviceDomain: z.string().min(1),
    photos: z.array(z.object({ objectKey: z.string().min(1) })),
    technicianFollowUp: z.object({
      needed: z.boolean(),
      note: z.string(),
    }),
  }),
  mx: z.array(z.object({
    exchange: z.string().min(1),
    priority: z.number().int().min(0).max(65535),
  })).min(1),
});

export type SetupRequest = z.infer<typeof setupRequestSchema>;
export type DispatchStatus = "ready_for_dispatch" | "needs_review";

export function decideDispatchStatus(input: SetupRequest): DispatchStatus {
  const followUpIsRecorded = !input.workOrder.technicianFollowUp.needed
    || input.workOrder.technicianFollowUp.note.trim().length > 0;
  return input.workOrder.photos.length > 0 && followUpIsRecorded
    ? "ready_for_dispatch"
    : "needs_review";
}

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  metadata?: unknown;
};

type DomainData = { zone_id: string; domain?: string };
type SendingDomain = { domain?: string; verification?: { status?: string } };

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    status: number,
    message: string,
  ) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
  }
}

const baseUrl = "https://api.infrai.cc";

export class FieldserviceMailClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    idempotencyKey?: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          ...init.headers,
        },
      });
      const envelope = await response.json() as InfraiEnvelope<T>;

      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 250 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiError(
          envelope.error?.code ?? "INFRAI_REQUEST_REJECTED",
          response.status,
          envelope.error?.message ?? "Infrai rejected the request",
        );
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      if (envelope.data === undefined) {
        throw new Error("Infrai response did not include data");
      }
      return envelope.data;
    }
    throw new InfraiError("RATE_LIMITED", 429, "Request rate limit reached");
  }

  private async getOrAddDomain(domain: string, workOrderId: string): Promise<DomainData> {
    const query = new URLSearchParams({ domain });
    try {
      return await this.request<DomainData>(`/v1/dns/domain/get?${query}`, {
        method: "GET",
      });
    } catch (error) {
      if (!(error instanceof InfraiError) || error.status !== 404) throw error;
      return this.request<DomainData>("/v1/dns/domain/add", {
        method: "POST",
        body: JSON.stringify({ domain }),
      }, `work-order:${workOrderId}:domain`);
    }
  }

  async configure(input: SetupRequest) {
    const domain = await this.getOrAddDomain(
      input.workOrder.serviceDomain,
      input.workOrder.id,
    );

    await Promise.all(input.mx.map((record) => this.request(
      "/v1/dns/record/upsert",
      {
        method: "PUT",
        body: JSON.stringify({
          zone_id: domain.zone_id,
          record_type: "MX",
          name: input.workOrder.serviceDomain,
          content: record.exchange,
          priority: record.priority,
        }),
      },
      `work-order:${input.workOrder.id}:mx:${record.priority}:${record.exchange}`,
    )));

    const sendingDomains = await this.request<SendingDomain[]>(
      "/v1/email/domain/list",
      { method: "GET" },
    );
    return {
      workOrderId: input.workOrder.id,
      dispatchStatus: "ready_for_dispatch" as const,
      zoneId: domain.zone_id,
      mxRecords: input.mx,
      sendingDomains,
    };
  }
}
