import type { ENGINE_EVENT } from "./event.js";

type ORDERBOOK_EVENT =
  | "depth.updated.sol_usd"
  | "depth.updated.btc_usd"
  | "users_pnl.updated";

interface depthUpdated extends ENGINE_EVENT {
  type: "depth.updated.sol_usd" | "depth.updated.btc_usd";
  data: {
    updateOffset: number;
    updates: Record<number, number>;
  };
}

export type { depthUpdated, ORDERBOOK_EVENT };
