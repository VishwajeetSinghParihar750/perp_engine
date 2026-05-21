import type { CURRENCY_SYMBOL, MARGIN_TYPE } from "../types/order.js";
import type { POSITION, POSITION_UPDATES } from "../types/positions.js";
import type { FILLS_INFO } from "./OrderBook.js";
import type { Snapshotable } from "./SnapshotManger.js";

type ORDER_UPDATES = Record<
  string, // userid
  Record<
    string, // orderid
    {
      positionUpdatePriceQtyProduct: number;
      positionUpdateQty: number;
      symbol: CURRENCY_SYMBOL;
      totalQty: number;
      margin: number;
      marginType: MARGIN_TYPE;
    }
  >
>;
type POSITION_SNAPSHOT = {};

class PositionManager implements Snapshotable<POSITION_SNAPSHOT> {
  // just isolated
  private isolatedPositions: Record<
    string, // userid
    Partial<Record<CURRENCY_SYMBOL, POSITION>>
  > = {}; // this is per user per symbol per price positions

  getSnapshot() {
    return {};
  }
  loadSnapshot(data: POSITION_SNAPSHOT) {}

  private calculateOrderUpdates(fills: FILLS_INFO) {
    // there can be position updates at diff price levels for a single user
    // so keep seller id map to orderid to updates
    let orderUpdates: ORDER_UPDATES = {};

    //  get positon updates
    fills.forEach((fill) => {
      const { buyOrderInfo, sellOrderInfo, price, symbol, qty } = fill;

      const { buyerId, orderId: buyOrderId } = buyOrderInfo;
      const { sellerId, orderId: sellOrderId } = sellOrderInfo;

      if (!orderUpdates[buyerId])
        orderUpdates[buyerId] = {
          buyOrderId: {
            positionUpdatePriceQtyProduct: 0,
            positionUpdateQty: 0,
            margin: buyOrderInfo.margin,
            marginType: buyOrderInfo.marginType,
            totalQty: buyOrderInfo.totalQty,
            symbol,
          },
        };
      if (!orderUpdates[sellerId])
        orderUpdates[sellerId] = {
          sellOrderId: {
            positionUpdatePriceQtyProduct: 0,
            positionUpdateQty: 0,
            margin: sellOrderInfo.margin,
            marginType: sellOrderInfo.marginType,
            totalQty: sellOrderInfo.totalQty,
            symbol,
          },
        };

      orderUpdates[buyerId][buyOrderId]!.positionUpdatePriceQtyProduct +=
        price * qty;
      orderUpdates[buyerId][buyOrderId]!.positionUpdateQty += qty;

      orderUpdates[sellerId][sellOrderId]!.positionUpdatePriceQtyProduct -=
        price * qty;
      orderUpdates[sellerId][sellOrderId]!.positionUpdateQty -= qty;
    });

    return orderUpdates;
  }
  private applyOderUpdates(orderUpdates: ORDER_UPDATES) {
    //
    let usersPnlUpdate: Record<string, number> = {};
    let positionUpdates: POSITION_UPDATES = {};

    for (const [userId, orderUpdate] of Object.entries(orderUpdates)) {
      for (const [
        _,
        {
          positionUpdatePriceQtyProduct, // this will be negative for short
          positionUpdateQty, // this will be negative for short
          symbol,
          totalQty: totalOrderQty,
          margin,
          marginType,
        },
      ] of Object.entries(orderUpdate)) {
        let weighedAvgPrice = positionUpdatePriceQtyProduct / positionUpdateQty;
        let newPosition = this.isolatedPositions[userId]?.[symbol];

        let filledRecentQty = Math.abs(positionUpdateQty);
        let unrealizedPnl = 0;

        // doing partial margin filling for diff price positions made by same order

        if (!newPosition) {
          newPosition = {
            positionId: crypto.randomUUID(),
            createdAt: new Date(),
            margin: (margin * filledRecentQty) / totalOrderQty,
            marginType: marginType,
            price: weighedAvgPrice,
            qty: Math.abs(positionUpdateQty),
            symbol: symbol,
            type: positionUpdateQty >= 0 ? "LONG" : "SHORT",
            userId,
          };
        } else {
          let updatedQty = 0;
          let updatedPrice = 0;

          let curretPositionType = newPosition.type;
          let orderType = positionUpdateQty >= 0 ? "LONG" : "SHORT";

          if (curretPositionType == orderType) {
            updatedQty = newPosition.qty + Math.abs(positionUpdateQty);

            // do weighed avg
            updatedPrice =
              (Math.abs(positionUpdatePriceQtyProduct) +
                newPosition.price * newPosition.qty) /
              updatedQty;
          } else {
            // reduce qty

            updatedQty = newPosition.qty - Math.abs(positionUpdateQty);

            if (updatedQty > 0) {
              updatedPrice =
                curretPositionType == "LONG"
                  ? newPosition.price
                  : weighedAvgPrice;
            } else if (updatedQty < 0) {
              updatedPrice =
                curretPositionType == "LONG"
                  ? weighedAvgPrice
                  : newPosition.price;
            }
            // else what if 0 = we dont give af ignore price,coz it would be removed from positions now

            // find pnl
            let qtyForPnl = Math.min(
              newPosition.qty,
              Math.abs(positionUpdateQty),
            );

            unrealizedPnl =
              (weighedAvgPrice - newPosition.price) *
              qtyForPnl *
              (orderType == "LONG" ? 1 : -1);
          }

          newPosition.price = updatedPrice;
          newPosition.margin += (margin * filledRecentQty) / totalOrderQty;
          newPosition.qty = updatedQty;
          newPosition.type = newPosition.qty >= 0 ? "LONG" : "SHORT";
          newPosition.marginType = marginType;
          newPosition.symbol;
        }

        // update positions
        if (!positionUpdates[newPosition.userId]) {
          positionUpdates[newPosition.userId] = {
            [newPosition.symbol]: newPosition,
          };
        } else
          positionUpdates[newPosition.userId]![newPosition.symbol] =
            newPosition;

        if (newPosition.qty == 0) {
          // return back their margin
          unrealizedPnl += newPosition.margin;
          delete this.isolatedPositions[userId]?.[symbol];
        } else {
          if (!this.isolatedPositions[userId])
            this.isolatedPositions[userId] = {};

          this.isolatedPositions[userId]![symbol] = newPosition;
        }

        if (unrealizedPnl != 0) {
          if (!usersPnlUpdate[userId]) usersPnlUpdate[userId] = unrealizedPnl;
          else usersPnlUpdate[userId] += unrealizedPnl;
        }
      }
    }
    return { pnlUpdates: usersPnlUpdate, positionUpdates };
  }

  applyFills(fills: FILLS_INFO) {
    let orderUpdates = this.calculateOrderUpdates(fills);

    let { pnlUpdates, positionUpdates } = this.applyOderUpdates(orderUpdates);

    return { pnlUpdates, positionUpdates };
  }
}

export default PositionManager;

export type { POSITION_SNAPSHOT };
