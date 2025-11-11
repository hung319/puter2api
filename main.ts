// main.ts
//
// Cách chạy:
// 1. Tạo file .env
// 2. Chạy:
//    deno run --allow-net --allow-env --allow-read main.ts
//    (Vẫn cần --allow-read để đọc file .env)

import { Hono } from 'npm:hono@latest';
import { streamSSE } from 'npm:hono/streaming';
import { init } from 'npm:@heyputer/puter.js/src/init.cjs';
import { load } from 'https://deno.land/std@0.224.0/dotenv/mod.ts';

// 1. TẢI .ENV (Không đổi)
await load();

// 2. LẤY AUTH TOKENS (Không đổi)
const PUTER_AUTH_TOKEN = Deno.env.get('PUTER_AUTH_TOKEN');
const SERVER_API_KEY = Deno.env.get('SERVER_API_KEY');

if (!PUTER_AUTH_TOKEN || !SERVER_API_KEY) {
  console.error("Lỗi: PUTER_AUTH_TOKEN hoặc SERVER_API_KEY chưa được set trong file .env");
  Deno.exit(1);
}

// 3. KHỞI TẠO PUTER SDK (Không đổi)
const puter = init(PUTER_AUTH_TOKEN);

// ===============================================
// 4. (CẬP NHẬT) TẢI MODELS VÀO BỘ NHỚ KHI KHỞI ĐỘNG
// ===============================================
let modelsData: any[] = [];
const MODELS_URL = "https://puter.com/puterai/chat/models";

/**
 * Hàm này tự động chạy khi server khởi động,
 * tải models từ URL và lưu vào biến 'modelsData'.
 */
async function loadModelsIntoMemory() {
  console.log(`Đang tải models từ: ${MODELS_URL}...`);
  try {
    const response = await fetch(MODELS_URL);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    // File models.txt chứa {"models": ["...", "..."]}
    const modelsJson = await response.json();
    const modelsList = modelsJson.models; 

    // Chuyển đổi list string thành định dạng object của OpenAI
    modelsData = modelsList.map((modelId: string) => ({
      id: modelId,
      object: "model",
      created: Math.floor(Date.now() / 1000), // Dùng timestamp hiện tại
      owned_by: "puter", // Giả định
    }));
    
    console.log(`✅ Đã tải ${modelsData.length} models vào bộ nhớ.`);
    
  } catch (err) {
    console.error("⚠️ Lỗi nghiêm trọng: Không thể tải danh sách models.", err.message);
    console.error("Endpoint /v1/models sẽ trả về danh sách rỗng.");
    // Bạn có thể chọn Deno.exit(1) ở đây nếu muốn server dừng
  }
}

// 5. TẠO HONO SERVER
const app = new Hono();

// 6. MIDDLEWARE XÁC THỰC (Không đổi)
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

// 7. ENDPOINT /v1/models (Không đổi, chỉ đọc từ 'modelsData')
app.get('/v1/models', (c) => {
  console.log("GET /v1/models (Đã xác thực)");
  return c.json({
    object: "list",
    data: modelsData, // 'modelsData' giờ được điền từ network
  });
});

// 8. ENDPOINT /v1/chat/completions (Không đổi)
app.post('/v1/chat/completions', async (c) => {
  // (Toàn bộ logic xử lý chat giữ nguyên y hệt)
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

// 9. HEALTH CHECK (Không đổi)
app.get('/', (c) => {
  return c.text('Puter.js (Deno) OpenAI-compatible Proxy (v4 - In-Memory) is running!');
});

// 10. KHỞI ĐỘNG SERVER
console.log("✅ Đã tải cấu hình từ .env");

// Chạy hàm tải models TRƯỚC khi khởi động server
await loadModelsIntoMemory(); 

console.log("✅ Server Deno (Proxy Puter.js v4) đang chạy tại: http://localhost:8000");
console.log("🔒 Các endpoint /v1/* đã được bảo vệ bằng SERVER_API_KEY.");

Deno.serve({
  port: 8000,
  onListen: ({ port, hostname }) => {
    console.log(`📡 Listening on http://${hostname}:${port}`);
  },
  fetch: app.fetch,
});
