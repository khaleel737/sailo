/**
 * The response bodies the documentation prints.
 *
 * A hundred and ninety lines of JSON-shaped strings, which is why they are not in the file
 * that describes the endpoints: scrolling past a page of sample payloads to reach the
 * catalogue was the actual reading experience of the module they came out of.
 *
 * Strings rather than objects on purpose — the docs page prints them verbatim, and an
 * object would be re-serialised with our key order and our spacing rather than the shape a
 * caller actually receives.
 */



/* -------------------------------------------------------------------------- */
/*  Response examples                                                          */
/* -------------------------------------------------------------------------- */

export const SHOP_EXAMPLE = `{
  "data": {
    "id": "3f1c9a80-5e17-4a2b-9c44-2f0d8b71e6a3",
    "object": "shop",
    "handle": "acme",
    "name": "Acme Supply",
    "currency": "GBP",
    "timeZone": "Europe/London",
    "createdAt": "2026-01-09T11:02:44.108Z"
  }
}`;

export const ORDER_EXAMPLE = `{
  "data": {
    "id": "8f2b41d6-0c93-4f77-a1e5-9b6d2c4a7e01",
    "object": "order",
    "status": "confirmed",
    "paymentStatus": "paid",
    "paymentMethod": "card",
    "currency": "GBP",
    "subtotal":    { "cents": 4999, "amount": "49.99", "currency": "GBP" },
    "discount":    { "cents": 0,    "amount": "0.00",  "currency": "GBP" },
    "deliveryFee": { "cents": 499,  "amount": "4.99",  "currency": "GBP" },
    "tax":         { "cents": 0,    "amount": "0.00",  "currency": "GBP" },
    "total":       { "cents": 5498, "amount": "54.98", "currency": "GBP" },
    "refunded":    { "cents": 0,    "amount": "0.00",  "currency": "GBP" },
    "itemCount": 1,
    "customer": {
      "clientId": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "phone": null
    },
    "address": {
      "line1": "12 Dean Street", "line2": null, "city": "London",
      "region": null, "postalCode": "W1D 3RN", "country": "GB"
    },
    "delivery": {
      "method": "shipping", "label": "Standard", "pickupLocation": null,
      "trackingCarrier": null, "trackingNumber": null, "trackingUrl": null,
      "shippedAt": null
    },
    "booking": null,
    "coupon": { "code": "LAUNCH10" },
    "affiliate": null,
    "note": null,
    "items": [
      {
        "id": "1b0c…", "productId": "9a7e…", "variantId": null,
        "title": "Sourdough loaf", "variantLabel": null, "sku": "SD-01",
        "kind": "physical", "quantity": 1,
        "unitPrice": { "cents": 4999, "amount": "49.99", "currency": "GBP" },
        "subtotal":  { "cents": 4999, "amount": "49.99", "currency": "GBP" }
      }
    ],
    "createdAt": "2026-08-12T09:41:07.221Z",
    "updatedAt": "2026-08-12T09:41:09.884Z"
  }
}`;

export const ORDER_PAGE_EXAMPLE = `{
  "data": [
    {
      "id": "8f2b41d6-0c93-4f77-a1e5-9b6d2c4a7e01",
      "object": "order",
      "status": "confirmed",
      "paymentStatus": "paid",
      "total": { "cents": 5498, "amount": "54.98", "currency": "GBP" },
      "customer": { "clientId": "c1d2…", "name": "Ada Lovelace", "email": "ada@example.com", "phone": null },
      "items": [ /* … */ ]
      /* … every field GET /orders/{id} returns … */
    }
  ],
  "has_more": true,
  "next_cursor": "MjAyNi0wOC0xMlQwOTo0MTowNy4yMjFafDhmMmI"
}`;

export const PRODUCT_EXAMPLE = `{
  "data": {
    "id": "9a7e2c11-6b48-4d0f-8e35-71c9a4f2b6d8",
    "object": "product",
    "title": "Sourdough loaf",
    "slug": "sourdough-loaf",
    "description": "Baked the night before.",
    "kind": "physical",
    "tags": ["bread"],
    "price":     { "cents": 4999, "amount": "49.99", "currency": "GBP" },
    "compareAt": null,
    "trackInventory": true,
    "stock": 12,
    "inStock": true,
    "isPublished": true,
    "isFeatured": false,
    "booking": null,
    "event": null,
    "membership": null,
    "variants": [
      {
        "id": "4c5d…",
        "sku": "SD-01-L",
        "options": { "Size": "Large" },
        "price": { "cents": 5499, "amount": "54.99", "currency": "GBP" },
        "stock": 4,
        "isAvailable": true
      }
    ],
    "createdAt": "2026-03-02T08:15:00.000Z",
    "updatedAt": "2026-08-01T16:20:31.442Z"
  }
}`;

