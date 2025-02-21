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
const COINS_CACHE_KEY = "all-coins"; // Key for storing full data
const CACHE_EXPIRATION = 600; // Cache expiration in seconds (10 minutes)

// Function to fetch and cache full CoinGecko data
const fetchAndCacheCoins = async () => {
  try {
    console.log("Fetching full CoinGecko data...");
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/coins/markets",
      {
        params: {
          vs_currency: "usd",
          order: "market_cap_desc",
          per_page: 250, // Max items per request
          page: 1, // Start from page 1
        },
        headers: {
          accept: "application/json",
        },
      }
    );

    let allCoins = response.data;

    // Fetch additional pages if needed
    for (let i = 2; i <= 4; i++) {
      const additionalData = await axios.get(
        "https://api.coingecko.com/api/v3/coins/markets",
        {
          params: {
            vs_currency: "usd",
            order: "market_cap_desc",
            per_page: 250, // Max items per request
            page: i, // Next page
          },
          headers: {
            accept: "application/json",
          },
        }
      );
      allCoins = [...allCoins, ...additionalData.data];
    }

    // Store full dataset in Redis
    await redis.set(COINS_CACHE_KEY, JSON.stringify(allCoins), {
      ex: CACHE_EXPIRATION,
    });

    console.log("Coin data cached successfully!");
  } catch (error) {
    console.error("Error fetching CoinGecko data:", error);
  }
};

// Route to serve paginated coins from cache
app.get("/coins", async (req, res) => {
  try {
    const { page = 1, item = 10 } = req.query;
    // @ts-ignore
    const pageNumber = parseInt(page, 10);
    // @ts-ignore
    const itemsPerPage = parseInt(item, 10);

    // Check if full data exists in cache
    let cachedData = await redis.get(COINS_CACHE_KEY);
    if (!cachedData) {
      console.log("Cache empty, fetching fresh data...");
      await fetchAndCacheCoins();
      cachedData = await redis.get(COINS_CACHE_KEY);
    }

    // Parse data
    // @ts-ignore
    let allCoins;
    try {
      allCoins =
        typeof cachedData === "string" ? JSON.parse(cachedData) : cachedData;
    } catch (error) {
      console.error("Error parsing JSON from Redis:", error);
      allCoins = []; // Fallback if parsing fails
    }

    // Paginate data
    const startIndex = (pageNumber - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedData = allCoins.slice(startIndex, endIndex);

    res.json({
      totalItems: allCoins.length,
      totalPages: Math.ceil(allCoins.length / itemsPerPage),
      currentPage: pageNumber,
      perPage: itemsPerPage,
      coins: paginatedData,
    });
  } catch (error) {
    console.error("Error fetching paginated data:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// Fetch and cache data on server start
fetchAndCacheCoins();

// Refresh cache every 10 minutes
setInterval(fetchAndCacheCoins, CACHE_EXPIRATION * 1000);

// Global Error Handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
