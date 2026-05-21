import "dotenv/config";
import { createClient, type RedisClientType } from "redis";
import EventBus from "./EventBus.js";
import Exchange from "./Exchange.js";
import type { ENGINE_EVENT, ENGINE_EVENT_TYPE } from "../types/events/event.js";
import EventPublisher from "./EventPublisher.js";
import MarkPriceObserver from "./MarkPriceObserver.js";
import SnapshotManager from "./SnapshotManger.js";

type ENGINE_INFO_REQUEST_TYPE = "markprice_updated";

type ENGINE_REQUEST_TYPE =
  | "create_order"
  | "cancel_order"
  | "get_balance"
  | "add_balance"
  | "get_depth"
  | "get_orders"
  | "get_order"
  | "subscribe_event"
  | "unsubscribe_event"
  | "get_fills";

type ENGINE_RESPONSE_TYPE =
  | "order_created"
  | "order_cancelled"
  | "event_subscribed"
  | "event_unsubscribed"
  | "balance"
  | "balance_updated"
  | "depth"
  | "orders"
  | "order"
  | "fills"
  | "error"; // for anything that did not succeed

type ENGINE_INFO_REQUEST = {
  type: ENGINE_INFO_REQUEST_TYPE;
  payload?: any;
};
type ENGINE_REQUEST = {
  stream: string;
  requestId: string;
  type: ENGINE_REQUEST_TYPE;
  payload?: any;
};
type ENGINE_RESPONSE = {
  requestId: string;
  type: ENGINE_RESPONSE_TYPE;
  payload?: any;
};

class EngineServer {
  private redisClient: RedisClientType;
  private exchange: Exchange;
  private eventBus: EventBus;
  private eventPublisher: EventPublisher;
  private markpPriceObserver: MarkPriceObserver;
  private snapshotManager: SnapshotManager;

  async handleClientRequsts(
    redisClient: RedisClientType,
    lastRedisMessageId: string,
  ) {
    // getting connected client

    console.log("waiting for respones from redis stream");

    const xreadGroupResponse = await redisClient.xRead(
      [
        {
          id: lastRedisMessageId,
          key: process.env.REDIS_ENGINE_STREAM!,
        },
      ],
      { BLOCK: 0, COUNT: 100 },
    );

    console.log(xreadGroupResponse);
    if (xreadGroupResponse) {
      for (let perStreamRespone of xreadGroupResponse) {
        if (perStreamRespone.name == process.env.REDIS_ENGINE_STREAM) {
          for (let { id, message } of perStreamRespone.messages) {
            try {
              let request: ENGINE_REQUEST | ENGINE_INFO_REQUEST = JSON.parse(
                message.data!,
              );

              // here switch based on info types
              if (request.type == "markprice_updated") {
                this.handleEngineInfoRequest(request);
              } else {
                // later TODO : add zod here maybe, to check this
                // let { requestId, stream, type, payload } = request;

                // here sned to request handler
                let result = this.handleEngineRequest(request);

                if (result)
                  // send back this result
                  await redisClient.xAdd(request.stream, "*", {
                    data: JSON.stringify({
                      requestId: request.requestId,
                      type: result.type,
                      payload: result.payload,
                    }),
                  });
              }
            } catch (error) {
              console.log(
                "error happened in parsin request, so ignoring requset handling ",
                message.data,
              );
            }

            lastRedisMessageId = id;
          }
        }
      }
    }

    // then wait again
    this.handleClientRequsts(redisClient, lastRedisMessageId);
  }

  async setupRedis() {
    this.redisClient.on("error", (err) => {
      console.log("redis error : ", err);
    });

    await this.redisClient.connect();

    // create stream consumer group
    try {
      await this.redisClient.xGroupCreate(
        process.env.REDIS_ENGINE_STREAM!,
        process.env.REDIS_ENGINE_GROUP!,
        "0",
        { MKSTREAM: true },
      );
    } catch (error: any) {
      if (!(error.message as string).includes("BUSYGROUP")) {
        throw error;
      }
    }

    // get from where to replay from snapshot
  }

  async initialize() {
    await this.setupRedis();

    this.eventPublisher.initialize();
    this.markpPriceObserver.initialize();

    let lastRedisMessageId = await this.snapshotManager.initialize(
      this.exchange,
    );

    let dupClient = this.redisClient.duplicate();
    await dupClient.connect();
    this.handleClientRequsts(dupClient, lastRedisMessageId);
  }

  constructor() {
    this.eventBus = new EventBus();
    this.snapshotManager = new SnapshotManager();
    this.redisClient = createClient({ url: process.env.REDIS_URL! });
    this.exchange = new Exchange(this.eventBus);
    this.eventPublisher = new EventPublisher(
      this.eventBus,
      this.redisClient.duplicate(),
    );
    this.markpPriceObserver = new MarkPriceObserver(
      this.redisClient.duplicate(),
    );
  }

  private handleSubscribeEventRequest = (
    engineRequest: ENGINE_REQUEST,
  ): ENGINE_RESPONSE => {
    try {
      const { event, stream }: { event: ENGINE_EVENT_TYPE; stream: string } =
        engineRequest.payload;
      this.eventPublisher.subscribeEvent(event, stream);
      return {
        requestId: engineRequest.requestId,
        type: "event_subscribed",
        payload: null,
      };
    } catch (error) {
      return { requestId: engineRequest.requestId, type: "error" };
    }
  };

  private handleUnsubscribeEventRequest = (
    engineRequest: ENGINE_REQUEST,
  ): ENGINE_RESPONSE => {
    try {
      const { event, stream }: { event: ENGINE_EVENT_TYPE; stream: string } =
        engineRequest.payload;
      this.eventPublisher.unsubscribeEvent(event, stream);
      return {
        requestId: engineRequest.requestId,
        type: "event_unsubscribed",
        payload: null,
      };
    } catch (error) {
      return { requestId: engineRequest.requestId, type: "error" };
    }
  };

