FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Copy SQL migration files to dist (TypeScript doesn't copy non-ts files)
RUN cp -r src/db/migrations dist/db/

# Run migrations first, then start the V2 indexer
CMD ["sh", "-c", "node dist/db/migrate-v2.js && node dist/index-v2.js"]
