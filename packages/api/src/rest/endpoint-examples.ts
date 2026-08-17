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
