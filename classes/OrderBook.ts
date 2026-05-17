import { OrderedMap, LinkList } from "js-sdsl";
import {
  CURRENCY_SYMBOL_ARRAY,
  type CURRENCY_SYMBOL,
  type ORDER_ID,
  type SIDE,
  type TYPE,
} from "../types/order.js";
import { assert } from "node:console";
import type { ENGINE_EVENT } from "../types/events/event.js";
import type EventBus from "./EventBus.js";

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

type PRICE_LEVEL = { totalQuantity: number; orders: LinkList<ORDER> };

type FILL_INFO = {
  fillId: string;
  symbol: CURRENCY_SYMBOL;
  qty: number;
  price: number;
  bidPrice: number;

  sellOrderInfo: {
    sellerId: string;
    orderId: string;
    totalQty: number;
    margin: number;
    marginType: MARGIN_TYPE;
  };
  buyOrderInfo: {
    buyerId: string;
    orderId: string;
    totalQty: number;
    margin: number;
    marginType: MARGIN_TYPE;
  };
};

export type FILLS_INFO = FILL_INFO[];
type DEPTH = { price: number; quantity: number }[];

type ORDERBOOK = Partial<
  Record<
    CURRENCY_SYMBOL,
    {
      BIDS: OrderedMap<number, PRICE_LEVEL>;
      ASKS: OrderedMap<number, PRICE_LEVEL>;
    }
  >
>;

// TODO : separate isolated and cross margin, they cant be merged together, that means
// you can have two positions at same price, one - isolated , one - cross

// INFO : cross margin has dynamic liquidation price, that we dont have to do right now, just do isolated right now

export default class OrderBook {
  orderBook: ORDERBOOK = {};
  orders: Record<ORDER_ID, ORDER> = {}; // here keep ref of item in orderbook, to not double memeory

  fills: Record<string, FILL_INFO> = {};

  eventBus: EventBus;
  depthUpdateOffset: Map<CURRENCY_SYMBOL, number>;

  // new for perp (just for isolated right now)
  liquidPositions: Partial<
    Record<
      CURRENCY_SYMBOL,
      Record<POSITION_TYPE, OrderedMap<number, Set<POSITION>>>
    >
  > = {}; // this is per symbol per liquidation_price positions

  // just isolated
  isolatedPositions: Record<
    string,
    Partial<Record<CURRENCY_SYMBOL, Record<number, POSITION>>>
  > = {}; // this is per user per symbol per price positions

  // todo
  private placeMarketBuyOrder = (
    currentOrder: ORDER,
    maxMarketBidSpend: number,
  ) => {
    const { symbol, side } = currentOrder;
    if (!this.orderBook[symbol]) {
      this.orderBook[symbol] = {
        ASKS: new OrderedMap(),
        BIDS: new OrderedMap(),
      };
    }

    // emit depth update events
    //  find depthUpdateInfo

    let depthUpdates: {
      asks: Map<number, number>;
      bids: Map<number, number>;
    } = {
      asks: new Map(),
      bids: new Map(),
    };

    let fillsToReturn: FILLS_INFO = [];

    let oppositeSideOrders = this.orderBook[symbol].ASKS;

    // try matching as much possible
    while (
      !oppositeSideOrders.empty() &&
      currentOrder.filledQty < currentOrder.qty &&
      maxMarketBidSpend > 0
    ) {
      let [topOppositeSidePrice, topOppositeSidePriceLevel] =
        oppositeSideOrders.front()!;

      let orders = topOppositeSidePriceLevel.orders;

      assert(!orders.empty()); // if oders is empty then it should not be in oppositeSideOrders

      while (currentOrder.filledQty < currentOrder.qty) {
        let frontOrder = orders.front();
        let pendingQty = frontOrder!.qty - frontOrder!.filledQty;

        let maxExchangeQty = Math.min(
          currentOrder.qty - currentOrder.filledQty,
          pendingQty,
        );

        // TODO : HANDLE FLOATING POINT ERRORS HERE COZ OF DIVIDING
        let toExchangeQty = Math.min(
          maxExchangeQty,
          maxMarketBidSpend / frontOrder!.price,
        );

        fillsToReturn.push({
          fillId: crypto.randomUUID(),
          bidPrice: frontOrder!.price,
          buyerId: userId,
          sellerId: frontOrder!.userId,
          price: frontOrder!.price,
          qty: toExchangeQty,
          symbol,
        });

        frontOrder!.filledQty += toExchangeQty;
        currentOrder.filledQty += toExchangeQty;
        topOppositeSidePriceLevel.totalQuantity -= toExchangeQty;

        // update depthUpdates for opposite side, current side does not change orderbook on same side
        depthUpdates[side == "BUY" ? "asks" : "bids"].set(
          topOppositeSidePrice,
          topOppositeSidePriceLevel.totalQuantity,
        );

        if (frontOrder!.filledQty == frontOrder!.qty) {
          // remove from orders and orderbook
          delete this.orders[frontOrder!.orderId];
          orders.popFront();
        }

        if (maxExchangeQty > toExchangeQty) {
          maxMarketBidSpend = 0;
          break;
        } else maxMarketBidSpend -= frontOrder!.price * toExchangeQty;
      }

      if (orders.empty()) {
        oppositeSideOrders.eraseElementByKey(topOppositeSidePrice);
      }
    }

    // save fills

    fillsToReturn.forEach((fill) => {
      this.fills[fill.fillId] = fill;
    });

    this.emitDepthUpdateEvents(symbol, depthUpdates);

    return {
      fillsInfo: fillsToReturn,
      newOrderId: currentOrder.orderId,
      totalFilledQuantity: currentOrder.filledQty,
    };
  };

