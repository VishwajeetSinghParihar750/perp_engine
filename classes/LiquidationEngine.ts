import { OrderedMap } from "js-sdsl";
import type {
  SIDE as ORDER_SIDE,
  TYPE as ORDER_TYPE,
  SIDE,
  TYPE,
} from "../types/order.js";
import type { POSITION } from "../types/positions.js";
import { type CURRENCY_SYMBOL, type POSITION_TYPE } from "../types/order.js";
import type { POSITION_UPDATES } from "../types/positions.js";
import EventBus from "./EventBus.js";
import { assert } from "node:console";
import type { Snapshotable } from "./SnapshotManger.js";

type LIQUIDATION_SNAPSHOT = {};

type LiquidationOrderInfo = {
  type: TYPE;
  side: SIDE;
  symbol: CURRENCY_SYMBOL;
  qty: number;
  userId: string;
};
class LiquidationEngine implements Snapshotable<LIQUIDATION_SNAPSHOT> {
  private readonly LIQUIDATION_LEVEL = 0.95; // at 5% margin left , liquidate

  private liquidPositions: Partial<
    Record<
      CURRENCY_SYMBOL,
      Record<POSITION_TYPE, OrderedMap<number, Set<string>>>
    >
  > = {}; // this is per symbol per liquidation_price positions
  private eventBus: EventBus;

  private positionsBeingLiquidated: Map<
    string,
    Map<CURRENCY_SYMBOL, POSITION>
  > = new Map();
  private indexPrices: Partial<Record<CURRENCY_SYMBOL, number>> = {};

  private positions: Record<string, POSITION> = {}; // positions in liquidPosition are ref of this
  private liquidationPrice: Record<string, number> = {}; // position id mapped to price

  private requestLiquidation: (order: LiquidationOrderInfo) => void;

  private keepTryingLiquidation = (positionId: string) => {
    // every 2s keep putting margin order until filled

    let curPosition = this.positions[positionId];
    if (curPosition) {
      this.requestLiquidation({
        qty: curPosition.qty,
        side: curPosition.type == "LONG" ? "SELL" : "BUY",
        symbol: curPosition.symbol,
        type: "MARKET",
        userId: curPosition.userId,
      });
      setTimeout(() => {
        this.keepTryingLiquidation(positionId);
      }, 2000);
    }
    // else filled already
  };

  constructor(
    eventBus: EventBus,
    requestLiquidation: (order: LiquidationOrderInfo) => void,
  ) {
    this.requestLiquidation = requestLiquidation;
    this.eventBus = eventBus;
  }
  getSnapshot() {
    return {};
  }
  loadSnapshot(data: LIQUIDATION_SNAPSHOT) {}

  private liquidatePosition(positionId: string) {
    let position = this.positions[positionId]!;
    assert(position);

    // lock the positoin for this symbol for this user
    this.eventBus.emit({
      type: "liquidation.started",
      data: {
        userId: position.userId,
        symbol: position.symbol,
      },
    });

    // plave in beingLiquidatedPositions
    delete this.positions[positionId];
    let positionSet = this.liquidPositions[position.symbol]![
      position.type
    ].getElementByKey(position.price)!;

    positionSet.delete(position.positionId);

    this.positionsBeingLiquidated.getOrInsert(
      position.userId,
      new Map([[position.symbol, position]]),
    );

    // keep placing margin orders for this until fully filled
    this.keepTryingLiquidation(position.positionId);
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

  handleMarkPriceUpdate({
    symbol,
    newPrice,
  }: {
    symbol: CURRENCY_SYMBOL;
    newPrice: number;
  }) {
    // maybe TODO :  get initial prices first through http, then update prices with ws later,  wait for getting requests until your prices are  set up
    // E is time thing, price is in string

    console.log(symbol, newPrice);
    if (!this.indexPrices[symbol]) this.indexPrices[symbol] = newPrice;
    else {
      // handle liquidation based on chagne
      let prevPrice = this.indexPrices[symbol]!;

      if (prevPrice == newPrice) return;

      let positionsMap =
        this.liquidPositions[symbol]?.[prevPrice < newPrice ? "SHORT" : "LONG"];

      while (positionsMap && !positionsMap.empty()) {
        let [price, positions] = positionsMap.front()!;
        if (price > newPrice) return;

        // liquidate all positions at this price
        positions.forEach((position) => this.liquidatePosition(position));
      }
    }
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

  //  remove all data strcures and clear empty ds, and similarly in normal position udpats
  private handlePositonUpdateLiquidation(position: POSITION) {
    if (position.qty == 0) {
      // remmove from all data strctures

      // remove from liqudi positiosn
      let set = this.liquidPositions[position.symbol]![
        position.type
      ].getElementByKey(position.price)!;
      set.delete(position.positionId);

      if (set.size == 0) {
        this.liquidPositions[position.symbol]?.[
          position.type
        ]?.eraseElementByKey(position.price);
      }

      // remove from others
      delete this.liquidationPrice[position.positionId];
      delete this.positions[position.positionId];
      this.positionsBeingLiquidated.delete(position.positionId);
    }

    // remove from
  }

  applyPositionUpdates(positionUpdates: POSITION_UPDATES) {
    Object.entries(positionUpdates).forEach(
      ([userId, perSymbolPositonUpdate]) => {
        Object.entries(perSymbolPositonUpdate).forEach(([_, newPosition]) => {
          let beingLiquidated = this.positionsBeingLiquidated
            .get(userId)
            ?.get(newPosition.symbol);

          if (beingLiquidated) {
            this.handlePositonUpdateLiquidation(newPosition);
            return;
          }

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
export type { LiquidationOrderInfo, LIQUIDATION_SNAPSHOT };
