import type { ORDERBOOK_EVENT } from "./orderbook.js";
import type { MARK_PRICE_EVENT } from "./markPrice.js";

type ENGINE_EVENT_TYPE = ORDERBOOK_EVENT | MARK_PRICE_EVENT;

interface ENGINE_EVENT {
  type: ENGINE_EVENT_TYPE;
  data: any;
}

export type { ENGINE_EVENT, ENGINE_EVENT_TYPE };
