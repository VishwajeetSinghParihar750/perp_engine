import { OrderedMap } from "js-sdsl";
import type {
  CURRENCY_SYMBOL,
  MARGIN_TYPE,
  POSITION_TYPE,
} from "../types/order.js";
import type { POSITION } from "../types/events/positions.js";
import type { FILLS_INFO } from "./OrderBook.js";

type POSITION_UPDATES = Record<
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
>;

class PositionManager {
  private readonly LIQUIDATION_LEVEL = 0.95; // at 5% margin left , liquidate
  // new for perp (just for isolated right now)
  private liquidPositions: Partial<
    Record<
      CURRENCY_SYMBOL,
      Record<POSITION_TYPE, OrderedMap<number, Set<POSITION>>>
    >
  > = {}; // this is per symbol per liquidation_price positions

  // just isolated
  private isolatedPositions: Record<
    string,
    Partial<Record<CURRENCY_SYMBOL, POSITION>>
  > = {}; // this is per user per symbol per price positions

  private calculatePositionUpdates(fills: FILLS_INFO) {
    // there can be position updates at diff price levels for a single user
    // so keep seller id map to orderid to updates
    let positionUpdates: POSITION_UPDATES = {};

    //  get positon updates
    fills.forEach((fill) => {
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

    return positionUpdates;
  }
  private applyPositionUpdates(positionUpdates: POSITION_UPDATES) {
    //
    let usersPnlUpdate: Record<string, number> = {};

    for (const [userId, orderUpdates] of Object.entries(positionUpdates)) {
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
      ] of Object.entries(orderUpdates)) {
        let weighedAvgPrice = positionUpdatePriceQtyProduct / positionUpdateQty;
        let newPosition = this.isolatedPositions[userId]?.[symbol];

        let prevLiquidationPrice = newPosition?.liquidationPrice;
        let prevPositionType = newPosition?.type;

        let filledRecentQty = Math.abs(positionUpdateQty);
        let unrealizedPnl = 0;

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
            liquidationPrice: 0, //  calculate liquidation price later
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
          newPosition.liquidationPrice = 0;
          //  calculate liquidation price later
          newPosition.symbol;
        }

        // update positions

        if (newPosition.qty == 0) {
          // return back their margin
          unrealizedPnl += newPosition.margin;

          // remove from positions
          delete this.isolatedPositions[userId]?.[symbol];
        } else {
          //
          this.updateLiquidationPrice(newPosition);
          newPosition.liquidationPrice= // here we need risk engine ,so most likely a wrong class management

          if (!this.isolatedPositions[userId]) {
            this.isolatedPositions[userId] = {};
          }

          this.isolatedPositions[userId]![symbol] = newPosition;
        }

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
              newPosition.liquidationPrice,
            ) || new Set<POSITION>();
          liquidLevel.add(newPosition);

          this.liquidPositions[symbol]![newPosition.type].setElement(
            newPosition.liquidationPrice,
            liquidLevel,
          );
        } else {
          // give back unrealised pnl to user
          if (!usersPnlUpdate[userId]) usersPnlUpdate[userId] = unrealizedPnl;
          else usersPnlUpdate[userId] += unrealizedPnl;
        }
      }
    }

    return { pnlUpdates: usersPnlUpdate };
  }

  applyFills(fills: FILLS_INFO) {
    let positionUpdates = this.calculatePositionUpdates(fills);

    let usersPnlUpdate = this.applyPositionUpdates(positionUpdates);

    return { pnlUpdates: usersPnlUpdate };
  }
}

export default PositionManager;