  // todo
  private placeMarketSellOrder = (currentOrder: ORDER) => {
    const { symbol, side, userId } = currentOrder;

    if (!this.orderBook[symbol]) {
      this.orderBook[symbol] = {
        ASKS: new OrderedMap(),
        BIDS: new OrderedMap(),
      };
    }

    // emit depth update events
    //  find depthUpdateInfo

    let depthUpdates: {
      asks: Map<number, number>;
      bids: Map<number, number>;
    } = {
      asks: new Map(),
      bids: new Map(),
    };

    let fillsToReturn: FILLS_INFO = [];

    let oppositeSideOrders = this.orderBook[symbol].BIDS;

    // try matching as much possible
    while (
      !oppositeSideOrders.empty() &&
      currentOrder.filledQty < currentOrder.qty
    ) {
      let [topOppositeSidePrice, topOppositeSidePriceLevel] =
        oppositeSideOrders.front()!;

      let orders = topOppositeSidePriceLevel.orders;

      assert(!orders.empty());

      while (currentOrder.filledQty < currentOrder.qty) {
        let frontOrder = orders.front();
        let pendingQty = frontOrder!.qty - frontOrder!.filledQty;

        let toExchangeQty = Math.min(
          currentOrder.qty - currentOrder.filledQty,
          pendingQty,
        );

        fillsToReturn.push({
          fillId: crypto.randomUUID(),
          bidPrice: Math.max(frontOrder!.price, currentOrder.price),
          sellerId: userId,
          buyerId: frontOrder!.userId,
          price: Math.min(frontOrder!.price, currentOrder.price),
          qty: toExchangeQty,
          symbol,
          prevBuyOrderFilledQty:
            side == "BUY" ? currentOrder.filledQty : frontOrder!.filledQty,
          prevSellOrderFilledQty:
            side == "SELL" ? currentOrder.filledQty : frontOrder!.filledQty,
          buyOrderId:
            side == "BUY" ? currentOrder.orderId : frontOrder!.orderId,
          sellOrderId:
            side == "SELL" ? currentOrder.orderId : frontOrder!.orderId,
        });

        frontOrder!.filledQty += toExchangeQty;
        currentOrder.filledQty += toExchangeQty;
        topOppositeSidePriceLevel.totalQuantity -= toExchangeQty;

        // update depthUpdates for opposite side, current side does not change orderbook on same side
        depthUpdates[side == "BUY" ? "asks" : "bids"].set(
          topOppositeSidePrice,
          topOppositeSidePriceLevel.totalQuantity,
        );

        if (frontOrder!.filledQty == frontOrder!.qty) {
          // remove from orders and orderbook
          delete this.orders[frontOrder!.orderId];
          orders.popFront();
        }
      }
      if (orders.empty()) {
        oppositeSideOrders.eraseElementByKey(topOppositeSidePrice);
      }
    }

    fillsToReturn.forEach((fill) => {
      this.fills[fill.fillId] = fill;
    });
    //
    this.updateFillsAndPositions(fillsToReturn);

    this.emitDepthUpdateEvents(symbol, depthUpdates);

    return {
      fillsInfo: fillsToReturn,
      newOrderId: currentOrder.orderId,
      totalFilledQuantity: currentOrder.filledQty,
    };
  };

