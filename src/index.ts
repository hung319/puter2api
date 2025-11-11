// src/index.ts

// 1. KHÔNG CẦN import 'dotenv/config'
// Bun tự động tải file .env

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { puter } from '@heyputer/puter.js'; // Import NPM chuẩn

// 2. KHÔNG CẦN import { serve } from '@hono/node-server'

// 3. LẤY AUTH TOKENS (dùng process.env)
// Bun cũng hỗ trợ process.env
const PUTER_AUTH_TOKEN = process.env.PUTER_AUTH_TOKEN;
const SERVER_API_KEY = process.env.SERVER_API_KEY;

if (!PUTER_AUTH_TOKEN || !SERVER_API_KEY) {
  console.error("Lỗi: PUTER_AUTH_TOKEN hoặc SERVER_API_KEY chưa được set trong file .env");
  process.exit(1);
}

// 4. KHỞI TẠO PUTER SDK (Không đổi)
console.log("✅ Đã khởi tạo Puter client (tự động).");

// 5. TẢI MODELS VÀO BỘ NHỚ (Không đổi)
let modelsData: any[] = [];
const MODELS_URL = "https://puter.com/puterai/chat/models";

async function loadModelsIntoMemory() {
  console.log(`Đang tải models từ: ${MODELS_URL}...`);
  try {
    const response = await fetch(MODELS_URL); // fetch() là native trong Bun
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const modelsJson = await response.json();
    const modelsList = modelsJson.models; 
    modelsData = modelsList.map((modelId: string) => ({
      id: modelId,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "puter",
    }));
    console.log(`✅ Đã tải ${modelsData.length} models vào bộ nhớ.`);
  } catch (err) {
    console.error("⚠️ Lỗi nghiêm trọng: Không thể tải danh sách models.", (err as Error).message);
  }
}

// 6. TẠO HONO SERVER (Không đổi)
const app = new Hono();

// 7. MIDDLEWARE XÁC THỰC (Không đổi)
app.use('/v1/*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const expectedToken = `Bearer ${SERVER_API_KEY}`;
  if (!authHeader || authHeader !== expectedToken) {
    console.warn("Xác thực thất bại. API key không hợp lệ.");
    return c.json({
      error: { message: "Incorrect API key provided.", type: "invalid_request_error", code: "invalid_api_key" }
    }, 401);
  }
  await next();
});

// 8. ENDPOINT /v1/models (Không đổi)
app.get('/v1/models', (c) => {
  console.log("GET /v1/models (Đã xác thực)");
  return c.json({ object: "list", data: modelsData });
});

// 9. ENDPOINT /v1/chat/completions (Không đổi)
app.post('/v1/chat/completions', async (c) => {
  // ... (Logic y hệt như trước, không cần thay đổi)
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
              id: modelId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model,
              choices: [{ index: 0, delta: { content: content }, finish_reason: null }],
            };
            await stream.writeSSE({ data: JSON.stringify(openAIChunk) });
          }
        }
        const endChunk = {
          id: modelId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        await stream.writeSSE({ data: JSON.stringify(endChunk) });
        await stream.writeSSE({ data: '[DONE]' });
      });
    }
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
      id: `chatcmpl-${Date.now()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: body.model,
      choices: [{ index: 0, message: responseMessage, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
    return c.json(openAIResponse);
  } catch (err) {
    console.error("Lỗi khi gọi API của Puter:", (err as Error).message);
    return c.json({ error: "Lỗi từ upstream Puter API", details: (err as Error).message }, 502);
  }
});

// 10. HEALTH CHECK (Không đổi)
app.get('/', (c) => {
  return c.text('Puter.js (Bun) OpenAI-compatible Proxy (v7) is running!');
});

// 11. KHỞI ĐỘNG SERVER (dùng Bun.serve)
async function startServer() {
  console.log("✅ Đã tải cấu hình từ .env (tự động)");
  await loadModelsIntoMemory(); 

  const port = parseInt(process.env.PORT || '8000');
  
  console.log(`✅ Server Bun (Proxy Puter.js v7) đang chạy tại: http://localhost:${port}`);
  console.log("🔒 Các endpoint /v1/* đã được bảo vệ bằng SERVER_API_KEY.");

  // Cú pháp của Bun.serve (giống Deno)
  Bun.serve({
    fetch: app.fetch,
    port: port
  });
}

startServer();
