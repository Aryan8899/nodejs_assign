# Node.js API Task Queueing with Rate Limiting

## Project Overview
This project is a Node.js API that handles task processing with a rate-limiting mechanism and queueing system. Each user is allowed a rate of 1 task per second and a maximum of 20 tasks per minute. If the rate limit is exceeded, tasks are queued and processed after the defined interval.

The API operates in a clustered environment, utilizing Redis for rate limiting and queueing, ensuring scalability and fault tolerance.

## Prerequisites
- Node.js (version 14 or higher)
- Redis (version 5 or higher)
- WSL (Windows Subsystem for Linux) environment (if using Windows)

## Requirements

1. Set up a Node.js API cluster with two replica sets.
2. Implement rate limiting to enforce one task per second and 20 tasks per minute per user.
3. Create a task queueing system to manage tasks for each user ID.
4. Store task completion logs in a log file.
5. Ensure the system is resilient to failures, handles Redis shutdowns, and can recover tasks upon restart.

## Running the Application

### 1. Open WSL Terminal
- If you are running this project in WSL, open your WSL terminal.

### 2. Navigate to the `src` directory where `app.js` is located:
```bash
cd /mnt/c/Users/Aryan/nodeassn/node-api-cluster/src
```
### 3. Run the Node.js application:
```bash
node app.js
```
### 4. Set up Redis:
- Ensure Redis is installed and running on your system.
- For Windows users, you can install Redis within WSL or use a Windows-compatible Redis installer.

### 5. Configure Environment Variables:
- Create a `.env` file in the root directory.
- Add the following variables:
```bash
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```
## Sending Requests to the API
You can send a POST request to the API using the `curl` command. The API listens on `localhost:3000`, and you can provide a user ID in the request body as follows:
```bash
curl -X POST http://localhost:3000/task -H "Content-Type: application/json" -d '{"user_id":"789"}'
```

## API Details:
- Method: POST
- URL: `http://localhost:3000/task`
- Headers: `Content-Type: application/json`
- Request Body:
```bash
{
  "user_id": "123"
}
```
- user_id (string): The ID of the user submitting the task.

## Responses:
- 200 OK:
 ```bash
 {
  "status": "Task queued successfully"
}
```
- 429 Too Many Requests:
```bash
{
  "status": "Rate limit exceeded, task delayed to next minute."
}
```
- 400 Bad Request:
```bash
{
  "error": "User ID is required"
}
```

## Viewing Task Logs
All completed tasks are logged in the `tasks.log` file, which is located at:
```bash
C:\Users\Path\nodeassn\node-api-cluster\logs\tasks.log
```
To view the log file in WSL, use:
```bash
cat /mnt/c/Users/Aryan/nodeassn/node-api-cluster/logs/tasks.log
```
This will display the logs of all completed tasks with the timestamp.

## Error Handling
- **Redis Unavailability:** The system uses retry logic for Redis connection issues. If Redis is unavailable, tasks are stored locally and processed once Redis is back online.
- **Task Queueing:** When the rate limit is exceeded, tasks are queued and processed after the allowed interval.
- **Clustered Environment:** Utilizes Node.js clustering with two worker processes to handle concurrent requests.
- **Redis Integration:** Redis is used for storing rate-limiting data and managing the task queue.
- **Graceful Shutdown and Restart:**  The application is resilient to Redis shutdowns and can recover queued tasks after Redis comes back online.

## Testing Instructions
### Testing Rate Limiting
To test the rate limiting functionality:
1) Send multiple requests exceeding the rate limit:
```bash
for i in {1..25}; do curl -X POST http://localhost:3000/task -H "Content-Type: application/json" -d '{"user_id":"123"}'; done
```
2) Observe the responses:
- The first 20 requests should return:
```bash
{
  "status": "Task queued successfully"
}

```
- Subsequent requests should return:
```bash
{
  "status": "Rate limit exceeded, task delayed to next minute."
}
```
3) Check the logs:
- Use `cat` to view `tasks.log` and verify that tasks are processed at a rate of 1 per second and that excess tasks are queued for the next minute.

## Testing Task Queueing
1) Send concurrent requests for the same user:
```bash
for i in {1..5}; do curl -X POST http://localhost:3000/task -H "Content-Type: application/json" -d '{"user_id":"123"}' & done
```
2) Verify that tasks are queued and processed sequentially.

##  Testing Redis Failure Recovery
1) Stop Redis:
```bash
sudo service redis-server stop
```
2) Send tasks while Redis is down.
3) Start Redis again:
```bash
sudo service redis-server start
```
4) Verify that tasks are processed after Redis restarts.

## Environment Variables
The following environment variables are used for Redis configuration:
```bash
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```
Make sure to configure your `env` file with the correct Redis settings before running the application.

## Conclusion
This project implements a robust task queueing system with rate limiting, ensuring no requests are dropped even when rate limits are exceeded. The system gracefully handles Redis failures and recovers tasks on restart. Logs of task completions are stored in a file for monitoring purposes.
