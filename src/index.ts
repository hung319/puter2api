// src/index.ts

// 1. LẤY CẤU HÌNH TỪ .ENV
// -------------------------------------------------------------------
// LƯU Ý QUAN TRỌNG VỀ BIẾN MÔI TRƯỜNG:
//
// JWT_TOKEN: Token *thực sự* của Puter (cái 'eyJhbGci...')
//            Dùng để gọi API của Puter.
//            Bạn có thể thêm nhiều token, cách nhau bằng dấu phẩy.
//
// AUTH_TOKEN: Token *của bạn* (API Key công khai)
//             Dùng để xác thực các client gọi vào API này.
//             Ví dụ: 11042006
// -------------------------------------------------------------------

const jwtTokens = (process.env.JWT_TOKEN || "").split(",").filter(Boolean);
const authTokens = (process.env.AUTH_TOKEN || "11042006").split(",").filter(Boolean);

if (jwtTokens.length === 0) {
  console.error("Lỗi: Biến môi trường 'JWT_TOKEN' chưa được set.");
  console.error("Đây là token (bắt đầu bằng 'eyJ...') để xác thực với Puter.");
}
if (authTokens.length === 0) {
  console.error("Lỗi: Biến môi trường 'AUTH_TOKEN' chưa được set.");
  console.error("Đây là API key (ví dụ: '11042006') để bảo vệ API của bạn.");
}

// 2. PHÂN LOẠI MODELS (Logic từ file của bạn)
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

  static getAllModels() {
    return [
      ...ModelCategories.deepseek.map(id => ({ id, owned_by: "deepseek" })),
      ...ModelCategories.xai.map(id => ({ id, owned_by: "xai" })),
      ...ModelCategories.openai.map(id => ({ id, owned_by: "openai" })),
      ...ModelCategories.claude.map(id => ({ id, owned_by: "anthropic" })),
      ...ModelCategories.mistral.map(id => ({ id, owned_by: "mistral" }))
    ];
  }
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

// 4. HANDLER CHO /v1/models
function handleModelsRequest() {
  const models = ModelCategories.getAllModels();
  const responseData = {
    object: "list",
    data: models.map(model => ({
      id: model.id,
      object: "model",
      created: 1752371050, // Timestamp cố định
      owned_by: model.owned_by
    }))
  };
  return new Response(JSON.stringify(responseData), {
    headers: { "Content-Type": "application/json" }
  });
}

// 5. HANDLER CHO /v1/chat/completions
async function handleChatRequest(req: Request) {
  // Chọn ngẫu nhiên 1 JWT token
  if (jwtTokens.length === 0) {
    return new Response(JSON.stringify({ error: "Server-side configuration error: JWT_TOKEN not set." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
  const selectedToken = jwtTokens[Math.floor(Math.random() * jwtTokens.length)];
  
  const requestData = await req.json();
  const { messages, model, stream = false } = requestData;

  // Xác định driver
  let driver = "openai-completion"; // Mặc định
  if (ModelCategories.deepseek.includes(model)) driver = "deepseek";
  else if (ModelCategories.xai.includes(model)) driver = "xai";
  else if (ModelCategories.claude.includes(model)) driver = "claude";
  else if (ModelCategories.mistral.includes(model)) driver = "mistral";

  const requestPayload = {
    interface: "puter-chat-completion",
    driver,
    test_mode: false,
    method: "complete",
    args: { messages, model, stream }
  };

  const headers = {
    "Host": "api.puter.com",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0",
    "Accept": "*/*",
    "Authorization": `Bearer ${selectedToken}`, // Dùng JWT token
    "Content-Type": "application/json;charset=UTF-8",
    "Origin": "https://docs.puter.com",
    "Referer": "https://docs.puter.com/",
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
      // Logic streaming y hệt file Deno (dùng TransformStream)
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      
      (async () => {
        const reader = response.body?.getReader();
        if (!reader) return;
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        // Gửi thông tin role
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
            const chunk = decoder.decode(value);
            buffer += chunk;
            
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // Giữ lại dòng chưa hoàn chỉnh
            
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
          
          // Gửi sự kiện [DONE]
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
      // Logic non-streaming
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
        choices: [{
          message: { role: "assistant", content },
          finish_reason: "stop"
        }],
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

// 6. ROUTER CHÍNH
async function handler(req: Request) {
  const url = new URL(req.url);
  
  // Health check (bỏ qua auth)
  if (url.pathname === '/' && req.method === "GET") {
    return new Response("Puter.js (Raw API) Proxy is running!", { status: 200 });
  }

  // Xác thực
  const authResponse = authMiddleware(req);
  if (authResponse) return authResponse;

  // Routing
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

// 7. KHỞI ĐỘNG SERVER BUN
const port = parseInt(process.env.PORT || '8000');
console.log(`✅ Server Bun (Raw Puter Proxy) đang chạy tại: http://localhost:${port}`);
console.log(`🔒 Đã tải ${authTokens.length} API key (AUTH_TOKEN).`);
console.log(`🔑 Đã tải ${jwtTokens.length} Puter JWT (JWT_TOKEN).`);

export default {
  port: port,
  fetch: handler
};
