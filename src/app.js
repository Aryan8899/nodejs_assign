const cluster = require("cluster");
const express = require("express");
const Redis = require("ioredis");
const Queue = require("bull");
const fs = require("fs");
const path = require("path");

// Load environment variables
require("dotenv").config();

// Redis connection retry configuration
const redisOptions = {
  retryStrategy(times) {
    return Math.min(times * 50, 2000); // Retry every 50ms, max of 2s
  },
};

// Initialize Redis with retry logic and error handling
let redis;
function connectToRedis() {
  try {
    const redisHost = process.env.REDIS_HOST || "127.0.0.1";
    const redisPort = process.env.REDIS_PORT || 6379;
    redis = new Redis(redisPort, redisHost, redisOptions);
    redis.on("connect", () => console.log("Connected to Redis"));
    redis.on("error", (error) => {
      console.error("Redis connection error:", error);
    });
  } catch (error) {
    console.error("Failed to connect to Redis:", error);
    process.exit(1); // Exit if Redis connection fails after retries
  }
}
connectToRedis();

const taskQueue = new Queue("taskQueue", { redis });

// Redis-based Rate Limiting Configuration
const rateLimitConfig = {
  tasksPerSecond: 1,
  tasksPerMinute: 20,
};

// Function to sleep for a given duration
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Function to acquire a lock for a specific user
async function acquireLock(user_id) {
  const lockKey = `lock:${user_id}`;
  const lock = await redis.set(lockKey, "locked", "NX", "EX", 5); // 5 seconds lock
  return lock === "OK"; // Returns true if lock is acquired, false otherwise
}

// Function to release the lock for a specific user
async function releaseLock(user_id) {
  const lockKey = `lock:${user_id}`;
  await redis.del(lockKey);
}

if (cluster.isMaster) {
  const numReplicas = 2; // Enforce 2 replicas as per the task requirements

  // Fork 2 workers (replica sets)
  for (let i = 0; i < numReplicas; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died, spawning a new worker.`);
    cluster.fork();
  });
} else {
  const app = express();
  app.use(express.json());

  // Redis-based rate limiting and task queuing for user tasks
  app.post("/task", async (req, res) => {
    const { user_id } = req.body;

    // Input validation
    if (!user_id) {
      return res.status(400).json({ error: "User ID is required" });
    }

    try {
      const currentTime = Date.now();
      const currentMinute = Math.floor(currentTime / 60000);

      // Redis key for rate limiting
      const redisKey = `rateLimit:${user_id}:${currentMinute}`;

      // Check if rate limit exceeded flag exists
      const rateLimitExceeded = await redis.get(`rateLimitExceeded:${user_id}`);
      if (rateLimitExceeded) {
        const delayTime = 60000 - (currentTime % 60000); // Calculate delay until next minute
        await taskQueue.add({ user_id }, { delay: delayTime });
        return res.status(429).json({
          status: "Rate limit exceeded, task delayed to next minute.",
        });
      }

      // Increment the user's task count for the current minute and get the current count
      const taskCount = await redis.incr(redisKey);

      // Set the expiration for the rate limit key (if it's newly created)
      if (taskCount === 1) {
        await redis.expire(redisKey, 60); // Set expiration to 60 seconds
      }

      // Check rate limiting conditions
      if (taskCount > rateLimitConfig.tasksPerMinute) {
        console.log(
          `Rate limit exceeded for user ${user_id}, task will be delayed.`
        );
        // Set the rate limit exceeded flag
        await redis.set(`rateLimitExceeded:${user_id}`, true, "EX", 60); // Set flag for 1 minute
        const delayTime = 60000 - (currentTime % 60000); // Calculate delay until next minute
        await taskQueue.add({ user_id }, { delay: delayTime });
        return res.status(429).json({
          status: "Rate limit exceeded, task delayed to next minute.",
        });
      }

      // Queue the task for processing and return response
      console.log(
        `Task queued for user ${user_id}, taskCount for minute: ${taskCount}`
      );
      await taskQueue.add({ user_id });
      res.status(200).json({ status: "Task queued successfully" });
    } catch (err) {
      console.error("Error processing task:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  module.exports = app;

  // Task processing with enforced 1 task per second per user
  taskQueue.process(1, async (job) => {
    const { user_id } = job.data;

    try {
      // Try to acquire a lock for this user to ensure sequential processing
      let lockAcquired = await acquireLock(user_id);

      while (!lockAcquired) {
        console.log(`Waiting for lock for user ${user_id}`);
        await sleep(100); // Wait 100ms before retrying to acquire the lock
        lockAcquired = await acquireLock(user_id);
      }

      // Get the last task execution time for the user
      const lastExecutionKey = `lastExecution:${user_id}`;
      const lastExecutionTime = await redis.get(lastExecutionKey);
      const now = Date.now();

      // If last execution time exists, ensure a full 1-second delay between tasks
      if (lastExecutionTime) {
        const elapsedTime = now - lastExecutionTime;
        const delay = Math.max(1000 - elapsedTime, 0); // Ensure at least 1s between tasks
        if (delay > 0) {
          console.log(`Delaying task for user ${user_id} by ${delay}ms`);
          await sleep(delay);
        }
      }

      // Process the task
      console.log(`Processing task for user ${user_id}`);
      await task(user_id);

      // Store the current execution time in Redis
      await redis.set(lastExecutionKey, Date.now());

      // Release the lock after the task is completed
      await releaseLock(user_id);
    } catch (err) {
      console.error("Error processing task:", err);
    }
  });

  taskQueue.on("failed", (job, err) => {
    console.log(`Job ${job.id} failed with error: ${err.message}, retrying...`);
  });

  // Express app listening on port 3000
  app.listen(3000, () => {
    console.log(`Worker ${process.pid} is listening on port 3000`);
  });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log(`Worker ${process.pid} shutting down...`);
    await taskQueue.close(); // Wait for all tasks to finish before shutting down
    process.exit(0);
  });
}

// Task function to process and log task completion
async function task(user_id) {
  const currentTime = new Date().toLocaleString();
  const logMessage = `${user_id}-task completed at-${currentTime}\n`;

  const logDir = path.join(__dirname, "../node-api-cluster/logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFilePath = path.join(logDir, "tasks.log");

  // Append the log to the file with error handling
  await new Promise((resolve, reject) => {
    fs.appendFile(logFilePath, logMessage, (err) => {
      if (err) {
        console.error("Error writing to log file:", err);
        return reject(err);
      }
      resolve();
    });
  });

  console.log(logMessage);
}
