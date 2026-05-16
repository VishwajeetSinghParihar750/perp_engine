abstract class BalanceError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}

class InsufficientBalanceError extends BalanceError {
  constructor(msg: string = "") {
    super(msg);
  }
}

export { BalanceError, InsufficientBalanceError };
