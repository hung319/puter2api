// src/index.ts

// 1. LẤY CẤU HÌNH TỪ .ENV
const jwtTokens = (process.env.JWT_TOKEN || "").split(",").filter(Boolean);
const authTokens = (process.env.AUTH_TOKEN || "").split(",").filter(Boolean);

if (jwtTokens.length === 0) console.error("Lỗi: Biến môi trường 'JWT_TOKEN' chưa được set.");
if (authTokens.length === 0) console.error("Lỗi: Biến môi trường 'AUTH_TOKEN' chưa được set.");

// [NEW] Cấu hình CORS
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

// 2. LOGIC TẢI MODELS (Dynamic Only)
let modelsData: any[] = [];
const MODELS_URL = "https://puter.com/puterai/chat/models";

async function loadModelsRobust() {
  try {
    console.log(`Đang thử tải models động từ: ${MODELS_URL}...`);
    const response = await fetch(MODELS_URL);

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const modelsJson = await response.json(); 
    const modelsList = modelsJson?.models;

    if (!modelsList || !Array.isArray(modelsList) || modelsList.length === 0) {
      throw new Error("API trả về danh sách rỗng hoặc không hợp lệ."); 
    }

    modelsData = modelsList.map((modelId: string) => {
      let owned_by = "unknown";
      if (modelId.includes("deepseek")) owned_by = "deepseek";
      else if (modelId.includes("grok")) owned_by = "xai";
      else if (modelId.includes("gpt-") || modelId.startsWith("o1") || modelId.startsWith("o4")) owned_by = "openai";
      else if (modelId.includes("claude")) owned_by = "anthropic";
      else if (modelId.includes("mistral") || modelId.includes("codestral")) owned_by = "mistral";
      
      return {
        id: modelId,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: owned_by
      };
    });
    console.log(`✅ Đã tải động ${modelsData.length} models vào bộ nhớ.`);

  } catch (err) {
    console.error("⚠️ Tải models thất bại:", (err as Error).message);
    console.warn("Server sẽ chạy với danh sách model rỗng cho đến lần fetch tiếp theo.");
  }
}

function determineDriver(model: string): string {
  if (model.includes("deepseek")) return "deepseek";
  if (model.includes("grok")) return "xai";
  if (model.includes("claude")) return "claude";
  if (model.includes("mistral") || model.includes("codestral")) return "mistral";
  return "openai-completion";
}

// 3. MIDDLEWARE XÁC THỰC
function authMiddleware(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Authorization header missing" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }
  const token = authHeader.replace("Bearer ", "");
  if (!authTokens.includes(token)) {
    return new Response(JSON.stringify({ error: "Invalid authorization token" }), {
      status: 403, headers: { "Content-Type": "application/json" }
    });
  }
  return null;
}

// 4. HANDLERS
function handleModelsRequest() {
  return new Response(JSON.stringify({
    object: "list",
    data: modelsData 
  }), {
    headers: { "Content-Type": "application/json" }
  });
}

function handleHealthRequest() {
  return new Response(JSON.stringify({
    status: "ok",
    uptime: process.uptime(),
    models_loaded: modelsData.length,
    timestamp: new Date().toISOString()
  }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
}

async function handleChatRequest(req: Request) {
  if (jwtTokens.length === 0) {
    return new Response(JSON.stringify({ error: "Server-side configuration error: JWT_TOKEN not set." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
  const selectedToken = jwtTokens[Math.floor(Math.random() * jwtTokens.length)];
  
  let requestData;
  try {
    requestData = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }
  
  const { messages, model, stream = false } = requestData;
  const driver = determineDriver(model);

  const requestPayload = {
    interface: "puter-chat-completion",
    driver, test_mode: false, method: "complete",
    args: { messages, model, stream }
  };

  const headers = {
    "Host": "api.puter.com", "User-Agent": "Mozilla/5.0", "Accept": "*/*",
    "Authorization": `Bearer ${selectedToken}`, "Content-Type": "application/json;charset=UTF-8",
    "Origin": "https://docs.puter.com", "Referer": "https://docs.puter.com/",
  };

  try {
    const response = await fetch("https://api.puter.com/drivers/call", {
      method: "POST",
      headers,
      body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Upstream API error", status: response.status }), {
        status: response.status, headers: { "Content-Type": "application/json" }
      });
    }

    if (stream) {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      (async () => {
        const reader = response.body?.getReader();
        if (!reader) return;
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        
        const initialEvent = {
          id: `chatcmpl-${Date.now()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(initialEvent)}\n\n`));

        try {
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; 
            
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const jsonData = JSON.parse(line);
                let text = "";
                if (jsonData.text) {
                  text = jsonData.text;
                } else if (jsonData.result?.message?.content) {
                  const content = jsonData.result.message.content;
                  if (Array.isArray(content)) {
                    text = content.find((item: any) => item.type === "text")?.text || "";
                  } else if (typeof content === "string") {
                    text = content;
                  }
                }
                if (text) {
                  const chunkEvent = {
                    id: `chatcmpl-${Date.now()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
                    choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
                  };
                  await writer.write(encoder.encode(`data: ${JSON.stringify(chunkEvent)}\n\n`));
                }
              } catch (e) {}
            }
          }
          const doneEvent = {
            id: `chatcmpl-${Date.now()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
          };
          await writer.write(encoder.encode(`data: ${JSON.stringify(doneEvent)}\n\n`));
          await writer.write(encoder.encode("data: [DONE]\n\n"));
        } finally {
          await writer.close();
        }
      })();

      return new Response(readable, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" }
      });

    } else {
      const data = await response.json();
      let content = data?.result?.message?.content || "";
      if (Array.isArray(content)) {
        content = content.find((c: any) => c.type === 'text')?.text || JSON.stringify(content);
      } else if (typeof content !== 'string') {
         content = JSON.stringify(content);
      }
      const usage = data?.result?.usage || {};
      const prompt_tokens = usage.input_tokens || 0;
      const completion_tokens = usage.output_tokens || 0;

      return new Response(JSON.stringify({
        id: `chatcmpl-${Date.now()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
        choices: [{ message: { role: "assistant", content }, finish_reason: "stop", index: 0 }],
        usage: { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens }
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: "Internal server error", details: (error as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}

// 5. ROUTER CHÍNH & START SERVER
async function handler(req: Request) {
  const url = new URL(req.url);

  // === CORS PREFLIGHT ===
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  let response: Response;

  // === ROUTING LOGIC ===
  try {
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
      response = handleHealthRequest();
    } else if (url.pathname === '/' && req.method === "GET") {
      response = new Response("Puter.js (Raw API) Proxy is running! Check /health for status.", { status: 200 });
    } else {
      const authError = authMiddleware(req);
      if (authError) {
        response = authError;
      } else if (url.pathname === "/v1/models" && req.method === "GET") {
        response = handleModelsRequest();
      } else if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
        response = await handleChatRequest(req);
      } else {
        response = new Response(JSON.stringify({ error: "Not found" }), {
          status: 404, headers: { "Content-Type": "application/json" }
        });
      }
    }
  } catch (err) {
    response = new Response(JSON.stringify({ error: "Unhandled Server Error", details: (err as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  // === INJECT CORS HEADERS ===
  // Gắn header vào mọi response trả về
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
}

const port = parseInt(process.env.PORT || '8000');
console.log("Đang khởi động server...");
await loadModelsRobust();
console.log(`✅ Server Bun (Raw Puter Proxy - Dynamic v2 + CORS) đang chạy tại: http://localhost:${port}`);
console.log(`🩺 Health check available at: http://localhost:${port}/health`);

export default {
  port: port,
  fetch: handler
};
