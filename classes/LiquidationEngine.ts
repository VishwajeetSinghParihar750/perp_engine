import { OrderedMap } from "js-sdsl";
import type { POSITION } from "../types/positions.js";
import {
  CURRENCY_SYMBOL_ARRAY,
  type CURRENCY_SYMBOL,
  type POSITION_TYPE,
} from "../types/order.js";
import type { POSITION_UPDATES } from "../types/positions.js";
import type EventBus from "./EventBus.js";

class LiquidationEngine {
  //

  private readonly LIQUIDATION_LEVEL = 0.95; // at 5% margin left , liquidate
  private liquidPositions: Partial<
    Record<
      CURRENCY_SYMBOL,
      Record<POSITION_TYPE, OrderedMap<number, Set<string>>>
    >
  > = {}; // this is per symbol per liquidation_price positions

  private indexPrices: Partial<Record<CURRENCY_SYMBOL, number>> = {};

  private positions: Record<string, POSITION> = {}; // positions in liquidPosition are ref of this
  private liquidationPrice: Record<string, number> = {}; // position id mapped to price

  private liquidatePosition(positionId: string) {
    let positon = this.positions[positionId];

    // lock the positoin for this symbol for this user
    // keep placing margin orders for this until fully filled
  }
  private handlePriceUpdate(symbol: CURRENCY_SYMBOL, newPrice: number) {
    let prevPrice = this.indexPrices[symbol]!;

    if (prevPrice == newPrice) return;

    if (prevPrice < newPrice) {
      // try liqudiate shorts

      let shorts = this.liquidPositions[symbol]!["SHORT"];
      while (!shorts.empty()) {
        let [price, positions] = shorts.front()!;
        if (price > newPrice) return;

        // liquidate all positions at this price
        positions.forEach((position) => this.liquidatePosition(position));
      }
    } else {
      // liquidate longs
    }
  }
  handlePriceUpdates(eventBus: EventBus) {
    // TODO :  get initial prices first through http, then update prices with ws later,  wait for getting requests until your prices are  set up

    eventBus.on("markprice.udpates", ({ data, type }) => {
      const { E, i, p }: { E: number; i: CURRENCY_SYMBOL; p: string } = data;
      // E is time thing, price is in string

      if (!this.indexPrices[i]) this.indexPrices[i] = +p;
      else {
        // handle liquidation based on chagne
        this.handlePriceUpdate(i, +p);
      }
    });
  }
  constructor(eventBus: EventBus) {
    this.handlePriceUpdates(eventBus);
  }

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
                LONG: new OrderedMap([], (x, y) => y - x),
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
