// Cart tools: thin wrappers over services/cart. Buttons go through the outbox (never pasted URLs).
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { cart } from "@/services";
import type { Ctx } from "@/services/types";
import { dollars } from "@/services/types";
import type { ToolOutbox } from "./index";
import { dashboardUrl, isAbsoluteUrl, memberIdByName, pushButton, toCents } from "./util";

export const cartTools = (ctx: Ctx, outbox: ToolOutbox) => ({
  cart_add: createTool({
    id: "cart_add",
    description:
      "Add grocery items to the shared cart, attributed to the sender ('add 3 bags of chips for me' -> one item, name 'chips', qty '3 bags'). shared=true for household items (toilet paper, dish soap). Returns addedTotal (just these items) and cartTotal (the whole open cart). View-cart and Checkout buttons are attached automatically; don't paste URLs.",
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            name: z.string().min(1).describe("Item name without the quantity, e.g. 'chips'"),
            qty: z.string().optional().describe("Free text quantity, e.g. '3 bags', '2', '1 gallon'. Omit for 1."),
          }),
        )
        .min(1),
      shared: z.boolean().optional().describe("true when it's for the whole house, not one person"),
    }),
    execute: async (input) => {
      const items = await cart.addItems(ctx, input);
      pushButton(outbox, "🛒 View cart", dashboardUrl("/cart"));
      pushButton(outbox, "Checkout", dashboardUrl("/cart/checkout"));
      const open = await cart.listOpenItems(ctx);
      const addedTotalCents = cart.cartTotal(items);
      const cartTotalCents = cart.cartTotal(open);
      return {
        items,
        addedTotalCents,
        addedTotal: dollars(addedTotalCents),
        cartItemCount: open.length,
        cartTotalCents,
        cartTotal: dollars(cartTotalCents),
      };
    },
  }),
  cart_remove: createTool({
    id: "cart_remove",
    description: "Remove an item from the open cart by name (case-insensitive).",
    inputSchema: z.object({ name: z.string().min(1) }),
    execute: async (input) => ({ removed: await cart.removeItem(ctx, input) }),
  }),
  cart_view: createTool({
    id: "cart_view",
    description: "Show the open cart grouped by who added each item, with estimated prices and the estimated total.",
    inputSchema: z.object({}),
    execute: async () => {
      const groups = await cart.viewCart(ctx);
      const all = Object.values(groups).flat();
      if (all.length) pushButton(outbox, "🛒 View cart", dashboardUrl("/cart"));
      const estTotalCents = cart.cartTotal(all);
      return { groups, itemCount: all.length, estTotalCents, estTotal: dollars(estTotalCents) };
    },
  }),
  cart_checkout: createTool({
    id: "cart_checkout",
    description:
      "Open the store checkout (Kevin's Market, a simulated store: nothing is really bought) for the open cart. A Checkout button with the link is attached automatically; don't paste the URL.",
    inputSchema: z.object({}),
    execute: async () => {
      const res = await cart.checkout(ctx);
      // Telegram needs an absolute link; res.url is relative when APP_URL is unset and null when the cart is empty.
      const linkAttached = isAbsoluteUrl(res.url);
      if (linkAttached) pushButton(outbox, "Checkout", res.url);
      const estTotalCents = cart.cartTotal(res.items);
      // No url in the result on purpose: the model must not paste it; the button carries the link.
      return { items: res.items, itemCount: res.items.length, estTotalCents, estTotal: dollars(estTotalCents), linkAttached };
    },
  }),
  cart_purchased: createTool({
    id: "cart_purchased",
    description:
      "Someone bought the cart for a total ('I bought the groceries, $84'). Creates one expense split by who added what (shared items split evenly) and clears the cart. Default payer = sender.",
    inputSchema: z.object({
      total: z.number().positive().describe("Dollars, e.g. 84.2"),
      payer: z.string().optional().describe("Who paid, by first name. Omit for the sender."),
    }),
    execute: async ({ total, payer }) =>
      cart.markPurchased(ctx, { totalCents: toCents(total), payerId: payer ? await memberIdByName(ctx, payer) : undefined }),
  }),
});
