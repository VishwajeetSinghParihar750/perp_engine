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
import LiquidationEngine, {
  type LiquidationOrderInfo,
} from "./LiquidationEngine.js";
import MarkPriceObserver from "./MarkPriceObserver.js";

export default class Exchange {
  private balances: Balances;
  private orderBook: OrderBook;
  private positionManager: PositionManager;
  private liquidationEngine: LiquidationEngine;

  //actually balance locking is not needed in this coz order would go through, in multi threaded it wuold be needed
  private handleLiquidation = (order: LiquidationOrderInfo) => {
    // lock account for this user id , symbol
    let { symbol, userId, qty, side, type } = order;
    this.balances.lockAccount(userId, symbol);

    // place order
    this.createOrder(
      type,
      side,
      symbol,
      qty,
      userId,
      0,
      "ISOLATED",
      undefined,
      true,
    );

    // unlock account for this user id , symbol
    this.balances.unlockAccount(userId, symbol);
  };

  constructor(eventBus: EventBus) {
    new MarkPriceObserver(eventBus);
    this.balances = new Balances();
    this.orderBook = new OrderBook(eventBus);
    this.positionManager = new PositionManager();
    this.liquidationEngine = new LiquidationEngine(
      eventBus,
      this.handleLiquidation,
    );
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
    liquidation?: boolean,
  ): {
    status: "REJECTED" | "OPEN" | "FILLED";
    orderId?: ORDER_ID;
    fills?: FILLS_INFO;
  } {
    if (!liquidation) {
      // check if account locked
      if (this.balances.isAccountLocked(userId, symbol)) {
        return { status: "REJECTED" };
      }

      // get initial balance
      let initialUSDBalance = this.balances.getBalance(userId, "USD") as number;

      // check if have claimed margin
      if (margin > initialUSDBalance) {
        return { status: "REJECTED" };
      }

      // check and reduce balance for margin
      let marginNeeded = this.liquidationEngine.getMarginRequired({
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
    }

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
    );

    // update users positions based on placed order
    let { pnlUpdates: usersPnlUpdate, positionUpdates } =
      this.positionManager.applyFills(fills);

    // update users balance based on updated margin/pnl
    this.balances.applyUsersPnl(usersPnlUpdate);

    // change liquidation price for udpated positions
    this.liquidationEngine.applyPositionUpdates(positionUpdates);

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
      // try caneling
      const { status, order } = this.orderBook.cancelOrder(orderId);

      if (status == "NOT_CANCELLABLE") {
        return { status: "NOT_CANCELLABLE" };
      }

      const { filledQty, qty, margin, userId } = order!;

      if (filledQty == qty) {
        return { status: "ALREADY_FILLED" };
      }

      // if cancelled return margin locked still
      this.balances.addBalance(
        userId,
        "USD",
        (margin * (qty - filledQty)) / qty,
      );

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
