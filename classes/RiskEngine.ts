import type { POSITION } from "../types/positions.js";
import {
  CURRENCY_SYMBOL_ARRAY,
  type CURRENCY_SYMBOL,
  type ORDER,
  type TYPE as ORDER_TYPE,
  type SIDE as ORDER_SIDE,
} from "../types/order.js";
import type OrderBook from "./OrderBook.js";

class RiskEngine {
  readonly orderbook;

  realExchagnePrices: Partial<Record<CURRENCY_SYMBOL, number>> = {};

  constructor(orderbook: OrderBook) {
    this.orderbook = orderbook;
  }

  getMarginRequired(order: {
    symbol: CURRENCY_SYMBOL;
    qty: number;
    type: ORDER_TYPE;
    side: ORDER_SIDE;
    price: number | undefined;
  }): number {
    return 0;
  }

  getLiquidationPrice(postition: POSITION): number {
    return 0;
  }
}

export default RiskEngine;