  private emitDepthUpdateEvents(symbol: CURRENCY_SYMBOL, depthUpdates: any) {
    //  emit depthUpdateEvent on  eventBus
    //  maintain depthUpdateOffset
    switch (symbol) {
      case "BTC":
        this.emitEvent({
          type: "depth.updated.btc_usd",
          data: {
            updateOffset: this.depthUpdateOffset.get(symbol),
            updates: depthUpdates,
          },
        });

        break;

      case "SOL":
        this.emitEvent({
          type: "depth.updated.sol_usd",
          data: {
            updateOffset: this.depthUpdateOffset.get(symbol),
            updates: depthUpdates,
          },
        });
        break;

      default:
        return; //
    }

    this.depthUpdateOffset.set(symbol, this.depthUpdateOffset.get(symbol)! + 1);
  }

  private updateLiquidationPrice = (position: POSITION) => {
    const liqudiationLevel = 0.95; // at 5% margin left , liquidate

    const { margin, marginType, qty, price } = position;

    if (marginType == "ISOLATED") {
      const moneyDelta = margin * liqudiationLevel * -1;
      let liquidPrice = price + moneyDelta / qty;

      position.liquidationPrice = liquidPrice;
    } else {
      // TODO
    }
  };
  private updateFillsAndPositions(fills: FILLS_INFO) {
    // there can be position updates at diff price levels for a single user
    // so keep seller id map to orderid to updates
    let positionUpdates: Record<
      string,
      Record<
        string,
        {
          positionUpdatePriceQtyProduct: number;
          positionUpdateQty: number;
          symbol: CURRENCY_SYMBOL;
          totalQty: number;
          margin: number;
          marginType: MARGIN_TYPE;
        }
      >
    > = {};

    // save fills and get positon updates
    fills.forEach((fill) => {
      this.fills[fill.fillId] = fill;

      const { buyOrderInfo, sellOrderInfo, price, symbol, qty } = fill;

      const { buyerId, orderId: buyOrderId } = buyOrderInfo;
      const { sellerId, orderId: sellOrderId } = sellOrderInfo;

      if (!positionUpdates[buyerId])
        positionUpdates[buyerId] = {
          buyOrderId: {
            positionUpdatePriceQtyProduct: 0,
            positionUpdateQty: 0,
            margin: buyOrderInfo.margin,
            marginType: buyOrderInfo.marginType,
            totalQty: buyOrderInfo.totalQty,
            symbol,
          },
        };
      if (!positionUpdates[sellerId])
        positionUpdates[sellerId] = {
          sellOrderId: {
            positionUpdatePriceQtyProduct: 0,
            positionUpdateQty: 0,
            margin: sellOrderInfo.margin,
            marginType: sellOrderInfo.marginType,
            totalQty: sellOrderInfo.totalQty,
            symbol,
          },
        };

      positionUpdates[buyerId][buyOrderId]!.positionUpdatePriceQtyProduct +=
        price * qty;
      positionUpdates[buyerId][buyOrderId]!.positionUpdateQty += qty;

      positionUpdates[sellerId][sellOrderId]!.positionUpdatePriceQtyProduct -=
        price * qty;
      positionUpdates[sellerId][sellOrderId]!.positionUpdateQty -= qty;
    });

    // give out partial margin to diff price positions from order
    // and update positions, liquid positions

    for (const [userId, orderUpdates] of Object.entries(positionUpdates)) {
      for (const [
        _,
        {
          positionUpdatePriceQtyProduct,
          positionUpdateQty,
          symbol,
          totalQty: totalOrderQty,
          margin,
          marginType,
        },
      ] of Object.entries(orderUpdates)) {
        let weighedAvgPrice = positionUpdatePriceQtyProduct / positionUpdateQty;
        let newPosition =
          this.isolatedPositions[userId]?.[symbol]?.[weighedAvgPrice];

        let prevLiquidationPrice = newPosition?.liquidationPrice;
        let prevPositionType = newPosition?.type;

        let filledRecentQty = Math.abs(positionUpdateQty);

        // doing partial margin filling for diff price positions made by same order

        if (!newPosition) {
          newPosition = {
            createdAt: new Date(),
            margin: (margin * filledRecentQty) / totalOrderQty,
            marginType: marginType,
            price: weighedAvgPrice,
            qty: Math.abs(positionUpdateQty),
            symbol: symbol,
            type: positionUpdateQty >= 0 ? "LONG" : "SHORT",
            userId,
            liquidationPrice: 0, // TODO : calculate liquidation price later
          };
        } else {
          // here
          newPosition.margin += (margin * filledRecentQty) / totalOrderQty;
          newPosition.qty += Math.abs(positionUpdateQty);
          newPosition.type = newPosition.qty >= 0 ? "LONG" : "SHORT";
          newPosition.marginType = marginType;
          newPosition.liquidationPrice = 0;
          // TODO : calculate liquidation price later
          newPosition.symbol;
        }

        this.updateLiquidationPrice(newPosition);

        // update positions

        if (newPosition.qty == 0) {
          // remove from positions
          delete this.isolatedPositions[userId]?.[symbol]?.[weighedAvgPrice];
        } else {
          if (!this.isolatedPositions[userId]) {
            this.isolatedPositions[userId] = {};
          }
          if (!this.isolatedPositions[userId][symbol]) {
            this.isolatedPositions[userId][symbol] = {};
          }
          if (!this.isolatedPositions[userId][symbol]![weighedAvgPrice])
            this.isolatedPositions[userId]![symbol]![weighedAvgPrice] =
              newPosition;
        }

        let liquidationPrice = newPosition.liquidationPrice;

        // rmeove from old liqid level if there
        if (prevLiquidationPrice && prevPositionType) {
          // then we need to remove from old liquid Position price
          this.liquidPositions?.[symbol]?.[prevPositionType]
            ?.getElementByKey(prevLiquidationPrice)
            ?.delete(newPosition); // this delets by ref ,so does not matter if its updated newPosition
          //
        }

        // put into new liquid level
        if (newPosition.qty != 0) {
          if (!this.liquidPositions[symbol]) {
            this.liquidPositions[symbol] = {
              LONG: new OrderedMap(),
              SHORT: new OrderedMap(),
            };
          }
          let liquidLevel =
            this.liquidPositions[symbol]![newPosition.type]?.getElementByKey(
              liquidationPrice,
            ) || new Set<POSITION>();
          liquidLevel.add(newPosition);

          this.liquidPositions[symbol]![newPosition.type].setElement(
            liquidationPrice,
            liquidLevel,
          );
        }
      }
    }
  }

