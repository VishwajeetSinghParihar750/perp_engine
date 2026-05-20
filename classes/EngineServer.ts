import "dotenv/config";
import { createClient, type RedisClientType } from "redis";
import EventBus from "./EventBus.js";
import MatchingEngine from "./Exchange.js";
import type { ENGINE_EVENT, ENGINE_EVENT_TYPE } from "../types/events/event.js";

type ENGINE_REQUEST_TYPE =
  | "create_order"
  | "cancel_order"
  | "get_balance"
  | "add_balance"
  | "get_depth"
  | "get_orders"
  | "get_order"
  | "get_fills";

type ENGINE_RESPONSE_TYPE =
  | "order_created"
  | "order_cancelled"
  | "balance"
  | "balance_updated"
  | "depth"
  | "orders"
  | "order"
  | "fills"
  | "error"; // for anything that did not succeed

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
  private matchingEngine: MatchingEngine;
  private eventBus: EventBus;

  subscriptions: Map<ENGINE_EVENT_TYPE, Set<string>> = new Map(); // string represents stream name that is subscribed to that event

  private subscribeEvent(event: ENGINE_EVENT_TYPE, stream: string) {
    // later TOOD: ideally should limit what outsiders can sub to
    let subs = this.subscriptions.getOrInsert(event, new Set());
    subs.add(stream);
    this.subscriptions.set(event, subs);
  }
  private unsubscribeEvent(event: ENGINE_EVENT_TYPE, stream: string) {
    // later TOOD: ideally should limit what outsiders can sub to
    this.subscriptions?.get(event)?.delete(stream);
  }

  async handleEngineEvent(event: ENGINE_EVENT) {
    // TODO: push to db puller

    // send to all backends who are subbed
    let subs = this.subscriptions.get(event.type);
    if (subs)
      for (let sub of subs) {
        // push to redis stream this event
        await this.redisClient.xAdd(sub, "*", {
          data: JSON.stringify(event.data),
        });
      }
  }

  async handleClientRequsts(redisClient: RedisClientType) {
    // getting connected client

    console.log("waiting for respones from redis stream");

    const xreadGroupResponse = await redisClient.xReadGroup(
      process.env.REDIS_ENGINE_GROUP!,
      "consumer1",
      [{ id: ">", key: process.env.REDIS_ENGINE_STREAM! }],
      { BLOCK: 0, COUNT: 100 },
    );

    console.log(xreadGroupResponse);
    xreadGroupResponse?.forEach((perStreamRespone) => {
      if (perStreamRespone.name == process.env.REDIS_ENGINE_STREAM) {
        let messages = perStreamRespone.messages;
        messages.forEach(({ id, message }) => {
          try {
            let request: ENGINE_REQUEST = JSON.parse(message.data!);

            // later TODO : add zod here maybe, to check this
            // let { requestId, stream, type, payload } = request;

            // here sned to request handler
            let result = this.handleEngineRequest(request);

            // send back this result

            console.log(id, request);
          } catch (error) {
            console.log(
              "error happened in parsin request, so ignoring requset handling ",
              message.data,
            );
          }
        });
      }
    });

    // then wait again
    this.handleClientRequsts(redisClient);
  }

  async setupRedis() {
    let dupClient = this.redisClient.duplicate();

    this.redisClient.on("error", (err) => {
      console.log("redis error : ", err);
    });
    dupClient.on("error", (err) => {
      console.log("redis error : ", err);
    });

    await this.redisClient.connect();
    await dupClient.connect();

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

    this.handleClientRequsts(dupClient);
  }

  constructor() {
    this.eventBus = new EventBus();
    this.redisClient = createClient({ url: process.env.REDIS_URL! });
    this.matchingEngine = new MatchingEngine(this.eventBus);
    this.setupRedis();
  }

  private handleGetDepthRequest = (
    engineRequest: ENGINE_REQUEST,
  ): ENGINE_RESPONSE => {
    try {
      let depth = this.matchingEngine.getDepth(engineRequest.payload.symbol);
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
      let orders = this.matchingEngine.getOrders(engineRequest.payload.symbol);
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
      let fills = this.matchingEngine.getFills();
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
      let order = this.matchingEngine.getOrder(engineRequest.payload.orderId);
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
      let balance = this.matchingEngine.getBalance(
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
      let { status } = this.matchingEngine.cancelOrder(
        engineRequest.payload.orderId,
      );
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
      let { status, orderId, fills } = this.matchingEngine.createOrder(
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
      this.matchingEngine.addBalance(
        engineRequest.payload.userId,
        engineRequest.payload.amount,
        engineRequest.payload.symbol,
      );
      return { requestId: engineRequest.requestId, type: "balance_updated" };
    } catch (error) {
      return { requestId: engineRequest.requestId, type: "error" };
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

      default:
        throw new Error("invalid engine request type ");
    }

    return response;
  };
}

export default EngineServer;
