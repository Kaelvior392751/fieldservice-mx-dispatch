import { createServer, type ServerResponse } from "node:http";
import {
  decideDispatchStatus,
  FieldserviceMailClient,
  InfraiError,
  setupRequestSchema,
} from "./fieldservice_mail.js";

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function readBody(request: AsyncIterable<Buffer | string>): Promise<unknown> {
  return (async () => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    return JSON.parse(body);
  })();
}

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const mailClient = new FieldserviceMailClient(apiKey);

async function handleSetup(request: AsyncIterable<Buffer | string>, response: ServerResponse) {
  try {
    const parsed = setupRequestSchema.safeParse(await readBody(request));
    if (!parsed.success) {
      sendJson(response, 400, { error: "Invalid request body", issues: parsed.error.issues });
      return;
    }
    const dispatchStatus = decideDispatchStatus(parsed.data);
    if (dispatchStatus === "needs_review") {
      sendJson(response, 422, {
        workOrderId: parsed.data.workOrder.id,
        dispatchStatus,
        reason: "Add a work-order photo and record any required technician follow-up",
      });
      return;
    }
    sendJson(response, 200, await mailClient.configure(parsed.data));
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: "Request body must be valid JSON" });
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      sendJson(response, error.status, { error: error.message, code: error.code });
      return;
    }
    sendJson(response, 502, { error: "Mail configuration could not be completed" });
  }
}

const exampleBody = {
  workOrder: {
    id: "WO-1842",
    serviceDomain: "mail.example-fieldservice.com",
    photos: [{ objectKey: "work-orders/WO-1842/compressor.jpg" }],
    technicianFollowUp: { needed: true, note: "Confirm pressure after the next visit" },
  },
  mx: [
    { exchange: "mx1.example.net", priority: 10 },
    { exchange: "mx2.example.net", priority: 20 },
  ],
};

if (process.argv.includes("--example")) {
  const parsed = setupRequestSchema.parse(exampleBody);
  const status = decideDispatchStatus(parsed);
  console.log(JSON.stringify(status === "ready_for_dispatch"
    ? await mailClient.configure(parsed)
    : { workOrderId: parsed.workOrder.id, dispatchStatus: status }, null, 2));
} else {
  const port = Number(process.env.PORT ?? 3000);
  createServer((request, response) => {
    if (request.method === "POST" && request.url === "/work-orders/mail/setup") {
      void handleSetup(request, response);
      return;
    }
    sendJson(response, 404, { error: "Route not found" });
  }).listen(port, () => console.log(`Field-service mail service listening on ${port}`));
}
