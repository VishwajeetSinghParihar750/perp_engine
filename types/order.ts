const CURRENCY_SYMBOL_ARRAY = ["USD", "SOL", "ETH", "BTC"] as const;
type CURRENCY_SYMBOL = (typeof CURRENCY_SYMBOL_ARRAY)[number];
type TYPE = "LIMIT" | "MARKET";
type SIDE = "BUY" | "SELL";
type ORDER_ID = string;

type MARGIN_TYPE = "ISOLATED" | "CROSS";
type ORDER_STATUS = "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED";

type POSITION_TYPE = "SHORT" | "LONG";

type ORDER = {
  userId: string;
  price: number;
  qty: number;
  side: SIDE;
  symbol: CURRENCY_SYMBOL;
  type: TYPE;
  filledQty: number;
  orderId: string;
  createdAt: Date;

  //  for perp
  margin: number;
  marginType: MARGIN_TYPE;
  status: ORDER_STATUS;
};

export type {
  CURRENCY_SYMBOL,
  TYPE,
  SIDE,
  ORDER_ID,
  MARGIN_TYPE,
  ORDER_STATUS,
  POSITION_TYPE,
  ORDER,
};
export { CURRENCY_SYMBOL_ARRAY };
