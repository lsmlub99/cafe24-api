# Monetization

## Overview

When building a ChatGPT app, developers are responsible for choosing how to monetize their experience. Today, the **recommended** and **generally available** approach is to use **external checkout**, where users complete purchases on the developer’s own domain. While current approval is limited to apps for physical goods purchases, we are actively working to support a wider range of commerce use cases.

We’re also enabling **Instant Checkout** in ChatGPT apps for select marketplace partners (beta), with plans to extend access to more marketplaces and physical-goods retailers over time. Until then, we recommend routing purchase flows to your standard external checkout.

## Recommended Monetization Approach

### ✅ External Checkout (recommended)

**External checkout** means directing users from ChatGPT to a **merchant-hosted checkout flow** on your own website or application, where you handle pricing, payments, subscriptions, and fulfillment.

This is the recommended approach for most developers building ChatGPT apps.

#### How it works

1. A user interacts with your app in ChatGPT.
2. Your app presents purchasable items, plans, or services (e.g., “Upgrade,” “Buy now,” “Subscribe”).
3. When the user decides to purchase, your app links or redirects them out of ChatGPT and to your external checkout flow.
4. Payment, billing, taxes, refunds, and compliance are handled entirely on your domain.
5. After purchase, the user can return to ChatGPT with confirmation or unlocked features.

### Instant Checkout in ChatGPT apps (private beta)



Instant Checkout is limited to select marketplaces today and is not available
  to all users.



The `requestCheckout` function lets your widget hand a checkout session to ChatGPT and let the host display payment options on your behalf. You prepare a checkout session (line items, totals, provider info), render it in your widget, then call `requestCheckout(session_data)` to open the Instant Checkout UI. When the user clicks buy, a token representing the selected payment method is sent to your MCP server via the `complete_checkout` tool call. You can use your PSP integration to collect payment using this token, and send back finalized order details as a response to the `complete_checkout` tool call.

### Flow at a glance

1. **Server prepares session**: An MCP tool returns checkout session data (session id, line items, totals, payment provider) in `structuredContent`.
2. **Widget previews cart**: The widget renders line items and totals so the user can confirm.
3. **Widget calls `requestCheckout`**: The widget invokes `requestCheckout(session_data)`. ChatGPT opens Instant Checkout, displays the amount to charge, and displays various payment methods.
4. **Server finalizes**: Once the user clicks the pay button, the widget calls back to your MCP via the `complete_checkout` tool call. The MCP tool returns the completed order, which will be returned back to widget as a response to `requestCheckout`.

## Checkout session

You are responsible for constructing the checkout session payload that the host will render. The exact values for certain fields such as `id` and `payment_provider` depend on your PSP (payment service provider) and commerce backend. In practice, your MCP tool should return:

- Line items and quantities the user is purchasing.
- Totals (subtotal, tax, discounts, fees, total) that match your backend calculations.
- Provider metadata required by your PSP integration.
- Legal and policy links (terms, refund policy, etc.).

## Widget: calling `requestCheckout` (ChatGPT Apps SDK capability)

The host provides `window.openai.requestCheckout`. Use it to open the Instant Checkout UI when the user initiates a purchase:

Example:

```tsx
async function handleCheckout(sessionJson: string) {
  const session = JSON.parse(sessionJson);

  if (!window.openai?.requestCheckout) {
    throw new Error("requestCheckout is not available in this host");
  }

  // Host opens the Instant Checkout UI.
  const order = await window.openai.requestCheckout({
    ...session,
    id: checkout_session_id, // Every unique checkout session should have a unique id
  });

  return order; // host returns the order payload
}
```

In your component, you might initiate this in a button click:

```tsx


{
    setIsLoading(true);
    try {
      const orderResponse = await handleCheckout(checkoutSessionJson);
      setOrder(orderResponse);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }}
>
  {isLoading ? "Loading..." : "Checkout"}


```

Here is a minimal example that shows the shape of a checkout request you pass to the host. Populate the `merchant_id` field with the value specified by your PSP:

```tsx
const checkoutRequest = {
  id: checkoutSessionId,
  payment_provider: {
    provider: "<PSP_NAME>",
    merchant_id: "<MERCHANT_ID>",
    supported_payment_methods: ["card", "apple_pay", "google_pay"],
  },
  status: "ready_for_payment",
  currency: "USD",
  totals: [
    {
      type: "total",
      display_text: "Total",
      amount: 330,
    },
  ],
  links: [
    { type: "terms_of_use", url: "<TERMS_OF_USE_URL>" },
    { type: "privacy_policy", url: "<PRIVACY_POLICY_URL>" },
  ],
  payment_mode: "live",
};

const response = await window.openai.requestCheckout(checkoutRequest);
```

