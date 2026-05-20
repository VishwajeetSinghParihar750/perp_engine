import type { RedisClientType } from "redis";
import type { ENGINE_EVENT, ENGINE_EVENT_TYPE } from "../types/events/event.js";
import type EventBus from "./EventBus.js";

class EventPublisher {
  subscriptions: Map<ENGINE_EVENT_TYPE, Set<string>> = new Map(); // string represents stream name that is subscribed to that event
  redisClient: RedisClientType;

  eventBus: EventBus;

  handleEvent = async (event: ENGINE_EVENT) => {
    // send to all backends who are subbed
    let streams = this.subscriptions.get(event.type);
    if (streams)
      await Promise.all(
        [...streams].map((stream) =>
          this.redisClient.xAdd(stream, "*", {
            data: JSON.stringify({
              type: event.type,
              payload: event.data,
            }),
          }),
        ),
      );

    // TODO : send to db poller main stream
  };

  async initialize() {
    await this.redisClient.connect();
    this.eventBus.on("ALL_EVENTS", this.handleEvent);
  }

  constructor(eventBus: EventBus, redisClient: RedisClientType) {
    this.redisClient = redisClient;
    this.eventBus = eventBus;
  }

  subscribeEvent(event: ENGINE_EVENT_TYPE, stream: string) {
    // later TOOD: ideally should limit what outsiders can sub to
    let subs = this.subscriptions.getOrInsert(event, new Set());
    subs.add(stream);
    this.subscriptions.set(event, subs);
  }
  unsubscribeEvent(event: ENGINE_EVENT_TYPE, stream: string) {
    // later TOOD: ideally should limit what outsiders can sub to
    this.subscriptions?.get(event)?.delete(stream);
  }
}

export default EventPublisher;
