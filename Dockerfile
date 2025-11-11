# =================================================================
# STAGE 1: Dependency Caching (builder)
# =================================================================
FROM denoland/deno:alpine AS builder
WORKDIR /app
COPY main.ts .
RUN deno cache --no-check main.ts

# =================================================================
# STAGE 2: Final Runtime Image
# =================================================================
FROM denoland/deno:alpine
WORKDIR /app

# ⛔️ KHÔNG CẦN DÒNG NÀY NỮA:
# RUN adduser -D deno
# User 'deno' đã tồn tại sẵn trong base image 'denoland/deno:alpine'.

# ✅ CHÚNG TA CHỈ CẦN CHUYỂN SANG USER ĐÓ:
USER deno

# Copy dependencies đã cache từ stage 'builder'
COPY --from=builder /deno-dir /deno-dir

# Copy code ứng dụng
COPY main.ts .
# (Đã xóa COPY models.txt . vì không cần nữa)

# --- Runtime ---
EXPOSE 8000

# Lệnh chạy (vẫn cần --allow-read để đọc .env)
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "main.ts"]