Key points:

- `window.openai.requestCheckout(session)` opens the host checkout UI.
- The promise resolves with the order result or rejects on error/cancel.
- Render the session JSON so users can review what they’re paying for.
- Consult your PSP to get your PSP specific `merchant_id` value.

## MCP server: expose the `complete_checkout` tool

You can mirror this pattern and swap in your logic:

```py
@tool(description="")
async def complete_checkout(
    self,
    checkout_session_id: str,
    buyer: Buyer,
    payment_data: PaymentData,
) -> types.CallToolResult:
    return types.CallToolResult(
        content=[],
        structuredContent={
            "id": checkout_session_id,
            "status": "completed",
            "currency": "USD",
            "line_items": [
                {
                    "id": "line_item_1",
                    "item": {
                        "id": "item_1",
                        "quantity": 1,
                    },
                    "base_amount": 3000,
                    "discount": 0,
                    "subtotal": 3000,
                    "tax": 300,
                    "total": 3300,
                },
            ],
            "fulfillment_address": {
                "name": "Jane Customer",
                "line_one": "123 Main St",
                "line_two": "Apt 4B",
                "city": "San Francisco",
                "state": "CA",
                "country": "US",
                "postal_code": "94107",
                "phone_number": "+1 (555) 555-5555",
            },
            "fulfillment_options": [
                {
                    "id": "fulfillment_option_1",
                    "type": "shipping",
                    "title": "Standard shipping",
                    "subtitle": "3-5 business days",
                    "carrier": "USPS",
                    "earliest_delivery_time": "2026-02-24T15:00:00Z",
                    "latest_delivery_time": "2026-02-28T18:00:00Z",
                    "subtotal": 0,
                    "tax": 0,
                    "total": 0,
                },
            ],
            "fulfillment_option_id": "fulfillment_option_1",
            "totals": [
                {
                    "type": "items_base_amount",
                    "display_text": "Items subtotal",
                    "amount": 3000,
                },
                {
                    "type": "subtotal",
                    "display_text": "Subtotal",
                    "amount": 3000,
                },
                {
                    "type": "tax",
                    "display_text": "Tax",
                    "amount": 300,
                },
                {
                    "type": "total",
                    "display_text": "Total",
                    "amount": 3300,
                },
            ],
            "order": {
                "id": "order_id_123",
                "checkout_session_id": checkout_session_id,
                "permalink_url": "",
            },
        },
        _meta={META_SESSION_ID: "checkout-flow"},
        isError=False,
    )
```

Adapt this to:

- Integrate with your PSP to charge the payment method within `payment_data`.
- Persist the order in your backend.
- Return authoritative order/receipt data.
- Include `_meta.ui.resourceUri` if you want to render a confirmation widget (ChatGPT honors `_meta["openai/outputTemplate"]` as an optional compatibility alias).

Refer to the following PSP specific monetization guides for information on how to collect payments:

- [Stripe](https://docs.stripe.com/agentic-commerce/apps)
- [Adyen](https://docs.adyen.com/online-payments/agentic-commerce)
- [PayPal](https://docs.paypal.ai/growth/agentic-commerce/agent-ready)

## Error Handling

The `complete_checkout` tool call can send back messages of type `error`. Error messages with `code` set to `payment_declined` or `requires_3ds` will be displayed on the Instant Checkout UI. All other error messages will be sent back to the widget as a response to `requestCheckout`. The widget can display the error as desired.

## Test payment mode

You can set the value of the `payment_mode` field to `test` in the call to `requestCheckout`. This will present an Instant Checkout UI that accepts test cards (such as the 4242 test card). The resulting `token` within `payment_data` that is passed to the `complete_checkout` tool can be processed in the staging environment of your PSP. This allows you to test end-to-end flows without moving real funds.

Note that in test payment mode, you might have to set a different value for `merchant_id`. Refer to your PSP's monetization guide for more details.

## Implementation checklist

1. **Define your checkout session model**: include ids, payment_provider,
   line_items, totals, and legal links.
2. **Return the session from your MCP tool** in `structuredContent` alongside your widget template.
3. **Render the session in the widget** so users can review items, totals, and terms.
4. **Call `requestCheckout(session_data)`** on user action; handle the resolved order or error.
5. **Charge the user** by implementing the `complete_checkout` MCP tool which
   returns a response that follows the checkout spec.
6. **Test end-to-end** with realistic amounts, taxes, and discounts to ensure the host renders the totals you expect.