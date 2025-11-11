// main.ts
//
// Cách chạy:
// 1. Tạo file .env (xem ví dụ)
// 2. Đặt file 'models.txt' cùng thư mục.
// 3. Chạy:
//    deno run --allow-net --allow-env --allow-read main.ts

import { Hono } from 'npm:hono@latest';
import { streamSSE } from 'npm:hono/streaming';
import { init } from 'npm:@heyputer/puter.js/src/init.cjs';

// 1. IMPORT THƯ VIỆN .ENV CHUẨN CỦA DENO
import { load } from 'https://deno.land/std@0.224.0/dotenv/mod.ts';

// 2. TẢI CÁC BIẾN TỪ FILE .env VÀO Deno.env
// Phải chạy trước khi truy cập Deno.env
await load();

// 3. LẤY AUTH TOKENS (TỪ .ENV)
const PUTER_AUTH_TOKEN = Deno.env.get('PUTER_AUTH_TOKEN');
const SERVER_API_KEY = Deno.env.get('SERVER_API_KEY'); // Key mới

// 4. KIỂM TRA CÁC BIẾN MÔI TRƯỜNG (Rất quan trọng)
if (!PUTER_AUTH_TOKEN) {
  console.error("Lỗi: PUTER_AUTH_TOKEN chưa được set trong file .env");
  Deno.exit(1);
}
if (!SERVER_API_KEY) {
  console.error("Lỗi: SERVER_API_KEY chưa được set trong file .env");
  console.error("Hãy tạo một key ngẫu nhiên (ví dụ: 'sk-12345') và thêm vào .env");
  Deno.exit(1);
}

// 5. KHỞI TẠO PUTER SDK
const puter = init(PUTER_AUTH_TOKEN);

// 6. ĐỌC DATA CHO ENDPOINT /v1/models (Không đổi)
let modelsData: any[] = [];
try {
  const modelsJson = await Deno.readTextFile('./models.txt');
  const modelsList = JSON.parse(modelsJson).models;
  modelsData = modelsList.map((modelId: string) => ({
    id: modelId,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "puter",
  }));
} catch (err) {
  console.warn("⚠️ Cảnh báo: Không thể đọc file 'models.txt'. Endpoint /v1/models sẽ rỗng.");
}

// 7. TẠO HONO SERVER
const app = new Hono();

// ===============================================
// 8. MIDDLEWARE XÁC THỰC API KEY (Nâng cấp cốt lõi)
// ===============================================
// Middleware này sẽ chạy cho MỌI route bắt đầu bằng /v1/*
app.use('/v1/*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const expectedToken = `Bearer ${SERVER_API_KEY}`;

  if (!authHeader || authHeader !== expectedToken) {
    console.warn("Xác thực thất bại. API key không hợp lệ.");
    // Trả về lỗi 401 Unauthorized theo chuẩn OpenAI
    return c.json({
      error: {
        message: "Incorrect API key provided. You must be authenticated to use this API.",
        type: "invalid_request_error",
        code: "invalid_api_key"
      }
    }, 401);
  }

  // Key hợp lệ, tiếp tục xử lý request
  await next();
});

// ===============================================
// ENDPOINT: GET /v1/models
// (Giờ đã được bảo vệ bởi middleware)
// ===============================================
app.get('/v1/models', (c) => {
  console.log("GET /v1/models (Đã xác thực)");
  return c.json({
    object: "list",
    data: modelsData,
  });
});

// ===============================================
// ENDPOINT: POST /v1/chat/completions
// (Giờ đã được bảo vệ bởi middleware)
// ===============================================
app.post('/v1/chat/completions', async (c) => {
  console.log("POST /v1/chat/completions (Đã xác thực)");
  const body = await c.req.json();
  const isStream = body.stream ?? false;
  const messages = body.messages;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: "Request thiếu mảng 'messages'" }, 400);
  }

  const puterOptions: { [key: string]: any } = {
    model: body.model,
    stream: isStream,
  };
  
  if (body.max_tokens) puterOptions.max_tokens = body.max_tokens;
  if (body.temperature) puterOptions.temperature = body.temperature;
  if (body.tools) puterOptions.tools = body.tools;

  try {
    if (isStream) {
      const puterStream = await puter.ai.chat(messages, puterOptions);
      const modelId = `chatcmpl-${Date.now()}`;

      return streamSSE(c, async (stream) => {
        for await (const part of puterStream) {
          const content = part?.text || ""; 
          if (content) {
            const openAIChunk = {
              id: modelId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: body.model,
              choices: [
                { index: 0, delta: { content: content }, finish_reason: null },
              ],
            };
            await stream.writeSSE({ data: JSON.stringify(openAIChunk) });
          }
        }
        const endChunk = {
          id: modelId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [
            { index: 0, delta: {}, finish_reason: "stop" },
          ],
        };
        await stream.writeSSE({ data: JSON.stringify(endChunk) });
        await stream.writeSSE({ data: '[DONE]' });
      });
    }

    // Non-streaming
    const puterResponse = await puter.ai.chat(messages, puterOptions);
    let responseMessage;
    if (typeof puterResponse === 'string') {
        responseMessage = { role: "assistant", content: puterResponse };
    } else if (puterResponse && puterResponse.message) {
        responseMessage = puterResponse.message;
    } else if (puterResponse && puterResponse.text) {
        responseMessage = { role: "assistant", content: puterResponse.text };
    } else {
        responseMessage = { role: "assistant", content: JSON.stringify(puterResponse) };
    }

    const openAIResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [
        { index: 0, message: responseMessage, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
    return c.json(openAIResponse);

  } catch (err) {
    console.error("Lỗi khi gọi API của Puter:", err);
    return c.json({ error: "Lỗi từ upstream Puter API", details: err.message }, 502);
  }
});

// Endpoint Health Check (Không cần auth vì không nằm trong /v1/*)
app.get('/', (c) => {
  return c.text('Puter.js (Deno) OpenAI-compatible Proxy (v3 - Secure) is running!');
});

// 9. KHỞI ĐỘNG SERVER
console.log("✅ Đã tải cấu hình từ .env");
console.log(`✅ Đã tải ${modelsData.length} models từ models.txt.`);
console.log("✅ Server Deno (Proxy Puter.js v3) đang chạy tại: http://localhost:8000");
console.log("🔒 Các endpoint /v1/* đã được bảo vệ bằng SERVER_API_KEY.");

Deno.serve({
  port: 8000,
  onListen: ({ port, hostname }) => {
    console.log(`📡 Listening on http://${hostname}:${port}`);
  },
  fetch: app.fetch,
});
