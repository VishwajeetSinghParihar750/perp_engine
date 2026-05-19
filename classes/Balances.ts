import type { CURRENCY_SYMBOL } from "../types/order.js";
import { InsufficientBalanceError } from "./Errors/Balances.js";

export default class BalanceManager {
  private perSymbolBalances: Record<
    string,
    Partial<Record<CURRENCY_SYMBOL, number>>
  > = {}; // userid to symbol to balance
  private exchangeBalance = 100000000;

  private lockedAccounts: Partial<Record<CURRENCY_SYMBOL, Set<string>>> = {};

  lockAccount(userId: string, symbol: CURRENCY_SYMBOL) {
    if (!this.lockedAccounts[symbol]) this.lockedAccounts[symbol] = new Set();
    this.lockedAccounts[symbol].add(userId);
  }
  unlockAccount(userId: string, symbol: CURRENCY_SYMBOL) {
    this.lockedAccounts?.[symbol]?.delete(userId);
  }
  isAccountLocked(userId: string, symbol: CURRENCY_SYMBOL): boolean {
    return this.lockedAccounts?.[symbol]?.has(userId) ? true : false;
  }

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

  // TODO : simplify this later, to use direct data
  applyUsersPnl(usersPnlUpdate: Record<string, number>) {
    Object.entries(usersPnlUpdate).forEach(([userId, pnl]) => {
      let ogBal = this.getBalance(userId, "USD") as number;
      this.exchangeBalance += Math.min(0, ogBal + pnl);

      if (pnl > 0) this.addBalance(userId, "USD", pnl);
      else this.removeBalance(userId, "USD", Math.min(ogBal, Math.abs(pnl)));
    });
  }

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
