// src/index.ts

// 1. LẤY CẤU HÌNH TỪ .ENV
const jwtTokens = (process.env.JWT_TOKEN || "").split(",").filter(Boolean);
const authTokens = (process.env.AUTH_TOKEN || "11042006").split(",").filter(Boolean);
const proxyUrl = process.env.PROXY_URL || undefined;

if (jwtTokens.length === 0) {
  console.error("Lỗi: Biến môi trường 'JWT_TOKEN' chưa được set.");
}
if (authTokens.length === 0) {
  console.error("Lỗi: Biến môi trường 'AUTH_TOKEN' chưa được set.");
}
if (proxyUrl) {
  console.log(`✅ Đã phát hiện Proxy: ${proxyUrl.split('@')[0]}...`);
}

// 2. PHÂN LOẠI MODELS TĨNH (SỬA LỖI 2)
class ModelCategories {
  static deepseek = [
    "deepseek-chat", "deepseek-reasoner", "deepseek-v3", "deepseek-r1-0528"
  ];
  static xai = [
    "grok-beta", "grok-3-mini"
  ];
  static openai = [
    "gpt-4.1-nano", "gpt-4o-mini", "o1", "o1-mini", "o1-pro", "o4-mini",
    "gpt-4.1", "gpt-4.1-mini", "gpt-4.5-preview"
  ];
  static claude = [
    "claude-sonnet-4-20250514", "claude-opus-4-20250514",
    "claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest",
  ];
  static mistral = [
    "mistral-large-latest", "codestral-latest"
  ];

  // ==============================================================
  // 💡 SỬA LỖI 2: Thêm lại hàm static đã bị thiếu
  // ==============================================================
  static getAllModelsStatic() {
    return [
      ...ModelCategories.deepseek.map(id => ({ id, owned_by: "deepseek" })),
      ...ModelCategories.xai.map(id => ({ id, owned_by: "xai" })),
      ...ModelCategories.openai.map(id => ({ id, owned_by: "openai" })),
      ...ModelCategories.claude.map(id => ({ id, owned_by: "anthropic" })),
      ...ModelCategories.mistral.map(id => ({ id, owned_by: "mistral" }))
    ];
  }
}

// 3. LOGIC TẢI MODELS (SỬA LỖI 1)
let modelsData: any[] = [];
const MODELS_URL = "https://puter.com/puterai/chat/models";