  private handleGetDepthRequest = (
    engineRequest: ENGINE_REQUEST,
  ): ENGINE_RESPONSE => {
    try {
      let depth = this.exchange.getDepth(engineRequest.payload.symbol);
      return {
        requestId: engineRequest.requestId,
        type: "depth",
        payload: depth,
      };
    } catch (error) {
      return { requestId: engineRequest.requestId, type: "error" };
    }
  };

  private handleGetOrdersRequest = (
    engineRequest: ENGINE_REQUEST,
  ): ENGINE_RESPONSE => {
    try {
      let orders = this.exchange.getOrders(engineRequest.payload.symbol);
      return {
        requestId: engineRequest.requestId,
        type: "orders",
        payload: orders,
      };
    } catch (error) {
      return { requestId: engineRequest.requestId, type: "error" };
    }
  };

  private handleGetFillsRequest = (
    engineRequest: ENGINE_REQUEST,
  ): ENGINE_RESPONSE => {
    try {
      let fills = this.exchange.getFills();
      return {
        requestId: engineRequest.requestId,
        type: "fills",
        payload: fills,
      };
    } catch (error) {
      return { requestId: engineRequest.requestId, type: "error" };
    }
  };
  private handleGetOrderRequest = (
    engineRequest: ENGINE_REQUEST,
  ): ENGINE_RESPONSE => {
    try {
      let order = this.exchange.getOrder(engineRequest.payload.orderId);
      if (!order) throw new Error();

      return {
        requestId: engineRequest.requestId,
        type: "order",
        payload: order,
      };
    } catch (error) {
      return { requestId: engineRequest.requestId, type: "error" };
    }
  };
  private handleGetBalanceRequest = (
    engineRequest: ENGINE_REQUEST,
  ): ENGINE_RESPONSE => {
    try {
      let balance = this.exchange.getBalance(
        engineRequest.payload.userId,
        engineRequest.payload.symbol,
      );
      return {
        requestId: engineRequest.requestId,
        type: "balance",
        payload: balance,
      };
    } catch (error) {
      return { requestId: engineRequest.requestId, type: "error" };
    }
  };

  private handleCancelOrderRequest = (
    engineRequest: ENGINE_REQUEST,
  ): ENGINE_RESPONSE => {
    try {
      let { status } = this.exchange.cancelOrder(engineRequest.payload.orderId);
      if (status != "CANCELLED") throw new Error();

      return { requestId: engineRequest.requestId, type: "order_cancelled" };
    } catch (error) {
      return { requestId: engineRequest.requestId, type: "error" };
    }
  };

  private handleCreateOrderRequest = (
    engineRequest: ENGINE_REQUEST,
  ): ENGINE_RESPONSE => {
    try {
      let { type, side, price, qty, symbol, userId, margin, marginType } =
        engineRequest.payload;
      let { status, orderId, fills } = this.exchange.createOrder(
        type,
        side,
        symbol,
        qty,
        userId,
        margin,
        marginType,
        price,
      );
      if (status == "REJECTED")
        return {
          requestId: engineRequest.requestId,
          type: "error",
          payload: "ORDER_REJECTED",
        };

      return {
        requestId: engineRequest.requestId,
        type: "order_created",
        payload: { status, fills, orderId },
      };
    } catch (error) {
      return { requestId: engineRequest.requestId, type: "error" };
    }
  };

  private handleAddBalanceRequest = (
    engineRequest: ENGINE_REQUEST,
  ): ENGINE_RESPONSE => {
    try {
      this.exchange.addBalance(
        engineRequest.payload.userId,
        engineRequest.payload.amount,
        engineRequest.payload.symbol,
      );
      return { requestId: engineRequest.requestId, type: "balance_updated" };
    } catch (error) {
      return { requestId: engineRequest.requestId, type: "error" };
    }
  };

  private handleUpdateMarkPriceRequest = (
    engineRequest: ENGINE_INFO_REQUEST,
  ) => {
    try {
      //
      this.exchange.handleMarkPriceUpdate(engineRequest.payload!);
    } catch (error) {
      console.error("error in hanlding mark price update ", error);
    }
  };

  private handleEngineRequest = (engineRequest: ENGINE_REQUEST) => {
    let response;
    switch (engineRequest.type) {
      case "add_balance":
        response = this.handleAddBalanceRequest(engineRequest);
        break;
      case "cancel_order":
        response = this.handleCancelOrderRequest(engineRequest);
        break;

      case "create_order":
        response = this.handleCreateOrderRequest(engineRequest);
        break;
      case "get_balance":
        response = this.handleGetBalanceRequest(engineRequest);
        break;
      case "get_depth":
        response = this.handleGetDepthRequest(engineRequest);
        break;
      case "get_fills":
        response = this.handleGetFillsRequest(engineRequest);
        break;
      case "get_order":
        response = this.handleGetOrderRequest(engineRequest);
        break;
      case "get_orders":
        response = this.handleGetOrdersRequest(engineRequest);
        break;
      case "subscribe_event":
        response = this.handleSubscribeEventRequest(engineRequest);
        break;
      case "unsubscribe_event":
        response = this.handleUnsubscribeEventRequest(engineRequest);
        break;

      default:
        throw new Error("invalid engine request type ");
    }

    return response;
  };
  private handleEngineInfoRequest = (engineRequest: ENGINE_INFO_REQUEST) => {
    switch (engineRequest.type) {
      case "markprice_updated":
        this.handleUpdateMarkPriceRequest(engineRequest);

      default:
        throw new Error("invalid engine request type ");
    }
  };
}

export default EngineServer;
