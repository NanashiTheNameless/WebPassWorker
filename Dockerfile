FROM node:24-alpine

WORKDIR /app

# Enable Corepack for Yarn 4.x support
RUN corepack enable

# Install dependencies
COPY package.json yarn.lock* ./
RUN yarn install --immutable

# Copy source and lib files
COPY tsconfig.json ./
COPY src/ src/
COPY lib/ lib/

# Build TypeScript
RUN yarn clean && yarn build

# Run server
EXPOSE 3000
CMD ["yarn", "start"]
