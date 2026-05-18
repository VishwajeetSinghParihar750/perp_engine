import { OrderedMap } from "js-sdsl";
import type { POSITION } from "../types/events/positions.js";
import type { CURRENCY_SYMBOL, POSITION_TYPE } from "../types/order.js";
import type { POSITION_UPDATES } from "../types/events/positions.js";

class LiquidationEngine {
  //
  private readonly LIQUIDATION_LEVEL = 0.95; // at 5% margin left , liquidate
  private liquidPositions: Partial<
    Record<
      CURRENCY_SYMBOL,
      Record<POSITION_TYPE, OrderedMap<number, Set<string>>>
    >
  > = {}; // this is per symbol per liquidation_price positions
  private positions: Record<string, POSITION> = {}; // positions in liquidPosition are ref of this
  private liquidationPrice: Record<string, number> = {}; // position id mapped to price

  private getLiquidationForPosition(positon: POSITION): number {
    let canTakeLoss = positon.margin * this.LIQUIDATION_LEVEL;

    // pnl = (newprice - price) * qty
    // newprice = canTakeLoss  / qty + price

    let newPrice =
      positon.price +
      (canTakeLoss / positon.qty) * (positon.type == "LONG" ? 1 : -1);

    return newPrice;
  }

  applyPositionUpdates(positionUpdates: POSITION_UPDATES) {
    Object.entries(positionUpdates).forEach(
      ([userId, perSymbolPositonUpdate]) => {
        Object.entries(perSymbolPositonUpdate).forEach(([_, newPosition]) => {
          let prevPosition = this.positions[newPosition.positionId];

          // remove from prev lqiudi position
          if (prevPosition) {
            this.liquidPositions[prevPosition.symbol]?.[prevPosition.type]
              .getElementByKey?.(
                this.liquidationPrice[prevPosition.positionId]!,
              )!
              .delete(prevPosition.positionId);
            delete this.liquidationPrice[prevPosition.positionId];
          }

          if (newPosition.qty == 0) {
            // delete from liquisPosition
            if (prevPosition) {
              delete this.positions[prevPosition.positionId];
            }
          } else {
            if (!this.liquidPositions[newPosition.symbol]) {
              this.liquidPositions[newPosition.symbol] = {
                LONG: new OrderedMap(),
                SHORT: new OrderedMap(),
              };
            }

            // find new liquidation price
            let newLiquidationPrice =
              this.getLiquidationForPosition(newPosition);

            // add to liquid positions
            let positionSet =
              this.liquidPositions[newPosition.symbol]![
                newPosition.type
              ].getElementByKey(newLiquidationPrice) || new Set();

            positionSet.add(newPosition.positionId);

            // update data strcutures
            this.liquidPositions[newPosition.symbol]![
              newPosition.type
            ].setElement(newLiquidationPrice, positionSet);

            if (!prevPosition) {
              this.positions[newPosition.positionId] = newPosition;
            }
            this.liquidationPrice[newPosition.positionId] = newLiquidationPrice;
          }
        });
      },
    );
  }
}
export default LiquidationEngine;
