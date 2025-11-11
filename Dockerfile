# =================================================================
# STAGE 1: Dependency Caching (builder)
# =================================================================
# Dùng image Deno chính thức (bản alpine-slim)
FROM denoland/deno:alpine AS builder

WORKDIR /app

# Copy *chỉ* file main.ts để cache dependencies
COPY main.ts .

# Chạy deno cache. 
# Bước này sẽ tải hono, dotenv, puter.js...
# Do nó nằm ở layer riêng, nó sẽ chỉ chạy lại nếu main.ts thay đổi.
RUN deno cache --no-check main.ts

# =================================================================
# STAGE 2: Final Runtime Image
# =================================================================
FROM denoland/deno:alpine

WORKDIR /app

# --- Bảo mật & Quyền ---
# Tạo một user không phải root (deno) để chạy ứng dụng
# Đây là một 'security best practice'
RUN adduser -D deno
# Chuyển sang user 'deno'
USER deno

# --- Dependencies ---
# Copy dependencies đã cache từ stage 'builder'
# ENV DENO_DIR đã được Deno-alpine-image set là /deno-dir
COPY --from=builder /deno-dir /deno-dir

# --- Application Code ---
# Copy code ứng dụng (main.ts và models.txt)
# .env và .git sẽ bị bỏ qua bởi .dockerignore
COPY main.ts .
COPY models.txt .

# --- Runtime ---
# Expose port mà Hono server đang chạy
EXPOSE 8000

# Lệnh để chạy ứng dụng
# Chúng ta cung cấp các cờ quyền (permissions)
# Server sẽ đọc PUTER_AUTH_TOKEN và SERVER_API_KEY từ env
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "main.ts"]
