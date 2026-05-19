import "dotenv/config";
import type EventBus from "./EventBus.js";
import { exit } from "node:process";
import { assert } from "node:console";

class MarkPriceObserver {
  private BINANCE_SUBSCIRPTION_REQUEST: {
    method: "SUBSCRIBE";
    params: string[];
    id: number;
  } = {
    method: "SUBSCRIBE",
    params: [],
    id: 1,
  };

  private readonly streamPairs: string[] = [
    "btcusd@indexPrice",
    "solusd@indexPrice",
    "ethusd@indexPrice",
  ];
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.setupPriceSubscriptions();
    this.eventBus = eventBus;
  }

  setupPriceSubscriptions() {
    console.log(process.env.PRICE_UPDATES_WEBSOCKET_BACKEND_URL);
    let ws = new WebSocket(process.env.PRICE_UPDATES_WEBSOCKET_BACKEND_URL!);

    // maybe we will ahve to wait for ws.open using  promises

    // subscribe to streams
    this.streamPairs.forEach((streamPair) => {
      this.BINANCE_SUBSCIRPTION_REQUEST.params.push(streamPair);
    });

    ws.onopen = (ev) => {
      // send sub request
      console.log("binance ws server connection oopned ", ev);
      let subRequest = JSON.stringify(this.BINANCE_SUBSCIRPTION_REQUEST);
      console.log(subRequest);
      ws.send(subRequest);
    };

    ws.onerror = () => {
      assert(true);
    };

    ws.onmessage = ({ data }) => {
      // console.log("binance ws server connection sent message  ", data);

      data = JSON.parse(data);

      assert(!data.error && data.id == 1);

      ws.onmessage = ({ data }) => {
        // console.log("binance ws server connection sent message  ", data);

        data = JSON.parse(data);

        this.eventBus.emit({
          type: "markprice.updates",
          data,
        });
      };
    };
  }
}
export default MarkPriceObserver;