async function loadModelsRobust() {
  try {
    console.log(`Đang thử tải models động từ: ${MODELS_URL}...`);
    const response = await fetch(MODELS_URL, {
      ...(proxyUrl && { proxy: proxyUrl })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const modelsJson = await response.json(); 
    
    // ==============================================================
    // 💡 SỬA LỖI 1: Thêm '?' để kiểm tra 'null'
    // ==============================================================
    const modelsList = modelsJson?.models;

    if (!modelsList || !Array.isArray(modelsList) || modelsList.length === 0) {
      // Lỗi này sẽ bắt được cả 'null' và '[]'
      throw new Error("Tải động thành công nhưng nội dung rỗng hoặc không hợp lệ."); 
    }

    modelsData = modelsList.map((modelId: string) => {
      let owned_by = "unknown";
      if (modelId.includes("deepseek")) owned_by = "deepseek";
      else if (modelId.includes("grok")) owned_by = "xai";
      else if (modelId.includes("gpt-") || modelId.startsWith("o1")) owned_by = "openai";
      else if (modelId.includes("claude")) owned_by = "anthropic";
      else if (modelId.includes("mistral")) owned_by = "mistral";
      
      return {
        id: modelId,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: owned_by
      };
    });
    console.log(`✅ Đã tải động ${modelsData.length} models vào bộ nhớ.`);

  } catch (err) {
    console.warn("⚠️ Tải models động thất bại.", (err as Error).message);
    console.warn("Đang sử dụng danh sách models tĩnh (hard-coded) làm dự phòng.");
    
    // Dòng này giờ sẽ hoạt động
    const staticModels = ModelCategories.getAllModelsStatic(); 
    
    modelsData = staticModels.map(model => ({
      id: model.id,
      object: "model",
      created: 1752371050, 
      owned_by: model.owned_by
    }));
    
    console.log(`✅ Đã tải ${modelsData.length} models tĩnh (dự phòng).`);
  }
}


// 4. MIDDLEWARE XÁC THỰC (Không đổi)
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

// 5. HANDLER CHO /v1/models (Không đổi)
function handleModelsRequest() {
  return new Response(JSON.stringify({
    object: "list",
    data: modelsData 
  }), {
    headers: { "Content-Type": "application/json" }
  });
}

// 6. HANDLER CHO /v1/chat/completions (Không đổi)
async function handleChatRequest(req: Request) {
  if (jwtTokens.length === 0) {
    return new Response(JSON.stringify({ error: "Server-side configuration error: JWT_TOKEN not set." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
  const selectedToken = jwtTokens[Math.floor(Math.random() * jwtTokens.length)];
  const requestData = await req.json();
  const { messages, model, stream = false } = requestData;

  let driver = "openai-completion";
  if (ModelCategories.deepseek.includes(model)) driver = "deepseek";
  else if (ModelCategories.xai.includes(model)) driver = "xai";
  else if (ModelCategories.claude.includes(model)) driver = "claude";
  else if (ModelCategories.mistral.includes(model)) driver = "mistral";

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
      body: JSON.stringify(requestPayload),
      ...(proxyUrl && { proxy: proxyUrl }) 
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
          id: `chatcmpl-${Date.mow()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(initialEvent)}\n\n`));
        try {
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
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
              } catch (e) {
                console.error("Error parsing JSON line:", e, "Line:", line);
              }
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
      let content = data?.result?.message?.content || "No text, maybe error?";
      if (driver === "claude" && Array.isArray(content)) {
        content = content[0].text;
      }
      const usage = data?.result?.usage;
      let tokenUsage = [0, 0, 0];
      if (Array.isArray(usage)) {
        tokenUsage = [
          ...usage.map((x: any) => x.amount),
          usage.reduce((sum: number, x: any) => sum + x.amount, 0)
        ];
      } else if (usage && typeof usage === "object") {
        tokenUsage = [
          usage.input_tokens || 0,
          usage.output_tokens || 0,
          (usage.input_tokens || 0) + (usage.output_tokens || 0)
        ];
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: tokenUsage[0],
          completion_tokens: tokenUsage[1],
          total_tokens: tokenUsage[2]
        }
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

// 7. ROUTER CHÍNH (Không đổi)
async function handler(req: Request) {
  const url = new URL(req.url);
  if (url.pathname === '/' && req.method === "GET") {
    return new Response("Puter.js (Raw API) Proxy is running!", { status: 200 });
  }
  const authResponse = authMiddleware(req);
  if (authResponse) return authResponse;
  if (url.pathname === "/v1/models" && req.method === "GET") {
    return handleModelsRequest();
  } else if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    return handleChatRequest(req);
  } else {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404, headers: { "Content-Type": "application/json" }
    });
  }
}

// 8. KHỞI ĐỘNG SERVER BUN (Không đổi)
const port = parseInt(process.env.PORT || '8000');
console.log("Đang khởi động server...");
await loadModelsRobust();
console.log(`✅ Server Bun (Raw Puter Proxy - Hybrid Models v2) đang chạy tại: http://localhost:${port}`);
console.log(`🔒 Đã tải ${authTokens.length} API key (AUTH_TOKEN).`);
console.log(`🔑 Đã tải ${jwtTokens.length} Puter JWT (JWT_TOKEN).`);
if (proxyUrl) {
  console.log(`🔄 Proxy đang được sử dụng: ${proxyUrl.substring(0, proxyUrl.indexOf(':'))}...`);
}

export default {
  port: port,
  fetch: handler
};
