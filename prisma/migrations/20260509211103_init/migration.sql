-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('LIMIT', 'MARKET');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'CANCELLED', 'FILLED');

-- CreateTable
CREATE TABLE "Users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,

    CONSTRAINT "Users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stocks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,

    CONSTRAINT "Stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Orders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "type" "OrderType" NOT NULL,
    "stockId" TEXT NOT NULL,
    "price" DECIMAL(18,0) NOT NULL,
    "quantity" DECIMAL(18,0) NOT NULL,
    "filledQuantity" DECIMAL(18,0) NOT NULL,
    "status" "OrderStatus" NOT NULL,

    CONSTRAINT "Orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fills" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "price" DECIMAL(18,0) NOT NULL,
    "quantity" DECIMAL(18,0) NOT NULL,
    "buyOrderId" TEXT NOT NULL,
    "sellOrderId" TEXT NOT NULL,

    CONSTRAINT "Fills_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Orders" ADD CONSTRAINT "Orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Orders" ADD CONSTRAINT "Orders_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fills" ADD CONSTRAINT "Fills_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fills" ADD CONSTRAINT "Fills_buyOrderId_fkey" FOREIGN KEY ("buyOrderId") REFERENCES "Orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fills" ADD CONSTRAINT "Fills_sellOrderId_fkey" FOREIGN KEY ("sellOrderId") REFERENCES "Orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
