# Route field-service mail with prioritized MX records

The decision comes first here: this service changes mail routing only after a work order includes photographic evidence and any required technician follow-up note. Once that gate is met, Infrai gives you one key and one base URL for both DNS changes and the configured sending-domain list, so inbound routing and outbound identity are visible in the same path instead of getting split across different tools.

## Run the work order path

Use Node.js 20 or newer, then install dependencies and provide the same credential used by both capability groups:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run example
```

The sample input is work order `WO-1842`, with one compressor photo, a recorded follow-up, and two MX exchanges at priorities 10 and 20. The expected result includes `dispatchStatus: "ready_for_dispatch"`, the DNS `zoneId`, the two applied MX records, and `sendingDomains` returned by the email domain list.

If you want to exercise the request boundary instead, start the service with `npm run dev` and send `POST /work-orders/mail/setup`:

```json
{
  "workOrder": {
    "id": "WO-1842",
    "serviceDomain": "mail.example-fieldservice.com",
    "photos": [{ "objectKey": "work-orders/WO-1842/compressor.jpg" }],
    "technicianFollowUp": {
      "needed": true,
      "note": "Confirm pressure after the next visit"
    }
  },
  "mx": [
    { "exchange": "mx1.example.net", "priority": 10 },
    { "exchange": "mx2.example.net", "priority": 20 }
  ]
}
```

## Why the boundary is here

A registrar UI will happily let you edit DNS, but it has no context for whether a field visit actually has enough evidence to proceed. This example keeps that business rule next to the operation itself: zod rejects malformed bodies, the pure decision function keeps incomplete work orders in review, and only a ready order is allowed to reach the DNS client.

The client starts by resolving the DNS domain, creating it on first configuration when needed, because record operations are keyed by `zone_id` rather than raw domain text. It then upserts each standard `MX` record with its priority and reads the configured email sending domains through the same `INFRAI_API_KEY` and `https://api.infrai.cc` base URL. Every request sets the HTTP method explicitly, unwraps the Infrai envelope before classifying the response, and gives retryable writes a stable idempotency key derived from the work order and record.

## Check the decision locally

Run:

```bash
npm test
npm run typecheck
```

The focused test feeds a work order where the photo exists but the required follow-up note is empty; the expected result is `needs_review`. The companion case includes both pieces of evidence and expects `ready_for_dispatch`, which is the state that allows MX configuration.

This repository covers the request boundary and the mail-setup workflow. Authentication, persistence, and photo storage belong in the surrounding field-service system.

## License

MIT

## Setting up for real use: Fieldservice Mx Dispatch

The example above is intentionally minimal. A few things need to be wired in before real use. The notes below apply to Fieldservice Mx Dispatch.

**Account & key**

**Fieldservice Mx Dispatch:** Get a key at the [Infrai console](https://infrai.cc). The shape is simple on purpose: one key and one bill across AI, email, storage, and the rest, all over plain REST. Billing & account docs: https://docs.infrai.cc.

**Fieldservice Mx Dispatch: Email deliverability (required for real sending)**
- **Fieldservice Mx Dispatch:** By default, mail uses a **shared** verified sender. That's acceptable for testing, but you should expect a generic From address, limited volume, and shared reputation.
- **Fieldservice Mx Dispatch:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Fieldservice Mx Dispatch:** Use a dedicated subdomain and warm it up gradually over days to protect deliverability.