import express, { Application, Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import axios from "axios";
import { Redis } from "@upstash/redis";

// Load environment variables
dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));

// Initialize Redis Client
const redis = new Redis({
  url: process.env.REDIS_URL,
  token: process.env.REDIS_PASSWORD,
});

// Sample Route
app.get("/", (req, res) => {
  res.json({ message: "how u doin" });
});

// @ts-ignore
app.get("/coins", async (req, res) => {
  try {
    const { page = 1, item = 10 } = req.query;
    const cacheKey = `coins-page-${page}-item-${item}`;

    // 1. Check if data is in Redis cache
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      console.log("Serving from cache");
      return res.json(cachedData);
    }

    // 2. Fetch data from CoinGecko if not in cache
    console.log("Fetching new data from API...");
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/coins/markets",
      {
        params: {
          vs_currency: "usd",
          order: "market_cap_desc",
          per_page: item,
          page,
        },
        headers: {
          accept: "application/json",
        },
      }
    );

    const data = response.data;

    // 3. Store data in Redis with expiration (60 seconds)
    await redis.set(cacheKey, JSON.stringify(data), { ex: 120 });

    res.json(data);
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// Global Error Handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
