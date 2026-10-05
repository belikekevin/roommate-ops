// The store is simulated: checkout is the app's own page at /cart/checkout ("Kevin's Market"), not an external API.
import { appUrl } from "./urls";

/** Link the Checkout button opens. Relative ("/cart/checkout") when APP_URL is unset. */
export const checkoutUrl = () => `${appUrl()}/cart/checkout`;