export const CONTACT_EXAMPLE = `{
  "data": {
    "id": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    "object": "contact",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": null,
    "tags": ["webinar"],
    "source": "api",
    "marketingConsentAt": null,
    "address": {
      "line1": null, "line2": null, "city": null,
      "region": null, "postalCode": null, "country": null
    },
    "createdAt": "2026-08-12T09:41:07.221Z",
    "updatedAt": "2026-08-12T09:41:07.221Z"
  }
}`;

export const PRODUCT_PAGE_EXAMPLE = `{
  "data": [
    {
      "id": "9a7e2c11-6b48-4d0f-8e35-71c9a4f2b6d8",
      "object": "product",
      "title": "Sourdough loaf",
      "slug": "sourdough-loaf",
      "kind": "physical",
      "price": { "cents": 4999, "amount": "49.99", "currency": "GBP" },
      "stock": 12,
      "inStock": true,
      "isPublished": true,
      "variants": []
      /* … every field GET /products/{id} returns, minus the variants … */
    }
  ],
  "has_more": false,
  "next_cursor": null
}`;

export const CONTACT_PAGE_EXAMPLE = `{
  "data": [
    {
      "id": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
      "object": "contact",
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "phone": null,
      "tags": ["webinar"],
      "source": "api",
      "marketingConsentAt": "2026-08-12T10:03:55.700Z"
      /* … every field GET /contacts/{id} returns … */
    }
  ],
  "has_more": false,
  "next_cursor": null
}`;

export const CONTACT_WRITE_EXAMPLE = `{
  "data": {
    "id": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    "object": "contact",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": null,
    "tags": ["webinar"],
    "source": "api",
    "marketingConsentAt": null,
    "address": { "line1": null, "line2": null, "city": null, "region": null, "postalCode": null, "country": null },
    "createdAt": "2026-08-12T09:41:07.221Z",
    "updatedAt": "2026-08-12T09:41:07.221Z",
    "optInSent": true
  }
}`;

export const SUBSCRIPTION_EXAMPLE = `{
  "data": {
    "id": "5e8a1c73-2d94-4b16-8f07-3c9e6b0a1d42",
    "object": "subscription",
    "status": "active",
    "productId": "9a7e2c11-6b48-4d0f-8e35-71c9a4f2b6d8",
    "clientId": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    "price": { "cents": 1200, "amount": "12.00", "currency": "GBP" },
    "currency": "GBP",
    "interval": "month",
    "intervalCount": 1,
    "billingMode": "stripe",
    "paymentMethod": null,
    "currentPeriodEnd": "2026-09-12T09:41:07.221Z",
    "cancelAtPeriodEnd": false,
    "canceledAt": null,
    "trialEndsAt": null,
    "startedAt": "2026-02-12T09:41:07.221Z",
    "createdAt": "2026-02-12T09:41:07.221Z",
    "updatedAt": "2026-08-12T09:41:09.884Z"
  }
}`;

export const SUBSCRIPTION_PAGE_EXAMPLE = `{
  "data": [
    {
      "id": "5e8a1c73-2d94-4b16-8f07-3c9e6b0a1d42",
      "object": "subscription",
      "status": "active",
      "productId": "9a7e2c11-6b48-4d0f-8e35-71c9a4f2b6d8",
      "clientId": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
      "price": { "cents": 1200, "amount": "12.00", "currency": "GBP" },
      "interval": "month",
      "intervalCount": 1,
      "billingMode": "stripe",
      "currentPeriodEnd": "2026-09-12T09:41:07.221Z",
      "cancelAtPeriodEnd": false
      /* … every field GET /subscriptions/{id} returns … */
    }
  ],
  "has_more": false,
  "next_cursor": null
}`;

