import type { CURRENCY_SYMBOL } from "../types/order.js";
import { InsufficientBalanceError } from "./Errors/Balances.js";

export default class Balances {
  private perSymbolBalances: Record<
    string,
    Partial<Record<CURRENCY_SYMBOL, number>>
  > = {}; // userid to symbol to balance

  getBalance = (userId: string, symbol: CURRENCY_SYMBOL | undefined) => {
    if (symbol) return this.perSymbolBalances[userId]?.[symbol] || 0;
    return this.perSymbolBalances[userId];
  };

  addBalance = (userId: string, symbol: CURRENCY_SYMBOL, balance: number) => {
    if (!this.perSymbolBalances[userId]) this.perSymbolBalances[userId] = {};

    if (!this.perSymbolBalances[userId][symbol])
      this.perSymbolBalances[userId][symbol] = balance;
    else this.perSymbolBalances[userId][symbol] += balance;
  };

  removeBalance = (
    userId: string,
    symbol: CURRENCY_SYMBOL,
    balance: number,
  ) => {
    let curBal = this.perSymbolBalances[userId]?.[symbol];
    if (!curBal || curBal < balance) {
      throw new InsufficientBalanceError();
    }
    this.perSymbolBalances[userId]![symbol]! -= balance;
  };
}
