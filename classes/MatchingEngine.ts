import OrderBook, { type FILLS_INFO } from "./OrderBook.js";
import Balances from "./Balances.js";
import type {
  CURRENCY_SYMBOL,
  MARGIN_TYPE,
  ORDER_ID,
  SIDE,
  TYPE,
} from "../types/order.js";
import EventBus from "./EventBus.js";
import PositionManager from "./PositionManager.js";
import RiskEngine from "./RiskEngine.js";
import LiquidationEngine from "./LiquidationEngine.js";

export default class MatchingEngine {
  private balances: Balances;
  private orderBook: OrderBook;
  private positionManager: PositionManager;
  private riskEngine: RiskEngine;
  private liquidationEngine: LiquidationEngine;

  private readonly MAX_LEVERAGE_ALLOWED = 5;

  private exchangeBalance = 0; // this wil be paid from exchagne insurance fund, if not available deleverage, so for now balance can go negative

  constructor(eventBus: EventBus) {
    this.balances = new Balances();
    this.orderBook = new OrderBook(eventBus);
    this.positionManager = new PositionManager();
    this.riskEngine = new RiskEngine(this.orderBook);
    this.liquidationEngine = new LiquidationEngine();
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
  ): {
    status: "REJECTED" | "OPEN" | "FILLED";
    orderId?: ORDER_ID;
    fills?: FILLS_INFO;
  } {
    // get initial balance
    const initialUSDBalance = this.balances.getBalance(userId, "USD") as number;

    // check and reduce balance for margin
    let marginNeeded = this.riskEngine.getMarginRequired({
      qty,
      side,
      symbol,
      type,
      price,
    });
    if (marginNeeded > margin) {
      return { status: "REJECTED" };
    }

    // lock margin
    this.balances.removeBalance(userId, "USD", margin);

    // place order in orderbook
    let { newOrderId, totalFilledQuantity, fills } = this.orderBook.createOrder(
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

    // update users positions based on placed order
    let { pnlUpdates: usersPnlUpdate, positionUpdates } =
      this.positionManager.applyFills(fills);

    // update users balance based on updated positions
    this.balances.applyUsersPnl(usersPnlUpdate);

    // return new order info
    return {
      status: totalFilledQuantity == qty ? "FILLED" : "OPEN",
      orderId: newOrderId,
      fills,
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