export const DISPUTE_EXAMPLE = `{
  "data": {
    "id": "7b3f9d21-6c05-4e88-9a12-4d7e2f8b3c60",
    "object": "dispute",
    "orderId": "8f2b41d6-0c93-4f77-a1e5-9b6d2c4a7e01",
    "status": "needs_response",
    "caseType": "chargeback",
    "reason": "product_not_received",
    "networkReasonCode": "13.1",
    "network": "visa",
    "amount":   { "cents": 5498, "amount": "54.98", "currency": "GBP" },
    "fee":      { "cents": 1500, "amount": "15.00", "currency": "GBP" },
    "deducted": { "cents": 6998, "amount": "69.98", "currency": "GBP" },
    "currency": "GBP",
    "dueBy": "2026-09-01T23:59:59.000Z",
    "evidenceSubmittedAt": null,
    "submissionCount": 0,
    "completenessBp": 0,
    "fundsWithdrawnAt": "2026-08-12T11:02:00.000Z",
    "fundsReinstatedAt": null,
    "openedAt": "2026-08-12T11:01:58.000Z",
    "createdAt": "2026-08-12T11:02:03.114Z",
    "updatedAt": "2026-08-12T11:02:03.114Z"
  }
}`;

export const DISPUTE_PAGE_EXAMPLE = `{
  "data": [
    {
      "id": "7b3f9d21-6c05-4e88-9a12-4d7e2f8b3c60",
      "object": "dispute",
      "orderId": "8f2b41d6-0c93-4f77-a1e5-9b6d2c4a7e01",
      "status": "needs_response",
      "caseType": "chargeback",
      "reason": "product_not_received",
      "amount":   { "cents": 5498, "amount": "54.98", "currency": "GBP" },
      "deducted": { "cents": 6998, "amount": "69.98", "currency": "GBP" },
      "dueBy": "2026-09-01T23:59:59.000Z"
      /* … every field GET /disputes/{id} returns … */
    }
  ],
  "has_more": false,
  "next_cursor": null
}`;

export const BOOKING_EXAMPLE = `{
  "data": {
    "id": "2a6d8f30-91b4-4c27-8e53-0f1a7c6b9d84",
    "object": "booking",
    "orderId": "8f2b41d6-0c93-4f77-a1e5-9b6d2c4a7e01",
    "productId": "9a7e2c11-6b48-4d0f-8e35-71c9a4f2b6d8",
    "productTitle": "Cut and finish",
    "staffId": "6d4b2e19-7a30-4f85-b1c6-2e8d5a3f0b71",
    "staffName": "Ada",
    "startsAt": "2026-08-24T13:30:00.000Z",
    "endsAt": "2026-08-24T14:15:00.000Z",
    "seats": 1,
    "isExclusive": true,
    "createdAt": "2026-08-12T09:41:07.221Z"
  }
}`;

export const BOOKING_PAGE_EXAMPLE = `{
  "data": [
    {
      "id": "2a6d8f30-91b4-4c27-8e53-0f1a7c6b9d84",
      "object": "booking",
      "orderId": "8f2b41d6-0c93-4f77-a1e5-9b6d2c4a7e01",
      "productId": "9a7e2c11-6b48-4d0f-8e35-71c9a4f2b6d8",
      "productTitle": "Cut and finish",
      "staffId": "6d4b2e19-7a30-4f85-b1c6-2e8d5a3f0b71",
      "staffName": "Ada",
      "startsAt": "2026-08-24T13:30:00.000Z",
      "endsAt": "2026-08-24T14:15:00.000Z",
      "seats": 1,
      "isExclusive": true,
      "createdAt": "2026-08-12T09:41:07.221Z"
    }
  ],
  "has_more": false,
  "next_cursor": null
}`;

export const STAFF_EXAMPLE = `{
  "data": {
    "id": "6d4b2e19-7a30-4f85-b1c6-2e8d5a3f0b71",
    "object": "staff",
    "name": "Ada",
    "email": "ada@acme.example",
    "avatarUrl": null,
    "timeZone": "Europe/London",
    "isActive": true,
    "position": 0,
    "createdAt": "2026-06-01T10:00:00.000Z",
    "updatedAt": "2026-08-01T16:20:31.442Z"
  }
}`;

export const STAFF_PAGE_EXAMPLE = `{
  "data": [
    {
      "id": "6d4b2e19-7a30-4f85-b1c6-2e8d5a3f0b71",
      "object": "staff",
      "name": "Ada",
      "email": "ada@acme.example",
      "avatarUrl": null,
      "timeZone": "Europe/London",
      "isActive": true,
      "position": 0,
      "createdAt": "2026-06-01T10:00:00.000Z",
      "updatedAt": "2026-08-01T16:20:31.442Z"
    }
  ],
  "has_more": false,
  "next_cursor": null
}`;

