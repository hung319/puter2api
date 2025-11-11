# =================================================================
# STAGE 1: Cài đặt Dependencies
# =================================================================
FROM oven/bun:1.0 as deps
WORKDIR /app

# Copy chỉ package.json và lockfile để cache dependencies
COPY package.json bun.lockb* ./
RUN bun install

# =================================================================
# STAGE 2: Chạy Production
# =================================================================
FROM oven/bun:1.0

WORKDIR /app

# Copy dependencies đã cài đặt từ stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy code của ứng dụng
# (Chúng ta không cần build, Bun chạy TS trực tiếp)
COPY src ./src
COPY package.json .

# (Không cần copy tsconfig.json vì không build)

EXPOSE 8000

# Chạy ứng dụng bằng Bun
# Bun sẽ tự động đọc .env
CMD ["bun", "src/index.ts"]
