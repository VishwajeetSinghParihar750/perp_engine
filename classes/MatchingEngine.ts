import OrderBook, { type FILLS_INFO } from "./OrderBook.js";
import Balances from "./Balances.js";
import type { CURRENCY_SYMBOL, ORDER_ID, SIDE, TYPE } from "../types/order.js";
import { InsufficientBalanceError } from "./Errors/MatchingEngine.js";
import EventBus from "./EventBus.js";
import { getDefaultHighWaterMark } from "node:stream";
import { string } from "zod";

export default class MatchingEngine {
  private balances: Balances;
  private orderBook: OrderBook;

  private readonly minMarginRequired = 5;

  private debtForExchange = 0;

  private setupEventHandlers(eventBus: EventBus) {
    eventBus.on("users_pnl.updated", ({ type, data }) => {
      Object.entries(data as Record<string, number>).forEach(
        ([userId, pnl]) => {
          let bal = this.balances.getBalance(userId, "USD") as number;
          bal += pnl;
          this.debtForExchange += Math.abs(Math.min(0, bal));
          bal = Math.max(0, bal);

          if (pnl > 0) this.balances.addBalance(userId, "USD", pnl);
          else if (pnl < 0)
            this.balances.removeBalance(userId, "USD", Math.abs(pnl));
        },
      );
    });
  }

  constructor(eventBus: EventBus) {
    this.balances = new Balances();

    this.setupEventHandlers(eventBus);

    this.orderBook = new OrderBook(eventBus);
  }

  createOrder(
    type: TYPE,
    side: SIDE,
    symbol: CURRENCY_SYMBOL,
    qty: number,
    userId: string,
    price?: number,
  ): {
    status: "REJECTED" | "OPEN" | "FILLED";
    orderId?: ORDER_ID;
    fills?: FILLS_INFO;
  } {
    const initialUSDBalance = this.balances.getBalance(userId, "USD") as number;

    if (side == "BUY") {
      // check balance

      if (type == "LIMIT") {
        const neededBal = price! * qty;
        const availBal = this.balances.getBalance(userId, "USD") as number;

        if (neededBal > availBal) throw new InsufficientBalanceError();

        // deduct bidders balance
        this.balances.removeBalance(userId, "USD", neededBal);
      } else {
        if (initialUSDBalance == 0) throw new InsufficientBalanceError();
        // make his balance zero
        this.balances.removeBalance(userId, "USD", initialUSDBalance);
      }
    } else {
      // check balance
      const availBal = this.balances.getBalance(userId, symbol) as number;
      if (availBal < qty) throw new InsufficientBalanceError();

      // deduct askers balance
      this.balances.removeBalance(userId, symbol, qty);
    }

    // place order in orderbook, get back fills
    let { newOrderId, fillsInfo, totalFilledQuantity } =
      this.orderBook.createOrder(
        type,
        side,
        symbol,
        qty,
        userId,
        price,
        initialUSDBalance,
      );

    let usdSpent = 0;

    // update balances based on fills
    fillsInfo.forEach(
      ({ buyerId, sellerId, price, bidPrice, qty, symbol: filledSymbol }) => {
        // add and remove , coz there might be gap in bid and ask, and we dont want floating point errors, so return whole money first
        this.balances.addBalance(buyerId, "USD", bidPrice * qty - price * qty);

        this.balances.addBalance(buyerId, filledSymbol, qty);
        this.balances.addBalance(sellerId, "USD", price * qty);

        usdSpent += price * qty;
      },
    );

    // return back locked money of user for market bid...  MAYBE : ( maybe also keep locked money info in balances )
    if (type == "MARKET" && side == "BUY") {
      this.balances.addBalance(userId, "USD", initialUSDBalance - usdSpent);
    }
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
