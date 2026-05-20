import { HashMap } from "js-sdsl";
import type { ENGINE_EVENT, ENGINE_EVENT_TYPE } from "../types/events/event.js";

type EVENT_CALLBACK_FUNCTION = (event: ENGINE_EVENT) => void;

class EventBus {
  private eventCallbacks = new HashMap<string, EVENT_CALLBACK_FUNCTION[]>();

  emit = (event: ENGINE_EVENT) => {
    let callbacks = this.eventCallbacks.getElementByKey(event.type);
    if (callbacks) callbacks.forEach((cb) => cb(event));

    let forAllCallbacks = this.eventCallbacks.getElementByKey("ALL_EVENTS");
    if (forAllCallbacks) forAllCallbacks.forEach((cb) => cb(event));
  };

  on = (
    eventType: ENGINE_EVENT_TYPE | "ALL_EVENTS",
    cb: EVENT_CALLBACK_FUNCTION,
  ) => {
    let callbacks = this.eventCallbacks.getElementByKey(eventType) || [];
    callbacks.push(cb);
    this.eventCallbacks.setElement(eventType, callbacks);
  };

  // there could be remove cb function too, but not needed rn
}

export default EventBus;
