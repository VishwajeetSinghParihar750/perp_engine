import type { CURRENCY_SYMBOL, MARGIN_TYPE, POSITION_TYPE } from "./order.js";

type POSITION = {
  positionId: string;
  userId: string;
  price: number;
  qty: number;
  type: POSITION_TYPE;
  symbol: CURRENCY_SYMBOL;
  createdAt: Date;

  //  for perp
  margin: number;
  marginType: MARGIN_TYPE;
};

type POSITION_UPDATES = Record<
  string,
  Partial<Record<CURRENCY_SYMBOL, POSITION>>
>;

export type { POSITION, POSITION_UPDATES };
