FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Create CSV exports directory
RUN mkdir -p csv_exports

# Start the indexer directly
CMD ["npm", "run", "start"]
