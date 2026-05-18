import type { CURRENCY_SYMBOL, MARGIN_TYPE, POSITION_TYPE } from "../order.js";

type POSITION = {
  userId: string;
  price: number;
  qty: number;
  type: POSITION_TYPE;
  symbol: CURRENCY_SYMBOL;
  createdAt: Date;

  //  for perp
  liquidationPrice: number;
  margin: number;
  marginType: MARGIN_TYPE;
};
export type { POSITION };
