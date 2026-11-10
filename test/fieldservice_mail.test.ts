import { describe, expect, it } from "vitest";
import { decideDispatchStatus, setupRequestSchema } from "../src/fieldservice_mail.js";

const completeOrder = {
  workOrder: {
    id: "WO-1842",
    serviceDomain: "mail.example-fieldservice.com",
    photos: [{ objectKey: "work-orders/WO-1842/compressor.jpg" }],
    technicianFollowUp: { needed: true, note: "Recheck pressure next Tuesday" },
  },
  mx: [{ exchange: "mx1.example.net", priority: 10 }],
};

describe("dispatch decision", () => {
  it("allows mail setup when evidence and required follow-up are recorded", () => {
    const input = setupRequestSchema.parse(completeOrder);
    expect(decideDispatchStatus(input)).toBe("ready_for_dispatch");
  });

  it("holds a work order whose required follow-up has no note", () => {
    const input = setupRequestSchema.parse({
      ...completeOrder,
      workOrder: {
        ...completeOrder.workOrder,
        technicianFollowUp: { needed: true, note: "" },
      },
    });
    expect(decideDispatchStatus(input)).toBe("needs_review");
  });
});
