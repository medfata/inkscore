FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Start the V2 indexer
CMD ["node", "dist/index-v2.js"]
