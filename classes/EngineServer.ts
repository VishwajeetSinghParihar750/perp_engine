import { createClient, type RedisClientType } from "redis";
import EventBus from "./EventBus.js";
import MatchingEngine from "./MatchingEngine.js";

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

  async setupRedis() {
    this.redisClient.on("error", (err) => {
      console.log("redis error : ", err);
    });

    await this.redisClient.connect();

    // setupEventHandler for redis stream
    this.eventBus.on("ALL_EVENTS", async (event) => {
      let xAddResponse = await this.redisClient.xAdd(event.type, "*", {
        data: JSON.stringify(event.data),
      });
      // maybe do error handling
    });

    let duplicateRedisClient = this.redisClient.duplicate();
    // duplicated coz this will wait forever for the redis list,
    // so it would interrput with redis straim handling

    await duplicateRedisClient.connect();

    console.log("REDIS SETUP DONE");
    while (true) {
      const engineRequest = await duplicateRedisClient.blPop(
        "engine_request",
        0,
      );
      console.log("RECEIVED ENGINE REQUEST : ", engineRequest);
      if (engineRequest)
        this.handleEngineRequest(JSON.parse(engineRequest.element));
    }
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

  handleEngineRequest = (engineRequest: ENGINE_REQUEST) => {
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
        break;
    }

    // TODO : this should also be kept separately not here ,emit event maybe let redis catch it and send it
    // TODO  : make this push per backend queue, not per request
    this.redisClient.rPush(
      `engine_response_${engineRequest.requestId}`,
      JSON.stringify(response),
    );
  };
}

export default EngineServer;