export const LIST_EXAMPLE = `{
  "data": {
    "id": "b8c1a057-3e62-4d19-9f74-5a0c8b2e6d13",
    "object": "list",
    "name": "Newsletter",
    "description": "Monthly, and never more than that.",
    "doubleOptIn": true,
    "subscribedCount": 412,
    "pendingCount": 7,
    "createdAt": "2026-04-18T12:00:00.000Z",
    "updatedAt": "2026-04-18T12:00:00.000Z"
  }
}`;

export const LIST_PAGE_EXAMPLE = `{
  "data": [
    {
      "id": "b8c1a057-3e62-4d19-9f74-5a0c8b2e6d13",
      "object": "list",
      "name": "Newsletter",
      "description": "Monthly, and never more than that.",
      "doubleOptIn": true,
      "subscribedCount": 412,
      "pendingCount": 7,
      "createdAt": "2026-04-18T12:00:00.000Z",
      "updatedAt": "2026-04-18T12:00:00.000Z"
    }
  ],
  "has_more": false,
  "next_cursor": null
}`;

export const CONTACT_LISTS_EXAMPLE = `{
  "data": {
    "id": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    "object": "contact",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": null,
    "tags": ["webinar"],
    "source": "api",
    "marketingConsentAt": null,
    "address": { "line1": null, "line2": null, "city": null, "region": null, "postalCode": null, "country": null },
    "createdAt": "2026-08-12T09:41:07.221Z",
    "updatedAt": "2026-08-12T09:41:07.221Z",
    "lists": [
      {
        "id": "b8c1a057-3e62-4d19-9f74-5a0c8b2e6d13",
        "name": "Newsletter",
        "status": "pending",
        "joinedAt": "2026-08-20T14:05:11.900Z"
      }
    ]
  }
}`;

export const FLOW_EXAMPLE = `{
  "data": {
    "id": "d4e5f6a7-8b9c-4d0e-1f2a-3b4c5d6e7f80",
    "object": "flow",
    "name": "Welcome sequence",
    "kind": "email",
    "status": "active",
    "trigger": {
      "type": "list.joined",
      "config": { "listId": "b8c1a057-3e62-4d19-9f74-5a0c8b2e6d13" }
    },
    "entryPolicy": "once",
    "steps": [
      { "id": "s-1a2b3c4d", "kind": "send" },
      { "id": "s-5e6f7a8b", "kind": "timer" },
      { "id": "s-9c0d1e2f", "kind": "send" }
    ],
    "stepCount": 3,
    "runs": {
      "total": 412,
      "live": 37,
      "completed": 361,
      "failed": 12,
      "cancelled": 2
    },
    "activatedAt": "2026-06-02T09:15:00.000Z",
    "createdAt": "2026-06-01T14:22:10.004Z",
    "updatedAt": "2026-08-14T11:03:52.771Z"
  }
}`;

export const FLOW_PAGE_EXAMPLE = `{
  "data": [
    {
      "id": "d4e5f6a7-8b9c-4d0e-1f2a-3b4c5d6e7f80",
      "object": "flow",
      "name": "Welcome sequence",
      "kind": "email",
      "status": "active",
      "trigger": { "type": "list.joined", "config": { "listId": "b8c1…" } },
      "entryPolicy": "once",
      "steps": [ /* … */ ],
      "stepCount": 3,
      "runs": null,
      "activatedAt": "2026-06-02T09:15:00.000Z",
      "createdAt": "2026-06-01T14:22:10.004Z",
      "updatedAt": "2026-08-14T11:03:52.771Z"
    }
  ],
  "has_more": false,
  "next_cursor": null
}`;

export const FLOW_RUN_PAGE_EXAMPLE = `{
  "data": [
    {
      "id": "e7f8a9b0-1c2d-4e3f-8a5b-6c7d8e9f0a1b",
      "object": "flow_run",
      "flowId": "d4e5f6a7-8b9c-4d0e-1f2a-3b4c5d6e7f80",
      "contactId": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
      "email": "ada@example.com",
      "status": "waiting",
      "currentStep": "s-5e6f7a8b",
      "wakeAt": "2026-08-22T09:00:00.000Z",
      "attempt": 0,
      "enteredAt": "2026-08-20T09:00:04.118Z",
      "finishedAt": null,
      "lastError": null
    }
  ],
  "has_more": true,
  "next_cursor": "MjAyNi0wOC0yMFQwOTowMDowNC4xMThafGU3ZjhhOWIw"
}`;
