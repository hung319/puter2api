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

RUN adduser -D deno
USER deno

COPY --from=builder /deno-dir /deno-dir

# --- Application Code ---
COPY main.ts .
# ⛔️ ĐÃ XÓA DÒNG NÀY:
# COPY models.txt .

# --- Runtime ---
EXPOSE 8000

# (Không đổi) Vẫn cần --allow-read để đọc .env
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "main.ts"]