  private placeLimitOrder = (currentOrder: ORDER) => {
    let { symbol, side, userId, price } = currentOrder;

    if (!this.orderBook[symbol]) {
      this.orderBook[symbol] = {
        ASKS: new OrderedMap(),
        BIDS: new OrderedMap(),
      };
    }

    // emit depth update events
    //  find depthUpdateInfo

    let depthUpdates: {
      asks: Map<number, number>;
      bids: Map<number, number>;
    } = {
      asks: new Map(),
      bids: new Map(),
    };

    let fillsToReturn: FILLS_INFO = [];

    let oppositeSideOrders;
    if (side == "BUY") oppositeSideOrders = this.orderBook[symbol].ASKS;
    else oppositeSideOrders = this.orderBook[symbol].BIDS;

    // do for weighed avg price
    let quantityPriceProductSum = 0;

    // try matching as much possible
    while (
      !oppositeSideOrders.empty() &&
      currentOrder.filledQty < currentOrder.qty
    ) {
      let [topOppositeSidePrice, topOppositeSidePriceLevel] =
        oppositeSideOrders.front()!;

      let orders = topOppositeSidePriceLevel.orders;

      if (
        side == "BUY"
          ? topOppositeSidePrice <= currentOrder.price
          : topOppositeSidePrice >= currentOrder.price
      ) {
        while (currentOrder.filledQty < currentOrder.qty && !orders.empty()) {
          let frontOrder = orders.front();
          let pendingQty = frontOrder!.qty - frontOrder!.filledQty;

          let toExchangeQty = Math.min(
            currentOrder.qty - currentOrder.filledQty,
            pendingQty,
          );

          let exchangePrice = Math.min(frontOrder!.price, currentOrder.price);

          quantityPriceProductSum += exchangePrice * toExchangeQty;

          fillsToReturn.push({
            buyOrderInfo: {
              buyerId: side == "BUY" ? userId : frontOrder!.userId,
              margin: side == "BUY" ? currentOrder.margin : frontOrder!.margin,
              marginType:
                side == "BUY"
                  ? currentOrder.marginType
                  : frontOrder!.marginType,
              orderId:
                side == "BUY" ? currentOrder.orderId : frontOrder!.orderId,
              totalQty: side == "BUY" ? currentOrder.qty : frontOrder!.qty,
            },

            sellOrderInfo: {
              sellerId: side == "SELL" ? userId : frontOrder!.userId,
              margin: side == "SELL" ? currentOrder.margin : frontOrder!.margin,
              marginType:
                side == "SELL"
                  ? currentOrder.marginType
                  : frontOrder!.marginType,
              orderId:
                side == "SELL" ? currentOrder.orderId : frontOrder!.orderId,
              totalQty: side == "SELL" ? currentOrder.qty : frontOrder!.qty,
            },

            fillId: crypto.randomUUID(),
            bidPrice: Math.max(frontOrder!.price, currentOrder.price),
            price: exchangePrice,
            qty: toExchangeQty,
            symbol,
          });

          frontOrder!.filledQty += toExchangeQty;
          currentOrder.filledQty += toExchangeQty;
          topOppositeSidePriceLevel.totalQuantity -= toExchangeQty;

          // update depthUpdates for opposite side, current side update will happen with this pending order in end
          depthUpdates[side == "BUY" ? "asks" : "bids"].set(
            topOppositeSidePrice,
            topOppositeSidePriceLevel.totalQuantity,
          );

          if (frontOrder!.filledQty == frontOrder!.qty) {
            // remove from orders and orderbook
            delete this.orders[frontOrder!.orderId];
            orders.popFront();
          }
        }
        if (orders.empty()) {
          oppositeSideOrders.eraseElementByKey(topOppositeSidePrice);
        }
      } else break;
    }

    // for limit order
    // sit on orderbook for pending order
    if (currentOrder.filledQty < currentOrder.qty) {
      // put into orders object
      currentOrder.status =
        currentOrder.filledQty == 0 ? "OPEN" : "PARTIALLY_FILLED";

      this.orders[currentOrder.orderId] = currentOrder;

      let prevPriceLevel: PRICE_LEVEL;

      if (side == "BUY")
        prevPriceLevel = this.orderBook[symbol].BIDS.getElementByKey(price) || {
          totalQuantity: 0,
          orders: new LinkList(),
        };
      else
        prevPriceLevel = prevPriceLevel = this.orderBook[
          symbol
        ].ASKS.getElementByKey(price) || {
          totalQuantity: 0,
          orders: new LinkList(),
        };

      prevPriceLevel.totalQuantity += currentOrder.qty - currentOrder.filledQty;
      prevPriceLevel.orders.pushFront(currentOrder);

      // put into orderbook object
      if (side == "BUY") {
        this.orderBook[symbol].BIDS.setElement(price, prevPriceLevel);
      } else this.orderBook[symbol].ASKS.setElement(price, prevPriceLevel);

      // update depthUpdates
      depthUpdates[side == "BUY" ? "bids" : "asks"].set(
        price,
        prevPriceLevel.totalQuantity,
      );
    } else {
      currentOrder.status = "FILLED";
      // todo : maybe send to db or whatever, dont wanna keep filled orders in memory
    }

    // put into fills , liquidPrices , positions
    this.updateFillsAndPositions(fillsToReturn);

    //emit dpth udpate events
    this.emitDepthUpdateEvents(symbol, depthUpdates);

    return {
      fillsInfo: fillsToReturn,
      newOrderId: currentOrder.orderId,
      totalFilledQuantity: currentOrder.filledQty,
    };
  };

