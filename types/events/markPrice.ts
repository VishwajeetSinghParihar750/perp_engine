import type { ENGINE_EVENT } from "./event.js";

type MARK_PRICE_EVENT = "markprice.udpates";
interface markPriceUpdated extends ENGINE_EVENT {
  type: MARK_PRICE_EVENT;
  data: {};
}
export type { markPriceUpdated, MARK_PRICE_EVENT };
