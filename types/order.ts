const CURRENCY_SYMBOL_ARRAY = ["USD", "SOL", "ETH", "BTC"] as const;
type CURRENCY_SYMBOL = (typeof CURRENCY_SYMBOL_ARRAY)[number];
type TYPE = "LIMIT" | "MARKET";
type SIDE = "BUY" | "SELL";
type ORDER_ID = string;

export type { CURRENCY_SYMBOL, TYPE, SIDE, ORDER_ID };
export { CURRENCY_SYMBOL_ARRAY };
