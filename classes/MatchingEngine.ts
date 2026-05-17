import OrderBook, { type FILLS_INFO } from "./OrderBook.js";
import Balances from "./Balances.js";
import type {
  CURRENCY_SYMBOL,
  MARGIN_TYPE,
  ORDER_ID,
  SIDE,
  TYPE,
} from "../types/order.js";
import { InsufficientBalanceError } from "./Errors/MatchingEngine.js";
import EventBus from "./EventBus.js";

export default class MatchingEngine {
  private balances: Balances;
  private orderBook: OrderBook;

  private readonly MAX_LEVERAGE_ALLOWED = 5;

  private exchangeBalance = 0; // this wil be paid from exchagne insurance fund, if not available deleverage, so for now balance can go negative

  constructor(eventBus: EventBus) {
    this.balances = new Balances();
    this.orderBook = new OrderBook(eventBus);
  }

  createOrder(
    type: TYPE,
    side: SIDE,
    symbol: CURRENCY_SYMBOL,
    qty: number,

    userId: string,
    margin: number,
    marginType: MARGIN_TYPE,
    price?: number,
    maxMarketBidSpend?: number,
  ): {
    status: "REJECTED" | "OPEN" | "FILLED";
    orderId?: ORDER_ID;
    fills?: FILLS_INFO;
  } {
    const initialUSDBalance = this.balances.getBalance(userId, "USD") as number;

    // check and reduce balance for margin
    if (price) {
      let marginNeeded = (price * qty) / this.MAX_LEVERAGE_ALLOWED;
    }

    // place order in orderbook, get back fills
    let { newOrderId, usersPnlUpdate, totalFilledQuantity } =
      this.orderBook.createOrder(
        type,
        side,
        symbol,
        qty,
        userId,
        margin,
        marginType,
        price,
        initialUSDBalance,
      );

    Object.entries(usersPnlUpdate).forEach(([userId, pnl]) => {
      let ogBal = this.balances.getBalance(userId, "USD") as number;
      this.exchangeBalance += Math.min(0, ogBal + pnl);

      if (pnl > 0) this.balances.addBalance(userId, "USD", pnl);
      else
        this.balances.removeBalance(
          userId,
          "USD",
          Math.min(ogBal, Math.abs(pnl)),
        );
    });

    // return new order info
    return {
      status: totalFilledQuantity == qty ? "FILLED" : "OPEN",
      orderId: newOrderId,
      fills: fillsInfo,
    };
  }

  cancelOrder(orderId: ORDER_ID): {
    status: "CANCELLED" | "ALREADY_FILLED" | "NOT_CANCELLABLE";
  } {
    try {
      // try cancelling order
      // get pendign fills and abort it
      const { status, order } = this.orderBook.cancelOrder(orderId);

      if (status == "NOT_CANCELLABLE") {
        return { status: "NOT_CANCELLABLE" };
      }

      const { filledQuantity, totalQuantity, price, side, userId, symbol } =
        order!;

      if (filledQuantity == totalQuantity) {
        return { status: "ALREADY_FILLED" };
      }

      // return back balances
      if (side == "BUY") {
        this.balances.addBalance(
          userId,
          "USD",
          totalQuantity * price - filledQuantity * price,
        );
      } else {
        this.balances.addBalance(
          userId,
          symbol,
          totalQuantity - filledQuantity,
        );
      }
      return {
        status: "CANCELLED",
      };
    } catch (error) {
      // if order doesnt exist etc, or already filled
      // would have to see some error handling here , maybe we need entity baesd errors like ordererror, balanceerror isntead of class based
      throw error;
    }
  }

  getOrder(orderId: ORDER_ID) {
    return this.orderBook.getOrder(orderId);
  }

  getBalance(userId: string, symbol: CURRENCY_SYMBOL) {
    return this.balances.getBalance(userId, symbol);
  }
  addBalance(userId: string, amount: number, symbol: CURRENCY_SYMBOL) {
    // u can only deposit usd
    this.balances.addBalance(userId, symbol, amount);
  }
  getDepth(symbol: CURRENCY_SYMBOL) {
    return this.orderBook.getDepth(symbol);
  }
  getOrders(symbol: CURRENCY_SYMBOL) {
    return this.orderBook.getOrders(symbol);
  }
  getFills() {
    return this.orderBook.fills;
  }
}

// TODO : setup event handler for events, which will push to common event bus , which wil push to redis
