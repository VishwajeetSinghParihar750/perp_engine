import type { ORDERBOOK_EVENT } from "./orderbook.js";
import type { LIQUIDATION_EVENT } from "./liquidation.js";

type ENGINE_EVENT_TYPE = ORDERBOOK_EVENT | LIQUIDATION_EVENT;

interface ENGINE_EVENT {
  type: ENGINE_EVENT_TYPE;
  data: any;
}

export type { ENGINE_EVENT, ENGINE_EVENT_TYPE };