  emitEvent(event: ENGINE_EVENT) {
    this.eventBus.emit(event);
  }

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.depthUpdateOffset = new Map();
    CURRENCY_SYMBOL_ARRAY.forEach((cur) => {
      this.depthUpdateOffset.set(cur, 0);
    });
  }

  // todo
  createOrder = (
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
    newOrderId: ORDER_ID;
    totalFilledQuantity: number;
    fillsInfo: FILLS_INFO;
  } => {
    let toReturn;

    let currentOrder: ORDER = {
      createdAt: new Date(),
      filledQty: 0,
      orderId: crypto.randomUUID(),
      price: price || 0,
      qty: qty,
      userId: userId,
      side,
      type,
      symbol,
      margin,
      marginType,
      status: "OPEN",
    };

    if (type == "MARKET") {
      if (side == "BUY")
        toReturn = this.placeMarketBuyOrder(currentOrder, maxMarketBidSpend);
      else toReturn = this.placeMarketSellOrder(currentOrder);
    } else {
      toReturn = this.placeLimitOrder(currentOrder);
    }

    toReturn.fillsInfo.forEach((fillInfo) => {
      this.orderBook[fillInfo.symbol]?.ASKS.getElementByKey(fillInfo.price)
        ?.totalQuantity;

      this.orderBook[fillInfo.symbol]?.ASKS.getElementByKey(fillInfo.price)
        ?.totalQuantity;
    });

    return toReturn;
  };

  // todo
  cancelOrder = (
    orderId: ORDER_ID,
  ): {
    status: "NOT_CANCELLABLE" | "CANCELLED";
    order?: {
      filledQuantity: number;
      totalQuantity: number;
      price: number;
      side: SIDE;
      userId: string;
      symbol: CURRENCY_SYMBOL;
    };
  } => {
    //
    if (this.orders[orderId]) {
      // means its in order book right now
      let currentOrder = this.orders[orderId];
      let pendingQty = currentOrder.qty - currentOrder.filledQty;

      // remove from order object
      delete this.orders[orderId];

      //remove from orderbook
      let priceLevel;
      if (currentOrder.side == "BUY")
        priceLevel = this.orderBook[currentOrder.symbol]!.BIDS.getElementByKey(
          currentOrder.price,
        )!;
      else
        priceLevel = this.orderBook[currentOrder.symbol]!.ASKS.getElementByKey(
          currentOrder.price,
        )!;

      priceLevel.totalQuantity -= pendingQty;

      let findCurrentOrder = priceLevel.orders.begin();
      while (
        !findCurrentOrder.equals(priceLevel.orders.end()) &&
        findCurrentOrder.pointer.orderId != orderId
      ) {
        findCurrentOrder = findCurrentOrder.next();
      }

      if (findCurrentOrder.equals(priceLevel.orders.end())) throw new Error(); // TODO : MAKE THIS SOME ORDERBOOK ERROR LATER

      priceLevel.orders.eraseElementByIterator(findCurrentOrder);

      if (priceLevel.totalQuantity == 0)
        if (currentOrder.side == "BUY")
          this.orderBook[currentOrder.symbol]!.BIDS.eraseElementByKey(
            currentOrder.price,
          );
        else
          this.orderBook[currentOrder.symbol]!.ASKS.eraseElementByKey(
            currentOrder.price,
          );
    }
    return { status: "NOT_CANCELLABLE" };
  };

  getOrder = (orderId: ORDER_ID) => {
    if (this.orders[orderId]) return { ...this.orders[orderId] };

    if (false) {
      // TODO :
      // check in db, etc if its already filled and is there
      // send request to some other guy to fulfill
    }

    return null;
  };
  getOrders = (symbol: CURRENCY_SYMBOL) => {
    let ordersInfo = {
      updateOffset: this.depthUpdateOffset.get(symbol),
      orders: { asks: [] as any[], bids: [] as any[] },
    };

    this.orderBook[symbol]?.ASKS.forEach(([_, priceLevel]) => {
      priceLevel.orders.forEach((order) => ordersInfo.orders.asks.push(order));
    });
    this.orderBook[symbol]?.BIDS.forEach(([_, priceLevel]) => {
      priceLevel.orders.forEach((order) => ordersInfo.orders.bids.push(order));
    });

    return ordersInfo;
  };

  // count is how many prices you want
  getDepth = (
    symbol: CURRENCY_SYMBOL,
    count: number = 20,
  ): { asks: DEPTH; bids: DEPTH } => {
    let toReturn: { asks: DEPTH; bids: DEPTH } = { asks: [], bids: [] };

    if (!this.orderBook[symbol]?.ASKS) return toReturn;

    let countToReturn = Math.min(count, this.orderBook[symbol]!.ASKS.size());

    let i = 0;
    for (
      let it = this.orderBook[symbol]!.ASKS.begin();
      it != this.orderBook[symbol]!.ASKS.end() && i < countToReturn;
      it = it.next(), i++
    ) {
      toReturn.asks.push({
        price: it.pointer[0],
        quantity: it.pointer[1].totalQuantity,
      });
    }

    i = 0;
    for (
      let it = this.orderBook[symbol]!.BIDS.begin();
      it != this.orderBook[symbol]!.BIDS.end() && i < countToReturn;
      it = it.next(), i++
    ) {
      toReturn.bids.push({
        price: it.pointer[0],
        quantity: it.pointer[1].totalQuantity,
      });
    }

    return toReturn;
  };
}
