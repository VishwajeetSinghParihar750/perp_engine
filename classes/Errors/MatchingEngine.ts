abstract class MatchingEngineError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}

class InsufficientBalanceError extends MatchingEngineError {
  constructor(msg: string = "") {
    super(msg);
  }
}

export { MatchingEngineError, InsufficientBalanceError };
