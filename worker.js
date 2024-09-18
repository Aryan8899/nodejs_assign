const Queue = require("bull");
const fs = require("fs");

// Initialize task queue
const taskQueue = new Queue("taskQueue", {
  redis: { host: "localhost", port: 6379 },
});

// Process tasks in the queue
taskQueue.process(async (job) => {
  const { user_id } = job.data;
  await task(user_id);
});

// Task function to process and log task completion
async function task(user_id) {
  const currentTime = new Date().toLocaleString();
  const logMessage = `${user_id}-task completed at-${currentTime}\n`;

  const logFilePath = "./logs/tasks.log";

  // Append the log to the file
  fs.appendFile(logFilePath, logMessage, (err) => {
    if (err) throw err;
  });

  console.log(logMessage);
}
