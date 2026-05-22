import type { CURRENCY_SYMBOL } from "../order.js";
import type { ENGINE_EVENT } from "./event.js";

type LIQUIDATION_EVENT =
  | "markprice.updated"
  | "liquidation.started"
  | "liquidation.completed";
interface markPriceUpdated extends ENGINE_EVENT {
  type: "markprice.updated";
  data: any;
}
interface liquidationStarted extends ENGINE_EVENT {
  type: "liquidation.started";
  data: {
    userId: string;
    symbol: CURRENCY_SYMBOL;
  };
}
interface liquidationCompleted extends ENGINE_EVENT {
  type: "liquidation.completed";
  data: {
    userId: string;
    symbol: CURRENCY_SYMBOL;
    pnl: number;
  };
}

export type {
  markPriceUpdated,
  liquidationStarted,
  liquidationCompleted,
  LIQUIDATION_EVENT,
};
